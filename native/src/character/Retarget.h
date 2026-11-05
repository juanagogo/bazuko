#pragma once

#include <string>
#include <vector>

#include "character/Rig.h"

namespace bazuko {

// Animación de rotaciones por nodo, horneada a una frecuencia fija. `rotation[n]` queda vacío para los
// nodos que no se animan (los que no son huesos).
struct Clip {
    std::string name;
    double duration = 0;
    std::vector<float> times;
    std::vector<std::vector<glm::quat>> rotation;  // [nodo][cuadro]

    // Rotación local del nodo en el instante t (se enrolla al sobrepasar la duración).
    glm::quat sample(int node, double t) const;
    bool animates(int node) const { return !rotation[node].empty(); }
};

// Pasa animaciones de un esqueleto Mixamo a otro con los mismos nombres de hueso pero distinta pose de
// reposo, ejes y orientación (de Mixamo a MakeHuman/MPFB2), como retarget.js:
//   mundoDestino(t) = C · mundoOrigen(t) · reposoOrigen⁻¹ · C⁻¹ · reposoDestino
//   localDestino(t) = mundoPadreDestino(t)⁻¹ · mundoDestino(t)
class Retargeter {
public:
    // `target` se modifica: queda en la pose de reposo del origen (T-pose), igual que en el juego web.
    Retargeter(const Rig& source, Rig& target);

    // Hornea la animación `clip` (del esqueleto origen) para el destino. Solo rotaciones: en el sitio.
    Clip retarget(const GltfAnimation& clip, double fps = 30) const;

    const glm::quat& facingRotation() const { return facing_; }

private:
    const Rig& src_;
    Rig& tgt_;
    glm::quat facing_, facingInv_;
    std::vector<glm::quat> restSrc_, restTgt_, restLocal_, rootParentWorld_;  // por nodo
    std::vector<int> order_;                                                  // huesos del destino en preorden
};

// Rotación del nodo `node` de `anim` en el tiempo t, o `fallback` si el clip no lo anima.
glm::quat sampleChannelRotation(const GltfAnimation& anim, int node, double t, const glm::quat& fallback);

}  // namespace bazuko
