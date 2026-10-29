#pragma once
#include <glm/glm.hpp>
#include <glm/gtc/matrix_transform.hpp>
#include <glm/gtc/constants.hpp>

namespace Bazuko {

enum class CameraMode {
    ThirdPerson,
    Isometric
};

class Camera {
public:
    Camera(float fov = 55.0f, float aspectRatio = 16.0f / 9.0f, float nearPlane = 0.1f, float farPlane = 500.0f);

    void SetAspectRatio(float aspect);
    void ToggleMode();
    void SetMode(CameraMode mode) { m_Mode = mode; }
    CameraMode GetMode() const { return m_Mode; }

    void Orbit(float dx, float dy);
    void Zoom(float delta);
    void Follow(const glm::vec3& targetPos, float dt, float speed = 0.0f, bool isRunning = false);

    const glm::mat4& GetViewMatrix() const { return m_ViewMatrix; }
    const glm::mat4& GetProjectionMatrix() const { return m_ProjectionMatrix; }
    const glm::mat4& GetViewProjectionMatrix() const { return m_ViewProjectionMatrix; }
    const glm::vec3& GetPosition() const { return m_Position; }
    float GetYaw() const { return m_Yaw; }
    void SetOrbit(float yaw, float pitch, float distance) { m_Yaw = yaw; m_Pitch = pitch; m_Distance = distance; }
    void SetPsychosisFovOffset(float offset) { m_PsychosisFovOffset = offset; }
    void SetPsychosisRoll(float radians) { m_PsychosisRoll = radians; }

    // Posiciona la cámara directamente (usado por CharacterPreview)
    void LookAt(const glm::vec3& eye, const glm::vec3& center, const glm::vec3& up) {
        m_Position = eye;
        m_Target = center;
        m_ViewMatrix = glm::lookAt(eye, center, up);
        m_ViewProjectionMatrix = m_ProjectionMatrix * m_ViewMatrix;
    }

private:
    void UpdateProjection();

    CameraMode m_Mode = CameraMode::ThirdPerson;
    float m_BaseFov = 55.0f;
    float m_CurrentFov = 55.0f;
    float m_AspectRatio = 16.0f / 9.0f;
    float m_NearPlane = 0.1f;
    float m_FarPlane = 500.0f;

    glm::vec3 m_Position = {12.0f, 16.0f, 12.0f};
    glm::vec3 m_Target = {0.0f, 0.0f, 0.0f};
    glm::vec3 m_LookOffset = {0.0f, 1.5f, 0.0f};
    glm::vec3 m_IsometricOffset = {12.0f, 16.0f, 12.0f};

    float m_Yaw = -glm::half_pi<float>();
    float m_Pitch = 0.22f;
    float m_Distance = 5.5f;

    float m_BobTime = 0.0f;
    float m_BobAmount = 0.0f;
    float m_PsychosisFovOffset = 0.0f;
    float m_PsychosisRoll = 0.0f;

    glm::mat4 m_ViewMatrix{1.0f};
    glm::mat4 m_ProjectionMatrix{1.0f};
    glm::mat4 m_ViewProjectionMatrix{1.0f};
};

} // namespace Bazuko
