#pragma once
// Sesion de red del juego (solo con -DBAZUKO_NET=ON): un jugador ANFITRION que acepta a los demas, o un jugador que SE UNE a un anfitrion.
// Primera version del multijugador (hito 2): cada jugador simula su propio personaje en su propia ciudad y CUENTA su estado (posicion, rumbo,
// velocidad) al anfitrion; el anfitrion lo valida (mapa y velocidad plausibles) y lo reenvia a todos. Asi los jugadores se ven caminar entre ellos sin
// tocar la fisica del juego. El mundo (trafico, peatones) todavia NO es compartido: eso llega con el hito 3.
#include "Protocol.hpp"
#include "Transport.hpp"

#include <glm/glm.hpp>
#include <map>
#include <memory>
#include <string>
#include <vector>

namespace Bazuko::Net {

// Un jugador remoto tal como se dibuja (posicion suavizada)
struct RemotePlayer {
    uint8_t id = 0;
    std::string name;
    glm::vec3 position{0.0f};
    float yaw = 0.0f;
    float speed = 0.0f;
    bool knockedDown = false;
};

// Lo que este jugador cuenta de si mismo cada cuadro
struct LocalState {
    glm::vec3 position{0.0f};
    float yaw = 0.0f;
    glm::vec3 velocity{0.0f};
    bool knockedDown = false;
};

class NetSession {
public:
    enum class Role { Host, Client };

    static std::unique_ptr<NetSession> StartHost(uint16_t port, const std::string& name, size_t maxPlayers = kMaxPlayers);
    static std::unique_ptr<NetSession> Join(const std::string& address, uint16_t port, const std::string& name);

    // Atiende la red y avanza el suavizado; cada cuadro con el estado actual del jugador local. `dt` en segundos.
    void Update(float dt, const LocalState& local);

    Role GetRole() const { return m_Role; }
    bool Connected() const { return m_Role == Role::Host || m_Connected; }
    bool Rejected() const { return m_Rejected; }
    uint8_t LocalId() const { return m_LocalId; }
    uint16_t Port() const { return m_Host ? m_Host->Port() : 0; }
    const std::vector<RemotePlayer>& Remotes() const { return m_Remotes; }
    size_t PlayerCount() const { return m_Remotes.size() + 1; }
    // Avisos de entrada y salida para mostrar en pantalla (se vacian al leerlos)
    std::vector<std::string> ConsumeNotices();
    NetSession(const NetSession&) = delete;
    NetSession& operator=(const NetSession&) = delete;
    Host& Network() { return *m_Host; }

private:
    NetSession() = default;
    struct Peer {
        uint8_t id = 0;
        std::string name;
        PlayerSnapshot state;       // lo ultimo que conto
        double lastMs = 0.0;        // cuando llego
        bool hasState = false;
    };
    struct Smooth { RemotePlayer shown; PlayerSnapshot target; bool fresh = true; double lastHeardMs = 0.0; };

    void UpdateHost(float dt, const LocalState& local);
    void UpdateClient(float dt, const LocalState& local);
    void HandleHostMessage(const NetEvent& event);
    void HandleClientMessage(const NetEvent& event);
    void SmoothRemote(float dt);
    uint8_t FreeId() const;
    Snapshot BuildSnapshotFor(uint8_t viewerId, const glm::vec3& viewerPosition) const;

    Role m_Role = Role::Host;
    std::unique_ptr<Host> m_Host;
    std::string m_Name;
    uint32_t m_Server = 0;                 // cliente: la conexion con el anfitrion
    bool m_Connected = false, m_Rejected = false;
    uint8_t m_LocalId = 1;
    std::map<uint32_t, Peer> m_Peers;      // anfitrion: por conexion
    std::map<uint8_t, Smooth> m_Smooth;    // por id remoto
    std::vector<RemotePlayer> m_Remotes;
    std::vector<std::string> m_Notices;
    LocalState m_LastLocal;
    double m_SendAccumulator = 0.0;
    uint32_t m_Tick = 0;
    size_t m_MaxPlayers = kMaxPlayers;
};

} // namespace Bazuko::Net
