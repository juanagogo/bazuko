#pragma once
// Transporte UDP sobre ENet (solo se compila con -DBAZUKO_NET=ON). Un `Host` es un servidor (acepta clientes) o un cliente (una conexion).
// Entrega eventos de conexion, desconexion y mensajes ya como bytes; no interpreta nada del protocolo.
// Con una simulacion de red activa (SetSimulation), los paquetes NO fiables salen con latencia, jitter, perdida y duplicados; los fiables solo con latencia.
#include "NetSim.hpp"

#include <cstdint>
#include <memory>
#include <string>
#include <vector>

namespace Bazuko::Net {

struct NetEvent {
    enum class Type { Connected, Disconnected, Message } type = Type::Message;
    uint32_t peer = 0;     // identificador de la conexion (en un cliente, siempre el del servidor)
    int channel = 0;
    std::vector<uint8_t> data;
};

class Host {
public:
    ~Host();
    Host(const Host&) = delete;
    Host& operator=(const Host&) = delete;

    static std::unique_ptr<Host> CreateServer(uint16_t port, size_t maxClients);   // port 0 = el sistema elige uno libre (ver Port())
    static std::unique_ptr<Host> CreateClient();
    // Por internet sin abrir puertos (ver RelayProtocol.hpp): el anfitrion crea una sala en el servidor de relevo (o retoma una con su codigo y secreto);
    // los invitados entran por su codigo. Para el resto del codigo se comportan igual que un servidor y un cliente directos (mismos eventos).
    // `wantedCode`: al crear, el codigo que eligio el jugador (vacio = el relevo pone uno al azar).
    static std::unique_ptr<Host> CreateRelayHost(const std::string& relayAddress, uint16_t relayPort, const std::string& roomCode = {}, const std::string& roomSecret = {},
                                                 const std::string& wantedCode = {});
    static std::unique_ptr<Host> CreateRelayGuest(const std::string& relayAddress, uint16_t relayPort, const std::string& roomCode);
    bool IsRelay() const;
    const std::string& RoomCode() const;     // anfitrion: vacio hasta que el relevo asigna la sala
    const std::string& RoomSecret() const;   // anfitrion: para que otro jugador pueda retomar la sala
    bool RoomFailed() const;                 // anfitrion: el relevo no pudo crear o retomar la sala (o se cayo)
    uint8_t RoomError() const;               // anfitrion: la razon que dio el relevo (Relay::ErrorCode); 0 si no dio ninguna
    void CloseRoom();                        // anfitrion por relevo: cierra la sala a proposito (su codigo queda libre de una vez)
    // anfitrion por relevo: nombre, si sale en la lista publica de salas y el cupo; se manda al abrir la sala (y ya, si esta abierta)
    void SetRoomInfo(const std::string& name, bool listed, uint8_t maxPlayers);
    uint16_t Port() const;

    // Cliente: abre la conexion (el evento Connected llega por Poll). Devuelve false si no se pudo preparar.
    bool Connect(const std::string& address, uint16_t port);
    // Atiende la red y devuelve un evento si hay (false si no). Debe llamarse con frecuencia.
    bool Poll(NetEvent& event);
    void Send(uint32_t peer, int channel, const std::vector<uint8_t>& data, bool reliable);
    void Disconnect(uint32_t peer);
    uint32_t RoundTripMs(uint32_t peer) const;
    std::string PeerAddress(uint32_t peer) const;   // la IP con la que se ve a esa conexion (cadena vacia si no existe)
    size_t PeerCount() const;

    void SetSimulation(const NetSimConfig& config, uint32_t seed);
    void FreezeForTests();   // pruebas: deja de atender la red del todo, sin despedirse (como un proceso muerto o un apagon)
    uint64_t BytesSent() const { return m_BytesSent; }
    uint64_t BytesReceived() const { return m_BytesReceived; }

private:
    Host();
    struct Impl;
    std::unique_ptr<Impl> m_Impl;
    uint64_t m_BytesSent = 0, m_BytesReceived = 0;
};

// Socket UDP suelto para el sondeo de alcance entre jugadores en modo directo (NetSession): ¿me puede llegar un paquete al puerto de la partida?
// No bloquea. `Open(0)` toma cualquier puerto libre (el anfitrion, que solo pregunta).
class ProbeSocket {
public:
    ~ProbeSocket();
    ProbeSocket(const ProbeSocket&) = delete;
    ProbeSocket& operator=(const ProbeSocket&) = delete;
    static std::unique_ptr<ProbeSocket> Open(uint16_t port);   // nullptr si el puerto esta ocupado
    void SendTo(const std::string& ip, uint16_t port, const std::vector<uint8_t>& data);
    bool Receive(std::vector<uint8_t>& data, std::string& ip, uint16_t& port);   // false si no hay nada
private:
    ProbeSocket();
    struct Impl;
    std::unique_ptr<Impl> m_Impl;
};

double NowMs();   // reloj monotono en milisegundos

} // namespace Bazuko::Net
