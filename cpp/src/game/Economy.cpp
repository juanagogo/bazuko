#include "Economy.hpp"

#include "Harvest.hpp"

#include <algorithm>
#include <array>
#include <cmath>

namespace Bazuko::Economy {

// Las formulas y el orden son los de las lambdas originales de main(); no se "limpia" nada.

const std::vector<RecipeDef>& Recipes() {
    static const std::vector<RecipeDef> recipes{
        {"radioTransistor", 1, {{"chatarra", 1}, {"cable", 2}, {"pilas", 1}}},
        {"arma", 1, {{"chatarra", 2}, {"cable", 1}, {"madera", 1}}},
        {"cuchillo", 1, {{"chatarra", 1}, {"madera", 1}}},
        {"botella_picada", 1, {{"botella", 1}, {"lata", 1}}},
        {"curita", 2, {{"botella", 1}, {"carton", 1}}},
        {"antibiotico", 1, {{"pastilla", 1}, {"botella", 1}}},
        {"rifa", 1, {{"carton", 2}, {"lata", 1}}},
        {"hierba", 2, {{"carton", 1}, {"madera", 1}}},
    };
    return recipes;
}

float Capacity(const PlayerSession& s, const GameData& data) {
    return InventoryCapacity(data, s.unlockedTalents, s.bigSack, s.cartAttached);
}

int CountItem(const PlayerSession& s, const GameData& data, const std::string& id) {
    int count = 0;
    for (const auto& entry : s.inventory) if (data.items[entry.itemIndex].id == id) count += entry.quantity;
    return count;
}

int AvailableCount(const PlayerSession& s, const GameData& data, const std::string& id) {
    const auto item = std::find_if(data.items.begin(), data.items.end(), [&](const ItemDef& entry) { return entry.id == id; });
    if (item == data.items.end() || item->weight <= 0.0f) return 0;
    return std::max(0, static_cast<int>(std::floor((Capacity(s, data) - s.inventoryWeight + 0.0001f) / item->weight)));
}

bool AddItem(PlayerSession& s, const GameData& data, const std::string& id) {
    const auto item = std::find_if(data.items.begin(), data.items.end(), [&](const ItemDef& entry) { return entry.id == id; });
    if (item == data.items.end()) return false;
    const size_t itemIndex = static_cast<size_t>(item - data.items.begin());
    if (s.inventoryWeight + item->weight > Capacity(s, data)) return false;
    auto entry = std::find_if(s.inventory.begin(), s.inventory.end(), [&](const InventoryEntry& value) { return value.itemIndex == itemIndex; });
    if (entry == s.inventory.end()) s.inventory.push_back({itemIndex, 1});
    else ++entry->quantity;
    s.inventoryWeight += item->weight;
    return true;
}

SellResult SellRecyclables(PlayerSession& s, const GameData& data, float saleMultiplier) {
    SellResult result;
    for (auto entry = s.inventory.begin(); entry != s.inventory.end();) {
        const ItemDef& item = data.items[entry->itemIndex];
        if (!item.recyclable) {
            ++entry;
            continue;
        }
        result.earned += static_cast<float>(item.value * entry->quantity) * saleMultiplier;
        result.soldCount += entry->quantity;
        s.inventoryWeight -= item.weight * entry->quantity;
        entry = s.inventory.erase(entry);
    }
    if (result.soldCount == 0) return result;
    s.money += result.earned;
    s.itemsSold += result.soldCount;
    s.needs[5] = std::min(100.0f, s.needs[5] + 2.0f);
    return result;
}

CraftResult Craft(PlayerSession& s, const GameData& data, const std::vector<RecipeDef>& recipes, const std::string& craftRequest) {
    CraftResult result;
    const auto& lootTable = data.items;
    std::string resultId;
    std::vector<std::pair<std::string, int>> ingredients;
    int resultQuantity = 1;
    for (const RecipeDef& recipe : recipes) {
        if (recipe.id != craftRequest) continue;
        const auto resultItem = std::find_if(lootTable.begin(), lootTable.end(), [&](const ItemDef& item) { return item.id == recipe.id; });
        if (resultItem == lootTable.end()) break;
        bool hasMaterials = true;
        for (const auto& [id, quantity] : recipe.ingredients) hasMaterials = hasMaterials && CountItem(s, data, id) >= quantity;
        if (hasMaterials && s.inventoryWeight + resultItem->weight * static_cast<float>(recipe.quantity) <= Capacity(s, data)) {
            resultId = recipe.id;
            ingredients = recipe.ingredients;
            resultQuantity = recipe.quantity;
        } else {
            result.outcome = hasMaterials ? CraftOutcome::NoRoom : CraftOutcome::MissingMaterials;   // el original solo suena «lleno» en los dos casos
        }
        break;
    }
    if (resultId.empty()) return result;
    for (const auto& [id, quantity] : ingredients) {
        for (int removed = 0; removed < quantity; ++removed) {
            auto entry = std::find_if(s.inventory.begin(), s.inventory.end(), [&](const InventoryEntry& item) { return lootTable[item.itemIndex].id == id; });
            if (entry != s.inventory.end()) {
                s.inventoryWeight -= lootTable[entry->itemIndex].weight;
                if (--entry->quantity == 0) s.inventory.erase(entry);
            }
        }
    }
    const size_t resultIndex = static_cast<size_t>(std::find_if(lootTable.begin(), lootTable.end(), [&](const ItemDef& item) { return item.id == resultId; }) - lootTable.begin());
    auto stack = std::find_if(s.inventory.begin(), s.inventory.end(), [&](const InventoryEntry& entry) { return entry.itemIndex == resultIndex; });
    if (stack == s.inventory.end()) s.inventory.push_back({resultIndex, resultQuantity}); else stack->quantity += resultQuantity;
    s.inventoryWeight += lootTable[resultIndex].weight * static_cast<float>(resultQuantity);
    result.outcome = CraftOutcome::Crafted;
    result.resultName = lootTable[resultIndex].name;
    result.quantity = resultQuantity;
    return result;
}

PurchaseResult Purchase(PlayerSession& s, const GameData& data, const std::string& shopPurchase) {
    PurchaseResult result;
    const auto entry = std::find_if(data.shop.begin(), data.shop.end(), [&](const ShopEntry& candidate) {
        return candidate.item == shopPurchase || (!candidate.upgrade.empty() && candidate.upgrade == shopPurchase);
    });
    if (entry == data.shop.end()) { result.outcome = PurchaseOutcome::UnknownProduct; return result; }
    result.label = entry->label;
    if (s.money < static_cast<float>(entry->price)) { result.outcome = PurchaseOutcome::NotEnoughMoney; return result; }
    if (!entry->upgrade.empty()) {
        if (!s.bigSack) {
            s.bigSack = true;
            s.money -= static_cast<float>(entry->price);
            result.outcome = PurchaseOutcome::BoughtUpgrade;
        } else {
            result.outcome = PurchaseOutcome::UpgradeAlreadyOwned;
        }
        return result;
    }
    const ItemDef* product = data.FindItem(entry->item);
    if (product == nullptr) { result.outcome = PurchaseOutcome::ProductMissing; return result; }
    result.label = entry->label.empty() ? product->name : entry->label;
    if (s.inventoryWeight + product->weight * static_cast<float>(entry->qty) > Capacity(s, data)) {
        result.outcome = PurchaseOutcome::NoRoom;
        result.label = product->name;   // el aviso de «no cabe» nombra el producto, no la etiqueta
        return result;
    }
    for (int unit = 0; unit < entry->qty; ++unit) AddItem(s, data, product->id);
    s.money -= static_cast<float>(entry->price);
    result.outcome = PurchaseOutcome::Bought;
    return result;
}

EffectOutcome ApplyItemEffect(PlayerSession& s, const ItemDef& item) {
    if (item.consumableNeed >= 0) {
        const size_t needIndex = static_cast<size_t>(item.consumableNeed);
        if (item.warmth > 0.0f) s.warmTimer = std::min(900.0f, s.warmTimer + item.warmth);
        s.needs[needIndex] = std::clamp(s.needs[needIndex] + item.amount, 0.0f, 100.0f);
        for (size_t need = 0; need < s.needs.size(); ++need)
            s.needs[need] = std::clamp(s.needs[need] + item.deltas[need], 0.0f, 100.0f);
        return EffectOutcome::Applied;
    }
    if (item.id == "vendaje" || item.id == "curita") {
        s.needs[3] = std::min(100.0f, s.needs[3] + (item.id == "curita" ? 15.0f : 30.0f));
        return EffectOutcome::Applied;
    }
    if (!item.cure.empty()) {
        const size_t before = s.diseases.size();
        std::erase_if(s.diseases, [&](const DiseaseState& disease) { return disease.id == item.cure; });
        return s.diseases.size() == before ? EffectOutcome::NoSuchDisease : EffectOutcome::CuredDisease;
    }
    return EffectOutcome::NotApplicable;
}

int AwardXp(PlayerSession& s, int amount, float activityMultiplier, float talentMultiplier) {
    s.xp += static_cast<int>(std::round(static_cast<float>(amount) * activityMultiplier * talentMultiplier));
    int levels = 0;
    while (s.xp >= 100 * s.level) {
        s.xp -= 100 * s.level;
        ++s.level;
        ++s.talentPoints;
        ++levels;
    }
    return levels;
}

int DropItem(PlayerSession& s, const GameData& data, size_t dropIndex, bool all) {
    auto entry = std::find_if(s.inventory.begin(), s.inventory.end(), [&](const InventoryEntry& value) { return value.itemIndex == dropIndex; });
    if (entry == s.inventory.end()) return 0;
    const int dropped = all ? entry->quantity : 1;
    s.inventoryWeight = std::max(0.0f, s.inventoryWeight - data.items[dropIndex].weight * static_cast<float>(dropped));
    entry->quantity -= dropped;
    if (entry->quantity <= 0) s.inventory.erase(entry);
    return dropped;
}

std::string TryInfectFromPickup(PlayerSession& s, std::mt19937& lootRandom, bool sortedBag, float resistance) {
    float chance = InfectionChance(sortedBag, resistance) * (s.needs[4] < 30.0f ? 1.5f : 1.0f);
    if (std::uniform_real_distribution<float>(0.0f, 1.0f)(lootRandom) >= chance) return {};

    const std::array<DiseaseState, 3> types{{
        {"gripe", 45.0f, 0.12f, 0.01f},
        {"infeccion", 54.0f, 0.216f, 0.02f},
        {"intoxicacion", 36.0f, 0.096f, 0.03f}
    }};
    const DiseaseState& type = types[static_cast<size_t>(std::uniform_int_distribution<int>(0, 2)(lootRandom))];
    if (std::none_of(s.diseases.begin(), s.diseases.end(), [&](const DiseaseState& disease) { return disease.id == type.id; })) {
        s.diseases.push_back(type);
        return type.id;
    }
    return {};
}

} // namespace Bazuko::Economy
