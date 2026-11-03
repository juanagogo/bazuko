#include <doctest/doctest.h>

#include "game/UiText.h"
#include "test_util.h"

using namespace bazuko;
using Approx = doctest::Approx;

namespace {
const Bogota& city() {
    static const Bogota b;
    return b;
}
}  // namespace

TEST_CASE("cada evento con aviso lo genera con el texto y el tipo del HUD web") {
    auto t = toastFor(EvPickup{{"Lata", "Botella"}, false, false});
    REQUIRE(t);
    CHECK(t->text == "+ Lata, Botella");
    CHECK(t->type == "info");
    CHECK(toastFor(EvPickup{{"Cable"}, true, true})->text == "🔍 + Cable");
    CHECK(toastFor(EvPickup{{"Cable"}, true, true})->type == "rare");
    CHECK_FALSE(toastFor(EvPickup{{}, false, false}));  // sin nada que mostrar
    CHECK(toastFor(EvSell{12500})->text == "💰 Vendido por $ 12.500");
    CHECK(toastFor(EvSell{1})->type == "sell");
    CHECK(toastFor(EvDisease{"Gripe", "🤧"})->text == "☠️ Enfermedad: Gripe");
    CHECK(toastFor(EvDisease{"Gripe", ""})->type == "death");
    CHECK(toastFor(EvLevelUp{4})->text == "⭐ ¡Nivel 4! +1 punto de talento");
    CHECK(toastFor(EvCraft{"Vendaje", 3})->text == "🔨 Crafteado: Vendaje x3");
    CHECK(toastFor(EvSteal{{"Retrovisor"}, false})->text == "🪞 Robado: Retrovisor");
    CHECK_FALSE(toastFor(EvSteal{{}, false}));
    CHECK(toastFor(EvSteal{{"Radio"}, true})->text == "🚨 ¡Atrapado robando!");
    CHECK(toastFor(EvWithdrawal{true})->type == "warn");
    CHECK(toastFor(EvWithdrawal{false})->type == "info");
    CHECK(toastFor(EvSubstanceBuy{"Pastilla", 8000})->text == "📦 Comprado: Pastilla (-$ 8.000)");
    CHECK(toastFor(EvSubstanceBuyFail{"insufficient_money", 8000})->text == "💸 No tienes suficiente dinero ($ 8.000)");
    CHECK(toastFor(EvSubstanceBuyFail{"inventory_full", 0})->text == "🎒 Inventario lleno");
    CHECK(toastFor(EvSubstanceBuyFail{"invalid_item", 0})->text == "❌ No se pudo comprar");
    CHECK(toastFor(EvSubstanceFail{"day"})->type == "warn");
    CHECK_FALSE(toastFor(EvSubstanceFail{"nada"}));
    CHECK(toastFor(EvBegCooldown{3})->text == "⏳ Espera 3s antes de pedir limosna");
    CHECK(toastFor(EvBegResult{true, "", "", "mensaje", 900, true})->type == "rare");
    CHECK(toastFor(EvBegResult{true, "", "", "mensaje", 900, false})->type == "sell");
    CHECK(toastFor(EvBegResult{false, "ignored", "", "mensaje", 0, false})->type == "warn");
    CHECK(toastFor(EvSleepEnd{9})->text == "🌅 Dormiste 9 h · Partida guardada");
    CHECK(toastFor(EvSleepFail{"nobase"})->text == "📦 Primero arma la base del cambuche (8 cartones)");
    CHECK(toastFor(EvSleepFail{"otra"})->text == "No puedes dormir aquí");
    CHECK(toastFor(EvToast{"hola", "warn"})->type == "warn");
    CHECK_FALSE(toastFor(EvSound{"pickup"}));  // los sonidos no son avisos
    CHECK_FALSE(toastFor(EvOpenShop{-1}));
}

TEST_CASE("los avisos duran 2,5 s, caben 6 y se desvanecen al final") {
    ToastQueue q;
    for (int i = 0; i < 8; ++i) q.add({"aviso " + std::to_string(i), "info"});
    REQUIRE(q.items().size() == 6);
    CHECK(q.items().front().msg.text == "aviso 2");  // los más viejos salen
    CHECK(q.items().back().msg.text == "aviso 7");
    q.update(1.0);
    q.add({"nuevo", "warn"});
    CHECK(q.items().size() == 6);
    q.update(1.6);
    REQUIRE(q.items().size() == 1);  // los demás cumplieron 2,5 s
    CHECK(q.items()[0].msg.text == "nuevo");
    CHECK(ToastQueue::alpha({{}, 0.0}) == Approx(0));
    CHECK(ToastQueue::alpha({{}, 1.0}) == Approx(1));
    CHECK(ToastQueue::alpha({{}, 2.3}) == Approx(0.5));
    CHECK(ToastQueue::alpha({{}, 2.5}) == Approx(0));
    q.update(1.2);
    CHECK(q.items().empty());
}

