#include <doctest/doctest.h>

#include <filesystem>
#include <fstream>
#include <random>

#include "game/systems/SaveSystem.h"
#include "test_util.h"

using namespace bazuko;
using testutil::data;
namespace fs = std::filesystem;

namespace {

// Directorio temporal propio de cada test, borrado al salir.
struct TempDir {
    fs::path path;
    TempDir() {
        std::random_device rd;
        path = fs::temp_directory_path() / ("bazuko-test-" + std::to_string(rd()));
        fs::create_directories(path);
    }
    ~TempDir() { std::error_code ec; fs::remove_all(path, ec); }
    std::string file(const char* name) const { return (path / name).string(); }
};

void write(const std::string& path, const std::string& text) {
    std::ofstream(path) << text;
}

// Partida tal cual la guardaba el juego web en localStorage (v2).
const char* kWebV2 = R"({
  "stats":{"hambre":70,"sed":60,"energia":50,"salud":90,"higiene":80,"animo":40,"vicio":30,"dinero":12500,"xp":42,"level":3},
  "clock":{"day":4,"hour":13.5},
  "inventory":{"items":[{"id":"lata","name":"Lata vacía","weight":0.2,"value":250,"qty":3},{"id":"viejo","qty":9}]},
  "talents":{"points":2,"unlocked":{"collector1":true,"surv1":true}},
  "diseases":{"active":{"intoxication":{"timeLeft":12.5},"gripe":{"timeLeft":3}}},
  "player":{"pos":[52,0,25]},
  "worldLayoutVersion":3,
  "look":{"v":2,"nombre":"Jairo","origen":"reciclador"},
  "built":{"base":true,"techo":true},
  "costal":true,
  "v":2})";

}  // namespace

TEST_CASE("capturar y aplicar la partida conserva todo el estado") {
    GameState a(data());
    a.stats.dinero = 777;
    a.stats.hambre = 33;
    a.stats.level = 4;
    a.clock.day = 3;
    a.clock.hour = 17.25;
    a.inventory.add("lata", 4);
    a.inventory.add("pan", 1);
    a.talents.restore(1, {"surv1"});
    a.diseases.restore({{"sarna", 20}});
    a.built = {{"base", true}, {"vela", true}};
    a.costal = true;

    SaveData d = capture(a);
    d.playerPos = std::array<double, 3>{1.5, 0, -2};
    d.worldLayoutVersion = 3;
    d.lookJson = R"({"nombre":"Wilmer"})";

    SaveData back = parse(serialize(d));
    CHECK(back.playerPos.value()[2] == -2);
    CHECK(back.worldLayoutVersion == 3);
    CHECK(back.lookJson == R"({"nombre":"Wilmer"})");

    GameState b(data());
    apply(b, back);
    CHECK(b.stats.dinero == 777);
    CHECK(b.stats.hambre == 33);
    CHECK(b.stats.level == 4);
    CHECK(b.clock.day == 3);
    CHECK(b.clock.hour == doctest::Approx(17.25));
    CHECK(b.inventory.count("lata") == 4);
    CHECK(b.inventory.count("pan") == 1);
    CHECK(b.talents.has("surv1"));
    CHECK(b.talents.points() == 1);
    CHECK(b.diseases.active().at("sarna") == 20);
    CHECK(b.hasBuilt("vela"));
    CHECK(b.costal);
    CHECK(b.inventory.maxWeight == 40);  // el costal se aplica al cargar
}

TEST_CASE("lee una partida v2 del juego web y migra ids antiguos") {
    SaveData d = parse(kWebV2);
    CHECK(d.stats.dinero == 12500);
    CHECK(d.stats.level == 3);
    CHECK(d.day == 4);
    CHECK(d.hour == 13.5);
    REQUIRE(d.inventory.size() == 2);
    CHECK(d.inventory[0] == std::make_pair(std::string("lata"), 3));
    CHECK(d.talentPoints == 2);
    CHECK(d.talents == std::set<std::string>{"collector1", "surv1"});
    CHECK(d.diseases.at("intoxicacion") == 12.5);  // 'intoxication' -> 'intoxicacion'
    CHECK(d.diseases.at("gripe") == 3);
    CHECK(d.playerPos.value()[0] == 52);
    CHECK(d.worldLayoutVersion == 3);
    CHECK(d.lookJson.find("Jairo") != std::string::npos);
    CHECK(d.built.at("techo"));
    CHECK(d.costal);

    GameState g(data());
    apply(g, d);
    CHECK(g.inventory.count("viejo") == 0);  // ítem que ya no existe: se descarta
    CHECK(g.diseases.active().count("intoxicacion") == 1);
}

