#pragma once
// Servidor de relevo (ver RelayProtocol.hpp). Una instancia atiende muchas salas; no sabe nada del juego. Se usa en `bazuko_relay` (programa aparte)
// y, en las pruebas, dentro del mismo proceso (llamando a Update() seguido).
#include <cstdint>
#include <memory>
#include <string>

namespace Bazuko::Net {

class RelayServer {
public:
    ~RelayServer();
    RelayServer(const RelayServer&) = delete;
    RelayServer& operator=(const RelayServer&) = delete;
    static std::unique_ptr<RelayServer> Create(uint16_t port);   // port 0 = el sistema elige
    uint16_t Port() const;
    void Update();                       // atiende la red; llamarlo muy seguido (cada pocos ms)
    size_t RoomCount() const;
    size_t GuestCount() const;           // invitados conectados en todas las salas
    uint64_t BytesRelayed() const;

private:
    RelayServer();
    struct Impl;
    std::unique_ptr<Impl> m_Impl;
};

} // namespace Bazuko::Net
