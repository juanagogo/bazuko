#include "ToyWorld.hpp"

#include <algorithm>
#include <cmath>

namespace Bazuko::Net {

namespace {
constexpr float kMapMinX = 0.0f, kMapMaxX = 400.0f, kMapMinZ = -74.0f, kMapMaxZ = 322.0f;
bool Finite(float v) { return std::isfinite(v); }
}

void ToyServer::Update(double dtSeconds) {
    NetEvent event;
    while (m_Host.Poll(event)) Handle(event);
    Step(dtSeconds);
    m_SnapshotAccumulator += dtSeconds;
    const double interval = 1.0 / kSnapshotRate;
    if (m_SnapshotAccumulator >= interval) {
        m_SnapshotAccumulator = std::fmod(m_SnapshotAccumulator, interval);
        for (const auto& [peer, player] : m_Players) {
            BitWriter writer;
            Write(writer, BuildSnapshot(player, 140.0f));
            m_Host.Send(peer, kChannelUnreliable, writer.Data(), false);
        }
    }
}

void ToyServer::Handle(const NetEvent& event) {
    if (event.type == NetEvent::Type::Connected) { m_Pending[event.peer] = true; return; }
    if (event.type == NetEvent::Type::Disconnected) { m_Pending.erase(event.peer); m_Players.erase(event.peer); return; }

    BitReader reader(event.data);
    const auto type = ReadType(reader);
    if (!type) { ++m_Rejected; return; }
    const auto player = m_Players.find(event.peer);
    if (*type == MessageType::Hello) {
        const auto hello = ReadHello(reader);
        if (!hello || player != m_Players.end()) { ++m_Rejected; return; }
        BitWriter answer;
        if (hello->protocol != kProtocolVersion) { Write(answer, Reject{RejectReason::WrongProtocol}); }
        else if (hello->name.empty()) { Write(answer, Reject{RejectReason::BadName}); }
        else if (m_Players.size() >= m_MaxPlayers) { Write(answer, Reject{RejectReason::ServerFull}); }
        else {
            ToyPlayerState state;
            state.id = m_NextId++;
            state.name = hello->name;
            state.x += static_cast<float>(state.id) * 1.5f;   // no aparecen unos sobre otros
            m_Players[event.peer] = state;
            Welcome welcome; welcome.playerId = state.id; welcome.serverTick = m_Tick; welcome.worldSeed = m_Seed;
            welcome.tickRate = kTickRate; welcome.snapshotRate = kSnapshotRate;
            Write(answer, welcome);
            m_Host.Send(event.peer, kChannelReliable, answer.Data(), true);
            return;
        }
        m_Host.Send(event.peer, kChannelReliable, answer.Data(), true);
        m_Host.Disconnect(event.peer);
        return;
    }
    if (player == m_Players.end()) { ++m_Rejected; return; }   // todo lo demas exige haber saludado antes
    if (*type == MessageType::Input) {
        const auto input = ReadInput(reader);
        if (!input || !Finite(input->moveX) || !Finite(input->moveZ)) { ++m_Rejected; return; }
        // los input llegan por un canal no fiable: solo vale el mas nuevo (los viejos o repetidos se descartan)
        if (input->sequence <= player->second.lastInput) return;
        player->second.input = *input;
        player->second.lastInput = input->sequence;
    } else if (*type == MessageType::Bye) {
        m_Host.Disconnect(event.peer);
    } else if (*type == MessageType::Ping) {
        if (const auto ping = ReadPing(reader)) { BitWriter pong; Write(pong, *ping, true); m_Host.Send(event.peer, kChannelUnreliable, pong.Data(), false); }
    } else {
        ++m_Rejected;
    }
}

void ToyServer::Step(double dt) {
    ++m_Tick;
    for (auto& [peer, player] : m_Players) {
        // el servidor decide: la direccion se normaliza y la velocidad sale de los botones, no de lo que diga el cliente
        float directionX = player.input.moveX, directionZ = player.input.moveZ;
        const float length = std::sqrt(directionX * directionX + directionZ * directionZ);
        if (length > 1.0f) { directionX /= length; directionZ /= length; }
        const float speed = (player.input.buttons & kRun) ? kRunSpeed : kWalkSpeed;
        player.speed = length > 0.05f ? speed * std::min(1.0f, length) : 0.0f;
        player.x = std::clamp(player.x + directionX * player.speed * static_cast<float>(dt), kMapMinX, kMapMaxX);
        player.z = std::clamp(player.z + directionZ * player.speed * static_cast<float>(dt), kMapMinZ, kMapMaxZ);
        player.yaw = player.input.yaw;
    }
}

Snapshot ToyServer::BuildSnapshot(const ToyPlayerState& viewer, float radius) const {
    Snapshot snapshot;
    snapshot.serverTick = m_Tick;
    snapshot.ackInput = viewer.lastInput;
    for (const auto& [peer, other] : m_Players) {
        if (other.id != viewer.id && std::hypot(other.x - viewer.x, other.z - viewer.z) > radius) continue;   // radio de interes
        PlayerSnapshot entry; entry.id = other.id; entry.x = other.x; entry.y = 0.0f; entry.z = other.z; entry.yaw = other.yaw; entry.speed = other.speed;
        snapshot.players.push_back(entry);
    }
    return snapshot;
}

// ---- cliente ----

bool ToyClient::Start(const std::string& address, uint16_t port, const NetSimConfig& simulation, uint32_t seed) {
    m_Host = Host::CreateClient();
    if (!m_Host) return false;
    if (simulation.Active()) m_Host->SetSimulation(simulation, seed);
    return m_Host->Connect(address, port);
}

void ToyClient::Update() {
    if (!m_Host) return;
    NetEvent event;
    while (m_Host->Poll(event)) {
        if (event.type == NetEvent::Type::Connected) {
            m_Server = event.peer;
            BitWriter writer;
            Hello hello; hello.name = m_Name;
            Write(writer, hello);
            m_Host->Send(m_Server, kChannelReliable, writer.Data(), true);
        } else if (event.type == NetEvent::Type::Disconnected) {
            m_Dropped = true;
        } else {
            BitReader reader(event.data);
            const auto type = ReadType(reader);
            if (!type) continue;
            if (*type == MessageType::Welcome) { if (const auto welcome = ReadWelcome(reader)) { m_Welcome = *welcome; m_Welcomed = true; } }
            else if (*type == MessageType::Reject) { if (const auto reject = ReadReject(reader)) m_RejectedReason = static_cast<uint8_t>(reject->reason); }
            else if (*type == MessageType::Snapshot) {
                if (const auto snapshot = ReadSnapshot(reader)) {
                    if (snapshot->serverTick >= m_Last.serverTick) m_Last = *snapshot;   // un snapshot viejo que llega tarde se ignora
                    ++m_SnapshotCount;
                }
            }
        }
    }
}

void ToyClient::SendInput(const PlayerInput& input) {
    if (!m_Host || !m_Welcomed) return;
    BitWriter writer;
    Write(writer, input);
    m_Host->Send(m_Server, kChannelUnreliable, writer.Data(), false);
}

void ToyClient::Leave() {
    if (!m_Host || !m_Server) return;
    BitWriter writer;
    WriteBye(writer);
    m_Host->Send(m_Server, kChannelReliable, writer.Data(), true);
}

} // namespace Bazuko::Net
