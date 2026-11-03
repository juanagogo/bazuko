#include "game/Places.h"

#include <cmath>
#include <sstream>

namespace bazuko {

int recyclerTotal(const GameState& s, double mult) {
    double total = 0;
    for (const ItemStack& st : s.inventory.items()) {
        const ItemDef* it = s.data.item(st.id);
        if (it && it->recyclable()) total += it->value * st.qty * mult;
    }
    return static_cast<int>(std::lround(total));
}

int sellToRecycler(GameState& s, double mult) {
    const int total = recyclerTotal(s, mult);
    if (total <= 0) return 0;
    const auto snapshot = s.inventory.items();
    for (const ItemStack& st : snapshot)
        if (s.data.item(st.id)->recyclable()) s.inventory.remove(st.id, st.qty);
    s.stats.dinero += total;
    s.stats.addXP(s.data.c("XP_SELL"));
    s.bus.emit(EvSound{"sell"});
    s.bus.emit(EvSell{total});
    return total;
}

ShopStatus canBuy(const GameState& s, const ShopEntry& entry) {
    const bool upgrade = !entry.upgrade.empty();
    if (upgrade && s.costal) return ShopStatus::AlreadyOwned;
    if (!upgrade) {
        const ItemDef* it = s.data.item(entry.item);
        if (!it) return ShopStatus::NotSold;
        if (s.inventory.totalWeight() + it->weight * entry.qty > s.inventory.maxWeight) return ShopStatus::TooHeavy;
    }
    if (s.stats.dinero < entry.price) return ShopStatus::NotEnoughMoney;
    return ShopStatus::Ok;
}

ShopStatus buy(GameState& s, const ShopEntry& entry) {
    const ShopStatus st = canBuy(s, entry);
    if (st != ShopStatus::Ok) return st;
    s.stats.dinero -= entry.price;
    std::string name;
    if (!entry.upgrade.empty()) {
        s.costal = true;
        s.refreshMaxWeight();
        name = entry.label;
    } else {
        s.inventory.add(entry.item, entry.qty);
        name = entry.label.empty() ? s.data.item(entry.item)->name : entry.label;
    }
    s.bus.emit(EvSound{"pickup"});
    s.bus.emit(EvToast{"🛒 Compraste " + name, "info"});
    return ShopStatus::Ok;
}

std::string describeItem(const ItemDef& it) {
    if (it.cure) return "Cura: " + *it.cure + ".";
    static const std::pair<const char*, const char*> names[] = {{"hambre", "hambre"}, {"sed", "sed"}, {"energia", "energía"},
                                                                {"salud", "salud"}, {"higiene", "higiene"}, {"animo", "ánimo"},
                                                                {"vicio", "vicio"}};
    std::vector<std::string> parts;
    auto fmt = [](double v) {
        std::ostringstream o;
        o << (v > 0 ? "+" : "") << v;
        return o.str();
    };
    if (it.consumable) {
        for (auto& [key, label] : names)
            if (*it.consumable == key) parts.push_back(fmt(it.amount) + " " + label);
    }
    auto extra = [&](const std::string& key, const char* label, double v) {
        if (v != 0 && (!it.consumable || *it.consumable != key)) parts.push_back(fmt(v) + " " + label);
    };
    extra("energia", "energía", it.energia);
    extra("salud", "salud", it.salud);
    extra("animo", "ánimo", it.animo);
    std::string out;
    for (size_t i = 0; i < parts.size(); ++i) out += (i ? " · " : "") + parts[i];
    return out;
}

BuildStatus canBuild(const GameState& s, const CambuchePiece& piece) {
    if (s.hasBuilt(piece.id)) return BuildStatus::AlreadyBuilt;
    if (!piece.needs.empty() && !s.hasBuilt(piece.needs)) return BuildStatus::NeedsBase;
    for (const auto& [id, qty] : piece.req)
        if (s.inventory.count(id) < qty) return BuildStatus::MissingMaterials;
    return BuildStatus::Ok;
}

BuildStatus build(GameState& s, const CambuchePiece& piece) {
    const BuildStatus st = canBuild(s, piece);
    if (st != BuildStatus::Ok) return st;
    for (const auto& [id, qty] : piece.req) s.inventory.remove(id, qty);
    s.built[piece.id] = true;
    s.bus.emit(EvSound{"treasure"});
    s.bus.emit(EvToast{"🔨 Armaste: " + piece.name, "rare"});
    return BuildStatus::Ok;
}

bool craftRecipe(GameState& s, const Recipe& recipe) {
    if (!s.crafting.craft(recipe, s.inventory)) return false;
    s.stats.addXP(s.data.c("XP_CRAFT"));
    return true;
}

}  // namespace bazuko
