#pragma once
// Gestos de espera del jugador (original: Player.js pickGesture y stances.js): quieto unos segundos, el cuerpo responde a lo que le pasa. Con frio se frota los
// brazos (frotarse), bajo la lluvia se encoge, con hambre se agarra la barriga. Los demas gestos del original (mirar, cambiar el peso, rascarse, bolsillos,
// brazos cruzados) no cambian la pose en el port: ahi sigue el reposo. Son giros de huesos en los ejes del personaje (+x su izquierda, +y arriba, +z al frente),
// como SmokingPose.hpp, sin dependencias de dibujo.
#include "../renderer/Model.hpp"

#include <algorithm>
#include <cmath>
#include <string>
#include <vector>

namespace Bazuko::Gestures {

enum class Gesture { None, Rub, Hunch, Belly };

// Tiempo quieto antes del primer gesto (el original: 6 s, repartidos entre 0,6 y 1,4 veces) y duracion de cada uno (2,5 a 5,5 s)
constexpr float kDelay = 6.0f;
constexpr float kFade = 0.5f;   // s para entrar y salir del gesto

// La tabla del original: lo neutro pesa 12 (no cambia la pose); el frio suma 9 a frotarse, la lluvia 3, el hambre 8 a la barriga. `roll` en [0, 1).
inline Gesture Pick(bool cold, bool hungry, bool raining, float roll) {
    const float neutral = 12.0f, rub = (cold ? 9.0f : 0.0f) + (raining ? 3.0f : 0.0f), belly = hungry ? 8.0f : 0.0f, rainNeutral = raining ? 2.0f : 0.0f;
    float pick = roll * (neutral + rub + belly + rainNeutral);
    if ((pick -= neutral) <= 0.0f) return Gesture::None;
    if ((pick -= rub) <= 0.0f) return Gesture::Rub;
    if ((pick -= belly) <= 0.0f) return Gesture::Belly;
    return Gesture::None;
}

namespace detail {
// Euler 'YXZ' como el original (Z, luego X, luego Y), igual que Smoking::detail::RotateInFrame
inline void Turn(std::vector<Model::BoneTurn>& turns, const char* bone, float x, float y, float z, float weight) {
    x *= weight; y *= weight; z *= weight;
    if (x == 0.0f && y == 0.0f && z == 0.0f) return;
    const std::string name = std::string("mixamorig:") + bone;
    if (z != 0.0f) turns.push_back({name, {0.0f, 0.0f, z}, {0.0f, 0.0f, 0.0f}, true});
    if (x != 0.0f) turns.push_back({name, {x, 0.0f, 0.0f}, {0.0f, 0.0f, 0.0f}, true});
    if (y != 0.0f) turns.push_back({name, {0.0f, y, 0.0f}, {0.0f, 0.0f, 0.0f}, true});
}
}

// Giros del gesto en el segundo `time` de su duracion; `weight` 0..1 es el fundido de entrada y salida.
inline void Append(std::vector<Model::BoneTurn>& turns, Gesture gesture, float time, float weight) {
    using detail::Turn;
    constexpr float kTau = 6.2831853f;
    weight = std::clamp(weight, 0.0f, 1.0f);
    if (gesture == Gesture::None || weight <= 0.001f) return;
    if (gesture == Gesture::Rub) {   // brazos cruzados contra el pecho y las manos suben y bajan por el brazo contrario (0,62 ciclos por segundo, como el original)
        const float slide = std::sin(kTau * 0.62f * time);
        Turn(turns, "Spine2", 0.07f, 0.0f, 0.0f, weight);
        Turn(turns, "Head", 0.08f, 0.0f, 0.0f, weight);
        Turn(turns, "LeftShoulder", 0.0f, 0.0f, -0.06f, weight);
        Turn(turns, "RightShoulder", 0.0f, 0.0f, 0.06f, weight);
        Turn(turns, "LeftArm", -0.50f + 0.09f * slide, -0.78f, 0.10f, weight);
        Turn(turns, "LeftForeArm", -1.85f + 0.14f * slide, -0.10f, 0.10f, weight);
        Turn(turns, "RightArm", -0.50f - 0.09f * slide, 0.78f, -0.10f, weight);
        Turn(turns, "RightForeArm", -1.85f - 0.14f * slide, 0.10f, -0.10f, weight);
    } else if (gesture == Gesture::Hunch) {   // hombros arriba, cabeza metida y las manos juntas al frente
        Turn(turns, "Spine2", 0.10f, 0.0f, 0.0f, weight);
        Turn(turns, "Head", 0.10f, 0.0f, 0.0f, weight);
        Turn(turns, "LeftShoulder", 0.0f, 0.0f, -0.10f, weight);
        Turn(turns, "RightShoulder", 0.0f, 0.0f, 0.10f, weight);
        Turn(turns, "LeftArm", -0.42f, -0.40f, 0.05f, weight);
        Turn(turns, "LeftForeArm", -1.55f, -0.45f, 0.05f, weight);
        Turn(turns, "RightArm", -0.42f, 0.40f, -0.05f, weight);
        Turn(turns, "RightForeArm", -1.55f, 0.45f, -0.05f, weight);
    } else {   // barriga: el cuerpo se dobla un poco y la mano derecha se frota el estomago
        const float rub = std::sin(kTau * 0.5f * time);
        Turn(turns, "Spine2", 0.13f, 0.0f, 0.0f, weight);
        Turn(turns, "Head", 0.10f, 0.0f, 0.0f, weight);
        Turn(turns, "RightArm", -0.42f, 0.55f, -0.08f, weight);
        Turn(turns, "RightForeArm", -1.65f + 0.10f * rub, 0.45f, -0.05f, weight);
        Turn(turns, "LeftArm", -0.30f, -0.35f, 0.05f, weight);
        Turn(turns, "LeftForeArm", -1.25f, -0.30f, 0.05f, weight);
    }
}

} // namespace Bazuko::Gestures
