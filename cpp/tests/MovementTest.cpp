// Movimiento: prueba DIFERENCIAL. `RefSpeed` y `RefStep` son copias literales del bloque que vivia en main() antes de extraerlo a game/Movement;
// se ejecutan contra el mismo mundo de mentira (paredes, atropellos y ragdoll deterministas) que la version nueva y el estado debe quedar
// identico bit a bit tras cientos de miles de cuadros con entradas aleatorias (caminar, correr, saltar, nadar, atropellos, caidas y el tablero).
#include "game/JumpTiming.hpp"
#include "game/Movement.hpp"

#include "world/Viaduct.hpp"

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

// ---------- copia literal del codigo anterior de main() ----------
Movement::SpeedResult RefSpeed(const PlayerSession& s, bool wantsRun, float withdrawal, bool highWithdrawal, bool criticalWithdrawal) {
    const auto& needs = s.needs;
    bool isRunning = wantsRun;
    float statusSpeedMultiplier = 1.0f;
    if (needs[5] < 30.0f) statusSpeedMultiplier *= 0.8f;
    if (needs[5] <= 0.0f) statusSpeedMultiplier *= 0.7f;
    if (needs[2] <= 0.0f) statusSpeedMultiplier *= 0.5f;
    if (withdrawal > 0.0f) {
        statusSpeedMultiplier *= 0.85f;
        if (criticalWithdrawal) statusSpeedMultiplier *= 0.75f;
        else if (highWithdrawal) statusSpeedMultiplier *= 0.88f;
    }
    if (s.boostActive) statusSpeedMultiplier *= 1.35f;
    const bool attacking = s.playerAction != PlayerAction::None && s.playerAction != PlayerAction::Jump;
    if (s.playerCrouching || attacking || s.playerSwimming) isRunning = false;
    float moveSpeed = (isRunning ? 6.0f : 3.0f) * statusSpeedMultiplier;
    if (s.playerCrouching) moveSpeed *= 0.5f;
    if (s.sorting) moveSpeed = 0.0f;
    if (s.playerSwimming) moveSpeed *= 0.55f;
    else if (s.playerWaterDepth > 0.3f) moveSpeed *= 1.0f - 0.25f * std::min(1.0f, s.playerWaterDepth);
    if (attacking) moveSpeed *= 0.3f;
    if (s.playerAction == PlayerAction::Pet || s.petWaiting) moveSpeed = 0.0f;
    if (s.playerHitKind > 0) moveSpeed *= 0.1f;
    if (s.poopMode != 0) moveSpeed = 0.0f;
    return {isRunning, moveSpeed};
}

