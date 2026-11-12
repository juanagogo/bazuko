#include "RoomDirectory.hpp"

#include "RelayProtocol.hpp"
#include "Transport.hpp"

#include <enet/enet.h>

#include <algorithm>
#include <cstring>
#include <map>

namespace Bazuko::Net {

namespace {
int g_Users = 0;   // enet_initialize lleva su propia cuenta en cada modulo (en Windows, WSAStartup y WSACleanup tambien se cuentan)
void Acquire() { if (g_Users++ == 0) enet_initialize(); }
void Release() { if (--g_Users == 0) enet_deinitialize(); }

constexpr uint8_t kVersion = 1;
constexpr char kQuery[4] = {'B', 'Z', 'K', '?'};
constexpr char kAnswer[4] = {'B', 'Z', 'K', '!'};
constexpr double kLanAskEveryMs = 2000.0;
constexpr double kLanForgetMs = 6500.0;     // una sala de la red local que deja de responder sale de la lista
constexpr double kRelayAskEveryMs = 3000.0;
constexpr double kRelayRetryMs = 5000.0;

ENetSocket OpenDatagram(uint16_t bindPort, bool broadcast) {
    ENetSocket socket = enet_socket_create(ENET_SOCKET_TYPE_DATAGRAM);
    if (socket == ENET_SOCKET_NULL) return socket;
    enet_socket_set_option(socket, ENET_SOCKOPT_NONBLOCK, 1);
    enet_socket_set_option(socket, ENET_SOCKOPT_REUSEADDR, 1);
    if (broadcast) enet_socket_set_option(socket, ENET_SOCKOPT_BROADCAST, 1);
    ENetAddress address; address.host = ENET_HOST_ANY; address.port = bindPort;
    if (enet_socket_bind(socket, &address) < 0) { enet_socket_destroy(socket); return ENET_SOCKET_NULL; }
    return socket;
}

void SendTo(ENetSocket socket, uint32_t host, uint16_t port, const std::vector<uint8_t>& data) {
    ENetAddress address; address.host = host; address.port = port;
    ENetBuffer buffer; buffer.data = const_cast<uint8_t*>(data.data()); buffer.dataLength = data.size();
    enet_socket_send(socket, &address, &buffer, 1);
}
}

std::string CleanRoomName(const std::string& name, size_t maxBytes) {
    std::string clean;
    for (char c : name) if (static_cast<unsigned char>(c) >= 0x20 && c != 0x7F) clean.push_back(c);
    if (clean.size() > maxBytes) {
        clean.resize(maxBytes);
        while (!clean.empty() && (static_cast<unsigned char>(clean.back()) & 0xC0) == 0x80) clean.pop_back();   // continuaciones de una letra cortada
        if (!clean.empty() && static_cast<unsigned char>(clean.back()) >= 0xC0) clean.pop_back();              // y su comienzo
    }
    return clean;
}

// ---- Baliza de la red local ----

struct LanBeacon::Impl {
    ENetSocket socket = ENET_SOCKET_NULL;
    uint16_t gamePort = 0;
    std::string name;
    uint8_t maxPlayers = 8;
};

LanBeacon::~LanBeacon() {
    if (m_Impl && m_Impl->socket != ENET_SOCKET_NULL) enet_socket_destroy(m_Impl->socket);
    if (m_Impl) Release();
}

std::unique_ptr<LanBeacon> LanBeacon::Create(uint16_t gamePort, const std::string& name, uint8_t maxPlayers, uint16_t discoveryPort) {
    Acquire();
    std::unique_ptr<LanBeacon> beacon(new LanBeacon());
    beacon->m_Impl = std::make_unique<Impl>();
    beacon->m_Impl->socket = OpenDatagram(discoveryPort, false);
    beacon->m_Impl->gamePort = gamePort;
    beacon->m_Impl->name = CleanRoomName(name, Relay::kMaxRoomName);
    beacon->m_Impl->maxPlayers = maxPlayers;
    if (beacon->m_Impl->socket == ENET_SOCKET_NULL) return nullptr;   // el destructor devuelve la cuenta de ENet
    return beacon;
}

void LanBeacon::Update(size_t players) {
    uint8_t packet[64];
    for (int guard = 0; guard < 32; ++guard) {   // a lo sumo 32 preguntas por cuadro: nadie inunda el juego
        ENetAddress from;
        ENetBuffer buffer; buffer.data = packet; buffer.dataLength = sizeof packet;
        const int received = enet_socket_receive(m_Impl->socket, &from, &buffer, 1);
        if (received <= 0) return;
        if (received < 5 || std::memcmp(packet, kQuery, 4) != 0 || packet[4] != kVersion) continue;
        std::vector<uint8_t> answer(kAnswer, kAnswer + 4);
        answer.push_back(kVersion);
        answer.push_back(static_cast<uint8_t>(m_Impl->gamePort & 0xFF));
        answer.push_back(static_cast<uint8_t>(m_Impl->gamePort >> 8));
        answer.push_back(static_cast<uint8_t>(std::min<size_t>(players, 255)));
        answer.push_back(m_Impl->maxPlayers);
        answer.push_back(static_cast<uint8_t>(m_Impl->name.size()));
        answer.insert(answer.end(), m_Impl->name.begin(), m_Impl->name.end());
        SendTo(m_Impl->socket, from.host, from.port, answer);
    }
}

// ---- Buscador de salas ----

struct RoomBrowser::Impl {
    uint16_t discoveryPort = kLanDiscoveryPort;
    ENetSocket lan = ENET_SOCKET_NULL;
    double lanAskedMs = -1.0e9;
    struct LanSeen { RoomListing room; double seenMs = 0.0; };
    std::map<std::string, LanSeen> lanRooms;   // "ip:puerto" -> sala

