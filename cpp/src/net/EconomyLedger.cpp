#include "EconomyLedger.hpp"

#include "game/Economy.hpp"

#include <algorithm>
#include <cmath>
#include <cstring>
#include <map>

namespace Bazuko::Net {

namespace {
uint32_t FloatBits(float value) { uint32_t bits; std::memcpy(&bits, &value, sizeof bits); return bits; }
float BitsFloat(uint32_t bits) { float value; std::memcpy(&value, &bits, sizeof value); return value; }

void WriteState(BitWriter& w, const EconomySnapshot& s) {
    w.U32(FloatBits(s.money)); w.Bool(s.bigSack);
    const size_t count = std::min(s.items.size(), kMaxEconomyEntries);
    w.U8(static_cast<uint32_t>(count));
    for (size_t i = 0; i < count; ++i) { w.U16(s.items[i].first); w.U16(s.items[i].second); }
}
bool ReadState(BitReader& r, EconomySnapshot& s) {
    s.money = BitsFloat(r.U32()); s.bigSack = r.Bool();
    const size_t count = r.U8();
    if (count > kMaxEconomyEntries) return false;
    for (size_t i = 0; i < count && !r.Failed(); ++i) { const uint16_t index = static_cast<uint16_t>(r.U16()); const uint16_t quantity = static_cast<uint16_t>(r.U16()); s.items.push_back({index, quantity}); }
    return !r.Failed() && std::isfinite(s.money);
}
}

void Write(BitWriter& w, const EconomyReport& m) { w.U8(static_cast<uint32_t>(MessageType::Economy)); w.U16(m.seq); WriteState(w, m.state); }
void Write(BitWriter& w, const EconomySync& m) { w.U8(static_cast<uint32_t>(MessageType::EconomySync)); w.U16(m.ack); w.Bool(m.accepted); w.Bool(m.profile); WriteState(w, m.state); }
std::optional<EconomyReport> ReadEconomyReport(BitReader& r) {
    EconomyReport m; m.seq = static_cast<uint16_t>(r.U16());
    if (!ReadState(r, m.state)) return std::nullopt;
    return m;
}
std::optional<EconomySync> ReadEconomySync(BitReader& r) {
    EconomySync m; m.ack = static_cast<uint16_t>(r.U16()); m.accepted = r.Bool(); m.profile = r.Bool();
    if (!ReadState(r, m.state)) return std::nullopt;
    return m;
}

EconomySnapshot Canonical(EconomySnapshot state, size_t itemCount) {
    std::map<uint16_t, uint32_t> merged;
    for (const auto& [index, quantity] : state.items) if (index < itemCount && quantity > 0) merged[index] += quantity;
    state.items.clear();
    for (const auto& [index, quantity] : merged) state.items.push_back({index, static_cast<uint16_t>(std::min<uint32_t>(quantity, 65535u))});
    return state;
}

Ledger::Verdict Ledger::Submit(const EconomySnapshot& rawClaim, double nowSeconds) {
    Verdict verdict;
    EconomySnapshot claimed = Canonical(rawClaim, m_Data->items.size());
    if (!std::isfinite(claimed.money) || claimed.money < 0.0f || claimed.money > kMaxMoney) {
        claimed.money = std::isfinite(claimed.money) ? std::clamp(claimed.money, 0.0f, kMaxMoney) : 0.0f;
        if (m_Started) { verdict.reason = "plata fuera de rango"; verdict.authoritative = m_State; return verdict; }
    }
    if (!m_Started) {   // el primer informe de un perfil nuevo fija la copia, recortada a lo que se permite al empezar
        bool limited = false;
        if (claimed.money > m_Limits.startMoney) { claimed.money = m_Limits.startMoney; limited = true; }
        long units = 0;
        for (auto& [index, quantity] : claimed.items) {
            const long room = std::max<long>(0, m_Limits.startItems - units);
            if (quantity > room) { quantity = static_cast<uint16_t>(room); limited = true; }
            units += quantity;
        }
        claimed = Canonical(claimed, m_Data->items.size());
        m_Started = true; m_State = claimed; m_LastSeconds = nowSeconds;
        verdict.accepted = !limited; verdict.authoritative = m_State;
        if (limited) verdict.reason = "perfil nuevo limitado";
        return verdict;
    }
    const double elapsed = std::clamp(nowSeconds - m_LastSeconds, 0.0, 60.0);
    double lootTokens = std::min(12.0, m_LootTokens + elapsed);
    double earnTokens = std::min(8000.0, m_EarnTokens + elapsed * 100.0);
    const auto reject = [&](const char* why) { verdict.reason = why; verdict.authoritative = m_State; return verdict; };

    std::map<uint16_t, int> added, removed;   // diferencia por objeto frente a la copia del anfitrion
    {
        std::map<uint16_t, int> before, after;
        for (const auto& [index, quantity] : m_State.items) before[index] = quantity;
        for (const auto& [index, quantity] : claimed.items) after[index] = quantity;
        for (const auto& [index, quantity] : after) { const int delta = quantity - before[index]; if (delta > 0) added[index] = delta; }
        for (const auto& [index, quantity] : before) { const int delta = quantity - after[index]; if (delta > 0) removed[index] = delta; }
    }
    const auto itemIndexOf = [&](const std::string& id) -> int {
        for (size_t i = 0; i < m_Data->items.size(); ++i) if (m_Data->items[i].id == id) return static_cast<int>(i);
        return -1;
    };

    // 1) recetas: el resultado sube y los ingredientes bajan en el mismo cambio
    for (const Economy::RecipeDef& recipe : Economy::Recipes()) {
        const int result = itemIndexOf(recipe.id);
        if (result < 0) continue;
        for (;;) {
            if (added[static_cast<uint16_t>(result)] < recipe.quantity) break;
            bool affordable = true;
            for (const auto& [ingredient, need] : recipe.ingredients) {
                const int index = itemIndexOf(ingredient);
                if (index < 0 || removed[static_cast<uint16_t>(index)] < need) { affordable = false; break; }
            }
            if (!affordable) break;
            added[static_cast<uint16_t>(result)] -= recipe.quantity;
            for (const auto& [ingredient, need] : recipe.ingredients) removed[static_cast<uint16_t>(itemIndexOf(ingredient))] -= need;
        }
    }
    // 2) plata: lo que se quita del costal se vende; lo que no, son premios del mundo
    double removedValue = 0.0;
    for (const auto& [index, quantity] : removed) if (quantity > 0) removedValue += static_cast<double>(m_Data->items[index].value) * quantity;
    const double moneyDelta = static_cast<double>(claimed.money) - static_cast<double>(m_State.money);
    double spent = moneyDelta < 0.0 ? -moneyDelta : 0.0;
    const double gained = moneyDelta > 0.0 ? moneyDelta : 0.0;
    const double earnNeeded = std::max(0.0, gained - 2.5 * removedValue);
    // 3) la mejora del costal
    if (claimed.bigSack && !m_State.bigSack) {
        const auto upgrade = std::find_if(m_Data->shop.begin(), m_Data->shop.end(), [](const ShopEntry& entry) { return !entry.upgrade.empty(); });
        if (upgrade == m_Data->shop.end() || spent + 0.01 < upgrade->price) return reject("mejora sin pagar");
        spent -= upgrade->price;
    }
    // 4) compras: los objetos que suben se pagan al precio de la tienda con la plata que bajo
    for (auto& [index, quantity] : added) {
        if (quantity <= 0) continue;
        const std::string& id = m_Data->items[index].id;
        const auto entry = std::find_if(m_Data->shop.begin(), m_Data->shop.end(), [&](const ShopEntry& e) { return e.item == id && e.price > 0 && e.qty > 0; });
        if (entry == m_Data->shop.end()) continue;
        const double unit = static_cast<double>(entry->price) / entry->qty;
        const int affordable = static_cast<int>(std::floor((spent + 0.01) / unit));
        const int take = std::min(quantity, affordable);
        spent -= take * unit;
        quantity -= take;
    }
    // 5) el resto de objetos que suben es botin del mundo, con tope de ritmo
    int loot = 0;
    for (const auto& [index, quantity] : added) if (quantity > 0) loot += quantity;
    if (loot > lootTokens + 0.0001) return reject("demasiado botin muy rapido");
    if (earnNeeded > earnTokens + 0.0001) return reject("demasiada plata muy rapido");
    m_LootTokens = lootTokens - loot;
    m_EarnTokens = earnTokens - earnNeeded;
    m_LastSeconds = nowSeconds;
    m_State = claimed;
    verdict.accepted = true; verdict.authoritative = m_State;
    return verdict;
}

EconomySnapshot EconomyFromSave(const nlohmann::json& save, size_t itemCount) {
    EconomySnapshot state;
    if (!save.is_object()) return state;
    const auto money = save.find("money");
    if (money != save.end() && money->is_number()) state.money = std::clamp(money->get<float>(), 0.0f, kMaxMoney);
    state.bigSack = save.value("bigSack", false);
    const auto inventory = save.find("inventory");
    if (inventory != save.end() && inventory->is_array())
        for (const auto& entry : *inventory) {
            if (!entry.is_object() || !entry.value("item", nlohmann::json()).is_number_integer() || !entry.value("quantity", nlohmann::json()).is_number_integer()) continue;
            const long long item = entry["item"].get<long long>(), quantity = entry["quantity"].get<long long>();
            if (item >= 0 && static_cast<size_t>(item) < itemCount && quantity > 0) state.items.push_back({static_cast<uint16_t>(item), static_cast<uint16_t>(std::min<long long>(quantity, 65535))});
        }
    return Canonical(std::move(state), itemCount);
}

void ApplyEconomyToSave(nlohmann::json& save, const EconomySnapshot& state) {
    if (!save.is_object()) save = nlohmann::json::object();
    save["money"] = state.money;
    save["bigSack"] = state.bigSack;
    save["inventory"] = nlohmann::json::array();
    for (const auto& [index, quantity] : state.items) save["inventory"].push_back({{"item", index}, {"quantity", quantity}});
}

std::optional<EconomyReport> EconomyMirror::Poll(const EconomySnapshot& current, double nowSeconds) {
    if (m_Sent && (current == m_LastSent || nowSeconds - m_LastSentSeconds < 0.1)) return std::nullopt;
    m_Sent = true; m_LastSent = current; m_LastSentSeconds = nowSeconds; ++m_Seq;
    return EconomyReport{m_Seq, current};
}

std::optional<EconomySnapshot> EconomyMirror::OnSync(const EconomySync& sync, const EconomySnapshot& current) {
    if (sync.accepted || sync.ack != m_Seq || current != m_LastSent) return std::nullopt;
    return sync.state;
}

} // namespace Bazuko::Net
