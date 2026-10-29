#pragma once
#include <vector>
#include <memory>
#include <glm/glm.hpp>
#include "Buffer.hpp"
#include "VertexArray.hpp"

namespace Bazuko {

struct Vertex {
    glm::vec3 position;
    glm::vec3 normal;
    glm::vec2 uv;
    glm::vec4 color{1.0f, 1.0f, 1.0f, 1.0f};
    glm::vec4 joints{0.0f};
    glm::vec4 weights{0.0f};
};

class Mesh {
public:
    Mesh(const std::vector<Vertex>& vertices, const std::vector<uint32_t>& indices);
    ~Mesh() = default;

    void Draw() const;

    uint32_t GetIndexCount() const { return m_IndexCount; }

    // Procedural primitive factories
    static std::shared_ptr<Mesh> CreateCube(const glm::vec3& size = glm::vec3(1.0f), const glm::vec4& color = glm::vec4(1.0f));
    static std::shared_ptr<Mesh> CreateRoundedBox(const glm::vec3& size, float radius, uint32_t segments, const glm::vec4& color = glm::vec4(1.0f));
    static std::shared_ptr<Mesh> CreateCylinder(float radius, float depth, uint32_t radialSegments, const glm::vec4& color = glm::vec4(1.0f));
    static std::shared_ptr<Mesh> CreatePlane(float width, float depth, const glm::vec4& color = glm::vec4(1.0f), float uvScale = 1.0f);

private:
    std::unique_ptr<VertexBuffer> m_VBO;
    std::unique_ptr<IndexBuffer> m_EBO;
    std::unique_ptr<VertexArray> m_VAO;
    uint32_t m_IndexCount = 0;
};

} // namespace Bazuko
