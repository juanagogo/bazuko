#pragma once

#include <map>
#include <string>

#include "game/EventBus.h"
#include "game/data/GameData.h"
#include "game/systems/Clock.h"
#include "game/systems/CraftingSystem.h"
#include "game/systems/DiseaseSystem.h"
#include "game/systems/InventorySystem.h"
#include "game/systems/StatsSystem.h"
#include "game/systems/TalentSystem.h"

namespace bazuko {

// Todo el estado de simulación del jugador, sin nada de render ni SDL.
struct GameState {
    explicit GameState(const GameData& d)
        : data(d),
          clock(d.c("DAY_LENGTH_SECONDS")),
          diseases(d, &bus),
          talents(d, &bus),
          stats(d, &bus),
          inventory(d, d.c("INVENTORY_MAX_WEIGHT")),
          crafting(d, &bus) {
        stats.attach(&diseases, &talents);
    }
    GameState(const GameState&) = delete;
    GameState& operator=(const GameState&) = delete;

    const GameData& data;
    EventBus bus;
    Clock clock;
    DiseaseSystem diseases;
    TalentSystem talents;
    StatsSystem stats;
    InventorySystem inventory;
    CraftingSystem crafting;
    std::map<std::string, bool> built;  // piezas del cambuche
    bool costal = false;                // mejora de costal comprada

    // Peso máximo = base + bonus de talentos + costal. Se recalcula cuando cambian.
    void refreshMaxWeight() {
        inventory.maxWeight = data.c("INVENTORY_MAX_WEIGHT") + talents.getEffect("maxWeightBonus", 0) +
                              (costal ? data.costalBonus : 0);
    }
    bool hasBuilt(const std::string& piece) const {
        auto it = built.find(piece);
        return it != built.end() && it->second;
    }

    // Un paso de simulación (reloj, necesidades, enfermedades).
    void update(double dt) {
        clock.update(dt);
        refreshMaxWeight();
        stats.update(dt, clock.isNight());
        diseases.update(dt);
    }
};

}  // namespace bazuko
