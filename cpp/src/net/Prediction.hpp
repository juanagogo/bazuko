#pragma once
// Prediccion y reconciliacion del jugador local. El cliente aplica sus propias entradas al instante con las MISMAS reglas que el servidor
// (PlayerSim) y las recuerda; cuando llega una instantanea con el ultimo numero de entrada que el servidor aplico (`ackInput`), toma de ahi el estado
// autoritativo (posicion, velocidad y rumbo) y vuelve a aplicar las entradas que el servidor aun no habia visto. Si todo coincide la correccion es cero;
// si el servidor hizo algo distinto (perdio una entrada, una pared, un atropello), el jugador se corrige sin saltos grandes.
#include "PlayerSim.hpp"

#include <deque>

namespace Bazuko::Net {

class Predictor {
public:
    explicit Predictor(const PlayerSession& initial, const Movement::World& world = FlatWorld()) : m_State(initial), m_World(&world) {}

    // Aplica una entrada localmente y la guarda hasta que el servidor la confirme. Devuelve el numero de secuencia de la entrada.
    uint32_t Apply(PlayerInput input, float dt = kStepSeconds) {
        input.sequence = ++m_Sequence;
        ApplyInput(m_State, input, *m_World, dt);
        m_Pending.push_back({input, dt});
        if (m_Pending.size() > kMaxPending) m_Pending.pop_front();   // si el servidor no contesta nunca, no crece sin limite
        return input.sequence;
    }

    // Una instantanea del servidor con el estado autoritativo de este jugador y el ultimo `sequence` suyo que aplico.
    // Devuelve cuanto se movio el jugador por la correccion (metros).
    float Reconcile(const PlayerSnapshot& authoritative, uint32_t ackInput) {
        const glm::vec3 before = m_State.position;
        while (!m_Pending.empty() && m_Pending.front().input.sequence <= ackInput) m_Pending.pop_front();
        m_State.position = glm::vec3(authoritative.x, authoritative.y, authoritative.z);
        m_State.playerVelocity = glm::vec3(authoritative.vx, 0.0f, authoritative.vz);
        m_State.playerYaw = authoritative.yaw;
        for (const Step& step : m_Pending) ApplyInput(m_State, step.input, *m_World, step.dt);
        m_LastCorrection = glm::distance(before, m_State.position);
        return m_LastCorrection;
    }

    const PlayerSession& State() const { return m_State; }
    size_t Pending() const { return m_Pending.size(); }
    float LastCorrection() const { return m_LastCorrection; }

private:
    struct Step { PlayerInput input; float dt; };
    static constexpr size_t kMaxPending = 120;   // 4 s de entradas a 30 Hz
    PlayerSession m_State;
    const Movement::World* m_World;
    std::deque<Step> m_Pending;
    uint32_t m_Sequence = 0;
    float m_LastCorrection = 0.0f;
};

} // namespace Bazuko::Net
