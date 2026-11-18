#include "Fight.hpp"

#include "JumpTiming.hpp"

#include <algorithm>
#include <cmath>

namespace Bazuko::Fight {

// Formulas y orden copiados del codigo original de main(); no se "limpia" nada.

HitResult ReceiveHit(PlayerSession& s, int hitKind, const glm::vec3& hitFrom) {
    if (s.playerKnockedDown || s.playerHitKind > 0) return HitResult::Ignored;
    if ((s.playerAction == PlayerAction::Slip || s.playerAction == PlayerAction::Duck) && s.actionTime >= 0.10f && s.actionTime <= s.actionDuration * 0.85f)
        return HitResult::Dodged;   // el esquive lateral o rotatorio evita el golpe
    s.playerHitKind = hitKind;
    s.playerHitTime = 0.0f;
    s.playerAction = PlayerAction::None;
    s.jumpOffset = 0.0f;
    const float blowDamage = hitKind == 1 ? 8.0f : hitKind == 2 ? 6.0f : 5.0f;   // cara, pecho, piernas
    s.needs[3] = std::max(0.0f, s.needs[3] - blowDamage);
    s.needs[5] = std::max(0.0f, s.needs[5] - 2.0f);   // y el animo
    s.playerYaw = std::atan2(hitFrom.x, hitFrom.z);   // queda de frente a quien lo golpeo
    s.playerStaggerDirection = -glm::normalize(glm::vec3(hitFrom.x, 0.0f, hitFrom.z));
    return HitResult::Hurt;
}

HitResult ReceiveBlow(PlayerSession& s, float damage, const glm::vec3& hitFrom) {
    if (s.playerKnockedDown) return HitResult::Ignored;
    if ((s.playerAction == PlayerAction::Slip || s.playerAction == PlayerAction::Duck) && s.actionTime >= 0.10f && s.actionTime <= s.actionDuration * 0.85f)
        return HitResult::Dodged;
    s.needs[3] = std::max(0.0f, s.needs[3] - damage);
    s.needs[5] = std::max(0.0f, s.needs[5] - 3.0f);
    if (s.playerHitKind == 0) {
        s.playerHitKind = 1;
        s.playerHitTime = 0.0f;
        s.playerAction = PlayerAction::None;
        s.jumpOffset = 0.0f;
        s.playerYaw = std::atan2(hitFrom.x, hitFrom.z);
        s.playerStaggerDirection = -glm::normalize(glm::vec3(hitFrom.x, 0.0f, hitFrom.z) + glm::vec3(1.0e-5f, 0.0f, 0.0f));
    }
    return HitResult::Hurt;
}

void StaggerStep(PlayerSession& s, float dt, const std::function<bool(float, float)>& canStand) {
    if (s.playerHitKind <= 0) return;
    s.playerHitTime += dt;
    {   // pasos cortos hacia atras (unos 0,8 m en total), mas fuertes al principio y sin atravesar nada
        const float hitLength = s.playerHitKind == 1 ? 0.667f : s.playerHitKind == 2 ? 0.75f : 0.833f;
        const float strength = 2.4f * std::max(0.0f, 1.0f - s.playerHitTime / hitLength);
        const glm::vec3 step = s.playerStaggerDirection * strength * dt;
        if (canStand(s.position.x + step.x, s.position.z + step.z)) { s.position.x += step.x; s.position.z += step.z; }
    }
    const float hitLength = s.playerHitKind == 1 ? 0.667f : s.playerHitKind == 2 ? 0.75f : 0.833f;
    if (s.playerHitTime >= hitLength || s.playerKnockedDown) s.playerHitKind = 0;
}

void StartAction(PlayerSession& s, PlayerAction action, int clipIndex, float clipLength, float seconds) {
    s.playerAction = action;
    s.actionTime = 0.0f;
    s.actionHitDone = false;
    s.playerActionClip = clipIndex;
    s.actionDuration = seconds > 0.0f ? seconds : clipLength;
}

TickResult TickAction(PlayerSession& s, float dt, const std::function<float(PlayerAction)>& impactTime) {
    TickResult result;
    if (s.playerAction == PlayerAction::None) return result;
    s.actionTime += dt;
    if (!s.actionHitDone && s.playerAction != PlayerAction::Jump) {
        // el golpe alcanza a un peaton cuando el puno o el pie llegan al punto de impacto de la animacion
        const bool dodging = s.playerAction == PlayerAction::Slip || s.playerAction == PlayerAction::Duck;
        const bool kicking = s.playerAction == PlayerAction::Kick || s.playerAction == PlayerAction::HighKick;
        if (dodging) s.actionHitDone = true;
        else if (s.actionTime >= impactTime(s.playerAction)) {
            s.actionHitDone = true;
            result.strike = true;
            result.strikeAction = s.playerAction;
            result.strikeKind = s.playerAction == PlayerAction::Jab ? 1 : kicking ? 3 : 2;
        }
    }
    if (s.playerAction == PlayerAction::Jump) {
        // se despega al final de la flexion (0,17 s) y se cae con la gravedad: unos 0,7 s en el aire y 0,66 m de altura
        const float air = s.actionTime - Jump::TimingFor(s.jumpMoving).takeoff;
        s.jumpOffset = air > 0.0f && air < 0.735f ? 3.6f * air - 4.9f * air * air : 0.0f;
    }
    if (s.playerAction == PlayerAction::Pet && s.petRewardPending && s.actionTime >= 1.5f) {   // la mano ya esta sobre la cabeza
        s.petRewardPending = false;
        result.petRewardDue = true;
    }
    if (s.actionTime >= s.actionDuration || s.playerKnockedDown) {
        if (s.playerAction == PlayerAction::Pet) { result.petEnded = true; s.petRewardPending = false; }
        s.playerAction = PlayerAction::None;
        s.jumpOffset = 0.0f;
    }
    return result;
}

} // namespace Bazuko::Fight