float RefStep(PlayerSession& s, const Movement::World& w, float dt, glm::vec3 moveDir, float moveSpeed) {
    auto& playerPos = s.position;
    auto& playerVelocity = s.playerVelocity;
    auto& playerKnockedDown = s.playerKnockedDown;
    auto& knockdownRemaining = s.knockdownRemaining;
    auto& playerYaw = s.playerYaw;
    auto& playerOnDeck = s.playerOnDeck;
    auto& knockdownLyingYaw = s.knockdownLyingYaw;
    auto& knockedOnDeck = s.knockedOnDeck;
    auto& vehicleImpactCooldown = s.vehicleImpactCooldown;
    auto& needs = s.needs;
    if (s.playerAction == PlayerAction::Jump && s.jumpMoving) {
        const float airTime = s.actionTime - Jump::TimingFor(true).takeoff;
        if (airTime >= 0.0f && airTime < Jump::TimingFor(true).air) { moveDir = s.jumpDirection; moveSpeed = s.jumpSpeed; }
    }
    float currentSpeed = 0.0f;
    if (playerKnockedDown) {
        knockdownRemaining = std::max(0.0f, knockdownRemaining - dt);
        playerPos = w.ragdollStep(dt);
        playerVelocity = glm::vec3(0.0f);
        if (knockdownRemaining <= 0.0f) {
            playerKnockedDown = false;
            playerYaw = knockdownLyingYaw;
            float deckY = 0.0f;
            if (knockedOnDeck && Viaduct::StepLayer(true, playerPos.x, playerPos.z, deckY)) {
                playerOnDeck = true;
                playerPos.y = deckY;
            } else {
                playerOnDeck = false;
                playerPos = w.placeSafely(playerPos);
            }
            w.ragdollReleased();
        }
    } else if (const bool moving = glm::length(moveDir) > 0.001f; moving || glm::dot(playerVelocity, playerVelocity) > 0.0005f) {
        if (moving) moveDir = glm::normalize(moveDir);
        const glm::vec3 targetVelocity = moving ? moveDir * moveSpeed : glm::vec3(0.0f);
        const float accelerationRate = moving ? 22.0f : 18.0f;
        playerVelocity = glm::mix(playerVelocity, targetVelocity, 1.0f - std::exp(-accelerationRate * std::max(0.0f, dt)));
        if (!moving && glm::dot(playerVelocity, playerVelocity) < 0.0005f) playerVelocity = glm::vec3(0.0f);
        currentSpeed = glm::length(playerVelocity);
        glm::vec3 nextPos = playerPos + playerVelocity * dt;
        float impactSpeed = 0.0f;
        glm::vec3 impactDirection(0.0f);
        if (vehicleImpactCooldown <= 0.0f && needs[3] > 0.0f && w.vehicleImpact(nextPos, impactSpeed, impactDirection)) {
            w.knockDown(impactSpeed, impactDirection);
        } else if (w.canStand(nextPos.x, nextPos.z)) {
            playerPos.x = nextPos.x; playerPos.z = nextPos.z;
        } else if (w.canStand(nextPos.x, playerPos.z)) {
            playerPos.x = nextPos.x;
        } else if (w.canStand(playerPos.x, nextPos.z)) {
            playerPos.z = nextPos.z;
        }
        playerOnDeck = Viaduct::StepLayer(playerOnDeck, playerPos.x, playerPos.z, playerPos.y);
        if (!playerOnDeck) playerPos.y = std::max(w.groundHeight(playerPos.x, playerPos.z), w.lakeFloorMinY);
        if (moving) playerYaw = std::atan2(moveDir.x, moveDir.z);
    }
    return currentSpeed;
}

// ---------- mundo de mentira, determinista: una instancia por jugador comparado ----------
struct FakeWorld {
    PlayerSession* session;
    std::mt19937 random;
    glm::vec3 ragdollPosition{0.0f};
    int impacts = 0, releases = 0, placements = 0;
    FakeWorld(PlayerSession* s, uint32_t seed) : session(s), random(seed) {}

    Movement::World Make() {
        Movement::World w;
        w.canStand = [this](float x, float z) {
            if (session->playerOnDeck) return std::fabs(x - 75.0f) < 7.0f;   // sobre el tablero, solo entre las barandas
            const int a = static_cast<int>(std::floor(x / 7.0f)), b = static_cast<int>(std::floor(z / 5.0f));
            return ((a * 73856093) ^ (b * 19349663)) % 6 != 0;               // paredes repartidas
        };
        w.vehicleImpact = [this](const glm::vec3&, float& speed, glm::vec3& direction) {
            if (random() % 150 != 0) return false;
            speed = 3.0f + static_cast<float>(random() % 100) / 10.0f;
            const float angle = static_cast<float>(random() % 628) / 100.0f;
            direction = glm::vec3(std::cos(angle), 0.0f, std::sin(angle));
            ++impacts;
            return true;
        };
        w.knockDown = [this](float impactSpeed, const glm::vec3& impactDirection) {   // como knockDownPlayer de main (el azar de la caida sale del mundo de mentira)
            const float damage = std::min(100.0f, std::max(4.0f, std::round(0.6f * impactSpeed * impactSpeed + 1.5f * impactSpeed)));
            session->needs[3] = std::max(0.0f, session->needs[3] - damage);
            session->needs[2] = std::max(0.0f, session->needs[2] - damage * 0.25f);
            session->vehicleImpactCooldown = 1.5f;
            session->playerKnockedDown = true;
            session->knockdownRemaining = 2.0f;
            session->knockdownLyingYaw = std::atan2(-impactDirection.x, -impactDirection.z) + (static_cast<float>(random() % 1000) / 1000.0f - 0.5f) * 1.4f;
            session->playerHitKind = 0;
            session->knockedOnDeck = session->playerOnDeck;
            ragdollPosition = session->position;
        };
        w.ragdollStep = [this](float dt) { ragdollPosition += glm::vec3(0.6f, -0.05f, 0.3f) * dt; return ragdollPosition; };
        w.placeSafely = [this](const glm::vec3& wanted) { ++placements; return glm::vec3(std::round(wanted.x), 0.0f, std::round(wanted.z)); };
        w.ragdollReleased = [this]() { ++releases; };
        w.groundHeight = [](float x, float z) { return 0.05f * std::sin(x * 0.1f) + 0.04f * std::cos(z * 0.07f); };
        w.lakeFloorMinY = -0.3f;
        return w;
    }
};

