#include "RelayServer.hpp"

#include "RelayProtocol.hpp"
#include "Transport.hpp"

#include <enet/enet.h>

#include <algorithm>
#include <map>
#include <random>
#include <vector>

namespace Bazuko::Net {

namespace {
int g_Users = 0;
constexpr size_t kChannels = 2;
// sin 0/O ni 1/I/L para que se pueda dictar por voz o escribir sin dudas
constexpr char kAlphabet[] = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
}

struct RelayServer::Impl {
    struct Conn { enum class Role { None, Host, Guest } role = Role::None; std::string code; uint32_t vid = 0; double windowStart = 0.0; int windowCount = 0; };
    struct Room {
        ENetPeer* host = nullptr;
        std::string secret;
        std::map<uint32_t, ENetPeer*> guests;
        uint32_t nextVid = 1;
        double expiresMs = 0.0;   // > 0: sin anfitrion, se borra a esa hora si nadie la retoma
        std::string name;         // lo que se ve en la lista de salas
        bool listed = false;      // publica: aparece en la lista (si no, solo se entra con el codigo)
        uint8_t maxPlayers = 8;
    };
    ENetHost* host = nullptr;
    std::map<std::string, Room> rooms;
    std::random_device random;
    uint64_t relayed = 0;

    static Conn* ConnOf(ENetPeer* peer) { return static_cast<Conn*>(peer->data); }

    void Send(ENetPeer* peer, int channel, const std::vector<uint8_t>& data, bool reliable) {
        if (!peer || data.empty()) return;
        ENetPacket* packet = enet_packet_create(data.data(), data.size(), reliable ? ENET_PACKET_FLAG_RELIABLE : 0u);
        if (enet_peer_send(peer, static_cast<enet_uint8>(channel), packet) < 0) enet_packet_destroy(packet);
    }
    void Error(ENetPeer* peer, uint8_t code) { Send(peer, 0, {Relay::kError, code}, true); }

    std::string NewCode() {
        for (;;) {
            std::string code;
            for (size_t i = 0; i < Relay::kCodeLength; ++i) code.push_back(kAlphabet[random() % (sizeof kAlphabet - 1)]);
            if (!rooms.count(code)) return code;
        }
    }

    void DropGuest(Room& room, uint32_t vid) {
        room.guests.erase(vid);
        if (room.host) Send(room.host, 0, {Relay::kGuestLeft, static_cast<uint8_t>(vid), static_cast<uint8_t>(vid >> 8), static_cast<uint8_t>(vid >> 16), static_cast<uint8_t>(vid >> 24)}, true);
    }

    void OnDisconnect(ENetPeer* peer) {
        Conn* conn = ConnOf(peer);
        if (!conn) return;
        const auto it = rooms.find(conn->code);
        if (it != rooms.end()) {
            Room& room = it->second;
            if (conn->role == Conn::Role::Host && room.host == peer) {
                room.host = nullptr;
                room.expiresMs = NowMs() + Relay::kRoomGraceMs;   // se espera a que el siguiente anfitrion la retome
                for (auto& [vid, guest] : room.guests) { if (ConnOf(guest)) ConnOf(guest)->role = Conn::Role::None; enet_peer_disconnect(guest, 0); }   // los invitados notan que el anfitrion se fue
                room.guests.clear();
            } else if (conn->role == Conn::Role::Guest) {
                DropGuest(room, conn->vid);
            }
        }
        delete conn;
        peer->data = nullptr;
    }

    static std::string ReadString(const uint8_t* data, size_t size, size_t& at, size_t length) {
        if (at + length > size) return {};
        std::string value(reinterpret_cast<const char*>(data + at), length);
        at += length;
        return value;
    }

