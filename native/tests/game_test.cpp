#include <doctest/doctest.h>

#include <algorithm>
#include <cmath>
#include <memory>
#include <set>

#include "game/Entities.h"
#include "game/Interaction.h"
#include "game/Money.h"
#include "game/Places.h"
#include "test_util.h"

using namespace bazuko;
using testutil::ConstRng;
using testutil::first;
using testutil::SeqRng;
using Approx = doctest::Approx;

namespace {

const Bogota& city() {
    static const Bogota b;
    return b;
}

constexpr double kFar = -5000;  // lugares fuera de alcance

struct Scene {
    GameState s{testutil::data()};
    Entities e;
    Rng* rng;
    std::unique_ptr<Interaction> it;
    Input input;
    Vec3 player{1000, 0, 1000};

    explicit Scene(Rng& r) : rng(&r) {
        e.recycler = e.dealer = e.craft = e.cambuche = e.shop = Place{{kFar, 0, kFar}};
        it = std::make_unique<Interaction>(s, e, city(), r);
    }
    void addPickup(double dx = 0.5) { Pickup p; p.position = {player.x + dx, 0, player.z}; e.pickups.push_back(p); }
    void addCar(double dx = 0.5) { ParkedCar c; c.position = {player.x + dx, 0, player.z}; e.cars.push_back(c); }
    void place(Place& p, double dx = 0.5) { p.position = {player.x + dx, 0, player.z}; }
    void press(Key k) { input.setKey(k, true); step(1.0 / 60); input.setKey(k, false); }
    void step(double dt) { it->update(dt, input, player); updateEntities(e, city(), *rng, dt); input.endFrame(); }
    std::vector<GameEvent> events() { return s.bus.drain(); }
};

template <class T>
int count(const std::vector<GameEvent>& ev) {
    int n = 0;
    for (const auto& e : ev) n += std::holds_alternative<T>(e);
    return n;
}

}  // namespace

// ---------- dinero ----------

TEST_CASE("cop formatea pesos colombianos con punto de miles") {
    CHECK(cop(0) == "$ 0");
    CHECK(cop(950) == "$ 950");
    CHECK(cop(1000) == "$ 1.000");
    CHECK(cop(12500) == "$ 12.500");
    CHECK(cop(1234567) == "$ 1.234.567");
    CHECK(cop(2499.6) == "$ 2.500");
    CHECK(cop(-1500) == "$ -1.500");
}

// ---------- población ----------

TEST_CASE("el distrito se puebla con 42 bolsas y 15 carros (14 y 5 por la escala de población)") {
    Mulberry32Rng rng(3);
    const Entities e = spawnEntities(city(), rng);
    CHECK(e.pickups.size() == 42);
    CHECK(e.cars.size() == 15);
    for (const Pickup& p : e.pickups) {
        CHECK(city().isWalkableAt(p.position.x, p.position.z));
        CHECK_FALSE(city().isNearReserved(p.position.x, p.position.z));
    }
    // los carros no se pisan (más de 8 m entre puestos) y la mayoría usa puestos de parqueo reales
    for (size_t i = 0; i < e.cars.size(); ++i)
        for (size_t j = i + 1; j < e.cars.size(); ++j)
            CHECK(std::hypot(e.cars[i].position.x - e.cars[j].position.x, e.cars[i].position.z - e.cars[j].position.z) > 8);
    // los lugares fijos están donde dice el mapa
    CHECK(e.recycler.position.x == Approx(city().reserved().sell.x));
    CHECK(e.shop.position.z == Approx(city().reserved().shop.z));
    CHECK(e.cambuche.position.x == Approx(city().reserved().bed.x));
    // determinista por semilla y distinta entre semillas
    Mulberry32Rng a(3), b(4);
    const Entities again = spawnEntities(city(), a), other = spawnEntities(city(), b);
    CHECK(again.pickups[0].position.x == e.pickups[0].position.x);
    bool differs = false;
    for (size_t i = 0; i < 10; ++i) differs |= other.pickups[i].position.x != e.pickups[i].position.x || other.pickups[i].position.z != e.pickups[i].position.z;
    CHECK(differs);
}

