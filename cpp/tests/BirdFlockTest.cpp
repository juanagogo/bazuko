// Pruebas de BirdFlock (logica pura: sin ventana ni GPU).
// Devuelve 0 si todo pasa. No usa assert() porque en Release se desactiva.
#include "world/BirdFlock.hpp"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <tuple>

using namespace Bazuko;

static int g_failures = 0;
#define CHECK(cond, ...)                                                        \
    do {                                                                        \
        if (!(cond)) {                                                          \
            ++g_failures;                                                       \
            std::printf("FALLO (%s:%d): %s -> ", __FILE__, __LINE__, #cond);    \
            std::printf(__VA_ARGS__);                                           \
            std::printf("\n");                                                  \
        }                                                                       \
    } while (0)

// Mapa de prueba del tamano de la ciudad: prados, ramas y postes repartidos.
static BirdFlock MakeFlock(uint32_t seed) {
    std::mt19937 rng(seed + 100);
    std::uniform_real_distribution<float> X(-115.f, 115.f), Z(-105.f, 105.f);
    std::vector<BirdSpot> spots;
    for (float x = -110; x <= 110; x += 5)
        for (float z = -100; z <= 100; z += 5) spots.push_back({{x, 0.f, z}, BirdPerch::Ground});
    for (int t = 0; t < 30; ++t) {
        const glm::vec3 p(X(rng), 0, Z(rng));
        for (int b = 0; b < 4; ++b)
            spots.push_back({p + glm::vec3(0.6f * std::cos(b * 1.57f), 3.5f + 0.35f * static_cast<float>(b), 0.6f * std::sin(b * 1.57f)),
                             BirdPerch::Tree});
    }
    for (int t = 0; t < 70; ++t) spots.push_back({{X(rng), 4.2f, Z(rng)}, BirdPerch::Pole});
    BirdFlock flock(seed);
    flock.SetSpots(std::move(spots), 2);
    return flock;
}

static const glm::vec3 kFarAway(500.f, 0.f, 500.f);

static void TestDistribution() {
    BirdFlock flock = MakeFlock(1);
    int kinds[3] = {0, 0, 0};
    float minX = 1e9f, maxX = -1e9f, minZ = 1e9f, maxZ = -1e9f;
    for (const Bird& b : flock.Birds()) {
        ++kinds[static_cast<int>(b.perch)];
        minX = std::min(minX, b.position.x); maxX = std::max(maxX, b.position.x);
        minZ = std::min(minZ, b.position.z); maxZ = std::max(maxZ, b.position.z);
    }
    std::printf("aves: %zu (suelo %d, arbol %d, poste %d), cubren %.0f x %.0f m\n", flock.Birds().size(), kinds[0], kinds[1], kinds[2],
                maxX - minX, maxZ - minZ);
    CHECK(flock.Birds().size() == 64, "se esperaban 64 aves, hay %zu", flock.Birds().size());
    CHECK(kinds[0] == 34 && kinds[1] == 14 && kinds[2] == 16, "reparto %d/%d/%d", kinds[0], kinds[1], kinds[2]);
    CHECK(maxX - minX > 150.f && maxZ - minZ > 150.f, "las aves no cubren el mapa");
}

static void TestCalmFlights() {
    BirdFlock flock = MakeFlock(1);
    int takeoffs = 0;
    float maxY = 0.f;
    bool bad = false;
    std::vector<char> was(flock.Birds().size(), 0);
    for (int f = 0; f < 60 * 60; ++f) {
        flock.Update(1.f / 60.f, kFarAway, {});
        for (size_t i = 0; i < flock.Birds().size(); ++i) {
            const Bird& b = flock.Birds()[i];
            if (!std::isfinite(b.position.x + b.position.y + b.position.z + b.pitch + b.yaw)) bad = true;
            if (b.IsFlying()) {
                maxY = std::max(maxY, b.position.y);
                if (!was[i]) ++takeoffs;
            }
            was[i] = b.IsFlying();
        }
    }
    std::printf("60 s tranquilos: %d vuelos, altura maxima %.1f m\n", takeoffs, maxY);
    CHECK(!bad, "hay valores no finitos");
    CHECK(takeoffs > 20, "casi no hay vuelos: %d", takeoffs);
    CHECK(maxY > 5.0f, "no vuelan alto: %.1f m", maxY);
}

// Distancia a la que despega el ave del suelo con mas reposo cuando el jugador se acerca a `speed` m/s.
static std::tuple<float, float> Approach(float speed, uint32_t seed) {
    BirdFlock fl = MakeFlock(seed);
    size_t idx = 0;
    float rest = -1.f;
    for (size_t i = 0; i < fl.Birds().size(); ++i)
        if (fl.Birds()[i].perch == BirdPerch::Ground && fl.Birds()[i].restRemaining > rest) { rest = fl.Birds()[i].restRemaining; idx = i; }
    const glm::vec3 b0 = fl.Birds()[idx].position;
    glm::vec3 player = b0 + glm::vec3(30.f, 0, 0);
    float takeoff = -1.f, peak = 0.f;
    for (int f = 0; f < 60 * 14; ++f) {
        player.x -= speed / 60.f;
        fl.Update(1.f / 60.f, player, {});
        const Bird& b = fl.Birds()[idx];
        if (takeoff < 0.f && b.IsFlying()) takeoff = glm::distance(glm::vec2(player.x, player.z), glm::vec2(b0.x, b0.z));
        if (b.IsFlying()) peak = std::max(peak, b.position.y);
        if (player.x < b0.x - 30.f) break;
    }
    return {takeoff, peak};
}

static void TestScareRadius() {
    for (uint32_t seed : {1u, 2u, 3u}) {
        const auto [run, runPeak] = Approach(6.0f, seed);
        const auto [walk, walkPeak] = Approach(3.0f, seed);
        std::printf("semilla %u: corriendo despega a %.1f m (pico %.1f m), caminando a %.1f m (pico %.1f m)\n", seed, run, runPeak, walk, walkPeak);
        CHECK(run > 8.0f && run < 13.0f, "corriendo deberia asustar hacia 11 m, fue %.1f", run);
        CHECK(walk > 2.5f && walk < 5.5f, "caminando deberia asustar hacia 4 m, fue %.1f", walk);
        CHECK(runPeak > 8.0f, "al huir deberian volar alto, pico %.1f", runPeak);
    }
}

static void TestFleeDirection() {
    int scared = 0, toward = 0, perchedHigh = 0, landed = 0;
    for (uint32_t seed = 11; seed <= 18; ++seed) {
        BirdFlock fl = MakeFlock(seed);
        glm::vec3 player(-100.f, 0, -100.f + 25.f * static_cast<float>(seed - 11));
        std::vector<char> fly(fl.Birds().size(), 0), sc(fl.Birds().size(), 0);
        for (int f = 0; f < 60 * 34; ++f) {
            player.x += 6.f / 60.f;
            fl.Update(1.f / 60.f, player, {});
            for (size_t i = 0; i < fl.Birds().size(); ++i) {
                const Bird& b = fl.Birds()[i];
                if (b.IsFlying() && !fly[i] && b.scared) {
                    ++scared; sc[i] = 1;
                    const glm::vec2 away(b.origin.x - player.x, b.origin.z - player.z);
                    const glm::vec2 dir(b.target.x - b.origin.x, b.target.z - b.origin.z);
                    if (glm::dot(glm::normalize(away), glm::normalize(dir)) < -0.2f) ++toward;
                }
                if (!b.IsFlying() && fly[i] && sc[i]) { ++landed; sc[i] = 0; if (b.perch != BirdPerch::Ground) ++perchedHigh; }
                fly[i] = b.IsFlying();
            }
        }
    }
    std::printf("8 carreras: %d aves asustadas, %d volaron hacia el jugador, %d de %d aterrizaron en rama o poste\n", scared, toward, perchedHigh, landed);
    CHECK(scared >= 15, "muy pocas aves asustadas: %d", scared);
    CHECK(toward * 8 <= scared, "demasiadas huyen hacia el jugador: %d de %d", toward, scared);
    CHECK(landed > 0 && perchedHigh * 10 >= landed * 3, "casi no se refugian en ramas o postes: %d de %d", perchedHigh, landed);
}

static void TestPedestrian() {
    BirdFlock fl = MakeFlock(9);
    size_t idx = 0;
    for (size_t i = 0; i < fl.Birds().size(); ++i)
        if (fl.Birds()[i].perch == BirdPerch::Ground) { idx = i; break; }
    const glm::vec2 pedestrian(fl.Birds()[idx].position.x + 1.5f, fl.Birds()[idx].position.z);
    fl.Update(1.f / 60.f, kFarAway, {pedestrian});
    CHECK(fl.Birds()[idx].IsFlying(), "un peaton a 1.5 m deberia asustar al ave del suelo");
}

// Varios jugadores: el que esta cerca asusta aunque el otro este lejos; con un solo jugador el resultado es identico al de la sobrecarga de siempre.
static void TestSeveralPlayers() {
    // 1) un jugador lejano y otro junto a un ave del suelo: el ave sale volando
    BirdFlock fl = MakeFlock(11);
    size_t idx = 0;
    for (size_t i = 0; i < fl.Birds().size(); ++i)
        if (fl.Birds()[i].perch == BirdPerch::Ground) { idx = i; break; }
    const glm::vec3 near(fl.Birds()[idx].position.x + 1.0f, 0.f, fl.Birds()[idx].position.z);
    for (int f = 0; f < 10; ++f) fl.Update(1.f / 60.f, std::vector<BirdPlayer>{{1, kFarAway}, {2, near}}, {});
    CHECK(fl.Birds()[idx].IsFlying(), "el segundo jugador, pegado al ave, la asusta");

    // 2) sin jugadores nada asusta
    BirdFlock calm = MakeFlock(11);
    int flying = 0;
    for (int f = 0; f < 120; ++f) calm.Update(1.f / 60.f, std::vector<BirdPlayer>{}, {});
    for (const Bird& b : calm.Birds()) flying += b.IsFlying() ? 1 : 0;
    CHECK(flying <= 8, "sin jugadores casi nada vuela (solo despegues tranquilos), volaron %d", flying);

    // 3) la velocidad de cada jugador se sigue por separado: uno corre y el otro esta quieto
    BirdFlock speeds = MakeFlock(12);
    glm::vec3 runner(0.f, 0.f, 0.f);
    for (int f = 0; f < 120; ++f) { runner.x += 5.0f / 60.f; speeds.Update(1.f / 60.f, std::vector<BirdPlayer>{{1, runner}, {2, kFarAway}}, {}); }
    CHECK(speeds.PlayerSpeed() > 4.0f, "el primer jugador corre (%.1f m/s)", speeds.PlayerSpeed());

    // 4) un jugador por la sobrecarga vieja y por la nueva dan exactamente lo mismo
    BirdFlock a = MakeFlock(13), b = MakeFlock(13);
    glm::vec3 walker(-20.f, 0.f, -10.f);
    for (int f = 0; f < 600; ++f) {
        walker += glm::vec3(1.4f / 60.f, 0.f, 0.6f / 60.f);
        a.Update(1.f / 60.f, walker, {});
        b.Update(1.f / 60.f, std::vector<BirdPlayer>{{7, walker}}, {});
    }
    bool same = a.Birds().size() == b.Birds().size();
    for (size_t i = 0; same && i < a.Birds().size(); ++i)
        same = a.Birds()[i].position == b.Birds()[i].position && a.Birds()[i].IsFlying() == b.Birds()[i].IsFlying();
    CHECK(same, "un solo jugador: ambas sobrecargas coinciden ave por ave");
}

int main() {
    std::setvbuf(stdout, nullptr, _IONBF, 0);
    TestDistribution();
    TestCalmFlights();
    TestScareRadius();
    TestFleeDirection();
    TestPedestrian();
    TestSeveralPlayers();
    if (g_failures == 0) std::printf("BirdFlock: todo OK\n");
    else std::printf("BirdFlock: %d fallos\n", g_failures);
    return g_failures == 0 ? 0 : 1;
}
