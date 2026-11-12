#pragma once
// Protocolo del relevo (relay): para jugar por internet sin abrir puertos. Todos los jugadores se conectan HACIA AFUERA a un servidor de relevo
// (un programa pequeno, `bazuko_relay`, que corre en cualquier maquina con IP publica) y este reenvia los paquetes entre el anfitrion y sus invitados
// por salas con un codigo corto. El relevo no entiende el juego: solo reenvia bytes. Cada tramo (jugador-relevo) es un ENet normal.
//
//   jugador -> relevo : Create{secreto} | Reclaim{codigo, secreto} | Join{codigo} | Data{canal, fiable, bytes}   (el invitado habla siempre al anfitrion)
//   relevo -> jugador : Created{codigo} | Joined | Error{razon} | Data{canal, fiable, bytes}
//   anfitrion -> relevo : HostData{vid, canal, fiable, bytes} | Kick{vid}
//   relevo -> anfitrion : GuestJoined{vid} | GuestLeft{vid} | GuestData{vid, canal, fiable, bytes}
#include <cstdint>
#include <string>

namespace Bazuko::Net::Relay {

enum Op : uint8_t {
    // jugador -> relevo
    kCreate = 0x01, kReclaim = 0x02, kJoin = 0x03, kGuestSend = 0x22,
    // anfitrion -> relevo
    kHostSend = 0x12, kKick = 0x13,
    // relevo -> jugador
    kCreated = 0x81, kJoined = 0x83, kError = 0x8F, kToGuest = 0xA2,
    // relevo -> anfitrion
    kGuestJoined = 0x90, kGuestLeft = 0x91, kFromGuest = 0x92,
};
enum ErrorCode : uint8_t { kNoRoom = 1, kRoomFull, kBadSecret, kTooManyRooms, kBadRequest };

inline constexpr size_t kCodeLength = 6;
inline constexpr size_t kMaxSecretLength = 32;
inline constexpr size_t kMaxPacket = 4096;
inline constexpr size_t kMaxRooms = 500;
inline constexpr size_t kMaxGuestsPerRoom = 100;
inline constexpr double kRoomGraceMs = 60000.0;   // una sala sin anfitrion espera tanto a que alguien la retome (migracion)
inline constexpr uint16_t kDefaultPort = 7770;

} // namespace Bazuko::Net::Relay
