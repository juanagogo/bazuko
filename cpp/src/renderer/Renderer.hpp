#pragma once
#include <memory>
#include <vector>
#include <glm/glm.hpp>
#include "Camera.hpp"
#include "Shader.hpp"
#include "Buffer.hpp"
#include "Mesh.hpp"

namespace Bazuko {

struct alignas(16) CameraBlockData {
    glm::mat4 view;
    glm::mat4 projection;
    glm::mat4 viewProjection;
    glm::vec3 cameraPos;
    float time;
};

struct alignas(16) LightBlockData {
    glm::vec3 sunDir;
    float _pad0 = 0.0f;
    glm::vec3 sunColor;
    float _pad1 = 0.0f;
    glm::vec3 ambientColor;
    float _pad2 = 0.0f;
    glm::vec3 fogColor;
    float fogDensity = 0.012f;
};

class Renderer {
public:
    Renderer();
    ~Renderer() = default;

    void SetViewport(int x, int y, int width, int height);
    void BeginScene(const Camera& camera, float time);
    void EndScene();

    void Submit(const Mesh& mesh, const glm::mat4& transform, const glm::vec4& albedo = glm::vec4(1.0f), bool useTexture = false, bool doubleSided = false, const std::vector<glm::mat4>* skinMatrices = nullptr, int alphaMode = 0, float alphaCutoff = 0.5f);
    void SetWireframe(bool wireframe);

    Shader& GetDefaultShader() { return *m_DefaultShader; }
    LightBlockData& GetLighting() { return m_LightingData; }

private:
    std::unique_ptr<Shader> m_DefaultShader;
    std::unique_ptr<UniformBuffer> m_CameraUBO;
    std::unique_ptr<UniformBuffer> m_LightUBO;
    std::unique_ptr<UniformBuffer> m_SkinUBO;

    CameraBlockData m_CameraData{};
    LightBlockData m_LightingData{};
    bool m_Wireframe = false;
};

} // namespace Bazuko
