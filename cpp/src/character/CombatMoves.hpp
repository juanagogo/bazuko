#pragma once
// Tecnicas de combate por codigo: se superponen a la guardia (FightIdle) girando huesos con Model::BoneTurn, igual para el jugador
// y los peatones. Cada tecnica son pistas por tiempo: el brazo o la pierna que golpea apunta a una direccion (espacio del modelo:
// +x a la izquierda del personaje, +y arriba, +z al frente), el torso y la cadera giran y se inclinan, y la mano se cierra.
// Referencia: laminas de puno recto, gancho, patada circular, esquive lateral y esquive rotatorio.
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdlib>
#include <cstdio>
#include <string>
#include <vector>
#include <glm/glm.hpp>
#include "../renderer/Model.hpp"

namespace Bazuko::Combat {

enum class Move { Jab, Cross, Hook, Roundhouse, HighRoundhouse, Slip, RollingDuck };
constexpr int kMoveCount = 7;

struct MoveInfo {
    const char* name;
    float duration;   // s
    float impact;     // s en que conecta el golpe (o el punto mas bajo del esquive)
};

inline const MoveInfo& Info(Move move) {
    static const std::array<MoveInfo, kMoveCount> table{{
        {"jab", 0.583f, 0.22f}, {"cross", 0.75f, 0.30f}, {"hook", 0.80f, 0.34f}, {"roundhouse", 1.00f, 0.42f},
        {"highroundhouse", 1.10f, 0.46f}, {"slip", 0.60f, 0.30f}, {"rollingduck", 0.90f, 0.45f}}};
    return table[static_cast<size_t>(move)];
}

inline int FindMove(const std::string& name) {
    for (int i = 0; i < kMoveCount; ++i) if (name == Info(static_cast<Move>(i)).name) return i;
    return -1;
}

namespace detail {

constexpr float kPi = 3.14159265f;

struct LimbKey { float t; glm::vec3 upper, lower; float w; };
struct TorsoKey { float t; float yaw, pitch, roll; glm::vec3 hips; float hipsYaw; };

inline float Smooth(float x) { x = std::clamp(x, 0.0f, 1.0f); return x * x * (3.0f - 2.0f * x); }

template <size_t N>
inline void Segment(const std::array<float, N>& times, float t, size_t& next, float& u) {
    next = 1;
    while (next < N - 1 && times[next] < t) ++next;
    u = Smooth((t - times[next - 1]) / std::max(0.0001f, times[next] - times[next - 1]));
}

template <size_t N>
inline void SampleLimb(const std::array<LimbKey, N>& keys, float t, glm::vec3& upper, glm::vec3& lower, float& w) {
    std::array<float, N> times{};
    for (size_t i = 0; i < N; ++i) times[i] = keys[i].t;
    size_t next;
    float u;
    Segment(times, t, next, u);
    const LimbKey& a = keys[next - 1];
    const LimbKey& b = keys[next];
    upper = glm::normalize(glm::mix(a.upper, b.upper, u));
    lower = glm::normalize(glm::mix(a.lower, b.lower, u));
    w = glm::mix(a.w, b.w, u);
}

template <size_t N>
inline TorsoKey SampleTorso(const std::array<TorsoKey, N>& keys, float t) {
    std::array<float, N> times{};
    for (size_t i = 0; i < N; ++i) times[i] = keys[i].t;
    size_t next;
    float u;
    Segment(times, t, next, u);
    const TorsoKey& a = keys[next - 1];
    const TorsoKey& b = keys[next];
    return {t, glm::mix(a.yaw, b.yaw, u), glm::mix(a.pitch, b.pitch, u), glm::mix(a.roll, b.roll, u), glm::mix(a.hips, b.hips, u), glm::mix(a.hipsYaw, b.hipsYaw, u)};
}

inline void Torso(std::vector<Model::BoneTurn>& turns, const TorsoKey& k, float side) {
    const float yaw = k.yaw * side, roll = k.roll * side;
    turns.push_back({"mixamorig:Hips", {0.0f, k.hipsYaw * side, 0.0f}, {k.hips.x * side, k.hips.y, k.hips.z}, true});
    turns.push_back({"mixamorig:Spine", {k.pitch * 0.30f, yaw * 0.30f, roll * 0.30f}, {0.0f, 0.0f, 0.0f}, true});
    turns.push_back({"mixamorig:Spine1", {k.pitch * 0.35f, yaw * 0.35f, roll * 0.35f}, {0.0f, 0.0f, 0.0f}, true});
    turns.push_back({"mixamorig:Spine2", {k.pitch * 0.35f, yaw * 0.35f, roll * 0.35f}, {0.0f, 0.0f, 0.0f}, true});
    turns.push_back({"mixamorig:Head", {-k.pitch * 0.4f, -yaw * 0.55f, -roll * 0.5f}, {0.0f, 0.0f, 0.0f}, true});   // la cabeza sigue mirando al rival
}

inline glm::vec3 Flip(glm::vec3 v, float side) { v.x *= side; return v; }

inline void Arm(std::vector<Model::BoneTurn>& turns, bool left, const glm::vec3& upper, const glm::vec3& lower, float w, float side) {
    const std::string s = left ? "Left" : "Right";
    // el lado se invierte al zurdo; el brazo derecho usa el espejo de las direcciones (+x es la izquierda del personaje)
    const float mirror = (left ? 1.0f : -1.0f) * side;
    glm::vec3 u = Flip(upper, mirror), l = Flip(lower, mirror);
    turns.push_back({"mixamorig:" + s + "Arm", {0.0f, 0.0f, 0.0f}, {0.0f, 0.0f, 0.0f}, true, "mixamorig:" + s + "ForeArm", u, w});
    turns.push_back({"mixamorig:" + s + "ForeArm", {0.0f, 0.0f, 0.0f}, {0.0f, 0.0f, 0.0f}, true, "mixamorig:" + s + "Hand", l, w});
}

inline void Leg(std::vector<Model::BoneTurn>& turns, bool left, const glm::vec3& upper, const glm::vec3& lower, float w, float side) {
    const std::string s = left ? "Left" : "Right";
    const float mirror = (left ? 1.0f : -1.0f) * side;
    glm::vec3 u = Flip(upper, mirror), l = Flip(lower, mirror);
    turns.push_back({"mixamorig:" + s + "UpLeg", {0.0f, 0.0f, 0.0f}, {0.0f, 0.0f, 0.0f}, true, "mixamorig:" + s + "Leg", u, w});
    turns.push_back({"mixamorig:" + s + "Leg", {0.0f, 0.0f, 0.0f}, {0.0f, 0.0f, 0.0f}, true, "mixamorig:" + s + "Foot", l, w});
}

} // namespace detail

// Puno cerrado: los cuatro dedos se enrollan sobre la palma y el pulgar los cruza. `amount` 0..1. Se gira en el marco de reposo de cada
// falange (ejes del modelo sobre la pose de reposo), asi la mano queda cerrada sea cual sea la postura del brazo.
inline void AppendFists(std::vector<Model::BoneTurn>& turns, float amount = 1.0f, bool left = true, bool right = true) {
    struct Joint { const char* name; float angle; };
    static const std::array<Joint, 12> fingers{{
        {"Index1", 1.35f}, {"Index2", 1.75f}, {"Index3", 1.15f}, {"Middle1", 1.40f}, {"Middle2", 1.80f}, {"Middle3", 1.15f},
        {"Ring1", 1.45f}, {"Ring2", 1.80f}, {"Ring3", 1.10f}, {"Pinky1", 1.50f}, {"Pinky2", 1.80f}, {"Pinky3", 1.05f}}};
    static const char* axisEnv = std::getenv("BAZUKO_FIST_AXIS");   // pruebas: x, y o z (por omision z)
    const int axis = axisEnv ? (axisEnv[0] == 'x' ? 0 : axisEnv[0] == 'y' ? 1 : 2) : 2;
    static const char* signEnv = std::getenv("BAZUKO_FIST_SIGN");
    const float flip = signEnv ? static_cast<float>(std::atof(signEnv)) : 1.0f;
    for (const bool isLeft : {true, false}) {
        if ((isLeft && !left) || (!isLeft && !right)) continue;
        const std::string s = isLeft ? "mixamorig:LeftHand" : "mixamorig:RightHand";
        static const char* leftEnv = std::getenv("BAZUKO_FIST_LSIGN");
        static const char* rightEnv = std::getenv("BAZUKO_FIST_RSIGN");   // pruebas: signo propio de la mano derecha
        const float sign = (isLeft ? (leftEnv ? static_cast<float>(std::atof(leftEnv)) : -1.0f) : (rightEnv ? static_cast<float>(std::atof(rightEnv)) : 1.0f)) * flip;
        const auto turn = [&](const std::string& name, float angle) {
            glm::vec3 angles(0.0f);
            angles[axis] = sign * angle * amount;
            turns.push_back({name, angles, {0.0f, 0.0f, 0.0f}, false, "", {0.0f, -1.0f, 0.0f}, 1.0f, true});
        };
        for (const Joint& joint : fingers) turn(s + joint.name, joint.angle);
        static const char* thumbEnv = std::getenv("BAZUKO_THUMB");   // pruebas: t1x,t1y,t1z,t2,t3 (radianes)
        float th[5] = {0.0f, -0.5f, 1.1f, 1.6f, 1.3f};
        if (thumbEnv) std::sscanf(thumbEnv, "%f,%f,%f,%f,%f", &th[0], &th[1], &th[2], &th[3], &th[4]);
        turns.push_back({s + "Thumb1", {th[0] * sign * amount, th[1] * sign * amount, th[2] * sign * amount}, {0.0f, 0.0f, 0.0f}, false, "", {0.0f, -1.0f, 0.0f}, 1.0f, true});
        turn(s + "Thumb2", th[3]);
        turn(s + "Thumb3", th[4]);
    }
}

// Giros de la tecnica `move` en el segundo `time` (0..duracion). `southpaw` invierte el lado que guia (zurdo). Siempre agrega los puños cerrados.
inline void AppendMove(std::vector<Model::BoneTurn>& turns, Move move, float time, bool southpaw = false) {
    using namespace detail;
    const float side = southpaw ? -1.0f : 1.0f;
    const MoveInfo& info = Info(move);
    time = std::clamp(time, 0.0f, info.duration);
    const glm::vec3 zero(0.0f);
    switch (move) {
        case Move::Jab: {   // puno recto del brazo adelantado: carga corta, extension, recoleccion y regreso a guardia
            static const std::array<LimbKey, 6> lead{{
                {0.00f, {0.35f, -0.8f, 0.45f}, {0.0f, 0.85f, 0.5f}, 0.0f}, {0.08f, {0.45f, -0.55f, 0.25f}, {0.1f, 0.7f, 0.55f}, 0.8f},
                {0.22f, {0.12f, 0.05f, 0.99f}, {0.1f, 0.05f, 0.99f}, 1.0f}, {0.30f, {0.12f, 0.05f, 0.99f}, {0.1f, 0.05f, 0.99f}, 1.0f},
                {0.45f, {0.45f, -0.55f, 0.3f}, {0.1f, 0.75f, 0.55f}, 0.7f}, {0.583f, {0.35f, -0.8f, 0.45f}, {0.0f, 0.85f, 0.5f}, 0.0f}}};
            static const std::array<TorsoKey, 4> torso{{{0.0f, 0, 0, 0, {0, 0, 0}, 0}, {0.22f, 0.20f, 0.05f, 0, {0, 0, 0}, 0.06f}, {0.30f, 0.20f, 0.05f, 0, {0, 0, 0}, 0.06f}, {0.583f, 0, 0, 0, {0, 0, 0}, 0}}};
            Torso(turns, SampleTorso(torso, time), side);
            glm::vec3 u, l; float w;
            SampleLimb(lead, time, u, l, w);
            Arm(turns, true, u, l, w, side);
            break;
        }
        case Move::Cross: {   // puno recto del brazo de atras: la cadera y el hombro giran hacia el golpe
            static const std::array<LimbKey, 6> rear{{
                {0.00f, {0.3f, -0.8f, 0.4f}, {0.0f, 0.8f, 0.55f}, 0.0f}, {0.15f, {0.3f, -0.8f, -0.4f}, {0.1f, 0.6f, 0.6f}, 0.9f},
                {0.30f, {0.08f, 0.05f, 0.99f}, {0.08f, 0.05f, 0.99f}, 1.0f}, {0.40f, {0.08f, 0.05f, 0.99f}, {0.08f, 0.05f, 0.99f}, 1.0f},
                {0.55f, {0.3f, -0.8f, 0.2f}, {0.1f, 0.65f, 0.6f}, 0.6f}, {0.75f, {0.3f, -0.8f, 0.4f}, {0.0f, 0.8f, 0.55f}, 0.0f}}};
            static const std::array<TorsoKey, 5> torso{{{0.0f, 0, 0, 0, {0, 0, 0}, 0}, {0.15f, -0.28f, 0.0f, 0, {0, 0, 0}, -0.12f},
                {0.30f, 0.55f, 0.08f, 0, {0, 0, 0}, 0.30f}, {0.45f, 0.45f, 0.06f, 0, {0, 0, 0}, 0.25f}, {0.75f, 0, 0, 0, {0, 0, 0}, 0}}};
            Torso(turns, SampleTorso(torso, time), side);
            glm::vec3 u, l; float w;
            SampleLimb(rear, time, u, l, w);
            Arm(turns, false, u, l, w, side);
            break;
        }
        case Move::Hook: {   // gancho: el codo sale a la altura del hombro y el antebrazo barre en horizontal; todo el tronco gira
            static const std::array<LimbKey, 7> lead{{
                {0.00f, {0.35f, -0.8f, 0.45f}, {0.0f, 0.85f, 0.5f}, 0.0f}, {0.14f, {0.9f, 0.1f, -0.4f}, {0.3f, 0.5f, 0.8f}, 1.0f},
                {0.28f, {0.85f, 0.1f, 0.5f}, {0.0f, 0.1f, 1.0f}, 1.0f}, {0.34f, {0.80f, 0.1f, 0.58f}, {-0.55f, 0.05f, 0.83f}, 1.0f},
                {0.46f, {0.80f, 0.1f, 0.58f}, {-0.55f, 0.05f, 0.83f}, 1.0f}, {0.62f, {0.6f, -0.3f, 0.4f}, {0.1f, 0.7f, 0.6f}, 0.6f},
                {0.80f, {0.35f, -0.8f, 0.45f}, {0.0f, 0.85f, 0.5f}, 0.0f}}};
            static const std::array<TorsoKey, 5> torso{{{0.0f, 0, 0, 0, {0, 0, 0}, 0}, {0.14f, -0.35f, 0.0f, 0, {0, 0, 0}, -0.15f},
                {0.34f, 0.80f, 0.06f, 0, {0, 0, 0}, 0.40f}, {0.46f, 0.70f, 0.05f, 0, {0, 0, 0}, 0.35f}, {0.80f, 0, 0, 0, {0, 0, 0}, 0}}};
            Torso(turns, SampleTorso(torso, time), side);
            glm::vec3 u, l; float w;
            SampleLimb(lead, time, u, l, w);
            Arm(turns, true, u, l, w, side);
            break;
        }
        case Move::Roundhouse:
        case Move::HighRoundhouse: {   // patada circular con la pierna de atras: rodilla arriba, cadera abierta y pierna que barre hacia el rival
            const bool high = move == Move::HighRoundhouse;
            static const std::array<LimbKey, 6> mid{{
                {0.00f, {-0.1f, -0.95f, 0.1f}, {-0.1f, -0.95f, 0.05f}, 0.0f}, {0.20f, {-0.1f, 0.25f, 0.96f}, {-0.1f, -0.95f, 0.15f}, 1.0f},
                {0.42f, {-0.45f, 0.35f, 0.82f}, {-0.30f, 0.40f, 0.87f}, 1.0f}, {0.56f, {-0.45f, 0.35f, 0.82f}, {-0.30f, 0.40f, 0.87f}, 1.0f},
                {0.76f, {-0.1f, 0.25f, 0.96f}, {-0.1f, -0.9f, 0.3f}, 1.0f}, {1.00f, {-0.1f, -0.95f, 0.1f}, {-0.1f, -0.95f, 0.05f}, 0.0f}}};
            static const std::array<LimbKey, 6> top{{
                {0.00f, {-0.1f, -0.95f, 0.1f}, {-0.1f, -0.95f, 0.05f}, 0.0f}, {0.22f, {-0.1f, 0.3f, 0.95f}, {-0.1f, -0.95f, 0.15f}, 1.0f},
                {0.46f, {-0.30f, 0.65f, 0.70f}, {-0.25f, 0.62f, 0.74f}, 1.0f}, {0.62f, {-0.30f, 0.65f, 0.70f}, {-0.25f, 0.62f, 0.74f}, 1.0f},
                {0.84f, {-0.1f, 0.3f, 0.95f}, {-0.1f, -0.9f, 0.3f}, 1.0f}, {1.10f, {-0.1f, -0.95f, 0.1f}, {-0.1f, -0.95f, 0.05f}, 0.0f}}};
            static const std::array<TorsoKey, 5> torsoMid{{{0.0f, 0, 0, 0, {0, 0, 0}, 0}, {0.20f, -0.10f, -0.05f, 0, {0, 0, 0}, 0.0f},
                {0.42f, 0.45f, -0.25f, 0, {0, 0, 0}, 0.45f}, {0.56f, 0.40f, -0.20f, 0, {0, 0, 0}, 0.40f}, {1.00f, 0, 0, 0, {0, 0, 0}, 0}}};
            static const std::array<TorsoKey, 5> torsoHigh{{{0.0f, 0, 0, 0, {0, 0, 0}, 0}, {0.22f, -0.10f, -0.08f, 0, {0, 0, 0}, 0.0f},
                {0.46f, 0.50f, -0.45f, 0, {0, 0, 0}, 0.55f}, {0.62f, 0.45f, -0.38f, 0, {0, 0, 0}, 0.50f}, {1.10f, 0, 0, 0, {0, 0, 0}, 0}}};
            Torso(turns, high ? SampleTorso(torsoHigh, time) : SampleTorso(torsoMid, time), side);
            glm::vec3 u, l; float w;
            if (high) SampleLimb(top, time, u, l, w); else SampleLimb(mid, time, u, l, w);
            Leg(turns, false, u, l, w, side);
            break;
        }
        case Move::Slip: {   // esquive lateral: la cabeza se desplaza a un lado y el tronco se inclina sin mover los pies
            static const std::array<TorsoKey, 4> torso{{{0.0f, 0, 0, 0, {0, 0, 0}, 0}, {0.30f, 0.30f, 0.12f, 0.58f, {0.15f, -0.04f, 0.0f}, 0.12f},
                {0.40f, 0.28f, 0.10f, 0.54f, {0.14f, -0.04f, 0.0f}, 0.10f}, {0.60f, 0, 0, 0, {0, 0, 0}, 0}}};
            Torso(turns, SampleTorso(torso, time), side);
            break;
        }
        case Move::RollingDuck: {   // esquive rotatorio: se agacha, el tronco cae hacia adelante y barre de un lado al otro por debajo del golpe
            static const std::array<TorsoKey, 6> torso{{{0.0f, 0, 0, 0, {0, 0, 0}, 0}, {0.18f, 0.35f, 0.55f, 0.15f, {0, -0.22f, 0.04f}, 0.15f},
                {0.45f, -0.10f, 0.95f, 0.0f, {0, -0.36f, 0.05f}, 0.0f}, {0.62f, -0.55f, 0.75f, -0.15f, {0, -0.30f, 0.04f}, -0.15f},
                {0.78f, -0.25f, 0.30f, 0.0f, {0, -0.12f, 0.02f}, -0.05f}, {0.90f, 0, 0, 0, {0, 0, 0}, 0}}};
            static const std::array<float, 6> bendTimes{{0.0f, 0.18f, 0.45f, 0.62f, 0.78f, 0.90f}};
            static const std::array<float, 6> bendAmount{{0.0f, 0.6f, 1.0f, 0.85f, 0.35f, 0.0f}};
            size_t next;
            float u;
            Segment(bendTimes, time, next, u);
            const float bend = glm::mix(bendAmount[next - 1], bendAmount[next], u);
            Torso(turns, SampleTorso(torso, time), side);
            for (const bool isLeft : {true, false}) {   // rodillas flexionadas para que los pies sigan en el suelo con la cadera abajo
                const glm::vec3 thigh = glm::normalize(glm::vec3(0.18f, -0.55f, 0.82f)), shin = glm::normalize(glm::vec3(0.08f, -0.9f, -0.42f));
                Leg(turns, isLeft, thigh, shin, bend, side);
            }
            break;
        }
    }
    AppendFists(turns, 1.0f);
}

} // namespace Bazuko::Combat
