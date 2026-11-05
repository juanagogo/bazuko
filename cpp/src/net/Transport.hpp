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
    uint64_t BytesSent() const { return m_BytesSent; }
    uint64_t BytesReceived() const { return m_BytesReceived; }

private:
    Host();
    struct Impl;
    std::unique_ptr<Impl> m_Impl;
    uint64_t m_BytesSent = 0, m_BytesReceived = 0;
};

double NowMs();   // reloj monotono en milisegundos

} // namespace Bazuko::Net
