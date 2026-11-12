#pragma once
// Protocolo del relevo (relay): para jugar por internet sin abrir puertos. Todos los jugadores se conectan HACIA AFUERA a un servidor de relevo
// (un programa pequeno, `bazuko_relay`, que corre en cualquier maquina con IP publica) y este reenvia los paquetes entre el anfitrion y sus invitados
// por salas con un codigo corto. El relevo no entiende el juego: solo reenvia bytes. Cada tramo (jugador-relevo) es un ENet normal.
//
//   jugador -> relevo : Create{secreto} | Reclaim{codigo, secreto} | Join{codigo} | Data{canal, fiable, bytes}   (el invitado habla siempre al anfitrion)
//   relevo -> jugador : Created{codigo} | Joined | Error{razon} | Data{canal, fiable, bytes}
//   anfitrion -> relevo : HostData{vid, canal, fiable, bytes} | Kick{vid}
//   relevo -> anfitrion : GuestJoined{vid} | GuestLeft{vid} | GuestData{vid, canal, fiable, bytes}
//   anfitrion -> relevo : RoomInfo{publica, cupo, largo, nombre}   (una sala publica aparece en la lista de salas del lobby)
//   cualquiera -> relevo : List  ->  RoomList{n, n x (codigo, jugadores, cupo, largo, nombre)}   (solo salas publicas con anfitrion)
#include <cstdint>
#include <string>

namespace Bazuko::Net::Relay {

enum Op : uint8_t {
    // jugador -> relevo
    kCreate = 0x01, kReclaim = 0x02, kJoin = 0x03, kList = 0x04, kGuestSend = 0x22,
    // anfitrion -> relevo
    kHostSend = 0x12, kKick = 0x13, kRoomInfo = 0x14,
    // relevo -> jugador
    kCreated = 0x81, kJoined = 0x83, kRoomList = 0x84, kError = 0x8F, kToGuest = 0xA2,
    // relevo -> anfitrion
    kGuestJoined = 0x90, kGuestLeft = 0x91, kFromGuest = 0x92,
};
enum ErrorCode : uint8_t { kNoRoom = 1, kRoomFull, kBadSecret, kTooManyRooms, kBadRequest };

inline constexpr size_t kCodeLength = 6;
inline constexpr size_t kMaxSecretLength = 32;
inline constexpr size_t kMaxPacket = 4096;
inline constexpr size_t kMaxRooms = 500;
inline constexpr size_t kMaxGuestsPerRoom = 100;
// Plazo para dar por caida una conexion ya establecida que no contesta (ENet): entre 4 y 8 s. Si el anfitrion se cierra a la fuerza o se cae el equipo,
// los demas lo notan en ese tiempo y empieza la migracion. Un juego trabado (cuadro largo, ventana arrastrada) no cuenta como caido: su hilo de red
// sigue contestando hasta kKeepAliveMs (ver Transport.cpp). Mientras se conecta el plazo es el de siempre (hasta 30 s), por si el otro aun esta cargando.
inline constexpr uint32_t kPeerTimeoutMinMs = 4000, kPeerTimeoutMaxMs = 8000;
inline constexpr uint32_t kConnectTimeoutMinMs = 5000, kConnectTimeoutMaxMs = 30000;
inline constexpr double kKeepAliveMs = 30000.0;
inline constexpr double kRoomGraceMs = 60000.0;   // una sala sin anfitrion espera tanto a que alguien la retome (migracion)
inline constexpr uint16_t kDefaultPort = 7770;
inline constexpr size_t kMaxRoomName = 32;      // bytes UTF-8 del nombre de una sala
inline constexpr size_t kMaxListedRooms = 80;   // salas por respuesta de la lista

} // namespace Bazuko::Net::Relay
