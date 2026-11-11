// Economia: prueba DIFERENCIAL con los datos reales del juego. `Ref*` son copias literales de las lambdas que vivian en main() antes de
// extraerlas a game/Economy; cada operacion se aplica a dos jugadores (uno por la copia, otro por Economy) y deben quedar identicos bit a bit
// tras cientos de miles de operaciones aleatorias (agregar, vender, fabricar, comprar, consumir, soltar, experiencia, infeccion).
#include "game/Economy.hpp"
#include "game/Harvest.hpp"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <random>

using namespace Bazuko;

static int failures = 0;
#define CHECK(condition, message) do { \
    if (!(condition)) { ++failures; std::printf("FALLO (%d): %s\n", __LINE__, message); } \
} while (0)

namespace {

// ---------- copias literales del codigo anterior de main() ----------
struct RefPlayer {
    std::vector<InventoryEntry> inventory;
    float inventoryWeight = 0.0f, money = 0.0f, warmTimer = 0.0f;
    int xp = 0, level = 1, talentPoints = 0, itemsSold = 0;
    bool bigSack = false;
    std::array<float, 7> needs{100.0f, 100.0f, 100.0f, 100.0f, 100.0f, 100.0f, 80.0f};
    std::vector<DiseaseState> diseases;
    std::unordered_set<std::string> unlockedTalents;
};

bool AddLootById(RefPlayer& p, const GameData& gameData, const std::string& id) {
    const auto& lootTable = gameData.items;
    const auto inventoryCapacity = [&]() { return InventoryCapacity(gameData, p.unlockedTalents, p.bigSack); };
    const auto item = std::find_if(lootTable.begin(), lootTable.end(), [&](const ItemDef& entry) { return entry.id == id; });
    if (item == lootTable.end()) return false;
    const size_t itemIndex = static_cast<size_t>(item - lootTable.begin());
    if (p.inventoryWeight + item->weight > inventoryCapacity()) return false;
    auto entry = std::find_if(p.inventory.begin(), p.inventory.end(), [&](const InventoryEntry& value) { return value.itemIndex == itemIndex; });
    if (entry == p.inventory.end()) p.inventory.push_back({itemIndex, 1});
    else ++entry->quantity;
    p.inventoryWeight += item->weight;
    return true;
}

int RefAvailable(const RefPlayer& p, const GameData& gameData, const std::string& id) {
    const auto& lootTable = gameData.items;
    const auto item = std::find_if(lootTable.begin(), lootTable.end(), [&](const ItemDef& entry) { return entry.id == id; });
    if (item == lootTable.end() || item->weight <= 0.0f) return 0;
    return std::max(0, static_cast<int>(std::floor((InventoryCapacity(gameData, p.unlockedTalents, p.bigSack) - p.inventoryWeight + 0.0001f) / item->weight)));
}

Economy::SellResult RefSell(RefPlayer& p, const GameData& gameData, float saleMultiplier) {
    const auto& lootTable = gameData.items;
    int soldCount = 0;
    float earned = 0.0f;
    for (auto entry = p.inventory.begin(); entry != p.inventory.end();) {
        const ItemDef& item = lootTable[entry->itemIndex];
        if (!item.recyclable) { ++entry; continue; }
        earned += static_cast<float>(item.value * entry->quantity) * saleMultiplier;
        soldCount += entry->quantity;
        p.inventoryWeight -= item.weight * entry->quantity;
        entry = p.inventory.erase(entry);
    }
    if (soldCount == 0) return {};
    p.money += earned;
    p.itemsSold += soldCount;
    p.needs[5] = std::min(100.0f, p.needs[5] + 2.0f);
    return {soldCount, earned};
}

Economy::CraftOutcome RefCraft(RefPlayer& p, const GameData& gameData, const std::vector<Economy::RecipeDef>& recipes, const std::string& craftRequest) {
    const auto& lootTable = gameData.items;
    const auto inventoryCapacity = [&]() { return InventoryCapacity(gameData, p.unlockedTalents, p.bigSack); };
    auto countItem = [&](const std::string& id) {
        int quantity = 0;
        for (const auto& entry : p.inventory) if (lootTable[entry.itemIndex].id == id) quantity += entry.quantity;
        return quantity;
    };
    std::string resultId;
    std::vector<std::pair<std::string, int>> ingredients;
    int resultQuantity = 1;
    Economy::CraftOutcome outcome = Economy::CraftOutcome::Unknown;
    for (const Economy::RecipeDef& recipe : recipes) {
        if (recipe.id != craftRequest) continue;
        const auto resultItem = std::find_if(lootTable.begin(), lootTable.end(), [&](const ItemDef& item) { return item.id == recipe.id; });
        if (resultItem == lootTable.end()) break;
        bool hasMaterials = true;
        for (const auto& [id, quantity] : recipe.ingredients) hasMaterials = hasMaterials && countItem(id) >= quantity;
        if (hasMaterials && p.inventoryWeight + resultItem->weight * static_cast<float>(recipe.quantity) <= inventoryCapacity()) {
            resultId = recipe.id; ingredients = recipe.ingredients; resultQuantity = recipe.quantity;
        } else {
            outcome = hasMaterials ? Economy::CraftOutcome::NoRoom : Economy::CraftOutcome::MissingMaterials;
        }
        break;
    }
    if (!resultId.empty()) {
        for (const auto& [id, quantity] : ingredients) {
            for (int removed = 0; removed < quantity; ++removed) {
                auto entry = std::find_if(p.inventory.begin(), p.inventory.end(), [&](const InventoryEntry& item) { return lootTable[item.itemIndex].id == id; });
                if (entry != p.inventory.end()) {
                    p.inventoryWeight -= lootTable[entry->itemIndex].weight;
                    if (--entry->quantity == 0) p.inventory.erase(entry);
                }
            }
        }
        size_t resultIndex = static_cast<size_t>(std::find_if(lootTable.begin(), lootTable.end(), [&](const ItemDef& item) { return item.id == resultId; }) - lootTable.begin());
        auto result = std::find_if(p.inventory.begin(), p.inventory.end(), [&](const InventoryEntry& entry) { return entry.itemIndex == resultIndex; });
        if (result == p.inventory.end()) p.inventory.push_back({resultIndex, resultQuantity}); else result->quantity += resultQuantity;
        p.inventoryWeight += lootTable[resultIndex].weight * static_cast<float>(resultQuantity);
        outcome = Economy::CraftOutcome::Crafted;
    }
    return outcome;
}

Economy::PurchaseOutcome RefPurchase(RefPlayer& p, const GameData& gameData, const std::string& shopPurchase) {
    const auto inventoryCapacity = [&]() { return InventoryCapacity(gameData, p.unlockedTalents, p.bigSack); };
    const auto entry = std::find_if(gameData.shop.begin(), gameData.shop.end(), [&](const ShopEntry& candidate) {
        return candidate.item == shopPurchase || (!candidate.upgrade.empty() && candidate.upgrade == shopPurchase);
    });
    if (entry == gameData.shop.end()) return Economy::PurchaseOutcome::UnknownProduct;
    if (p.money < static_cast<float>(entry->price)) return Economy::PurchaseOutcome::NotEnoughMoney;
    if (!entry->upgrade.empty()) {
        if (!p.bigSack) { p.bigSack = true; p.money -= static_cast<float>(entry->price); return Economy::PurchaseOutcome::BoughtUpgrade; }
        return Economy::PurchaseOutcome::UpgradeAlreadyOwned;
    }
    const ItemDef* product = gameData.FindItem(entry->item);
    if (product == nullptr) return Economy::PurchaseOutcome::ProductMissing;
    if (p.inventoryWeight + product->weight * static_cast<float>(entry->qty) > inventoryCapacity()) return Economy::PurchaseOutcome::NoRoom;
    for (int unit = 0; unit < entry->qty; ++unit) AddLootById(p, gameData, product->id);
    p.money -= static_cast<float>(entry->price);
    return Economy::PurchaseOutcome::Bought;
}

Economy::EffectOutcome RefApply(RefPlayer& p, const ItemDef& item) {
    if (item.consumableNeed >= 0) {
        const size_t needIndex = static_cast<size_t>(item.consumableNeed);
        if (item.warmth > 0.0f) p.warmTimer = std::min(900.0f, p.warmTimer + item.warmth);
        p.needs[needIndex] = std::clamp(p.needs[needIndex] + item.amount, 0.0f, 100.0f);
        for (size_t need = 0; need < p.needs.size(); ++need) p.needs[need] = std::clamp(p.needs[need] + item.deltas[need], 0.0f, 100.0f);
        return Economy::EffectOutcome::Applied;
    }
    if (item.id == "vendaje" || item.id == "curita") { p.needs[3] = std::min(100.0f, p.needs[3] + (item.id == "curita" ? 15.0f : 30.0f)); return Economy::EffectOutcome::Applied; }
    if (!item.cure.empty()) {
        const size_t before = p.diseases.size();
        std::erase_if(p.diseases, [&](const DiseaseState& disease) { return disease.id == item.cure; });
        return p.diseases.size() == before ? Economy::EffectOutcome::NoSuchDisease : Economy::EffectOutcome::CuredDisease;
    }
    return Economy::EffectOutcome::NotApplicable;
}

int RefXp(RefPlayer& p, int amount, float activity, float talent) {
    p.xp += static_cast<int>(std::round(static_cast<float>(amount) * activity * talent));
    int levels = 0;
    while (p.xp >= 100 * p.level) { p.xp -= 100 * p.level; ++p.level; ++p.talentPoints; ++levels; }
    return levels;
}

int RefDrop(RefPlayer& p, const GameData& gameData, size_t dropIndex, bool all) {
    auto entry = std::find_if(p.inventory.begin(), p.inventory.end(), [&](const InventoryEntry& value) { return value.itemIndex == dropIndex; });
    if (entry == p.inventory.end()) return 0;
    const int dropped = all ? entry->quantity : 1;
    p.inventoryWeight = std::max(0.0f, p.inventoryWeight - gameData.items[dropIndex].weight * static_cast<float>(dropped));
    entry->quantity -= dropped;
    if (entry->quantity <= 0) p.inventory.erase(entry);
    return dropped;
}

std::string RefInfect(RefPlayer& p, std::mt19937& lootRandom, bool sortedBag, float resistance) {
    float chance = InfectionChance(sortedBag, resistance) * (p.needs[4] < 30.0f ? 1.5f : 1.0f);
    if (std::uniform_real_distribution<float>(0.0f, 1.0f)(lootRandom) >= chance) return {};
    const std::array<DiseaseState, 3> types{{{"gripe", 45.0f, 0.12f, 0.01f}, {"infeccion", 54.0f, 0.216f, 0.02f}, {"intoxicacion", 36.0f, 0.096f, 0.03f}}};
    const DiseaseState& type = types[static_cast<size_t>(std::uniform_int_distribution<int>(0, 2)(lootRandom))];
    if (std::none_of(p.diseases.begin(), p.diseases.end(), [&](const DiseaseState& disease) { return disease.id == type.id; })) { p.diseases.push_back(type); return type.id; }
    return {};
}

bool SameBits(float a, float b) { return std::memcmp(&a, &b, sizeof(float)) == 0; }
bool Same(const RefPlayer& r, const PlayerSession& s) {
    if (r.inventory.size() != s.inventory.size()) return false;
    for (size_t i = 0; i < r.inventory.size(); ++i) if (r.inventory[i].itemIndex != s.inventory[i].itemIndex || r.inventory[i].quantity != s.inventory[i].quantity) return false;
    for (size_t i = 0; i < r.needs.size(); ++i) if (!SameBits(r.needs[i], s.needs[i])) return false;
    if (r.diseases.size() != s.diseases.size()) return false;
    for (size_t i = 0; i < r.diseases.size(); ++i) if (r.diseases[i].id != s.diseases[i].id) return false;
    return SameBits(r.inventoryWeight, s.inventoryWeight) && SameBits(r.money, s.money) && SameBits(r.warmTimer, s.warmTimer)
        && r.xp == s.xp && r.level == s.level && r.talentPoints == s.talentPoints && r.itemsSold == s.itemsSold && r.bigSack == s.bigSack;
}

} // namespace

