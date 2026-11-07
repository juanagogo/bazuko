#include <doctest/doctest.h>

#include <cmath>
#include <limits>

#include "world/Bogota.h"
#include "world/BusService.h"
#include "world/TrafficSystem.h"
#include "test_util.h"

using namespace bazuko;
using testutil::ConstRng;

namespace {
std::vector<TrafficRoute> one(double l, double r, double t, double b) {
    std::vector<TrafficRoute> v;
    v.emplace_back(l, r, t, b);
    return v;
}
double dist(const Vec3& a, const Vec3& b) { return std::hypot(a.x - b.x, a.z - b.z); }
}  // namespace

TEST_CASE("descartar peatones lejanos mantiene el mismo frenado en rectas y giros") {
    ConstRng rng(0.5);
    TrafficSystem traffic(one(0, 30, 0, 30), 1, rng);
    auto& vehicle = traffic.vehicles()[0];
    const TrafficRoute& route = traffic.routes()[0];
    std::vector<Vec3> pedestrians;
    for (double x = -4; x <= 34; x += 2)
        for (double z = -4; z <= 34; z += 2) pedestrians.push_back({x, 0, z});

    for (double distance = 0; distance < route.length(); distance += 0.75) {
        vehicle.distance = distance;
        vehicle.speed = 5;
        Vec3 dir;
        route.sample(distance, vehicle.position, dir);
        const double actual = traffic.clearance(0, nullptr, pedestrians);

        const double lookAhead = std::max(5.0, vehicle.speed * vehicle.speed / 10 + vehicle.speed * 0.2 + 2);
        double expected = std::numeric_limits<double>::infinity();
        for (double ahead = 0; ahead <= lookAhead; ahead += 0.5) {
            Vec3 pos, d;
            route.sample(distance + ahead, pos, d);
            bool any = false;
            for (const Vec3& p : pedestrians) any |= TrafficSystem::personInCar(p, pos, d, vehicle);
            if (any) { expected = std::max(0.0, ahead - 0.5); break; }
        }
        CHECK(actual == expected);
    }
    // Un peatón lejano no afecta.
    CHECK(traffic.clearance(0, nullptr, {{500, 0, 500}}) == std::numeric_limits<double>::infinity());
}

TEST_CASE("los circuitos son continuos y toda la carrocería permanece en la calzada") {
    const Bogota city;
    for (const TrafficRoute& route : city.trafficRoutes()) {
        Vec3 pos, dir;
        for (double distance = 0; distance < route.length(); distance += 0.1) {
            route.sample(distance, pos, dir);
            REQUIRE(std::abs(std::hypot(dir.x, dir.z) - 1) < 1e-8);
            for (double forward : {-2.15, -1.0, 0.0, 1.0, 2.15})
                for (double sideways : {-0.88, 0.0, 0.88}) {
                    const double x = pos.x + dir.x * forward - dir.z * sideways;
                    const double z = pos.z + dir.z * forward + dir.x * sideways;
                    const int tx = static_cast<int>(jsRound(x / 2)), tz = static_cast<int>(jsRound(z / 2));
                    REQUIRE_MESSAGE((city.map().inside(tx, tz) && city.map().at(tx, tz) == Tile::Road),
                                    "carro fuera del carril: ", x, ",", z);
                }
        }
        Vec3 first, end;
        route.sample(0, first, dir);
        route.sample(route.length(), end, dir);
        CHECK(dist(first, end) < 1e-8);
        route.sample(route.length() - 0.001, end, dir);
        CHECK(dist(first, end) < 0.002);
    }
}

TEST_CASE("un circuito sin espacio para los giros es inválido") {
    CHECK_THROWS_AS(TrafficRoute(0, 2, 0, 30), std::invalid_argument);
    CHECK_THROWS_AS(TrafficRoute(0, 30, 0, 30, 0), std::invalid_argument);
}

TEST_CASE("el tráfico recorre vueltas completas y mantiene la distancia") {
    ConstRng rng(0.7);
    TrafficSystem traffic(one(14, 44, 26, 60), 4, rng);
    traffic.vehicles()[1].cruiseSpeed = 1.4;
    std::vector<double> starts;
    for (const auto& v : traffic.vehicles()) starts.push_back(v.distance);
    bool passedSeam = false;
    const double len = traffic.routes()[0].length();
    for (int frame = 0; frame < 1500; ++frame) {
        std::vector<double> previous;
        for (const auto& v : traffic.vehicles()) previous.push_back(v.distance);
        traffic.update(0.1, nullptr, {});
        for (size_t i = 0; i < traffic.vehicles().size(); ++i) {
            const auto& v = traffic.vehicles()[i];
            if (v.distance < previous[i]) passedSeam = true;
            for (const auto& other : traffic.vehicles()) {
                if (&other == &v) continue;
                const double gap = std::fmod(other.distance - v.distance + len, len);
                REQUIRE(gap >= (v.length + other.length) / 2 + 1.8 - 1e-6);
            }
            REQUIRE((v.speed >= 0 && v.speed <= v.cruiseSpeed + 1e-6));
        }
    }
    CHECK(passedSeam);
    for (size_t i = 0; i < traffic.vehicles().size(); ++i) CHECK(traffic.vehicles()[i].distance != starts[i]);
}

