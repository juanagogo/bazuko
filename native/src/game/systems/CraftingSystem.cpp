#include "game/systems/CraftingSystem.h"

namespace bazuko {

bool CraftingSystem::canCraft(const Recipe& recipe, const InventorySystem& inv) const {
    for (const auto& [id, qty] : recipe.ingredients)
        if (inv.count(id) < qty) return false;
    return true;
}

bool CraftingSystem::craft(const Recipe& recipe, InventorySystem& inv) const {
    if (!canCraft(recipe, inv)) return false;
    const ItemDef* result = data_.item(recipe.result);
    if (!result) return false;

    double freed = 0;
    for (const auto& [id, qty] : recipe.ingredients) freed += data_.item(id)->weight * qty;
    if (inv.totalWeight() - freed + result->weight * recipe.qty > inv.maxWeight) return false;

    for (const auto& [id, qty] : recipe.ingredients) inv.remove(id, qty);
    inv.add(recipe.result, recipe.qty);
    if (bus_) bus_->emit(EvCraft{result->name, recipe.qty});
    return true;
}

}  // namespace bazuko
