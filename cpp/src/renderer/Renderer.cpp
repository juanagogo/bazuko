#include "Renderer.hpp"
#include "../core/Paths.hpp"
#include "Texture.hpp"
#include <glad/gl.h>
#include <algorithm>
#include <cmath>
#include <glm/gtc/matrix_transform.hpp>

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
    {   // sombras: el mapa del cuadro anterior (ver RenderShadowMap)
        const bool shadows = m_ShadowResolution > 0 && m_ShadowValid;
        m_DefaultShader->SetInt("uShadowEnabled", shadows ? 1 : 0);
        if (shadows) {
            m_DefaultShader->SetMat4("uShadowMatrix", m_ShadowMatrix);
            m_DefaultShader->SetVec3("uShadowCenter", m_ShadowCenter);
            m_DefaultShader->SetVec3("uShadowParams", glm::vec3(m_ShadowRadius, 2.0f * m_ShadowRadius / static_cast<float>(m_ShadowResolution), 1.0f / static_cast<float>(m_ShadowResolution)));
            glBindTextureUnit(4, m_ShadowTexture);
        }
    }
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
    // La ventana es multimuestra (MSAA 4x): glBlit a ella con otro tamano da GL_INVALID_OPERATION y la pantalla quedaba negra.
    // Se presenta con un triangulo de pantalla completa que muestrea la textura escalada.
    glBindFramebuffer(GL_FRAMEBUFFER, 0);
    glViewport(m_ScreenViewport[0], m_ScreenViewport[1], m_ScreenViewport[2], m_ScreenViewport[3]);
    if (!m_PresentShader) {
        m_PresentShader = std::make_unique<Shader>(Paths::Find("assets/shaders/present.vert"), Paths::Find("assets/shaders/present.frag"));
        glCreateVertexArrays(1, &m_PresentVao);
    }
    const GLboolean depthTest = glIsEnabled(GL_DEPTH_TEST), cull = glIsEnabled(GL_CULL_FACE), blend = glIsEnabled(GL_BLEND);
    glDisable(GL_DEPTH_TEST);
    glDisable(GL_CULL_FACE);
    glDisable(GL_BLEND);
    m_PresentShader->Bind();
    glTextureParameteri(m_ScaledColor, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
    glBindTextureUnit(0, m_ScaledColor);
    glBindVertexArray(m_PresentVao);
    glDrawArrays(GL_TRIANGLES, 0, 3);
    glBindVertexArray(0);
    m_PresentShader->Unbind();
    if (depthTest) glEnable(GL_DEPTH_TEST);
    if (cull) glEnable(GL_CULL_FACE);
    if (blend) glEnable(GL_BLEND);
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
    m_DefaultShader->SetInt("uWater", m_Water ? 1 : 0);
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

    if (m_ShadowResolution > 0 && m_ShadowCaster && alphaMode != 2 && !m_Sky && !m_Unlit && !m_Water && !m_Wireframe)
        RecordShadowCaster(mesh, transform, albedo, useTexture, alphaMode, alphaCutoff, skinMatrices);
    const bool mirrored = glm::determinant(glm::mat3(transform)) < 0.0f;   // una escala negativa (personaje espejado en el asiento del acompanante) invierte las caras
    if (mirrored) glFrontFace(GL_CW);
    if (doubleSided) glDisable(GL_CULL_FACE);
    if (alphaMode == 2) glDepthMask(GL_FALSE);
    mesh.Draw();
    if (alphaMode == 2) glDepthMask(GL_TRUE);
    if (doubleSided) glEnable(GL_CULL_FACE);
    if (mirrored) glFrontFace(GL_CCW);
}

void Renderer::RecordShadowCaster(const Mesh& mesh, const glm::mat4& transform, const glm::vec4& albedo, bool useTexture, int alphaMode, float alphaCutoff,
                                  const std::vector<glm::mat4>* skinMatrices) {
    ShadowDraw draw;
    draw.mesh = &mesh;
    draw.model = transform;
    draw.alphaMode = alphaMode;
    draw.alphaCutoff = alphaCutoff;
    draw.albedoAlpha = albedo.a;
    draw.useTexture = useTexture;
    draw.texture = useTexture ? Texture::LastBoundUnit0() : 0;
    draw.sway = m_Sway;
    draw.pushOut = m_PushOut;
    if (m_ShadowStatic) {   // la ciudad fija: se registra una sola vez y se reutiliza
        if (!m_StaticCaptured) m_StaticCasters.push_back(std::move(draw));
        return;
    }
    if (m_ShadowValid) {   // solo lo que cae dentro del alcance del mapa (las mallas gigantes siempre pasan)
        const float scale = std::max({glm::length(glm::vec3(transform[0])), glm::length(glm::vec3(transform[1])), glm::length(glm::vec3(transform[2]))});
        const float radius = mesh.GetBoundsRadius() * scale + 2.0f;
        if (radius < 60.0f) {
            const glm::vec3 center = glm::vec3(transform * glm::vec4(mesh.GetBoundsCenter(), 1.0f));
            if (glm::distance(glm::vec2(center.x, center.z), glm::vec2(m_ShadowCenter.x, m_ShadowCenter.z)) > m_ShadowRadius + radius) return;
        }
    }
    if (skinMatrices && !skinMatrices->empty()) draw.skin.assign(skinMatrices->begin(), skinMatrices->begin() + static_cast<std::ptrdiff_t>(std::min<size_t>(skinMatrices->size(), 128)));
    if (m_DynamicCasters.size() < 4096) m_DynamicCasters.push_back(std::move(draw));
}

