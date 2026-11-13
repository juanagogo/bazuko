#include "NetSession.hpp"

#include <algorithm>
#include <cctype>
#include <cmath>

namespace Bazuko::Net {

namespace {
constexpr double kSendInterval = 1.0 / 20.0;     // estado propio e instantaneas a 20 Hz
constexpr double kForgetMs = 3000.0;             // un remoto que no da noticias en 3 s ya no esta
constexpr float kInterestRadius = 160.0f;
constexpr double kWorldInterval = 1.0 / 10.0;    // el mundo (trafico, peatones) a 10 Hz; el invitado extrapola entre una y otra
constexpr double kProbeEveryMs = 3000.0;         // sondeo de alcance (modo directo) cada 3 s
constexpr double kProbeFreshMs = 9000.0;         // una respuesta vale 9 s: tres sondeos
constexpr double kProbeGraceMs = 10000.0;        // tiempo que se le da a un recien llegado antes de juzgar si es alcanzable

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
    p.animation = local.animation;
    return p;
}
}

std::unique_ptr<NetSession> NetSession::StartHost(uint16_t port, const std::string& name, size_t maxPlayers) {
    std::unique_ptr<NetSession> session(new NetSession());
    session->m_Role = Role::Host;
    session->m_Name = CleanPlayerName(name);
    session->m_MaxPlayers = std::clamp<size_t>(maxPlayers, 2, kMaxPlayers);
    session->m_Host = Host::CreateServer(port, session->m_MaxPlayers + 8);
    if (!session->m_Host) return nullptr;
    session->m_LocalId = 1;
    return session;
}

std::unique_ptr<NetSession> NetSession::StartHostViaRelay(const std::string& relayAddress, uint16_t relayPort, const std::string& name, size_t maxPlayers,
                                                          const std::string& wantedCode) {
    std::unique_ptr<NetSession> session(new NetSession());
    session->m_Role = Role::Host;
    session->m_Name = CleanPlayerName(name);
    session->m_MaxPlayers = std::clamp<size_t>(maxPlayers, 2, kMaxPlayers);
    session->m_RelayAddress = relayAddress; session->m_RelayPort = relayPort;
    session->m_Host = Host::CreateRelayHost(relayAddress, relayPort, {}, {}, wantedCode);
    if (!session->m_Host) return nullptr;
    session->m_LocalId = 1;
    return session;
}

void NetSession::SetRoomInfo(const std::string& name, bool listed) {
    m_RoomName = name; m_RoomListed = listed; m_HasRoomInfo = true;
    if (m_Host && m_Host->IsRelay() && m_Role == Role::Host) m_Host->SetRoomInfo(name, listed, static_cast<uint8_t>(std::min<size_t>(m_MaxPlayers, 255)));
}

std::unique_ptr<NetSession> NetSession::JoinViaRelay(const std::string& relayAddress, uint16_t relayPort, const std::string& roomCode, const std::string& name, const std::string& key) {
    std::unique_ptr<NetSession> session(new NetSession());
    session->m_Role = Role::Client;
    session->m_Name = CleanPlayerName(name); session->m_Key = key;
    session->m_RelayAddress = relayAddress; session->m_RelayPort = relayPort; session->m_RosterRoom = roomCode;
    session->m_Host = Host::CreateRelayGuest(relayAddress, relayPort, roomCode);
    if (!session->m_Host) return nullptr;
    return session;
}

std::unique_ptr<NetSession> NetSession::Join(const std::string& address, uint16_t port, const std::string& name, const std::string& key) {
    std::unique_ptr<NetSession> session(new NetSession());
    session->m_Role = Role::Client;
    session->m_Name = CleanPlayerName(name);
    session->m_Key = key;
    session->m_JoinAddress = address;
    session->m_JoinPort = port;
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
    ProbeTick();
    SmoothRemote(dt);
}

