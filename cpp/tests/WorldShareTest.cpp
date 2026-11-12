// Mundo compartido (hito 3): un anfitrion simula y un invitado (que NO simula trafico ni peatones) aplica las instantaneas del anfitrion, serializadas
// y leidas de verdad. Comprueba que los dos ven los mismos carros, peatones y buses (diferencia en metros tras extrapolar), el reloj y el tiempo, y mide
// el tamano de cada instantanea. Con la misma semilla los dos mundos tienen la misma lista de carros.
// Uso: bazuko_world_share_test [segundos]. Devuelve 0 si todo coincide, 1 si no, 77 sin contexto GL.
#include "core/Paths.hpp"
#include "net/WorldSnapshot.hpp"
#include "renderer/GL.hpp"
#include "world/CityLayout.hpp"
#include "world/Simulation.hpp"

#include <GLFW/glfw3.h>
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <unordered_map>

using namespace Bazuko;

int main(int argc, char** argv) {
    const float seconds = argc > 1 ? static_cast<float>(std::atof(argv[1])) : 40.0f;
    Paths::Init(0, nullptr);
    if (!glfwInit()) { std::printf("sin GLFW: se omite\n"); return 77; }
    glfwWindowHint(GLFW_VISIBLE, GLFW_FALSE);
    glfwWindowHint(GLFW_CONTEXT_VERSION_MAJOR, 4);
    glfwWindowHint(GLFW_CONTEXT_VERSION_MINOR, 5);
    glfwWindowHint(GLFW_OPENGL_PROFILE, GLFW_OPENGL_CORE_PROFILE);
    GLFWwindow* window = glfwCreateWindow(64, 64, "world-share-test", nullptr, nullptr);
    if (!window) { std::printf("sin contexto GL: se omite\n"); return 77; }
    glfwMakeContextCurrent(window);
    if (gladLoadGL(glfwGetProcAddress) == 0) { std::printf("sin GLAD: se omite\n"); return 77; }

    CityLayout city;
    const glm::vec3 viewer(112.98f, 0.0f, 97.84f);
    Simulation host(city, 42u);
    Simulation guest(city, 42u);
    guest.SetGuestMode(true);
    int failures = 0;
    const auto check = [&](bool ok, const char* message) { if (!ok) { ++failures; std::printf("FALLO: %s\n", message); } };

    const float dt = 1.0f / 30.0f;
    uint32_t tick = 0;
    size_t bytesTotal = 0, bytesMax = 0, snapshots = 0, mismatches = 0;
    double vehicleErrorSum = 0.0, pedestrianErrorSum = 0.0, busErrorSum = 0.0;
    float vehicleErrorMax = 0.0f, pedestrianErrorMax = 0.0f;
    size_t vehicleSamples = 0, pedestrianSamples = 0, pedestrianMissing = 0, pedestrianExpected = 0, busSamples = 0;
    bool applied = false;
    for (float time = 0.0f; time < seconds; time += dt, ++tick) {
        host.Update(dt, viewer);
        guest.Update(dt, viewer);
        if (tick % 3 == 0) {   // 10 Hz, como en la sesion de red
            Net::BitWriter writer;
            Write(writer, host.ExportWorld(viewer, tick));
            bytesTotal += writer.Data().size(); bytesMax = std::max(bytesMax, writer.Data().size()); ++snapshots;
            Net::BitReader reader(writer.Data());
            const auto type = Net::ReadType(reader);
            check(type && *type == Net::MessageType::World, "el tipo del mensaje es World");
            const auto world = Net::ReadWorld(reader);
            check(world.has_value(), "la instantanea se lee de vuelta");
            if (world) { if (!guest.ApplyWorld(*world)) ++mismatches; else applied = true; }
        }
        if (time < 8.0f || !applied) continue;   // los primeros segundos son de arranque
        // error de lo que el invitado dibuja frente a lo que simula el anfitrion, medido justo antes de la siguiente instantanea (el peor caso)
        if (tick % 3 != 2) continue;
        std::unordered_map<uint32_t, glm::vec3> guestPeds;
        for (const Pedestrian& p : guest.GetPedestrians()) guestPeds[p.netId & 0xFFFFu] = p.position;
        for (size_t i = 0; i < host.GetTrafficVehicles().size(); ++i) {
            const TrafficVehicle& a = host.GetTrafficVehicles()[i];
            if (glm::distance(glm::vec2(a.position.x, a.position.z), glm::vec2(viewer.x, viewer.z)) > 90.0f) continue;
            const auto center = [](const TrafficVehicle& v) { BicycleParams params; params.wheelbase = std::max(1.2f, v.wheelbase); return v.bike.ready ? v.bike.Center(params) : glm::vec2(v.position.x, v.position.z); };
            const float e = glm::distance(center(a), center(guest.GetTrafficVehicles()[i]));
            vehicleErrorSum += e; vehicleErrorMax = std::max(vehicleErrorMax, e); ++vehicleSamples;
        }
        for (const Pedestrian& p : host.GetPedestrians()) {
            if (p.departed || p.netId == 0 || glm::distance(glm::vec2(p.position.x, p.position.z), glm::vec2(viewer.x, viewer.z)) > 90.0f) continue;
            ++pedestrianExpected;
            const auto it = guestPeds.find(p.netId & 0xFFFFu);
            if (it == guestPeds.end()) { ++pedestrianMissing; continue; }
            const float e = glm::distance(glm::vec2(p.position.x, p.position.z), glm::vec2(it->second.x, it->second.z));
            pedestrianErrorSum += e; pedestrianErrorMax = std::max(pedestrianErrorMax, e); ++pedestrianSamples;
        }
        for (size_t i = 0; i < host.GetBuses().size() && i < guest.GetBuses().size(); ++i) {
            busErrorSum += glm::distance(host.GetBuses()[i].position, guest.GetBuses()[i].position); ++busSamples;
        }
    }
    const double vehicleMean = vehicleSamples ? vehicleErrorSum / static_cast<double>(vehicleSamples) : 0.0;
    const double pedestrianMean = pedestrianSamples ? pedestrianErrorSum / static_cast<double>(pedestrianSamples) : 0.0;
    const double busMean = busSamples ? busErrorSum / static_cast<double>(busSamples) : 0.0;
    std::printf("Instantaneas: %zu, media %zu B, maxima %zu B (a 10 Hz: %.1f KB/s por invitado)\n", snapshots, snapshots ? bytesTotal / snapshots : 0, bytesMax,
                snapshots ? static_cast<double>(bytesTotal) / static_cast<double>(snapshots) * 10.0 / 1024.0 : 0.0);
    std::printf("Carros a menos de 90 m: error medio %.2f m, maximo %.2f m (%zu muestras)\n", vehicleMean, vehicleErrorMax, vehicleSamples);
    std::printf("Peatones a menos de 90 m: error medio %.2f m, maximo %.2f m; %zu de %zu sin llegar al invitado\n", pedestrianMean, pedestrianErrorMax, pedestrianMissing, pedestrianExpected);
    std::printf("Buses: error medio %.2f m. Reloj: %.4f contra %.4f, dia %d contra %d\n", busMean, host.GetDayProgress(), guest.GetDayProgress(), host.GetDay(), guest.GetDay());
    check(mismatches == 0, "ninguna instantanea fue rechazada por no coincidir");
    check(vehicleSamples > 50, "hay carros cerca para comparar");
    check(vehicleMean < 1.0 && vehicleErrorMax < 6.0, "los carros del invitado quedan a menos de 1 m en promedio");
    check(pedestrianSamples > 50, "hay peatones cerca para comparar");
    check(pedestrianMean < 1.0, "los peatones del invitado quedan a menos de 1 m en promedio");
    check(pedestrianExpected == 0 || static_cast<double>(pedestrianMissing) / static_cast<double>(pedestrianExpected) < 0.1, "casi todos los peatones cercanos llegan al invitado");
    check(busMean < 2.0, "los buses coinciden");
    check(std::abs(host.GetDayProgress() - guest.GetDayProgress()) < 0.01f && host.GetDay() == guest.GetDay(), "el reloj coincide");
    check(bytesMax < 1400, "cada instantanea cabe en un paquete de ~1,4 KB");
    // Migracion de anfitrion: el invitado pasa a anfitrion y simula desde lo que recibio; los carros siguen su circuito sin saltos
    {
        // una patrulla acudiendo con la sirena viaja al invitado y sobrevive al ascenso
        const bool called = host.CallPolice(glm::vec3(viewer.x + 70.0f, 0.0f, viewer.z), 1.0f, 1);
        for (float time = 0.0f; time < 4.0f; time += dt, ++tick) {
            host.Update(dt, viewer); guest.Update(dt, viewer);
            if (tick % 3 == 0) {
                Net::BitWriter writer; Write(writer, host.ExportWorld(viewer, tick));
                Net::BitReader reader(writer.Data()); Net::ReadType(reader);
                if (const auto world = Net::ReadWorld(reader)) guest.ApplyWorld(*world);
            }
        }
        size_t hostDispatched = 0, guestDispatched = 0, guestSiren = 0;
        for (const TrafficVehicle& v : host.GetTrafficVehicles()) hostDispatched += v.driver.dispatched ? 1 : 0;
        for (const TrafficVehicle& v : guest.GetTrafficVehicles()) { guestDispatched += v.driver.dispatched ? 1 : 0; guestSiren += v.driver.siren ? 1 : 0; }
        std::printf("Policia: llamada %s; patrullas acudiendo: %zu en el anfitrion, %zu (con sirena %zu) en el invitado\n", called ? "aceptada" : "sin patrulla cerca", hostDispatched, guestDispatched, guestSiren);
        if (called) check(guestDispatched == hostDispatched && hostDispatched >= 1, "la patrulla que acude llega al invitado");
        size_t pedestriansBefore = 0;
        for (const Pedestrian& p : guest.GetPedestrians()) pedestriansBefore += p.police ? 0 : 1;
        std::vector<glm::vec3> before;
        for (const TrafficVehicle& v : guest.GetTrafficVehicles()) before.push_back(v.position);
        guest.PromoteToHost();
        size_t pedestriansAfter = guest.GetPedestrianCount(), chasingAfter = 0;
        for (const TrafficVehicle& v : guest.GetTrafficVehicles()) chasingAfter += v.driver.dispatched ? 1 : 0;
        check(pedestriansAfter == pedestriansBefore, "los peatones de la calle se conservan al pasar a anfitrion (menos los policias a pie)");
        if (called) check(chasingAfter == guestDispatched, "la patrulla que acudia sigue acudiendo tras el ascenso");
        std::printf("Ascenso: %zu peatones antes y %zu despues; patrullas acudiendo: %zu\n", pedestriansBefore, pedestriansAfter, chasingAfter);
        float worstJump = 0.0f; size_t checked = 0;
        for (float time = 0.0f; time < 0.5f; time += dt) guest.Update(dt, viewer);
        for (size_t i = 0; i < before.size(); ++i) {
            const TrafficVehicle& v = guest.GetTrafficVehicles()[i];
            if (v.parked || glm::distance(glm::vec2(before[i].x, before[i].z), glm::vec2(viewer.x, viewer.z)) > 90.0f) continue;
            worstJump = std::max(worstJump, glm::distance(glm::vec2(before[i].x, before[i].z), glm::vec2(v.position.x, v.position.z)));
            ++checked;
        }
        for (float time = 0.0f; time < 30.0f; time += dt) guest.Update(dt, viewer);
        size_t moved = 0, finite = 0;
        for (size_t i = 0; i < before.size(); ++i) {
            const TrafficVehicle& v = guest.GetTrafficVehicles()[i];
            if (std::isfinite(v.position.x) && std::isfinite(v.position.z)) ++finite;
            if (!v.parked && glm::distance(glm::vec2(before[i].x, before[i].z), glm::vec2(v.position.x, v.position.z)) > 20.0f) ++moved;
        }
        std::printf("Migracion: %zu carros comparados, salto maximo en el primer medio segundo %.2f m; tras 30 s se movieron %zu carros y hay %zu peatones nuevos\n",
                    checked, worstJump, moved, guest.GetPedestrianCount());
        check(!guest.IsGuest(), "tras el ascenso ya no es invitado");
        check(checked > 10 && worstJump < 8.0f, "ningun carro salta mas de 8 m al pasar a anfitrion");
        check(finite == before.size(), "ningun carro queda con posicion invalida");
        check(moved > 10, "los carros siguen circulando tras el ascenso");
        check(guest.GetPedestrianCount() > 3, "hay gente en la calle tras el ascenso");
    }
    glfwDestroyWindow(window);
    glfwTerminate();
    if (failures == 0) std::printf("Mundo compartido: todo correcto\n");
    return failures == 0 ? 0 : 1;
}
