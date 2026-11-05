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

#include <cstdint>
#include <optional>
#include <utility>
#include <vector>

namespace Bazuko::Net {

inline constexpr size_t kMaxEconomyEntries = 64;

struct EconomySnapshot {
    float money = 0.0f;
    bool bigSack = false;
    std::vector<std::pair<uint16_t, uint16_t>> items;   // (indice del objeto en GameData::items, cantidad), ordenado por indice, sin ceros
    bool operator==(const EconomySnapshot& other) const { return money == other.money && bigSack == other.bigSack && items == other.items; }
    bool operator!=(const EconomySnapshot& other) const { return !(*this == other); }
};
// Lo que el invitado cuenta (seq crece) y lo que el anfitrion contesta (ack = ultimo seq que proceso; `accepted` false = se revierte)
struct EconomyReport { uint16_t seq = 0; EconomySnapshot state; };
struct EconomySync { uint16_t ack = 0; bool accepted = true; EconomySnapshot state; };

inline constexpr float kMaxMoney = 1.0e7f;

void Write(BitWriter& w, const EconomyReport& m);
void Write(BitWriter& w, const EconomySync& m);
std::optional<EconomyReport> ReadEconomyReport(BitReader& r);
std::optional<EconomySync> ReadEconomySync(BitReader& r);

// Ordena, quita ceros y recorta: la forma canonica de comparar dos costales
EconomySnapshot Canonical(EconomySnapshot state, size_t itemCount);

class Ledger {
public:
    explicit Ledger(const GameData& data) : m_Data(&data) {}
    // El primer informe de un invitado fija su copia (el perfil se confia: aun no hay perfiles guardados en el anfitrion)
    // `nowSeconds` es cualquier reloj creciente (segundos).
    struct Verdict { bool accepted = false; EconomySnapshot authoritative; std::string reason; };
    Verdict Submit(const EconomySnapshot& claimed, double nowSeconds);
    const EconomySnapshot& State() const { return m_State; }
    bool Started() const { return m_Started; }

private:
    const GameData* m_Data;
    EconomySnapshot m_State;
    bool m_Started = false;
    double m_LastSeconds = 0.0;
    double m_LootTokens = 12.0;     // rafaga de 12 objetos, 1 por segundo
    double m_EarnTokens = 8000.0;   // premios del mundo: rafaga de 8000 y 100 por segundo (6000 por minuto)
};

// Lado del invitado: decide cuando contar su estado y cuando adoptar el del anfitrion (sin parpadeos mientras hay cambios sin confirmar)
class EconomyMirror {
public:
    // Devuelve el informe a enviar si el estado cambio (como mucho cada 100 ms) o aun no se ha enviado ninguno
    std::optional<EconomyReport> Poll(const EconomySnapshot& current, double nowSeconds);
    // Devuelve el estado a adoptar si el anfitrion lo corrige y el invitado no ha cambiado nada desde lo que envio
    std::optional<EconomySnapshot> OnSync(const EconomySync& sync, const EconomySnapshot& current);

private:
    EconomySnapshot m_LastSent;
    uint16_t m_Seq = 0;
    bool m_Sent = false;
    double m_LastSentSeconds = -1.0e9;
};

} // namespace Bazuko::Net