TEST_CASE("la basura recogida revive a los 20 s en otro sitio válido y los carros a los 40 s") {
    Mulberry32Rng rng(9);
    Entities e = spawnEntities(city(), rng);
    Pickup& p = e.pickups[0];
    const Vec3 before = p.position;
    p.used = true;
    p.cooldown = 20;
    e.cars[0].used = true;
    e.cars[0].cooldown = 40;
    updateEntities(e, city(), rng, 19.9);
    CHECK(p.used);
    CHECK(e.cars[0].used);
    updateEntities(e, city(), rng, 0.2);
    CHECK_FALSE(p.used);
    CHECK((p.position.x != before.x || p.position.z != before.z));
    CHECK(city().isWalkableAt(p.position.x, p.position.z));
    CHECK(e.cars[0].used);
    updateEntities(e, city(), rng, 20.0);
    CHECK_FALSE(e.cars[0].used);
}

// ---------- objetivo y cosecha ----------

TEST_CASE("el objetivo es lo más cercano dentro de 1,8 m") {
    ConstRng rng(0.5);
    Scene sc(rng);
    sc.addPickup(1.5);
    sc.addCar(0.9);
    sc.step(0.016);
    CHECK(sc.it->current().type == TargetType::Car);
    sc.e.cars[0].position.x += 2;  // se aleja del alcance
    sc.step(0.016);
    CHECK(sc.it->current().type == TargetType::Pickup);
    sc.e.pickups[0].position.x += 1;
    sc.step(0.016);
    CHECK(sc.it->current().type == TargetType::None);
}

TEST_CASE("E recoge la bolsa: objetos, XP, sonido y evento; luego queda en cooldown") {
    ConstRng rng(0.5);  // elige siempre botella, sin objeto raro ni enfermedad
    Scene sc(rng);
    sc.addPickup();
    sc.press(Key::E);
    CHECK(sc.s.inventory.count("botella") == 2);
    CHECK(sc.s.stats.xp == 3);
    CHECK(sc.e.pickups[0].used);
    CHECK(sc.e.pickups[0].cooldown == Approx(20).epsilon(0.01));
    auto ev = sc.events();
    REQUIRE(first<EvPickup>(ev));
    CHECK(first<EvPickup>(ev)->added.size() == 2);
    CHECK_FALSE(first<EvPickup>(ev)->sorted);
    CHECK(count<EvSound>(ev) >= 1);
    CHECK(first<EvPlayerAction>(ev)->name == "buscar");
    sc.press(Key::E);
    CHECK(sc.s.inventory.count("botella") == 2);  // en cooldown: no da nada
}

TEST_CASE("el origen reciclador da un objeto más por bolsa y la suerte un raro") {
    ConstRng rng(0.5);
    Scene sc(rng);
    sc.it->originId = "reciclador";
    sc.addPickup();
    sc.press(Key::E);
    CHECK(sc.s.inventory.count("botella") == 3);  // 2 + 1

    SeqRng lucky({0.5, 0.5, 0.01, 0.0, 0.9});  // dos tiradas comunes, raro (0.01 < 0.05) = reloj, sin enfermedad
    Scene s2(lucky);
    s2.addPickup();
    s2.s.stats.animo = 50;
    s2.press(Key::E);
    CHECK(s2.s.inventory.count("reloj") == 1);
    CHECK(s2.s.stats.animo == Approx(58));  // +8 por encontrar un tesoro
    auto ev = s2.events();
    CHECK(first<EvPickup>(ev)->rare);
}

TEST_CASE("mantener Q selecciona: más objetos si se completa 1,5 s, normal si se suelta antes") {
    ConstRng rng(0.5);
    Scene sc(rng);
    sc.addPickup();
    sc.input.setKey(Key::Q, true);
    for (int i = 0; i < 100; ++i) sc.step(1.0 / 60);  // 1,67 s
    CHECK(sc.it->sorting());
    CHECK(sc.e.pickups[0].sortProgress > 1.5);
    sc.input.setKey(Key::Q, false);
    sc.step(1.0 / 60);
    CHECK(sc.s.inventory.count("botella") == 4);  // seleccionada: 4 tiradas
    CHECK_FALSE(sc.it->sorting());
    auto ev = sc.events();
    CHECK(first<EvPickup>(ev)->sorted);

    Scene quick(rng);
    quick.addPickup();
    quick.input.setKey(Key::Q, true);
    for (int i = 0; i < 30; ++i) quick.step(1.0 / 60);  // 0,5 s
    quick.input.setKey(Key::Q, false);
    quick.step(1.0 / 60);
    CHECK(quick.s.inventory.count("botella") == 2);  // soltó antes: cosecha normal
}

