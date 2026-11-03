#pragma once

#include <glm/glm.hpp>

#include "core/MathTypes.h"

namespace bazuko {

constexpr int kShadowMapSize = 2048;
constexpr double kShadowHalfExtent = 45;  // la caja de sombras es de ±45 m y sigue al jugador
constexpr double kShadowNear = 0.5, kShadowFar = 200;
constexpr double kShadowBias = 0.0005;    // sesgo de profundidad (en [0,1])

struct ShadowFrame {
    glm::mat4 view, proj, viewProj;
    glm::mat4 texMatrix;  // mundo → coordenadas de textura [0,1]³ del mapa de sombras
};

// Sombra direccional del sol, ortográfica y centrada en `target`. El centro se ajusta a la rejilla de
// texels del mapa para que las sombras no bailen al caminar.
ShadowFrame computeShadowFrame(const Vec3& target, const Vec3& toSun, double halfExtent = kShadowHalfExtent,
                               int mapSize = kShadowMapSize, double lightDistance = 69.64);

}  // namespace bazuko
