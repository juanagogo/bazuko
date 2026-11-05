// Linea base de la simulacion: corre N segundos con una semilla fija y resume el estado (carros, peatones, buses y perro) en un hash.
// Sirve de red de seguridad para refactorizar `Simulation` (por ejemplo, para el multijugador): si el hash cambia sin querer, algo se rompio.
//   1) Determinismo: dos simulaciones nuevas con la misma semilla deben dar el mismo hash; si no, se informa en que segundo divergen.
//   2) --esperado <hash>: compara con un hash guardado (solo valido en el mismo equipo y compilador).
//   3) --medir: estima cuanto ocuparia una instantanea de red del mundo (para fijar el presupuesto de ancho de banda).
// Uso: bazuko_simulation_hash_test [segundos] [semilla] [--esperado HEX] [--medir]. Devuelve 0 si todo coincide, 1 si no, 77 sin contexto GL.
#include "core/Paths.hpp"
#include "renderer/GL.hpp"
#include "world/CityLayout.hpp"
#include "world/Simulation.hpp"

#include <GLFW/glfw3.h>
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

using namespace Bazuko;

namespace {

const glm::vec3 kSecondPlayer(300.0f, 0.0f, 100.0f);   // La Candelaria, a ~190 m del primero

struct Hasher {
    uint64_t value = 1469598103934665603ull;   // FNV-1a de 64 bits
    void Bytes(const void* data, size_t size) {
        const auto* bytes = static_cast<const uint8_t*>(data);
        for (size_t i = 0; i < size; ++i) { value ^= bytes[i]; value *= 1099511628211ull; }
    }
    void Int(int64_t number) { Bytes(&number, sizeof number); }
    void Milli(float number) { Int(static_cast<int64_t>(std::llround(static_cast<double>(number) * 1000.0))); }   // milimetros: ignora ruido por debajo
    void Vec(const glm::vec3& v) { Milli(v.x); Milli(v.y); Milli(v.z); }
};

uint64_t HashState(const Simulation& simulation) {
    Hasher hasher;
    for (const TrafficVehicle& car : simulation.GetTrafficVehicles()) {
        hasher.Vec(car.position); hasher.Milli(car.yaw); hasher.Milli(car.speed); hasher.Int(static_cast<int64_t>(car.routeIndex));
        hasher.Int(car.waitingAtSignal ? 1 : 0); hasher.Milli(car.lateral);
    }
    for (const Pedestrian& person : simulation.GetPedestrians()) {
        hasher.Vec(person.position); hasher.Milli(person.yaw); hasher.Int(person.moving ? 1 : 0); hasher.Int(person.reaction);
    }
    for (const BusState& bus : simulation.GetBuses()) { hasher.Vec(bus.position); hasher.Milli(bus.speed); hasher.Int(bus.servedStation ? 1 : 0); }
    for (const Bird& bird : simulation.GetBirdFlock().Birds()) { hasher.Vec(bird.position); hasher.Milli(bird.yaw); hasher.Int(bird.IsFlying() ? 1 : 0); }
    for (const glm::vec3& rat : simulation.GetRatPositions()) hasher.Vec(rat);
    hasher.Vec(simulation.GetDogPosition());
    return hasher.value;
}

// Corre `seconds` segundos y devuelve el hash cada `interval` segundos (para localizar la primera divergencia).
std::vector<uint64_t> Run(CityLayout& city, uint32_t seed, float seconds, float interval, const glm::vec3& player, Simulation** keep, bool farSecondPlayer = false) {
    auto* simulation = new Simulation(city, seed);
    std::vector<uint64_t> checkpoints;
    constexpr float dt = 1.0f / 30.0f;
    float nextCheckpoint = interval;
    for (float t = 0.0f; t < seconds; t += dt) {
        if (farSecondPlayer) {   // via multijugador: el primero es el de siempre y el segundo esta al otro lado del mapa
            Net::PlayerView first, second;
            first.id = 1; first.position = {player.x, player.y, player.z};
            second.id = 2; second.position = {300.0f, 0.0f, 100.0f};   // La Candelaria, a ~190 m del primero
            simulation->Update(dt, std::vector<Net::PlayerView>{first, second});
        } else {
            simulation->Update(dt, player);
        }
        if (t + dt >= nextCheckpoint) { checkpoints.push_back(HashState(*simulation)); nextCheckpoint += interval; }
    }
    checkpoints.push_back(HashState(*simulation));
    if (keep) *keep = simulation; else delete simulation;
    return checkpoints;
}

// Tamano estimado de una instantanea con posiciones cuantizadas (u16 por eje del mapa, rumbo u8, velocidad u8, estado u8 y un indice u16).
void Measure(const Simulation& simulation, const glm::vec3& at, float radius, const char* label) {
    constexpr int kCarBytes = 2 + 2 + 2 + 1 + 1 + 1 + 1;   // id, x, z, altura relativa, rumbo, velocidad, luces/estado, relleno
    constexpr int kPersonBytes = 2 + 2 + 2 + 1 + 1 + 1;    // id, x, z, rumbo, clip, estado
    constexpr int kBusBytes = 2 + 2 + 2 + 2 + 1 + 1 + 1;   // id, x, y, z, rumbo, velocidad, puertas
    const auto close = [&](const glm::vec3& p) { return glm::distance(glm::vec2(p.x, p.z), glm::vec2(at.x, at.z)) <= radius; };
    int cars = 0, carsAll = 0, people = 0, peopleAll = 0, buses = 0;
    for (const TrafficVehicle& car : simulation.GetTrafficVehicles()) { ++carsAll; cars += close(car.position) ? 1 : 0; }
    for (const Pedestrian& person : simulation.GetPedestrians()) { ++peopleAll; people += close(person.position) ? 1 : 0; }
    for (const BusState& bus : simulation.GetBuses()) buses += close(bus.position) ? 1 : 0;
    const int header = 12;   // numero de secuencia, tick, hora del mundo, clima
    const int full = header + static_cast<int>(simulation.GetBuses().size()) * kBusBytes + carsAll * kCarBytes + peopleAll * kPersonBytes;
    const int interest = header + buses * kBusBytes + cars * kCarBytes + people * kPersonBytes;
    std::printf("  %-20s radio %4.0f m: %3d/%d carros, %3d/%d peatones, %d buses -> %5d B completa, %5d B con interes; a 20 Hz: %.1f KB/s completa, %.1f KB/s con interes\n",
                label, radius, cars, carsAll, people, peopleAll, buses, full, interest, full * 20 / 1024.0, interest * 20 / 1024.0);
}

} // namespace

