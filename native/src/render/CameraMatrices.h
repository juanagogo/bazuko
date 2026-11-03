#pragma once

#include <glm/glm.hpp>
#include <glm/gtc/matrix_transform.hpp>

#include "game/CameraRig.h"

namespace bazuko {

struct CameraMatrices {
    glm::mat4 view, proj;
};

// Matrices de vista y proyección de la cámara (FOV 55°, plano cercano 0,1 y lejano 500).
inline CameraMatrices cameraMatrices(const CameraRig& cam, double aspect) {
    const glm::vec3 eye(cam.position.x, cam.position.y, cam.position.z);
    const glm::vec3 target(cam.lookAt.x, cam.lookAt.y, cam.lookAt.z);
    return {glm::lookAt(eye, target, glm::vec3(0, 1, 0)),
            glm::perspective(glm::radians(static_cast<float>(kCameraFovDegrees)), static_cast<float>(aspect),
                             static_cast<float>(kCameraNear), static_cast<float>(kCameraFar))};
}

}  // namespace bazuko
