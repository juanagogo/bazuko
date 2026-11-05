#pragma once
// Sesion de red del juego (solo con -DBAZUKO_NET=ON): un jugador ANFITRION que acepta a los demas, o un jugador que SE UNE a un anfitrion.
// Primera version del multijugador (hito 2): cada jugador simula su propio personaje en su propia ciudad y CUENTA su estado (posicion, rumbo,
// velocidad) al anfitrion; el anfitrion lo valida (mapa y velocidad plausibles) y lo reenvia a todos. Asi los jugadores se ven caminar entre ellos sin
// tocar la fisica del juego. El mundo (trafico, peatones) todavia NO es compartido: eso llega con el hito 3.
#include "Protocol.hpp"
#include "Transport.hpp"
#include "EconomyLedger.hpp"
#include "Interaction.hpp"
#include "ProfileStore.hpp"
#include "WorldSnapshot.hpp"

#include <filesystem>
#include <functional>
#include <optional>

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
    static std::unique_ptr<NetSession> Join(const std::string& address, uint16_t port, const std::string& name, const std::string& key = {});

    // Atiende la red y avanza el suavizado; cada cuadro con el estado actual del jugador local. `dt` en segundos.
    void Update(float dt, const LocalState& local);

    Role GetRole() const { return m_Role; }
    bool Connected() const { return m_Role == Role::Host || m_Connected; }
    bool Rejected() const { return m_Rejected; }
    uint8_t LocalId() const { return m_LocalId; }
    uint16_t Port() const { return m_Host ? m_Host->Port() : 0; }
    const std::vector<RemotePlayer>& Remotes() const { return m_Remotes; }
    size_t PlayerCount() const { return m_Remotes.size() + 1; }
    // Mundo compartido: el anfitrion da una funcion que arma la instantanea para un observador; el invitado recibe la ultima (si hay una nueva)
    using WorldProvider = std::function<WorldSnapshot(const glm::vec3& viewer, uint32_t tick)>;
    void SetWorldProvider(WorldProvider provider) { m_WorldProvider = std::move(provider); }
    std::optional<WorldSnapshot> ConsumeWorld() { std::optional<WorldSnapshot> out; out.swap(m_PendingWorld); return out; }
    size_t LastWorldBytes() const { return m_LastWorldBytes; }
    // Combate (hito 4). El jugador local avisa de cada golpe con Strike(): si es anfitrion lo resuelve contra los demas jugadores; si es cliente se lo pide
    // al anfitrion, que valida alcance, frecuencia y dano. Lo que le llega a este jugador sale por ConsumeHits() (golpes de otros jugadores o de peatones del anfitrion).
    struct IncomingHit { int kind = 1; glm::vec3 from{0.0f, 0.0f, 1.0f}; };
    struct RemoteStrike { uint8_t attacker = 0; glm::vec3 position{0.0f}; StrikeCommand command; };
    void Strike(const StrikeCommand& command);
    void SendHit(uint8_t player, int kind, const glm::vec3& from);   // anfitrion: entrega un golpe (por ejemplo de un peaton) a ese jugador
    std::vector<IncomingHit> ConsumeHits() { std::vector<IncomingHit> out; out.swap(m_Hits); return out; }
    std::vector<RemoteStrike> ConsumeRemoteStrikes() { std::vector<RemoteStrike> out; out.swap(m_RemoteStrikes); return out; }   // anfitrion: golpes de otros al mundo (peatones, vehiculos)
    // Economia (hito 4): el anfitrion lleva una copia de la plata y el costal de cada invitado (net/EconomyLedger.hpp) y rechaza lo que no se explica con las reglas.
    // Anfitrion: SetEconomyData() activa la validacion (sin datos del juego se acepta todo). Invitado: SendEconomy() cuenta su estado; ConsumeEconomySync() trae la correccion.
    void SetEconomyData(const GameData* data) { m_EconomyData = data; }
    void SendEconomy(const EconomyReport& report);
    std::optional<EconomySync> ConsumeEconomySync() { std::optional<EconomySync> out; out.swap(m_PendingEconomy); return out; }
    size_t EconomyRejections() const { return m_EconomyRejections; }
    // Perfiles (anfitrion): con una carpeta, cada invitado con clave recupera su plata y su costal guardados aqui, y se guardan al salir y cada 30 s.
    // Sin carpeta no se guarda nada y la copia arranca de lo que el invitado cuente (con el limite de perfil nuevo).
    void SetProfileFolder(const std::filesystem::path& folder);   // y guarda ya los perfiles que traia el punto de control de un anfitrion anterior
    void SaveProfiles();   // se llama sola; el juego la llama tambien al cerrar
    ~NetSession();
    const Ledger* LedgerOf(uint8_t player) const;   // anfitrion: la copia de ese invitado (nullptr si no hay)
    // Migracion de anfitrion: si el anfitrion se va, el primero de la lista (menor id) abre la partida en el mismo puerto y los demas se reconectan a el;
    // si ese tampoco responde en unos segundos, el siguiente. `ConsumePromotion()` avisa UNA vez al jugador que pasa a ser anfitrion para que el juego
    // active su simulacion de mundo (el nuevo anfitrion tiene que volver a darle SetEconomyData/SetWorldProvider/SetProfileFolder).
    bool Migrating() const { return m_Migrating; }
    bool ConsumePromotion() { const bool p = m_Promoted; m_Promoted = false; return p; }
    uint32_t Epoch() const { return m_Epoch; }   // sube cada vez que este jugador entra a una partida nueva (reconexion o ascenso)
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
        double lastStrikeMs = -1.0e9;
        std::unique_ptr<Ledger> ledger;
        double lastRejectNoticeMs = -1.0e9;
        std::string key;
        bool profileSynced = false;
    };
    struct Smooth { RemotePlayer shown; PlayerSnapshot target; bool fresh = true; double lastHeardMs = 0.0; };

    void UpdateHost(float dt, const LocalState& local);
    void UpdateClient(float dt, const LocalState& local);
    void HandleHostMessage(const NetEvent& event);
    void HandleClientMessage(const NetEvent& event);
    void SmoothRemote(float dt);
    uint8_t FreeId() const;
    void ResolveStrike(uint8_t attacker, const glm::vec3& position, const StrikeCommand& command);
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
    double m_WorldAccumulator = 0.0;
    double m_LocalLastStrikeMs = -1.0e9;
    const GameData* m_EconomyData = nullptr;
    std::unique_ptr<ProfileStore> m_Profiles;
    double m_SaveAccumulator = 0.0;
    std::string m_Key;                      // invitado: su clave
    std::string m_JoinAddress;
    uint16_t m_JoinPort = 0;
    std::vector<RosterEntry> m_Roster;      // invitado: los demas jugadores segun el anfitrion, por id
    uint16_t m_RosterPort = 0;
    std::vector<CheckpointEntry> m_Checkpoint;   // invitado siguiente: la economia de todos
    std::map<std::string, EconomySnapshot> m_Seed;   // nuevo anfitrion: de donde arrancan las copias
    bool m_Migrating = false, m_Promoted = false, m_MigAttempt = false;
    size_t m_MigIndex = 0;
    double m_MigDeadlineMs = 0.0;
    uint8_t m_OldId = 0;
    uint32_t m_Epoch = 0;
    bool m_RosterDirty = true, m_CheckpointDirty = true;
    double m_RosterAccumulator = 0.0, m_CheckpointAccumulator = 0.0;
    void SavePeer(const Peer& peer);
    void SendRoster();
    void SendCheckpoint();
    void BeginMigration();
    void MigrationTick();
    void PromoteToHost();
    void StartLedger(Peer& peer);
    std::optional<EconomySync> m_PendingEconomy;
    size_t m_EconomyRejections = 0;
    std::vector<IncomingHit> m_Hits;
    std::vector<RemoteStrike> m_RemoteStrikes;
    WorldProvider m_WorldProvider;
    std::optional<WorldSnapshot> m_PendingWorld;
    size_t m_LastWorldBytes = 0;
    uint32_t m_Tick = 0;
    size_t m_MaxPlayers = kMaxPlayers;
};

} // namespace Bazuko::Net