int main(int argc, char** argv) {
    std::setvbuf(stdout, nullptr, _IONBF, 0);
    float seconds = 60.0f;
    uint32_t seed = 42u;
    bool measure = false;
    std::string expected;
    int positional = 0;
    for (int i = 1; i < argc; ++i) {
        if (std::strcmp(argv[i], "--medir") == 0) measure = true;
        else if (std::strcmp(argv[i], "--esperado") == 0 && i + 1 < argc) expected = argv[++i];
        else if (positional == 0) { seconds = static_cast<float>(std::atof(argv[i])); ++positional; }
        else if (positional == 1) { seed = static_cast<uint32_t>(std::atoi(argv[i])); ++positional; }
    }
    Paths::Init(0, nullptr);
    if (!glfwInit()) { std::printf("sin GLFW: se omite\n"); return 77; }
    glfwWindowHint(GLFW_VISIBLE, GLFW_FALSE);
    glfwWindowHint(GLFW_CONTEXT_VERSION_MAJOR, 4);
    glfwWindowHint(GLFW_CONTEXT_VERSION_MINOR, 5);
    glfwWindowHint(GLFW_OPENGL_PROFILE, GLFW_OPENGL_CORE_PROFILE);
    GLFWwindow* window = glfwCreateWindow(64, 64, "simulation-hash-test", nullptr, nullptr);
    if (!window) { std::printf("sin contexto GL: se omite\n"); return 77; }
    glfwMakeContextCurrent(window);
    if (gladLoadGL(glfwGetProcAddress) == 0) { std::printf("sin GLAD: se omite\n"); return 77; }

    CityLayout city;
    const glm::vec3 player(112.98f, 0.0f, 97.84f);   // frente al cambuche, como cada entrada al juego
    const float interval = 5.0f;
    Simulation* kept = nullptr;
    const std::vector<uint64_t> first = Run(city, seed, seconds, interval, player, measure ? &kept : nullptr);
    const std::vector<uint64_t> second = Run(city, seed, seconds, interval, player, nullptr);

    int status = 0;
    // Dos jugadores lejanos entre si: los peatones deben aparecer alrededor de CADA uno, no solo del primero
    {
        Simulation* two = nullptr;
        Run(city, seed, std::min(seconds, 90.0f), interval, player, &two, true);
        const auto near = [&](const glm::vec3& center) { int n = 0; for (const Pedestrian& p : two->GetPedestrians()) n += glm::distance(glm::vec2(p.position.x, p.position.z), glm::vec2(center.x, center.z)) < 90.0f ? 1 : 0; return n; };
        const int aroundFirst = near(player), aroundSecond = near(glm::vec3(300.0f, 0.0f, 100.0f));
        std::printf("Dos jugadores: %zu peatones en total, %d junto al primero y %d junto al segundo\n", two->GetPedestrianCount(), aroundFirst, aroundSecond);
        if (aroundFirst < 1 || aroundSecond < 1) { status = 1; std::printf("FALLO: los peatones no aparecen alrededor de los dos jugadores\n"); }
        delete two;
    }

    // Policia: la patrulla despachada por el delito del SEGUNDO jugador va tras el segundo, aunque el primero este mas cerca de ella
    {
        Simulation sim(city, seed);
        Net::PlayerView one, two;
        one.id = 1; one.position = {player.x, player.y, player.z};
        two.id = 2; two.position = {kSecondPlayer.x, kSecondPlayer.y, kSecondPlayer.z};
        constexpr float dt = 1.0f / 30.0f;
        for (float time = 0.0f; time < 5.0f; time += dt) sim.Update(dt, std::vector<Net::PlayerView>{one, two});
        const bool called = sim.CallPolice(kSecondPlayer, 1.0f, 2);
        size_t chosen = static_cast<size_t>(-1);   // la patrulla que quedo despachada (si ninguna, se mira a todas)
        for (size_t i = 0; i < sim.GetTrafficVehicles().size(); ++i) if (sim.GetTrafficVehicles()[i].driver.dispatched) chosen = i;
        float minToFirst = 1.0e9f, minToSecond = 1.0e9f;
        for (float time = 0.0f; time < 150.0f; time += dt) {
            sim.Update(dt, std::vector<Net::PlayerView>{one, two});
            for (size_t i = 0; i < sim.GetTrafficVehicles().size(); ++i) {
                const TrafficVehicle& vehicle = sim.GetTrafficVehicles()[i];
                if (vehicle.emergency != 2 || (chosen != static_cast<size_t>(-1) && i != chosen)) continue;
                minToFirst = std::min(minToFirst, glm::distance(glm::vec2(vehicle.position.x, vehicle.position.z), glm::vec2(one.position.x, one.position.z)));
                minToSecond = std::min(minToSecond, glm::distance(glm::vec2(vehicle.position.x, vehicle.position.z), glm::vec2(two.position.x, two.position.z)));
            }
        }
        std::printf("Policia: CallPolice(segundo jugador) = %d; la patrulla llego a %.1f m del segundo y a %.1f m del primero\n", called, minToSecond, minToFirst);
        if (!called || minToSecond > 30.0f) { status = 1; std::printf("FALLO: la patrulla no acudio al segundo jugador\n"); }
    }

    if (first != second) {
        status = 1;
        for (size_t i = 0; i < first.size() && i < second.size(); ++i)
            if (first[i] != second[i]) {
                std::printf("NO determinista: divergen en el punto %zu (~%.0f s): %016llx contra %016llx\n", i, (i + 1) * interval,
                            static_cast<unsigned long long>(first[i]), static_cast<unsigned long long>(second[i]));
                break;
            }
    } else {
        std::printf("Determinista: %zu puntos de control iguales en dos simulaciones (semilla %u, %.0f s)\n", first.size(), seed, seconds);
    }
    char text[32];
    std::snprintf(text, sizeof text, "%016llx", static_cast<unsigned long long>(first.back()));
    std::printf("Hash final: %s\n", text);
    if (!expected.empty() && expected != text) { std::printf("El hash no coincide con el esperado (%s)\n", expected.c_str()); status = 1; }

    if (measure && kept) {
        std::printf("Instantanea de red estimada (posiciones cuantizadas):\n");
        Measure(*kept, player, 1000.0f, "mapa entero");
        Measure(*kept, player, 120.0f, "junto al cambuche");
        Measure(*kept, glm::vec3(75.0f, 0.0f, 20.0f), 120.0f, "avenida y viaducto");
        Measure(*kept, glm::vec3(300.0f, 0.0f, 100.0f), 120.0f, "La Candelaria");
        delete kept;
    }
    glfwDestroyWindow(window);
    glfwTerminate();
    return status;
}
