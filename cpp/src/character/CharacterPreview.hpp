#pragma once
#include <glad/gl.h>
#include <glm/glm.hpp>
#include "CharacterManager.hpp"
#include "../renderer/Renderer.hpp"
#include "../renderer/Camera.hpp"

namespace Bazuko {

class CharacterPreview {
public:
    CharacterPreview();
    ~CharacterPreview();

    void Init(int width = 512, int height = 640);
    void Update(float dt, bool focusFace);
    void Render(Renderer& renderer, CharacterManager& characterManager, float animTime);

    uint32_t GetTextureID() const { return m_ColorTexture; }
    int GetWidth() const { return m_Width; }
    int GetHeight() const { return m_Height; }

    void Rotate(float deltaAngle) { m_Yaw += deltaAngle; }
    void SetYawVelocity(float vel) { m_YawVel = vel; }
    void StopRotation() { m_YawVel = 0.0f; }

private:
    void SetupFramebuffer();
    void Cleanup();

    int m_Width = 512;
    int m_Height = 640;
    GLuint m_FBO = 0;
    GLuint m_ColorTexture = 0;
    GLuint m_RBO = 0;

    Camera m_Camera{32.0f, 512.0f / 640.0f};
    glm::vec3 m_CurrentCamPos{0.0f, 1.2f, 3.8f};
    glm::vec3 m_CurrentCamLook{0.0f, 0.95f, 0.0f};

    float m_Yaw = 0.35f;
    float m_YawVel = 0.0f;
};

} // namespace Bazuko
