#include "Renderer.hpp"
#include <cstdlib>
#include <string>
#include <cstdio>
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

    // tablas de clusters (se llenan cada cuadro en BuildClusters)
    m_ClusterLists.resize(static_cast<size_t>(kClusterX) * kClusterY * kClusterZ);
    m_ClusterTable.assign(m_ClusterLists.size() * 2, 0);
    glCreateBuffers(1, &m_ClusterTableBuffer);
    glNamedBufferData(m_ClusterTableBuffer, static_cast<GLsizeiptr>(m_ClusterTable.size() * sizeof(uint32_t)), nullptr, GL_DYNAMIC_DRAW);
    glCreateBuffers(1, &m_ClusterIndexBuffer);
    m_ClusterIndexCapacity = 65536;
    glNamedBufferData(m_ClusterIndexBuffer, static_cast<GLsizeiptr>(m_ClusterIndexCapacity * sizeof(uint32_t)), nullptr, GL_DYNAMIC_DRAW);
}

void Renderer::BuildClusters(const Camera& camera) {
    const float nearPlane = camera.GetNearPlane(), farPlane = camera.GetFarPlane();
    const glm::mat4& view = camera.GetViewMatrix();
    const glm::mat4& projection = camera.GetProjectionMatrix();
    for (auto& list : m_ClusterLists) list.clear();
    const float logRatio = std::log(farPlane / nearPlane);
    const auto sliceOf = [&](float depth) {
        return std::clamp(static_cast<int>(std::floor(std::log(std::max(depth, nearPlane) / nearPlane) / logRatio * static_cast<float>(kClusterZ))), 0, kClusterZ - 1);
    };
    for (int light = 0; light < m_LightingData.lampCount && light < LightBlockData::kMaxLampLights; ++light) {
        const glm::vec4& lamp = m_LightingData.lampPosition[light];
        const float radius = lamp.w;
        if (radius <= 0.0f || m_LightingData.lampColor[light].w <= 0.001f) continue;
        const glm::vec3 center = glm::vec3(view * glm::vec4(glm::vec3(lamp), 1.0f));
        const float depth = -center.z;
        if (depth + radius < nearPlane || depth - radius > farPlane) continue;
        const int sliceMin = sliceOf(depth - radius), sliceMax = sliceOf(depth + radius);
        int tileMinX = 0, tileMaxX = kClusterX - 1, tileMinY = 0, tileMaxY = kClusterY - 1;
        if (depth - radius > nearPlane) {   // la esfera esta toda delante del plano cercano: se proyecta su caja y se cubren las celdas que toca
            float minX = 1.0e9f, maxX = -1.0e9f, minY = 1.0e9f, maxY = -1.0e9f;
            for (int corner = 0; corner < 8; ++corner) {
                const glm::vec3 point = center + glm::vec3((corner & 1) ? radius : -radius, (corner & 2) ? radius : -radius, (corner & 4) ? radius : -radius);
                const glm::vec4 clip = projection * glm::vec4(point, 1.0f);
                if (clip.w <= 1.0e-4f) { minX = minY = -1.0e9f; maxX = maxY = 1.0e9f; break; }
                const glm::vec2 ndc(clip.x / clip.w, clip.y / clip.w);
                minX = std::min(minX, ndc.x); maxX = std::max(maxX, ndc.x);
                minY = std::min(minY, ndc.y); maxY = std::max(maxY, ndc.y);
            }
            if (maxX < -1.0f || minX > 1.0f || maxY < -1.0f || minY > 1.0f) continue;   // fuera de la pantalla
            tileMinX = std::clamp(static_cast<int>(std::floor((minX * 0.5f + 0.5f) * kClusterX)), 0, kClusterX - 1);
            tileMaxX = std::clamp(static_cast<int>(std::floor((maxX * 0.5f + 0.5f) * kClusterX)), 0, kClusterX - 1);
            tileMinY = std::clamp(static_cast<int>(std::floor((minY * 0.5f + 0.5f) * kClusterY)), 0, kClusterY - 1);
            tileMaxY = std::clamp(static_cast<int>(std::floor((maxY * 0.5f + 0.5f) * kClusterY)), 0, kClusterY - 1);
        }
        for (int slice = sliceMin; slice <= sliceMax; ++slice)
            for (int y = tileMinY; y <= tileMaxY; ++y)
                for (int x = tileMinX; x <= tileMaxX; ++x)
                    m_ClusterLists[static_cast<size_t>((slice * kClusterY + y) * kClusterX + x)].push_back(static_cast<uint32_t>(light));
    }
    m_ClusterIndices.clear();
    for (size_t cluster = 0; cluster < m_ClusterLists.size(); ++cluster) {
        m_ClusterTable[cluster * 2] = static_cast<uint32_t>(m_ClusterIndices.size());
        m_ClusterTable[cluster * 2 + 1] = static_cast<uint32_t>(m_ClusterLists[cluster].size());
        m_ClusterIndices.insert(m_ClusterIndices.end(), m_ClusterLists[cluster].begin(), m_ClusterLists[cluster].end());
    }
    glNamedBufferSubData(m_ClusterTableBuffer, 0, static_cast<GLsizeiptr>(m_ClusterTable.size() * sizeof(uint32_t)), m_ClusterTable.data());
    if (m_ClusterIndices.size() > m_ClusterIndexCapacity) {   // crece si hacen falta mas entradas
        while (m_ClusterIndexCapacity < m_ClusterIndices.size()) m_ClusterIndexCapacity *= 2;
        glNamedBufferData(m_ClusterIndexBuffer, static_cast<GLsizeiptr>(m_ClusterIndexCapacity * sizeof(uint32_t)), nullptr, GL_DYNAMIC_DRAW);
    }
    if (!m_ClusterIndices.empty())
        glNamedBufferSubData(m_ClusterIndexBuffer, 0, static_cast<GLsizeiptr>(m_ClusterIndices.size() * sizeof(uint32_t)), m_ClusterIndices.data());
    glBindBufferBase(GL_SHADER_STORAGE_BUFFER, 3, m_ClusterTableBuffer);
    glBindBufferBase(GL_SHADER_STORAGE_BUFFER, 4, m_ClusterIndexBuffer);
    int viewport[4]{};
    glGetIntegerv(GL_VIEWPORT, viewport);
    m_DefaultShader->SetFloat("uClusterNear", nearPlane);
    m_DefaultShader->SetFloat("uClusterFar", farPlane);
    m_DefaultShader->SetVec2("uViewportSize", glm::vec2(static_cast<float>(std::max(viewport[2], 1)), static_cast<float>(std::max(viewport[3], 1))));
}

