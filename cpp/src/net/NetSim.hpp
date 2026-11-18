#pragma once
// Simulador de red para pruebas: retrasa, pierde, duplica y desordena paquetes con un generador de azar con semilla.
// Se coloca entre el emisor y el receptor (en memoria o delante del transporte): `Send` mete un paquete con la hora actual y `Receive`
// entrega los que ya vencieron. Variables de entorno para el juego: BAZUKO_NET_LAG (ms), BAZUKO_NET_JITTER (ms), BAZUKO_NET_LOSS (0-100 %).
#include <algorithm>
#include <cstdint>
#include <cstdlib>
#include <random>
#include <vector>

namespace Bazuko::Net {

struct NetSimConfig {
    double lagMs = 0.0;       // latencia base de ida (ms)
    double jitterMs = 0.0;    // variacion uniforme +/- (ms); puede desordenar paquetes
    double lossPercent = 0.0; // paquetes perdidos (%)
    double duplicatePercent = 0.0;

    static NetSimConfig FromEnvironment() {
        NetSimConfig config;
        if (const char* v = std::getenv("BAZUKO_NET_LAG")) config.lagMs = std::atof(v);
        if (const char* v = std::getenv("BAZUKO_NET_JITTER")) config.jitterMs = std::atof(v);
        if (const char* v = std::getenv("BAZUKO_NET_LOSS")) config.lossPercent = std::atof(v);
        if (const char* v = std::getenv("BAZUKO_NET_DUP")) config.duplicatePercent = std::atof(v);
        return config;
    }
    bool Active() const { return lagMs > 0.0 || jitterMs > 0.0 || lossPercent > 0.0 || duplicatePercent > 0.0; }
};

class NetSim {
public:
    explicit NetSim(NetSimConfig config = {}, uint32_t seed = 1) : m_Config(config), m_Random(seed) {}

    void Send(std::vector<uint8_t> packet, double nowMs) {
        ++m_Sent;
        if (Chance(m_Config.lossPercent)) { ++m_Lost; return; }
        Enqueue(packet, nowMs);
        if (Chance(m_Config.duplicatePercent)) { ++m_Duplicated; Enqueue(packet, nowMs); }
    }
    // Entrega, en orden de llegada, los paquetes cuya hora ya paso
    std::vector<std::vector<uint8_t>> Receive(double nowMs) {
        std::vector<std::vector<uint8_t>> ready;
        std::stable_sort(m_Queue.begin(), m_Queue.end(), [](const Entry& a, const Entry& b) { return a.arrival < b.arrival; });
        size_t delivered = 0;
        while (delivered < m_Queue.size() && m_Queue[delivered].arrival <= nowMs) { ready.push_back(std::move(m_Queue[delivered].data)); ++delivered; }
        m_Queue.erase(m_Queue.begin(), m_Queue.begin() + static_cast<std::ptrdiff_t>(delivered));
        return ready;
    }
    size_t Pending() const { return m_Queue.size(); }
    uint64_t Sent() const { return m_Sent; }
    uint64_t Lost() const { return m_Lost; }
    uint64_t Duplicated() const { return m_Duplicated; }

private:
    struct Entry { double arrival; std::vector<uint8_t> data; };
    bool Chance(double percent) { return percent > 0.0 && std::uniform_real_distribution<double>(0.0, 100.0)(m_Random) < percent; }
    void Enqueue(const std::vector<uint8_t>& packet, double nowMs) {
        double delay = m_Config.lagMs;
        if (m_Config.jitterMs > 0.0) delay += std::uniform_real_distribution<double>(-m_Config.jitterMs, m_Config.jitterMs)(m_Random);
        m_Queue.push_back({nowMs + std::max(0.0, delay), packet});
    }

    NetSimConfig m_Config;
    std::mt19937 m_Random;
    std::vector<Entry> m_Queue;
    uint64_t m_Sent = 0, m_Lost = 0, m_Duplicated = 0;
};

} // namespace Bazuko::Net
