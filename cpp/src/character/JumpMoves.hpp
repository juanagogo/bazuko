#pragma once
// Saltos por codigo (laminas de salto vertical y salto con carrera): se superponen a un reposo girando huesos con Model::BoneTurn,
// como las tecnicas de CombatMoves.hpp. Direcciones en el espacio del modelo: +x a la izquierda, +y arriba, +z al frente.
//   Salto estatico: anticipacion (agacharse con los brazos atras), impulso (extension con los brazos arriba), vuelo (rodillas al pecho),
//   caida (piernas estiradas, brazos arriba), amortiguacion (agacharse de nuevo) y recuperacion.
//   Salto en movimiento: zancada, despegue con la rodilla delantera arriba, vuelo con piernas abiertas, alcance y aterrizaje en zancada.
#include <algorithm>
#include <array>
#include <vector>
#include <glm/glm.hpp>
#include "CombatMoves.hpp"

namespace Bazuko::Jump {

struct Timing {
    float takeoff;    // s en que se despega
    float air;        // s en el aire
    float duration;   // s de toda la accion (hasta recuperar)
};

inline Timing TimingFor(bool moving) { return moving ? Timing{0.14f, 0.735f, 1.05f} : Timing{0.20f, 0.735f, 1.35f}; }

namespace detail {

struct Key {
    float t, hipsY, hipsZ, pitch;
    glm::vec3 armUpper, armLower;      // brazo izquierdo; el derecho es el espejo (en el salto en movimiento el derecho usa los del paso opuesto)
    glm::vec3 legAUpper, legALower;    // pierna izquierda
    glm::vec3 legBUpper, legBLower;    // pierna derecha (igual a la izquierda en el salto estatico)
};

template <size_t N>
inline void Sample(const std::array<Key, N>& keys, float time, Key& out) {
    time = std::clamp(time, keys.front().t, keys.back().t);
    size_t next = 1;
    while (next < N - 1 && keys[next].t < time) ++next;
    const Key& a = keys[next - 1];
    const Key& b = keys[next];
    const float u = Combat::detail::Smooth((time - a.t) / std::max(0.0001f, b.t - a.t));
    const auto mix = [&](const glm::vec3& x, const glm::vec3& y) { return glm::normalize(glm::mix(x, y, u)); };
    out = {time, glm::mix(a.hipsY, b.hipsY, u), glm::mix(a.hipsZ, b.hipsZ, u), glm::mix(a.pitch, b.pitch, u),
           mix(a.armUpper, b.armUpper), mix(a.armLower, b.armLower), mix(a.legAUpper, b.legAUpper), mix(a.legALower, b.legALower),
           mix(a.legBUpper, b.legBUpper), mix(a.legBLower, b.legBLower)};
}

inline void Apply(std::vector<Model::BoneTurn>& turns, const Key& k, bool alternateArms) {
    using namespace Combat::detail;
    Torso(turns, {k.t, 0.0f, k.pitch, 0.0f, {0.0f, k.hipsY, k.hipsZ}, 0.0f}, 1.0f);
    // brazos: simetricos; en carrera el derecho hace el movimiento contrario (el izquierdo adelante, el derecho atras)
    Arm(turns, true, k.armUpper, k.armLower, 1.0f, 1.0f);
    if (alternateArms) {
        const glm::vec3 mirroredUpper(k.armUpper.x, k.armUpper.y, -k.armUpper.z * 0.9f), mirroredLower(k.armLower.x, k.armLower.y, -k.armLower.z * 0.6f);
        Arm(turns, false, glm::normalize(mirroredUpper), glm::normalize(mirroredLower), 1.0f, 1.0f);
    } else {
        Arm(turns, false, k.armUpper, k.armLower, 1.0f, 1.0f);
    }
    Leg(turns, true, k.legAUpper, k.legALower, 1.0f, 1.0f);
    Leg(turns, false, k.legBUpper, k.legBLower, 1.0f, 1.0f);
}

} // namespace detail

// Giros del salto en el segundo `time` de la accion; `moving` elige el salto con carrera. Agrega tambien los puños cerrados? No: las manos quedan relajadas.
inline void Append(std::vector<Model::BoneTurn>& turns, float time, bool moving) {
    using detail::Key;
    const glm::vec3 down(0.08f, -1.0f, 0.0f);
    if (!moving) {
        static const std::array<Key, 8> keys{{
            {0.00f, 0.00f, 0.00f, 0.00f, {0.10f, -1.0f, 0.05f}, {0.10f, -1.0f, 0.10f}, down, down, down, down},
            {0.20f, -0.34f, -0.12f, 0.85f, {0.10f, -0.6f, -0.8f}, {0.10f, -0.7f, -0.7f}, {0.05f, -0.45f, 0.9f}, {0.05f, -0.9f, -0.45f}, {0.05f, -0.45f, 0.9f}, {0.05f, -0.9f, -0.45f}},
            {0.30f, 0.00f, 0.00f, 0.10f, {0.10f, 1.0f, 0.25f}, {0.10f, 1.0f, 0.20f}, {0.0f, -1.0f, 0.10f}, {0.0f, -1.0f, -0.05f}, {0.0f, -1.0f, 0.10f}, {0.0f, -1.0f, -0.05f}},
            {0.55f, 0.00f, 0.00f, 0.35f, {0.20f, 0.9f, 0.40f}, {0.10f, 0.7f, 0.70f}, {0.0f, -0.25f, 0.95f}, {0.0f, -0.95f, -0.30f}, {0.0f, -0.25f, 0.95f}, {0.0f, -0.95f, -0.30f}},
            {0.80f, 0.00f, 0.00f, 0.00f, {0.20f, 1.0f, 0.10f}, {0.15f, 1.0f, 0.10f}, {0.10f, -1.0f, 0.20f}, {0.0f, -1.0f, 0.0f}, {0.10f, -1.0f, 0.20f}, {0.0f, -1.0f, 0.0f}},
            {0.94f, 0.00f, 0.00f, 0.05f, {0.20f, 0.9f, 0.20f}, {0.15f, 0.9f, 0.25f}, {0.10f, -1.0f, 0.20f}, {0.0f, -1.0f, 0.0f}, {0.10f, -1.0f, 0.20f}, {0.0f, -1.0f, 0.0f}},
            {1.10f, -0.34f, -0.12f, 0.80f, {0.10f, -0.2f, 0.95f}, {0.05f, 0.7f, 0.65f}, {0.05f, -0.45f, 0.9f}, {0.05f, -0.9f, -0.45f}, {0.05f, -0.45f, 0.9f}, {0.05f, -0.9f, -0.45f}},
            {1.35f, 0.00f, 0.00f, 0.00f, {0.10f, -1.0f, 0.05f}, {0.10f, -1.0f, 0.10f}, down, down, down, down}}};
        Key key;
        detail::Sample(keys, time, key);
        detail::Apply(turns, key, false);
    } else {
        // piernas A (izquierda) adelante y B (derecha) atras al despegar; cambian de lugar en el aire y aterriza con la contraria adelante
        static const std::array<Key, 7> keys{{
            {0.00f, -0.12f, 0.0f, 0.25f, {0.20f, -0.4f, 0.9f}, {0.10f, 0.5f, 0.85f}, {0.0f, -0.6f, 0.8f}, {0.0f, -0.8f, -0.6f}, {0.0f, -0.85f, -0.55f}, {0.0f, -1.0f, -0.10f}},
            {0.14f, -0.05f, 0.0f, 0.30f, {0.20f, 0.5f, 0.8f}, {0.10f, 0.3f, 0.9f}, {0.0f, 0.1f, 1.0f}, {0.0f, -0.8f, -0.55f}, {0.0f, -0.9f, -0.4f}, {0.0f, -1.0f, 0.0f}},
            {0.50f, 0.00f, 0.0f, 0.20f, {0.40f, 0.3f, 0.8f}, {0.20f, 0.2f, 0.9f}, {0.0f, 0.05f, 1.0f}, {0.0f, -0.6f, -0.8f}, {0.0f, -0.7f, -0.7f}, {0.0f, -0.9f, -0.4f}},
            {0.75f, 0.00f, 0.0f, 0.25f, {0.30f, -0.1f, 0.95f}, {0.15f, 0.3f, 0.9f}, {0.0f, -0.6f, 0.8f}, {0.0f, -0.8f, -0.5f}, {0.0f, -0.3f, 0.95f}, {0.0f, -1.0f, 0.1f}},
            {0.87f, -0.15f, 0.0f, 0.40f, {0.20f, -0.4f, 0.9f}, {0.10f, 0.4f, 0.85f}, {0.0f, -0.7f, 0.6f}, {0.0f, -0.9f, -0.4f}, {0.0f, -0.5f, 0.85f}, {0.0f, -0.9f, -0.4f}},
            {0.96f, -0.14f, 0.0f, 0.35f, {0.15f, -0.7f, 0.7f}, {0.10f, -0.1f, 0.95f}, {0.0f, -0.8f, 0.55f}, {0.0f, -0.9f, -0.4f}, {0.0f, -0.7f, 0.7f}, {0.0f, -0.9f, -0.4f}},
            {1.05f, -0.10f, 0.0f, 0.25f, {0.15f, -0.7f, 0.7f}, {0.10f, 0.0f, 0.95f}, {0.0f, -0.85f, -0.5f}, {0.0f, -1.0f, -0.1f}, {0.0f, -0.6f, 0.8f}, {0.0f, -0.8f, -0.6f}}}};
        Key key;
        detail::Sample(keys, time, key);
        detail::Apply(turns, key, true);
    }
}

} // namespace Bazuko::Jump
