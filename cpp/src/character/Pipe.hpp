#pragma once
// Fumar basuco en pipa (port de src/character/pipe.js y de Player.startBasuco/_updateBasuco): agachado, la pipa en la mano izquierda contra la boca y el encendedor en la
// derecha debajo de la cazoleta. Es una accion quieta y corta; la bocanada sale al bajar las manos y el efecto llega al terminar de aspirar.
// Solo reglas y tiempos: la pose esta en PipePose.hpp.
#include <algorithm>
#include <cmath>

namespace Bazuko::Pipe {

// En segundos desde que empieza: agacharse y subir las manos, prender y aspirar, bajarlas, y el humo
constexpr float kBend = 0.9f, kLight = 3.2f, kLower = 0.9f, kExhale = 2.8f;
constexpr float kLength = kBend + kLight + kLower;    // quieto con la pipa
constexpr float kTotal = kBend + kLight + kExhale;    // hasta el fin del humo

inline float Smooth(float x) { return x <= 0.0f ? 0.0f : x >= 1.0f ? 1.0f : x * x * (3.0f - 2.0f * x); }

// 0 de pie, 1 agachado con la pipa en la boca; t < 0 = sin pipa
inline float Reach(float t) {
    if (t < 0.0f) return 0.0f;
    if (t < kBend) return Smooth(t / kBend);
    if (t < kBend + kLight) return 1.0f;
    return 1.0f - Smooth((t - kBend - kLight) / kLower);
}
// La llama del encendedor: se prende al llegar arriba y se apaga al dejar de aspirar
inline bool IsLit(float t) { return t >= kBend * 0.8f && t < kBend + kLight; }
// La bocanada sale al bajar las manos
inline bool IsExhaling(float t) { return t >= kBend + kLight && t < kTotal; }

struct State {
    bool active = false;
    float t = 0.0f;
    bool inhaled = false;     // ya llego el efecto
    bool stowed = false;      // guardo la pipa y el encendedor (sigue saliendo el humo)
    float reach = 0.0f;       // pose suavizada 0..1
};
struct Conditions {
    bool busy = false;        // en otra accion, peleando o con la pipa imposible de usar
    bool blocked = false;     // nadando, en el aire, aturdido o dormido
};
struct Events {
    bool inhaled = false;     // el efecto del basuco llega ahora
    bool stowedNow = false;   // guarda la pipa
};

inline bool Start(State& s, const Conditions& c) {
    if (s.active || c.busy || c.blocked) return false;
    s = State{};
    s.active = true;
    return true;
}
inline bool Holding(const State& s) { return s.active && !s.stowed; }   // la pipa esta en la mano: se queda quieto
inline void Stop(State& s) { s = State{}; }

inline Events Step(State& s, float dt, const Conditions& c) {
    Events e;
    // la pose se suaviza (14 /s) hacia lo que toca; guardada la pipa, vuelve a 0
    s.reach += ((s.active && !s.stowed ? Reach(s.t) : 0.0f) - s.reach) * -std::expm1(-std::max(0.0f, dt) * 14.0f);
    if (!s.active) return e;
    if (c.blocked) { Stop(s); return e; }
    s.t += dt;
    if (!s.inhaled && s.t >= kBend + kLight) { s.inhaled = true; e.inhaled = true; }   // el efecto llega al terminar de aspirar
    if (!s.stowed && s.t >= kLength) { s.stowed = true; e.stowedNow = true; }
    if (s.t >= kTotal) s.active = false;
    return e;
}

} // namespace Bazuko::Pipe