    void OnPacket(ENetPeer* peer, const uint8_t* data, size_t size) {
        if (size == 0 || size > Relay::kMaxPacket) return;
        Conn* conn = ConnOf(peer);
        if (!conn) return;
        const double now = NowMs();   // limite de ritmo por conexion: 600 mensajes por segundo
        if (now - conn->windowStart > 1000.0) { conn->windowStart = now; conn->windowCount = 0; }
        if (++conn->windowCount > 600) return;
        const uint8_t op = data[0];
        if (op == Relay::kCreate || op == Relay::kReclaim) {
            if (conn->role != Conn::Role::None) return;
            size_t at = 1;
            std::string code;
            if (op == Relay::kReclaim) { code = ReadString(data, size, at, Relay::kCodeLength); if (code.size() != Relay::kCodeLength) return Error(peer, Relay::kBadRequest); }
            if (at >= size) return Error(peer, Relay::kBadRequest);
            const size_t secretLength = data[at++];
            if (secretLength == 0 || secretLength > Relay::kMaxSecretLength) return Error(peer, Relay::kBadRequest);
            const std::string secret = ReadString(data, size, at, secretLength);
            if (secret.size() != secretLength) return Error(peer, Relay::kBadRequest);
            if (op == Relay::kCreate) {
                if (rooms.size() >= Relay::kMaxRooms) return Error(peer, Relay::kTooManyRooms);
                code = NewCode();
                Room room; room.host = peer; room.secret = secret;
                rooms[code] = std::move(room);
            } else {
                const auto it = rooms.find(code);
                if (it == rooms.end()) return Error(peer, Relay::kNoRoom);
                if (it->second.secret != secret) return Error(peer, Relay::kBadSecret);
                if (it->second.host) return Error(peer, Relay::kBadRequest);   // ya tiene anfitrion
                it->second.host = peer; it->second.expiresMs = 0.0;
            }
            conn->role = Conn::Role::Host; conn->code = code;
            std::vector<uint8_t> answer{Relay::kCreated};
            answer.insert(answer.end(), code.begin(), code.end());
            Send(peer, 0, answer, true);
        } else if (op == Relay::kJoin) {
            if (conn->role != Conn::Role::None || size < 1 + Relay::kCodeLength) return;
            const std::string code(reinterpret_cast<const char*>(data + 1), Relay::kCodeLength);
            const auto it = rooms.find(code);
            if (it == rooms.end() || !it->second.host) return Error(peer, Relay::kNoRoom);
            Room& room = it->second;
            if (room.guests.size() >= Relay::kMaxGuestsPerRoom) return Error(peer, Relay::kRoomFull);
            const uint32_t vid = room.nextVid++;
            room.guests[vid] = peer;
            conn->role = Conn::Role::Guest; conn->code = code; conn->vid = vid;
            Send(peer, 0, {Relay::kJoined}, true);
            Send(room.host, 0, {Relay::kGuestJoined, static_cast<uint8_t>(vid), static_cast<uint8_t>(vid >> 8), static_cast<uint8_t>(vid >> 16), static_cast<uint8_t>(vid >> 24)}, true);
        } else if (op == Relay::kRoomInfo && conn->role == Conn::Role::Host) {   // publica, cupo, largo, nombre
            if (size < 4) return;
            const auto it = rooms.find(conn->code);
            if (it == rooms.end()) return;
            const size_t length = std::min<size_t>(data[3], Relay::kMaxRoomName);
            size_t at = 4;
            std::string name = ReadString(data, size, at, (std::min)(length, size - 4));
            std::erase_if(name, [](char c) { return static_cast<unsigned char>(c) < 0x20 || c == 0x7F; });   // sin saltos ni caracteres de control
            it->second.listed = data[1] != 0;
            it->second.maxPlayers = std::clamp<uint8_t>(data[2], 2, 255);
            it->second.name = name;
        } else if (op == Relay::kList) {   // lista de salas publicas: la pide el lobby antes de entrar a una
            std::vector<uint8_t> out{Relay::kRoomList, 0};
            uint8_t count = 0;
            for (const auto& [code, room] : rooms) {
                if (!room.listed || !room.host || count >= Relay::kMaxListedRooms) continue;
                out.insert(out.end(), code.begin(), code.end());
                out.push_back(static_cast<uint8_t>(std::min<size_t>(room.guests.size() + 1, 255)));
                out.push_back(room.maxPlayers);
                out.push_back(static_cast<uint8_t>(room.name.size()));
                out.insert(out.end(), room.name.begin(), room.name.end());
                ++count;
            }
            out[1] = count;
            Send(peer, 0, out, true);
        } else if (op == Relay::kGuestSend && conn->role == Conn::Role::Guest) {
            if (size < 3) return;
            const auto it = rooms.find(conn->code);
            if (it == rooms.end() || !it->second.host) return;
            std::vector<uint8_t> out{Relay::kFromGuest, static_cast<uint8_t>(conn->vid), static_cast<uint8_t>(conn->vid >> 8), static_cast<uint8_t>(conn->vid >> 16), static_cast<uint8_t>(conn->vid >> 24)};
            out.insert(out.end(), data + 1, data + size);   // canal, fiable, bytes
            relayed += size;
            Send(it->second.host, data[2] ? 0 : 1, out, data[2] != 0);
        } else if (op == Relay::kHostSend && conn->role == Conn::Role::Host) {
            if (size < 7) return;
            const uint32_t vid = data[1] | (data[2] << 8) | (data[3] << 16) | (static_cast<uint32_t>(data[4]) << 24);
            const auto it = rooms.find(conn->code);
            if (it == rooms.end()) return;
            const auto guest = it->second.guests.find(vid);
            if (guest == it->second.guests.end()) return;
            std::vector<uint8_t> out{Relay::kToGuest};
            out.insert(out.end(), data + 5, data + size);   // canal, fiable, bytes
            relayed += size;
            Send(guest->second, data[6] ? 0 : 1, out, data[6] != 0);
        } else if (op == Relay::kKick && conn->role == Conn::Role::Host && size >= 5) {
            const uint32_t vid = data[1] | (data[2] << 8) | (data[3] << 16) | (static_cast<uint32_t>(data[4]) << 24);
            const auto it = rooms.find(conn->code);
            if (it == rooms.end()) return;
            const auto guest = it->second.guests.find(vid);
            if (guest != it->second.guests.end()) enet_peer_disconnect_later(guest->second, 0);
        }
    }
};

RelayServer::RelayServer() : m_Impl(std::make_unique<Impl>()) { if (g_Users++ == 0) enet_initialize(); }
RelayServer::~RelayServer() {
    if (m_Impl->host) { enet_host_flush(m_Impl->host); enet_host_destroy(m_Impl->host); }
    if (--g_Users == 0) enet_deinitialize();
}

std::unique_ptr<RelayServer> RelayServer::Create(uint16_t port) {
    std::unique_ptr<RelayServer> server(new RelayServer());
    ENetAddress address; address.host = ENET_HOST_ANY; address.port = port;
    server->m_Impl->host = enet_host_create(&address, 1024, kChannels, 0, 0);
    return server->m_Impl->host ? std::move(server) : nullptr;
}

uint16_t RelayServer::Port() const { return m_Impl->host ? m_Impl->host->address.port : 0; }

void RelayServer::Update() {
    ENetEvent event;
    while (enet_host_service(m_Impl->host, &event, 0) > 0) {
        if (event.type == ENET_EVENT_TYPE_CONNECT) {
            event.peer->data = new Impl::Conn();
            enet_peer_timeout(event.peer, 0, Relay::kPeerTimeoutMinMs, Relay::kPeerTimeoutMaxMs);   // un jugador o anfitrion que desaparece se nota en pocos segundos
        } else if (event.type == ENET_EVENT_TYPE_DISCONNECT) {
            m_Impl->OnDisconnect(event.peer);
        } else if (event.type == ENET_EVENT_TYPE_RECEIVE) {
            m_Impl->OnPacket(event.peer, event.packet->data, event.packet->dataLength);
            enet_packet_destroy(event.packet);
        }
    }
    const double now = NowMs();   // salas sin anfitrion que nadie retomo
    for (auto it = m_Impl->rooms.begin(); it != m_Impl->rooms.end();) {
        if (!it->second.host && it->second.expiresMs > 0.0 && now > it->second.expiresMs) it = m_Impl->rooms.erase(it); else ++it;
    }
}

size_t RelayServer::RoomCount() const { return m_Impl->rooms.size(); }
size_t RelayServer::GuestCount() const { size_t n = 0; for (const auto& [code, room] : m_Impl->rooms) n += room.guests.size(); return n; }
uint64_t RelayServer::BytesRelayed() const { return m_Impl->relayed; }

} // namespace Bazuko::Net