TEST_CASE("el progreso de selección avanza con el tiempo de la bolsa") {
    Mulberry32Rng rng(1);
    Entities e;
    e.pickups.push_back({});
    e.pickups[0].position = {50, 0, 50};
    e.pickups[0].sorting = true;
    updateEntities(e, city(), rng, 0.7);
    CHECK(e.pickups[0].sortProgress == Approx(0.7));
    CHECK(e.pickups[0].sortComplete(1.5) == false);
    updateEntities(e, city(), rng, 0.9);
    CHECK(e.pickups[0].sortComplete(1.5));
}

TEST_CASE("FIX: Selección Experta rinde un 50 % más de objetos al seleccionar") {
    ConstRng rng(0.5);
    Scene sc(rng);
    sc.s.talents.restore(0, {"collector3"});  // sortValueMult 1,5
    sc.addPickup();
    sc.input.setKey(Key::Q, true);
    for (int i = 0; i < 100; ++i) sc.step(1.0 / 60);
    sc.input.setKey(Key::Q, false);
    sc.step(1.0 / 60);
    CHECK(sc.s.inventory.count("botella") == 6);  // round(4 · 1,5)
}

TEST_CASE("FIX: la mochila llena avisa de lo que se deja en vez de perderlo en silencio") {
    ConstRng rng(0.5);
    Scene sc(rng);
    sc.s.inventory.add("colchon", 3);  // 18 de 20 kg
    sc.s.inventory.add("lata", 5);     // 19 kg
    sc.addPickup();
    sc.press(Key::E);                  // dos botellas de 0,3 kg: solo cabe una (19,3) y la otra no (19,6 ≤ 20: caben)
    sc.s.inventory.remove("botella", 99);
    sc.s.inventory.add("colchon", 0);
    // llenar de verdad: 20 kg exactos
    Scene full(rng);
    full.s.inventory.add("colchon", 3);
    full.s.inventory.add("madera", 1);  // 20 kg
    full.addPickup();
    full.press(Key::E);
    auto ev = full.events();
    bool warned = false;
    for (const auto& e : ev)
        if (auto* t = std::get_if<EvToast>(&e)) warned |= t->type == "warn" && t->text.find("Mochila llena") != std::string::npos;
    CHECK(warned);
    CHECK(first<EvPickup>(ev)->added.empty());
    bool full_sound = false;
    for (const auto& e : ev) if (auto* so = std::get_if<EvSound>(&e)) full_sound |= so->name == "full";
    CHECK(full_sound);
}

TEST_CASE("enfermarse al recoger: más con poca higiene y menos con Piel Dura") {
    // r = 0,1: pasa el 12 % base, pero no si la resistencia lo baja de 0,1
    SeqRng bad({0.5, 0.5, 0.9, 0.1, 0.0});  // 2 tiradas, sin raro, infección (0.1 ≤ 0.12), enfermedad 0
    Scene a(bad);
    a.addPickup();
    a.press(Key::E);
    CHECK(a.s.diseases.hasAny());

    SeqRng resisted({0.5, 0.5, 0.9, 0.1, 0.0});
    Scene b(resisted);
    b.s.talents.restore(0, {"surv1", "surv2"});  // Piel Dura: x0,6 → umbral 0,072
    b.addPickup();
    b.press(Key::E);
    CHECK_FALSE(b.s.diseases.hasAny());

    SeqRng dirty({0.5, 0.5, 0.9, 0.15, 0.0});  // 0,15 no pasa el 12 %... pero sí con higiene baja (x1,5 = 18 %)
    Scene c(dirty);
    c.s.stats.higiene = 20;
    c.addPickup();
    c.press(Key::E);
    CHECK(c.s.diseases.hasAny());
    SeqRng clean({0.5, 0.5, 0.9, 0.15, 0.0});
    Scene d(clean);
    d.addPickup();
    d.press(Key::E);
    CHECK_FALSE(d.s.diseases.hasAny());
}

// ---------- boost ----------

