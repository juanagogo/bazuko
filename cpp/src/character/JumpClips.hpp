#pragma once
// Salto con clips de captura (Quaternius, CC0; ver docs/animaciones-licencias.md): JumpStart (agacharse, despegar y subir), JumpLoop (en el aire)
// y JumpLand (caida y amortiguacion). La fisica del salto (game/JumpTiming.hpp) manda el tiempo y la altura; aqui solo se reparte el tiempo de la
// accion entre los clips y se mezcla de uno a otro, sin dependencias de dibujo.
//
//   despegue:  JumpStart de 0 a su instante de despegue, escalado para coincidir con el despegue de la fisica
//   subida:    el resto de JumpStart, comprimido (los brazos y la rodilla se recogen)
//   aire:      JumpLoop, que arranca en la pose en que termina JumpStart
//   aterrizaje: un fundido corto del aire a JumpLand (salto desde quieto) o a la marcha que ya llevaba (salto en movimiento: sigue corriendo)
#include <algorithm>
#include "../game/JumpTiming.hpp"

namespace Bazuko::Jump {

enum class JumpClip { Start, Loop, Land, Locomotion };   // Locomotion: el clip de marcha normal (caminar o correr), no uno del salto

struct ClipMix {
    JumpClip a = JumpClip::Start;
    float aTime = 0.0f;                 // segundo dentro del clip `a`
    JumpClip b = JumpClip::Start;       // clip con el que se mezcla (solo si weight > 0)
    float bTime = 0.0f;
    float weight = 0.0f;                // 0..1: cuanto de `b`
};

struct ClipLengths { float start = 1.375f, loop = 2.54f, land = 1.29f; };   // s, medidos en los clips ya reorientados (33, 61 y 31 cuadros a 24)

// Instante de JumpStart (s) en que los dos pies ya despegaron (medido sobre el clip: el izquierdo sube desde los 0,17 s y el derecho desde los 0,21 s)
constexpr float kStartTakeoff = 0.21f;
constexpr float kRiseMax = 0.45f;       // s de accion que dura la subida (el resto de JumpStart) como mucho
constexpr float kFade = 0.09f;          // s del fundido del aire al aterrizaje
constexpr float kLandReach = 0.85f;     // fraccion de JumpLand que se alcanza al terminar la accion (el final ya es de pie)

// Mezcla de clips en el segundo `t` de la accion de saltar. `moving` elige el salto con carrera.
inline ClipMix Mix(float t, bool moving, const ClipLengths& length = {}) {
    const Timing timing = TimingFor(moving);
    const float touch = timing.takeoff + timing.air;                                  // s en que se toca el suelo
    const float riseEnd = timing.takeoff + std::min(kRiseMax, timing.air * 0.6f);     // s en que termina la subida
    ClipMix mix;
    t = std::max(0.0f, t);
    if (t < timing.takeoff) {
        mix.a = JumpClip::Start;
        mix.aTime = t * (kStartTakeoff / timing.takeoff);
    } else if (t < riseEnd) {
        const float u = (t - timing.takeoff) / (riseEnd - timing.takeoff);
        mix.a = JumpClip::Start;
        mix.aTime = kStartTakeoff + u * (length.start - kStartTakeoff);
    } else if (t < touch) {
        mix.a = JumpClip::Loop;
        mix.aTime = std::min(t - riseEnd, length.loop);
        const float fadeStart = touch - kFade;
        if (t > fadeStart) {
            mix.b = moving ? JumpClip::Locomotion : JumpClip::Land;
            mix.bTime = 0.0f;
            mix.weight = std::clamp((t - fadeStart) / kFade, 0.0f, 1.0f);
        }
    } else if (moving) {
        mix.a = JumpClip::Locomotion;   // sigue corriendo: la marcha normal
        mix.aTime = 0.0f;
    } else {
        const float remaining = std::max(0.001f, timing.duration - touch);
        mix.a = JumpClip::Land;
        mix.aTime = std::min((t - touch) * (kLandReach * length.land / remaining), length.land);
    }
    return mix;
}

} // namespace Bazuko::Jump
