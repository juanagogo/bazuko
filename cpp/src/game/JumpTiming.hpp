#pragma once
// Tiempos del salto (sin dependencias de dibujo): los usan la animacion (character/JumpMoves.hpp) y la fisica del movimiento (game/Movement.cpp).
namespace Bazuko::Jump {

struct Timing {
    float takeoff;    // s en que se despega
    float air;        // s en el aire
    float duration;   // s de toda la accion (hasta recuperar)
};

inline Timing TimingFor(bool moving) { return moving ? Timing{0.14f, 0.735f, 1.05f} : Timing{0.20f, 0.735f, 1.35f}; }

} // namespace Bazuko::Jump
