#include "Renderer.hpp"
#include "../core/Paths.hpp"
#include <glad/gl.h>
#include <algorithm>

namespace Bazuko {

Renderer::Renderer() {
    glEnable(GL_DEPTH_TEST);
    glDepthFunc(GL_LESS);

    glEnable(GL_CULL_FACE);
    glCullFace(GL_BACK);
    glFrontFace(GL_CCW);

    glEnable(GL_BLEND);
    glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);

    glEnable(GL_MULTISAMPLE);

    m_DefaultShader = std::make_unique<Shader>(
        Paths::Find("assets/shaders/default.vert"),
        Paths::Find("assets/shaders/default.frag")
    );

    m_CameraUBO = std::make_unique<UniformBuffer>(sizeof(CameraBlockData), 0);
    m_LightUBO = std::make_unique<UniformBuffer>(sizeof(LightBlockData), 1);
    m_SkinUBO = std::make_unique<UniformBuffer>(128 * sizeof(glm::mat4), 2);

    m_LightingData.sunDir = glm::normalize(glm::vec3(-0.4f, -0.8f, -0.5f));
    m_LightingData.sunColor = glm::vec3(0.95f, 0.90f, 0.85f);
    m_LightingData.ambientColor = glm::vec3(0.35f, 0.38f, 0.45f);
    m_LightingData.fogColor = glm::vec3(0.45f, 0.48f, 0.52f);
    m_LightingData.fogDensity = 0.015f;

    m_LightUBO->SetData(&m_LightingData, sizeof(LightBlockData));
}

void Renderer::SetViewport(int x, int y, int width, int height) {
    glViewport(x, y, width, height);
}

void Renderer::BeginScene(const Camera& camera, float time) {
    glClearColor(m_LightingData.fogColor.r, m_LightingData.fogColor.g, m_LightingData.fogColor.b, 1.0f);
    glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);

    m_CameraData.view = camera.GetViewMatrix();
    m_CameraData.projection = camera.GetProjectionMatrix();
    m_CameraData.viewProjection = camera.GetViewProjectionMatrix();
    m_CameraData.cameraPos = camera.GetPosition();
    m_CameraData.time = time;

    m_CameraUBO->SetData(&m_CameraData, sizeof(CameraBlockData));
    m_LightUBO->SetData(&m_LightingData, sizeof(LightBlockData));

    m_DefaultShader->Bind();
}

void Renderer::EndScene() {
    m_DefaultShader->Unbind();
}

void Renderer::Submit(const Mesh& mesh, const glm::mat4& transform, const glm::vec4& albedo, bool useTexture, bool doubleSided, const std::vector<glm::mat4>* skinMatrices, int alphaMode, float alphaCutoff) {
    m_DefaultShader->SetMat4("uModel", transform);
    m_DefaultShader->SetVec4("uAlbedo", albedo);
    m_DefaultShader->SetInt("uUseTexture", useTexture ? 1 : 0);
    m_DefaultShader->SetInt("uAlphaMode", alphaMode);
    m_DefaultShader->SetFloat("uAlphaCutoff", alphaCutoff);
    const bool skinned = skinMatrices && !skinMatrices->empty();
    m_DefaultShader->SetInt("uSkinned", skinned ? 1 : 0);
    const size_t boneCount = skinned ? std::min<size_t>(skinMatrices->size(), 128) : 0;
    m_DefaultShader->SetInt("uBoneCount", static_cast<int>(boneCount));
    if (skinned) m_SkinUBO->SetData(skinMatrices->data(), boneCount * sizeof(glm::mat4));

    if (doubleSided) glDisable(GL_CULL_FACE);
    if (alphaMode == 2) glDepthMask(GL_FALSE);
    mesh.Draw();
    if (alphaMode == 2) glDepthMask(GL_TRUE);
    if (doubleSided) glEnable(GL_CULL_FACE);
}

void Renderer::SetWireframe(bool wireframe) {
    m_Wireframe = wireframe;
    glPolygonMode(GL_FRONT_AND_BACK, wireframe ? GL_LINE : GL_FILL);
}

} // namespace Bazuko
