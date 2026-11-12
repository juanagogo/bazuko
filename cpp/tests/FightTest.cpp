// Pelea: prueba DIFERENCIAL. Las funciones `Ref*` son copias literales del codigo que vivia en el bucle de main() antes de extraerlo a game/Fight;
// se ejecutan sobre dos jugadores con las mismas entradas aleatorias (golpes recibidos, esquives, acciones, saltos, caricias, caidas) y el estado
// debe quedar identico bit a bit tras cientos de miles de pasos.
#include "game/Fight.hpp"
#include "game/JumpTiming.hpp"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <random>

using namespace Bazuko;

static int failures = 0;
#define CHECK(condition, message) do { \
    if (!(condition)) { ++failures; std::printf("FALLO (%d): %s\n", __LINE__, message); } \
} while (0)

namespace {

// ---------- copias literales del codigo anterior de main() ----------
Fight::HitResult RefReceive(PlayerSession& s, int hitKind, const glm::vec3& hitFrom) {
    auto& playerKnockedDown = s.playerKnockedDown; auto& playerHitKind = s.playerHitKind; auto& playerAction = s.playerAction;
    auto& actionTime = s.actionTime; auto& actionDuration = s.actionDuration; auto& playerHitTime = s.playerHitTime; auto& jumpOffset = s.jumpOffset;
    auto& needs = s.needs; auto& playerYaw = s.playerYaw; auto& playerStaggerDirection = s.playerStaggerDirection;
    {
        if (playerKnockedDown || playerHitKind > 0) return Fight::HitResult::Ignored;
        if ((playerAction == PlayerAction::Slip || playerAction == PlayerAction::Duck) && actionTime >= 0.10f && actionTime <= actionDuration * 0.85f) {
            return Fight::HitResult::Dodged;
        }
        playerHitKind = hitKind;
        playerHitTime = 0.0f;
        playerAction = PlayerAction::None;
        jumpOffset = 0.0f;
        const float blowDamage = hitKind == 1 ? 8.0f : hitKind == 2 ? 6.0f : 5.0f;
        needs[3] = std::max(0.0f, needs[3] - blowDamage);
        needs[5] = std::max(0.0f, needs[5] - 2.0f);
        playerYaw = std::atan2(hitFrom.x, hitFrom.z);
        playerStaggerDirection = -glm::normalize(glm::vec3(hitFrom.x, 0.0f, hitFrom.z));
    }
    return Fight::HitResult::Hurt;
}

void RefStagger(PlayerSession& s, float dt, const std::function<bool(float, float)>& canStand) {
    auto& playerHitKind = s.playerHitKind; auto& playerHitTime = s.playerHitTime; auto& playerStaggerDirection = s.playerStaggerDirection;
    auto& playerPos = s.position; auto& playerKnockedDown = s.playerKnockedDown;
    if (playerHitKind > 0) {
        playerHitTime += dt;
        {
            const float hitLength = playerHitKind == 1 ? 0.667f : playerHitKind == 2 ? 0.75f : 0.833f;
            const float strength = 2.4f * std::max(0.0f, 1.0f - playerHitTime / hitLength);
            const glm::vec3 step = playerStaggerDirection * strength * dt;
            if (canStand(playerPos.x + step.x, playerPos.z + step.z)) { playerPos.x += step.x; playerPos.z += step.z; }
        }
        const float hitLength = playerHitKind == 1 ? 0.667f : playerHitKind == 2 ? 0.75f : 0.833f;
        if (playerHitTime >= hitLength || playerKnockedDown) playerHitKind = 0;
    }
}

void RefStart(PlayerSession& s, PlayerAction action, int clip, float clipLength, float seconds) {
    s.playerAction = action; s.actionTime = 0.0f; s.actionHitDone = false; s.playerActionClip = clip;
    s.actionDuration = seconds > 0.0f ? seconds : clipLength;
}

struct RefTick { bool strike = false; PlayerAction action = PlayerAction::None; int kind = 0; bool reward = false, petEnded = false; };
RefTick RefTickAction(PlayerSession& s, float dt, const std::function<float(PlayerAction)>& impactTime) {
    auto& playerAction = s.playerAction; auto& actionTime = s.actionTime; auto& actionHitDone = s.actionHitDone; auto& actionDuration = s.actionDuration;
    auto& jumpMoving = s.jumpMoving; auto& jumpOffset = s.jumpOffset; auto& petRewardPending = s.petRewardPending; auto& playerKnockedDown = s.playerKnockedDown;
    RefTick r;
    if (playerAction != PlayerAction::None) {
        actionTime += dt;
        if (!actionHitDone && playerAction != PlayerAction::Jump) {
            const bool dodging = playerAction == PlayerAction::Slip || playerAction == PlayerAction::Duck;
            const bool kicking = playerAction == PlayerAction::Kick || playerAction == PlayerAction::HighKick;
            const float impactAt = impactTime(playerAction);
            if (dodging) actionHitDone = true;
            else if (actionTime >= impactAt) {
                actionHitDone = true;
                const int hitKind = playerAction == PlayerAction::Jab ? 1 : kicking ? 3 : 2;
                r.strike = true; r.action = playerAction; r.kind = hitKind;
            }
        }
        if (playerAction == PlayerAction::Jump) {
            const float air = actionTime - Jump::TimingFor(jumpMoving).takeoff;
            jumpOffset = air > 0.0f && air < 0.735f ? 3.6f * air - 4.9f * air * air : 0.0f;
        }
        if (playerAction == PlayerAction::Pet && petRewardPending && actionTime >= 1.5f) {
            petRewardPending = false;
            r.reward = true;
        }
        if (actionTime >= actionDuration || playerKnockedDown) {
            if (playerAction == PlayerAction::Pet) { r.petEnded = true; petRewardPending = false; }
            playerAction = PlayerAction::None;
            jumpOffset = 0.0f;
        }
    }
    return r;
}

bool SameBits(float a, float b) { return std::memcmp(&a, &b, sizeof(float)) == 0; }
bool SameVec(const glm::vec3& a, const glm::vec3& b) { return SameBits(a.x, b.x) && SameBits(a.y, b.y) && SameBits(a.z, b.z); }
bool Same(const PlayerSession& a, const PlayerSession& b) {
    return SameVec(a.position, b.position) && SameBits(a.playerYaw, b.playerYaw) && SameVec(a.playerStaggerDirection, b.playerStaggerDirection)
        && a.playerHitKind == b.playerHitKind && SameBits(a.playerHitTime, b.playerHitTime) && a.playerAction == b.playerAction
        && SameBits(a.actionTime, b.actionTime) && SameBits(a.actionDuration, b.actionDuration) && a.actionHitDone == b.actionHitDone
        && a.playerActionClip == b.playerActionClip && SameBits(a.jumpOffset, b.jumpOffset) && a.petRewardPending == b.petRewardPending
        && a.playerKnockedDown == b.playerKnockedDown && SameBits(a.needs[3], b.needs[3]) && SameBits(a.needs[5], b.needs[5]);
}

float ImpactOf(PlayerAction action) {   // como el original: una tecnica por codigo o 0,28 / 0,30
    switch (action) {
        case PlayerAction::Jab: return 0.15f; case PlayerAction::Cross: return 0.19f; case PlayerAction::Hook: return 0.24f;
        case PlayerAction::Kick: return 0.31f; case PlayerAction::HighKick: return 0.36f;
        case PlayerAction::Stab: return 0.28f;
        default: return 0.30f;
    }
}

} // namespace

