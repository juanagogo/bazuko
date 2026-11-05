#include <doctest/doctest.h>

#include <algorithm>
#include <cmath>

#include "game/GameState.h"
#include "game/systems/Survival.h"
#include "test_util.h"

using namespace bazuko;
using testutil::data;
using testutil::first;
using testutil::SeqRng;

static void explore(GameState& g, double seconds) {
    const long frames = static_cast<long>(seconds * 60);
    for (long i = 0; i < frames; ++i) g.update(1.0 / 60);
}
static void exploreStats(StatsSystem& st, double seconds, bool night) {
    const long frames = static_cast<long>(seconds * 60);
    for (long i = 0; i < frames; ++i) st.update(1.0 / 60, night);
}

// ---------- paridad con stats.test.js ----------

TEST_CASE("media hora de exploración no exige atender ninguna barra") {
    GameState g(data());
    explore(g, 30 * 60);
    CHECK(g.stats.salud == 100);
    CHECK(g.stats.sed > 65);
    CHECK(g.stats.hambre > 74);
    CHECK(g.stats.energia > 65);
    CHECK(g.stats.higiene > 90);
    CHECK(g.stats.animo > 80);
    CHECK_FALSE(g.stats.inWithdrawal());
}

TEST_CASE("un día completo dura una hora y no mata") {
    GameState g(data());
    explore(g, 60 * 60);
    CHECK(g.clock.day == 2);
    CHECK(std::abs(g.clock.hour - 6) < 1e-6);
    CHECK(g.stats.salud == 100);
    for (double v : {g.stats.sed, g.stats.hambre, g.stats.energia, g.stats.higiene, g.stats.animo}) CHECK(v > 30);
    CHECK_FALSE(g.stats.inWithdrawal());
}

TEST_CASE("la sed tarda 90 min en vaciarse y da 20 min más antes de morir") {
    GameState g(data());
    explore(g, 90 * 60);
    CHECK(g.stats.sed < 1e-6);
    CHECK(g.stats.salud > 99.99);
    explore(g, 10 * 60);
    CHECK(g.stats.salud > 49.99);
    CHECK(g.stats.salud < 50.01);
    explore(g, 10 * 60);
    CHECK(g.stats.salud < 0.01);
}

TEST_CASE("ánimo, higiene, cansancio y abstinencia críticos penalizan sin matar") {
    GameState g(data());
    g.stats.animo = g.stats.higiene = g.stats.energia = g.stats.vicio = 0;
    explore(g, 10 * 60);
    CHECK(g.stats.salud == 100);
    CHECK(g.stats.getSpeedMultiplier() < 1);
    CHECK(g.stats.isRejectedByNPCs());
}

TEST_CASE("una infección no vacía la salud en menos de un minuto") {
    GameState g(data());
    g.diseases.restore({{"infeccion", 54}});
    for (int i = 0; i < 53 * 60; ++i) {
        g.stats.update(1.0 / 60, false);
        g.diseases.update(1.0 / 60);
    }
    CHECK(g.stats.salud > 85);
    CHECK(g.stats.salud < 95);
}

TEST_CASE("el ánimo incluye la noche y respeta los talentos") {
    TalentSystem none(data()), trainedTalents(data());
    trainedTalents.restore(0, {"surv3"});  // mentalDecayMult 0.5
    StatsSystem day(data()), night(data()), trained(data());
    day.attach(nullptr, &none);
    night.attach(nullptr, &none);
    trained.attach(nullptr, &trainedTalents);
    exploreStats(day, 60, false);
    exploreStats(night, 60, true);
    exploreStats(trained, 60, true);
    CHECK(day.animo > 99);
    CHECK(day.animo < 100);
    CHECK(night.animo < day.animo);
    CHECK(std::abs((100 - trained.animo) * 2 - (100 - night.animo)) < 1e-7);
}

// ---------- reglas de Stats ----------

TEST_CASE("subir de nivel consume XP, da un punto de talento y emite evento") {
    GameState g(data());
    g.stats.xp = 100;
    g.stats.update(0.0, false);
    CHECK(g.stats.level == 2);
    CHECK(g.stats.xp == 0);
    CHECK(g.talents.points() == 1);
    auto ev = g.bus.drain();
    REQUIRE(first<EvLevelUp>(ev));
    CHECK(first<EvLevelUp>(ev)->level == 2);
}

TEST_CASE("addXP redondea como Math.round y respeta xpMult") {
    GameState g(data());
    g.talents.restore(0, {"crime3"});  // xpMult 1.5
    g.stats.addXP(3);                  // 4.5 -> 5
    CHECK(g.stats.xp == 5);
}

