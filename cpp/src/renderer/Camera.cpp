#include "Camera.hpp"
#include <algorithm>
#include <cmath>

namespace Bazuko {

Camera::Camera(float fov, float aspectRatio, float nearPlane, float farPlane)
    : m_BaseFov(fov), m_CurrentFov(fov), m_AspectRatio(aspectRatio),
      m_NearPlane(nearPlane), m_FarPlane(farPlane) {
    UpdateProjection();
}

void Camera::SetAspectRatio(float aspect) {
    m_AspectRatio = aspect;
    UpdateProjection();
}

void Camera::ToggleMode() {
    m_Mode = (m_Mode == CameraMode::ThirdPerson) ? CameraMode::Isometric : CameraMode::ThirdPerson;
}

void Camera::UpdateProjection() {
    m_ProjectionMatrix = glm::perspective(glm::radians(m_CurrentFov), m_AspectRatio, m_NearPlane, m_FarPlane);
    m_ViewProjectionMatrix = m_ProjectionMatrix * m_ViewMatrix;
}

void Camera::Orbit(float dx, float dy) {
    m_Yaw -= dx * 0.004f;
    m_Pitch = std::clamp(m_Pitch + dy * 0.004f, 0.05f, 0.65f);
}

void Camera::Zoom(float delta) {
    m_Distance = std::clamp(m_Distance + delta * 0.005f, 2.5f, 9.0f);
}

void Camera::Follow(const glm::vec3& targetPos, float dt, float speed, bool isRunning) {
    // Dynamic FOV
    if (m_Mode == CameraMode::ThirdPerson && dt > 0.0f) {
        float wantFov = ((isRunning && speed > 2.5f) ? 61.0f : m_BaseFov) + m_PsychosisFovOffset;
        if (std::abs(m_CurrentFov - wantFov) > 0.05f) {
            m_CurrentFov += (wantFov - m_CurrentFov) * (1.0f - std::exp(-6.0f * dt));
            UpdateProjection();
        }
    } else if (std::abs(m_CurrentFov - (m_BaseFov + m_PsychosisFovOffset)) > 0.05f) {
        m_CurrentFov = m_BaseFov + m_PsychosisFovOffset;
        UpdateProjection();
    }

    glm::vec3 lookAt = targetPos + m_LookOffset;

    // Head bobbing
    if (m_Mode == CameraMode::ThirdPerson && dt > 0.0f && speed > 0.4f) {
        m_BobTime += dt * (isRunning ? 13.0f : 8.5f);
        float targetBob = isRunning ? 0.038f : 0.018f;
        m_BobAmount += (targetBob - m_BobAmount) * (1.0f - std::exp(-6.0f * dt));
        lookAt.y += std::sin(m_BobTime) * m_BobAmount;
    } else if (m_BobAmount > 0.001f && dt > 0.0f) {
        m_BobAmount += (0.0f - m_BobAmount) * (1.0f - std::exp(-8.0f * dt));
        lookAt.y += std::sin(m_BobTime) * m_BobAmount;
    }

    if (m_Mode == CameraMode::Isometric) {
        float isoRadius = 16.97f;
        glm::vec3 offset = {
            isoRadius * std::sin(m_Yaw),
            16.0f,
            isoRadius * std::cos(m_Yaw)
        };
        glm::vec3 desiredPos = lookAt + offset;
        if (dt > 0.0f) {
            m_Position += (desiredPos - m_Position) * (1.0f - std::exp(-8.0f * dt));
        } else {
            m_Position = desiredPos;
        }
    } else {
        float cosPitch = std::cos(m_Pitch);
        float sinPitch = std::sin(m_Pitch);
        float cosYaw = std::cos(m_Yaw);
        float sinYaw = std::sin(m_Yaw);

        glm::vec3 offset = {
            m_Distance * cosPitch * sinYaw,
            m_Distance * sinPitch,
            m_Distance * cosPitch * cosYaw
        };

        glm::vec3 desiredPos = lookAt + offset;
        if (dt > 0.0f) {
            m_Position += (desiredPos - m_Position) * (1.0f - std::exp(-10.0f * dt));
        } else {
            m_Position = desiredPos;
        }
    }

    glm::vec3 up(0.0f, 1.0f, 0.0f);
    if (m_PsychosisRoll != 0.0f) {
        const glm::vec3 forward = glm::normalize(lookAt - m_Position);
        up = glm::vec3(glm::rotate(glm::mat4(1.0f), m_PsychosisRoll, forward) * glm::vec4(up, 0.0f));
    }
    m_ViewMatrix = glm::lookAt(m_Position, lookAt, up);
    m_ViewProjectionMatrix = m_ProjectionMatrix * m_ViewMatrix;
}

} // namespace Bazuko