TEST_CASE("los emoji se quitan del texto para la fuente de la interfaz") {
    CHECK(stripUnsupported("💰 Vendido por $ 12.500") == "Vendido por $ 12.500");
    CHECK(stripUnsupported("☠️ Enfermedad: Gripe") == "Enfermedad: Gripe");
    CHECK(stripUnsupported("Día 2 — 07:05") == "Día 2 — 07:05");
    CHECK(stripUnsupported("¡Nivel 3! · ¿Listo? ñandú") == "¡Nivel 3! · ¿Listo? ñandú");
    CHECK(stripUnsupported("😮‍💨 Se te calmó la ansiedad") == "Se te calmó la ansiedad");
    CHECK(stripUnsupported("a  🪙  b") == "a b");
    CHECK(stripUnsupported("").empty());
    CHECK(stripUnsupported("🚨").empty());
    CHECK(stripUnsupported("ok \xF0\x9F").size() >= 2);  // secuencia truncada: no revienta
}

TEST_CASE("el cartel de interacción coincide con el del juego web") {
    CHECK(promptFor({TargetType::None, -1}, city()).empty());
    CHECK(promptFor({TargetType::Pickup, 0}, city()) == "[E] Recoger basura · [Mantener Q] Seleccionar");
    CHECK(promptFor({TargetType::Car, 0}, city()) == "[E] Robar retrovisor de auto");
    CHECK(promptFor({TargetType::Recycler, -1}, city()) == "[E] Recicladora El Progreso · Vender material");
    CHECK(promptFor({TargetType::Shop, -1}, city()) == "[E] Tienda La Esquinita · Comprar");
    CHECK(promptFor({TargetType::Cambuche, -1}, city()) == "[E] Tu cambuche · Armar / Dormir");
    CHECK(promptFor({TargetType::Dealer, -1}, city()) == "[Q / E] Tienda del Dealer · Comprar / Vender");
    CHECK(promptFor({TargetType::Craft, -1}, city()) == "[E] Mesa de crafteo");
    const auto& v = city().vendors();
    REQUIRE_FALSE(v.empty());
    CHECK(promptFor({TargetType::Vendor, 0}, city()) == "[E] " + v[0].title + " · Comprar");
    CHECK(promptFor({TargetType::Vendor, 999}, city()) == "[E] Vendedor · Comprar");
}

TEST_CASE("reloj, XP y advertencias") {
    CHECK(clockText(1, 6.0) == "Día 1 — 06:00");
    CHECK(clockText(12, 23.99) == "Día 12 — 23:59");
    CHECK(clockText(3, 7.5) == "Día 3 — 07:30");
    GameState s(testutil::data());
    s.stats.level = 2;
    s.stats.xp = 50;  // 100 por nivel · 2
    CHECK(xpFraction(s) == Approx(0.25));
    s.stats.xp = 5000;
    CHECK(xpFraction(s) == Approx(1));

    StatsSystem& st = s.stats;
    CHECK(statusWarnings(st).empty());
    st.sed = 20;
    st.hambre = 0;
    st.energia = 10;
    st.salud = 30;
    const auto w = statusWarnings(st);
    REQUIRE(w.size() == 4);
    CHECK(w[0] == "Sed crítica: bebe agua.");
    CHECK(w[1] == "Sin alimento: estás perdiendo salud.");
    CHECK(w[2] == "Energía baja: descansa.");
    CHECK(w[3] == "Salud crítica: necesitas recuperarte.");
    st.sed = 0;
    CHECK(statusWarnings(st)[0] == "Sin agua: estás perdiendo salud.");
}

TEST_CASE("los efectos del dealer se describen por producto") {
    const GameData& d = testutil::data();
    CHECK(dealerEffect(*d.item("tintico")).find("energía") != std::string::npos);
    CHECK(dealerEffect(*d.item("pastilla")).find("salud") != std::string::npos);
    CHECK(dealerEffect(*d.item("pastilla")).find("Peso: ") != std::string::npos);
    CHECK(dealerEffect(*d.item("tintico")).rfind("+", 0) == 0);
}
