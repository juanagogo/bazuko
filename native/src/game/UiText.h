#pragma once

#include <optional>
#include <string>
#include <vector>

#include "game/EventBus.h"
#include "game/GameState.h"
#include "game/Interaction.h"
#include "world/Bogota.h"

namespace bazuko {

// Textos y reglas de la interfaz que no dependen de ImGui (HUD.js): avisos por evento, prompts de interacción,
// reloj, XP y advertencias de necesidades. La app solo los dibuja.

struct ToastMsg {
    std::string text, type;  // type: info, warn, rare, sell, death
};

// Aviso que corresponde a un evento del juego (nada si el evento no genera aviso).
std::optional<ToastMsg> toastFor(const GameEvent& ev);

// Quita lo que la fuente de la interfaz no puede dibujar (emoji y símbolos fuera de Latin-1 y la puntuación
// general) y recorta los espacios sobrantes.
std::string stripUnsupported(const std::string& utf8);

// Pila de avisos: los más nuevos al final; cada uno dura 2,5 s y hay como máximo 6 a la vez.
class ToastQueue {
public:
    static constexpr double kLifetime = 2.5;
    static constexpr size_t kMax = 6;
    struct Item {
        ToastMsg msg;
        double age = 0;
    };
    void add(const ToastMsg& m);
    void update(double dt);
    const std::vector<Item>& items() const { return items_; }
    // 0..1: aparece rápido y se desvanece en los últimos 0,4 s.
    static double alpha(const Item& i);

private:
    std::vector<Item> items_;
};

// Texto del cartel de interacción para el objetivo actual (vacío si no hay).
std::string promptFor(const Target& target, const Bogota& city);

std::string clockText(int day, double hour);  // "Día 3 — 07:05"
double xpFraction(const GameState& s);        // 0..1 hacia el siguiente nivel
// Avisos de necesidades críticas (sed, hambre, energía, salud).
std::vector<std::string> statusWarnings(const StatsSystem& stats);

// "+25 hambre · +5 ánimo" de un producto del dealer con su peso, como en el panel del dealer.
std::string dealerEffect(const ItemDef& it);

}  // namespace bazuko
