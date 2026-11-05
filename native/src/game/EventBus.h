#pragma once

#include <string>
#include <utility>
#include <variant>
#include <vector>

namespace bazuko {

// Eventos de gameplay. La lógica los emite y la UI/audio los consumen por frame
// (sustituye a los CustomEvent sobre window del juego web).
struct EvWithdrawal { bool active; };
struct EvLevelUp { int level; };
struct EvDisease { std::string name, emoji; };
struct EvDiseaseCured { std::string name; };
struct EvCraft { std::string name; int qty; };
struct EvTalentUnlock { std::string name; };
struct EvSleepStart {};
struct EvSleepEnd { int hours; };
struct EvSleepFail { std::string reason; };
struct EvToast { std::string text, type; };  // type: info, warn, rare, sell, death
struct EvDeath {};
// Sonidos y acciones
struct EvSound { std::string name; };
struct EvPlayerAction { std::string name; double seconds; };  // animación breve del jugador
// Cosecha, robo y comercio
struct EvPickup { std::vector<std::string> added; bool rare; bool sorted; };
struct EvSteal { std::vector<std::string> added; bool caught; };
struct EvStealCaught {};
struct EvSell { int earned; };
struct EvSubstanceSell { int earned; };
struct EvSubstanceFail { std::string reason; };
struct EvSubstanceBuy { std::string name; int cost; };
struct EvSubstanceBuyFail { std::string reason; int cost; };
struct EvBegResult { bool success; std::string reason, item, message; int money; bool rare; };
struct EvBegCooldown { int waitSec; };
struct EvBegFail { std::string reason; };
// Aperturas de menús
struct EvOpenRecycler {};
struct EvOpenShop { int vendor; };  // -1 = la tienda La Esquinita; si no, índice del vendedor ambulante
struct EvOpenCambuche {};
struct EvOpenCrafting {};
struct EvDealerToggle {};

using GameEvent = std::variant<EvWithdrawal, EvLevelUp, EvDisease, EvDiseaseCured, EvCraft,
                               EvTalentUnlock, EvSleepStart, EvSleepEnd, EvSleepFail, EvToast, EvDeath, EvSound,
                               EvPlayerAction, EvPickup, EvSteal, EvStealCaught, EvSell, EvSubstanceSell, EvSubstanceFail,
                               EvSubstanceBuy, EvSubstanceBuyFail, EvBegResult, EvBegCooldown, EvBegFail, EvOpenRecycler,
                               EvOpenShop, EvOpenCambuche, EvOpenCrafting, EvDealerToggle>;

class EventBus {
public:
    void emit(GameEvent e) { queue_.push_back(std::move(e)); }
    // Entrega y vacía los eventos pendientes, en orden de emisión.
    std::vector<GameEvent> drain() { return std::exchange(queue_, {}); }
    bool empty() const { return queue_.empty(); }

private:
    std::vector<GameEvent> queue_;
};

}  // namespace bazuko
