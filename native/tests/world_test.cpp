#include <doctest/doctest.h>

#include <fstream>
#include <set>
#include <sstream>

#include <nlohmann/json.hpp>

#include "world/Bogota.h"
#include "world/PedestrianAgent.h"
#include "test_util.h"

using namespace bazuko;
using nlohmann::json;

namespace {

const json& ref() {
    static const json j = [] {
        std::ifstream f(std::string(BAZUKO_DATA_DIR) + "/world_reference.json");
        REQUIRE_MESSAGE(f.good(), "falta data/world_reference.json: node tools/export_world.mjs");
        return json::parse(f);
    }();
    return j;
}

const Bogota& city() {
    static const Bogota b;
    return b;
}

constexpr double kEps = 1e-9;

}  // namespace

// ---------- trazado: paridad exacta con el código JS ----------

TEST_CASE("el mapa de 120x111 tiles es idéntico al del juego web") {
    const auto& rows = ref()["rows"];
    REQUIRE(city().width() == ref()["width"].get<int>());
    REQUIRE(city().height() == ref()["height"].get<int>());
    REQUIRE(static_cast<int>(rows.size()) == city().height());
    for (int z = 0; z < city().height(); ++z) CHECK_MESSAGE(city().map().row(z) == rows[z].get<std::string>(), "fila ", z);
    CHECK(city().populationScale() == doctest::Approx(3.0));
}

TEST_CASE("ejes de calles: anchos, bandas y conversiones coinciden") {
    const auto& s = ref()["streets"];
    CHECK(streetX().widths == s["x"]["widths"].get<std::vector<int>>());
    CHECK(streetZ().widths == s["z"]["widths"].get<std::vector<int>>());
    CHECK(streetX().size == 74);
    CHECK(streetZ().size == 60);
    CHECK(originalCityWidth() == 74);
    CHECK(originalCityHeight() == 60);

    auto sameBands = [](const std::vector<Band>& got, const json& want) {
        REQUIRE(got.size() == want.size());
        for (size_t i = 0; i < got.size(); ++i) {
            CHECK(got[i].a == want[i][0].get<int>());
            CHECK(got[i].b == want[i][1].get<int>());
            CHECK(got[i].name == want[i][2].get<std::string>());
        }
    };
    sameBands(carreras(), s["carreras"]);
    sameBands(calles(), s["calles"]);
    sameBands(cityCarreras(), s["cityCarreras"]);
    sameBands(cityCalles(), s["cityCalles"]);
    CHECK(caracas().lanes[0].a == s["caracas"]["lanes"][0][0].get<int>());
    CHECK(caracas().lanes[1].b == s["caracas"]["lanes"][1][1].get<int>());
    CHECK(caracas().busway.a == s["caracas"]["busway"][0].get<int>());
    CHECK(caracas().busway.b == s["caracas"]["busway"][1].get<int>());
    // Cada calzada ocupa 6 tiles (12 m).
    for (const auto& b : cityCarreras()) CHECK(b.b - b.a + 1 == 6);
    for (const auto& b : cityCalles()) CHECK(b.b - b.a + 1 == 6);

    const auto& parks = s["parks"];
    REQUIRE(extensionParks().size() == parks.size());
    for (size_t i = 0; i < parks.size(); ++i) {
        CHECK(extensionParks()[i].x0 == parks[i]["x0"].get<int>());
        CHECK(extensionParks()[i].z1 == parks[i]["z1"].get<int>());
    }

    auto sameAxis = [](const StreetAxis& axis, const json& samples) {
        for (const auto& row : samples) {
            const double v = row[0];
            CHECK(axis.tile(v) == doctest::Approx(row[1].get<double>()).epsilon(kEps));
            CHECK(axis.world(v) == doctest::Approx(row[2].get<double>()).epsilon(kEps));
            CHECK(axis.original(axis.tile(v)) == doctest::Approx(row[3].get<double>()).epsilon(kEps));
        }
    };
    sameAxis(streetX(), s["axisSamplesX"]);
    sameAxis(streetZ(), s["axisSamplesZ"]);
}

TEST_CASE("tile() y original() son inversas") {
    for (const StreetAxis* axis : {&streetX(), &streetZ()})
        for (double v = 0; v <= 47; v += 0.125) CHECK(axis->original(axis->tile(v)) == doctest::Approx(v).epsilon(1e-8));
}