TEST_CASE("el boost cuesta energía, drena salud, mejora la cosecha y termina a los 8 s") {
    ConstRng rng(0.5);
    Scene sc(rng);
    sc.s.stats.energia = 14;
    sc.press(Key::F);
    CHECK_FALSE(sc.it->boostActive());  // con menos de 15 no se puede
    sc.s.stats.energia = 60;
    sc.press(Key::F);
    CHECK(sc.it->boostActive());
    CHECK(sc.s.stats.energia == Approx(50));
    sc.addPickup();
    sc.press(Key::E);
    CHECK(sc.s.inventory.count("botella") == 4);  // 4 tiradas con boost
    const double health = sc.s.stats.salud;
    for (int i = 0; i < 60; ++i) sc.step(1.0 / 60);
    CHECK(sc.s.stats.salud == Approx(health - 3.0).epsilon(0.02));
    for (int i = 0; i < 60 * 8; ++i) sc.step(1.0 / 60);
    CHECK_FALSE(sc.it->boostActive());
    sc.press(Key::F);
    sc.press(Key::F);  // F otra vez lo cancela
    CHECK_FALSE(sc.it->boostActive());
}

TEST_CASE("el boost se corta si la salud llega al mínimo") {
    ConstRng rng(0.5);
    Scene sc(rng);
    sc.s.stats.salud = 6;
    sc.press(Key::F);
    REQUIRE(sc.it->boostActive());
    for (int i = 0; i < 120; ++i) sc.step(1.0 / 60);
    CHECK_FALSE(sc.it->boostActive());
    CHECK(sc.s.stats.salud >= 0);
    sc.s.stats.salud = 5;
    sc.press(Key::F);
    CHECK_FALSE(sc.it->boostActive());
}

// ---------- robo ----------

TEST_CASE("robar retrovisores: sin que te atrapen da objetos y XP") {
    ConstRng rng(0.5);
    Scene sc(rng);
    sc.addCar();
    sc.press(Key::E);
    CHECK(sc.s.inventory.count("retrovisor") == 1);
    CHECK(sc.s.stats.xp == 8);
    CHECK(sc.e.cars[0].used);
    CHECK(sc.e.cars[0].cooldown == Approx(40).epsilon(0.01));
    auto ev = sc.events();
    REQUIRE(first<EvSteal>(ev));
    CHECK_FALSE(first<EvSteal>(ev)->caught);
    sc.press(Key::E);
    CHECK(sc.s.inventory.count("retrovisor") == 1);  // ya robado
}

TEST_CASE("si te atrapan pierdes salud y dinero pero te quedas con lo robado") {
    ConstRng rng(0.1);  // dos retrovisores, radio y atrapado
    Scene sc(rng);
    sc.s.stats.dinero = 3000;
    sc.addCar();
    sc.press(Key::E);
    CHECK(sc.s.inventory.count("retrovisor") == 2);
    CHECK(sc.s.inventory.count("radio") == 1);
    CHECK(sc.s.stats.salud == Approx(75));
    CHECK(sc.s.stats.dinero == 0);  // 5000 de multa, sin bajar de cero
    CHECK(sc.s.stats.xp == 0);
    auto ev = sc.events();
    CHECK(first<EvSteal>(ev)->caught);
    CHECK(first<EvStealCaught>(ev));
}

TEST_CASE("Manos Ligeras baja la probabilidad de que te atrapen") {
    SeqRng rng({0.5, 0.5, 0.22});  // 22 % < 25 % normal, pero ≥ 20 % con el talento
    Scene a(rng);
    a.s.talents.restore(0, {"crime1"});
    a.addCar();
    a.press(Key::E);
    CHECK(a.s.stats.salud == 100);
    SeqRng rng2({0.5, 0.5, 0.22});
    Scene b(rng2);
    b.addCar();
    b.press(Key::E);
    CHECK(b.s.stats.salud == Approx(75));
}

// ---------- dealer ----------

TEST_CASE("el dealer solo compra de noche y paga la reventa nocturna") {
    ConstRng rng(0.5);
    Scene sc(rng);
    sc.place(sc.e.dealer);
    sc.s.inventory.add("pastilla", 2);
    sc.s.clock.hour = 12;
    sc.press(Key::E);  // de día con sustancias: abre su tienda
    CHECK(sc.s.inventory.count("pastilla") == 2);
    CHECK(count<EvDealerToggle>(sc.events()) == 1);

    sc.s.clock.hour = 23;
    sc.press(Key::E);
    CHECK(sc.s.inventory.count("pastilla") == 0);
    // 8000 · 2 · 1,8 · 1,3 = 37440
    CHECK(sc.s.stats.dinero == Approx(37440));
    CHECK(sc.s.stats.xp == 4);
    auto ev = sc.events();
    REQUIRE(first<EvSubstanceSell>(ev));
    CHECK(first<EvSubstanceSell>(ev)->earned == 37440);
}

