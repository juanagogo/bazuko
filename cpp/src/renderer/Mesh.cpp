#include "Mesh.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <numbers>

namespace Bazuko {

Mesh::Mesh(const std::vector<Vertex>& vertices, const std::vector<uint32_t>& indices)
    : m_IndexCount(static_cast<uint32_t>(indices.size())) {
    
    m_VBO = std::make_unique<VertexBuffer>(vertices.data(), vertices.size() * sizeof(Vertex));
    m_EBO = std::make_unique<IndexBuffer>(indices.data(), m_IndexCount);
    m_VAO = std::make_unique<VertexArray>();

    m_VAO->SetVertexBuffer(*m_VBO, 0, sizeof(Vertex), 0);
    m_VAO->SetIndexBuffer(*m_EBO);

    // Layout:
    // Location 0: vec3 position
    m_VAO->AddAttribute(0, {0, 3, GL_FLOAT, GL_FALSE, static_cast<GLuint>(offsetof(Vertex, position))});
    // Location 1: vec3 normal
    m_VAO->AddAttribute(0, {1, 3, GL_FLOAT, GL_FALSE, static_cast<GLuint>(offsetof(Vertex, normal))});
    // Location 2: vec2 uv
    m_VAO->AddAttribute(0, {2, 2, GL_FLOAT, GL_FALSE, static_cast<GLuint>(offsetof(Vertex, uv))});
    // Location 3: vec4 color
    m_VAO->AddAttribute(0, {3, 4, GL_FLOAT, GL_FALSE, static_cast<GLuint>(offsetof(Vertex, color))});
    m_VAO->AddAttribute(0, {4, 4, GL_FLOAT, GL_FALSE, static_cast<GLuint>(offsetof(Vertex, joints))});
    m_VAO->AddAttribute(0, {5, 4, GL_FLOAT, GL_FALSE, static_cast<GLuint>(offsetof(Vertex, weights))});
}

void Mesh::Draw() const {
    m_VAO->Bind();
    glDrawElements(GL_TRIANGLES, m_IndexCount, GL_UNSIGNED_INT, nullptr);
}

std::shared_ptr<Mesh> Mesh::CreateCube(const glm::vec3& size, const glm::vec4& color) {
    float hx = size.x * 0.5f;
    float hy = size.y * 0.5f;
    float hz = size.z * 0.5f;

    std::vector<Vertex> vertices = {
        // Front (+Z)
        {{-hx, -hy,  hz}, { 0.0f,  0.0f,  1.0f}, {0.0f, 0.0f}, color},
        {{ hx, -hy,  hz}, { 0.0f,  0.0f,  1.0f}, {1.0f, 0.0f}, color},
        {{ hx,  hy,  hz}, { 0.0f,  0.0f,  1.0f}, {1.0f, 1.0f}, color},
        {{-hx,  hy,  hz}, { 0.0f,  0.0f,  1.0f}, {0.0f, 1.0f}, color},

        // Back (-Z)
        {{ hx, -hy, -hz}, { 0.0f,  0.0f, -1.0f}, {0.0f, 0.0f}, color},
        {{-hx, -hy, -hz}, { 0.0f,  0.0f, -1.0f}, {1.0f, 0.0f}, color},
        {{-hx,  hy, -hz}, { 0.0f,  0.0f, -1.0f}, {1.0f, 1.0f}, color},
        {{ hx,  hy, -hz}, { 0.0f,  0.0f, -1.0f}, {0.0f, 1.0f}, color},

        // Left (-X)
        {{-hx, -hy, -hz}, {-1.0f,  0.0f,  0.0f}, {0.0f, 0.0f}, color},
        {{-hx, -hy,  hz}, {-1.0f,  0.0f,  0.0f}, {1.0f, 0.0f}, color},
        {{-hx,  hy,  hz}, {-1.0f,  0.0f,  0.0f}, {1.0f, 1.0f}, color},
        {{-hx,  hy, -hz}, {-1.0f,  0.0f,  0.0f}, {0.0f, 1.0f}, color},

        // Right (+X)
        {{ hx, -hy,  hz}, { 1.0f,  0.0f,  0.0f}, {0.0f, 0.0f}, color},
        {{ hx, -hy, -hz}, { 1.0f,  0.0f,  0.0f}, {1.0f, 0.0f}, color},
        {{ hx,  hy, -hz}, { 1.0f,  0.0f,  0.0f}, {1.0f, 1.0f}, color},
        {{ hx,  hy,  hz}, { 1.0f,  0.0f,  0.0f}, {0.0f, 1.0f}, color},

        // Top (+Y)
        {{-hx,  hy,  hz}, { 0.0f,  1.0f,  0.0f}, {0.0f, 0.0f}, color},
        {{ hx,  hy,  hz}, { 0.0f,  1.0f,  0.0f}, {1.0f, 0.0f}, color},
        {{ hx,  hy, -hz}, { 0.0f,  1.0f,  0.0f}, {1.0f, 1.0f}, color},
        {{-hx,  hy, -hz}, { 0.0f,  1.0f,  0.0f}, {0.0f, 1.0f}, color},

        // Bottom (-Y)
        {{-hx, -hy, -hz}, { 0.0f, -1.0f,  0.0f}, {0.0f, 0.0f}, color},
        {{ hx, -hy, -hz}, { 0.0f, -1.0f,  0.0f}, {1.0f, 0.0f}, color},
        {{ hx, -hy,  hz}, { 0.0f, -1.0f,  0.0f}, {1.0f, 1.0f}, color},
        {{-hx, -hy,  hz}, { 0.0f, -1.0f,  0.0f}, {0.0f, 1.0f}, color},
    };

    std::vector<uint32_t> indices;
    for (uint32_t i = 0; i < 6; ++i) {
        uint32_t base = i * 4;
        indices.push_back(base + 0);
        indices.push_back(base + 1);
        indices.push_back(base + 2);
        indices.push_back(base + 2);
        indices.push_back(base + 3);
        indices.push_back(base + 0);
    }

    return std::make_shared<Mesh>(vertices, indices);
}

std::shared_ptr<Mesh> Mesh::CreateRoundedBox(const glm::vec3& size, float radius, uint32_t segments, const glm::vec4& color) {
    const glm::vec3 half = size * 0.5f;
    radius = std::clamp(radius, 0.001f, std::min({half.x, half.y, half.z}));
    segments = std::max<uint32_t>(segments, 1);
    const std::array<std::array<glm::vec3, 3>, 6> faces{{
        {{{1, 0, 0}, {0, 0, -1}, {0, 1, 0}}},
        {{{-1, 0, 0}, {0, 0, 1}, {0, 1, 0}}},
        {{{0, 1, 0}, {1, 0, 0}, {0, 0, -1}}},
        {{{0, -1, 0}, {1, 0, 0}, {0, 0, 1}}},
        {{{0, 0, 1}, {1, 0, 0}, {0, 1, 0}}},
        {{{0, 0, -1}, {-1, 0, 0}, {0, 1, 0}}}
    }};
    std::vector<Vertex> vertices;
    std::vector<uint32_t> indices;
    const uint32_t sideVertexCount = (segments + 1) * (segments + 1);
    vertices.reserve(static_cast<size_t>(sideVertexCount) * faces.size());
    indices.reserve(static_cast<size_t>(segments) * segments * 6 * faces.size());
    for (const auto& face : faces) {
        const glm::vec3 normal = face[0];
        const glm::vec3 axisU = face[1];
        const glm::vec3 axisV = face[2];
        const float normalHalf = std::abs(normal.x) > 0.5f ? half.x : std::abs(normal.y) > 0.5f ? half.y : half.z;
        const float halfU = std::abs(axisU.x) > 0.5f ? half.x : std::abs(axisU.y) > 0.5f ? half.y : half.z;
        const float halfV = std::abs(axisV.x) > 0.5f ? half.x : std::abs(axisV.y) > 0.5f ? half.y : half.z;
        const glm::vec3 faceCenter = normal * normalHalf;
        const uint32_t base = static_cast<uint32_t>(vertices.size());
        for (uint32_t row = 0; row <= segments; ++row) {
            const float v = -1.0f + 2.0f * static_cast<float>(row) / segments;
            for (uint32_t column = 0; column <= segments; ++column) {
                const float u = -1.0f + 2.0f * static_cast<float>(column) / segments;
                const glm::vec3 surface = faceCenter + axisU * (u * halfU) + axisV * (v * halfV);
                const glm::vec3 inner = glm::clamp(surface, -half + glm::vec3(radius), half - glm::vec3(radius));
                glm::vec3 vertexNormal = surface - inner;
                if (glm::dot(vertexNormal, vertexNormal) < 1e-8f) vertexNormal = normal;
                else vertexNormal = glm::normalize(vertexNormal);
                vertices.push_back({inner + vertexNormal * radius, vertexNormal,
                                    {static_cast<float>(column) / segments, static_cast<float>(row) / segments}, color});
            }
        }
        for (uint32_t row = 0; row < segments; ++row) {
            for (uint32_t column = 0; column < segments; ++column) {
                const uint32_t a = base + row * (segments + 1) + column;
                const uint32_t b = a + 1;
                const uint32_t d = base + (row + 1) * (segments + 1) + column;
                const uint32_t c = d + 1;
                indices.insert(indices.end(), {a, b, c, c, d, a});
            }
        }
    }
    return std::make_shared<Mesh>(vertices, indices);
}

std::shared_ptr<Mesh> Mesh::CreateCylinder(float radius, float depth, uint32_t radialSegments, const glm::vec4& color) {
    radialSegments = std::max<uint32_t>(radialSegments, 3);
    const float halfDepth = depth * 0.5f;
    std::vector<Vertex> vertices;
    std::vector<uint32_t> indices;
    vertices.reserve(static_cast<size_t>(radialSegments + 1) * 4 + 2);
    indices.reserve(static_cast<size_t>(radialSegments) * 12);
    for (uint32_t index = 0; index <= radialSegments; ++index) {
        const float angle = 2.0f * std::numbers::pi_v<float> * static_cast<float>(index) / radialSegments;
        const glm::vec3 normal(std::cos(angle), std::sin(angle), 0.0f);
        for (const float z : {-halfDepth, halfDepth}) {
            vertices.push_back({normal * radius + glm::vec3(0.0f, 0.0f, z), normal,
                                {static_cast<float>(index) / radialSegments, z > 0.0f ? 1.0f : 0.0f}, color});
        }
    }
    for (uint32_t index = 0; index < radialSegments; ++index) {
        const uint32_t bottom = index * 2;
        const uint32_t nextBottom = bottom + 2;
        const uint32_t top = bottom + 1;
        const uint32_t nextTop = nextBottom + 1;
        indices.insert(indices.end(), {bottom, nextBottom, nextTop, nextTop, top, bottom});
    }
    for (int cap = 0; cap < 2; ++cap) {
        const float z = cap == 0 ? -halfDepth : halfDepth;
        const glm::vec3 normal(0.0f, 0.0f, cap == 0 ? -1.0f : 1.0f);
        const uint32_t center = static_cast<uint32_t>(vertices.size());
        vertices.push_back({{0.0f, 0.0f, z}, normal, {0.5f, 0.5f}, color});
        const uint32_t ring = static_cast<uint32_t>(vertices.size());
        for (uint32_t index = 0; index < radialSegments; ++index) {
            const float angle = 2.0f * std::numbers::pi_v<float> * static_cast<float>(index) / radialSegments;
            vertices.push_back({{std::cos(angle) * radius, std::sin(angle) * radius, z}, normal,
                                {0.5f + std::cos(angle) * 0.5f, 0.5f + std::sin(angle) * 0.5f}, color});
        }
        for (uint32_t index = 0; index < radialSegments; ++index) {
            const uint32_t current = ring + index;
            const uint32_t next = ring + (index + 1) % radialSegments;
            if (cap == 0) indices.insert(indices.end(), {center, next, current});
            else indices.insert(indices.end(), {center, current, next});
        }
    }
    return std::make_shared<Mesh>(vertices, indices);
}

std::shared_ptr<Mesh> Mesh::CreatePlane(float width, float depth, const glm::vec4& color, float uvScale) {
    float hx = width * 0.5f;
    float hz = depth * 0.5f;

    std::vector<Vertex> vertices = {
        {{-hx, 0.0f,  hz}, {0.0f, 1.0f, 0.0f}, {0.0f, uvScale}, color},
        {{ hx, 0.0f,  hz}, {0.0f, 1.0f, 0.0f}, {uvScale, uvScale}, color},
        {{ hx, 0.0f, -hz}, {0.0f, 1.0f, 0.0f}, {uvScale, 0.0f}, color},
        {{-hx, 0.0f, -hz}, {0.0f, 1.0f, 0.0f}, {0.0f, 0.0f}, color},
    };

    std::vector<uint32_t> indices = {
        0, 1, 2,
        2, 3, 0
    };

    return std::make_shared<Mesh>(vertices, indices);
}

} // namespace Bazuko