TEST_CASE("entrar en abstinencia emite un evento") {
    GameState g(data());
    g.stats.vicio = 20.001;
    g.stats.update(1.0, false);
    auto ev = g.bus.drain();
    REQUIRE(first<EvWithdrawal>(ev));
    CHECK(first<EvWithdrawal>(ev)->active);
    CHECK(g.stats.inWithdrawal());
    CHECK(g.stats.getSpeedMultiplier() == doctest::Approx(0.85));
}

TEST_CASE("desaturación e higiene sucia") {
    GameState g(data());
    CHECK(g.stats.getDesaturation() == 0);
    g.stats.animo = 25;
    CHECK(g.stats.getDesaturation() == doctest::Approx(0.5));
    g.stats.higiene = 29;
    CHECK(g.stats.getDiseaseChanceMultiplier() == doctest::Approx(1.5));
}

// ---------- talentos ----------

TEST_CASE("talentos: puntos, requisitos y efectos") {
    GameState g(data());
    CHECK_FALSE(g.talents.unlock("collector1"));  // sin puntos
    g.talents.addPoints(5);
    CHECK_FALSE(g.talents.unlock("collector2"));  // falta collector1
    CHECK(g.talents.unlock("collector1"));
    CHECK(g.talents.unlock("collector2"));
    CHECK(g.talents.points() == 3);
    CHECK_FALSE(g.talents.unlock("collector1"));  // ya desbloqueado
    CHECK(g.talents.getEffect("maxWeightBonus", 0) == 10);
    g.refreshMaxWeight();
    CHECK(g.inventory.maxWeight == 30);
    g.costal = true;
    g.refreshMaxWeight();
    CHECK(g.inventory.maxWeight == 50);
    auto ev = g.bus.drain();
    int unlocks = 0;
    for (const auto& e : ev) unlocks += std::holds_alternative<EvTalentUnlock>(e);
    CHECK(unlocks == 2);  // un solo aviso por talento (el HUD web lo duplicaba)
}

TEST_CASE("FIX: Piel Dura reduce el riesgo de enfermedad en vez de aumentarlo") {
    GameState g(data());
    g.talents.restore(0, {"surv1", "surv2"});
    CHECK(g.talents.getEffect("diseaseResistMult", 1) == doctest::Approx(0.6));
}

// ---------- enfermedades ----------

TEST_CASE("infectarse: probabilidad, resistencia y no apilar") {
    GameState g(data());
    SeqRng none({0.5});  // 0.5 > 0.12
    CHECK(g.diseases.tryInfect(false, 1, none) == nullptr);

    SeqRng hit({0.05, 0.0});  // pasa el 12 % y elige la primera enfermedad
    const DiseaseDef* d = g.diseases.tryInfect(false, 1, hit);
    REQUIRE(d);
    CHECK(d->id == "gripe");
    CHECK(g.diseases.hasAny());
    auto ev = g.bus.drain();
    REQUIRE(first<EvDisease>(ev));

    g.diseases.update(10);  // quedan 35 s
    SeqRng again({0.05, 0.0});
    CHECK(g.diseases.tryInfect(false, 1, again) == nullptr);  // ya la tenía: solo renueva
    CHECK(g.diseases.active().at("gripe") == doctest::Approx(45));

    SeqRng resisted({0.1});  // 0.1 > 0.12 * 0.6
    CHECK(g.diseases.tryInfect(false, 0.6, resisted) == nullptr);
    SeqRng sorted({0.2, 0.9});  // 0.2 <= 0.12 * 1.8 y elige la última (parásitos)
    const DiseaseDef* s = g.diseases.tryInfect(true, 1, sorted);
    REQUIRE(s);
    CHECK(s->id == "parasitos");
}

TEST_CASE("las enfermedades expiran y emiten aviso de curación") {
    GameState g(data());
    g.diseases.restore({{"gripe", 1.0}});
    g.diseases.update(0.5);
    CHECK(g.diseases.hasAny());
    g.diseases.update(0.6);
    CHECK_FALSE(g.diseases.hasAny());
    REQUIRE(first<EvDiseaseCured>(g.bus.drain()));
}

// ---------- inventario y crafteo ----------