bool SameBits(float a, float b) { return std::memcmp(&a, &b, sizeof(float)) == 0; }
bool SameVec(const glm::vec3& a, const glm::vec3& b) { return SameBits(a.x, b.x) && SameBits(a.y, b.y) && SameBits(a.z, b.z); }
bool Same(const PlayerSession& a, const PlayerSession& b) {
    return SameVec(a.position, b.position) && SameVec(a.playerVelocity, b.playerVelocity) && SameBits(a.playerYaw, b.playerYaw)
        && a.playerKnockedDown == b.playerKnockedDown && SameBits(a.knockdownRemaining, b.knockdownRemaining) && SameBits(a.knockdownLyingYaw, b.knockdownLyingYaw)
        && a.knockedOnDeck == b.knockedOnDeck && a.playerOnDeck == b.playerOnDeck && SameBits(a.vehicleImpactCooldown, b.vehicleImpactCooldown)
        && SameBits(a.needs[2], b.needs[2]) && SameBits(a.needs[3], b.needs[3]);
}

} // namespace

int main() {
    std::mt19937 inputs(99);
    std::uniform_real_distribution<float> unit(0.0f, 1.0f);
    long frames = 0, moved = 0, impactsTotal = 0, getUps = 0, deckFrames = 0, airFrames = 0, speedCases = 0;
    for (int run = 0; run < 300; ++run) {
        PlayerSession a, b;
        a.position = b.position = glm::vec3(60.0f + 30.0f * unit(inputs), 0.0f, 20.0f + 60.0f * unit(inputs));
        a.needs = b.needs = {80.0f, 70.0f, 60.0f, 100.0f, 90.0f, 70.0f, 80.0f};
        FakeWorld worldA(&a, 1000 + run), worldB(&b, 1000 + run);
        const Movement::World wa = worldA.Make(), wb = worldB.Make();
        for (int step = 0; step < 1000; ++step) {
            // estado que cambia el caminar: se sortea igual para los dos
            if (step % 40 == 0) {
                const int action = static_cast<int>(unit(inputs) * 6.99f);
                const PlayerAction picked = action == 0 ? PlayerAction::Jump : action == 1 ? PlayerAction::Jab : action == 2 ? PlayerAction::Pet : PlayerAction::None;
                for (PlayerSession* s : {&a, &b}) {
                    s->playerAction = picked; s->actionTime = 0.0f;
                }
                const bool crouch = unit(inputs) < 0.15f, swim = unit(inputs) < 0.1f, sorting = unit(inputs) < 0.05f, boost = unit(inputs) < 0.2f, jumpMoving = unit(inputs) < 0.5f;
                const float depth = unit(inputs) < 0.3f ? 1.5f * unit(inputs) : 0.0f;
                const int hit = unit(inputs) < 0.1f ? 1 : 0, poop = unit(inputs) < 0.05f ? 1 : 0;
                const float jumpAngle = unit(inputs) * 6.28f, jumpSpeed = 1.0f + 5.0f * unit(inputs);
                const float lowNeed = unit(inputs) < 0.2f ? 0.0f : 60.0f, lowEnergy = unit(inputs) < 0.1f ? 0.0f : 60.0f;
                const bool refillHealth = unit(inputs) < 0.3f;
                for (PlayerSession* s : {&a, &b}) {
                    s->playerCrouching = crouch; s->playerSwimming = swim; s->sorting = sorting; s->boostActive = boost; s->jumpMoving = jumpMoving;
                    s->playerWaterDepth = depth; s->playerHitKind = hit; s->poopMode = poop; s->petWaiting = false;
                    s->jumpDirection = glm::vec3(std::cos(jumpAngle), 0.0f, std::sin(jumpAngle)); s->jumpSpeed = jumpSpeed;
                    s->needs[5] = lowNeed; s->needs[2] = lowEnergy; if (refillHealth) s->needs[3] = 100.0f;
                }
            }
            const float dt = unit(inputs) < 0.03f ? 0.0f : 0.004f + 0.1f * unit(inputs) * unit(inputs);
            for (PlayerSession* s : {&a, &b}) s->actionTime += dt;
            const bool wantsRun = unit(inputs) < 0.4f;
            const float withdrawal = unit(inputs) < 0.1f ? 30.0f + 70.0f * unit(inputs) : 0.0f;
            const bool high = withdrawal >= 50.0f, critical = withdrawal >= 80.0f;
            glm::vec3 dir(0.0f);
            if (unit(inputs) < 0.7f) { const float angle = unit(inputs) * 6.2831853f; dir = glm::vec3(std::cos(angle), 0.0f, std::sin(angle)) * (0.5f + unit(inputs)); }
            if (unit(inputs) < 0.001f) { a.position = b.position = glm::vec3(75.0f, 0.0f, 55.0f); }
            // deja que a veces el cooldown se acabe para permitir otros atropellos
            if (step % 25 == 0) { a.vehicleImpactCooldown = b.vehicleImpactCooldown = std::max(0.0f, a.vehicleImpactCooldown - 1.0f); }

            const Movement::SpeedResult sa = Movement::ComputeSpeed(a, {wantsRun, withdrawal, high, critical});
            const Movement::SpeedResult sb = RefSpeed(b, wantsRun, withdrawal, high, critical);
            ++speedCases;
            if (sa.running != sb.running || !SameBits(sa.speed, sb.speed)) { std::printf("DIVERGE velocidad en la corrida %d, paso %d\n", run, step); ++failures; run = 300; break; }
            const float ca = Movement::Step(a, wa, dt, dir, sa.speed);
            const float cb = RefStep(b, wb, dt, dir, sb.speed);
            ++frames;
            if (!SameBits(ca, cb) || !Same(a, b) || worldA.impacts != worldB.impacts || worldA.releases != worldB.releases || worldA.placements != worldB.placements) {
                std::printf("DIVERGE en la corrida %d, paso %d (cs %.6f/%.6f pos %.4f,%.4f,%.4f / %.4f,%.4f,%.4f knocked %d/%d rem %.4f/%.4f deck %d/%d impactos %d/%d yaw %.4f/%.4f vel %.4f/%.4f)\n", run, step, ca, cb,
                            a.position.x, a.position.y, a.position.z, b.position.x, b.position.y, b.position.z, a.playerKnockedDown, b.playerKnockedDown,
                            a.knockdownRemaining, b.knockdownRemaining, a.playerOnDeck, b.playerOnDeck, worldA.impacts, worldB.impacts, a.playerYaw, b.playerYaw, a.playerVelocity.x, b.playerVelocity.x);
                ++failures; run = 300; break;
            }
            moved += ca > 0.1f; deckFrames += a.playerOnDeck; airFrames += a.playerAction == PlayerAction::Jump && a.jumpMoving;
        }
        impactsTotal += worldA.impacts; getUps += worldA.releases;
    }
    std::printf("Diferencial: %ld cuadros identicos (en movimiento %ld, atropellos %ld, levantadas %ld, sobre el tablero %ld, saltos con carrera %ld)\n",
                frames, moved, impactsTotal, getUps, deckFrames, airFrames);
    CHECK(frames == 300L * 1000L, "no se completaron todos los cuadros");
    CHECK(moved > 50000 && impactsTotal > 100 && getUps > 50 && airFrames > 1000, "la prueba no cubrio todos los casos");

    // comportamientos conocidos
    {
        PlayerSession s; s.needs = {100, 100, 100, 100, 100, 100, 100};
        const auto walk = Movement::ComputeSpeed(s, {false, 0.0f, false, false});
        const auto run = Movement::ComputeSpeed(s, {true, 0.0f, false, false});
        CHECK(walk.speed == 3.0f && run.speed == 6.0f && run.running, "caminar a 3 m/s y correr a 6 m/s");
        s.playerSwimming = true;
        CHECK(!Movement::ComputeSpeed(s, {true, 0.0f, false, false}).running, "nadando no corre");
        s.playerSwimming = false; s.boostActive = true;
        CHECK(std::fabs(Movement::ComputeSpeed(s, {true, 0.0f, false, false}).speed - 6.0f * 1.35f) < 1e-5f, "la adrenalina acelera 35 %");
    }
    if (failures == 0) std::printf("Movimiento: todo correcto\n");
    return failures == 0 ? 0 : 1;
}
