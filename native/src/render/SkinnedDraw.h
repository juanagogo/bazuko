#pragma once

#include <glm/glm.hpp>

#include "core/MathTypes.h"

namespace bazuko {

// Una malla con esqueleto lista para dibujar en este cuadro (personajes).
struct SkinnedDraw {
    int mesh = -1;                       // id devuelto por Renderer::uploadSkinnedMesh
    int texture = -1;                    // id devuelto por Renderer::uploadTexture (-1 = sin textura)
    glm::mat4 model{1.0f};
    const glm::mat4* palette = nullptr;  // matrices de hueso (mundo · inverseBind), válidas durante el cuadro
    int paletteCount = 0;
    Rgb tint{1, 1, 1};
    float alphaCutoff = 0;
    bool blend = false;                  // mezcla alfa sin escribir profundidad
    bool doubleSided = false;
    bool polygonOffset = false;
    bool castShadow = true;
    bool unlit = false;                  // ojos y boca del personaje procedural no reciben luz
    bool silhouette = false;             // el jugador: perfil cian cuando algo lo tapa
};

constexpr int kMaxBones = 64;

}  // namespace bazuko
