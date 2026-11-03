#include "BirdFlock.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <utility>
#include <glm/gtc/constants.hpp>

namespace Bazuko {

namespace {

constexpr float kStandScareRadius = 2.5f;    // jugador quieto
constexpr float kWalkScareRadius = 4.0f;     // jugador caminando
constexpr float kRunScareRadius = 11.0f;     // jugador corriendo
constexpr float kRunSpeedThreshold = 4.3f;   // m/s: caminar = 3, correr = 6
constexpr float kHighPerchFear = 0.75f;      // en ramas y postes se asustan un poco mas tarde
constexpr float kPedestrianScareRadius = 2.5f;
constexpr float kChainRadius = 5.0f;         // si una se asusta, las vecinas tambien
constexpr float kChainChance = 0.7f;

} // namespace

BirdFlock::BirdFlock(uint32_t seed) : m_Random(seed) {}

void BirdFlock::SetSpots(std::vector<BirdSpot> spots, size_t modelCount, const BirdFlockSettings& settings) {
    m_Spots = std::move(spots);
    m_Birds.clear();
    m_Flush.clear();
    m_GroundSpots.clear();
    m_ElevatedSpots.clear();
    for (size_t index = 0; index < m_Spots.size(); ++index) {
        (m_Spots[index].kind == BirdPerch::Ground ? m_GroundSpots : m_ElevatedSpots).push_back(index);
    }
    m_HasPreviousPlayer = false;
    m_PlayerSpeed = 0.0f;
    if (m_Spots.empty() || modelCount == 0) return;

    std::array<std::vector<size_t>, 3> byKind;
    for (size_t index = 0; index < m_Spots.size(); ++index) {
        byKind[static_cast<size_t>(m_Spots[index].kind)].push_back(index);
    }
    const std::array<size_t, 3> counts{{settings.onGround, settings.inTrees, settings.onPoles}};
    for (size_t kind = 0; kind < byKind.size(); ++kind) {
        std::vector<size_t>& list = byKind[kind];
        std::shuffle(list.begin(), list.end(), m_Random);
        const size_t amount = std::min(counts[kind], list.size());
        for (size_t i = 0; i < amount; ++i) {
            Bird bird;
            bird.position = bird.origin = bird.target = bird.home = m_Spots[list[i]].position;
            bird.lookTimer = Unit() * 3.0f;
            bird.perch = bird.targetPerch = static_cast<BirdPerch>(kind);
            bird.phase = Unit() * 30.0f;
            bird.yaw = Unit() * glm::two_pi<float>();
            bird.restRemaining = 1.0f + Unit() * 18.0f;
            bird.modelIndex = m_Birds.size() % modelCount;
            m_Birds.push_back(bird);
        }
    }
    m_Flush.assign(m_Birds.size(), 0);
}

void BirdFlock::Update(float dt, const glm::vec3& playerPosition, const std::vector<glm::vec2>& disturbances) {
    if (dt <= 0.0f || m_Birds.empty()) return;

    // Velocidad del jugador suavizada: asi se distingue caminar de correr
    const glm::vec2 playerXZ(playerPosition.x, playerPosition.z);
    if (m_HasPreviousPlayer) {
        const float instant = glm::distance(playerXZ, glm::vec2(m_PreviousPlayer.x, m_PreviousPlayer.z)) / dt;
        m_PlayerSpeed += (std::min(instant, 12.0f) - m_PlayerSpeed) * std::min(1.0f, dt * 6.0f);
    }
    m_PreviousPlayer = playerPosition;
    m_HasPreviousPlayer = true;
    const bool running = m_PlayerSpeed > kRunSpeedThreshold;
    const float playerRadius = running ? kRunScareRadius : (m_PlayerSpeed > 0.4f ? kWalkScareRadius : kStandScareRadius);

    m_Flush.assign(m_Birds.size(), 0);
    for (size_t index = 0; index < m_Birds.size(); ++index) {
        Bird& bird = m_Birds[index];
        bird.phase += dt;
        if (bird.IsFlying()) {
            AdvanceFlight(bird, dt);
            continue;
        }
        const glm::vec2 birdXZ(bird.position.x, bird.position.z);
        const float radius = playerRadius * (bird.position.y > 2.5f ? kHighPerchFear : 1.0f);
        bool scared = glm::distance(playerXZ, birdXZ) < radius;
        if (!scared && bird.perch == BirdPerch::Ground) {
            scared = std::any_of(disturbances.begin(), disturbances.end(), [&](const glm::vec2& other) {
                return glm::distance(other, birdXZ) < kPedestrianScareRadius;
            });
        }
        if (scared) {
            m_Flush[index] = 1;
            continue;
        }
        UpdateGroundBehaviour(bird, dt);
        bird.restRemaining -= dt;
        if (bird.restRemaining <= 0.0f) StartFlight(bird, playerPosition, false);
    }

    // Contagio: si una se asusta, las que estan al lado se levantan con ella
    for (size_t index = 0; index < m_Birds.size(); ++index) {
        if (m_Flush[index] != 1) continue;
        const glm::vec2 source(m_Birds[index].position.x, m_Birds[index].position.z);
        for (size_t other = 0; other < m_Birds.size(); ++other) {
            if (m_Flush[other] != 0 || m_Birds[other].IsFlying()) continue;
            const glm::vec2 otherXZ(m_Birds[other].position.x, m_Birds[other].position.z);
            if (glm::distance(source, otherXZ) < kChainRadius && Unit() < kChainChance) m_Flush[other] = 2;
        }
    }
    for (size_t index = 0; index < m_Birds.size(); ++index) {
        if (m_Flush[index] != 0) StartFlight(m_Birds[index], playerPosition, true);
    }
}

void BirdFlock::StartFlight(Bird& bird, const glm::vec3& playerPosition, bool scared) {
    if (m_Spots.empty()) {
        bird.restRemaining = 5.0f;
        return;
    }
    const glm::vec2 from(bird.position.x, bird.position.z);
    const glm::vec2 playerXZ(playerPosition.x, playerPosition.z);
    glm::vec2 away = from - playerXZ;
    away = glm::length(away) > 0.05f ? glm::normalize(away) : glm::vec2(std::cos(bird.phase), std::sin(bird.phase));

    const float minDistance = scared ? 14.0f : 6.0f;
    const float maxDistance = scared ? 40.0f : 28.0f;

    // Busca un sitio dentro de `pool`: lejos del ave, libre y, si huye, en direccion contraria al jugador.
    const auto search = [&](const std::vector<size_t>& pool, int attempts, bool awayOnly) -> const BirdSpot* {
        if (pool.empty()) return nullptr;
        std::uniform_int_distribution<size_t> pick(0, pool.size() - 1);
        const BirdSpot* found = nullptr;
        float bestScore = -1.0e9f;
        for (int attempt = 0; attempt < attempts; ++attempt) {
            const BirdSpot& spot = m_Spots[pool[pick(m_Random)]];
            const glm::vec2 to(spot.position.x, spot.position.z);
            const float distance = glm::distance(from, to);
            if (distance < minDistance || distance > maxDistance) continue;
            const bool taken = std::any_of(m_Birds.begin(), m_Birds.end(), [&](const Bird& other) {
                if (&other == &bird) return false;
                const glm::vec3& at = other.IsFlying() ? other.target : other.position;
                return glm::distance(at, spot.position) < 0.7f;
            });
            if (taken) continue;
            const float awayDot = glm::dot((to - from) / distance, away);
            if (awayOnly && awayDot < -0.1f) continue;                       // nunca volar hacia el jugador
            float score = Unit();
            if (scared) {
                score += 2.0f * awayDot;                                     // alejarse del jugador
                if (glm::distance(to, playerXZ) < 9.0f) score -= 3.0f;       // no aterrizar junto al jugador
            }
            if (score > bestScore) {
                bestScore = score;
                found = &spot;
            }
        }
        return found;
    };

    // Al huir buscan refugio en ramas y postes con mas frecuencia; tranquilas tambien los visitan
    const bool preferElevated = Unit() < (scared ? 0.65f : 0.45f);
    const std::vector<size_t>& first = preferElevated ? m_ElevatedSpots : m_GroundSpots;
    const std::vector<size_t>& second = preferElevated ? m_GroundSpots : m_ElevatedSpots;
    const int attempts = scared ? 90 : 60;
    const BirdSpot* best = search(first, attempts, scared);
    if (!best) best = search(second, attempts, scared);
    if (!best && scared) best = search(m_GroundSpots, attempts, false);   // ultimo recurso: cualquier direccion
    if (!best) {
        bird.restRemaining = 2.0f + Unit() * 3.0f;
        return;
    }

    const float horizontal = glm::distance(from, glm::vec2(best->position.x, best->position.z));
    const float speed = scared ? 8.5f : 5.5f;
    bird.origin = bird.position;
    bird.walking = false;
    bird.walkSpeed = 0.0f;
    bird.target = best->position;
    bird.targetPerch = best->kind;
    bird.scared = scared;
    bird.flightDuration = std::max(1.6f, horizontal / speed);
    bird.flightRemaining = bird.flightDuration;
    // vuelan alto: entre 5 y 10 m sobre la ruta recta, y entre 8 y 16 m si huyen
    bird.flightPeak = scared ? 8.0f + Unit() * 8.0f : 5.0f + Unit() * 5.0f;
    bird.flapRate = scared ? 24.0f : 16.0f;
    const glm::vec2 heading(bird.target.x - bird.origin.x, bird.target.z - bird.origin.z);
    if (glm::dot(heading, heading) > 1.0e-4f) bird.yaw = std::atan2(heading.x, heading.y);
}

void BirdFlock::UpdateGroundBehaviour(Bird& bird, float dt) {
    // Vigilancia: la cabeza gira a un lado y a otro con pausas, como un ave atenta a su alrededor
    bird.lookTimer -= dt;
    if (bird.lookTimer <= 0.0f) {
        const float side = Unit() < 0.5f ? -1.0f : 1.0f;
        bird.lookYawTarget = Unit() < 0.25f ? 0.0f : side * (0.35f + Unit() * 0.8f);
        bird.lookTimer = 0.6f + Unit() * 2.4f;
    }
    bird.lookYaw += (bird.lookYawTarget - bird.lookYaw) * std::min(1.0f, dt * 9.0f);
    if (bird.peckTimer > 0.0f) bird.peckTimer = std::max(0.0f, bird.peckTimer - dt);

    if (bird.perch != BirdPerch::Ground) return;
    if (bird.walking) {
        glm::vec3 toTarget = bird.walkTarget - bird.position;
        toTarget.y = 0.0f;
        const float distance = glm::length(toTarget);
        if (distance < 0.04f) {
            bird.walking = false;
            bird.walkSpeed = 0.0f;
            return;
        }
        const glm::vec3 direction = toTarget / distance;
        // se orienta hacia donde camina (giro suave) y avanza al paso de un ave que anda con calma
        const float wantedYaw = std::atan2(direction.x, direction.z);
        float difference = std::remainder(wantedYaw - bird.yaw, glm::two_pi<float>());
        bird.yaw += difference * std::min(1.0f, dt * 7.0f);
        bird.walkSpeed = 0.45f;
        bird.position += direction * std::min(distance, bird.walkSpeed * dt);
        bird.walkCycle += dt * 2.0f * glm::pi<float>() * 3.2f;
    } else {
        bird.walkSpeed = 0.0f;
        if (bird.peckTimer <= 0.0f && Unit() < dt * 0.22f) bird.peckTimer = 0.9f;
        if (bird.peckTimer <= 0.0f && Unit() < dt * 0.10f) {
            const float angle = Unit() * glm::two_pi<float>();
            const float reach = 0.25f + Unit() * 0.4f;
            bird.walkTarget = bird.home + glm::vec3(std::sin(angle), 0.0f, std::cos(angle)) * reach;
            bird.walking = true;
        }
    }
}

void BirdFlock::AdvanceFlight(Bird& bird, float dt) {
    bird.flightRemaining = std::max(0.0f, bird.flightRemaining - dt);
    const float t = 1.0f - bird.flightRemaining / bird.flightDuration;
    const float smooth = t * t * (3.0f - 2.0f * t);
    const float progress = glm::mix(t, smooth, 0.5f);
    const float hump = std::pow(std::max(0.0f, std::sin(glm::pi<float>() * t)), 0.75f);

    glm::vec3 point = glm::mix(bird.origin, bird.target, progress);
    point.y += bird.flightPeak * hump + std::sin(bird.phase * 5.0f) * 0.10f * hump;

    // cabeceo segun suba o baje
    const glm::vec3 delta = point - bird.position;
    const float horizontalSpeed = glm::length(glm::vec2(delta.x, delta.z)) / dt;
    const float verticalSpeed = delta.y / dt;
    const float wanted = std::clamp(-std::atan2(verticalSpeed, std::max(horizontalSpeed, 0.5f)), -0.8f, 0.8f);
    bird.pitch += (wanted - bird.pitch) * std::min(1.0f, dt * 8.0f);
    bird.position = point;

    if (bird.flightRemaining <= 0.0f) {
        bird.position = bird.target;
        bird.home = bird.target;
        bird.walking = false;
        bird.walkSpeed = 0.0f;
        bird.perch = bird.targetPerch;
        bird.pitch = 0.0f;
        bird.restRemaining = (bird.scared ? 10.0f : 8.0f) + Unit() * (bird.scared ? 20.0f : 25.0f);
        bird.scared = false;
    }
}

} // namespace Bazuko