void Renderer::SetViewport(int x, int y, int width, int height) {
    glViewport(x, y, width, height);
}

void Renderer::BeginScene(const Camera& camera, float time) {
    glClearColor(m_LightingData.fogColor.r, m_LightingData.fogColor.g, m_LightingData.fogColor.b, 1.0f);
    glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);
    if (m_GBufferActive) { const float gClear[4] = {0.5f, 1.0f, 0.0f, 1.0f}; glClearBufferfv(GL_COLOR, 1, gClear); }   // normal hacia arriba, sin reflectividad

    m_CameraData.view = camera.GetViewMatrix();
    m_CameraData.projection = camera.GetProjectionMatrix();
    m_CameraData.viewProjection = camera.GetViewProjectionMatrix();
    m_CameraData.cameraPos = camera.GetPosition();
    m_CameraData.time = time;

    m_CameraUBO->BindBase(0);   // con un segundo renderizador (vista previa del cambuche) los puntos de enlace los comparten los dos: cada uno vuelve a enlazar los suyos
    m_LightUBO->BindBase(1);
    m_SkinUBO->BindBase(2);
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
    m_DefaultShader->SetInt("uFarShadowEnabled", (m_FarEnabled && m_FarValid && m_FarTexture) ? 1 : 0);
    if (m_FarEnabled && m_FarValid && m_FarTexture) {
        m_DefaultShader->SetMat4("uFarShadowMatrix", m_FarMatrix);
        m_DefaultShader->SetVec3("uFarShadowCenter", m_FarCenter);
        glBindTextureUnit(7, m_FarTexture);
    }
    {   // sesgo de las sombras (BAZUKO_SHADOW_BIAS=base,pendiente,profundidad para probar otros valores)
        static glm::vec3 bias(0.5f, 1.0f, 0.00025f);   // menos sesgo que antes (1,5 / 2,5 / 0,0004): las piezas pequenas ya se sombrean a si mismas
        static bool read = false;
        if (!read) {
            read = true;
            if (const char* env = std::getenv("BAZUKO_SHADOW_BIAS")) std::sscanf(env, "%f,%f,%f", &bias.x, &bias.y, &bias.z);
        }
        m_DefaultShader->SetVec3("uShadowBias", bias);
    }
    m_DefaultShader->SetInt("uDebugShadow", std::getenv("BAZUKO_DEBUG_SHADOW") ? 1 : 0);
    m_DefaultShader->SetInt("uUltraShadowEnabled", (m_FarEnabled && m_UltraValid && m_UltraTexture) ? 1 : 0);
    if (m_FarEnabled && m_UltraValid && m_UltraTexture) {
        m_DefaultShader->SetMat4("uUltraShadowMatrix", m_UltraMatrix);
        m_DefaultShader->SetVec3("uUltraShadowCenter", m_UltraCenter);
        glBindTextureUnit(8, m_UltraTexture);
    }
    m_DefaultShader->SetInt("uGammaCorrect", m_GammaCorrect ? 1 : 0);
    m_DefaultShader->SetFloat("uWetness", m_Wetness);
    m_DefaultShader->SetFloat("uContrast", m_Contrast);
    m_DefaultShader->SetFloat("uSaturation", m_Saturation);
    m_DefaultShader->SetFloat("uHueDegrees", m_HueDegrees);
    m_DefaultShader->SetFloat("uHeightFog", m_HeightFog);
    {   // reflejos en pantalla: solo con camara en perspectiva, el cuadro anterior valido y el HDR activo
        static const bool noReflections = std::getenv("BAZUKO_NOSSR") != nullptr;
        const bool perspective = std::abs(m_CameraData.projection[3][3]) < 0.5f;
        const bool useSsr = !m_GBufferActive && m_ScreenReflections && m_PreviousFrameValid && m_HdrTarget && perspective && !noReflections && m_ScaledColor && m_ScaledDepth;
        m_DefaultShader->SetInt("uUseSsr", useSsr ? 1 : 0);
        if (useSsr) {
            m_DefaultShader->SetMat4("uPreviousViewProjection", m_PreviousViewProjection);
            glBindTextureUnit(5, m_ScaledColor);
            glBindTextureUnit(6, m_ScaledDepth);
        }
    }
    BuildClusters(camera);
}

namespace {
// Formato del buffer HDR: R11G11B10F (32 bits, la mitad de ancho de banda que RGBA16F) o RGBA16F con BAZUKO_HDRFORMAT=16 (pruebas)
GLenum HdrFormat() {
    static const char* choice = std::getenv("BAZUKO_HDRFORMAT");
    static const GLenum format = (choice && std::string(choice) == "16") ? GL_RGBA16F : GL_R11F_G11F_B10F;
    return format;
}
} // namespace

