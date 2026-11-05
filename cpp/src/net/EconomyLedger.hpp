#pragma once
// Economia en el anfitrion (hito 4): el anfitrion guarda una COPIA de la plata y el costal de cada invitado y solo acepta los cambios que se
// explican con las reglas del juego. El invitado sigue jugando con su propio estado (sin esperas) y le cuenta al anfitrion como queda; el anfitrion
// calcula la diferencia contra su copia y la clasifica:
//   - lo que se QUITA tiene que existir en la copia (no se vende lo que no se tiene);
//   - plata que SUBE se explica por vender (hasta 2,5 veces el valor de lo quitado en el mismo cambio); el resto, por premios del mundo (robo, misiones) con un tope por minuto;
//   - objetos que SUBEN se explican por una receta (con sus ingredientes quitados), por una compra (la plata que baja alcanza el precio de la tienda) o,
//     el resto, por botin del mundo con un tope de ritmo (rafaga de 12 y 1 por segundo);
//   - la mejora del costal exige la plata de la tienda.
// Si algo no se explica, el anfitrion NO acepta, se queda con su copia y la devuelve: el invitado la adopta y la trampa se revierte.
// No depende de red ni de OpenGL: solo de las reglas de game/Economy y los datos del juego.
#include "BitStream.hpp"
#include "Protocol.hpp"
#include "game/GameData.hpp"

#include <nlohmann/json.hpp>

#include <array>
#include <cstdint>
#include <string>
#include <optional>
#include <utility>
#include <vector>

