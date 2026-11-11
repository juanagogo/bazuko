#pragma once
// Reglas de pelea del jugador que antes vivian en el bucle de main(): recibir un golpe (esquive, dano, tambaleo), el tambaleo mismo y la maquina de
// la accion en curso (inicio, momento del impacto, salto, caricia al Chato y fin). No toca entrada, camara, animaciones ni la interfaz: quien
// llama decide que tecla inicia que accion y aplica el golpe sobre peatones y vehiculos. tests/FightTest.cpp compara cada paso con el codigo original.
#include "PlayerSession.hpp"

#include <functional>
#include <glm/glm.hpp>

namespace Bazuko::Fight {

enum class HitResult { Ignored, Dodged, Hurt };

// Un golpe recibido (`hitKind`: 1 cara, 2 pecho, 3 piernas; `from`: de donde viene). Si ya esta caido o aturdido se ignora; un esquive a tiempo lo evita.
HitResult ReceiveHit(PlayerSession& session, int hitKind, const glm::vec3& from);

// Pasos cortos hacia atras tras un golpe (sin atravesar nada) y fin del aturdimiento
void StaggerStep(PlayerSession& session, float dt, const std::function<bool(float x, float z)>& canStand);

// Arranca una accion (la camara y el clip los resuelve quien llama): dura `seconds`, o `clipLength` si seconds <= 0
void StartAction(PlayerSession& session, PlayerAction action, int clipIndex, float clipLength, float seconds);

struct TickResult {
    bool strike = false;          // el puno o el pie llego al punto de impacto: aplicar el golpe a peatones y vehiculos
    PlayerAction strikeAction = PlayerAction::None;
    int strikeKind = 0;           // 1 cara (jab), 2 cuerpo, 3 piernas (patada)
    bool petRewardDue = false;    // la mano ya esta sobre la cabeza del Chato: acariciar
    bool petEnded = false;        // termino la accion de acariciar
};

// Avanza la accion en curso. `impactTime(action)` da el segundo de la animacion en que pega (tecnica por codigo, o 0,28 punalada y 0,30 tajo).
TickResult TickAction(PlayerSession& session, float dt, const std::function<float(PlayerAction)>& impactTime);

} // namespace Bazuko::Fight
