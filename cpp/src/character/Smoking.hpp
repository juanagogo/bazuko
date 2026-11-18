#pragma once
// Fumar un cigarrillo o un porro (port de src/character/smoking.js y de Player._updateSmoking): el cigarrillo se queda en la mano izquierda 10 minutos,
// cada 30 s se da una calada (sube la mano a la boca, aspira, baja y bota el humo) y se puede fumar caminando. El porro, ademas, pega en cada calada.
// Solo reglas y tiempos: sin dibujo ni mundo (la pose esta en SmokingPose.hpp y el humo en SmokePuffs.hpp).
#include <algorithm>
#include <cmath>
#include <cstring>
#include <string>

namespace Bazuko::Smoking {

constexpr float kDuration = 600.0f;      // segundos que dura (10 minutos)
constexpr float kPuffInterval = 30.0f;   // segundos entre caladas
constexpr float kFirstPuff = 2.0f;       // la primera calada llega enseguida, al prenderlo

// Calada: subir la mano, aspirar, bajarla y botar el humo. En segundos desde que empieza.
constexpr float kRaise = 0.8f, kHold = 1.4f, kLower = 0.8f, kExhale = 1.6f;
constexpr float kPuffLength = kRaise + kHold + kLower;
constexpr float kPuffTotal = kPuffLength + kExhale;

inline float Smooth(float x) { return x <= 0.0f ? 0.0f : x >= 1.0f ? 1.0f : x * x * (3.0f - 2.0f * x); }

// Que tan cerca de la boca esta la mano: 0 abajo, 1 en la boca. `t` < 0 = sin calada.
inline float PuffReach(float t) {
    if (t < 0.0f) return 0.0f;
    if (t < kRaise) return Smooth(t / kRaise);
    if (t < kRaise + kHold) return 1.0f;
    return 1.0f - Smooth((t - kRaise - kHold) / kLower);
}
// Que tan encendida esta la brasa: se aviva mientras aspira
inline float EmberGlow(float t) {
    if (t < 0.0f || t < kRaise * 0.6f) return 0.0f;
    const float end = kRaise + kHold;
    if (t < end) return Smooth((t - kRaise * 0.6f) / 0.4f);
    return 1.0f - Smooth((t - end) / 0.5f);
}
// ¿Esta botando el humo de la calada? (empieza al bajar la mano)
inline bool IsExhaling(float t) { return t >= kRaise + kHold && t < kPuffTotal; }

struct Smokable {
    const char* id;
    const char* name;         // «un cigarrillo», «un porro»
    float paper[3], filter[3];
    float radius;
    float smoke[3];           // color del humo
    const char* effect;       // efecto de consumo en cada calada (substanceEffects), o nullptr
};
inline const Smokable* Find(const std::string& id) {
    static const Smokable table[2] = {
        {"cigarrillo", "cigarrillo", {0.945f, 0.929f, 0.894f}, {0.788f, 0.541f, 0.290f}, 0.0045f, {0.847f, 0.847f, 0.847f}, nullptr},
        {"hierba", "porro", {0.902f, 0.875f, 0.784f}, {0.957f, 0.945f, 0.910f}, 0.0058f, {0.561f, 0.863f, 0.455f}, "hierba"},
    };
    for (const Smokable& s : table) if (id == s.id) return &s;
    return nullptr;
}

struct State {
    bool active = false;
    std::string kind;
    float left = 0.0f;        // segundos que le quedan
    float nextPuff = 0.0f;    // segundos hasta la proxima calada (corre tambien durante la actual: una cada 30 s exactos)
    float puff = -1.0f;       // segundos desde que empezo la calada; < 0 si no hay
    bool inhaled = false;     // ya pego en esta calada
    float hold = 0.0f, reach = 0.0f;   // pose suavizada (0..1): sosteniendolo y cerca de la boca
};

struct Conditions {
    bool blocked = false;     // nadando, en el aire, noqueado o dormido: no se puede (y si ya fumaba, se le cae)
    bool busy = false;        // peleando o en una accion: no da caladas
};

struct Events {
    bool finished = false;    // se acabo el cigarrillo
    bool dropped = false;     // se le cayo (nado, salto, golpe)
    bool hit = false;         // el porro pego (una vez por calada, al botar el humo)
    const char* effect = nullptr;
};

inline bool Start(State& s, const std::string& kind, const Conditions& c) {
    if (s.active || c.blocked || !Find(kind)) return false;
    s = State{};
    s.active = true; s.kind = kind; s.left = kDuration; s.nextPuff = kFirstPuff;
    return true;
}
inline void Stop(State& s) { s = State{}; }

inline Events Step(State& s, float dt, const Conditions& c) {
    Events e;
    // la pose se suaviza aunque ya no fume (baja la mano y suelta)
    const float k = 1.0f - std::exp(-10.0f * dt);
    s.hold += ((s.active ? 1.0f : 0.0f) - s.hold) * k;
    s.reach += ((s.active ? PuffReach(s.puff) : 0.0f) - s.reach) * std::min(1.0f, k * 2.0f);
    if (!s.active) return e;
    if (c.blocked) { Stop(s); e.dropped = true; return e; }
    s.left -= dt;
    if (s.left <= 0.0f) { Stop(s); e.finished = true; return e; }
    s.nextPuff -= dt;
    if (c.busy) s.puff = -1.0f;
    if (s.puff >= 0.0f) {
        s.puff += dt;
        if (s.puff >= kPuffTotal) s.puff = -1.0f;
    } else if (s.nextPuff <= 0.0f && !c.busy) {
        s.puff = 0.0f; s.inhaled = false; s.nextPuff += kPuffInterval;
    }
    const Smokable* look = Find(s.kind);
    if (look && look->effect && IsExhaling(s.puff) && !s.inhaled) { s.inhaled = true; e.hit = true; e.effect = look->effect; }
    return e;
}

} // namespace Bazuko::Smoking
