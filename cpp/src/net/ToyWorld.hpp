#pragma once
// Servidor y cliente "de juguete" sobre el protocolo: un mundo plano sin ciudad ni NPC donde cada jugador solo camina.
// Sirven para probar la red de punta a punta (conexion, validacion, instantaneas, latencia y perdida) antes de tocar la simulacion real,
// y para el servidor de bots. El servidor es autoritativo: aplica los input, limita velocidad y mapa, y confirma el ultimo input aplicado.
#include "Protocol.hpp"
#include "Transport.hpp"

#include <map>
#include <string>
#include <vector>

namespace Bazuko::Net {

struct ToyPlayerState {
    uint8_t id = 0;
    std::string name;
    float x = 112.98f, z = 97.84f, yaw = 0.0f, speed = 0.0f;
    uint32_t lastInput = 0;
    PlayerInput input;   // el ultimo valido recibido
    double lastInputMs = 0.0;
};

class ToyServer {
public:
    ToyServer(Host& host, uint32_t worldSeed, uint8_t maxPlayers = 8) : m_Host(host), m_Seed(worldSeed), m_MaxPlayers(maxPlayers) {}
    // Atiende la red y avanza el mundo `dt` segundos; envia instantaneas segun `kSnapshotRate`
    void Update(double dtSeconds);
    const std::map<uint32_t, ToyPlayerState>& Players() const { return m_Players; }   // por identificador de conexion
    uint64_t RejectedPackets() const { return m_Rejected; }
    uint32_t Tick() const { return m_Tick; }

    static constexpr int kTickRate = 30;
    static constexpr int kSnapshotRate = 20;
    static constexpr float kWalkSpeed = 1.8f, kRunSpeed = 4.8f;

private:
    void Handle(const NetEvent& event);
    void Step(double dt);
    Snapshot BuildSnapshot(const ToyPlayerState& viewer, float radius) const;

    Host& m_Host;
    uint32_t m_Seed;
    uint8_t m_MaxPlayers;
    std::map<uint32_t, ToyPlayerState> m_Players;
    std::map<uint32_t, bool> m_Pending;   // conexiones abiertas que aun no mandaron un Hello valido
    uint32_t m_Tick = 0;
    double m_SnapshotAccumulator = 0.0;
    uint64_t m_Rejected = 0;
    uint8_t m_NextId = 1;
};

class ToyClient {
public:
    explicit ToyClient(std::string name) : m_Name(std::move(name)) {}
    bool Start(const std::string& address, uint16_t port, const NetSimConfig& simulation = {}, uint32_t seed = 1);
    void Update();   // atiende la red
    void SendInput(const PlayerInput& input);
    void Leave();

    bool Connected() const { return m_Welcomed; }
    bool Rejected() const { return m_RejectedReason != 0; }
    uint8_t Id() const { return m_Welcome.playerId; }
    const Snapshot& LastSnapshot() const { return m_Last; }
    uint64_t SnapshotsReceived() const { return m_SnapshotCount; }
    uint32_t AckedInput() const { return m_Last.ackInput; }
    uint32_t NextSequence() { return ++m_Sequence; }
    Host& Network() { return *m_Host; }
    bool DisconnectedByServer() const { return m_Dropped; }

private:
    std::string m_Name;
    std::unique_ptr<Host> m_Host;
    Welcome m_Welcome;
    bool m_Welcomed = false, m_Dropped = false;
    uint8_t m_RejectedReason = 0;
    Snapshot m_Last;
    uint64_t m_SnapshotCount = 0;
    uint32_t m_Sequence = 0;
    uint32_t m_Server = 0;
};

} // namespace Bazuko::Net
