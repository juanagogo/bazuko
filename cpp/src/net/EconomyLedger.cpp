#include "EconomyLedger.hpp"

#include "game/Economy.hpp"

#include <algorithm>
#include <cmath>
#include <cstring>
#include <map>

namespace Bazuko::Net {

namespace {
constexpr size_t kMaxTalents = 40;
uint32_t FloatBits(float value) { uint32_t bits; std::memcpy(&bits, &value, sizeof bits); return bits; }
float BitsFloat(uint32_t bits) { float value; std::memcpy(&value, &bits, sizeof value); return value; }

void WriteState(BitWriter& w, const EconomySnapshot& s) {
    w.U32(FloatBits(s.money)); w.Bool(s.bigSack);
    const size_t count = std::min(s.items.size(), kMaxEconomyEntries);
    w.U8(static_cast<uint32_t>(count));
    for (size_t i = 0; i < count; ++i) { w.U16(s.items[i].first); w.U16(s.items[i].second); }
    w.U32(static_cast<uint32_t>(std::clamp(s.xp, 0, 100000000))); w.U8(static_cast<uint32_t>(std::clamp(s.level, 1, 100))); w.U8(static_cast<uint32_t>(std::clamp(s.talentPoints, 0, 255)));
    const size_t talents = std::min<size_t>(s.talents.size(), kMaxTalents);
    w.U8(static_cast<uint32_t>(talents));
    for (size_t i = 0; i < talents; ++i) w.String(s.talents[i], 32);
    for (uint8_t need : s.needs) w.U8(std::min<uint8_t>(need, 100));
}
bool ReadState(BitReader& r, EconomySnapshot& s) {
    s.money = BitsFloat(r.U32()); s.bigSack = r.Bool();
    const size_t count = r.U8();
    if (count > kMaxEconomyEntries) return false;
    for (size_t i = 0; i < count && !r.Failed(); ++i) { const uint16_t index = static_cast<uint16_t>(r.U16()); const uint16_t quantity = static_cast<uint16_t>(r.U16()); s.items.push_back({index, quantity}); }
    s.xp = static_cast<int>(std::min<uint32_t>(r.U32(), 100000000u)); s.level = static_cast<int>(r.U8()); s.talentPoints = static_cast<int>(r.U8());
    const size_t talents = r.U8();
    if (talents > kMaxTalents) return false;
    for (size_t i = 0; i < talents && !r.Failed(); ++i) s.talents.push_back(r.String(32));
    for (uint8_t& need : s.needs) need = static_cast<uint8_t>(std::min<uint32_t>(r.U8(), 100u));
    return !r.Failed() && std::isfinite(s.money) && s.level >= 1 && s.level <= 100;
}
}

void Write(BitWriter& w, const EconomyReport& m) { w.U8(static_cast<uint32_t>(MessageType::Economy)); w.U16(m.seq); WriteState(w, m.state); }
void Write(BitWriter& w, const EconomySync& m) { w.U8(static_cast<uint32_t>(MessageType::EconomySync)); w.U16(m.ack); w.Bool(m.accepted); w.Bool(m.profile); WriteState(w, m.state); }
void Write(BitWriter& w, const Roster& m) {
    w.U8(static_cast<uint32_t>(MessageType::Roster)); w.U16(m.port);
    const size_t count = std::min<size_t>(m.entries.size(), kMaxPlayers);
    w.U8(static_cast<uint32_t>(count));
    for (size_t i = 0; i < count; ++i) { w.U8(m.entries[i].id); w.String(m.entries[i].ip, 45); }
}
void Write(BitWriter& w, const Checkpoint& m) {
    w.U8(static_cast<uint32_t>(MessageType::Checkpoint));
    const size_t count = std::min<size_t>(m.entries.size(), kMaxPlayers);
    w.U8(static_cast<uint32_t>(count));
    for (size_t i = 0; i < count; ++i) { w.String(m.entries[i].key, 32); WriteState(w, m.entries[i].state); }
}
std::optional<Roster> ReadRoster(BitReader& r) {
    Roster m; m.port = static_cast<uint16_t>(r.U16());
    const size_t count = r.U8();
    if (count > kMaxPlayers) return std::nullopt;
    for (size_t i = 0; i < count && !r.Failed(); ++i) { RosterEntry e; e.id = static_cast<uint8_t>(r.U8()); e.ip = r.String(45); m.entries.push_back(std::move(e)); }
    if (r.Failed() || m.port == 0) return std::nullopt;
    return m;
}
std::optional<Checkpoint> ReadCheckpoint(BitReader& r) {
    Checkpoint m;
    const size_t count = r.U8();
    if (count > kMaxPlayers) return std::nullopt;
    for (size_t i = 0; i < count && !r.Failed(); ++i) {
        CheckpointEntry e; e.key = r.String(32);
        if (!ReadState(r, e.state)) return std::nullopt;
        m.entries.push_back(std::move(e));
    }
    if (r.Failed()) return std::nullopt;
    return m;
}

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
    state.level = std::clamp(state.level, 1, 100);
    state.xp = std::clamp(state.xp, 0, 100 * state.level - 1);
    state.talentPoints = std::clamp(state.talentPoints, 0, 255);
    std::sort(state.talents.begin(), state.talents.end());
    state.talents.erase(std::unique(state.talents.begin(), state.talents.end()), state.talents.end());
    if (state.talents.size() > kMaxTalents) state.talents.resize(kMaxTalents);
    return state;
}