TEST_CASE("migrar posiciones guardadas de versiones anteriores") {
    for (const auto& m : ref()["streets"]["migrations"]) {
        const auto& from = m["from"];
        const Vec3 got = migrateStreetPosition({from[0], from[1], from[2]}, m["version"].get<int>());
        CHECK(got.x == doctest::Approx(m["to"][0].get<double>()).epsilon(kEps));
        CHECK(got.y == doctest::Approx(m["to"][1].get<double>()).epsilon(kEps));
        CHECK(got.z == doctest::Approx(m["to"][2].get<double>()).epsilon(kEps));
    }
    // v2 y v3 no mueven nada.
    const Vec3 p = migrateStreetPosition({52, 0.1, 23}, 3);
    CHECK(p.x == 52);
    CHECK(p.z == 23);
}

// ---------- invariantes de city.test.js / street-layout.test.js ----------

TEST_CASE("la ciudad ampliada conserva el centro y rodea todo con muros") {
    const TileMap center = expandStreets(buildOriginalLayout());
    CHECK(center.width() == 74);
    CHECK(center.height() == 60);
    const TileMap& map = city().map();
    for (int z = 0; z < originalCityHeight() - 1; ++z)
        for (int x = 0; x < originalCityWidth() - 1; ++x) CHECK(map.at(x, z) == center.at(x, z));
    for (int x = 0; x < map.width(); ++x) CHECK((map.at(x, 0) == Tile::Wall && map.at(x, map.height() - 1) == Tile::Wall));
    for (int z = 0; z < map.height(); ++z) CHECK((map.at(0, z) == Tile::Wall && map.at(map.width() - 1, z) == Tile::Wall));
}

TEST_CASE("las zonas reservadas son caminables y coinciden con la referencia") {
    const auto& r = ref()["reserved"];
    const Reserved& got = city().reserved();
    CHECK(got.spawn.x == doctest::Approx(r["spawn"]["x"].get<double>()));
    CHECK(got.shop.z == doctest::Approx(r["shop"]["z"].get<double>()));
    CHECK(got.bed.x == doctest::Approx(141));
    CHECK(got.bed.z == doctest::Approx(104));
    for (const Spot* s : got.all()) CHECK(city().isWalkableAt(s->x, s->z));
    CHECK(city().isNearReserved(got.spawn.x + 1, got.spawn.z));
    CHECK_FALSE(city().isNearReserved(got.spawn.x + 20, got.spawn.z + 20));
}

TEST_CASE("la rejilla de aparición coincide con la referencia") {
    const auto grid = city().spawnGrid();
    const auto& want = ref()["spawnGrid"];
    REQUIRE(grid.size() == want.size());
    CHECK(grid.size() > 100);
    for (size_t i = 0; i < grid.size(); ++i) {
        CHECK(grid[i].x == want[i][0].get<double>());
        CHECK(grid[i].z == want[i][1].get<double>());
    }
}

TEST_CASE("los puestos de parqueo coinciden y quedan fuera de los circuitos") {
    const auto spots = city().parkingSpots();
    const auto& want = ref()["parking"];
    REQUIRE(spots.size() == want.size());
    CHECK(spots.size() >= 5);
    for (size_t i = 0; i < spots.size(); ++i) {
        CHECK(spots[i].x == doctest::Approx(want[i]["x"].get<double>()).epsilon(kEps));
        CHECK(spots[i].z == doctest::Approx(want[i]["z"].get<double>()).epsilon(kEps));
        CHECK(spots[i].rot == doctest::Approx(want[i]["rot"].get<double>()).epsilon(kEps));
        CHECK((spots[i].z < (calles()[0].a - 2) * 2 || spots[i].z > (calles()[1].b + 2) * 2));
    }
}

TEST_CASE("los seis circuitos de tráfico coinciden muestra a muestra") {
    const auto routes = city().trafficRoutes();
    const auto& want = ref()["trafficRoutes"];
    REQUIRE(routes.size() == 6);
    REQUIRE(want.size() == 6);
    for (size_t i = 0; i < routes.size(); ++i) {
        CHECK(routes[i].length() == doctest::Approx(want[i]["length"].get<double>()).epsilon(kEps));
        for (const auto& s : want[i]["samples"]) {
            Vec3 pos, dir;
            routes[i].sample(s[0], pos, dir);
            CHECK(pos.x == doctest::Approx(s[1].get<double>()).epsilon(kEps));
            CHECK(pos.z == doctest::Approx(s[2].get<double>()).epsilon(kEps));
            CHECK(dir.x == doctest::Approx(s[3].get<double>()).epsilon(kEps));
            CHECK(dir.z == doctest::Approx(s[4].get<double>()).epsilon(kEps));
        }
    }
}

