#include "game/UiText.h"

#include <algorithm>
#include <cmath>
#include <cstdio>

#include "game/Money.h"

namespace bazuko {

namespace {

std::string join(const std::vector<std::string>& v, const char* sep) {
    std::string out;
    for (size_t i = 0; i < v.size(); ++i) out += (i ? sep : "") + v[i];
    return out;
}

}  // namespace

std::optional<ToastMsg> toastFor(const GameEvent& ev) {
    auto msg = [](std::string t, const char* type = "info") { return std::optional<ToastMsg>(ToastMsg{std::move(t), type}); };
    if (const auto* e = std::get_if<EvToast>(&ev)) return msg(e->text, e->type.c_str());
    if (const auto* e = std::get_if<EvPickup>(&ev)) {
        if (e->added.empty()) return std::nullopt;
        return msg(std::string(e->sorted ? "🔍 " : "") + "+ " + join(e->added, ", "), e->rare ? "rare" : "info");
    }
    if (const auto* e = std::get_if<EvSell>(&ev)) return msg("💰 Vendido por " + cop(e->earned), "sell");
    if (const auto* e = std::get_if<EvDisease>(&ev)) return msg("☠️ Enfermedad: " + e->name, "death");
    if (const auto* e = std::get_if<EvDiseaseCured>(&ev)) return msg("✨ Curado: " + e->name);
    if (const auto* e = std::get_if<EvLevelUp>(&ev)) return msg("⭐ ¡Nivel " + std::to_string(e->level) + "! +1 punto de talento", "rare");
    if (const auto* e = std::get_if<EvTalentUnlock>(&ev)) return msg("🌟 Talento: " + e->name, "rare");
    if (const auto* e = std::get_if<EvCraft>(&ev)) return msg("🔨 Crafteado: " + e->name + " x" + std::to_string(e->qty));
    if (const auto* e = std::get_if<EvSteal>(&ev)) {
        if (e->caught) return msg("🚨 ¡Atrapado robando!", "death");
        if (!e->added.empty()) return msg("🪞 Robado: " + join(e->added, ", "), "warn");
        return std::nullopt;
    }
    if (const auto* e = std::get_if<EvWithdrawal>(&ev))
        return e->active ? msg("🚬 Abstinencia: caminas más lento y baja el ánimo", "warn") : msg("😮‍💨 Se te calmó la ansiedad");
    if (const auto* e = std::get_if<EvSubstanceSell>(&ev)) return msg("💰 Sustancias vendidas: " + cop(e->earned), "sell");
    if (const auto* e = std::get_if<EvSubstanceBuy>(&ev)) return msg("📦 Comprado: " + e->name + " (-" + cop(e->cost) + ")");
    if (const auto* e = std::get_if<EvSubstanceFail>(&ev)) {
        if (e->reason == "day") return msg("☀️ El dealer no compra de día (1.8x de noche)", "warn");
        return std::nullopt;
    }
    if (const auto* e = std::get_if<EvSubstanceBuyFail>(&ev)) {
        if (e->reason == "insufficient_money") return msg("💸 No tienes suficiente dinero (" + cop(e->cost) + ")", "warn");
        if (e->reason == "inventory_full") return msg("🎒 Inventario lleno", "warn");
        return msg("❌ No se pudo comprar", "warn");
    }
    if (const auto* e = std::get_if<EvBegResult>(&ev)) return msg(e->message, e->success ? (e->rare ? "rare" : "sell") : "warn");
    if (const auto* e = std::get_if<EvBegCooldown>(&ev)) return msg("⏳ Espera " + std::to_string(e->waitSec) + "s antes de pedir limosna");
    if (std::holds_alternative<EvBegFail>(ev)) return msg("😴 Demasiado cansado para pedir limosna (-3 energía necesaria)", "warn");
    if (std::holds_alternative<EvSleepStart>(ev)) return msg("💤 Durmiendo...");
    if (const auto* e = std::get_if<EvSleepEnd>(&ev)) return msg("🌅 Dormiste " + std::to_string(e->hours) + " h · Partida guardada");
    if (const auto* e = std::get_if<EvSleepFail>(&ev))
        return msg(e->reason == "nobase" ? "📦 Primero arma la base del cambuche (8 cartones)" : "No puedes dormir aquí", "warn");
    if (std::holds_alternative<EvDeath>(ev)) return msg("💀 Moriste. Pierdes la mitad de tus cosas.", "death");
    return std::nullopt;
}

std::string stripUnsupported(const std::string& s) {
    std::string out;
    size_t i = 0;
    while (i < s.size()) {
        const unsigned char c = static_cast<unsigned char>(s[i]);
        size_t len = c < 0x80 ? 1 : (c >> 5) == 6 ? 2 : (c >> 4) == 14 ? 3 : (c >> 3) == 30 ? 4 : 1;
        if (i + len > s.size()) break;
        unsigned cp = len == 1 ? c : c & (0xFF >> (len + 1));
        for (size_t k = 1; k < len; ++k) cp = (cp << 6) | (static_cast<unsigned char>(s[i + k]) & 0x3F);
        // Latin-1 (con acentos, ¡ ¿ ·) y puntuación general (— – ‘ ’ “ ” …)
        if (cp < 0x2028 && !(cp >= 0x80 && cp < 0xA0) && !(cp >= 0x0100 && cp < 0x2010)) out.append(s, i, len);
        i += len;
    }
    // Espacios dobles por los emoji quitados y bordes.
    std::string clean;
    for (char ch : out) {
        if (ch == ' ' && (clean.empty() || clean.back() == ' ')) continue;
        clean.push_back(ch);
    }
    while (!clean.empty() && clean.back() == ' ') clean.pop_back();
    return clean;
}

void ToastQueue::add(const ToastMsg& m) {
    items_.push_back({m, 0});
    if (items_.size() > kMax) items_.erase(items_.begin());
}

void ToastQueue::update(double dt) {
    for (Item& i : items_) i.age += dt;
    items_.erase(std::remove_if(items_.begin(), items_.end(), [](const Item& i) { return i.age >= kLifetime; }), items_.end());
}

double ToastQueue::alpha(const Item& i) {
    const double in = std::min(1.0, i.age / 0.12);
    const double out = std::min(1.0, (kLifetime - i.age) / 0.4);
    return std::clamp(std::min(in, out), 0.0, 1.0);
}

std::string promptFor(const Target& target, const Bogota& city) {
    switch (target.type) {
        case TargetType::Pickup: return "[E] Recoger basura · [Mantener Q] Seleccionar";
        case TargetType::Car: return "[E] Robar retrovisor de auto";
        case TargetType::Recycler: return "[E] Recicladora El Progreso · Vender material";
        case TargetType::Shop: return "[E] Tienda La Esquinita · Comprar";
        case TargetType::Vendor: {
            const auto& vs = city.vendors();
            const std::string title = target.index >= 0 && target.index < static_cast<int>(vs.size()) ? vs[target.index].title : "Vendedor";
            return "[E] " + title + " · Comprar";
        }
        case TargetType::Cambuche: return "[E] Tu cambuche · Armar / Dormir";
        case TargetType::Dealer: return "[Q / E] Tienda del Dealer · Comprar / Vender";
        case TargetType::Craft: return "[E] Mesa de crafteo";
        case TargetType::None: break;
    }
    return {};
}

std::string clockText(int day, double hour) {
    char buf[48];
    std::snprintf(buf, sizeof buf, "Día %d — %02d:%02d", day, static_cast<int>(hour), static_cast<int>((hour - std::floor(hour)) * 60));
    return buf;
}

double xpFraction(const GameState& s) {
    const double needed = s.data.c("XP_PER_LEVEL") * s.stats.level;
    return needed > 0 ? std::clamp(s.stats.xp / needed, 0.0, 1.0) : 0;
}

std::vector<std::string> statusWarnings(const StatsSystem& st) {
    std::vector<std::string> w;
    if (st.sed <= 20) w.push_back(st.sed <= 0 ? "Sin agua: estás perdiendo salud." : "Sed crítica: bebe agua.");
    if (st.hambre <= 20) w.push_back(st.hambre <= 0 ? "Sin alimento: estás perdiendo salud." : "Hambre crítica: come algo.");
    if (st.energia <= 20) w.push_back("Energía baja: descansa.");
    if (st.salud <= 30) w.push_back("Salud crítica: necesitas recuperarte.");
    return w;
}

std::string dealerEffect(const ItemDef& it) {
    auto num = [](double v) {
        char b[24];
        std::snprintf(b, sizeof b, "%g", v);
        return std::string(b);
    };
    std::string out;
    if (it.id == "tintico") out = "+" + num(it.amount) + " vicio, +" + num(it.animo) + " ánimo, +" + num(it.energia) + " energía";
    else out = "+" + num(it.amount) + " vicio, +" + num(it.animo) + " ánimo, " + num(it.salud) + " salud";
    return out + " · Peso: " + num(it.weight) + "kg";
}

}  // namespace bazuko