// Talentos que existen, y lo gastado en talentos mas lo que sobra no pasa de un punto por nivel (menos el primero)
bool Ledger::ProgressPlausible(const EconomySnapshot& s) const {
    if (s.level < 1 || s.level > 100 || s.talentPoints < 0) return false;
    int spent = 0;
    for (const std::string& id : s.talents) {
        const TalentDef* talent = m_Data->FindTalent(id);
        if (!talent) return false;
        spent += talent->cost;
    }
    return spent + s.talentPoints <= s.level - 1;
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
        if (claimed.level > m_Limits.startLevel) {   // el nivel se gana en este anfitrion: entra al tope y los puntos de talento se reparten de nuevo
            claimed.level = m_Limits.startLevel; claimed.xp = 0; claimed.talents.clear(); claimed.talentPoints = m_Limits.startLevel - 1; limited = true;
        }
        claimed = Canonical(claimed, m_Data->items.size());
        if (!ProgressPlausible(claimed)) { claimed.level = 1; claimed.xp = 0; claimed.talents.clear(); claimed.talentPoints = 0; limited = true; }
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
    // 6) progreso: talentos que existen y que se pueden pagar con los niveles, y experiencia con tope de ritmo
    if (!ProgressPlausible(claimed)) return reject("talentos o nivel imposibles");
    const long long xpGain = TotalXp(claimed.level, claimed.xp) - TotalXp(m_State.level, m_State.xp);
    double xpTokens = std::min(1500.0, m_XpTokens + elapsed * 40.0);
    if (xpGain > xpTokens + 0.0001) return reject("demasiada experiencia muy rapido");
    if (xpGain > 0) xpTokens -= static_cast<double>(xpGain);
    if (loot > lootTokens + 0.0001) return reject("demasiado botin muy rapido");
    if (earnNeeded > earnTokens + 0.0001) return reject("demasiada plata muy rapido");
    m_LootTokens = lootTokens - loot;
    m_EarnTokens = earnTokens - earnNeeded;
    m_XpTokens = xpTokens;
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
    state.level = std::clamp(save.value("level", 1), 1, 100);
    state.xp = std::clamp(save.value("xp", 0), 0, 100000000);
    state.talentPoints = std::clamp(save.value("talentPoints", state.level - 1), 0, 255);
    if (save.contains("talents") && save["talents"].is_array())
        for (const auto& id : save["talents"]) if (id.is_string()) state.talents.push_back(id.get<std::string>());
    if (save.contains("needs") && save["needs"].is_array() && save["needs"].size() >= state.needs.size())
        for (size_t i = 0; i < state.needs.size(); ++i) if (save["needs"][i].is_number()) state.needs[i] = static_cast<uint8_t>(std::clamp(static_cast<int>(std::lround(save["needs"][i].get<double>())), 0, 100));
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
    save["level"] = state.level; save["xp"] = state.xp; save["talentPoints"] = state.talentPoints; save["talents"] = state.talents;
    save["needs"] = nlohmann::json::array();
    for (uint8_t need : state.needs) save["needs"].push_back(need);
    save["inventory"] = nlohmann::json::array();
    for (const auto& [index, quantity] : state.items) save["inventory"].push_back({{"item", index}, {"quantity", quantity}});
}

std::optional<EconomyReport> EconomyMirror::Poll(const EconomySnapshot& current, double nowSeconds) {
    if (m_Sent) {
        if (nowSeconds - m_LastSentSeconds < 0.1) return std::nullopt;
        int needsMoved = 0;
        for (size_t i = 0; i < current.needs.size(); ++i) needsMoved = std::max(needsMoved, std::abs(static_cast<int>(current.needs[i]) - static_cast<int>(m_LastSent.needs[i])));
        const bool heartbeat = nowSeconds - m_LastSentSeconds >= 10.0;   // las necesidades se ponen al dia aunque nada mas cambie
        if (SameForSync(current, m_LastSent) && needsMoved < 5 && !heartbeat) return std::nullopt;
    }
    m_Sent = true; m_LastSent = current; m_LastSentSeconds = nowSeconds; ++m_Seq;
    return EconomyReport{m_Seq, current};
}

std::optional<EconomySnapshot> EconomyMirror::OnSync(const EconomySync& sync, const EconomySnapshot& current) {
    if (sync.accepted || sync.ack != m_Seq || !SameForSync(current, m_LastSent)) return std::nullopt;
    return sync.state;
}

} // namespace Bazuko::Net
