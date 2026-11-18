#pragma once
// Una sola regla de movimiento para el cliente y el servidor: aplicar un `Net::PlayerInput` a una `PlayerSession` durante un paso fijo. El servidor
// la usa con la entrada que recibe; el cliente, para PREDECIR su propio movimiento sin esperar la respuesta y despues reconciliarlo (Prediction.hpp).
// Como es la misma funcion (Movement::ComputeSpeed y Movement::Step), si ambos reciben las mismas entradas llegan al mismo punto.
#include "Protocol.hpp"
#include "../game/Movement.hpp"
#include "../game/PlayerSession.hpp"

#include <glm/glm.hpp>

namespace Bazuko::Net {

inline constexpr float kStepSeconds = 1.0f / 30.0f;   // paso fijo de la simulacion (30 Hz)

// Mundo sin obstaculos dentro del mapa jugable (0..400 x -74..322): para pruebas y para servidores sin ciudad cargada.
const Movement::World& FlatWorld();

// Aplica una entrada durante `dt` (normalmente kStepSeconds).
void ApplyInput(PlayerSession& session, const PlayerInput& input, const Movement::World& world, float dt);

// La entrada tal como llega al servidor (despues de cuantizarla): el cliente aplica ESTA a su prediccion para que ambos vean lo mismo.
PlayerInput Quantized(const PlayerInput& input);

// Lo que ven los demas jugadores de esta sesion
PlayerSnapshot MakeSnapshot(uint8_t id, const PlayerSession& session);

} // namespace Bazuko::Net