TEST_CASE("inventario: peso máximo atómico, quitar y restaurar") {
    GameState g(data());
    auto& inv = g.inventory;
    CHECK(inv.add("colchon", 3));  // 18 kg
    CHECK_FALSE(inv.add("colchon", 1));  // 24 > 20
    CHECK(inv.count("colchon") == 3);
    CHECK_FALSE(inv.add("noexiste"));
    CHECK(inv.add("lata", 5));
    CHECK(inv.totalWeight() == doctest::Approx(19.0));
    CHECK(inv.remove("colchon", 3));
    CHECK(inv.count("colchon") == 0);
    CHECK_FALSE(inv.remove("colchon"));
    CHECK(inv.itemCount() == 5);

    CHECK(inv.restore({{"pan", 2}, {"fantasma", 1}, {"lata", 0}}) == 2);
    CHECK(inv.items().size() == 1);
}

TEST_CASE("crafteo: consume ingredientes y entrega el resultado") {
    GameState g(data());
    const Recipe& vendaje = *std::find_if(data().recipes.begin(), data().recipes.end(),
                                          [](const Recipe& r) { return r.id == "vendaje"; });
    CHECK_FALSE(g.crafting.craft(vendaje, g.inventory));  // sin lona
    g.inventory.add("lona", 1);
    CHECK(g.crafting.craft(vendaje, g.inventory));
    CHECK(g.inventory.count("lona") == 0);
    CHECK(g.inventory.count("vendaje") == 3);
    auto ev = g.bus.drain();
    REQUIRE(first<EvCraft>(ev));
    CHECK(first<EvCraft>(ev)->qty == 3);
}

TEST_CASE("FIX: el crafteo descuenta el peso de los ingredientes consumidos") {
    GameState g(data());
    const Recipe& carbon = *std::find_if(data().recipes.begin(), data().recipes.end(),
                                         [](const Recipe& r) { return r.id == "carbon"; });
    g.inventory.maxWeight = 4.0;
    REQUIRE(g.inventory.add("madera", 2));  // exactamente 4 kg: lleno
    CHECK(g.crafting.craft(carbon, g.inventory));
    CHECK(g.inventory.count("carbon") == 1);
}

// ---------- usar objetos ----------

TEST_CASE("usar comida, sustancia y cura") {
    GameState g(data());
    g.stats.hambre = 50;
    g.stats.animo = 50;
    g.inventory.add("pan");
    CHECK(useItem(g, "pan"));
    CHECK(g.stats.hambre == 75);
    CHECK(g.stats.animo == 55);
    CHECK(g.inventory.count("pan") == 0);

    g.stats.vicio = 10;
    g.stats.salud = 50;
    g.inventory.add("pegante");
    CHECK(useItem(g, "pegante"));
    CHECK(g.stats.vicio == 50);
    CHECK(g.stats.salud == 47);

    g.stats.sed = 90;
    g.inventory.add("refresco");
    CHECK(useItem(g, "refresco"));
    CHECK(g.stats.sed == 100);  // se satura en 100

    g.diseases.restore({{"gripe", 30}, {"sarna", 30}});
    g.inventory.add("jarabe");
    CHECK(useItem(g, "jarabe"));
    CHECK(g.diseases.active().count("gripe") == 0);
    CHECK(g.diseases.active().count("sarna") == 1);

    g.inventory.add("lata");
    CHECK_FALSE(useItem(g, "lata"));  // no es comestible ni cura
    CHECK_FALSE(useItem(g, "pan"));   // ya no hay
    CHECK(g.inventory.count("lata") == 1);
}

TEST_CASE("FIX: vacuna, pomada, antiparasitario y carbón ya curan algo") {
    GameState g(data());
    const std::pair<const char*, const char*> cases[] = {
        {"vacuna", "tetanos"}, {"pomada", "sarna"}, {"antiparasitario", "parasitos"}, {"carbon", "intoxicacion"}};
    for (const auto& [item, disease] : cases) {
        g.diseases.restore({{disease, 30}});
        g.inventory.add(item);
        CHECK(useItem(g, item));
        CHECK_MESSAGE(!g.diseases.hasAny(), item);
    }
}

// ---------- dormir y morir ----------

TEST_CASE("dormir sin base falla") {
    GameState g(data());
    SeqRng rng({0.9});
    auto r = sleep(g, rng);
    CHECK_FALSE(r.ok);
    CHECK(r.failReason == "nobase");
    CHECK(first<EvSleepFail>(g.bus.drain()));
}