namespace Bazuko::Net {

inline constexpr size_t kMaxEconomyEntries = 64;

struct EconomySnapshot {
    float money = 0.0f;
    bool bigSack = false;
    std::vector<std::pair<uint16_t, uint16_t>> items;   // (indice del objeto en GameData::items, cantidad), ordenado por indice, sin ceros
    // Progreso del personaje (se guarda en el perfil junto con la plata y el costal)
    int xp = 0;            // dentro del nivel actual: 0 .. 100 * nivel - 1
    int level = 1;
    int talentPoints = 0;
    std::vector<std::string> talents;   // desbloqueados, ordenados
    std::array<uint8_t, 7> needs{100, 100, 100, 100, 100, 100, 80};   // 0..100 (salud, hambre, sed...): solo se recuperan al volver con el perfil, no se validan
    bool operator==(const EconomySnapshot& other) const { return money == other.money && bigSack == other.bigSack && items == other.items && SameProgress(other) && needs == other.needs; }
    bool operator!=(const EconomySnapshot& other) const { return !(*this == other); }
    bool SameProgress(const EconomySnapshot& other) const { return xp == other.xp && level == other.level && talentPoints == other.talentPoints && talents == other.talents; }
};
// Igual para decidir si hay algo nuevo que contar: ignora las necesidades (cambian a cada rato)
inline bool SameForSync(const EconomySnapshot& a, const EconomySnapshot& b) { return a.money == b.money && a.bigSack == b.bigSack && a.items == b.items && a.SameProgress(b); }
// Experiencia total acumulada: cada nivel cuesta 100 x nivel (game/Economy.cpp AwardXp)
inline long long TotalXp(int level, int xp) { return 50LL * level * (level - 1) + xp; }
// Lo que el invitado cuenta (seq crece) y lo que el anfitrion contesta (ack = ultimo seq que proceso; `accepted` false = se revierte)
struct EconomyReport { uint16_t seq = 0; EconomySnapshot state; };
struct EconomySync { uint16_t ack = 0; bool accepted = true; EconomySnapshot state; bool profile = false; };   // profile: es el perfil guardado en este anfitrion, no una correccion

inline constexpr float kMaxMoney = 1.0e7f;

// Migracion de anfitrion: el anfitrion reparte la lista de jugadores (para saber a quien le toca ser el siguiente y donde esta) y le manda al siguiente
// un punto de control con la economia de todos, para que el nuevo anfitrion no los trate como perfiles nuevos.
struct RosterEntry { uint8_t id = 0; std::string ip; };
struct Roster { uint16_t port = 0; std::vector<RosterEntry> entries; };   // ordenada por id: el primero es el siguiente anfitrion
struct CheckpointEntry { std::string key; EconomySnapshot state; };
struct Checkpoint { std::vector<CheckpointEntry> entries; };
void Write(BitWriter& w, const Roster& m);
void Write(BitWriter& w, const Checkpoint& m);
std::optional<Roster> ReadRoster(BitReader& r);
std::optional<Checkpoint> ReadCheckpoint(BitReader& r);

void Write(BitWriter& w, const EconomyReport& m);
void Write(BitWriter& w, const EconomySync& m);
std::optional<EconomyReport> ReadEconomyReport(BitReader& r);
std::optional<EconomySync> ReadEconomySync(BitReader& r);

// Ordena, quita ceros y recorta: la forma canonica de comparar dos costales
EconomySnapshot Canonical(EconomySnapshot state, size_t itemCount);

// Un perfil NUEVO (clave que este anfitrion no conoce) arranca con lo que el jugador trae, pero recortado a esto: un perfil de verdad se gana jugando aqui.
// Es una decision de diseno ajustable; `Unlimited()` lo desactiva (pruebas, o un anfitrion de confianza).
struct LedgerLimits {
    float startMoney = 50000.0f;
    int startItems = 60;   // unidades en total
    int startLevel = 20;   // un perfil nuevo no entra por encima de este nivel (sin talentos desbloqueados: se reparten de nuevo)
    static LedgerLimits Unlimited() { return {kMaxMoney, 1000000, 100}; }
};

class Ledger {
public:
    explicit Ledger(const GameData& data, LedgerLimits limits = {}) : m_Data(&data), m_Limits(limits) {}
    const GameData& Data() const { return *m_Data; }
    // Siembra la copia desde un punto de control (migracion): arranca de ahi, pero el primer informe del jugador se valida como cualquier otro cambio
    void Seed(const EconomySnapshot& state, double nowSeconds) { m_State = Canonical(state, m_Data->items.size()); m_Started = true; m_LastSeconds = nowSeconds; }
    // Fija la copia desde un perfil guardado en este anfitrion (ya saneado): manda sobre lo que traiga el invitado
    void Adopt(const EconomySnapshot& state, double nowSeconds) { m_State = Canonical(state, m_Data->items.size()); m_Started = true; m_FromProfile = true; m_LastSeconds = nowSeconds; }
    bool FromProfile() const { return m_FromProfile; }
    // El primer informe de un invitado fija su copia (el perfil se confia: aun no hay perfiles guardados en el anfitrion)
    // `nowSeconds` es cualquier reloj creciente (segundos).
    struct Verdict { bool accepted = false; EconomySnapshot authoritative; std::string reason; };
    Verdict Submit(const EconomySnapshot& claimed, double nowSeconds);
    const EconomySnapshot& State() const { return m_State; }
    bool Started() const { return m_Started; }

private:
    bool ProgressPlausible(const EconomySnapshot& s) const;
    const GameData* m_Data;
    EconomySnapshot m_State;
    LedgerLimits m_Limits;
    bool m_FromProfile = false;
    bool m_Started = false;
    double m_LastSeconds = 0.0;
    double m_LootTokens = 12.0;     // rafaga de 12 objetos, 1 por segundo
    double m_EarnTokens = 8000.0;
    double m_XpTokens = 1500.0;     // experiencia: rafaga de 1500 y 40 por segundo (2400 por minuto)   // premios del mundo: rafaga de 8000 y 100 por segundo (6000 por minuto)
};

// Perfil guardado <-> copia de economia (el guardado usa los mismos nombres del savegame.json del juego: money, bigSack, inventory [{item, quantity}])
EconomySnapshot EconomyFromSave(const nlohmann::json& save, size_t itemCount);
void ApplyEconomyToSave(nlohmann::json& save, const EconomySnapshot& state);

// Lado del invitado: decide cuando contar su estado y cuando adoptar el del anfitrion (sin parpadeos mientras hay cambios sin confirmar)
class EconomyMirror {
public:
    // Devuelve el informe a enviar si el estado cambio (como mucho cada 100 ms) o aun no se ha enviado ninguno
    std::optional<EconomyReport> Poll(const EconomySnapshot& current, double nowSeconds);
    // Devuelve el estado a adoptar si el anfitrion lo corrige y el invitado no ha cambiado nada desde lo que envio
    std::optional<EconomySnapshot> OnSync(const EconomySync& sync, const EconomySnapshot& current);
    void Restart() { m_Sent = false; }   // tras reconectar con otro anfitrion: vuelve a contar el estado completo

private:
    EconomySnapshot m_LastSent;
    uint16_t m_Seq = 0;
    bool m_Sent = false;
    double m_LastSentSeconds = -1.0e9;
};

} // namespace Bazuko::Net
