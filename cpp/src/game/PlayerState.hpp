#pragma once

#include "GameData.hpp"

#include <algorithm>
#include <cstddef>
#include <nlohmann/json.hpp>

namespace Bazuko {

struct InventoryEntry {
    std::size_t itemIndex;
    int quantity;
};

struct InventoryState {
    std::vector<InventoryEntry> entries;
    float weight = 0.0f;
};

// Carga y juego deben aplicar las mismas mejoras de capacidad.
inline float InventoryCapacity(const GameData& data,
                               const std::unordered_set<std::string>& talents, bool bigSack) {
    return 20.0f + data.TalentEffect(talents, "maxWeightBonus", 0.0f)
        + (bigSack ? data.costalBonus : 0.0f);
}

inline InventoryState RestoreInventory(const nlohmann::json& savedEntries, const GameData& data,
                                       const std::unordered_set<std::string>& talents, bool bigSack) {
    InventoryState inventory;
    const float capacity = InventoryCapacity(data, talents, bigSack);
    for (const auto& entry : savedEntries) {
        const std::size_t itemIndex = entry.value("item", data.items.size());
        const int quantity = entry.value("quantity", 0);
        if (itemIndex < data.items.size() && quantity > 0
            && inventory.weight + data.items[itemIndex].weight * quantity <= capacity) {
            inventory.entries.push_back({itemIndex, quantity});
            inventory.weight += data.items[itemIndex].weight * quantity;
        }
    }
    return inventory;
}

inline void ApplyHealthRegeneration(std::array<float, kNeedCount>& needs,
                                    float withdrawal, float healthDrain, float dt) {
    // Llegar a cero requiere recuperacion explicita, incluso mientras termina el ragdoll.
    if (needs[3] > 0.0f && needs[0] > 50.0f && needs[1] > 50.0f && needs[2] > 50.0f
        && needs[4] > 40.0f && needs[5] > 40.0f && withdrawal <= 0.0f
        && healthDrain == 0.0f) {
        needs[3] = std::min(100.0f, needs[3] + 0.5f * dt);
    }
}

} // namespace Bazuko
