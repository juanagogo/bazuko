#include "Movement.hpp"

#include "JumpTiming.hpp"
#include "../world/Viaduct.hpp"

#include <algorithm>
#include <cmath>

namespace Bazuko::Movement {

// Formulas y orden copiados del bloque original de main(); no se "limpia" nada.

SpeedResult ComputeSpeed(const PlayerSession& s, const SpeedInput& in) {
    float statusSpeedMultiplier = 1.0f;
    if (s.needs[5] < 30.0f) statusSpeedMultiplier *= 0.8f;
    if (s.needs[5] <= 0.0f) statusSpeedMultiplier *= 0.7f;
    if (s.needs[2] <= 0.0f) statusSpeedMultiplier *= 0.5f;
    if (in.withdrawal > 0.0f) {
        statusSpeedMultiplier *= 0.85f;
        if (in.criticalWithdrawal) statusSpeedMultiplier *= 0.75f;
        else if (in.highWithdrawal) statusSpeedMultiplier *= 0.88f;
    }
    if (s.boostActive) statusSpeedMultiplier *= 1.35f;
    bool isRunning = in.wantsRun;
    const bool attacking = s.playerAction != PlayerAction::None && s.playerAction != PlayerAction::Jump;
    if (s.playerCrouching || attacking || s.playerSwimming) isRunning = false;
    float moveSpeed = (isRunning ? 6.0f : 3.0f) * statusSpeedMultiplier;
    if (s.playerCrouching) moveSpeed *= 0.5f;
    if (s.sorting) moveSpeed = 0.0f;   // revisando la basura: quieto y agachado
    if (s.playerSwimming) moveSpeed *= 0.55f;   // nadando
    else if (s.playerWaterDepth > 0.3f) moveSpeed *= 1.0f - 0.25f * std::min(1.0f, s.playerWaterDepth);   // el agua frena al vadear
    if (attacking) moveSpeed *= 0.3f;
    if (s.playerAction == PlayerAction::Pet || s.petWaiting) moveSpeed = 0.0f;   // acariciando al Chato (o esperando que se siente)
    if (s.playerHitKind > 0) moveSpeed *= 0.1f;
    if (s.poopMode != 0) moveSpeed = 0.0f;   // agachado o recogiendo el mojon
    return {isRunning, moveSpeed};
}

float Step(PlayerSession& s, const World& w, float dt, glm::vec3 moveDir, float moveSpeed) {
    glm::vec3& playerPos = s.position;
    if (s.playerAction == PlayerAction::Jump && s.jumpMoving) {   // en el aire el salto conserva el rumbo y la velocidad con que se despego
        const float airTime = s.actionTime - Jump::TimingFor(true).takeoff;
        if (airTime >= 0.0f && airTime < Jump::TimingFor(true).air) { moveDir = s.jumpDirection; moveSpeed = s.jumpSpeed; }
    }
    float currentSpeed = 0.0f;
    if (s.playerKnockedDown) {
        s.knockdownRemaining = std::max(0.0f, s.knockdownRemaining - dt);
        playerPos = w.ragdollStep(dt);
        s.playerVelocity = glm::vec3(0.0f);
        if (s.knockdownRemaining <= 0.0f) {
            s.playerKnockedDown = false;
            s.playerYaw = s.knockdownLyingYaw;
            float deckY = 0.0f;
            if (s.knockedOnDeck && Viaduct::StepLayer(true, playerPos.x, playerPos.z, deckY)) {
                s.playerOnDeck = true;   // se levanta sobre el tablero
                playerPos.y = deckY;
            } else {
                s.playerOnDeck = false;
                playerPos = w.placeSafely(playerPos);   // la caida no puede dejarlo dentro de un modelo
            }
            w.ragdollReleased();
        }
    } else if (const bool moving = glm::length(moveDir) > 0.001f; moving || glm::dot(s.playerVelocity, s.playerVelocity) > 0.0005f) {
        if (moving) moveDir = glm::normalize(moveDir);
        const glm::vec3 targetVelocity = moving ? moveDir * moveSpeed : glm::vec3(0.0f);
        const float accelerationRate = moving ? 22.0f : 18.0f;
        s.playerVelocity = glm::mix(s.playerVelocity, targetVelocity, 1.0f - std::exp(-accelerationRate * std::max(0.0f, dt)));
        if (!moving && glm::dot(s.playerVelocity, s.playerVelocity) < 0.0005f) s.playerVelocity = glm::vec3(0.0f);
        currentSpeed = glm::length(s.playerVelocity);

        glm::vec3 nextPos = playerPos + s.playerVelocity * dt;
        float impactSpeed = 0.0f;
        glm::vec3 impactDirection(0.0f);
        if (s.vehicleImpactCooldown <= 0.0f && s.needs[3] > 0.0f
            && w.vehicleImpact(nextPos, impactSpeed, impactDirection)) {
            w.knockDown(impactSpeed, impactDirection);
        } else if (w.canStand(nextPos.x, nextPos.z)) {
            playerPos.x = nextPos.x;
            playerPos.z = nextPos.z;
        } else if (w.canStand(nextPos.x, playerPos.z)) {
            playerPos.x = nextPos.x;
        } else if (w.canStand(playerPos.x, nextPos.z)) {
            playerPos.z = nextPos.z;
        }
        // capa: se sube al tablero solo por la rampa y se baja al salir por un extremo; la altura sigue al tablero
        s.playerOnDeck = Viaduct::StepLayer(s.playerOnDeck, playerPos.x, playerPos.z, playerPos.y);
        if (!s.playerOnDeck) {   // la isla de la estacion se sube por sus rampas; en el lago pisa el fondo hasta que el agua le llega al pecho y entonces flota
            playerPos.y = std::max(w.groundHeight(playerPos.x, playerPos.z), w.lakeFloorMinY);
        }

        if (moving) s.playerYaw = std::atan2(moveDir.x, moveDir.z);
    }
    return currentSpeed;
}

} // namespace Bazuko::Movement