int main() {
    std::mt19937 inputs(555);
    std::uniform_real_distribution<float> unit(0.0f, 1.0f);
    long steps = 0, hurt = 0, dodged = 0, ignored = 0, strikes = 0, rewards = 0, jumps = 0, staggers = 0, petEnds = 0;
    const std::array<PlayerAction, 12> actions{PlayerAction::None, PlayerAction::Jump, PlayerAction::Jab, PlayerAction::Cross, PlayerAction::Kick, PlayerAction::Slash,
                                               PlayerAction::Stab, PlayerAction::Pet, PlayerAction::Hook, PlayerAction::HighKick, PlayerAction::Slip, PlayerAction::Duck};
    const std::function<bool(float, float)> canStand = [](float x, float z) { return (static_cast<int>(std::floor(x * 3.0f)) + static_cast<int>(std::floor(z * 3.0f))) % 5 != 0; };
    const std::function<float(PlayerAction)> impact = ImpactOf;
    for (int run = 0; run < 300; ++run) {
        PlayerSession a, b;
        a.position = b.position = glm::vec3(10.0f, 0.0f, 10.0f);
        a.needs = b.needs = {80.0f, 70.0f, 60.0f, 100.0f, 90.0f, 70.0f, 80.0f};
        for (int step = 0; step < 1000; ++step) {
            const float dt = unit(inputs) < 0.03f ? 0.0f : 0.004f + 0.08f * unit(inputs) * unit(inputs);
            const float choice = unit(inputs);
            if (choice < 0.06f) {   // un golpe recibido, de cualquier lado
                const int kind = 1 + static_cast<int>(unit(inputs) * 2.99f);
                const float angle = unit(inputs) * 6.2831853f, length = 0.5f + 2.0f * unit(inputs);
                const glm::vec3 from(std::cos(angle) * length, 0.0f, std::sin(angle) * length);
                const auto ra = Fight::ReceiveHit(a, kind, from);
                const auto rb = RefReceive(b, kind, from);
                if (ra != rb) { std::printf("DIVERGE resultado del golpe (corrida %d, paso %d)\n", run, step); ++failures; run = 300; break; }
                hurt += ra == Fight::HitResult::Hurt; dodged += ra == Fight::HitResult::Dodged; ignored += ra == Fight::HitResult::Ignored;
            } else if (choice < 0.14f && !(a.playerAction == PlayerAction::Pet && a.petRewardPending)) {   // empieza una accion (no pisa una caricia con premio pendiente) (cualquiera, con o sin duracion fija)
                const PlayerAction action = actions[1 + static_cast<size_t>(unit(inputs) * 10.99f)];
                const int clip = static_cast<int>(unit(inputs) * 20.0f) - 1;
                const float clipLength = 0.4f + 1.5f * unit(inputs);
                const float seconds = unit(inputs) < 0.5f ? 0.0f : 0.3f + unit(inputs);
                Fight::StartAction(a, action, clip, clipLength, seconds);
                RefStart(b, action, clip, clipLength, seconds);
                if (action == PlayerAction::Jump) { const bool moving = unit(inputs) < 0.5f; a.jumpMoving = b.jumpMoving = moving; ++jumps; }
                if (action == PlayerAction::Pet) { const bool pending = unit(inputs) < 0.7f; a.petRewardPending = b.petRewardPending = pending; a.actionDuration = b.actionDuration = 2.5f; }   // la caricia dura mas de 1,5 s
            } else if (choice < 0.17f) {   // se cae o se levanta
                const bool down = unit(inputs) < 0.15f;
                a.playerKnockedDown = b.playerKnockedDown = down;
            } else if (choice < 0.19f) {
                a.needs[3] = b.needs[3] = 100.0f;
            }
            Fight::StaggerStep(a, dt, canStand);
            RefStagger(b, dt, canStand);
            staggers += a.playerHitKind > 0;
            const Fight::TickResult ta = Fight::TickAction(a, dt, impact);
            const RefTick tb = RefTickAction(b, dt, impact);
            ++steps;
            if (ta.strike != tb.strike || (ta.strike && (ta.strikeAction != tb.action || ta.strikeKind != tb.kind)) || ta.petRewardDue != tb.reward || ta.petEnded != tb.petEnded || !Same(a, b)) {
                std::printf("DIVERGE en la corrida %d, paso %d\n", run, step); ++failures; run = 300; break;
            }
            strikes += ta.strike; rewards += ta.petRewardDue; petEnds += ta.petEnded;
        }
    }
    std::printf("Diferencial: %ld pasos identicos (golpes que hieren %ld, esquivados %ld, ignorados %ld, impactos %ld, caricias %ld, finales de caricia %ld, saltos %ld, pasos de tambaleo %ld)\n",
                steps, hurt, dodged, ignored, strikes, rewards, petEnds, jumps, staggers);
    CHECK(steps == 300L * 1000L, "no se completaron todos los pasos");
    CHECK(hurt > 500 && dodged > 20 && ignored > 500 && strikes > 1000 && rewards > 5 && petEnds > 50 && staggers > 500, "la prueba no cubrio todos los casos");

    // comportamientos conocidos
    {
        PlayerSession s; s.needs = {100, 100, 100, 100, 100, 100, 100};
        CHECK(Fight::ReceiveHit(s, 1, glm::vec3(1.0f, 0.0f, 0.0f)) == Fight::HitResult::Hurt && s.needs[3] == 92.0f && s.needs[5] == 98.0f, "un golpe a la cara quita 8 de salud y 2 de animo");
        CHECK(Fight::ReceiveHit(s, 2, glm::vec3(1.0f, 0.0f, 0.0f)) == Fight::HitResult::Ignored, "aturdido, otro golpe se ignora");
        PlayerSession d; d.needs = {100, 100, 100, 100, 100, 100, 100};
        Fight::StartAction(d, PlayerAction::Slip, 0, 1.0f, 0.0f); d.actionTime = 0.3f;
        CHECK(Fight::ReceiveHit(d, 1, glm::vec3(1.0f, 0.0f, 0.0f)) == Fight::HitResult::Dodged && d.needs[3] == 100.0f, "un esquive a tiempo evita el golpe");
    }
    if (failures == 0) std::printf("Pelea: todo correcto\n");
    return failures == 0 ? 0 : 1;
}
