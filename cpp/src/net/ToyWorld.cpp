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
    m_StepAccumulator += dtSeconds;   // pasos fijos de 1/30 s: igual que el cliente cuando predice
    while (m_StepAccumulator >= kStepSeconds) { m_StepAccumulator -= kStepSeconds; Step(); }
    m_SnapshotAccumulator += dtSeconds;
    const double interval = 1.0 / kSnapshotRate;
    if (m_SnapshotAccumulator >= interval) {
        m_SnapshotAccumulator = std::fmod(m_SnapshotAccumulator, interval);
        ++m_SnapshotIndex;
        for (const auto& [peer, player] : m_Players) {
            BitWriter writer;
            Write(writer, BuildSnapshot(player));
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
            state.id = NextFreeId();
            if (state.id == 0) { Write(answer, Reject{RejectReason::ServerFull}); m_Host.Send(event.peer, kChannelReliable, answer.Data(), true); m_Host.Disconnect(event.peer); return; }
            state.name = hello->name;
            state.session.position = glm::vec3(112.98f + static_cast<float>(state.id) * 1.5f, 0.0f, 97.84f);   // no aparecen unos sobre otros
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

void ToyServer::Step() {
    ++m_Tick;
    for (auto& [peer, player] : m_Players) ApplyInput(player.session, player.input, FlatWorld(), kStepSeconds);   // el servidor decide: velocidad y mapa salen de las reglas, no del cliente
}

uint8_t ToyServer::NextFreeId() const {
    for (uint32_t id = 1; id <= 127; ++id) {
        bool used = false;
        for (const auto& [peer, player] : m_Players) used = used || player.id == id;
        if (!used) return static_cast<uint8_t>(id);
    }
    return 0;
}

Snapshot ToyServer::BuildSnapshot(const ToyPlayerState& viewer) const {
    Snapshot snapshot;
    snapshot.serverTick = m_Tick;
    snapshot.ackInput = viewer.lastInput;
    struct Candidate { float distance; const ToyPlayerState* player; };
    std::vector<Candidate> candidates;
    for (const auto& [peer, other] : m_Players) {
        if (other.id == viewer.id) continue;
        const float distance = std::hypot(other.session.position.x - viewer.session.position.x, other.session.position.z - viewer.session.position.z);
        if (distance > kFarRadius) continue;
        // frecuencia por distancia: cerca siempre, media distancia cada 2 instantaneas, lejos cada 4
        const bool due = distance <= kNearRadius || (distance <= kMidRadius ? (m_SnapshotIndex % 2 == 0) : (m_SnapshotIndex % 4 == 0));
        if (due) candidates.push_back({distance, &other});
    }
    std::sort(candidates.begin(), candidates.end(), [](const Candidate& a, const Candidate& b) { return a.distance < b.distance; });
    if (candidates.size() > kMaxSnapshotEntries - 1) candidates.resize(kMaxSnapshotEntries - 1);   // los mas cercanos primero
    const auto entryOf = [](const ToyPlayerState& p) {
        return MakeSnapshot(p.id, p.session);
    };
    snapshot.players.push_back(entryOf(viewer));   // el propio jugador siempre va (confirma su posicion)
    for (const Candidate& c : candidates) snapshot.players.push_back(entryOf(*c.player));
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
                    if (snapshot->serverTick >= m_Last.serverTick) {   // un snapshot viejo que llega tarde se ignora
                        m_Last = *snapshot;
                        for (const PlayerSnapshot& entry : snapshot->players) { m_Known[entry.id] = entry; m_KnownTick[entry.id] = snapshot->serverTick; }
                        for (auto it = m_KnownTick.begin(); it != m_KnownTick.end();) {   // 2 s a 30 Hz sin noticias: ya no esta cerca
                            if (snapshot->serverTick > it->second + 60) { m_Known.erase(it->first); it = m_KnownTick.erase(it); } else ++it;
                        }
                    }
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
