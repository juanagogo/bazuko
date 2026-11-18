#include "Transport.hpp"

#include "RelayProtocol.hpp"

#include <enet/enet.h>

#include <chrono>
#include <deque>
#include <map>
#include <random>
#include <set>

namespace Bazuko::Net {

namespace {
int g_EnetUsers = 0;
void EnetAcquire() { if (g_EnetUsers++ == 0) enet_initialize(); }
void EnetRelease() { if (--g_EnetUsers == 0) enet_deinitialize(); }
constexpr size_t kChannels = 2;
}

double NowMs() {
    using namespace std::chrono;
    return duration<double, std::milli>(steady_clock::now().time_since_epoch()).count();
}

struct Host::Impl {
    ENetHost* host = nullptr;
    std::map<uint32_t, ENetPeer*> peers;     // identificador -> conexion
    std::deque<NetEvent> pending;            // eventos ya leidos de ENet y aun no entregados
    NetSimConfig simConfig;
    std::unique_ptr<NetSim> unreliableSim, reliableSim;
    // modo relevo
    enum class Mode { Direct, RelayHost, RelayGuest } mode = Mode::Direct;
    ENetPeer* relayPeer = nullptr;
    std::string roomCode, roomSecret;
    bool roomFailed = false;
    std::set<uint32_t> guests;   // anfitrion por relevo: los invitados que el relevo anuncio

    static uint32_t IdOf(ENetPeer* peer) { return static_cast<uint32_t>(peer->incomingPeerID) + 1u; }   // 0 queda libre para "ninguno"

