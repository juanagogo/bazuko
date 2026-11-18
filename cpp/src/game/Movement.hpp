#pragma once
// Movimiento del jugador: velocidad segun su estado y paso de fisica (inercia, colisiones, atropello, capas del viaducto y caida con ragdoll).
// Es la parte de main() que NO es entrada ni dibujo. La direccion deseada (teclas, camara) la calcula quien llama; el mundo se consulta
// mediante `World` (funciones), asi un servidor lo ejecuta con su propia ciudad y un cliente lo predice con la suya. tests/MovementTest.cpp
// compara cada paso con el codigo original de main().
#include "PlayerSession.hpp"

#include <functional>
#include <glm/glm.hpp>

namespace Bazuko::Movement {

struct SpeedInput {
    bool wantsRun = false;            // shift pulsado y sin pausa
    float withdrawal = 0.0f;          // 0 a 100, de needs[6]
    bool highWithdrawal = false;      // >= 50
    bool criticalWithdrawal = false;  // >= 80
};

struct SpeedResult {
    bool running = false;             // correr solo si puede (no agachado, atacando ni nadando)
    float speed = 0.0f;               // m/s objetivo
};

// Velocidad objetivo del jugador segun su estado (animo, energia, abstinencia, adrenalina, agacharse, atacar, nadar, vadear, acariciar...)
SpeedResult ComputeSpeed(const PlayerSession& session, const SpeedInput& input);

// El mundo que consulta el paso de fisica
struct World {
    std::function<bool(float x, float z)> canStand;                                              // se puede pisar ahi segun la capa actual
    std::function<bool(const glm::vec3& next, float& impactSpeed, glm::vec3& impactDirection)> vehicleImpact;   // un vehiculo lo atropella en `next`
    std::function<void(float impactSpeed, const glm::vec3& impactDirection)> knockDown;           // aplica el dano y arranca la caida
    std::function<glm::vec3(float dt)> ragdollStep;                                               // avanza el ragdoll y devuelve su posicion
    std::function<glm::vec3(const glm::vec3& wanted)> placeSafely;                                // posicion libre mas cercana
    std::function<void()> ragdollReleased;                                                        // el ragdoll deja de usar su superficie
    std::function<float(float x, float z)> groundHeight;                                          // altura del suelo (isla de la estacion, rampas, lago)
    float lakeFloorMinY = 0.0f;                                                                   // CityLayout::kLakeSurface - 1.25: en el lago pisa el fondo hasta el pecho
};

// Avanza un cuadro: devuelve la velocidad real (m/s) que lleva despues de integrar. `moveDir` es la direccion deseada en el plano (sin normalizar).
float Step(PlayerSession& session, const World& world, float dt, glm::vec3 moveDir, float moveSpeed);

} // namespace Bazuko::Movement