int main() {
    std::string error;
    const auto loaded = GameData::LoadFromFile(BAZUKO_GAME_DATA_PATH, &error);
    if (!loaded) { std::printf("FALLO: no se cargaron los datos: %s\n", error.c_str()); return 1; }
    const GameData& data = *loaded;
    const auto& recipes = Economy::Recipes();
    CHECK(recipes.size() == 8, "las 8 recetas de la mesa");
    for (const auto& recipe : recipes) CHECK(data.FindItem(recipe.id) != nullptr, "cada receta produce un objeto que existe");

    // diferencial
    std::mt19937 random(31337);
    std::uniform_real_distribution<float> unit(0.0f, 1.0f);
    const std::array<std::string, 12> materials{"chatarra", "cable", "pilas", "madera", "botella", "lata", "carton", "pastilla", "vendaje", "curita", "antibiotico", "agua"};
    long operations = 0, sold = 0, crafted = 0, bought = 0, applied = 0, infected = 0, levelsGained = 0, dropsDone = 0;
    for (int run = 0; run < 300; ++run) {
        PlayerSession session;
        RefPlayer ref;
        session.needs = ref.needs = {80.0f, 70.0f, 60.0f, 90.0f, 25.0f + 60.0f * unit(random), 70.0f, 80.0f};
        session.money = ref.money = 200000.0f * unit(random);
        std::mt19937 lootA(run + 7), lootB(run + 7);
        const float saleMultiplier = unit(random) < 0.5f ? 1.0f : 1.2f * 1.15f;
        for (int step = 0; step < 1000; ++step) {
            const int op = static_cast<int>(unit(random) * 11.99f);
            ++operations;
            bool ok = true;
            switch (op) {
                case 0: case 1: case 2: {   // agregar un objeto cualquiera del juego
                    const std::string& id = unit(random) < 0.6f ? materials[static_cast<size_t>(unit(random) * 11.99f)] : data.items[static_cast<size_t>(unit(random) * (data.items.size() - 0.01f))].id;
                    ok = Economy::AddItem(session, data, id) == AddLootById(ref, data, id);
                    ok = ok && Economy::AvailableCount(session, data, id) == RefAvailable(ref, data, id);
                    break;
                }
                case 3: {
                    const auto mine = Economy::SellRecyclables(session, data, saleMultiplier);
                    const auto old = RefSell(ref, data, saleMultiplier);
                    ok = mine.soldCount == old.soldCount && SameBits(mine.earned, old.earned);
                    sold += mine.soldCount > 0;
                    break;
                }
                case 4: case 5: {
                    const std::string& id = recipes[static_cast<size_t>(unit(random) * 7.99f)].id;
                    const auto mine = Economy::Craft(session, data, recipes, id);
                    const auto old = RefCraft(ref, data, recipes, id);
                    ok = mine.outcome == old;
                    crafted += mine.outcome == Economy::CraftOutcome::Crafted;
                    break;
                }
                case 6: case 7: {
                    const ShopEntry& entry = data.shop[static_cast<size_t>(unit(random) * (data.shop.size() - 0.01f))];
                    const std::string& request = entry.upgrade.empty() ? entry.item : entry.upgrade;
                    const std::string& bad = unit(random) < 0.05f ? std::string("producto_que_no_existe") : request;
                    const auto mine = Economy::Purchase(session, data, bad);
                    ok = mine.outcome == RefPurchase(ref, data, bad);
                    bought += mine.outcome == Economy::PurchaseOutcome::Bought || mine.outcome == Economy::PurchaseOutcome::BoughtUpgrade;
                    break;
                }
                case 8: {   // consumir (sin quitarlo del inventario: eso lo hace main)
                    const ItemDef& item = data.items[static_cast<size_t>(unit(random) * (data.items.size() - 0.01f))];
                    if (unit(random) < 0.3f) { session.diseases.push_back({"gripe", 40.0f, 0.1f, 0.0f}); ref.diseases.push_back({"gripe", 40.0f, 0.1f, 0.0f}); }
                    const auto mine = Economy::ApplyItemEffect(session, item);
                    ok = mine == RefApply(ref, item);
                    applied += mine != Economy::EffectOutcome::NotApplicable;
                    break;
                }
                case 9: {
                    const int amount = static_cast<int>(unit(random) * 40.0f);
                    const float activity = unit(random) < 0.5f ? 1.0f : 1.5f, talent = unit(random) < 0.5f ? 1.0f : 1.25f;
                    const int mine = Economy::AwardXp(session, amount, activity, talent);
                    ok = mine == RefXp(ref, amount, activity, talent);
                    levelsGained += mine;
                    break;
                }
                case 10: {
                    const size_t index = static_cast<size_t>(unit(random) * (data.items.size() - 0.01f));
                    const bool all = unit(random) < 0.5f;
                    const int mine = Economy::DropItem(session, data, index, all);
                    ok = mine == RefDrop(ref, data, index, all);
                    dropsDone += mine > 0;
                    break;
                }
                default: {
                    const bool sortedBag = unit(random) < 0.5f;
                    const float resistance = 0.6f + 0.4f * unit(random);
                    const std::string mine = Economy::TryInfectFromPickup(session, lootA, sortedBag, resistance);
                    ok = mine == RefInfect(ref, lootB, sortedBag, resistance);
                    infected += !mine.empty();
                    break;
                }
            }
            if (!ok || !Same(ref, session)) {
                std::printf("DIVERGE en la corrida %d, paso %d, operacion %d\n", run, step, op);
                ++failures;
                run = 300; break;
            }
            if (step % 250 == 0) { session.talentPoints = ref.talentPoints; }
            if (step % 400 == 0 && unit(random) < 0.5f) { session.unlockedTalents.insert("collector2"); ref.unlockedTalents.insert("collector2"); }
        }
    }
    std::printf("Diferencial: %ld operaciones identicas (vendidas %ld, fabricadas %ld, compras %ld, consumos %ld, niveles %ld, infecciones %ld, soltadas %ld)\n",
                operations, sold, crafted, bought, applied, levelsGained, infected, dropsDone);
    CHECK(operations == 300L * 1000L, "no se completaron todas las operaciones");
    CHECK(sold > 100 && crafted > 100 && bought > 500 && applied > 100 && levelsGained > 50 && dropsDone > 100, "la prueba no cubrio todos los casos");

    if (failures == 0) std::printf("Economia: todo correcto\n");
    return failures == 0 ? 0 : 1;
}
