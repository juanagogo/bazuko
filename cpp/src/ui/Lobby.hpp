#pragma once
// Lobby de carton: lo primero que se ve al abrir el juego, antes de cargar la ciudad (asi no suena la calle de fondo).
// Se elige el modo (Historia o Multijugador, en desarrollo), se ajustan sonido y calidad y se ve el perfil (en desarrollo).
// En Multijugador se abre una sala (en esta red o por internet, en un servidor de salas) o se entra a una de la lista.
#include <array>
#include <cstdint>
#include <filesystem>
#include <string>
#include <vector>

namespace Bazuko {

class Window;
class UIManager;
class AudioManager;

// Ajustes del equipo (no de la partida): se guardan en bazuko_ajustes.json junto al guardado.
struct LobbySettings {
    float volume = 1.0f;
    bool muted = false;
    std::array<float, 4> mix{1.0f, 1.0f, 1.0f, 1.0f};   // ambiente, trafico, voces, efectos (MixCategory)
    int quality = 1;                                     // 0 baja, 1 media, 2 alta
    std::string relay;                                   // servidor de salas que escribio el jugador; vacio = automatico (lista descargada)
    std::vector<std::string> relayCache;                 // ultima lista de servidores bajada: sirve sin internet al abrir
    bool ownServer = false;                              // este equipo aloja el servidor de salas: el juego lo levanta al abrir (core/OwnServer.hpp)
    std::string playitPath;                              // el agente de playit que abre el tunel ("" = solo el relevo)
    std::string roomName;
    bool roomInternet = false, roomPublic = true;
    int roomSize = 8;

    // Lee el archivo de ajustes; lo que falte sale del guardado (calidad) o queda por defecto.
    static LobbySettings Load(const std::filesystem::path& file, const std::filesystem::path& savegame);
    void Save(const std::filesystem::path& file) const;
    void ApplyAudio(AudioManager& audio) const;
    void ReadAudio(const AudioManager& audio);
};

struct LobbyChoice {
    enum class Mode { Quit, Story, HostLan, HostRelay, JoinAddress, JoinRoom };
    Mode mode = Mode::Quit;
    std::string roomName;   // anfitrion: nombre de la sala
    bool listed = true;     // anfitrion por internet: sale en la lista publica
    int maxPlayers = 8;
    std::string address;    // JoinAddress: IP[:puerto]; HostRelay y JoinRoom: el servidor de salas IP[:puerto]
    std::string code;       // JoinRoom: codigo de 6 caracteres
};

// Muestra el lobby hasta que se elige un modo o se cierra la ventana (Mode::Quit). Aplica el sonido al momento y deja la calidad en `settings`.
LobbyChoice RunLobby(Window& window, UIManager& ui, AudioManager& audio, LobbySettings& settings, const std::filesystem::path& savegame);

} // namespace Bazuko
