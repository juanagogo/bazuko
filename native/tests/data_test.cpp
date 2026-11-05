#include <doctest/doctest.h>

#include <numeric>
#include <stdexcept>

#include "game/data/GameData.h"
#include "test_util.h"

using bazuko::GameData;

static const GameData& data() { return testutil::data(); }

TEST_CASE("game_data.json carga con los conteos esperados") {
    const auto& d = data();
    CHECK(d.items.size() == 32);
    CHECK(d.talents.size() == 9);
    CHECK(d.branches.size() == 3);
    CHECK(d.origins.size() == 4);
    CHECK(d.cambuche.size() == 6);
    CHECK(d.diseases.size() == 6);
    CHECK(d.shopItems.size() == 19);
    CHECK(d.costalBonus == 20);
}

TEST_CASE("constantes y tablas coinciden con constants.js") {
    const auto& d = data();
    CHECK(d.c("DAY_LENGTH_SECONDS") == 3600);
    CHECK(d.c("XP_PER_LEVEL") == 100);
    CHECK(d.c("INVENTORY_MAX_WEIGHT") == 20);
    CHECK(d.decay.hambre == doctest::Approx(100.0 / 7200));
    CHECK(d.decay.sed == doctest::Approx(100.0 / 5400));
    CHECK(d.decay.vicio == doctest::Approx(60.0 / 7200));
    CHECK(d.survivalDamage.sed == doctest::Approx(100.0 / 1200));
    CHECK(d.statThresholds.at("vicioAbstinencia") == 20);
    CHECK_THROWS(d.c("NO_EXISTE"));
}

TEST_CASE("las tablas de loot suman lo esperado y apuntan a ítems reales") {
    const auto& d = data();
    auto sum = [](const std::vector<bazuko::LootEntry>& v) {
        return std::accumulate(v.begin(), v.end(), 0.0, [](double a, const auto& e) { return a + e.weight; });
    };
    CHECK(sum(d.lootCommon) == doctest::Approx(102.0));
    CHECK(sum(d.lootRare) == doctest::Approx(100.0));
    CHECK(sum(d.lootSubstance) == doctest::Approx(100.0));
    for (const auto* table : {&d.lootCommon, &d.lootRare, &d.lootSubstance})
        for (const auto& e : *table) CHECK_MESSAGE(d.item(e.item), e.item);
}

TEST_CASE("la tienda solo vende ítems existentes o la mejora costal") {
    for (const auto& s : data().shopItems) {
        if (!s.upgrade.empty()) CHECK(s.upgrade == "costal");
        else CHECK_MESSAGE(data().item(s.item), s.item);
    }
}

TEST_CASE("reciclable: no se come, no cura, no es sustancia ni material") {
    const auto& d = data();
    CHECK(d.item("lata")->recyclable());
    CHECK(d.item("anillo")->recyclable());
    CHECK_FALSE(d.item("pan")->recyclable());
    CHECK_FALSE(d.item("vacuna")->recyclable());
    CHECK_FALSE(d.item("pastilla")->recyclable());
    CHECK_FALSE(d.item("lona")->recyclable());
}

TEST_CASE("FIX: todas las recetas usan ítems existentes") {
    const auto& d = data();
    CHECK(d.recipes.size() == 3);
    for (const auto& r : d.recipes) {
        CHECK_MESSAGE(d.item(r.result), r.id);
        for (const auto& [id, qty] : r.ingredients) {
            CHECK_MESSAGE(d.item(id), id);
            CHECK(qty > 0);
        }
    }
}

TEST_CASE("FIX: toda cura apunta a una enfermedad que existe") {
    const auto& d = data();
    int cures = 0;
    for (const auto& it : d.items) {
        if (!it.cure) continue;
        ++cures;
        CHECK_MESSAGE(d.disease(*it.cure), it.id);
    }
    CHECK(cures == 6);
}

TEST_CASE("FIX: surv2 y desplazado reducen la enfermedad con un multiplicador") {
    const auto& d = data();
    CHECK(d.talent("surv2")->effects.at("diseaseResistMult") == doctest::Approx(0.6));
    CHECK(d.talent("surv2")->effects.count("diseaseResist") == 0);
    CHECK(d.origin("desplazado")->effects.at("diseaseResistMult") == doctest::Approx(0.7));
}

TEST_CASE("el árbol de talentos es consistente") {
    const auto& d = data();
    for (const auto& t : d.talents) {
        CHECK(t.cost >= 1);
        for (const auto& req : t.prereqs) CHECK_MESSAGE(d.talent(req), t.id);
    }
    CHECK(d.talent("collector1")->prereqs.empty());
    CHECK(d.talent("crime3")->cost == 2);
}

TEST_CASE("cambuche y sueño: requisitos con materiales reales") {
    const auto& d = data();
    for (const auto& p : d.cambuche) {
        for (const auto& [id, qty] : p.req) CHECK_MESSAGE(d.item(id), id);
        if (!p.needs.empty()) CHECK(p.needs == "base");
    }
    CHECK(d.sleep.energia == 45);
    CHECK(d.sleep.roboProb == doctest::Approx(0.25));
}

TEST_CASE("JSON inválido o incompleto lanza excepción") {
    CHECK_THROWS(GameData::parse("{ no es json"));
    CHECK_THROWS_WITH_AS(GameData::parse("{}"), doctest::Contains("game_data.json inválido"), std::runtime_error);
    CHECK_THROWS(GameData::load("/ruta/inexistente.json"));
}
