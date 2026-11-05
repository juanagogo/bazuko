#pragma once

#include <glm/glm.hpp>

#include "world/CollisionWorld.h"

namespace bazuko {

// Seis planos del volumen visible de una cámara (método de Gribb-Hartmann).
class Frustum {
public:
    static Frustum fromViewProjection(const glm::mat4& viewProj);
    // false si la caja queda completamente fuera de algún plano.
    bool intersects(const Aabb& box) const;

private:
    glm::vec4 planes_[6];
};

}  // namespace bazuko
