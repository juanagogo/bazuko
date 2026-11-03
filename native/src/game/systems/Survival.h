#pragma once

#include <string>

#include "core/Rng.h"
#include "game/GameState.h"

namespace bazuko {

struct SleepResult {
    bool ok = false;
    std::string failReason;  // "nobase"
    double hours = 0;
    bool robbed = false;
    int moneyLost = 0;
};

// Dormir en el cambuche (requiere la base). De noche hasta las 6:00; de día, siesta de 3 h.
// Emite EvSleepStart / EvSleepFail / EvToast; el EvSleepEnd lo emite la app al terminar la animación.
SleepResult sleep(GameState& s, Rng& rng);

bool isDead(const GameState& s);
// Tras morir: pierde la mitad de los tipos de objeto, necesidades >= 60 y sin enfermedades.
// Reubicar al jugador en el cambuche es responsabilidad del mundo.
void respawn(GameState& s);

// Consume un objeto del inventario (comida/medicina). false si no existe o no se puede usar.
bool useItem(GameState& s, const std::string& itemId);

}  // namespace bazuko
