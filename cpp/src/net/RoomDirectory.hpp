#pragma once
// Lista de salas para el lobby. Una sala se ve de dos maneras:
//  - Por internet: el anfitrion la abre en un servidor de relevo (bazuko_relay) como publica y el relevo la da en su lista (Relay::kList).
//  - En la misma red (LAN): el anfitrion directo deja una baliza (LanBeacon) que responde a una pregunta por difusion UDP en el puerto kLanDiscoveryPort.
// RoomBrowser junta las dos listas; no bloquea: se llama Update() en cada cuadro del lobby.
//
//   pregunta (UDP)  : "BZK?" version
//   respuesta (UDP) : "BZK!" version, puerto del juego (2 bytes), jugadores, cupo, largo, nombre
#include <cstdint>
#include <memory>
#include <string>
#include <utility>
#include <vector>

namespace Bazuko::Net {

inline constexpr uint16_t kLanDiscoveryPort = 7779;

struct RoomListing {
    std::string name;
    std::string code;      // por relevo: codigo de 6 caracteres (vacio en LAN)
    std::string address;   // LAN: IP del anfitrion; por relevo: el relevo
    uint16_t port = 0;     // LAN: puerto del juego; por relevo: el del relevo
    int players = 0, maxPlayers = 0;
    bool lan = false;
    bool locked = false;   // por relevo: sala con codigo; sale en la lista sin el codigo (`code` vacio) y para entrar hay que escribirlo
};

class LanBeacon {
public:
    ~LanBeacon();
    LanBeacon(const LanBeacon&) = delete;
    LanBeacon& operator=(const LanBeacon&) = delete;
    // nullptr si el puerto de descubrimiento no se pudo abrir (la partida sigue; solo no sale en la lista de la red local)
    static std::unique_ptr<LanBeacon> Create(uint16_t gamePort, const std::string& name, uint8_t maxPlayers, uint16_t discoveryPort = kLanDiscoveryPort);
    void Update(size_t players);   // responde a las preguntas pendientes; llamarlo en cada cuadro

private:
    LanBeacon() = default;
    struct Impl;
    std::unique_ptr<Impl> m_Impl;
};

class RoomBrowser {
public:
    enum class RelayState { Off, Connecting, Online, Failed };
    explicit RoomBrowser(uint16_t discoveryPort = kLanDiscoveryPort);
    ~RoomBrowser();
    RoomBrowser(const RoomBrowser&) = delete;
    RoomBrowser& operator=(const RoomBrowser&) = delete;
    void SetRelay(const std::string& address, uint16_t port);   // direccion vacia: solo red local
    void SetRelays(const std::vector<std::pair<std::string, uint16_t>>& relays);   // varios servidores de salas: se juntan sus listas
    void Update();    // atiende la red y vuelve a preguntar cada pocos segundos
    void Refresh();   // pregunta ya
    std::vector<RoomListing> Rooms() const;   // primero la red local, luego internet
    RelayState GetRelayState() const;   // del conjunto: conectado si alguno responde
    std::string OnlineRelay() const;    // "host:puerto" del primer servidor que responde (donde se abre una sala nueva); vacio si ninguno
    // Revisa si existe una sala con `code` en el servidor `relay` ("host:puerto", uno de la lista). CodeCheck: 1 existe, 0 no existe,
    // -1 aun sin respuesta (o ese servidor no responde, o es un relevo anterior que no sabe revisar codigos).
    void CheckCode(const std::string& relay, const std::string& code);
    int CodeCheck(const std::string& relay, const std::string& code) const;

private:
    struct Impl;
    std::unique_ptr<Impl> m_Impl;
};

// "nombre de sala": sin caracteres de control y a lo sumo `maxBytes` bytes sin partir una letra UTF-8
std::string CleanRoomName(const std::string& name, size_t maxBytes);

} // namespace Bazuko::Net