    // Un enlace por servidor de salas: cada uno con su conexion, su estado y las salas que dio
    struct RelayLink {
        std::string address;
        uint16_t port = 0;
        ENetHost* host = nullptr;
        ENetPeer* peer = nullptr;
        RelayState state = RelayState::Off;
        double askedMs = -1.0e9, retryMs = 0.0;
        std::vector<RoomListing> rooms;

        void Close() {
            if (peer) { enet_peer_reset(peer); peer = nullptr; }
            if (host) { enet_host_destroy(host); host = nullptr; }
        }
        void Open() {
            Close();
            rooms.clear();
            if (address.empty()) { state = RelayState::Off; return; }
            ENetAddress target;
            host = enet_host_create(nullptr, 1, 2, 0, 0);
            if (!host || enet_address_set_host(&target, address.c_str()) != 0) { state = RelayState::Failed; retryMs = NowMs() + kRelayRetryMs; return; }
            target.port = port;
            peer = enet_host_connect(host, &target, 2, 0);
            if (!peer) { state = RelayState::Failed; retryMs = NowMs() + kRelayRetryMs; return; }
            enet_peer_timeout(peer, 0, 2500, 4000);   // un relevo que no contesta se nota en pocos segundos
            state = RelayState::Connecting;
        }
        void Ask() {
            if (state != RelayState::Online || !peer) return;
            const uint8_t op = Relay::kList;
            ENetPacket* packet = enet_packet_create(&op, 1, ENET_PACKET_FLAG_RELIABLE);
            if (enet_peer_send(peer, 0, packet) < 0) enet_packet_destroy(packet);
            askedMs = NowMs();
        }
        void ReadRoomList(const uint8_t* d, size_t n) {
            rooms.clear();
            if (n < 2) return;
            const size_t count = d[1];
            size_t at = 2;
            for (size_t i = 0; i < count; ++i) {
                if (at + Relay::kCodeLength + 3 > n) break;
                RoomListing room;
                room.code.assign(reinterpret_cast<const char*>(d + at), Relay::kCodeLength);
                at += Relay::kCodeLength;
                room.players = d[at++];
                room.maxPlayers = d[at++];
                const size_t length = d[at++];
                if (at + length > n) break;
                room.name = CleanRoomName(std::string(reinterpret_cast<const char*>(d + at), length), Relay::kMaxRoomName);
                at += length;
                room.address = address;
                room.port = port;
                rooms.push_back(std::move(room));
            }
        }
        void Update(double now) {
            ENetEvent event;
            while (host && enet_host_service(host, &event, 0) > 0) {
                if (event.type == ENET_EVENT_TYPE_CONNECT) { state = RelayState::Online; Ask(); }
                else if (event.type == ENET_EVENT_TYPE_DISCONNECT) {
                    peer = nullptr;
                    state = RelayState::Failed;
                    rooms.clear();
                    retryMs = now + kRelayRetryMs;
                } else if (event.type == ENET_EVENT_TYPE_RECEIVE) {
                    if (event.packet->dataLength >= 1 && event.packet->data[0] == Relay::kRoomList) ReadRoomList(event.packet->data, event.packet->dataLength);
                    enet_packet_destroy(event.packet);
                }
            }
            if (state == RelayState::Online && now - askedMs > kRelayAskEveryMs) Ask();
            if (state == RelayState::Failed && !address.empty() && now > retryMs) Open();
        }
    };
    std::vector<std::unique_ptr<RelayLink>> relays;

