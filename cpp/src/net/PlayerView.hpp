#pragma once
// Tipos de datos del multijugador que la simulacion usara cuando deje de asumir un solo jugador (hito 1 del plan):
// `PlayerView` es lo que el mundo necesita saber de cada jugador (no su inventario ni su interfaz), y `GameEvent` es un hecho del juego
// (robo de espejo, claxon, golpe...) que el audio, los efectos y la red escuchan sin que la logica los llame directamente.
// Solo datos: sin glm, sin renderer, sin red.
#include <cstdint>
#include <cmath>
#include <vector>

namespace Bazuko::Net {

struct Vec3 { float x = 0.0f, y = 0.0f, z = 0.0f; };

inline float Distance2D(const Vec3& a, const Vec3& b) { return std::hypot(a.x - b.x, a.z - b.z); }

struct PlayerView {
    uint8_t id = 0;
    Vec3 position;
    Vec3 velocity;
    float yaw = 0.0f;
    bool inVehicle = false;
    bool alive = true;
    uint8_t wanted = 0;        // steal.buscado, 0 a 3: lo que mira la policia
    bool onViaduct = false;    // capa de movimiento
};

// Elige el jugador mas cercano a un punto (aves, ratas, peatones asustados, trafico que frena); devuelve nullptr si no hay.
inline const PlayerView* NearestPlayer(const std::vector<PlayerView>& players, const Vec3& at, float maxDistance = 1.0e9f) {
    const PlayerView* best = nullptr;
    float bestDistance = maxDistance;
    for (const PlayerView& player : players) {
        if (!player.alive) continue;
        const float distance = Distance2D(player.position, at);
        if (distance <= bestDistance) { bestDistance = distance; best = &player; }
    }
    return best;
}

enum class GameEventType : uint8_t {
    MirrorStolen, Honk, HitTaken, HitDealt, Shout, SubstanceConsumed, SleepStart, SleepEnd, Arrested, Died, Respawned,
    PurchaseMade, ItemPickedUp, VehicleEntered, VehicleExited, Crash, Alarm
};

struct GameEvent {
    GameEventType type = GameEventType::Honk;
    uint8_t player = 0;        // quien lo provoca (0 = el mundo)
    Vec3 position;
    float value = 0.0f;        // intensidad, dano, cantidad segun el tipo
    uint32_t tick = 0;
};

} // namespace Bazuko::Net