TEST_CASE("la ruta del bus coincide con la referencia") {
    const BusRoute b = city().busRoute();
    const auto& w = ref()["bus"];
    CHECK(b.x == doctest::Approx(w["x"].get<double>()));
    CHECK(b.startZ == doctest::Approx(w["startZ"].get<double>()));
    CHECK(b.endZ == doctest::Approx(w["endZ"].get<double>()));
    CHECK(b.stationZ == doctest::Approx(w["stationZ"].get<double>()));
    CHECK(b.startZ < (city().height() - 1) * 2.0);  // dentro de la ciudad ampliada
}

// ---------- colisiones ----------

TEST_CASE("las cajas de colisión del mapa coinciden con las del juego web") {
    const CollisionWorld w = city().buildCollisions();
    const auto& want = ref()["collisions"]["boxes"];
    REQUIRE(w.boxes().size() == want.size());
    for (size_t i = 0; i < want.size(); ++i) {
        const Aabb& b = w.boxes()[i];
        CHECK(b.min.x == doctest::Approx(want[i][0].get<double>()).epsilon(kEps));
        CHECK(b.min.y == doctest::Approx(want[i][1].get<double>()).epsilon(kEps));
        CHECK(b.min.z == doctest::Approx(want[i][2].get<double>()).epsilon(kEps));
        CHECK(b.max.x == doctest::Approx(want[i][3].get<double>()).epsilon(kEps));
        CHECK(b.max.y == doctest::Approx(want[i][4].get<double>()).epsilon(kEps));
        CHECK(b.max.z == doctest::Approx(want[i][5].get<double>()).epsilon(kEps));
    }
}

TEST_CASE("resolveMove da los mismos resultados que el juego web en 400 casos") {
    const CollisionWorld w = city().buildCollisions();
    for (const auto& m : ref()["collisions"]["moves"]) {
        const Vec3 r = w.resolveMove({m[0], 0, m[1]}, {m[2], 0, m[3]});
        CHECK(r.x == doctest::Approx(m[4].get<double>()).epsilon(kEps));
        CHECK(r.z == doctest::Approx(m[5].get<double>()).epsilon(kEps));
    }
}

TEST_CASE("rozar una pared larga no teletransporta") {
    CollisionWorld w;
    w.add({47, 0, 0}, {96, 8, 2});
    const Vec3 start{47, 0, -1.4}, delta{0.02, 0, -0.03};
    const Vec3 r = w.resolveMove(start, delta);
    CHECK(std::hypot(r.x - start.x, r.z - start.z) <= std::hypot(delta.x, delta.z) + 1e-8);
    CHECK(std::hypot(r.x - (start.x + delta.x), r.z - (start.z + delta.z)) < 1e-8);
}

TEST_CASE("pasos largos se detienen, se desliza y el jugador quieto no se mueve") {
    CollisionWorld w;
    w.add({5, 0, 5}, {2, 8, 10});
    Vec3 a = w.resolveMove({0, 0, 5}, {20, 0, 1});
    CHECK(a.x == doctest::Approx(3.6));
    CHECK(a.z == doctest::Approx(6));
    Vec3 b = w.resolveMove({10, 0, 5}, {-20, 0, 0});
    CHECK(b.x == doctest::Approx(6.4));
    Vec3 still = w.resolveMove({4, 0, 5}, {0, 0, 0});
    CHECK(still.x == 4);
    Vec3 out = w.resolveMove({4, 0, 5}, {-0.1, 0, 0});
    CHECK(std::abs(out.x - 4) <= 0.100001);
}

TEST_CASE("cada desplazamiento junto a las paredes reales queda acotado") {
    const CollisionWorld w = city().buildCollisions();
    int checked = 0;
    for (const Aabb& box : w.boxes()) {
        for (double z : {box.min.z - 0.4, box.max.z + 0.4}) {
            for (double x : {box.min.x - 0.4, (box.min.x + box.max.x) / 2, box.max.x + 0.4}) {
                const Vec3 start{x, 0, z};
                for (double dx : {-0.3, 0.0, 0.3})
                    for (double dz : {-0.3, 0.0, 0.3}) {
                        const Vec3 r = w.resolveMove(start, {dx, 0, dz});
                        REQUIRE(std::hypot(r.x - start.x, r.z - start.z) <= std::hypot(dx, dz) + 1e-7);
                        ++checked;
                    }
            }
        }
    }
    CHECK(checked > 10000);
}

// ---------- peatones ----------