TEST_CASE("Contactos sube el precio de las sustancias un 30 %") {
    ConstRng rng(0.5);
    Scene sc(rng);
    sc.place(sc.e.dealer);
    sc.s.talents.restore(0, {"crime1", "crime2"});
    sc.s.inventory.add("tintico", 1);
    sc.s.clock.hour = 22;
    sc.press(Key::E);
    CHECK(sc.s.stats.dinero == Approx(1000 * 1.8 * 1.3 * 1.3).epsilon(0.001));
}

TEST_CASE("Q junto al dealer abre su tienda y comprar valida dinero y peso") {
    ConstRng rng(0.5);
    Scene sc(rng);
    sc.place(sc.e.dealer);
    sc.press(Key::Q);
    CHECK(count<EvDealerToggle>(sc.events()) == 1);

    auto r = sc.it->buySubstance("pastilla");
    CHECK_FALSE(r.ok);
    CHECK(r.reason == "insufficient_money");
    CHECK(r.cost == 8000);
    sc.s.stats.dinero = 9000;
    r = sc.it->buySubstance("pastilla");
    CHECK(r.ok);
    CHECK(sc.s.stats.dinero == 1000);
    CHECK(sc.s.inventory.count("pastilla") == 1);
    CHECK(r.name == "Pastilla");
    sc.s.stats.dinero = 99999;
    sc.s.inventory.maxWeight = sc.s.inventory.totalWeight();  // lleno
    r = sc.it->buySubstance("pastilla");
    CHECK(r.reason == "inventory_full");
    CHECK(sc.it->buySubstance("fantasma").reason == "invalid_item");
    auto ev = sc.events();
    CHECK(count<EvSubstanceBuy>(ev) == 1);
    CHECK(count<EvSubstanceBuyFail>(ev) == 3);

    Scene random(rng);
    random.s.stats.dinero = 99999;
    CHECK(random.it->buySubstance().ok);  // sin id: elige ponderado entre las tres sustancias
}

// ---------- limosna ----------

TEST_CASE("pedir limosna: enfriamiento de 4 s y energía mínima") {
    SeqRng rng({0.9, 0.9, 0.9, 0.99});  // sin higiene mala, sin ser ignorado, sin comida, dinero normal
    Scene sc(rng);
    sc.press(Key::B);
    auto ev = sc.events();
    REQUIRE(first<EvBegResult>(ev));
    CHECK(first<EvBegResult>(ev)->success);
    CHECK(sc.s.stats.energia == Approx(97));
    sc.press(Key::L);  // enseguida: en enfriamiento
    ev = sc.events();
    REQUIRE(first<EvBegCooldown>(ev));
    CHECK(first<EvBegCooldown>(ev)->waitSec == 4);
    for (int i = 0; i < 60 * 4; ++i) sc.step(1.0 / 60);
    sc.s.stats.energia = 2;
    sc.press(Key::B);
    CHECK(first<EvBegFail>(sc.events()));
    CHECK(sc.s.stats.energia == 2);  // sin energía no gasta nada
}

