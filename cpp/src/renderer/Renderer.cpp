#include "Renderer.hpp"
#include "../core/Paths.hpp"
#include "Texture.hpp"
#include <glad/gl.h>
#include <algorithm>
#include <cmath>

namespace Bazuko {

Renderer::Renderer() {
    glEnable(GL_MULTISAMPLE);
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
    m_DefaultShader->SetInt("uGammaCorrect", m_GammaCorrect ? 1 : 0);
    m_DefaultShader->SetFloat("uWetness", m_Wetness);
    m_DefaultShader->SetFloat("uContrast", m_Contrast);
    m_DefaultShader->SetFloat("uSaturation", m_Saturation);
    m_DefaultShader->SetFloat("uHueDegrees", m_HueDegrees);
}

void Renderer::BeginScaledTarget() {
    m_ScaledActive = false;
    if (std::abs(m_RenderScale - 1.0f) < 0.01f) return;
    glGetIntegerv(GL_VIEWPORT, m_ScreenViewport);
    const int width = m_ScreenViewport[2];
    const int height = m_ScreenViewport[3];
    if (width <= 0 || height <= 0) return;
    const int scaledWidth = std::max(1, static_cast<int>(std::lround(width * m_RenderScale)));
    const int scaledHeight = std::max(1, static_cast<int>(std::lround(height * m_RenderScale)));
    if (!m_ScaledFbo || scaledWidth != m_ScaledWidth || scaledHeight != m_ScaledHeight) {
        if (m_ScaledFbo) {
            glDeleteFramebuffers(1, &m_ScaledFbo);
            glDeleteTextures(1, &m_ScaledColor);
            glDeleteRenderbuffers(1, &m_ScaledDepth);
            glDeleteFramebuffers(1, &m_MsFbo);
            glDeleteRenderbuffers(1, &m_MsColor);
            glDeleteRenderbuffers(1, &m_MsDepth);
        }
        // Destino multimuestra (MSAA 4x) donde se dibuja; se resuelve en la textura escalada y de ahi pasa a la ventana
        glCreateFramebuffers(1, &m_MsFbo);
        glCreateRenderbuffers(1, &m_MsColor);
        glNamedRenderbufferStorageMultisample(m_MsColor, 4, GL_RGBA8, scaledWidth, scaledHeight);
        glCreateRenderbuffers(1, &m_MsDepth);
        glNamedRenderbufferStorageMultisample(m_MsDepth, 4, GL_DEPTH_COMPONENT24, scaledWidth, scaledHeight);
        glNamedFramebufferRenderbuffer(m_MsFbo, GL_COLOR_ATTACHMENT0, GL_RENDERBUFFER, m_MsColor);
        glNamedFramebufferRenderbuffer(m_MsFbo, GL_DEPTH_ATTACHMENT, GL_RENDERBUFFER, m_MsDepth);
        glCreateFramebuffers(1, &m_ScaledFbo);
        glCreateTextures(GL_TEXTURE_2D, 1, &m_ScaledColor);
        glTextureStorage2D(m_ScaledColor, 1, GL_RGBA8, scaledWidth, scaledHeight);
        glTextureParameteri(m_ScaledColor, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
        glTextureParameteri(m_ScaledColor, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
        glCreateRenderbuffers(1, &m_ScaledDepth);
        glNamedRenderbufferStorage(m_ScaledDepth, GL_DEPTH_COMPONENT24, scaledWidth, scaledHeight);
        glNamedFramebufferTexture(m_ScaledFbo, GL_COLOR_ATTACHMENT0, m_ScaledColor, 0);
        glNamedFramebufferRenderbuffer(m_ScaledFbo, GL_DEPTH_ATTACHMENT, GL_RENDERBUFFER, m_ScaledDepth);
        m_ScaledWidth = scaledWidth;
        m_ScaledHeight = scaledHeight;
    }
    glBindFramebuffer(GL_FRAMEBUFFER, m_MsFbo);
    glViewport(0, 0, m_ScaledWidth, m_ScaledHeight);
    m_ScaledActive = true;
}

void Renderer::EndScaledTarget() {
    if (!m_ScaledActive) return;
    glBlitNamedFramebuffer(m_MsFbo, m_ScaledFbo, 0, 0, m_ScaledWidth, m_ScaledHeight, 0, 0, m_ScaledWidth, m_ScaledHeight,
                           GL_COLOR_BUFFER_BIT, GL_NEAREST);   // resuelve el suavizado
    glBlitNamedFramebuffer(m_ScaledFbo, 0, 0, 0, m_ScaledWidth, m_ScaledHeight,
                           m_ScreenViewport[0], m_ScreenViewport[1], m_ScreenViewport[0] + m_ScreenViewport[2],
                           m_ScreenViewport[1] + m_ScreenViewport[3], GL_COLOR_BUFFER_BIT, GL_LINEAR);
    glBindFramebuffer(GL_FRAMEBUFFER, 0);
    glViewport(m_ScreenViewport[0], m_ScreenViewport[1], m_ScreenViewport[2], m_ScreenViewport[3]);
    m_ScaledActive = false;
}

void Renderer::EndScene() {
    m_DefaultShader->Unbind();
}

void Renderer::Submit(const Mesh& mesh, const glm::mat4& transform, const glm::vec4& albedo, bool useTexture, bool doubleSided, const std::vector<glm::mat4>* skinMatrices, int alphaMode, float alphaCutoff, const Texture* specularTexture) {
    m_DefaultShader->SetMat4("uModel", transform);
    m_DefaultShader->SetVec4("uAlbedo", albedo);
    m_DefaultShader->SetInt("uUseTexture", useTexture ? 1 : 0);
    m_DefaultShader->SetInt("uUnlit", m_Sky ? 2 : (m_Unlit ? 1 : 0));
    m_DefaultShader->SetInt("uAlphaMode", alphaMode);
    m_DefaultShader->SetFloat("uAlphaCutoff", alphaCutoff);
    m_DefaultShader->SetInt("uUseSpecularTexture", specularTexture ? 1 : 0);
    m_DefaultShader->SetFloat("uPushOut", m_PushOut);
    m_DefaultShader->SetFloat("uSway", m_Sway);
    m_DefaultShader->SetFloat("uMetallic", m_Metallic);
    m_DefaultShader->SetVec2("uUvOffset", m_UvOffset);
    m_DefaultShader->SetFloat("uRoughness", m_Roughness);
    if (specularTexture) specularTexture->BindUnit(1);
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