void Renderer::BeginScaledTarget() {
    m_ScaledActive = false;
    static const bool noHdr = std::getenv("BAZUKO_NOHDR") != nullptr;   // pruebas: dibuja directo a la ventana como antes (sin HDR ni ACES)
    m_HdrTarget = !noHdr;
    m_GBufferActive = false;
    if (!m_HdrTarget && std::abs(m_RenderScale - 1.0f) < 0.01f) return;
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
            glDeleteTextures(1, &m_ScaledDepth);
            m_PostWidth = 0;   // los recursos de post-proceso se recrean con el nuevo tamano
            m_PreviousFrameValid = false;
            if (m_MsNormal) glDeleteRenderbuffers(1, &m_MsNormal);
            if (m_ScaledNormal) glDeleteTextures(1, &m_ScaledNormal);
            m_MsNormal = m_ScaledNormal = 0;
            glDeleteFramebuffers(1, &m_MsFbo);
            glDeleteRenderbuffers(1, &m_MsColor);
            glDeleteRenderbuffers(1, &m_MsDepth);
        }
        // Destino multimuestra (MSAA 4x) donde se dibuja; se resuelve en la textura escalada y de ahi pasa a la ventana
        glCreateFramebuffers(1, &m_MsFbo);
        glCreateRenderbuffers(1, &m_MsColor);
        glNamedRenderbufferStorageMultisample(m_MsColor, 4, HdrFormat(), scaledWidth, scaledHeight);
        glCreateRenderbuffers(1, &m_MsDepth);
        glNamedRenderbufferStorageMultisample(m_MsDepth, 4, GL_DEPTH_COMPONENT24, scaledWidth, scaledHeight);
        glNamedFramebufferRenderbuffer(m_MsFbo, GL_COLOR_ATTACHMENT0, GL_RENDERBUFFER, m_MsColor);
        glNamedFramebufferRenderbuffer(m_MsFbo, GL_DEPTH_ATTACHMENT, GL_RENDERBUFFER, m_MsDepth);
        glCreateFramebuffers(1, &m_ScaledFbo);
        glCreateTextures(GL_TEXTURE_2D, 1, &m_ScaledColor);
        glTextureStorage2D(m_ScaledColor, 1, HdrFormat(), scaledWidth, scaledHeight);
        glTextureParameteri(m_ScaledColor, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
        glTextureParameteri(m_ScaledColor, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
        glCreateTextures(GL_TEXTURE_2D, 1, &m_ScaledDepth);   // profundidad resuelta: la lee el SSAO
        glTextureStorage2D(m_ScaledDepth, 1, GL_DEPTH_COMPONENT24, scaledWidth, scaledHeight);
        glTextureParameteri(m_ScaledDepth, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
        glTextureParameteri(m_ScaledDepth, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
        glTextureParameteri(m_ScaledDepth, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
        glTextureParameteri(m_ScaledDepth, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
        glNamedFramebufferTexture(m_ScaledFbo, GL_COLOR_ATTACHMENT0, m_ScaledColor, 0);
        glNamedFramebufferTexture(m_ScaledFbo, GL_DEPTH_ATTACHMENT, m_ScaledDepth, 0);
        glCreateRenderbuffers(1, &m_MsNormal);   // G-buffer: normal y reflectividad (se usa solo con los reflejos en pantalla activos)
        glNamedRenderbufferStorageMultisample(m_MsNormal, 4, GL_RGBA8, scaledWidth, scaledHeight);
        glNamedFramebufferRenderbuffer(m_MsFbo, GL_COLOR_ATTACHMENT1, GL_RENDERBUFFER, m_MsNormal);
        glCreateTextures(GL_TEXTURE_2D, 1, &m_ScaledNormal);
        glTextureStorage2D(m_ScaledNormal, 1, GL_RGBA8, scaledWidth, scaledHeight);
        glTextureParameteri(m_ScaledNormal, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
        glTextureParameteri(m_ScaledNormal, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
        glTextureParameteri(m_ScaledNormal, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
        glTextureParameteri(m_ScaledNormal, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
        glNamedFramebufferTexture(m_ScaledFbo, GL_COLOR_ATTACHMENT1, m_ScaledNormal, 0);
        m_ScaledWidth = scaledWidth;
        m_ScaledHeight = scaledHeight;
    }
    {   // reflejos en pantalla con la normal de cada pixel: necesitan HDR, la profundidad resuelta (SSAO activo) y camara en perspectiva
        static const bool noReflections = std::getenv("BAZUKO_NOSSR") != nullptr;
        const bool perspective = std::abs(m_CameraData.projection[3][3]) < 0.5f;
        m_GBufferActive = m_ScreenReflections && m_GBufferReflections && m_AoSamples > 0 && m_HdrTarget && perspective && !noReflections && m_MsNormal != 0;
        const GLenum buffers[2] = {GL_COLOR_ATTACHMENT0, GL_COLOR_ATTACHMENT1};
        glNamedFramebufferDrawBuffers(m_MsFbo, m_GBufferActive ? 2 : 1, buffers);
    }
    glBindFramebuffer(GL_FRAMEBUFFER, m_MsFbo);
    glViewport(0, 0, m_ScaledWidth, m_ScaledHeight);
    m_ScaledActive = true;
}

void Renderer::EndScaledTarget() {
    if (!m_ScaledActive) return;
    glBlitNamedFramebuffer(m_MsFbo, m_ScaledFbo, 0, 0, m_ScaledWidth, m_ScaledHeight, 0, 0, m_ScaledWidth, m_ScaledHeight,
                           GL_COLOR_BUFFER_BIT, GL_NEAREST);   // resuelve el suavizado
    if (m_AoSamples > 0 && !std::getenv("BAZUKO_NOPOST"))
        glBlitNamedFramebuffer(m_MsFbo, m_ScaledFbo, 0, 0, m_ScaledWidth, m_ScaledHeight, 0, 0, m_ScaledWidth, m_ScaledHeight, GL_DEPTH_BUFFER_BIT, GL_NEAREST);
    if (m_GBufferActive) {   // el G-buffer multimuestra pasa a una textura sencilla
        glNamedFramebufferReadBuffer(m_MsFbo, GL_COLOR_ATTACHMENT1);
        glNamedFramebufferDrawBuffer(m_ScaledFbo, GL_COLOR_ATTACHMENT1);
        glBlitNamedFramebuffer(m_MsFbo, m_ScaledFbo, 0, 0, m_ScaledWidth, m_ScaledHeight, 0, 0, m_ScaledWidth, m_ScaledHeight, GL_COLOR_BUFFER_BIT, GL_NEAREST);
        glNamedFramebufferReadBuffer(m_MsFbo, GL_COLOR_ATTACHMENT0);
        glNamedFramebufferDrawBuffer(m_ScaledFbo, GL_COLOR_ATTACHMENT0);
    }
    RunPostEffects();
    m_PreviousViewProjection = m_CameraData.viewProjection;
    m_PreviousFrameValid = m_AoSamples > 0 && !std::getenv("BAZUKO_NOPOST");
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
    m_PresentShader->SetInt("uToneMap", m_ToneMapping && m_HdrTarget ? 1 : 0);
    m_PresentShader->SetFloat("uExposure", m_Exposure);
    m_PresentShader->SetInt("uDebugBloom", std::getenv("BAZUKO_DEBUG_BLOOM") ? 1 : 0);
    {
        static const char* fsrModeEnv = std::getenv("BAZUKO_FSR_MODE");
        const int upscaleMode = fsrModeEnv ? std::clamp(std::atoi(fsrModeEnv), 0, 2) : m_UpscaleMode;
        static const char* sharpEnv = std::getenv("BAZUKO_SHARPEN");
        const float sharpness = sharpEnv ? static_cast<float>(std::atof(sharpEnv)) : m_FsrSharpness;
        m_PresentShader->SetInt("uUpscaleMode", upscaleMode);
        m_PresentShader->SetFloat("uSharpen", sharpness);
    }
    m_PresentShader->SetInt("uUseAo", m_PostAoReady ? 1 : 0);
    m_PresentShader->SetFloat("uBloomStrength", m_PostBloomReady ? m_BloomStrength : 0.0f);
    m_PresentShader->SetInt("uUseReflections", m_PostSsrReady ? 1 : 0);
    if (m_PostSsrReady) glBindTextureUnit(5, m_SsrTexture);
    m_PresentShader->SetInt("uUseVolume", m_PostVolumeReady ? 1 : 0);
    if (m_PostVolumeReady) glBindTextureUnit(4, m_VolumeTexture);
    if (m_PostAoReady) glBindTextureUnit(1, m_AoTexture[1]);
    if (m_PostBloomReady) glBindTextureUnit(2, m_BloomTexture[0]);
    float shaft = 0.0f;   // el sol debe estar delante de la camara y cerca de la pantalla
    if (m_ShaftStrength > 0.0f && m_AoSamples > 0 && !std::getenv("BAZUKO_NOPOST")) {
        const glm::vec4 clip = m_CameraData.viewProjection * glm::vec4(m_CameraData.cameraPos + m_ShaftToSun * 200.0f, 1.0f);
        if (clip.w > 0.1f) {
            const glm::vec2 uv = glm::vec2(clip.x, clip.y) / clip.w * 0.5f + 0.5f;
            m_PresentShader->SetVec2("uSunUv", uv);
            const float edge = std::max(std::abs(uv.x - 0.5f), std::abs(uv.y - 0.5f));
            shaft = m_ShaftStrength * std::clamp((1.1f - edge) / 0.6f, 0.0f, 1.0f);   // se desvanece cuando el sol sale de la pantalla
        }
    }
    if (std::getenv("BAZUKO_LOG_SHAFT")) std::fprintf(stderr, "SHAFT fuerza %.3f sol (%.2f, %.2f, %.2f)\n", shaft, m_ShaftToSun.x, m_ShaftToSun.y, m_ShaftToSun.z);
    m_PresentShader->SetFloat("uShaftStrength", shaft);
    m_PresentShader->SetVec3("uShaftColor", m_ShaftColor);
    if (shaft > 0.0f) glBindTextureUnit(3, m_ScaledDepth);
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

void Renderer::DrawFullscreen(Shader& shader) {
    shader.Bind();
    glBindVertexArray(m_PresentVao);
    glDrawArrays(GL_TRIANGLES, 0, 3);
    glBindVertexArray(0);
}

void Renderer::EnsurePostResources(int width, int height) {
    if (m_PostWidth == width && m_PostHeight == height) return;
    for (int i = 0; i < 2; ++i) {
        if (m_AoTexture[i]) { glDeleteTextures(1, &m_AoTexture[i]); glDeleteFramebuffers(1, &m_AoFbo[i]); }
        glCreateTextures(GL_TEXTURE_2D, 1, &m_AoTexture[i]);
        glTextureStorage2D(m_AoTexture[i], 1, GL_R8, std::max(1, width / 2), std::max(1, height / 2));
        glTextureParameteri(m_AoTexture[i], GL_TEXTURE_MIN_FILTER, GL_LINEAR);
        glTextureParameteri(m_AoTexture[i], GL_TEXTURE_MAG_FILTER, GL_LINEAR);
        glTextureParameteri(m_AoTexture[i], GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
        glTextureParameteri(m_AoTexture[i], GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
        glCreateFramebuffers(1, &m_AoFbo[i]);
        glNamedFramebufferTexture(m_AoFbo[i], GL_COLOR_ATTACHMENT0, m_AoTexture[i], 0);
    }
    for (int level = 0; level < kBloomLevels; ++level) {
        if (m_BloomTexture[level]) { glDeleteTextures(1, &m_BloomTexture[level]); glDeleteFramebuffers(1, &m_BloomFbo[level]); }
        glCreateTextures(GL_TEXTURE_2D, 1, &m_BloomTexture[level]);
        glTextureStorage2D(m_BloomTexture[level], 1, HdrFormat(), std::max(1, width >> (level + 2)), std::max(1, height >> (level + 2)));
        glTextureParameteri(m_BloomTexture[level], GL_TEXTURE_MIN_FILTER, GL_LINEAR);
        glTextureParameteri(m_BloomTexture[level], GL_TEXTURE_MAG_FILTER, GL_LINEAR);
        glTextureParameteri(m_BloomTexture[level], GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
        glTextureParameteri(m_BloomTexture[level], GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
        glCreateFramebuffers(1, &m_BloomFbo[level]);
        glNamedFramebufferTexture(m_BloomFbo[level], GL_COLOR_ATTACHMENT0, m_BloomTexture[level], 0);
    }
    if (m_VolumeTexture) { glDeleteTextures(1, &m_VolumeTexture); glDeleteFramebuffers(1, &m_VolumeFbo); }
    glCreateTextures(GL_TEXTURE_2D, 1, &m_VolumeTexture);
    glTextureStorage2D(m_VolumeTexture, 1, GL_RGBA16F, std::max(1, width / 2), std::max(1, height / 2));
    glTextureParameteri(m_VolumeTexture, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
    glTextureParameteri(m_VolumeTexture, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
    glTextureParameteri(m_VolumeTexture, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
    glTextureParameteri(m_VolumeTexture, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
    glCreateFramebuffers(1, &m_VolumeFbo);
    glNamedFramebufferTexture(m_VolumeFbo, GL_COLOR_ATTACHMENT0, m_VolumeTexture, 0);
    if (m_SsrTexture) { glDeleteTextures(1, &m_SsrTexture); glDeleteFramebuffers(1, &m_SsrFbo); }
    glCreateTextures(GL_TEXTURE_2D, 1, &m_SsrTexture);
    glTextureStorage2D(m_SsrTexture, 1, GL_RGBA16F, std::max(1, width / 2), std::max(1, height / 2));
    glTextureParameteri(m_SsrTexture, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
    glTextureParameteri(m_SsrTexture, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
    glTextureParameteri(m_SsrTexture, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
    glTextureParameteri(m_SsrTexture, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
    glCreateFramebuffers(1, &m_SsrFbo);
    glNamedFramebufferTexture(m_SsrFbo, GL_COLOR_ATTACHMENT0, m_SsrTexture, 0);
    m_PostWidth = width;
    m_PostHeight = height;
}

void Renderer::RunPostEffects() {
    static const bool noPost = std::getenv("BAZUKO_NOPOST") != nullptr;   // pruebas: sin SSAO ni bloom, para comparar
    static const char* postMode = std::getenv("BAZUKO_POST_MODE");   // medicion: solo `ao` o solo `bloom`
    const bool wantVolume = m_VolumeDensity > 0.0022f && m_AoSamples > 0 && m_ShadowValid && m_ShadowResolution > 0 && !noPost && !std::getenv("BAZUKO_NOVOLFOG");
    m_PostVolumeReady = false;
    m_PostSsrReady = false;
    const bool wantSsr = m_GBufferActive && m_AoSamples > 0 && !noPost;
    const bool wantAo = m_AoSamples > 0 && !noPost && (!postMode || std::string(postMode) == "ao"), wantBloom = m_BloomStrength > 0.0f && !noPost && (!postMode || std::string(postMode) == "bloom");
    m_PostAoReady = m_PostBloomReady = false;
    if (!wantAo && !wantBloom && !wantVolume && !wantSsr) return;
    if (!m_PresentVao) glCreateVertexArrays(1, &m_PresentVao);
    EnsurePostResources(m_ScaledWidth, m_ScaledHeight);
    const GLboolean depthTest = glIsEnabled(GL_DEPTH_TEST), cull = glIsEnabled(GL_CULL_FACE), blend = glIsEnabled(GL_BLEND);
    GLint blendSourceRgb = GL_SRC_ALPHA, blendDestinationRgb = GL_ONE_MINUS_SRC_ALPHA, blendSourceAlpha = GL_ONE, blendDestinationAlpha = GL_ONE_MINUS_SRC_ALPHA;
    glGetIntegerv(GL_BLEND_SRC_RGB, &blendSourceRgb);
    glGetIntegerv(GL_BLEND_DST_RGB, &blendDestinationRgb);
    glGetIntegerv(GL_BLEND_SRC_ALPHA, &blendSourceAlpha);
    glGetIntegerv(GL_BLEND_DST_ALPHA, &blendDestinationAlpha);
    glDisable(GL_DEPTH_TEST);
    glDisable(GL_CULL_FACE);
    glDisable(GL_BLEND);
    const int halfW = std::max(1, m_ScaledWidth / 2), halfH = std::max(1, m_ScaledHeight / 2);
    if (wantAo) {
        if (!m_SsaoShader) {
            m_SsaoShader = std::make_unique<Shader>(Paths::Find("assets/shaders/present.vert"), Paths::Find("assets/shaders/ssao.frag"));
            m_SsaoBlurShader = std::make_unique<Shader>(Paths::Find("assets/shaders/present.vert"), Paths::Find("assets/shaders/ssao_blur.frag"));
        }
        glBindFramebuffer(GL_FRAMEBUFFER, m_AoFbo[0]);
        glViewport(0, 0, halfW, halfH);
        m_SsaoShader->Bind();
        m_SsaoShader->SetMat4("uInvProjection", glm::inverse(m_CameraData.projection));
        m_SsaoShader->SetMat4("uProjection", m_CameraData.projection);
        m_SsaoShader->SetInt("uSamples", m_AoSamples);
        {   // sombras de contacto: la direccion al sol en la vista y su fuerza segun la luz solar que hay
            static const bool noContact = std::getenv("BAZUKO_NOCONTACT") != nullptr;
            const float sunLevel = std::clamp(glm::dot(m_LightingData.sunColor, glm::vec3(0.3333f)) / 0.75f, 0.0f, 1.0f);
            m_SsaoShader->SetVec3("uSunView", glm::normalize(glm::mat3(m_CameraData.view) * -glm::normalize(m_LightingData.sunDir)));
            m_SsaoShader->SetFloat("uContact", noContact ? 0.0f : 0.5f * sunLevel);
        }
        glBindTextureUnit(0, m_ScaledDepth);
        DrawFullscreen(*m_SsaoShader);
        glBindFramebuffer(GL_FRAMEBUFFER, m_AoFbo[1]);
        glBindTextureUnit(0, m_AoTexture[0]);
        glBindTextureUnit(1, m_ScaledDepth);
        m_SsaoBlurShader->Bind();
        m_SsaoBlurShader->SetMat4("uInvProjection", glm::inverse(m_CameraData.projection));
        DrawFullscreen(*m_SsaoBlurShader);
        m_PostAoReady = true;
    }
    if (wantSsr) {   // reflejos en pantalla con la normal de cada pixel (G-buffer) contra la profundidad y el color de este cuadro
        if (!m_SsrShader) m_SsrShader = std::make_unique<Shader>(Paths::Find("assets/shaders/present.vert"), Paths::Find("assets/shaders/ssr.frag"));
        glBindFramebuffer(GL_FRAMEBUFFER, m_SsrFbo);
        glViewport(0, 0, halfW, halfH);
        m_SsrShader->Bind();
        m_SsrShader->SetMat4("uProjection", m_CameraData.projection);
        m_SsrShader->SetMat4("uInvProjection", glm::inverse(m_CameraData.projection));
        m_SsrShader->SetMat4("uView", m_CameraData.view);
        glBindTextureUnit(0, m_ScaledColor);
        glBindTextureUnit(1, m_ScaledDepth);
        glBindTextureUnit(2, m_ScaledNormal);
        DrawFullscreen(*m_SsrShader);
        m_PostSsrReady = true;
    }
    if (wantVolume) {   // niebla volumetrica a media resolucion, con la profundidad resuelta y el mapa de sombras del sol
        if (!m_VolumeShader) m_VolumeShader = std::make_unique<Shader>(Paths::Find("assets/shaders/present.vert"), Paths::Find("assets/shaders/volfog.frag"));
        glBindFramebuffer(GL_FRAMEBUFFER, m_VolumeFbo);
        glViewport(0, 0, halfW, halfH);
        m_VolumeShader->Bind();
        m_VolumeShader->SetMat4("uInvViewProjection", glm::inverse(m_CameraData.viewProjection));
        m_VolumeShader->SetMat4("uShadowMatrix", m_ShadowMatrix);
        m_VolumeShader->SetVec3("uShadowCenter", m_ShadowCenter);
        m_VolumeShader->SetFloat("uShadowRadius", m_ShadowRadius);
        m_VolumeShader->SetVec3("uCameraPos", m_CameraData.cameraPos);
        m_VolumeShader->SetVec3("uToLight", glm::normalize(-m_LightingData.sunDir));
        m_VolumeShader->SetVec3("uSunColor", m_LightingData.sunColor);
        m_VolumeShader->SetVec3("uAmbient", m_LightingData.ambientColor);
        m_VolumeShader->SetFloat("uDensity", m_VolumeDensity);
        m_VolumeShader->SetFloat("uHeightBoost", 0.6f + 1.4f * m_HeightFog);
        glBindTextureUnit(0, m_ScaledDepth);
        glBindTextureUnit(1, m_ShadowTexture);
        DrawFullscreen(*m_VolumeShader);
        m_PostVolumeReady = true;
    }
    if (wantBloom) {
        if (!m_BloomDownShader) {
            m_BloomDownShader = std::make_unique<Shader>(Paths::Find("assets/shaders/present.vert"), Paths::Find("assets/shaders/bloom_down.frag"));
            m_BloomUpShader = std::make_unique<Shader>(Paths::Find("assets/shaders/present.vert"), Paths::Find("assets/shaders/bloom_up.frag"));
        }
        for (int level = 0; level < kBloomLevels; ++level) {   // reduccion: el primer nivel solo recibe los brillos
            glBindFramebuffer(GL_FRAMEBUFFER, m_BloomFbo[level]);
            glViewport(0, 0, std::max(1, m_ScaledWidth >> (level + 2)), std::max(1, m_ScaledHeight >> (level + 2)));
            m_BloomDownShader->Bind();
            m_BloomDownShader->SetInt("uThreshold", level == 0 ? 1 : 0);
            glBindTextureUnit(0, level == 0 ? m_ScaledColor : m_BloomTexture[level - 1]);
            DrawFullscreen(*m_BloomDownShader);
        }
        glEnable(GL_BLEND);
        glBlendFunc(GL_ONE, GL_ONE);
        for (int level = kBloomLevels - 2; level >= 0; --level) {   // ampliacion: cada nivel suma el siguiente
            glBindFramebuffer(GL_FRAMEBUFFER, m_BloomFbo[level]);
            glViewport(0, 0, std::max(1, m_ScaledWidth >> (level + 2)), std::max(1, m_ScaledHeight >> (level + 2)));
            glBindTextureUnit(0, m_BloomTexture[level + 1]);
            DrawFullscreen(*m_BloomUpShader);
        }
        glDisable(GL_BLEND);
        m_PostBloomReady = true;
    }
    glBlendFuncSeparate(static_cast<GLenum>(blendSourceRgb), static_cast<GLenum>(blendDestinationRgb), static_cast<GLenum>(blendSourceAlpha), static_cast<GLenum>(blendDestinationAlpha));
    if (depthTest) glEnable(GL_DEPTH_TEST);
    if (cull) glEnable(GL_CULL_FACE);
    if (blend) glEnable(GL_BLEND);
}

void Renderer::EndScene() {
    m_DefaultShader->Unbind();
}

void Renderer::Submit(const Mesh& mesh, const glm::mat4& transform, const glm::vec4& albedo, bool useTexture, bool doubleSided, const std::vector<glm::mat4>* skinMatrices, int alphaMode, float alphaCutoff, const Texture* specularTexture, const Texture* normalTexture) {
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
    m_DefaultShader->SetInt("uGrass", m_Grass ? 1 : 0);
    m_DefaultShader->SetFloat("uMetallic", m_Metallic);
    m_DefaultShader->SetVec2("uUvOffset", m_UvOffset);
    m_DefaultShader->SetFloat("uRoughness", m_Roughness);
    if (specularTexture) specularTexture->BindUnit(1);
    static const bool noNormalMaps = std::getenv("BAZUKO_NONORMALMAP") != nullptr;   // pruebas: sin relieve, para comparar
    if (noNormalMaps) normalTexture = nullptr;
    m_DefaultShader->SetInt("uUseNormalTexture", normalTexture ? 1 : 0);
    if (normalTexture) normalTexture->BindUnit(2);
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
    if (m_GBufferActive && alphaMode == 2) glColorMaski(1, GL_FALSE, GL_FALSE, GL_FALSE, GL_FALSE);   // lo translucido (agua, halos, decals) no pisa la normal del suelo
    if (alphaMode == 1 && !std::getenv("BAZUKO_NOA2C")) glEnable(GL_SAMPLE_ALPHA_TO_COVERAGE);   // hojas y pasto: el alfa recortado se reparte entre las muestras de MSAA
    mesh.Draw();
    if (alphaMode == 1) glDisable(GL_SAMPLE_ALPHA_TO_COVERAGE);
    if (m_GBufferActive && alphaMode == 2) glColorMaski(1, GL_TRUE, GL_TRUE, GL_TRUE, GL_TRUE);
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
    if (m_FarRecording && !(skinMatrices && !skinMatrices->empty()) && m_FarCasters.size() < 6000) {   // lo que se dibuja en este cuadro alimenta la sombra lejana
        const float farScale = std::max({glm::length(glm::vec3(transform[0])), glm::length(glm::vec3(transform[1])), glm::length(glm::vec3(transform[2]))});
        const float farRadius = mesh.GetBoundsRadius() * farScale + 2.0f;
        const glm::vec3 farCenter = glm::vec3(transform * glm::vec4(mesh.GetBoundsCenter(), 1.0f));
        if (farRadius >= 2.5f && glm::distance(glm::vec2(farCenter.x, farCenter.z), glm::vec2(m_FarCenter.x, m_FarCenter.z)) <= kFarRadius + farRadius) m_FarCasters.push_back(draw);
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
    if (m_FarFbo) glDeleteFramebuffers(1, &m_FarFbo);
    if (m_FarTexture) glDeleteTextures(1, &m_FarTexture);
    m_FarFbo = m_FarTexture = 0;
    if (m_UltraFbo) glDeleteFramebuffers(1, &m_UltraFbo);
    if (m_UltraTexture) glDeleteTextures(1, &m_UltraTexture);
    m_UltraFbo = m_UltraTexture = 0;
    m_UltraValid = false;
    m_FarValid = m_FarRecording = false;
    m_FarCasters.clear();
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
    static const bool logShadow = std::getenv("BAZUKO_LOG_SHADOW") != nullptr;   // medicion: que cubre el mapa de sombras estatico
    if (logShadow && m_StaticCaptured) {
        static bool printed = false;
        if (!printed) {
            printed = true;
            glm::vec3 low(1.0e9f), high(-1.0e9f);
            for (const ShadowDraw& draw : m_StaticCasters) { const glm::vec3 c = glm::vec3(draw.model * glm::vec4(draw.mesh->GetBoundsCenter(), 1.0f)); low = glm::min(low, c); high = glm::max(high, c); }
            std::fprintf(stderr, "SOMBRAS estaticas: %zu mallas, x %.0f..%.0f z %.0f..%.0f\n", m_StaticCasters.size(), low.x, high.x, low.z, high.z);
        }
    }
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
    static glm::vec2 polygonOffset(0.8f, 1.6f);   // BAZUKO_SHADOW_POLY=factor,unidades para probar otros valores
    static bool polygonRead = false;
    if (!polygonRead) {
        polygonRead = true;
        if (const char* env = std::getenv("BAZUKO_SHADOW_POLY")) std::sscanf(env, "%f,%f", &polygonOffset.x, &polygonOffset.y);
    }
    glPolygonOffset(polygonOffset.x, polygonOffset.y);
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
    if (m_FarEnabled) {   // sombra lejana: se graba un cuadro de cada 45 y en el siguiente se dibuja el mapa con lo grabado
        if (!m_FarTexture) {
            glCreateTextures(GL_TEXTURE_2D, 1, &m_FarTexture);
            glTextureStorage2D(m_FarTexture, 1, GL_DEPTH_COMPONENT24, kFarResolution, kFarResolution);
            glTextureParameteri(m_FarTexture, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
            glTextureParameteri(m_FarTexture, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
            glTextureParameteri(m_FarTexture, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_BORDER);
            glTextureParameteri(m_FarTexture, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_BORDER);
            const float border[4] = {1.0f, 1.0f, 1.0f, 1.0f};
            glTextureParameterfv(m_FarTexture, GL_TEXTURE_BORDER_COLOR, border);
            glTextureParameteri(m_FarTexture, GL_TEXTURE_COMPARE_MODE, GL_COMPARE_REF_TO_TEXTURE);
            glTextureParameteri(m_FarTexture, GL_TEXTURE_COMPARE_FUNC, GL_LEQUAL);
            glCreateFramebuffers(1, &m_FarFbo);
            glNamedFramebufferTexture(m_FarFbo, GL_DEPTH_ATTACHMENT, m_FarTexture, 0);
            glNamedFramebufferDrawBuffer(m_FarFbo, GL_NONE);
            glNamedFramebufferReadBuffer(m_FarFbo, GL_NONE);
        }
        ++m_FarFrame;
        if (m_FarRecording) {
            const float farDistance = kFarRadius + 220.0f;
            const glm::mat4 farView = glm::lookAt(m_FarCenter + light * farDistance, m_FarCenter, glm::vec3(0.0f, 1.0f, 0.0f));
            const glm::mat4 farProjection = glm::ortho(-kFarRadius, kFarRadius, -kFarRadius, kFarRadius, 1.0f, farDistance + kFarRadius + 160.0f);
            m_FarLightViewProjection = farProjection * farView;
            m_FarMatrix = glm::translate(glm::mat4(1.0f), glm::vec3(0.5f)) * glm::scale(glm::mat4(1.0f), glm::vec3(0.5f)) * m_FarLightViewProjection;
            glViewport(0, 0, kFarResolution, kFarResolution);
            glBindFramebuffer(GL_FRAMEBUFFER, m_FarFbo);
            glClearNamedFramebufferfv(m_FarFbo, GL_DEPTH, 0, &one);
            m_ShadowShader->SetMat4("uLightViewProjection", m_FarLightViewProjection);
            DrawShadowCasters(m_StaticCasters, false);   // la ciudad fija (edificios, torre, viaducto): antes no entraba en este mapa
            DrawShadowCasters(m_FarCasters, false);
            if (logShadow) std::fprintf(stderr, "SOMBRA LEJANA: %zu mallas en el mapa, centro (%.0f, %.0f)\n", m_FarCasters.size(), m_FarCenter.x, m_FarCenter.z);
            m_FarCasters.clear();
            m_FarRecording = false;
            m_FarValid = true;
        } else if (m_FarFrame % 45 == 1 || (!m_FarValid && m_FarFrame > 4)) {
            m_FarRecording = true;
            m_FarCenter = glm::vec3(focus.x, 0.0f, focus.z);
            m_FarCasters.clear();
        }
        if (m_StaticCaptured) {   // tercera cascada: solo la ciudad fija, a 450 m, se rehace cuando el jugador se aleja un cuarto del radio o gira el sol
            if (!m_UltraTexture) {
                glCreateTextures(GL_TEXTURE_2D, 1, &m_UltraTexture);
                glTextureStorage2D(m_UltraTexture, 1, GL_DEPTH_COMPONENT24, kUltraResolution, kUltraResolution);
                glTextureParameteri(m_UltraTexture, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
                glTextureParameteri(m_UltraTexture, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
                glTextureParameteri(m_UltraTexture, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_BORDER);
                glTextureParameteri(m_UltraTexture, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_BORDER);
                const float border[4] = {1.0f, 1.0f, 1.0f, 1.0f};
                glTextureParameterfv(m_UltraTexture, GL_TEXTURE_BORDER_COLOR, border);
                glTextureParameteri(m_UltraTexture, GL_TEXTURE_COMPARE_MODE, GL_COMPARE_REF_TO_TEXTURE);
                glTextureParameteri(m_UltraTexture, GL_TEXTURE_COMPARE_FUNC, GL_LEQUAL);
                glCreateFramebuffers(1, &m_UltraFbo);
                glNamedFramebufferTexture(m_UltraFbo, GL_DEPTH_ATTACHMENT, m_UltraTexture, 0);
                glNamedFramebufferDrawBuffer(m_UltraFbo, GL_NONE);
                glNamedFramebufferReadBuffer(m_UltraFbo, GL_NONE);
            }
            const bool ultraMoved = !m_UltraValid || glm::distance(glm::vec2(focus.x, focus.z), glm::vec2(m_UltraCenter.x, m_UltraCenter.z)) > 0.25f * kUltraRadius;
            if (ultraMoved || glm::dot(light, m_UltraLight) < 0.9998f) {
                m_UltraCenter = glm::vec3(focus.x, 0.0f, focus.z);
                m_UltraLight = light;
                const float ultraDistance = kUltraRadius + 320.0f;   // la luz queda sobre la torre mas alta
                const glm::mat4 ultraView = glm::lookAt(m_UltraCenter + light * ultraDistance, m_UltraCenter, glm::vec3(0.0f, 1.0f, 0.0f));
                const glm::mat4 ultraProjection = glm::ortho(-kUltraRadius, kUltraRadius, -kUltraRadius, kUltraRadius, 1.0f, ultraDistance + kUltraRadius + 260.0f);
                m_UltraLightViewProjection = ultraProjection * ultraView;
                m_UltraMatrix = glm::translate(glm::mat4(1.0f), glm::vec3(0.5f)) * glm::scale(glm::mat4(1.0f), glm::vec3(0.5f)) * m_UltraLightViewProjection;
                glViewport(0, 0, kUltraResolution, kUltraResolution);
                glBindFramebuffer(GL_FRAMEBUFFER, m_UltraFbo);
                glClearNamedFramebufferfv(m_UltraFbo, GL_DEPTH, 0, &one);
                m_ShadowShader->SetMat4("uLightViewProjection", m_UltraLightViewProjection);
                DrawShadowCasters(m_StaticCasters, false);
                m_UltraValid = true;
            }
        }
    } else if (m_FarValid || m_FarRecording) {
        m_UltraValid = false;
        m_FarValid = m_FarRecording = false;
        m_FarCasters.clear();
    }
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