TEST_CASE("pedir limosna: ignorado, rechazo por higiene, comida y dinero según el azar") {
    {   // ignorado (0.1 < 0.2)
        SeqRng rng({0.1});
        Scene sc(rng);
        sc.s.stats.animo = 50;
        sc.press(Key::B);
        auto r = first<EvBegResult>(sc.events());
        // el evento ya fue drenado: se comprueba por estado
        CHECK(sc.s.stats.animo == Approx(49));
        (void)r;
    }
    {   // higiene: sucio y 0.5 < 0.7
        SeqRng rng({0.5});
        Scene sc(rng);
        sc.s.stats.higiene = 10;
        sc.s.stats.animo = 50;
        sc.press(Key::B);
        auto ev = sc.events();
        REQUIRE(first<EvBegResult>(ev));
        CHECK(first<EvBegResult>(ev)->reason == "higiene");
        CHECK(sc.s.stats.animo == Approx(48));
    }
    {   // comida: ni ignorado (0.5) ni..., 0.1 < 0.18, luego 0.4 < 0.5 → pan
        SeqRng rng({0.5, 0.1, 0.4});
        Scene sc(rng);
        sc.press(Key::B);
        CHECK(sc.s.inventory.count("pan") == 1);
        CHECK(sc.s.stats.xp == 4);
        auto ev = sc.events();
        CHECK(first<EvBegResult>(ev)->item == "Pan duro");
    }
    {   // dinero común: round(2 + 0.5·13 = 8,5) = 9 → 900
        SeqRng rng({0.5, 0.5, 0.5, 0.5});
        Scene sc(rng);
        sc.press(Key::B);
        CHECK(sc.s.stats.dinero == 900);
        CHECK(first<EvBegResult>(sc.events())->message == "🪙 Recibiste $ 900 de limosna");
    }
    {   // billete raro: 0.05 < 0.08, 0.3 < 0.5 → $5.000, XP doble
        SeqRng rng({0.5, 0.5, 0.05, 0.3});
        Scene sc(rng);
        sc.press(Key::B);
        CHECK(sc.s.stats.dinero == 5000);
        CHECK(sc.s.stats.xp == 8);
    }
    {   // migrante: x1,3 → round(8,5 · 1,3 = 11,05) = 11
        SeqRng rng({0.5, 0.5, 0.5, 0.5});
        Scene sc(rng);
        sc.it->originId = "migrante";
        sc.press(Key::B);
        CHECK(sc.s.stats.dinero == 1100);
    }
}

// ---------- lugares ----------

TEST_CASE("la recicladora paga lo reciclable (x1,2 con boost, x1,15 gota a gota) y deja lo demás") {
    ConstRng rng(0.5);
    Scene sc(rng);
    sc.s.inventory.add("lata", 4);       // 250 c/u
    sc.s.inventory.add("cable", 1);      // 2400
    sc.s.inventory.add("pan", 2);        // comida: no se recibe
    sc.s.inventory.add("pastilla", 1);   // sustancia: no
    sc.s.inventory.add("lona", 1);       // material: no
    CHECK(recyclerTotal(sc.s, 1.0) == 3400);
    CHECK(recyclerTotal(sc.s, 1.2) == 4080);
    CHECK(recyclerTotal(sc.s, 1.15) == 3910);
    const int earned = sellToRecycler(sc.s, 1.0);
    CHECK(earned == 3400);
    CHECK(sc.s.stats.dinero == 3400);
    CHECK(sc.s.stats.xp == 2);
    CHECK(sc.s.inventory.count("lata") == 0);
    CHECK(sc.s.inventory.count("pan") == 2);
    CHECK(sc.s.inventory.count("pastilla") == 1);
    CHECK(sc.s.inventory.count("lona") == 1);
    CHECK(sellToRecycler(sc.s, 1.0) == 0);  // nada más que vender
    auto ev = sc.events();
    CHECK(first<EvSell>(ev)->earned == 3400);
    CHECK(count<EvSell>(ev) == 1);
}

TEST_CASE("E junto a la recicladora, la tienda, los vendedores, el cambuche y la mesa abre su menú") {
    ConstRng rng(0.5);
    {
        Scene sc(rng); sc.place(sc.e.recycler); sc.press(Key::E);
        CHECK(count<EvOpenRecycler>(sc.events()) == 1);
    }
    {
        Scene sc(rng); sc.place(sc.e.shop); sc.press(Key::E);
        auto ev = sc.events();
        REQUIRE(first<EvOpenShop>(ev));
        CHECK(first<EvOpenShop>(ev)->vendor == -1);
    }
    {
        Scene sc(rng); sc.place(sc.e.cambuche); sc.press(Key::E);
        CHECK(count<EvOpenCambuche>(sc.events()) == 1);
    }
    {
        Scene sc(rng); sc.place(sc.e.craft); sc.press(Key::E);
        CHECK(count<EvOpenCrafting>(sc.events()) == 1);  // FIX: la mesa de crafteo no se podía usar
    }
    {
        Scene sc(rng);
        sc.player = {city().vendors()[1].x, 0, city().vendors()[1].z + 0.3};
        sc.press(Key::E);
        auto ev = sc.events();
        REQUIRE(first<EvOpenShop>(ev));
        CHECK(first<EvOpenShop>(ev)->vendor == 1);
    }
}

