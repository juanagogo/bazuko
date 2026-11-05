#pragma once

#include <glm/glm.hpp>

namespace Bazuko {

// Sonido puntual de la policia que la simulacion pide al audio (el volumen lo decide la distancia al jugador)
struct PoliceSound {
    enum class Kind { Stop, Radio };   // Stop: fin de la sirena al frenar; Radio: radio de un policia a pie
    Kind kind = Kind::Stop;
    glm::vec3 position{0.0f};
};

} // namespace Bazuko