void NetSession::UpdateHost(float dt, const LocalState& local) {
    NetEvent event;
    while (m_Host->Poll(event)) {
        if (event.type == NetEvent::Type::Connected) { m_Peers[event.peer] = Peer{}; m_Peers[event.peer].joinedMs = NowMs(); }
        else if (event.type == NetEvent::Type::Disconnected) {
            const auto it = m_Peers.find(event.peer);
            if (it != m_Peers.end()) {
                SavePeer(it->second);
                if (it->second.id != 0) { m_Looks.erase(it->second.id); m_Names.erase(it->second.id); m_RosterDirty = true; m_CheckpointDirty = true; m_Notices.push_back((it->second.name.empty() ? std::string("Un jugador") : it->second.name) + " salió de la partida."); m_Smooth.erase(it->second.id); }
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
    if (m_HandingOver) {
        bool anyJoined = false;
        for (const auto& [peer, info] : m_Peers) anyJoined = anyJoined || info.id != 0;
        if (!anyJoined || NowMs() > m_HandoverDeadlineMs) FinishHandover();
        return;
    }
    m_RosterAccumulator += dt; m_CheckpointAccumulator += dt; m_SuccessionAccumulator += dt;
    if (m_SuccessionAccumulator >= 2.0) {   // si cambia quien sucede, la lista y la economia le llegan ya
        m_SuccessionAccumulator = 0.0;
        const uint8_t before = m_SuccessorId;
        const std::vector<uint8_t> order = Succession();
        if (!order.empty() && order.front() != before) { m_RosterDirty = true; m_CheckpointDirty = true; }
    }
    if (m_RosterDirty || m_RosterAccumulator >= 5.0) { m_RosterDirty = false; m_RosterAccumulator = 0.0; SendRoster(); }
    if ((m_CheckpointDirty && m_CheckpointAccumulator >= 1.0) || m_CheckpointAccumulator >= 3.0) { m_CheckpointDirty = false; m_CheckpointAccumulator = 0.0; SendCheckpoint(); }
    m_SaveAccumulator += dt;
    if (m_SaveAccumulator >= 30.0) { m_SaveAccumulator = 0.0; SaveProfiles(); }
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
    if (m_HandingOver) return;
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
        else if (hello->name.empty() || (!hello->key.empty() && !IsValidPlayerKey(hello->key))) Write(answer, Reject{RejectReason::BadName});
        else if (!hello->key.empty() && std::any_of(m_Peers.begin(), m_Peers.end(), [&](const auto& entry) { return entry.second.id != 0 && entry.second.key == hello->key; })) Write(answer, Reject{RejectReason::KeyInUse});
        else if (std::count_if(m_Peers.begin(), m_Peers.end(), [](const auto& entry) { return entry.second.id != 0; }) >= static_cast<long>(m_MaxPlayers) - 1 || FreeId() == 0)
            Write(answer, Reject{RejectReason::ServerFull});   // se cuentan los que YA estan dentro (el anfitrion es uno), no los que aun no saludaron
        else {
            peer.id = FreeId();
            {   // nombre limpio y distinto del de los que ya estan: al repetido se le pone un numero ("Jairo 2")
                const auto same = [](const std::string& x, const std::string& y) { return x.size() == y.size() && std::equal(x.begin(), x.end(), y.begin(), [](char l, char r) { return std::tolower(static_cast<unsigned char>(l)) == std::tolower(static_cast<unsigned char>(r)); }); };
                const auto taken = [&](const std::string& candidate) {
                    if (same(candidate, m_Name)) return true;
                    return std::any_of(m_Peers.begin(), m_Peers.end(), [&](const auto& entry) { return entry.first != event.peer && entry.second.id != 0 && same(entry.second.name, candidate); });
                };
                std::string base = CleanPlayerName(hello->name), name = base;
                for (int n = 2; taken(name) && n < 200; ++n) {
                    const std::string suffix = " " + std::to_string(n);
                    while (!base.empty() && base.size() + suffix.size() > kMaxNameLength) { const bool continuation = (static_cast<unsigned char>(base.back()) & 0xC0) == 0x80; base.pop_back(); if (continuation && !base.empty()) base.pop_back(); }   // se recorta por letras enteras (las de tilde ocupan dos bytes)
                    while (!base.empty() && base.back() == ' ') base.pop_back();
                    name = base + suffix;
                }
                peer.name = name;
            }
            peer.key = hello->key;
            peer.look.assign(hello->look.begin(), hello->look.end());
            Welcome welcome; welcome.playerId = peer.id; welcome.serverTick = m_Tick; welcome.worldSeed = 0;
            Write(answer, welcome);
            m_Host->Send(event.peer, kChannelReliable, answer.Data(), true);
            m_Notices.push_back(peer.name + " se unió a la partida.");
            m_RosterDirty = true; m_CheckpointDirty = true;
            m_Looks[1] = m_OwnLook;
            if (!peer.look.empty()) m_Looks[peer.id] = peer.look;
            m_Names[1] = m_Name; m_Names[peer.id] = peer.name;
            SendLooksTo(event.peer);      // el recien llegado conoce a todos...
            BroadcastLook(peer.id);   // ...y todos conocen al recien llegado
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
        if (report->fps > 0) { peer.fps = report->fps; peer.rttMs = report->rttMs; peer.hasVitals = true; }
        if (report->extended) { peer.hasProbe = true; peer.probeBound = report->probeBound; peer.reached = report->reached; }
        peer.hasState = true;
        peer.lastMs = NowMs();
        Smooth& smooth = m_Smooth[peer.id];
        smooth.shown.id = peer.id; smooth.shown.name = peer.name;
        smooth.target = peer.state; smooth.lastHeardMs = peer.lastMs;
    } else if (*type == MessageType::Strike) {
        if (peer.id == 0 || !peer.hasState) return;
        const auto command = ReadStrike(reader);
        const double now = NowMs();
        if (!command || now - peer.lastStrikeMs < kMinStrikeIntervalMs) return;   // mas rapido de lo posible: se ignora
        peer.lastStrikeMs = now;
        ResolveStrike(peer.id, glm::vec3(peer.state.x, peer.state.y, peer.state.z), *command);
    } else if (*type == MessageType::Economy) {
        if (peer.id == 0 || !m_EconomyData) return;
        const auto report = ReadEconomyReport(reader);
        if (!report) return;
        if (!peer.ledger) StartLedger(peer);
        if (peer.ledger->FromProfile() && !peer.profileSynced) {   // el perfil guardado en este anfitrion manda sobre lo que el invitado traiga
            peer.profileSynced = true;
            BitWriter answer;
            Write(answer, EconomySync{report->seq, false, peer.ledger->State(), true});
            m_Host->Send(event.peer, kChannelReliable, answer.Data(), true);
            return;
        }
        peer.profileSynced = true;
        const Ledger::Verdict verdict = peer.ledger->Submit(report->state, NowMs() / 1000.0);
        m_CheckpointDirty = true;
        if (!verdict.accepted) {   // se queda la copia del anfitrion y se le devuelve al invitado, que la adopta
            ++m_EconomyRejections;
            const double now = NowMs();
            if (now - peer.lastRejectNoticeMs > 5000.0) { peer.lastRejectNoticeMs = now; m_Notices.push_back("Se revirtió un cambio de costal o plata de " + peer.name + " (" + verdict.reason + ")."); }
            BitWriter answer;
            Write(answer, EconomySync{report->seq, false, verdict.authoritative});
            m_Host->Send(event.peer, kChannelReliable, answer.Data(), true);
        }
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
            Hello hello; hello.name = m_Name; hello.key = m_Key; hello.look.assign(m_OwnLook.begin(), m_OwnLook.end());
            Write(writer, hello);
            m_Host->Send(m_Server, kChannelReliable, writer.Data(), true);
        } else if (event.type == NetEvent::Type::Disconnected) {
            if (m_Migrating && m_MigAttempt) m_MigFailed = true;
            const bool wasConnected = m_Connected;
            m_Connected = false; m_Smooth.clear(); m_Looks.clear(); m_Names.clear();
            if (wasConnected && !m_Rejected && !m_Roster.empty() && !m_Migrating) BeginMigration();
            else if (wasConnected && !m_Migrating) m_Notices.push_back("Se perdió la conexión con el anfitrión.");
        } else HandleClientMessage(event);
    }
    if (m_Migrating) { MigrationTick(); return; }
    if (!m_Connected) return;
    m_SendAccumulator += dt;
    if (m_SendAccumulator >= kSendInterval) {
        m_SendAccumulator = std::fmod(m_SendAccumulator, kSendInterval);
        BitWriter writer;
        StateReport report; report.player = Describe(m_LocalId, local);
        report.fps = static_cast<uint8_t>(std::clamp(std::lround(local.fps), 0l, 255l));
        report.rttMs = static_cast<uint16_t>(std::min<uint32_t>(m_Host->RoundTripMs(m_Server), 65535u));
        report.probeBound = m_Probe && !m_ProbeIsHost;
        const double now = NowMs();
        for (const auto& [id, at] : m_ReachedAt) if (id != m_LocalId && now - at < kProbeFreshMs && report.reached.size() < kMaxReached) report.reached.push_back(id);
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
            ++m_Epoch;
            if (m_Migrating) { m_Migrating = false; m_Notices.push_back("Reconectado con el nuevo anfitrión."); }
            else m_Notices.push_back("Conectado a la partida como jugador " + std::to_string(m_LocalId) + ".");
        }
    } else if (*type == MessageType::Reject) {
        m_Rejected = true;
        const auto reject = ReadReject(reader);
        m_Notices.push_back(reject && reject->reason == RejectReason::ServerFull ? "La partida está llena." : reject && reject->reason == RejectReason::KeyInUse ? "Ese perfil ya está conectado en esta partida." : "El anfitrión rechazó la conexión.");
    } else if (*type == MessageType::Appearance) {
        if (const auto appearance = ReadAppearance(reader)) {
            if (!appearance->look.empty()) m_Looks[appearance->player] = appearance->look;
            if (!appearance->name.empty()) m_Names[appearance->player] = CleanPlayerName(appearance->name);
        }
    } else if (*type == MessageType::Roster) {
        if (auto roster = ReadRoster(reader)) { m_Roster = std::move(roster->entries); m_RosterPort = roster->port; if (!roster->room.empty()) { m_RosterRoom = roster->room; m_RelayAddress = roster->relayAddress; m_RelayPort = roster->relayPort; } }
    } else if (*type == MessageType::Checkpoint) {
        if (auto checkpoint = ReadCheckpoint(reader)) { m_Checkpoint = std::move(checkpoint->entries); m_RoomSecret = checkpoint->roomSecret; }
    } else if (*type == MessageType::EconomySync) {
        if (const auto sync = ReadEconomySync(reader)) m_PendingEconomy = std::move(*sync);
    } else if (*type == MessageType::Hit) {
        if (const auto hit = ReadHit(reader)) m_Hits.push_back({hit->kind, glm::vec3(hit->fromX, 0.0f, hit->fromZ)});
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
        smooth.shown.animation = smooth.target.animation;
        const auto look = m_Looks.find(id);
        smooth.shown.look = look == m_Looks.end() ? std::string() : look->second;
        if (const auto name = m_Names.find(id); name != m_Names.end() && !name->second.empty()) smooth.shown.name = name->second;
        m_Remotes.push_back(smooth.shown);
    }
}

void NetSession::Strike(const StrikeCommand& command) {
    if (m_Role == Role::Host) {
        const double now = NowMs();
        if (now - m_LocalLastStrikeMs < kMinStrikeIntervalMs) return;
        m_LocalLastStrikeMs = now;
        ResolveStrike(m_LocalId, m_LastLocal.position, command);
    } else if (m_Connected) {
        BitWriter writer;
        Write(writer, command);
        m_Host->Send(m_Server, kChannelReliable, writer.Data(), true);
    }
}

void NetSession::SendEconomy(const EconomyReport& report) {
    if (m_Role != Role::Client || !m_Connected) return;
    BitWriter writer;
    Write(writer, report);
    m_Host->Send(m_Server, kChannelReliable, writer.Data(), true);
}

void NetSession::BroadcastLook(uint8_t id) {
    const auto look = m_Looks.find(id);
    const auto name = m_Names.find(id);
    const std::string lookBytes = look == m_Looks.end() ? std::string() : look->second, nameText = name == m_Names.end() ? std::string() : name->second;
    if (lookBytes.empty() && nameText.empty()) return;
    BitWriter writer; Write(writer, AppearanceMessage{id, lookBytes, nameText});
    for (const auto& [peer, info] : m_Peers) if (info.id != 0 && info.id != id) m_Host->Send(peer, kChannelReliable, writer.Data(), true);
}

void NetSession::SendLooksTo(uint32_t peer) {
    std::map<uint8_t, bool> ids;
    for (const auto& [id, look] : m_Looks) if (!look.empty()) ids[id] = true;
    for (const auto& [id, name] : m_Names) if (!name.empty()) ids[id] = true;
    for (const auto& [id, unused] : ids) {
        const auto target = m_Peers.find(peer);
        if (target != m_Peers.end() && target->second.id == id) continue;
        const auto look = m_Looks.find(id);
        const auto name = m_Names.find(id);
        BitWriter writer; Write(writer, AppearanceMessage{id, look == m_Looks.end() ? std::string() : look->second, name == m_Names.end() ? std::string() : name->second});
        m_Host->Send(peer, kChannelReliable, writer.Data(), true);
    }
}

namespace {
// Puntaje de un invitado para suceder al anfitrion: cuadros por segundo (hasta 60) menos la latencia (100 ms cuestan 10 puntos).
// Un equipo que no llega a 20 cuadros o una conexion de mas de 300 ms solo sucede si no hay nadie mejor.
float SuccessionScore(uint8_t fps, uint16_t rttMs, bool hasVitals) {
    if (!hasVitals) return -1000.0f;
    float score = std::min<float>(fps, 60.0f) - std::min<float>(rttMs, 1000.0f) * 0.1f;
    if (fps < 20 || rttMs > 300) score -= 100.0f;
    return score;
}
constexpr float kSuccessionMargin = 8.0f;   // cuanto tiene que superar otro al sucesor actual para reemplazarlo
constexpr float kUnreachablePenalty = 5000.0f;
}

uint16_t NetSession::ProbePort() const {
    if (m_ProbePortOverride != 0) return m_ProbePortOverride;
    return m_Role == Role::Host ? (m_Host ? m_Host->Port() : 0) : m_RosterPort;
}

// Sondeo de alcance (modo directo): «BZP?» + id de quien pregunta; «BZP!» + id de quien contesta, de vuelta a quien pregunto
void NetSession::ProbeTick() {
    const double now = NowMs();
    const bool direct = m_Host && !m_Host->IsRelay() && (m_Role == Role::Host || m_RosterRoom.empty());
    const bool wanted = direct && !m_Migrating && !m_HandingOver && ProbePort() != 0 && (m_Role == Role::Host || m_Connected);
    if (!wanted) { m_Probe.reset(); return; }
    const bool asHost = m_Role == Role::Host;
    if (m_Probe && m_ProbeIsHost != asHost) m_Probe.reset();   // cambio de papel: el puerto de la partida queda libre para quien lo necesite
    if (!m_Probe && now >= m_ProbeRetryMs) {
        m_Probe = ProbeSocket::Open(asHost ? 0 : ProbePort());   // el invitado abre el puerto de la partida: si esta ocupado, aqui no se podria abrir la partida
        m_ProbeIsHost = asHost;
        if (!m_Probe) m_ProbeRetryMs = now + 5000.0;
    }
    if (!m_Probe) return;
    std::vector<uint8_t> data; std::string ip; uint16_t port = 0;
    while (m_Probe->Receive(data, ip, port)) {
        if (data.size() != 5 || data[0] != 'B' || data[1] != 'Z' || data[2] != 'P') continue;
        if (data[3] == '?' && !asHost) m_Probe->SendTo(ip, port, {'B', 'Z', 'P', '!', m_LocalId});
        else if (data[3] == '!' && data[4] != 0) {
            if (!asHost) { if (data[4] != m_LocalId) m_ReachedAt[data[4]] = now; }
            else for (auto& [peer, info] : m_Peers) if (info.id == data[4]) info.hostReachedMs = now;
        }
    }
    if (now - m_ProbeAskMs < kProbeEveryMs) return;
    m_ProbeAskMs = now;
    const std::vector<uint8_t> ask{'B', 'Z', 'P', '?', m_LocalId};
    if (!asHost) { for (const RosterEntry& entry : m_Roster) if (entry.id != m_LocalId && !entry.ip.empty()) m_Probe->SendTo(entry.ip, ProbePort(), ask); }
    else for (const auto& [peer, info] : m_Peers) if (info.id != 0) m_Probe->SendTo(m_Host->PeerAddress(peer), ProbePort(), ask);
}

// Un candidato es inalcanzable si ya tuvo tiempo de sondear y no pudo abrir el puerto, no le llega al anfitrion o algun otro invitado no le llega.
// Quien no manda el sondeo (una copia anterior del juego) no se juzga.
bool NetSession::Unreachable(const Peer& candidate, double now) const {
    if (!m_Host || m_Host->IsRelay() || !candidate.hasProbe || now - candidate.joinedMs < kProbeGraceMs) return false;
    if (!candidate.probeBound || now - candidate.hostReachedMs > kProbeFreshMs) return true;
    for (const auto& [peer, other] : m_Peers) {
        if (other.id == 0 || other.id == candidate.id || !other.hasProbe || !other.probeBound || now - other.joinedMs < kProbeGraceMs) continue;
        if (std::find(other.reached.begin(), other.reached.end(), candidate.id) == other.reached.end()) return true;
    }
    return false;
}

std::vector<uint8_t> NetSession::Succession() {
    struct Candidate { uint8_t id; float score; };
    std::vector<Candidate> candidates;
    const double now = NowMs();
    for (const auto& [peer, info] : m_Peers)
        if (info.id != 0) candidates.push_back({info.id, SuccessionScore(info.fps, info.rttMs, info.hasVitals) - (Unreachable(info, now) ? kUnreachablePenalty : 0.0f)});
    std::sort(candidates.begin(), candidates.end(), [](const Candidate& a, const Candidate& b) { return a.score != b.score ? a.score > b.score : a.id < b.id; });
    if (!candidates.empty() && candidates.front().id != m_SuccessorId) {
        const auto current = std::find_if(candidates.begin(), candidates.end(), [this](const Candidate& c) { return c.id == m_SuccessorId; });
        if (current != candidates.end() && current->score + kSuccessionMargin >= candidates.front().score) std::rotate(candidates.begin(), current, current + 1);
    }
    m_SuccessorId = candidates.empty() ? 0 : candidates.front().id;
    std::vector<uint8_t> order;
    for (const Candidate& c : candidates) order.push_back(c.id);
    return order;
}

std::string NetSession::SuccessorName() {
    if (m_Role != Role::Host) return {};
    const std::vector<uint8_t> order = Succession();
    if (order.empty()) return {};
    for (const auto& [peer, info] : m_Peers) if (info.id == order.front()) return info.name.empty() ? std::string("otro jugador") : info.name;
    return {};
}

void NetSession::SendRoster() {
    Roster roster; roster.port = m_Host->Port();
    if (m_Host->IsRelay()) {
        if (m_Host->RoomCode().empty()) { m_RosterDirty = true; return; }   // la sala aun no existe
        roster.relayAddress = m_RelayAddress; roster.relayPort = m_RelayPort; roster.room = m_Host->RoomCode();
    }
    for (uint8_t id : Succession())
        for (const auto& [peer, info] : m_Peers) if (info.id == id) roster.entries.push_back({info.id, m_Host->PeerAddress(peer)});
    BitWriter writer; Write(writer, roster);
    for (const auto& [peer, info] : m_Peers) if (info.id != 0) m_Host->Send(peer, kChannelReliable, writer.Data(), true);
}

// La economia de todos, solo para el siguiente anfitrion (el primero del orden de sucesion): si el anfitrion se va, no empieza de cero
void NetSession::SendCheckpoint() {
    uint32_t successor = 0;
    const std::vector<uint8_t> order = Succession();
    const uint8_t successorId = order.empty() ? 0 : order.front();
    Checkpoint checkpoint;
    if (m_Host->IsRelay()) checkpoint.roomSecret = m_Host->RoomSecret();
    if (m_HasHostEconomy && !m_Key.empty()) checkpoint.entries.push_back({m_Key, m_HostEconomy});   // el anfitrion tambien tiene perfil: no se pierde si se va o cae
    for (const auto& [peer, info] : m_Peers) {
        if (info.id == 0) continue;
        if (info.id == successorId) successor = peer;
        if (info.ledger && info.ledger->Started() && !info.key.empty()) checkpoint.entries.push_back({info.key, info.ledger->State()});
    }
    if (successor == 0) return;
    BitWriter writer; Write(writer, checkpoint);
    m_Host->Send(successor, kChannelReliable, writer.Data(), true);
}

bool NetSession::HandOver(bool rejoin) {
    if (m_Role != Role::Host || m_HandingOver) return false;
    bool anyJoined = false;
    for (const auto& [peer, info] : m_Peers) anyJoined = anyJoined || info.id != 0;
    if (!anyJoined) { m_HandoverDone = true; return false; }
    SendRoster();
    SendCheckpoint();
    // se recuerda a quien reentrar: la lista actual (por id) y como llegar al nuevo anfitrion
    m_Roster.clear();
    for (uint8_t id : Succession())
        for (const auto& [peer, info] : m_Peers) if (info.id == id) m_Roster.push_back({info.id, m_Host->PeerAddress(peer)});
    m_RosterPort = m_Host->Port();
    if (m_Host->IsRelay()) m_RosterRoom = m_Host->RoomCode(); else m_RosterRoom.clear();
    for (const auto& [peer, info] : m_Peers) m_Host->Disconnect(peer);   // cierra despues de que salgan los mensajes fiables pendientes (la lista y el punto de control)
    m_HandingOver = true; m_HandoverRejoin = rejoin;
    m_HandoverDeadlineMs = NowMs() + 1500.0;
    return true;
}

void NetSession::FinishHandover() {
    m_HandingOver = false;
    m_Peers.clear(); m_Smooth.clear(); m_Remotes.clear();
    if (!m_HandoverRejoin) { m_HandoverDone = true; return; }
    const bool relay = !m_RosterRoom.empty();
    m_Role = Role::Client; m_Connected = false; m_Rejected = false; m_LocalId = 0;
    m_Host = relay ? Host::CreateRelayGuest(m_RelayAddress, m_RelayPort, m_RosterRoom) : Host::CreateClient();
    if (!m_Host || m_Roster.empty() || (!relay && !m_Host->Connect(m_Roster.front().ip, m_RosterPort))) { m_HandoverDone = true; m_Notices.push_back("No se pudo volver a entrar a la partida."); return; }
    m_Migrating = true; m_MigAttempt = true; m_MigFailed = false; m_MigIndex = 0; m_MigDeadlineMs = NowMs() + 12000.0; m_MigRetryAtMs = 0.0; m_OldId = 0;
    m_Notices.push_back("Pasaste la partida a otro jugador y vuelves a entrar como invitado.");
    m_HandoverDone = true;
}

void NetSession::BeginMigration() {
    m_Migrating = true; m_MigAttempt = false; m_MigFailed = false; m_MigIndex = 0; m_MigDeadlineMs = 0.0; m_MigRetryAtMs = 0.0; m_OldId = m_LocalId;
    m_Notices.push_back("El anfitrión se fue: buscando al nuevo anfitrión...");
}

void NetSession::MigrationTick() {
    const double now = NowMs();
    if (m_MigIndex >= m_Roster.size()) { m_Migrating = false; m_Notices.push_back("No se pudo reconectar: nadie abrió la partida."); return; }
    const RosterEntry& candidate = m_Roster[m_MigIndex];
    if (candidate.id == m_OldId) {   // me toca a mi: los de antes en la lista no respondieron
        if (now < m_MigRetryAtMs) return;
        if (!PromoteToHost()) {   // el puerto puede seguir ocupado por el anfitrion que se va (traspaso voluntario): se reintenta unos segundos
            if (++m_PromoteTries > 40) { m_Migrating = false; m_Notices.push_back("No se pudo abrir la partida como nuevo anfitrión."); }
            else m_MigRetryAtMs = now + 250.0;
        }
        return;
    }
    if (m_MigDeadlineMs == 0.0) m_MigDeadlineMs = now + 8000.0;
    if (!m_MigAttempt) {
        if (now < m_MigRetryAtMs) return;
        const bool relay = !m_RosterRoom.empty();   // por relevo: se reentra a la misma sala; la sala la retoma quien le toque
        m_Host = relay ? Host::CreateRelayGuest(m_RelayAddress, m_RelayPort, m_RosterRoom) : Host::CreateClient();
        if (!m_Host || (!relay && !m_Host->Connect(candidate.ip, m_RosterPort))) { m_MigRetryAtMs = now + 800.0; return; }
        m_MigAttempt = true; m_MigFailed = false;
    } else if (!m_Connected && m_MigFailed) {   // todavia no abrieron la sala: se reintenta enseguida mientras dure el plazo
        m_MigAttempt = false; m_MigFailed = false; m_MigRetryAtMs = now + 800.0;
    }
    if (!m_Connected && now > m_MigDeadlineMs) { ++m_MigIndex; m_MigAttempt = false; m_MigFailed = false; m_MigDeadlineMs = 0.0; m_MigRetryAtMs = 0.0; }
}

bool NetSession::PromoteToHost() {
    m_Probe.reset();   // el socket de sondeo ocupa el puerto de la partida: se suelta antes de abrirla
    const bool relay = !m_RosterRoom.empty();
    std::unique_ptr<Host> fresh = relay ? Host::CreateRelayHost(m_RelayAddress, m_RelayPort, m_RosterRoom, m_RoomSecret) : Host::CreateServer(m_RosterPort, m_MaxPlayers + 8);
    if (!fresh) return false;   // la conexion anterior sigue siendo valida: nada se rompe
    if (relay && m_HasRoomInfo) fresh->SetRoomInfo(m_RoomName, m_RoomListed, static_cast<uint8_t>(std::min<size_t>(m_MaxPlayers, 255)));   // la sala sigue en la lista con su nombre
    m_Host = std::move(fresh);
    m_Migrating = false; m_PromoteTries = 0;
    m_Role = Role::Host; m_LocalId = 1; m_Connected = false; m_Rejected = false; m_SuccessorId = 0;
    m_Peers.clear(); m_Smooth.clear(); m_Remotes.clear(); m_Looks.clear(); m_Looks[1] = m_OwnLook; m_Names.clear(); m_Names[1] = m_Name;
    m_Seed.clear();
    for (const CheckpointEntry& entry : m_Checkpoint) m_Seed[entry.key] = entry.state;
    m_RosterDirty = true; m_CheckpointDirty = true;
    m_Promoted = true; ++m_Epoch;
    m_Notices.push_back("Ahora usted es el anfitrión de la partida.");
    return true;
}

void NetSession::SetProfileFolder(const std::filesystem::path& folder) {
    m_Profiles = std::make_unique<ProfileStore>(folder);
    for (const auto& [key, state] : m_Seed) {   // los perfiles del anfitrion anterior se vuelven tambien de este: la cadena de anfitriones no los pierde
        if (!IsValidPlayerKey(key)) continue;
        nlohmann::json save = m_Profiles->Load(key).value_or(nlohmann::json::object());
        ApplyEconomyToSave(save, state);
        m_Profiles->Save(key, save);
    }
}

NetSession::~NetSession() { if (m_Role == Role::Host) SaveProfiles(); }

// La copia de economia de este invitado: del perfil guardado (saneado) si existe; si no, nueva (con el limite de perfil nuevo)
void NetSession::StartLedger(Peer& peer) {
    peer.ledger = std::make_unique<Ledger>(*m_EconomyData);
    if (!peer.key.empty()) {
        const auto seed = m_Seed.find(peer.key);
        if (seed != m_Seed.end()) { peer.ledger->Seed(seed->second, NowMs() / 1000.0); return; }   // viene del anfitrion anterior
    }
    if (!m_Profiles || peer.key.empty()) return;
    if (auto save = m_Profiles->Load(peer.key)) {
        Sanitize(*save, *m_EconomyData);
        peer.ledger->Adopt(EconomyFromSave(*save, m_EconomyData->items.size()), NowMs() / 1000.0);
    }
}

void NetSession::SavePeer(const Peer& peer) {
    if (!m_Profiles || peer.key.empty() || !peer.ledger || !peer.ledger->Started()) return;
    nlohmann::json save = m_Profiles->Load(peer.key).value_or(nlohmann::json::object());
    ApplyEconomyToSave(save, peer.ledger->State());
    save["name"] = peer.name;
    m_Profiles->Save(peer.key, save);
}

void NetSession::SaveProfiles() { for (const auto& [connection, peer] : m_Peers) SavePeer(peer); }

const Ledger* NetSession::LedgerOf(uint8_t player) const {
    for (const auto& [peer, info] : m_Peers) if (info.id == player) return info.ledger.get();
    return nullptr;
}

void NetSession::SendHit(uint8_t player, int kind, const glm::vec3& from) {
    if (player == m_LocalId) { m_Hits.push_back({kind, from}); return; }
    for (const auto& [peer, info] : m_Peers) {
        if (info.id != player) continue;
        BitWriter writer;
        const float length = std::hypot(from.x, from.z);
        HitEvent hit; hit.kind = static_cast<uint8_t>(std::clamp(kind, 1, 3));
        if (length > 0.01f) { hit.fromX = from.x / length; hit.fromZ = from.z / length; }
        Write(writer, hit);
        m_Host->Send(peer, kChannelReliable, writer.Data(), true);
        return;
    }
}

// Anfitrion: el golpe de `attacker` desde `position` hacia `command.yaw`. Alcanza al jugador mas cercano delante (cono de ~57 grados) dentro del alcance; el alcance y
// el dano que pide el cliente se limitan. Ademas se avisa al juego (RemoteStrike) para que el golpe tambien llegue a peatones y vehiculos.
void NetSession::ResolveStrike(uint8_t attacker, const glm::vec3& position, const StrikeCommand& requested) {
    StrikeCommand command = requested;
    command.reach = std::clamp(command.reach, 0.5f, kMaxStrikeReach);
    command.knockback = std::clamp(command.knockback, 0.0f, kMaxStrikeKnockback);
    if (command.damage > kMaxStrikeDamage) command.damage = kMaxStrikeDamage;
    if (attacker != m_LocalId) m_RemoteStrikes.push_back({attacker, position, command});
    const glm::vec2 forward(std::sin(command.yaw), std::cos(command.yaw));
    struct Victim { uint8_t id; glm::vec3 position; float distance; };
    std::optional<Victim> best;
    const auto consider = [&](uint8_t id, const glm::vec3& at, bool down) {
        if (id == attacker || down) return;
        const glm::vec2 offset(at.x - position.x, at.z - position.z);
        const float distance = glm::length(offset);
        if (distance > command.reach + 0.4f || std::abs(at.y - position.y) > 2.0f) return;   // el margen cubre la demora de la red
        if (distance > 0.05f && glm::dot(offset / distance, forward) < 0.55f) return;
        if (!best || distance < best->distance) best = Victim{id, at, distance};
    };
    consider(m_LocalId, m_LastLocal.position, m_LastLocal.knockedDown);
    for (const auto& [peer, info] : m_Peers)
        if (info.id != 0 && info.hasState) consider(info.id, glm::vec3(info.state.x, info.state.y, info.state.z), (info.state.flags & 2) != 0);
    if (!best) return;
    glm::vec3 from(position.x - best->position.x, 0.0f, position.z - best->position.z);
    const float length = std::hypot(from.x, from.z);
    from = length > 0.01f ? from / length : glm::vec3(-forward.x, 0.0f, -forward.y);
    if (m_PlayerHits.size() < 256) m_PlayerHits.push_back({attacker, best->id});
    SendHit(best->id, command.kind, from);
}

std::vector<std::string> NetSession::ConsumeNotices() {
    std::vector<std::string> out;
    out.swap(m_Notices);
    return out;
}

} // namespace Bazuko::Net