void Renderer::DestroyShadowResources() {
    if (m_ShadowFbo) glDeleteFramebuffers(1, &m_ShadowFbo);
    if (m_StaticShadowFbo) glDeleteFramebuffers(1, &m_StaticShadowFbo);
    if (m_ShadowTexture) glDeleteTextures(1, &m_ShadowTexture);
    if (m_StaticShadowTexture) glDeleteTextures(1, &m_StaticShadowTexture);
    m_ShadowFbo = m_StaticShadowFbo = m_ShadowTexture = m_StaticShadowTexture = 0;
}

void Renderer::ConfigureShadows(int resolution, float radius) {
    if (resolution == m_ShadowResolution && std::abs(radius - m_ShadowRadius) < 0.01f) return;
    DestroyShadowResources();
    m_ShadowResolution = std::max(0, resolution);
    m_ShadowRadius = radius;
    m_ShadowValid = false;
    m_StaticDirty = true;
    m_DynamicCasters.clear();
    if (m_ShadowResolution == 0) return;
    if (!m_ShadowShader) m_ShadowShader = std::make_unique<Shader>(Paths::Find("assets/shaders/shadow.vert"), Paths::Find("assets/shaders/shadow.frag"));
    const auto makeDepth = [&](unsigned int& texture, unsigned int& framebuffer) {
        glCreateTextures(GL_TEXTURE_2D, 1, &texture);
        glTextureStorage2D(texture, 1, GL_DEPTH_COMPONENT24, m_ShadowResolution, m_ShadowResolution);
        glTextureParameteri(texture, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
        glTextureParameteri(texture, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
        glTextureParameteri(texture, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_BORDER);
        glTextureParameteri(texture, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_BORDER);
        const float border[4] = {1.0f, 1.0f, 1.0f, 1.0f};   // fuera del mapa todo queda iluminado
        glTextureParameterfv(texture, GL_TEXTURE_BORDER_COLOR, border);
        glTextureParameteri(texture, GL_TEXTURE_COMPARE_MODE, GL_COMPARE_REF_TO_TEXTURE);
        glTextureParameteri(texture, GL_TEXTURE_COMPARE_FUNC, GL_LEQUAL);
        glCreateFramebuffers(1, &framebuffer);
        glNamedFramebufferTexture(framebuffer, GL_DEPTH_ATTACHMENT, texture, 0);
        glNamedFramebufferDrawBuffer(framebuffer, GL_NONE);
        glNamedFramebufferReadBuffer(framebuffer, GL_NONE);
    };
    makeDepth(m_ShadowTexture, m_ShadowFbo);
    makeDepth(m_StaticShadowTexture, m_StaticShadowFbo);
}

void Renderer::DrawShadowCasters(const std::vector<ShadowDraw>& casters, bool cull) {
    for (const ShadowDraw& draw : casters) {
        if (cull) {   // lo registrado en cuadros en que el mapa estaba en otro sitio
            const float scale = std::max({glm::length(glm::vec3(draw.model[0])), glm::length(glm::vec3(draw.model[1])), glm::length(glm::vec3(draw.model[2]))});
            const float radius = draw.mesh->GetBoundsRadius() * scale + 2.0f;
            if (radius < 60.0f) {
                const glm::vec3 center = glm::vec3(draw.model * glm::vec4(draw.mesh->GetBoundsCenter(), 1.0f));
                if (glm::distance(glm::vec2(center.x, center.z), glm::vec2(m_ShadowCenter.x, m_ShadowCenter.z)) > m_ShadowRadius + radius) continue;
            }
        }
        m_ShadowShader->SetMat4("uModel", draw.model);
        const bool skinned = !draw.skin.empty();
        m_ShadowShader->SetInt("uSkinned", skinned ? 1 : 0);
        m_ShadowShader->SetInt("uBoneCount", static_cast<int>(draw.skin.size()));
        if (skinned) m_SkinUBO->SetData(draw.skin.data(), draw.skin.size() * sizeof(glm::mat4));
        m_ShadowShader->SetFloat("uSway", draw.sway);
        m_ShadowShader->SetFloat("uPushOut", draw.pushOut);
        m_ShadowShader->SetInt("uAlphaMode", draw.alphaMode);
        m_ShadowShader->SetFloat("uAlphaCutoff", draw.alphaCutoff);
        m_ShadowShader->SetFloat("uAlbedoAlpha", draw.albedoAlpha);
        m_ShadowShader->SetInt("uUseTexture", draw.useTexture ? 1 : 0);
        if (draw.alphaMode == 1 && draw.useTexture && draw.texture) glBindTextureUnit(0, draw.texture);
        draw.mesh->Draw();
    }
}

void Renderer::RenderShadowMap(const glm::vec3& toLight, const glm::vec3& focus) {
    if (m_ShadowResolution <= 0 || !m_ShadowShader) { m_DynamicCasters.clear(); return; }
    if (!m_StaticCaptured && !m_StaticCasters.empty()) { m_StaticCaptured = true; m_StaticDirty = true; }
    const glm::vec3 light = glm::normalize(toLight);
    const bool moved = !m_ShadowValid || glm::distance(glm::vec2(focus.x, focus.z), glm::vec2(m_ShadowCenter.x, m_ShadowCenter.z)) > 0.3f * m_ShadowRadius;
    const bool turned = glm::dot(light, m_ShadowLightDirection) < 0.99996f;   // el sol avanza ~0,1 grado por segundo: se rehace cada ~5 s
    if (moved || turned) {
        m_ShadowCenter = glm::vec3(focus.x, 0.0f, focus.z);
        m_ShadowLightDirection = light;
        const float distance = m_ShadowRadius + 160.0f;   // la luz queda sobre los edificios mas altos
        const glm::mat4 view = glm::lookAt(m_ShadowCenter + light * distance, m_ShadowCenter, glm::vec3(0.0f, 1.0f, 0.0f));
        const glm::mat4 projection = glm::ortho(-m_ShadowRadius, m_ShadowRadius, -m_ShadowRadius, m_ShadowRadius, 1.0f, distance + m_ShadowRadius + 140.0f);
        m_LightViewProjection = projection * view;
        const glm::mat4 bias = glm::translate(glm::mat4(1.0f), glm::vec3(0.5f)) * glm::scale(glm::mat4(1.0f), glm::vec3(0.5f));
        m_ShadowMatrix = bias * m_LightViewProjection;
        m_StaticDirty = true;
    }

    GLint viewport[4];
    glGetIntegerv(GL_VIEWPORT, viewport);
    GLint previousFramebuffer = 0;
    glGetIntegerv(GL_FRAMEBUFFER_BINDING, &previousFramebuffer);
    glViewport(0, 0, m_ShadowResolution, m_ShadowResolution);
    glDisable(GL_CULL_FACE);
    glDisable(GL_BLEND);
    glEnable(GL_POLYGON_OFFSET_FILL);
    glPolygonOffset(2.0f, 4.0f);
    glDepthMask(GL_TRUE);
    m_ShadowShader->Bind();
    m_ShadowShader->SetMat4("uLightViewProjection", m_LightViewProjection);
    const float one = 1.0f;
    if (m_StaticDirty && m_StaticCaptured) {   // la ciudad fija solo se rehace al recentrar el mapa o al girar la luz
        glBindFramebuffer(GL_FRAMEBUFFER, m_StaticShadowFbo);
        glClearNamedFramebufferfv(m_StaticShadowFbo, GL_DEPTH, 0, &one);
        DrawShadowCasters(m_StaticCasters, false);
        m_StaticDirty = false;
    }
    if (m_StaticCaptured) glCopyImageSubData(m_StaticShadowTexture, GL_TEXTURE_2D, 0, 0, 0, 0, m_ShadowTexture, GL_TEXTURE_2D, 0, 0, 0, 0,
                                             m_ShadowResolution, m_ShadowResolution, 1);
    else glClearNamedFramebufferfv(m_ShadowFbo, GL_DEPTH, 0, &one);
    glBindFramebuffer(GL_FRAMEBUFFER, m_ShadowFbo);
    DrawShadowCasters(m_DynamicCasters, true);   // personas, carros y objetos que se vieron en este cuadro
    m_DynamicCasters.clear();
    m_ShadowShader->Unbind();
    glDisable(GL_POLYGON_OFFSET_FILL);
    glEnable(GL_CULL_FACE);
    glEnable(GL_BLEND);
    glBindFramebuffer(GL_FRAMEBUFFER, static_cast<GLuint>(previousFramebuffer));
    glViewport(viewport[0], viewport[1], viewport[2], viewport[3]);
    m_ShadowValid = true;
}

void Renderer::SetWireframe(bool wireframe) {
    m_Wireframe = wireframe;
    glPolygonMode(GL_FRONT_AND_BACK, wireframe ? GL_LINE : GL_FILL);
}

} // namespace Bazuko
