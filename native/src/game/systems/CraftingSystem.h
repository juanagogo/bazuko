#pragma once

#include "game/EventBus.h"
#include "game/data/GameData.h"
#include "game/systems/InventorySystem.h"

namespace bazuko {

class CraftingSystem {
public:
    CraftingSystem(const GameData& data, EventBus* bus = nullptr) : data_(data), bus_(bus) {}

    bool canCraft(const Recipe& recipe, const InventorySystem& inv) const;
    // Fabrica la receta. false si faltan ingredientes o el resultado no cabe.
    // El peso se comprueba descontando los ingredientes que se van a consumir.
    bool craft(const Recipe& recipe, InventorySystem& inv) const;

private:
    const GameData& data_;
    EventBus* bus_;
};

}  // namespace bazuko
