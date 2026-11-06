#pragma once

#include <algorithm>
#include <glm/glm.hpp>

namespace Bazuko {

// Sonido puntual de la policia que la simulacion pide al audio (el volumen lo decide la distancia al jugador)
struct PoliceSound {
    enum class Kind { Stop, Radio };   // Stop: fin de la sirena al frenar; Radio: radio de un policia a pie
    Kind kind = Kind::Stop;
    glm::vec3 position{0.0f};
};

// Alcance de la sirena (src/systems/PoliceSirenAudio.js): plena hasta 12 m, muda a 55 m (donde la patrulla desiste), caida cuadratica como `distanceGain`.
constexpr float kSirenNear = 12.0f, kSirenFar = 55.0f;
inline float SirenGain(float distance) {
    const float t = std::clamp((kSirenFar - distance) / (kSirenFar - kSirenNear), 0.0f, 1.0f);
    return t * t;
}

} // namespace Bazuko
