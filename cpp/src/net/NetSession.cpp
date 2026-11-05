#include "NetSession.hpp"

#include <algorithm>
#include <cmath>

namespace Bazuko::Net {

namespace {
constexpr double kSendInterval = 1.0 / 20.0;     // estado propio e instantaneas a 20 Hz
constexpr double kForgetMs = 3000.0;             // un remoto que no da noticias en 3 s ya no esta
constexpr float kInterestRadius = 160.0f;
constexpr double kWorldInterval = 1.0 / 10.0;    // el mundo (trafico, peatones) a 10 Hz; el invitado extrapola entre una y otra

bool InMap(const PlayerSnapshot& p) {
    return std::isfinite(p.x) && std::isfinite(p.y) && std::isfinite(p.z) && p.x >= 0.0f && p.x <= 400.0f && p.z >= -74.0f && p.z <= 322.0f && p.y > -10.0f && p.y < 60.0f;
}

PlayerSnapshot Describe(uint8_t id, const LocalState& local) {
    PlayerSnapshot p;
    p.id = id;
    p.x = local.position.x; p.y = local.position.y; p.z = local.position.z;
    p.yaw = local.yaw;
    p.vx = std::clamp(local.velocity.x, -kMaxVelocity, kMaxVelocity);
    p.vz = std::clamp(local.velocity.z, -kMaxVelocity, kMaxVelocity);
    p.speed = std::sqrt(local.velocity.x * local.velocity.x + local.velocity.z * local.velocity.z);
    p.flags = local.knockedDown ? 2 : 0;
    return p;
}
}

std::unique_ptr<NetSession> NetSession::StartHost(uint16_t port, const std::string& name, size_t maxPlayers) {
    std::unique_ptr<NetSession> session(new NetSession());
    session->m_Role = Role::Host;
    session->m_Name = name;
    session->m_MaxPlayers = std::clamp<size_t>(maxPlayers, 2, kMaxPlayers);
    session->m_Host = Host::CreateServer(port, session->m_MaxPlayers + 8);
    if (!session->m_Host) return nullptr;
    session->m_LocalId = 1;
    return session;
}

std::unique_ptr<NetSession> NetSession::Join(const std::string& address, uint16_t port, const std::string& name) {
    std::unique_ptr<NetSession> session(new NetSession());
    session->m_Role = Role::Client;
    session->m_Name = name;
    session->m_Host = Host::CreateClient();
    if (!session->m_Host || !session->m_Host->Connect(address, port)) return nullptr;
    return session;
}

uint8_t NetSession::FreeId() const {
    for (uint32_t id = 2; id <= 127; ++id) {
        bool used = false;
        for (const auto& [peer, info] : m_Peers) used = used || (info.id == id);
        if (!used) return static_cast<uint8_t>(id);
    }
    return 0;
}

void NetSession::Update(float dt, const LocalState& local) {
    m_LastLocal = local;
    if (m_Role == Role::Host) UpdateHost(dt, local); else UpdateClient(dt, local);
    SmoothRemote(dt);
}

void NetSession::UpdateHost(float dt, const LocalState& local) {
    NetEvent event;
    while (m_Host->Poll(event)) {
        if (event.type == NetEvent::Type::Connected) { m_Peers[event.peer] = Peer{}; }
        else if (event.type == NetEvent::Type::Disconnected) {
            const auto it = m_Peers.find(event.peer);
            if (it != m_Peers.end()) {
                if (it->second.id != 0) { m_Notices.push_back((it->second.name.empty() ? std::string("Un jugador") : it->second.name) + " salió de la partida."); m_Smooth.erase(it->second.id); }
                m_Peers.erase(it);
            }
        } else HandleHostMessage(event);
    }
    m_SendAccumulator += dt;
    if (m_SendAccumulator >= kSendInterval) {
        m_SendAccumulator = std::fmod(m_SendAccumulator, kSendInterval);
        ++m_Tick;
        for (const auto& [peer, info] : m_Peers) {
            if (info.id == 0) continue;
            BitWriter writer;
            Write(writer, BuildSnapshotFor(info.id, glm::vec3(info.state.x, info.state.y, info.state.z)));
            m_Host->Send(peer, kChannelUnreliable, writer.Data(), false);
        }
    }
    m_WorldAccumulator += dt;
    if (m_WorldProvider && m_WorldAccumulator >= kWorldInterval) {
        m_WorldAccumulator = std::fmod(m_WorldAccumulator, kWorldInterval);
        for (const auto& [peer, info] : m_Peers) {
            if (info.id == 0) continue;
            BitWriter writer;
            Write(writer, m_WorldProvider(info.hasState ? glm::vec3(info.state.x, info.state.y, info.state.z) : local.position, m_Tick));
            m_LastWorldBytes = writer.Data().size();
            m_Host->Send(peer, kChannelUnreliable, writer.Data(), false);
        }
    }
}

Snapshot NetSession::BuildSnapshotFor(uint8_t viewerId, const glm::vec3& viewerPosition) const {
    Snapshot snapshot;
    snapshot.serverTick = m_Tick;
    struct Candidate { float distance; PlayerSnapshot state; };
    std::vector<Candidate> candidates;
    const auto consider = [&](const PlayerSnapshot& s) {
        const float distance = std::hypot(s.x - viewerPosition.x, s.z - viewerPosition.z);
        if (distance <= kInterestRadius) candidates.push_back({distance, s});
    };
    consider(Describe(m_LocalId, m_LastLocal));   // el anfitrion tambien juega
    for (const auto& [peer, info] : m_Peers)
        if (info.id != 0 && info.id != viewerId && info.hasState) consider(info.state);
    std::sort(candidates.begin(), candidates.end(), [](const Candidate& a, const Candidate& b) { return a.distance < b.distance; });
    if (candidates.size() > kMaxSnapshotEntries) candidates.resize(kMaxSnapshotEntries);
    for (const Candidate& c : candidates) snapshot.players.push_back(c.state);
    return snapshot;
}

void NetSession::HandleHostMessage(const NetEvent& event) {
    const auto peerIt = m_Peers.find(event.peer);
    if (peerIt == m_Peers.end()) return;
    Peer& peer = peerIt->second;
    BitReader reader(event.data);
    const auto type = ReadType(reader);
    if (!type) return;
    if (*type == MessageType::Hello) {
        const auto hello = ReadHello(reader);
        if (!hello || peer.id != 0) return;
        BitWriter answer;
        if (hello->protocol != kProtocolVersion) Write(answer, Reject{RejectReason::WrongProtocol});
        else if (hello->name.empty()) Write(answer, Reject{RejectReason::BadName});
        else if (std::count_if(m_Peers.begin(), m_Peers.end(), [](const auto& entry) { return entry.second.id != 0; }) >= static_cast<long>(m_MaxPlayers) - 1 || FreeId() == 0)
            Write(answer, Reject{RejectReason::ServerFull});   // se cuentan los que YA estan dentro (el anfitrion es uno), no los que aun no saludaron
        else {
            peer.id = FreeId();
            peer.name = hello->name;
            Welcome welcome; welcome.playerId = peer.id; welcome.serverTick = m_Tick; welcome.worldSeed = 0;
            Write(answer, welcome);
            m_Host->Send(event.peer, kChannelReliable, answer.Data(), true);
            m_Notices.push_back(peer.name + " se unió a la partida.");
            return;
        }
        m_Host->Send(event.peer, kChannelReliable, answer.Data(), true);
        m_Host->Disconnect(event.peer);
    } else if (*type == MessageType::State) {
        if (peer.id == 0) return;   // primero hay que saludar
        const auto report = ReadState(reader);
        if (!report || !InMap(report->player)) return;   // fuera del mapa o no finito: se ignora
        peer.state = report->player;
        peer.state.id = peer.id;
        peer.hasState = true;
        peer.lastMs = NowMs();
        Smooth& smooth = m_Smooth[peer.id];
        smooth.shown.id = peer.id; smooth.shown.name = peer.name;
        smooth.target = peer.state; smooth.lastHeardMs = peer.lastMs;
    } else if (*type == MessageType::Bye) {
        m_Host->Disconnect(event.peer);
    }
}

void NetSession::UpdateClient(float dt, const LocalState& local) {
    NetEvent event;
    while (m_Host->Poll(event)) {
        if (event.type == NetEvent::Type::Connected) {
            m_Server = event.peer;
            BitWriter writer;
            Hello hello; hello.name = m_Name;
            Write(writer, hello);
            m_Host->Send(m_Server, kChannelReliable, writer.Data(), true);
        } else if (event.type == NetEvent::Type::Disconnected) {
            if (m_Connected) m_Notices.push_back("Se perdió la conexión con el anfitrión.");
            m_Connected = false; m_Smooth.clear();
        } else HandleClientMessage(event);
    }
    if (!m_Connected) return;
    m_SendAccumulator += dt;
    if (m_SendAccumulator >= kSendInterval) {
        m_SendAccumulator = std::fmod(m_SendAccumulator, kSendInterval);
        BitWriter writer;
        StateReport report; report.player = Describe(m_LocalId, local);
        Write(writer, report);
        m_Host->Send(m_Server, kChannelUnreliable, writer.Data(), false);
    }
}

void NetSession::HandleClientMessage(const NetEvent& event) {
    BitReader reader(event.data);
    const auto type = ReadType(reader);
    if (!type) return;
    if (*type == MessageType::Welcome) {
        if (const auto welcome = ReadWelcome(reader)) {
            m_LocalId = welcome.value().playerId; m_Connected = true;
            m_Notices.push_back("Conectado a la partida como jugador " + std::to_string(m_LocalId) + ".");
        }
    } else if (*type == MessageType::Reject) {
        m_Rejected = true;
        const auto reject = ReadReject(reader);
        m_Notices.push_back(reject && reject->reason == RejectReason::ServerFull ? "La partida está llena." : "El anfitrión rechazó la conexión.");
    } else if (*type == MessageType::World) {
        if (auto world = ReadWorld(reader)) { m_LastWorldBytes = event.data.size(); m_PendingWorld = std::move(*world); }
    } else if (*type == MessageType::Snapshot) {
        const auto snapshot = ReadSnapshot(reader);
        if (!snapshot) return;
        const double now = NowMs();
        for (const PlayerSnapshot& entry : snapshot->players) {
            if (entry.id == m_LocalId || !InMap(entry)) continue;
            Smooth& smooth = m_Smooth[entry.id];
            smooth.shown.id = entry.id;
            if (smooth.shown.name.empty()) smooth.shown.name = "Jugador " + std::to_string(entry.id);
            smooth.target = entry; smooth.lastHeardMs = now;
        }
    }
}

void NetSession::SmoothRemote(float dt) {
    const double now = NowMs();
    for (auto it = m_Smooth.begin(); it != m_Smooth.end();) {
        if (now - it->second.lastHeardMs > kForgetMs) it = m_Smooth.erase(it); else ++it;
    }
    m_Remotes.clear();
    const float k = 1.0f - std::exp(-12.0f * std::max(0.0f, dt));   // se acerca al ultimo estado conocido sin saltos
    for (auto& [id, smooth] : m_Smooth) {
        const glm::vec3 target(smooth.target.x, smooth.target.y, smooth.target.z);
        if (smooth.fresh) { smooth.shown.position = target; smooth.shown.yaw = smooth.target.yaw; smooth.fresh = false; }
        else {
            smooth.shown.position += (target - smooth.shown.position) * k;
            float delta = smooth.target.yaw - smooth.shown.yaw;
            delta = std::remainder(delta, 6.2831853f);
            smooth.shown.yaw += delta * k;
        }
        smooth.shown.speed = smooth.target.speed;
        smooth.shown.knockedDown = (smooth.target.flags & 2) != 0;
        m_Remotes.push_back(smooth.shown);
    }
}

std::vector<std::string> NetSession::ConsumeNotices() {
    std::vector<std::string> out;
    out.swap(m_Notices);
    return out;
}

} // namespace Bazuko::Net