TEST_CASE("la tienda valida dinero, peso y el costal grande que solo se compra una vez") {
    ConstRng rng(0.5);
    Scene sc(rng);
    const GameData& d = testutil::data();
    auto entry = [&](const char* id) { for (const auto& e : d.shopItems) if (e.item == id) return e; return ShopEntry{}; };
    ShopEntry pan = entry("pan");
    CHECK(canBuy(sc.s, pan) == ShopStatus::NotEnoughMoney);
    sc.s.stats.dinero = 20000;
    CHECK(buy(sc.s, pan) == ShopStatus::Ok);
    CHECK(sc.s.stats.dinero == 18500);
    CHECK(sc.s.inventory.count("pan") == 1);
    ShopEntry madera = entry("madera");
    CHECK(madera.qty == 3);
    CHECK(buy(sc.s, madera) == ShopStatus::Ok);
    CHECK(sc.s.inventory.count("madera") == 3);

    sc.s.inventory.maxWeight = sc.s.inventory.totalWeight() + 2;  // cabe exactamente una lona (2 kg)
    ShopEntry lona = entry("lona");
    CHECK(buy(sc.s, lona) == ShopStatus::Ok);
    CHECK(canBuy(sc.s, lona) == ShopStatus::TooHeavy);  // otra más no cabe

    ShopEntry costal;
    for (const auto& e : d.shopItems) if (!e.upgrade.empty()) costal = e;
    sc.s.stats.dinero = 50000;
    CHECK(buy(sc.s, costal) == ShopStatus::Ok);
    CHECK(sc.s.costal);
    CHECK(sc.s.inventory.maxWeight == Approx(40));
    CHECK(buy(sc.s, costal) == ShopStatus::AlreadyOwned);
    CHECK(canBuy(sc.s, lona) == ShopStatus::Ok);  // ahora sí cabe
    CHECK(count<EvToast>(sc.events()) >= 3);
}

TEST_CASE("describir un objeto lista sus efectos") {
    const GameData& d = testutil::data();
    CHECK(describeItem(*d.item("pan")) == "+25 hambre · +5 ánimo");
    CHECK(describeItem(*d.item("refresco")) == "+50 sed · +10 energía · +10 ánimo");
    CHECK(describeItem(*d.item("pegante")) == "+40 vicio · -3 salud · +25 ánimo");
    CHECK(describeItem(*d.item("jarabe")) == "Cura: gripe.");
    CHECK(describeItem(*d.item("lata")).empty());
}

TEST_CASE("el cambuche se arma por piezas: primero la base y con los materiales completos") {
    ConstRng rng(0.5);
    Scene sc(rng);
    const GameData& d = testutil::data();
    const CambuchePiece& base = d.cambuche[0];
    const CambuchePiece& techo = d.cambuche[1];
    CHECK(canBuild(sc.s, base) == BuildStatus::MissingMaterials);
    CHECK(canBuild(sc.s, techo) == BuildStatus::NeedsBase);
    sc.s.inventory.add("carton", 8);
    sc.s.inventory.add("lona", 1);
    CHECK(canBuild(sc.s, techo) == BuildStatus::NeedsBase);  // aunque tenga la lona
    CHECK(build(sc.s, base) == BuildStatus::Ok);
    CHECK(sc.s.hasBuilt("base"));
    CHECK(sc.s.inventory.count("carton") == 0);
    CHECK(build(sc.s, base) == BuildStatus::AlreadyBuilt);
    CHECK(build(sc.s, techo) == BuildStatus::Ok);
    CHECK(sc.s.inventory.count("lona") == 0);
    const CambuchePiece& fogon = d.cambuche[4];  // 6 latas + 2 tablas
    sc.s.inventory.add("lata", 6);
    CHECK(canBuild(sc.s, fogon) == BuildStatus::MissingMaterials);
    sc.s.inventory.add("madera", 2);
    CHECK(build(sc.s, fogon) == BuildStatus::Ok);
}

TEST_CASE("la mesa de crafteo fabrica con ingredientes, descuenta peso y da XP") {
    ConstRng rng(0.5);
    Scene sc(rng);
    const Recipe& vendaje = *std::find_if(testutil::data().recipes.begin(), testutil::data().recipes.end(), [](const Recipe& r) { return r.id == "vendaje"; });
    CHECK_FALSE(craftRecipe(sc.s, vendaje));
    sc.s.inventory.add("lona", 1);
    CHECK(craftRecipe(sc.s, vendaje));
    CHECK(sc.s.inventory.count("vendaje") == 3);
    CHECK(sc.s.stats.xp == 10);
}
