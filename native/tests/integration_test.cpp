#include <doctest/doctest.h>

#include <cmath>

#include "game/Entities.h"
#include "game/Interaction.h"
#include "game/systems/SaveSystem.h"
#include "game/systems/Survival.h"
#include "test_util.h"

using namespace bazuko;

namespace {

bool inRange(const StatsSystem& s) {
    for (double v : {s.hambre, s.sed, s.energia, s.salud, s.higiene, s.animo, s.vicio})
        if (!std::isfinite(v) || v < 0 || v > 100) return false;
    return std::isfinite(s.dinero) && std::isfinite(s.xp);
}

}  // namespace

TEST_CASE("un día completo de juego con una rutina de supervivencia mantiene todo en rango y se guarda bien") {
    const GameData& data = testutil::data();
    const Bogota city;
    Mulberry32Rng rng(11);
    GameState s(data);
    Entities e = spawnEntities(city, rng);
    Interaction it(s, e, city, rng);
    Input input;
    s.inventory.add("pan", 3);
    s.inventory.add("agua", 3);
    Vec3 player = city.reserved().spawn.x ? Vec3{city.reserved().spawn.x, 0, city.reserved().spawn.z} : Vec3{};

    const double dt = 0.1, daySeconds = data.c("DAY_LENGTH_SECONDS");
    const int steps = static_cast<int>(daySeconds / dt);
    int respawns = 0, pickups = 0;
    for (int i = 0; i < steps; ++i) {
        s.update(dt);
        // Cada 5 min de juego recoge una bolsa cercana y come o bebe si hace falta.
        if (i % 3000 == 0 && !e.pickups.empty()) {
            e.pickups[0].position = {player.x + 0.5, 0, player.z};
            e.pickups[0].used = false;
            input.setKey(Key::E, true);
            it.update(dt, input, player);
            input.setKey(Key::E, false);
            input.endFrame();
            ++pickups;
        }
        updateEntities(e, city, rng, dt);
        if (s.stats.hambre < 40 && s.inventory.count("pan")) useItem(s, "pan");
        if (s.stats.sed < 40 && s.inventory.count("agua")) useItem(s, "agua");
        if (isDead(s)) {
            respawn(s);
            ++respawns;
        }
        REQUIRE(inRange(s.stats));
        s.bus.drain();
    }
    CHECK(s.clock.day == 2);  // un día de reloj
    CHECK(pickups > 5);
    CHECK(respawns <= 1);

    // Guardar y recargar da el mismo estado.
    const SaveData saved = parse(serialize(capture(s)));
    GameState t(data);
    apply(t, saved);
    CHECK(t.clock.day == s.clock.day);
    CHECK(t.stats.hambre == doctest::Approx(s.stats.hambre));
    CHECK(t.stats.dinero == doctest::Approx(s.stats.dinero));
    CHECK(t.inventory.totalWeight() == doctest::Approx(s.inventory.totalWeight()));
    CHECK(t.talents.points() == s.talents.points());
}

TEST_CASE("sin comer ni beber el personaje muere, reaparece con 60 % y sigue vivo") {
    const GameData& data = testutil::data();
    GameState s(data);
    s.stats.hambre = 0;
    s.stats.sed = 0;
    s.inventory.add("colchon", 1);
    s.inventory.add("lata", 2);
    for (int i = 0; i < 60 * 60 * 20 && !isDead(s); ++i) s.update(0.05);
    REQUIRE(isDead(s));
    respawn(s);
    CHECK_FALSE(isDead(s));
    CHECK(s.stats.hambre >= 60);
    CHECK(s.stats.sed >= 60);
    CHECK(s.stats.salud >= 60);
    CHECK(s.inventory.items().size() == 1);  // pierde la mitad de los tipos
    for (int i = 0; i < 100; ++i) s.update(0.1);
    CHECK_FALSE(isDead(s));
}
