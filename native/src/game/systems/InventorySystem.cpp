#include "game/systems/InventorySystem.h"

#include <algorithm>

namespace bazuko {

double InventorySystem::totalWeight() const {
    double w = 0;
    for (const auto& s : items_) w += data_.item(s.id)->weight * s.qty;
    return w;
}

int InventorySystem::itemCount() const {
    int n = 0;
    for (const auto& s : items_) n += s.qty;
    return n;
}

int InventorySystem::count(const std::string& id) const {
    for (const auto& s : items_)
        if (s.id == id) return s.qty;
    return 0;
}

bool InventorySystem::canAdd(const std::string& id, int qty) const {
    const ItemDef* def = data_.item(id);
    return def && qty > 0 && totalWeight() + def->weight * qty <= maxWeight;
}

bool InventorySystem::add(const std::string& id, int qty) {
    if (!canAdd(id, qty)) return false;
    for (auto& s : items_) {
        if (s.id == id) { s.qty += qty; return true; }
    }
    items_.push_back({id, qty});
    return true;
}

bool InventorySystem::remove(const std::string& id, int qty) {
    auto it = std::find_if(items_.begin(), items_.end(), [&](const ItemStack& s) { return s.id == id; });
    if (it == items_.end()) return false;
    it->qty -= qty;
    if (it->qty <= 0) items_.erase(it);
    return true;
}

int InventorySystem::restore(const std::vector<std::pair<std::string, int>>& saved) {
    items_.clear();
    int dropped = 0;
    for (const auto& [id, qty] : saved) {
        if (!data_.item(id) || qty <= 0) { ++dropped; continue; }
        items_.push_back({id, qty});
    }
    return dropped;
}

}  // namespace bazuko