TEST_CASE("dormir de noche hasta las 6 recupera con todo construido") {
    GameState g(data());
    g.built = {{"base", true}, {"techo", true}, {"paredes", true}, {"cama", true}, {"fogon", true}, {"vela", true}};
    g.clock.hour = 22;
    g.stats.energia = 10; g.stats.salud = 10; g.stats.animo = 10; g.stats.vicio = 50; g.stats.hambre = 80;
    SeqRng rng({0.0});
    auto r = sleep(g, rng);
    CHECK(r.ok);
    CHECK(r.hours == doctest::Approx(8));
    CHECK(g.clock.hour == doctest::Approx(6));
    CHECK(g.clock.day == 2);
    CHECK(g.stats.energia == doctest::Approx(90));  // 10 + (45 + 35)
    CHECK(g.stats.salud == doctest::Approx(35));    // 10 + (10 + 15)
    CHECK(g.stats.animo == doctest::Approx(65));    // 10 + (40 + 15)
    CHECK(g.stats.vicio == doctest::Approx(65));    // vela: +15
    CHECK(g.stats.hambre == 80);                    // fogón: no pierde hambre
    CHECK_FALSE(r.robbed);                          // tiene paredes
}

TEST_CASE("una siesta de día rinde menos y no hay robo") {
    GameState g(data());
    g.built = {{"base", true}};
    g.clock.hour = 12;
    g.stats.energia = 0; g.stats.vicio = 50; g.stats.hambre = 80;
    SeqRng rng({0.0});  // robaría, pero es de día
    auto r = sleep(g, rng);
    CHECK(r.hours == 3);
    CHECK(g.clock.hour == doctest::Approx(15));
    CHECK(g.stats.energia == doctest::Approx(45 * 0.375));
    CHECK(g.stats.vicio == doctest::Approx(50 - 10 * 0.375));
    CHECK(g.stats.hambre == doctest::Approx(80 - 15 * 0.375));
    CHECK_FALSE(r.robbed);
}

TEST_CASE("sin paredes pueden robarte de noche: dinero y material, no comida") {
    GameState g(data());
    g.built = {{"base", true}};
    g.clock.hour = 23;
    g.stats.dinero = 10001;
    g.inventory.add("lata", 5);
    g.inventory.add("pan", 2);
    SeqRng rng({0.1});  // < 0.25
    auto r = sleep(g, rng);
    CHECK(r.robbed);
    CHECK(r.moneyLost == 4000);
    CHECK(g.stats.dinero == 6001);
    CHECK(g.inventory.count("lata") == 2);  // ceil(5 * 0.5) = 3 robadas
    CHECK(g.inventory.count("pan") == 2);

    GameState safe(data());
    safe.built = {{"base", true}};
    safe.clock.hour = 23;
    SeqRng noRobbery({0.5});
    CHECK_FALSE(sleep(safe, noRobbery).robbed);
}

TEST_CASE("morir: se pierde la mitad de los tipos de objeto y se vuelve a empezar bien") {
    GameState g(data());
    g.inventory.add("lata", 2);
    g.inventory.add("pan", 1);
    g.inventory.add("cable", 1);
    g.inventory.add("agua", 1);
    g.stats.hambre = g.stats.sed = g.stats.energia = g.stats.higiene = g.stats.animo = g.stats.vicio = 0;
    g.stats.salud = 0;
    g.diseases.restore({{"infeccion", 40}});
    CHECK(isDead(g));

    respawn(g);
    CHECK(g.inventory.items().size() == 2);
    CHECK(g.inventory.count("lata") == 0);
    CHECK(g.inventory.count("pan") == 0);
    CHECK(g.inventory.count("cable") == 1);
    for (double v : {g.stats.hambre, g.stats.sed, g.stats.energia, g.stats.salud, g.stats.higiene, g.stats.animo, g.stats.vicio})
        CHECK(v >= 60);
    CHECK_FALSE(g.diseases.hasAny());
    CHECK_FALSE(isDead(g));

    explore(g, 90);
    CHECK_FALSE(isDead(g));  // no hay otra muerte inmediata
}

TEST_CASE("el reloj y la noche") {
    Clock c(3600);
    CHECK_FALSE(c.isNight());
    c.advance(14);  // 20:00
    CHECK(c.isNight());
    c.advance(10);  // 06:00 del día siguiente
    CHECK(c.day == 2);
    CHECK_FALSE(c.isNight());
}

TEST_CASE("EventBus entrega los eventos una sola vez y en orden") {
    EventBus b;
    b.emit(EvToast{"a", "info"});
    b.emit(EvDeath{});
    auto ev = b.drain();
    REQUIRE(ev.size() == 2);
    CHECK(std::holds_alternative<EvToast>(ev[0]));
    CHECK(std::holds_alternative<EvDeath>(ev[1]));
    CHECK(b.empty());
    CHECK(b.drain().empty());
}