TEST_CASE("los carros frenan ante el jugador o un peatón y reanudan la marcha") {
    for (const char* type : {"player", "pedestrian"}) {
        ConstRng rng(0.5);
        TrafficSystem traffic(one(0, 30, 0, 34), 1, rng);
        auto& v = traffic.vehicles()[0];
        v.distance = 2;
        v.speed = v.cruiseSpeed;
        Vec3 actor, dir;
        traffic.routes()[0].sample(v.distance + 9, actor, dir);
        const bool isPlayer = std::string(type) == "player";
        const std::vector<Vec3> peds = isPlayer ? std::vector<Vec3>{} : std::vector<Vec3>{actor};
        for (int frame = 0; frame < 200; ++frame) traffic.update(0.1, isPlayer ? &actor : nullptr, peds);
        CHECK(v.speed == 0);
        CHECK(dist(v.position, actor) >= v.length / 2 + 0.55);
        const double stopped = v.distance;
        for (int frame = 0; frame < 40; ++frame) traffic.update(0.1, nullptr, {});
        CHECK(v.distance > stopped + 3);
    }
}

TEST_CASE("el tráfico real de Bogotá arranca con carros en cada circuito") {
    const Bogota city;
    ConstRng rng(0.5);
    TrafficSystem traffic(city.trafficRoutes(), 4, rng);
    CHECK(traffic.routes().size() == 6);
    CHECK(traffic.vehicles().size() > 6);
    for (int i = 0; i < 600; ++i) traffic.update(0.1, nullptr, {});  // 1 min de juego sin errores
    for (const auto& v : traffic.vehicles()) CHECK(std::isfinite(v.position.x));
}

// ---------- bus ----------

TEST_CASE("el bus completo recorre la troncal sin invadir estación, separadores, andenes ni muros") {
    const Bogota city;
    const BusRoute route = city.busRoute();
    const double stationX = caracas().busway.a + caracas().busway.b;
    CHECK(route.x - kBusWidth / 2 > stationX + 1.6);
    CHECK(route.x + kBusWidth / 2 < caracas().busway.b * 2 + 1 - 0.15);
    for (double z = route.endZ; z <= route.startZ; z += 0.1) {
        for (double along = -kBusLength / 2; along <= kBusLength / 2; along += 0.5)
            for (double side : {-kBusWidth / 2, 0.0, kBusWidth / 2}) {
                const int tx = static_cast<int>(jsRound((route.x + side) / 2));
                const int tz = static_cast<int>(jsRound((z + along) / 2));
                REQUIRE(city.map().inside(tx, tz));
                REQUIRE(isStreet(city.map().at(tx, tz)));
            }
    }
}

TEST_CASE("el servicio avanza, para cuatro segundos en la estación y repite el recorrido") {
    const Bogota city;
    BusService bus(city.busRoute());
    double dwell = 0;
    bool arrived = false, departed = false, relayed = false;
    for (int i = 0; i < 2400; ++i) {
        const double before = bus.position.z;
        bus.update(0.05, nullptr, {});
        if (bus.dwellRemaining > 0) {
            arrived = true;
            dwell += 0.05;
            CHECK(bus.position.z == bus.route().stationZ);
            CHECK(bus.speed == 0);
        }
        if (arrived && bus.position.z < bus.route().stationZ - 1) departed = true;
        if (bus.position.z > before) {
            CHECK(bus.opacity() == 0);  // el relevo es invisible
            relayed = true;
            break;
        }
        REQUIRE(before - bus.position.z <= 5 * 0.05 + 1e-8);
    }
    CHECK((arrived && departed && relayed));
    CHECK(dwell >= 3.95);
    CHECK(dwell <= 4.1);
}

TEST_CASE("el bus frena ante el jugador y los peatones, y reanuda cuando despejan") {
    for (const char* who : {"player", "pedestrian"}) {
        const Bogota city;
        BusService bus(city.busRoute());
        for (int i = 0; i < 60; ++i) bus.update(0.05, nullptr, {});
        const Vec3 person{bus.position.x, 0, bus.position.z - kBusLength / 2 - 10};
        const bool isPlayer = std::string(who) == "player";
        for (int i = 0; i < 200; ++i)
            bus.update(0.05, isPlayer ? &person : nullptr, isPlayer ? std::vector<Vec3>{} : std::vector<Vec3>{person});
        CHECK(bus.speed < 1e-8);
        CHECK(bus.position.z - kBusLength / 2 >= person.z + 0.79);
        const double stopped = bus.position.z;
        for (int i = 0; i < 40; ++i) bus.update(0.05, nullptr, {});
        CHECK(bus.position.z < stopped - 1);
    }
}

TEST_CASE("la estación debe estar dentro del recorrido del bus") {
    CHECK_THROWS_AS(BusService({0, 10, 0, 20}), std::invalid_argument);
    CHECK_THROWS_AS(BusService({0, 100, 0, -5}), std::invalid_argument);
}

TEST_CASE("la opacidad del bus se desvanece en los extremos") {
    BusService bus({0, 100, 0, 50});
    CHECK(bus.opacity() == 0);  // empieza en startZ: aún invisible
    for (int i = 0; i < 200; ++i) bus.update(0.05, nullptr, {});
    CHECK(bus.opacity() > 0);
}