    void RelaySend(const std::vector<uint8_t>& frame, bool reliable) {
        if (!relayPeer) return;
        ENetPacket* packet = enet_packet_create(frame.data(), frame.size(), reliable ? ENET_PACKET_FLAG_RELIABLE : 0u);
        if (enet_peer_send(relayPeer, reliable ? 0 : 1, packet) < 0) enet_packet_destroy(packet);
    }
    void RawSend(uint32_t id, int channel, const std::vector<uint8_t>& data, bool reliable) {
        if (mode == Mode::RelayHost) {
            std::vector<uint8_t> frame{Relay::kHostSend, static_cast<uint8_t>(id), static_cast<uint8_t>(id >> 8), static_cast<uint8_t>(id >> 16), static_cast<uint8_t>(id >> 24), static_cast<uint8_t>(channel), static_cast<uint8_t>(reliable ? 1 : 0)};
            frame.insert(frame.end(), data.begin(), data.end());
            if (frame.size() <= Relay::kMaxPacket && guests.count(id)) RelaySend(frame, reliable);
            return;
        }
        if (mode == Mode::RelayGuest) {
            std::vector<uint8_t> frame{Relay::kGuestSend, static_cast<uint8_t>(channel), static_cast<uint8_t>(reliable ? 1 : 0)};
            frame.insert(frame.end(), data.begin(), data.end());
            if (frame.size() <= Relay::kMaxPacket) RelaySend(frame, reliable);
            return;
        }
        const auto it = peers.find(id);
        if (it == peers.end() || data.empty()) return;
        ENetPacket* packet = enet_packet_create(data.data(), data.size(), reliable ? ENET_PACKET_FLAG_RELIABLE : 0u);
        if (enet_peer_send(it->second, static_cast<enet_uint8>(channel), packet) < 0) enet_packet_destroy(packet);
    }
    static std::vector<uint8_t> Wrap(uint32_t id, int channel, const std::vector<uint8_t>& data) {
        std::vector<uint8_t> out{static_cast<uint8_t>(id), static_cast<uint8_t>(id >> 8), static_cast<uint8_t>(id >> 16), static_cast<uint8_t>(id >> 24), static_cast<uint8_t>(channel)};
        out.insert(out.end(), data.begin(), data.end());
        return out;
    }
    void Flush(NetSim* sim, bool reliable, double now) {
        if (!sim) return;
        for (auto& wrapped : sim->Receive(now)) {
            if (wrapped.size() <= 5) continue;
            const uint32_t id = wrapped[0] | (wrapped[1] << 8) | (wrapped[2] << 16) | (static_cast<uint32_t>(wrapped[3]) << 24);
            RawSend(id, wrapped[4], std::vector<uint8_t>(wrapped.begin() + 5, wrapped.end()), reliable);
        }
    }
};

Host::Host() : m_Impl(std::make_unique<Impl>()) { EnetAcquire(); }

Host::~Host() {
    if (m_Impl->host) {
        if (m_Impl->relayPeer) enet_peer_disconnect_now(m_Impl->relayPeer, 0);
        for (auto& [id, peer] : m_Impl->peers) enet_peer_disconnect_now(peer, 0);
        enet_host_flush(m_Impl->host);
        enet_host_destroy(m_Impl->host);
    }
    EnetRelease();
}

std::unique_ptr<Host> Host::CreateServer(uint16_t port, size_t maxClients) {
    std::unique_ptr<Host> host(new Host());
    ENetAddress address;
    address.host = ENET_HOST_ANY;
    address.port = port;
    host->m_Impl->host = enet_host_create(&address, maxClients, kChannels, 0, 0);
    return host->m_Impl->host ? std::move(host) : nullptr;
}

std::unique_ptr<Host> Host::CreateClient() {
    std::unique_ptr<Host> host(new Host());
    host->m_Impl->host = enet_host_create(nullptr, 1, kChannels, 0, 0);
    return host->m_Impl->host ? std::move(host) : nullptr;
}

uint16_t Host::Port() const { return m_Impl->host && m_Impl->mode == Impl::Mode::Direct ? m_Impl->host->address.port : 0; }

std::unique_ptr<Host> Host::CreateRelayHost(const std::string& relayAddress, uint16_t relayPort, const std::string& roomCode, const std::string& roomSecret) {
    std::unique_ptr<Host> host(new Host());
    ENetAddress target;
    host->m_Impl->host = enet_host_create(nullptr, 1, kChannels, 0, 0);
    if (!host->m_Impl->host || enet_address_set_host(&target, relayAddress.c_str()) != 0) return nullptr;
    target.port = relayPort;
    host->m_Impl->relayPeer = enet_host_connect(host->m_Impl->host, &target, kChannels, 0);
    if (!host->m_Impl->relayPeer) return nullptr;
    host->m_Impl->mode = Impl::Mode::RelayHost;
    host->m_Impl->roomCode = roomCode;
    host->m_Impl->roomSecret = roomSecret;
    if (host->m_Impl->roomSecret.empty()) {   // secreto nuevo: 16 caracteres aleatorios
        static const char digits[] = "0123456789abcdefghijklmnopqrstuvwxyz";
        std::random_device device;
        for (int i = 0; i < 16; ++i) host->m_Impl->roomSecret.push_back(digits[device() % (sizeof digits - 1)]);
    }
    return host;
}

std::unique_ptr<Host> Host::CreateRelayGuest(const std::string& relayAddress, uint16_t relayPort, const std::string& roomCode) {
    std::unique_ptr<Host> host(new Host());
    ENetAddress target;
    host->m_Impl->host = enet_host_create(nullptr, 1, kChannels, 0, 0);
    if (!host->m_Impl->host || enet_address_set_host(&target, relayAddress.c_str()) != 0) return nullptr;
    target.port = relayPort;
    host->m_Impl->relayPeer = enet_host_connect(host->m_Impl->host, &target, kChannels, 0);
    if (!host->m_Impl->relayPeer) return nullptr;
    host->m_Impl->mode = Impl::Mode::RelayGuest;
    host->m_Impl->roomCode = roomCode;
    return host;
}

bool Host::IsRelay() const { return m_Impl->mode != Impl::Mode::Direct; }
const std::string& Host::RoomCode() const { return m_Impl->roomCode; }
const std::string& Host::RoomSecret() const { return m_Impl->roomSecret; }
bool Host::RoomFailed() const { return m_Impl->roomFailed; }

bool Host::Connect(const std::string& address, uint16_t port) {
    ENetAddress target;
    if (enet_address_set_host(&target, address.c_str()) != 0) return false;
    target.port = port;
    return enet_host_connect(m_Impl->host, &target, kChannels, 0) != nullptr;
}

bool Host::Poll(NetEvent& out) {
    const double now = NowMs();
    m_Impl->Flush(m_Impl->unreliableSim.get(), false, now);
    m_Impl->Flush(m_Impl->reliableSim.get(), true, now);
    if (m_Impl->pending.empty()) {
        ENetEvent event;
        while (enet_host_service(m_Impl->host, &event, 0) > 0) {
            if (m_Impl->mode != Impl::Mode::Direct) {   // modo relevo: se traducen los mensajes del servidor de relevo a los mismos eventos de siempre
                const bool isHost = m_Impl->mode == Impl::Mode::RelayHost;
                const auto push = [&](NetEvent::Type type, uint32_t peer, int channel = 0, std::vector<uint8_t> data = {}) {
                    NetEvent e; e.type = type; e.peer = peer; e.channel = channel; e.data = std::move(data);
                    m_Impl->pending.push_back(std::move(e));
                };
                if (event.type == ENET_EVENT_TYPE_CONNECT) {
                    std::vector<uint8_t> hello;
                    if (isHost) {
                        const bool reclaim = m_Impl->roomCode.size() == Relay::kCodeLength;
                        hello.push_back(reclaim ? Relay::kReclaim : Relay::kCreate);
                        if (reclaim) hello.insert(hello.end(), m_Impl->roomCode.begin(), m_Impl->roomCode.end());
                        hello.push_back(static_cast<uint8_t>(m_Impl->roomSecret.size()));
                        hello.insert(hello.end(), m_Impl->roomSecret.begin(), m_Impl->roomSecret.end());
                    } else {
                        hello.push_back(Relay::kJoin);
                        hello.insert(hello.end(), m_Impl->roomCode.begin(), m_Impl->roomCode.end());
                    }
                    m_Impl->RelaySend(hello, true);
                } else if (event.type == ENET_EVENT_TYPE_DISCONNECT) {
                    m_Impl->relayPeer = nullptr;
                    if (isHost) { m_Impl->roomFailed = true; for (uint32_t vid : m_Impl->guests) push(NetEvent::Type::Disconnected, vid); m_Impl->guests.clear(); }
                    else push(NetEvent::Type::Disconnected, 1);
                } else if (event.type == ENET_EVENT_TYPE_RECEIVE) {
                    const uint8_t* d = event.packet->data; const size_t n = event.packet->dataLength;
                    m_BytesReceived += n;
                    const auto vidAt = [&](size_t at) { return static_cast<uint32_t>(d[at] | (d[at + 1] << 8) | (d[at + 2] << 16) | (static_cast<uint32_t>(d[at + 3]) << 24)); };
                    if (n >= 1) {
                        const uint8_t op = d[0];
                        if (op == Relay::kCreated && isHost && n >= 1 + Relay::kCodeLength) m_Impl->roomCode.assign(reinterpret_cast<const char*>(d + 1), Relay::kCodeLength);
                        else if (op == Relay::kError) {
                            if (isHost) m_Impl->roomFailed = true;
                            else { push(NetEvent::Type::Disconnected, 1); if (m_Impl->relayPeer) enet_peer_disconnect_later(m_Impl->relayPeer, 0); }
                        }
                        else if (op == Relay::kJoined && !isHost) push(NetEvent::Type::Connected, 1);
                        else if (op == Relay::kToGuest && !isHost && n > 3) push(NetEvent::Type::Message, 1, d[1], std::vector<uint8_t>(d + 3, d + n));
                        else if (op == Relay::kGuestJoined && isHost && n >= 5) { m_Impl->guests.insert(vidAt(1)); push(NetEvent::Type::Connected, vidAt(1)); }
                        else if (op == Relay::kGuestLeft && isHost && n >= 5) { m_Impl->guests.erase(vidAt(1)); push(NetEvent::Type::Disconnected, vidAt(1)); }
                        else if (op == Relay::kFromGuest && isHost && n > 7 && m_Impl->guests.count(vidAt(1))) push(NetEvent::Type::Message, vidAt(1), d[5], std::vector<uint8_t>(d + 7, d + n));
                    }
                    enet_packet_destroy(event.packet);
                }
                continue;
            }
            NetEvent converted;
            converted.peer = Impl::IdOf(event.peer);
            if (event.type == ENET_EVENT_TYPE_CONNECT) {
                converted.type = NetEvent::Type::Connected;
                m_Impl->peers[converted.peer] = event.peer;
            } else if (event.type == ENET_EVENT_TYPE_DISCONNECT) {
                converted.type = NetEvent::Type::Disconnected;
                m_Impl->peers.erase(converted.peer);
            } else if (event.type == ENET_EVENT_TYPE_RECEIVE) {
                converted.type = NetEvent::Type::Message;
                converted.channel = event.channelID;
                converted.data.assign(event.packet->data, event.packet->data + event.packet->dataLength);
                m_BytesReceived += event.packet->dataLength;
                enet_packet_destroy(event.packet);
            } else {
                continue;
            }
            m_Impl->pending.push_back(std::move(converted));
        }
    }
    if (m_Impl->pending.empty()) return false;
    out = std::move(m_Impl->pending.front());
    m_Impl->pending.pop_front();
    return true;
}

void Host::Send(uint32_t peer, int channel, const std::vector<uint8_t>& data, bool reliable) {
    m_BytesSent += data.size();
    NetSim* sim = reliable ? m_Impl->reliableSim.get() : m_Impl->unreliableSim.get();
    if (sim) sim->Send(Impl::Wrap(peer, channel, data), NowMs());
    else m_Impl->RawSend(peer, channel, data, reliable);
}

void Host::Disconnect(uint32_t peer) {
    if (m_Impl->mode == Impl::Mode::RelayHost) {
        m_Impl->RelaySend({Relay::kKick, static_cast<uint8_t>(peer), static_cast<uint8_t>(peer >> 8), static_cast<uint8_t>(peer >> 16), static_cast<uint8_t>(peer >> 24)}, true);
        return;
    }
    if (m_Impl->mode == Impl::Mode::RelayGuest) { if (m_Impl->relayPeer) enet_peer_disconnect_later(m_Impl->relayPeer, 0); return; }
    const auto it = m_Impl->peers.find(peer);
    if (it != m_Impl->peers.end()) enet_peer_disconnect_later(it->second, 0);   // espera a que salgan los mensajes fiables pendientes (el rechazo)
}

uint32_t Host::RoundTripMs(uint32_t peer) const {
    if (m_Impl->mode != Impl::Mode::Direct) return m_Impl->relayPeer ? m_Impl->relayPeer->roundTripTime : 0u;
    const auto it = m_Impl->peers.find(peer);
    return it == m_Impl->peers.end() ? 0u : it->second->roundTripTime;
}

std::string Host::PeerAddress(uint32_t peer) const {
    const auto it = m_Impl->peers.find(peer);
    if (it == m_Impl->peers.end()) return {};
    char buffer[64] = {};
    if (enet_address_get_host_ip(&it->second->address, buffer, sizeof buffer) != 0) return {};
    return buffer;
}

size_t Host::PeerCount() const { return m_Impl->mode == Impl::Mode::RelayHost ? m_Impl->guests.size() : m_Impl->mode == Impl::Mode::RelayGuest ? 1u : m_Impl->peers.size(); }

void Host::SetSimulation(const NetSimConfig& config, uint32_t seed) {
    m_Impl->simConfig = config;
    if (!config.Active()) { m_Impl->unreliableSim.reset(); m_Impl->reliableSim.reset(); return; }
    m_Impl->unreliableSim = std::make_unique<NetSim>(config, seed);
    NetSimConfig reliableOnly;   // lo fiable solo recibe la latencia: ENet reintenta lo perdido y no debe llegar duplicado
    reliableOnly.lagMs = config.lagMs;
    m_Impl->reliableSim = std::make_unique<NetSim>(reliableOnly, seed + 1);
}

} // namespace Bazuko::Net