    void AskLan() {
        if (lan == ENET_SOCKET_NULL) return;
        std::vector<uint8_t> query(kQuery, kQuery + 4);
        query.push_back(kVersion);
        SendTo(lan, ENET_HOST_BROADCAST, discoveryPort, query);
        ENetAddress local;   // la misma maquina (dos copias del juego abiertas)
        if (enet_address_set_host_ip(&local, "127.0.0.1") == 0) SendTo(lan, local.host, discoveryPort, query);
        lanAskedMs = NowMs();
    }
    void ReadLan() {
        if (lan == ENET_SOCKET_NULL) return;
        uint8_t packet[256];
        for (int guard = 0; guard < 64; ++guard) {
            ENetAddress from;
            ENetBuffer buffer; buffer.data = packet; buffer.dataLength = sizeof packet;
            const int received = enet_socket_receive(lan, &from, &buffer, 1);
            if (received <= 0) return;
            if (received < 11 || std::memcmp(packet, kAnswer, 4) != 0 || packet[4] != kVersion) continue;
            const size_t length = packet[9];
            if (10 + length > static_cast<size_t>(received)) continue;
            char ip[64] = {};
            if (enet_address_get_host_ip(&from, ip, sizeof ip) != 0) continue;
            RoomListing room;
            room.lan = true;
            room.address = ip;
            room.port = static_cast<uint16_t>(packet[5] | (packet[6] << 8));
            room.players = packet[7];
            room.maxPlayers = packet[8];
            room.name = CleanRoomName(std::string(reinterpret_cast<const char*>(packet + 10), length), Relay::kMaxRoomName);
            if (room.port == 0) continue;
            std::string key = room.address + ":" + std::to_string(room.port);
            // la misma sala responde por la difusion y por 127.0.0.1: si ya esta con otra IP en el mismo puerto y nombre, se queda una sola
            if (room.address == "127.0.0.1")
                for (auto& [other, seen] : lanRooms) if (seen.room.port == room.port && seen.room.name == room.name && other != key) { key.clear(); seen.seenMs = NowMs(); break; }
            if (key.empty()) continue;
            lanRooms[key] = LanSeen{room, NowMs()};
        }
    }
};

RoomBrowser::RoomBrowser(uint16_t discoveryPort) : m_Impl(std::make_unique<Impl>()) {
    Acquire();
    m_Impl->discoveryPort = discoveryPort;
    m_Impl->lan = OpenDatagram(0, true);
}

RoomBrowser::~RoomBrowser() {
    for (auto& link : m_Impl->relays) link->Close();
    if (m_Impl->lan != ENET_SOCKET_NULL) enet_socket_destroy(m_Impl->lan);
    Release();
}

void RoomBrowser::SetRelay(const std::string& address, uint16_t port) {
    if (address.empty()) SetRelays({});
    else SetRelays({{address, port}});
}

void RoomBrowser::SetRelays(const std::vector<std::pair<std::string, uint16_t>>& relays) {
    bool same = relays.size() == m_Impl->relays.size();
    for (size_t i = 0; same && i < relays.size(); ++i) same = relays[i].first == m_Impl->relays[i]->address && relays[i].second == m_Impl->relays[i]->port;
    if (same) return;   // la misma lista: se conservan las conexiones
    for (auto& link : m_Impl->relays) link->Close();
    m_Impl->relays.clear();
    for (const auto& [address, port] : relays) {
        if (address.empty()) continue;
        auto link = std::make_unique<Impl::RelayLink>();
        link->address = address;
        link->port = port;
        link->Open();
        m_Impl->relays.push_back(std::move(link));
    }
}

void RoomBrowser::Refresh() {
    m_Impl->AskLan();
    for (auto& link : m_Impl->relays) {
        if (link->state == RelayState::Failed) link->Open();
        else link->Ask();
    }
}

void RoomBrowser::Update() {
    const double now = NowMs();
    if (now - m_Impl->lanAskedMs > kLanAskEveryMs) m_Impl->AskLan();
    m_Impl->ReadLan();
    std::erase_if(m_Impl->lanRooms, [now](const auto& entry) { return now - entry.second.seenMs > kLanForgetMs; });
    for (auto& link : m_Impl->relays) link->Update(now);
}

std::vector<RoomListing> RoomBrowser::Rooms() const {
    std::vector<RoomListing> out;
    for (const auto& [key, seen] : m_Impl->lanRooms) out.push_back(seen.room);
    for (const auto& link : m_Impl->relays) out.insert(out.end(), link->rooms.begin(), link->rooms.end());
    return out;
}

RoomBrowser::RelayState RoomBrowser::GetRelayState() const {   // conectado si alguno lo esta; buscando si alguno aun lo intenta; sin respuesta si todos fallaron
    if (m_Impl->relays.empty()) return RelayState::Off;
    bool connecting = false;
    for (const auto& link : m_Impl->relays) {
        if (link->state == RelayState::Online) return RelayState::Online;
        if (link->state == RelayState::Connecting) connecting = true;
    }
    return connecting ? RelayState::Connecting : RelayState::Failed;
}

std::string RoomBrowser::OnlineRelay() const {
    for (const auto& link : m_Impl->relays)
        if (link->state == RelayState::Online) return link->address + ":" + std::to_string(link->port);
    return {};
}

} // namespace Bazuko::Net
