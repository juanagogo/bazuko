#pragma once
// Protocolo de red del multijugador (version 1): mensajes, rangos de cuantizacion y su serializacion.
// Es solo datos y bits: no depende del juego, de Simulation ni de la biblioteca de transporte, asi que se prueba sola.
//
// Canales: 0 = fiable y ordenado (Hello, Welcome, Bye, Chat); 1 = no fiable (Input, Snapshot, Ping, Pong).
// Todo mensaje empieza con su tipo (8 bits). Cualquier dato fuera de rango o truncado hace fallar la lectura (nunca se confia en el cliente).
#include "BitStream.hpp"

#include <array>
#include <cstdint>
#include <optional>
#include <string>
#include <vector>

namespace Bazuko::Net {

inline constexpr uint16_t kProtocolVersion = 1;
inline constexpr int kChannelReliable = 0;
inline constexpr int kChannelUnreliable = 1;
inline constexpr size_t kMaxPlayers = 100;      // por mundo (cifra de pruebas); los ids van en 7 bits (1..127)
inline constexpr size_t kMaxSnapshotEntries = 48;  // jugadores por instantanea: los 48 mas cercanos (cabe en un paquete de ~600 B)
inline constexpr size_t kMaxNameLength = 24;
inline constexpr size_t kMaxLookBytes = 200;   // apariencia del creador de personaje, opaca para la red
inline constexpr size_t kMaxChatLength = 120;

enum class MessageType : uint8_t { Hello = 1, Welcome, Reject, Bye, Input, Snapshot, Ping, Pong, Chat };

// Rangos del mapa (metros) para cuantizar posiciones: 16 bits por eje dan ~8 mm en X/Z y ~2 mm en altura
inline constexpr float kWorldMinX = -64.0f, kWorldMaxX = 448.0f;
inline constexpr float kWorldMinZ = -128.0f, kWorldMaxZ = 384.0f;
inline constexpr float kWorldMinY = -8.0f, kWorldMaxY = 120.0f;
inline constexpr float kMaxSpeed = 40.0f;   // m/s cuantizados en 8 bits

// Botones del input (bits de PlayerInput::buttons)
enum Button : uint16_t { kJump = 1 << 0, kRun = 1 << 1, kCrouch = 1 << 2, kInteract = 1 << 3, kAttack = 1 << 4, kKick = 1 << 5, kUse = 1 << 6 };

struct Hello {
    uint16_t protocol = kProtocolVersion;
    std::string name;
    std::vector<uint8_t> look;   // apariencia serializada por el juego (opaca para la red)
};
struct Welcome {
    uint8_t playerId = 0;
    uint8_t tickRate = 30;        // simulacion del servidor
    uint8_t snapshotRate = 20;    // instantaneas por segundo
    uint32_t serverTick = 0;
    uint32_t worldSeed = 0;
};
enum class RejectReason : uint8_t { WrongProtocol = 1, ServerFull, BadName };
struct Reject { RejectReason reason = RejectReason::WrongProtocol; };

struct PlayerInput {
    uint32_t sequence = 0;        // numero creciente: el servidor confirma el ultimo aplicado
    float moveX = 0.0f, moveZ = 0.0f;   // direccion deseada en el plano, cada eje en [-1, 1] (se cuantiza en 8 bits)
    float yaw = 0.0f;             // radianes, se envuelve a [0, 2pi)
    uint16_t buttons = 0;
};

// Estado de un jugador dentro de una instantanea
struct PlayerSnapshot {
    uint8_t id = 0;
    float x = 0.0f, y = 0.0f, z = 0.0f;
    float yaw = 0.0f;
    float speed = 0.0f;           // m/s
    uint8_t animation = 0;        // clip o postura (lo define el juego)
    uint8_t flags = 0;            // bit 0 en vehiculo, bit 1 aturdido, bit 2 muerto...
};
struct Snapshot {
    uint32_t serverTick = 0;
    uint32_t ackInput = 0;        // ultimo `sequence` de input del destinatario que el servidor aplico
    std::vector<PlayerSnapshot> players;
};
struct Ping { uint32_t token = 0; };
struct Chat { uint8_t from = 0; std::string text; };

// ---- escritura ----
inline void Write(BitWriter& w, const Hello& m) {
    w.U8(static_cast<uint32_t>(MessageType::Hello)); w.U16(m.protocol); w.String(m.name, kMaxNameLength);
    const size_t length = std::min(m.look.size(), kMaxLookBytes);
    w.U8(static_cast<uint32_t>(length));
    for (size_t i = 0; i < length; ++i) w.U8(m.look[i]);
}
inline void Write(BitWriter& w, const Welcome& m) {
    w.U8(static_cast<uint32_t>(MessageType::Welcome)); w.U8(m.playerId); w.U8(m.tickRate); w.U8(m.snapshotRate); w.U32(m.serverTick); w.U32(m.worldSeed);
}
inline void Write(BitWriter& w, const Reject& m) { w.U8(static_cast<uint32_t>(MessageType::Reject)); w.U8(static_cast<uint32_t>(m.reason)); }
inline void WriteBye(BitWriter& w) { w.U8(static_cast<uint32_t>(MessageType::Bye)); }
inline void Write(BitWriter& w, const PlayerInput& m) {
    w.U8(static_cast<uint32_t>(MessageType::Input)); w.U32(m.sequence);
    w.Quantized(m.moveX, -1.0f, 1.0f, 8); w.Quantized(m.moveZ, -1.0f, 1.0f, 8);
    const float tau = 6.2831853f;
    w.Quantized(m.yaw - tau * std::floor(m.yaw / tau), 0.0f, tau, 12);
    w.U16(m.buttons);
}
inline void Write(BitWriter& w, const Snapshot& m) {
    w.U8(static_cast<uint32_t>(MessageType::Snapshot)); w.U32(m.serverTick); w.U32(m.ackInput);
    const size_t count = std::min(m.players.size(), kMaxSnapshotEntries);
    w.Bits(static_cast<uint32_t>(count), 7);
    for (size_t i = 0; i < count; ++i) {
        const PlayerSnapshot& p = m.players[i];
        w.Bits(p.id & 0x7Fu, 7);
        w.Quantized(p.x, kWorldMinX, kWorldMaxX, 16); w.Quantized(p.y, kWorldMinY, kWorldMaxY, 16); w.Quantized(p.z, kWorldMinZ, kWorldMaxZ, 16);
        const float tau = 6.2831853f;
        w.Quantized(p.yaw - tau * std::floor(p.yaw / tau), 0.0f, tau, 10);
        w.Quantized(p.speed, 0.0f, kMaxSpeed, 8); w.U8(p.animation); w.U8(p.flags);
    }
}
inline void Write(BitWriter& w, const Ping& m, bool pong) { w.U8(static_cast<uint32_t>(pong ? MessageType::Pong : MessageType::Ping)); w.U32(m.token); }
inline void Write(BitWriter& w, const Chat& m) { w.U8(static_cast<uint32_t>(MessageType::Chat)); w.U8(m.from); w.String(m.text, kMaxChatLength); }

// ---- lectura (cada una devuelve nullopt si el paquete esta truncado o fuera de rango) ----
// Todas suponen que el tipo (primer byte) ya se leyo con ReadType.
inline std::optional<MessageType> ReadType(BitReader& r) {
    const uint32_t type = r.U8();
    if (r.Failed() || type < static_cast<uint32_t>(MessageType::Hello) || type > static_cast<uint32_t>(MessageType::Chat)) return std::nullopt;
    return static_cast<MessageType>(type);
}
inline std::optional<Hello> ReadHello(BitReader& r) {
    Hello m; m.protocol = static_cast<uint16_t>(r.U16()); m.name = r.String(kMaxNameLength);
    const size_t length = r.U8();
    if (length > kMaxLookBytes) return std::nullopt;
    for (size_t i = 0; i < length; ++i) m.look.push_back(static_cast<uint8_t>(r.U8()));
    if (r.Failed()) return std::nullopt;
    return m;
}
inline std::optional<Welcome> ReadWelcome(BitReader& r) {
    Welcome m; m.playerId = static_cast<uint8_t>(r.U8()); m.tickRate = static_cast<uint8_t>(r.U8()); m.snapshotRate = static_cast<uint8_t>(r.U8());
    m.serverTick = r.U32(); m.worldSeed = r.U32();
    if (r.Failed() || m.tickRate == 0 || m.snapshotRate == 0) return std::nullopt;
    return m;
}
inline std::optional<Reject> ReadReject(BitReader& r) {
    Reject m; m.reason = static_cast<RejectReason>(r.U8());
    if (r.Failed()) return std::nullopt;
    return m;
}
inline std::optional<PlayerInput> ReadInput(BitReader& r) {
    PlayerInput m; m.sequence = r.U32(); m.moveX = r.Quantized(-1.0f, 1.0f, 8); m.moveZ = r.Quantized(-1.0f, 1.0f, 8);
    m.yaw = r.Quantized(0.0f, 6.2831853f, 12); m.buttons = static_cast<uint16_t>(r.U16());
    if (r.Failed()) return std::nullopt;
    return m;
}
inline std::optional<Snapshot> ReadSnapshot(BitReader& r) {
    Snapshot m; m.serverTick = r.U32(); m.ackInput = r.U32();
    const uint32_t count = r.Bits(7);
    if (count > kMaxSnapshotEntries) return std::nullopt;
    for (uint32_t i = 0; i < count; ++i) {
        PlayerSnapshot p; p.id = static_cast<uint8_t>(r.Bits(7));
        p.x = r.Quantized(kWorldMinX, kWorldMaxX, 16); p.y = r.Quantized(kWorldMinY, kWorldMaxY, 16); p.z = r.Quantized(kWorldMinZ, kWorldMaxZ, 16);
        p.yaw = r.Quantized(0.0f, 6.2831853f, 10); p.speed = r.Quantized(0.0f, kMaxSpeed, 8); p.animation = static_cast<uint8_t>(r.U8()); p.flags = static_cast<uint8_t>(r.U8());
        m.players.push_back(p);
    }
    if (r.Failed()) return std::nullopt;
    return m;
}
inline std::optional<Ping> ReadPing(BitReader& r) {
    Ping m; m.token = r.U32();
    if (r.Failed()) return std::nullopt;
    return m;
}
inline std::optional<Chat> ReadChat(BitReader& r) {
    Chat m; m.from = static_cast<uint8_t>(r.U8()); m.text = r.String(kMaxChatLength);
    if (r.Failed()) return std::nullopt;
    return m;
}

} // namespace Bazuko::Net
