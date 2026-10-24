#include "Ragdoll.hpp"

#include <algorithm>
#include <glm/gtc/matrix_transform.hpp>
#define GLM_ENABLE_EXPERIMENTAL
#include <glm/gtx/quaternion.hpp>

namespace Bazuko {

Ragdoll::Ragdoll() {
    m_BoneMesh = Mesh::CreateRoundedBox({1.0f, 1.0f, 1.0f}, 0.22f, 3);
    m_HeadMesh = Mesh::CreateRoundedBox({0.26f, 0.30f, 0.25f}, 0.12f, 4);
    m_JointMesh = Mesh::CreateRoundedBox({0.14f, 0.14f, 0.14f}, 0.06f, 3);

    constexpr std::array<std::pair<size_t, size_t>, 15> joints{{
        {0, 1}, {1, 2}, {2, 3},
        {1, 4}, {4, 5}, {5, 6},
        {1, 7}, {7, 8}, {8, 9},
        {0, 10}, {10, 11}, {11, 12},
        {0, 13}, {13, 14}, {14, 15}
    }};
    for (size_t i = 0; i < joints.size(); ++i) {
        m_Constraints[i].first = joints[i].first;
        m_Constraints[i].second = joints[i].second;
    }
    m_FloorHeights.fill(0.07f);
    m_FloorHeights[3] = 0.15f;
}

void Ragdoll::Begin(const glm::vec3& position, float yaw, const glm::vec3& impactVelocity,
                    const CharacterLook& look) {
    const glm::mat4 rotation = glm::rotate(glm::mat4(1.0f), yaw, {0.0f, 1.0f, 0.0f});
    const auto worldPoint = [&](const glm::vec3& local) {
        return position + glm::vec3(rotation * glm::vec4(local, 0.0f));
    };
    const std::array<glm::vec3, 16> local{{
        {0.0f, 0.92f, 0.0f}, {0.0f, 1.16f, 0.0f}, {0.0f, 1.53f, 0.0f}, {0.0f, 1.73f, 0.0f},
        {-0.23f, 1.34f, 0.0f}, {-0.38f, 1.12f, 0.0f}, {-0.44f, 0.91f, 0.0f},
        {0.23f, 1.34f, 0.0f}, {0.38f, 1.12f, 0.0f}, {0.44f, 0.91f, 0.0f},
        {-0.13f, 0.84f, 0.0f}, {-0.14f, 0.47f, 0.0f}, {-0.14f, 0.09f, 0.0f},
        {0.13f, 0.84f, 0.0f}, {0.14f, 0.47f, 0.0f}, {0.14f, 0.09f, 0.0f}
    }};
    glm::vec3 spinAxis = glm::cross(glm::vec3(0.0f, 1.0f, 0.0f), impactVelocity);
    if (glm::dot(spinAxis, spinAxis) < 1e-5f) spinAxis = {0.0f, 0.0f, 1.0f};
    else spinAxis = glm::normalize(spinAxis);
    for (size_t i = 0; i < local.size(); ++i) {
        m_Positions[i] = worldPoint(local[i]);
        const glm::vec3 angularVelocity = glm::cross(spinAxis * 2.2f, m_Positions[i] - worldPoint(local[0]));
        m_Velocities[i] = impactVelocity + angularVelocity;
    }
    for (auto& constraint : m_Constraints) {
        constraint.length = glm::distance(m_Positions[constraint.first], m_Positions[constraint.second]);
    }
    const int skinIndex = std::clamp(look.pielIdx, 0, static_cast<int>(SkinPalettes.size()) - 1);
    const int clothesIndex = std::clamp(look.ropaColorIdx, 0, static_cast<int>(ClothingPalettes.size()) - 1);
    const int shoeIndex = std::clamp(look.calzadoColorIdx, 0, static_cast<int>(ShoePalettes.size()) - 1);
    m_SkinColor = SkinPalettes[static_cast<size_t>(skinIndex)];
    m_ClothesColor = ClothingPalettes[static_cast<size_t>(clothesIndex)];
    m_ShoeColor = ShoePalettes[static_cast<size_t>(shoeIndex)];
    m_Active = true;
}

void Ragdoll::Update(float dt) {
    if (!m_Active || dt <= 0.0f) return;
    float remaining = std::min(dt, 0.25f);
    while (remaining > 0.0f) {
        const float step = std::min(remaining, 1.0f / 60.0f);
        remaining -= step;
        for (size_t i = 0; i < m_Positions.size(); ++i) {
            m_Velocities[i] += glm::vec3(0.0f, -9.8f, 0.0f) * step;
            m_Velocities[i] *= std::exp(-0.18f * step);
            m_Positions[i] += m_Velocities[i] * step;
            if (m_Positions[i].y < m_FloorHeights[i]) {
                m_Positions[i].y = m_FloorHeights[i];
                if (m_Velocities[i].y < 0.0f) m_Velocities[i].y *= -0.12f;
                m_Velocities[i].x *= 0.78f;
                m_Velocities[i].z *= 0.78f;
            }
        }
        for (int iteration = 0; iteration < 7; ++iteration) {
            for (const auto& constraint : m_Constraints) {
                glm::vec3& first = m_Positions[constraint.first];
                glm::vec3& second = m_Positions[constraint.second];
                const glm::vec3 delta = second - first;
                const float distance = glm::length(delta);
                if (distance < 1e-5f) continue;
                const glm::vec3 correction = delta * ((distance - constraint.length) / distance * 0.5f);
                first += correction;
                second -= correction;
                m_Velocities[constraint.first] += correction * (0.08f / step);
                m_Velocities[constraint.second] -= correction * (0.08f / step);
            }
            for (size_t i = 0; i < m_Positions.size(); ++i) {
                m_Positions[i].y = std::max(m_Positions[i].y, m_FloorHeights[i]);
            }
        }
    }
}

void Ragdoll::Draw(Renderer& renderer) const {
    if (!m_Active) return;
    const auto drawSegment = [&](size_t first, size_t second, float width, const glm::vec4& color) {
        const glm::vec3 delta = m_Positions[second] - m_Positions[first];
        const float length = glm::length(delta);
        if (length < 1e-4f) return;
        const glm::vec3 center = (m_Positions[first] + m_Positions[second]) * 0.5f;
        const glm::quat alignment = glm::rotation(glm::vec3(0.0f, 1.0f, 0.0f), delta / length);
        glm::mat4 transform = glm::translate(glm::mat4(1.0f), center)
            * glm::mat4_cast(alignment) * glm::scale(glm::mat4(1.0f), {width, length, width});
        renderer.Submit(*m_BoneMesh, transform, color);
    };
    drawSegment(0, 2, 0.34f, m_ClothesColor);
    drawSegment(4, 5, 0.13f, m_ClothesColor);
    drawSegment(5, 6, 0.11f, m_SkinColor);
    drawSegment(7, 8, 0.13f, m_ClothesColor);
    drawSegment(8, 9, 0.11f, m_SkinColor);
    drawSegment(10, 11, 0.17f, m_ClothesColor);
    drawSegment(11, 12, 0.13f, m_ShoeColor);
    drawSegment(13, 14, 0.17f, m_ClothesColor);
    drawSegment(14, 15, 0.13f, m_ShoeColor);
    glm::mat4 head = glm::translate(glm::mat4(1.0f), m_Positions[3]);
    renderer.Submit(*m_HeadMesh, head, m_SkinColor);
    for (size_t joint : {size_t{0}, size_t{1}, size_t{2}, size_t{4}, size_t{5}, size_t{7},
                         size_t{8}, size_t{10}, size_t{11}, size_t{13}, size_t{14}}) {
        renderer.Submit(*m_JointMesh, glm::translate(glm::mat4(1.0f), m_Positions[joint]), m_ClothesColor);
    }
}

glm::vec3 Ragdoll::GetPlayerPosition() const {
    return {m_Positions[0].x, std::max(0.0f, m_Positions[0].y - 0.92f), m_Positions[0].z};
}

glm::mat4 Ragdoll::GetCharacterTransform(float yaw, float recovery) const {
    const glm::vec3 spine = m_Positions[2] - m_Positions[0];
    const glm::vec3 up = glm::dot(spine, spine) > 1e-5f
        ? glm::normalize(spine) : glm::vec3(0.0f, 1.0f, 0.0f);
    const glm::quat facing = glm::angleAxis(yaw, glm::vec3(0.0f, 1.0f, 0.0f));
    const glm::quat fallenRotation = glm::rotation(glm::vec3(0.0f, 1.0f, 0.0f), up) * facing;
    const glm::quat bodyRotation = glm::normalize(glm::slerp(
        fallenRotation, facing, std::clamp(recovery, 0.0f, 1.0f)));
    const glm::vec3 playerPosition = GetPlayerPosition();
    const glm::vec3 standingPelvis(playerPosition.x, 0.92f, playerPosition.z);
    const glm::vec3 pelvis = glm::mix(m_Positions[0], standingPelvis,
                                      std::clamp(recovery, 0.0f, 1.0f));
    const glm::vec3 modelOrigin = pelvis - bodyRotation * glm::vec3(0.0f, 0.92f * 1.08f, 0.0f);
    return glm::translate(glm::mat4(1.0f), modelOrigin) * glm::mat4_cast(bodyRotation);
}

} // namespace Bazuko