TEST_CASE("la red peatonal coincide con la del juego web") {
    const auto nav = city().createPedestrianNavigation();
    const auto& p = ref()["pedestrians"];
    CHECK(static_cast<int>(nav.nodes().size()) == p["nodes"].get<int>());
    int crossing = 0, edges = 0;
    for (const auto& n : nav.nodes()) { crossing += n.crossing; edges += static_cast<int>(n.neighbors.size()); }
    CHECK(crossing == p["crossing"].get<int>());
    CHECK(edges == p["edges"].get<int>());
}

TEST_CASE("las rutas aleatorias reproducen las del juego web con la misma semilla") {
    const auto nav = city().createPedestrianNavigation();
    Mulberry32Rng rng(777);
    for (const auto& r : ref()["pedestrians"]["routes"]) {
        Vec3 start;
        // el punto de partida de la referencia ya es un nodo
        start = {r["start"][0], 0, r["start"][1]};
        const auto route = nav.createRoute(start, rng);
        REQUIRE(route.size() == r["route"].size());
        for (size_t i = 0; i < route.size(); ++i) {
            CHECK(route[i].x == doctest::Approx(r["route"][i][0].get<double>()));
            CHECK(route[i].z == doctest::Approx(r["route"][i][1].get<double>()));
        }
    }
}

TEST_CASE("la población: 66 peatones iguales a la referencia y 6 vendedores") {
    const auto nav = city().createPedestrianNavigation();
    const auto people = city().pedestrianSpawns(nav);
    const auto& want = ref()["pedestrians"]["people"];
    REQUIRE(people.size() == want.size());
    CHECK(people.size() == 66);
    CHECK(people.size() + city().vendors().size() == 72);
    for (size_t i = 0; i < people.size(); ++i) {
        CHECK(people[i].x == doctest::Approx(want[i][0].get<double>()));
        CHECK(people[i].z == doctest::Approx(want[i][1].get<double>()));
        CHECK(nav.isWalkableAt(people[i].x, people[i].z));
    }
    const Reserved& rs = city().reserved();
    bool nearSpawn = false;
    for (const Vec3& p : people) nearSpawn |= std::hypot(p.x - rs.spawn.x, p.z - rs.spawn.z) < 5;
    CHECK(nearSpawn);

    const auto& vw = ref()["vendors"];
    REQUIRE(city().vendors().size() == vw.size());
    for (size_t i = 0; i < vw.size(); ++i) {
        const Vendor& v = city().vendors()[i];
        CHECK(v.x == doctest::Approx(vw[i]["x"].get<double>()));
        CHECK(v.z == doctest::Approx(vw[i]["z"].get<double>()));
        CHECK(v.rotY == doctest::Approx(vw[i]["rot"].get<double>()));
        CHECK(v.title == vw[i]["title"].get<std::string>());
        CHECK(v.items == vw[i]["items"].get<std::vector<std::string>>());
        CHECK(((v.kind == VendorKind::Fritanga) == (vw[i]["kind"].get<std::string>() == "fritanga")));
        for (const auto& id : v.items) CHECK_MESSAGE(testutil::data().item(id), id);
    }
}

TEST_CASE("las rutas rodean edificios sin diagonales y no cruzan componentes aislados") {
    TileMap m(5, 3, Tile::Sidewalk);
    for (int z = 0; z < 3; ++z) m.at(3, z) = Tile::Wall;
    m.at(1, 1) = Tile::Building;
    PedestrianNavigation nav(m, 2);
    for (std::uint32_t seed = 1; seed <= 30; ++seed) {
        Mulberry32Rng rng(seed);
        const auto route = nav.createRoute({0, 0, 0}, rng);
        REQUIRE(route.size() > 1);
        for (size_t i = 0; i < route.size(); ++i) {
            CHECK(route[i].x <= 4);
            CHECK(nav.isWalkableAt(route[i].x, route[i].z));
            if (i) CHECK(std::abs(route[i].x - route[i - 1].x) + std::abs(route[i].z - route[i - 1].z) == 2);
        }
    }
    TileMap single(1, 1, Tile::Sidewalk);
    PedestrianNavigation isolated(single, 2);
    testutil::ConstRng c(0.5);
    CHECK(isolated.createRoute({0, 0, 0}, c).empty());
    CHECK(nav.createRoute({-100, 0, 0}, c).empty());
}

