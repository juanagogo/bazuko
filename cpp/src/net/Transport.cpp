#include "Transport.hpp"

#include <enet/enet.h>

#include <chrono>
#include <deque>
#include <map>

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

    static uint32_t IdOf(ENetPeer* peer) { return static_cast<uint32_t>(peer->incomingPeerID) + 1u; }   // 0 queda libre para "ninguno"

    void RawSend(uint32_t id, int channel, const std::vector<uint8_t>& data, bool reliable) {
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

uint16_t Host::Port() const { return m_Impl->host ? m_Impl->host->address.port : 0; }

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
    const auto it = m_Impl->peers.find(peer);
    if (it != m_Impl->peers.end()) enet_peer_disconnect_later(it->second, 0);   // espera a que salgan los mensajes fiables pendientes (el rechazo)
}

uint32_t Host::RoundTripMs(uint32_t peer) const {
    const auto it = m_Impl->peers.find(peer);
    return it == m_Impl->peers.end() ? 0u : it->second->roundTripTime;
}

size_t Host::PeerCount() const { return m_Impl->peers.size(); }

void Host::SetSimulation(const NetSimConfig& config, uint32_t seed) {
    m_Impl->simConfig = config;
    if (!config.Active()) { m_Impl->unreliableSim.reset(); m_Impl->reliableSim.reset(); return; }
    m_Impl->unreliableSim = std::make_unique<NetSim>(config, seed);
    NetSimConfig reliableOnly;   // lo fiable solo recibe la latencia: ENet reintenta lo perdido y no debe llegar duplicado
    reliableOnly.lagMs = config.lagMs;
    m_Impl->reliableSim = std::make_unique<NetSim>(reliableOnly, seed + 1);
}

} // namespace Bazuko::Net
