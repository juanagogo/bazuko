#include "CharacterPreview.hpp"
#include <glm/gtc/matrix_transform.hpp>
#include <algorithm>
#include <cmath>

namespace Bazuko {

CharacterPreview::CharacterPreview() {
}

CharacterPreview::~CharacterPreview() {
    Cleanup();
}

void CharacterPreview::Init(int width, int height) {
    m_Width = width;
    m_Height = height;
    m_Camera.SetAspectRatio(static_cast<float>(width) / static_cast<float>(height));

    SetupFramebuffer();
}

void CharacterPreview::SetupFramebuffer() {
    Cleanup();

    glGenFramebuffers(1, &m_FBO);
    glBindFramebuffer(GL_FRAMEBUFFER, m_FBO);

    glGenTextures(1, &m_ColorTexture);
    glBindTexture(GL_TEXTURE_2D, m_ColorTexture);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, m_Width, m_Height, 0, GL_RGBA, GL_UNSIGNED_BYTE, nullptr);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
    glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, m_ColorTexture, 0);

    glGenRenderbuffers(1, &m_RBO);
    glBindRenderbuffer(GL_RENDERBUFFER, m_RBO);
    glRenderbufferStorage(GL_RENDERBUFFER, GL_DEPTH24_STENCIL8, m_Width, m_Height);
    glFramebufferRenderbuffer(GL_FRAMEBUFFER, GL_DEPTH_STENCIL_ATTACHMENT, GL_RENDERBUFFER, m_RBO);

    glBindFramebuffer(GL_FRAMEBUFFER, 0);
}

void CharacterPreview::Cleanup() {
    if (m_FBO) {
        glDeleteFramebuffers(1, &m_FBO);
        m_FBO = 0;
    }
    if (m_ColorTexture) {
        glDeleteTextures(1, &m_ColorTexture);
        m_ColorTexture = 0;
    }
    if (m_RBO) {
        glDeleteRenderbuffers(1, &m_RBO);
        m_RBO = 0;
    }
}

void CharacterPreview::Update(float dt, bool focusFace) {
    // Fricción y avance de rotación
    m_Yaw += m_YawVel * dt;
    m_YawVel *= std::exp(-dt * 4.0f);

    glm::vec3 targetPos = focusFace
        ? glm::vec3(0.0f, 1.58f, 1.25f)
        : glm::vec3(0.0f, 1.15f, 3.60f);

    glm::vec3 targetLook = focusFace
        ? glm::vec3(0.0f, 1.52f, 0.0f)
        : glm::vec3(0.0f, 0.95f, 0.0f);

    const float t = std::clamp(dt * 7.0f, 0.0f, 1.0f);
    m_CurrentCamPos = glm::mix(m_CurrentCamPos, targetPos, t);
    m_CurrentCamLook = glm::mix(m_CurrentCamLook, targetLook, t);

    m_Camera.LookAt(m_CurrentCamPos, m_CurrentCamLook, glm::vec3(0.0f, 1.0f, 0.0f));
}

void CharacterPreview::Render(Renderer& renderer, CharacterManager& characterManager, float animTime) {
    if (!m_FBO) return;

    GLint prevViewport[4];
    glGetIntegerv(GL_VIEWPORT, prevViewport);

    glBindFramebuffer(GL_FRAMEBUFFER, m_FBO);
    glViewport(0, 0, m_Width, m_Height);

    // Fondo degradado de estudio oscuro
    glClearColor(0.12f, 0.13f, 0.16f, 1.0f);
    glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);

    // Iluminación cálida de estudio
    LightBlockData originalLight = renderer.GetLighting();
    LightBlockData studioLight = originalLight;
    studioLight.sunDir = glm::normalize(glm::vec3(0.45f, 0.80f, 0.60f));
    studioLight.sunColor = glm::vec3(1.20f, 1.15f, 1.05f);
    studioLight.ambientColor = glm::vec3(0.50f, 0.52f, 0.58f);
    studioLight.fogDensity = 0.0f;
    renderer.GetLighting() = studioLight;

    renderer.BeginScene(m_Camera, animTime);

    // Personaje con su rotación actual
    glm::mat4 charTransform = glm::rotate(glm::mat4(1.0f), m_Yaw, glm::vec3(0.0f, 1.0f, 0.0f));
    characterManager.Draw(renderer, charTransform, animTime, false, false);

    renderer.EndScene();

    // Restaurar iluminación, FBO y viewport de la ciudad
    renderer.GetLighting() = originalLight;
    glBindFramebuffer(GL_FRAMEBUFFER, 0);
    glViewport(prevViewport[0], prevViewport[1], prevViewport[2], prevViewport[3]);
}

} // namespace Bazuko