TEST_CASE("una partida v1 (sin versión) convierte dólares a pesos") {
    SaveData d = parse(R"({"stats":{"dinero":10,"saludMental":55},"clock":{"day":1,"hour":8}})");
    CHECK(d.stats.dinero == 2500);
    CHECK(d.stats.animo == 55);  // alias antiguo de ánimo
}

TEST_CASE("campos ausentes toman el valor por defecto en vez de fallar") {
    SaveData d = parse(R"({"v":3})");
    CHECK(d.stats.vicio == 80);
    CHECK(d.day == 1);
    CHECK(d.hour == 6);
    CHECK_FALSE(d.playerPos);
    CHECK(d.lookJson.empty());
}

TEST_CASE("texto inválido o de una versión futura lanza excepción") {
    CHECK_THROWS_AS(parse("{ roto"), std::exception);
    CHECK_THROWS_AS(parse("[1,2]"), std::runtime_error);
    CHECK_THROWS_AS(parse(R"({"v":99})"), std::runtime_error);
}

TEST_CASE("guardar y cargar desde disco, con escritura atómica") {
    TempDir tmp;
    SaveSystem sys(tmp.file("sub/dir/save.json"));  // crea los directorios que falten
    CHECK_FALSE(sys.load().data);
    CHECK(sys.load().error.empty());  // primera partida: no es un error

    SaveData d;
    d.stats.dinero = 4321;
    std::string err;
    REQUIRE(sys.save(d, &err));
    CHECK(err.empty());
    CHECK_FALSE(fs::exists(sys.path() + ".tmp"));

    auto r = sys.load();
    REQUIRE(r.data);
    CHECK(r.data->stats.dinero == 4321);

    d.stats.dinero = 1;
    REQUIRE(sys.save(d));  // sobrescribe
    CHECK(sys.load().data->stats.dinero == 1);

    sys.clear();
    CHECK_FALSE(sys.load().data);
}

TEST_CASE("un guardado corrupto no rompe el juego y se conserva aparte") {
    TempDir tmp;
    SaveSystem sys(tmp.file("save.json"));
    write(sys.path(), "{\"stats\": {\"dinero\": ");  // truncado
    auto r = sys.load();
    CHECK_FALSE(r.data);
    CHECK(r.corrupt);
    CHECK_FALSE(r.error.empty());
    CHECK_FALSE(fs::exists(sys.path()));
    CHECK(fs::exists(sys.path() + ".corrupt"));
    // y se puede volver a guardar encima
    CHECK(sys.save(SaveData{}));
}

TEST_CASE("no se puede guardar en una ruta imposible") {
    TempDir tmp;
    write(tmp.file("archivo"), "x");
    SaveSystem sys(tmp.file("archivo/save.json"));  // 'archivo' es un fichero, no un directorio
    std::string err;
    CHECK_FALSE(sys.save(SaveData{}, &err));
    CHECK_FALSE(err.empty());
}

TEST_CASE("el autoguardado pide guardar cada intervalo") {
    AutoSaver a(60);
    CHECK_FALSE(a.update(30));
    CHECK(a.update(30));
    CHECK_FALSE(a.update(59));
    CHECK(a.update(2));
}

TEST_CASE("la ruta por defecto usa XDG_DATA_HOME o ~/.local/share") {
    const std::string p = defaultSavePath();
    CHECK(p.size() > std::string("bazuko/save.json").size());
    CHECK(p.find("bazuko/save.json") != std::string::npos);
}
