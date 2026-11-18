#pragma once
// Cola de eventos del juego. La logica la llama con `Emit`; el audio, los efectos de imagen y la red la consumen con `Drain` (o se suscriben).
// Pensada para introducirse sin quitar las llamadas directas actuales: durante la transicion se emite EN PARALELO y una prueba comprueba que
// ambos caminos coinciden; cuando coinciden, se retiran las llamadas directas (hito 1).
#include "PlayerView.hpp"

#include <algorithm>
#include <functional>
#include <vector>

namespace Bazuko::Net {

class EventBus {
public:
    using Listener = std::function<void(const GameEvent&)>;

    void Emit(GameEvent event) {
        if (m_Queue.size() >= m_MaxQueued) m_Queue.erase(m_Queue.begin());   // nunca crece sin limite si nadie la vacia
        m_Queue.push_back(event);
        ++m_Emitted;
        for (const Listener& listener : m_Listeners) if (listener) listener(event);
    }
    void Emit(GameEventType type, uint8_t player, Vec3 position, float value = 0.0f, uint32_t tick = 0) { Emit(GameEvent{type, player, position, value, tick}); }

    // Entrega y vacia lo emitido desde la ultima vez
    std::vector<GameEvent> Drain() {
        std::vector<GameEvent> out;
        out.swap(m_Queue);
        return out;
    }
    // Suscripcion inmediata (por ejemplo el audio): se llama durante Emit
    size_t Subscribe(Listener listener) { m_Listeners.push_back(std::move(listener)); return m_Listeners.size() - 1; }
    void Unsubscribe(size_t handle) { if (handle < m_Listeners.size()) m_Listeners[handle] = nullptr; }

    size_t Pending() const { return m_Queue.size(); }
    uint64_t Emitted() const { return m_Emitted; }
    void SetMaxQueued(size_t count) { m_MaxQueued = std::max<size_t>(1, count); }

private:
    std::vector<GameEvent> m_Queue;
    std::vector<Listener> m_Listeners;
    size_t m_MaxQueued = 4096;
    uint64_t m_Emitted = 0;
};

} // namespace Bazuko::Net