TEST_CASE("en Bogotá los recorridos usan andenes y cruces, evitan tienda y estación") {
    const auto nav = city().createPedestrianNavigation();
    auto point = [](double x, double z) { return std::pair{streetX().world(x / 2), streetZ().world(z / 2)}; };
    auto walkable = [&](double x, double z) { auto p = point(x, z); return nav.isWalkableAt(p.first, p.second); };
    CHECK_FALSE(walkable(68, 58));  // la tienda
    CHECK_FALSE(walkable(48, 42));
    CHECK_FALSE(walkable(12, 40));  // carril fuera de un cruce
    CHECK(walkable(12, 22));        // cruce de la Carrera 15
    int crossings = 0;
    for (auto [sx, sz] : {std::pair{36, 22}, {42, 32}, {56, 38}, {16, 54}, {68, 86}}) {
        for (std::uint32_t seed = 1; seed <= 20; ++seed) {
            Mulberry32Rng rng(seed);
            auto [px, pz] = point(sx, sz);
            Vec3 start;
            REQUIRE(nav.nearestPoint(px, pz, start));
            const auto route = nav.createRoute(start, rng);
            REQUIRE(route.size() > 1);
            for (size_t i = 1; i < route.size(); ++i) {
                const Vec3 &a = route[i - 1], &b = route[i];
                CHECK(std::abs(a.x - b.x) + std::abs(a.z - b.z) == 2);
                if (isStreet(city().map().at(static_cast<int>(b.x / 2), static_cast<int>(b.z / 2)))) ++crossings;
            }
            const Vec3& last = route.back();
            CHECK_FALSE(isStreet(city().map().at(static_cast<int>(last.x / 2), static_cast<int>(last.z / 2))));
        }
    }
    CHECK(crossings > 0);
}

TEST_CASE("los peatones avanzan, siguen nuevas rutas y ajustan su altura") {
    TileMap line(14, 1, Tile::Sidewalk);
    NavOptions opts;
    opts.groundHeight = [](double x, double) { return x < 8 ? 0.12 : 0.0; };
    PedestrianNavigation nav(line, 2, opts);

    testutil::ConstRng always(0.9);
    AgentOptions ao;
    ao.navigation = &nav;
    ao.speed = 1.1;
    ao.isWalkable = [&](double x, double z) { return nav.isWalkableAt(x, z); };
    ao.groundHeight = opts.groundHeight;
    PedestrianAgent agent({0, 0.12, 0}, ao, always);
    double maxX = 0;
    for (int frame = 0; frame < 2400; ++frame) {
        const Vec3 before = agent.position;
        agent.update(0.05, always);
        REQUIRE(std::hypot(agent.position.x - before.x, agent.position.z - before.z) <= 1.1 * 0.05 + 1e-8);
        CHECK(agent.position.y == opts.groundHeight(agent.position.x, 0));
        CHECK(nav.isWalkableAt(agent.position.x, agent.position.z));
        maxX = std::max(maxX, agent.position.x);
    }
    CHECK(maxX > 16);
}

TEST_CASE("toda la población se mueve por la red y los vendedores se quedan quietos") {
    const auto nav = city().createPedestrianNavigation();
    Mulberry32Rng rng(42);
    std::vector<PedestrianAgent> agents;
    for (const Vec3& p : city().pedestrianSpawns(nav)) {
        AgentOptions o;
        o.navigation = &nav;
        o.isWalkable = [&](double x, double z) { return nav.isWalkableAt(x, z); };
        o.groundHeight = [&](double x, double z) { return nav.groundHeightAt(x, z); };
        agents.emplace_back(p, o, rng);
    }
    std::vector<Vec3> starts;
    for (const auto& a : agents) starts.push_back(a.position);
    for (int frame = 0; frame < 100; ++frame)
        for (auto& a : agents) a.update(0.05, rng);
    for (size_t i = 0; i < agents.size(); ++i) {
        CHECK(std::hypot(agents[i].position.x - starts[i].x, agents[i].position.z - starts[i].z) > 0.5);
        CHECK(nav.isWalkableAt(agents[i].position.x, agents[i].position.z));
    }

    AgentOptions vendor;
    vendor.isWalkable = [](double, double) { return false; };
    PedestrianAgent v({5, 0.12, 5}, vendor, rng);
    for (int frame = 0; frame < 100; ++frame) v.update(0.1, rng);
    CHECK(v.position.x == 5);
    CHECK(v.position.y == 0.12);
    CHECK(v.position.z == 5);
}

TEST_CASE("Mulberry32Rng reproduce bit a bit el generador del juego web") {
    for (const auto& [seed, values] : ref()["rngSamples"].items()) {
        Mulberry32Rng r(static_cast<std::uint32_t>(std::stoul(seed)));
        for (const auto& v : values) CHECK(r.next() == v.get<double>());
    }
}
