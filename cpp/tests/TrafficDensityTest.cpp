// Curva horaria y niveles del trafico: los mismos numeros de src/systems/trafficDensity.js del original.
#include "world/TrafficDensity.hpp"
#include <cmath>
#include <cstdio>
using namespace Bazuko;
static int failures = 0;
#define CHECK(c, m) do { if (!(c)) { std::printf("FALLO (%d): %s\n", __LINE__, m); ++failures; } } while (0)
int main() {
    CHECK(std::abs(TrafficHourFactor(0.0f) - 0.3f) < 1e-6f && std::abs(TrafficHourFactor(4.0f) - 0.3f) < 1e-6f, "madrugada floja");
    CHECK(std::abs(TrafficHourFactor(7.0f) - 1.5f) < 1e-6f, "hora pico de la manana");
    CHECK(std::abs(TrafficHourFactor(12.0f) - 0.9f) < 1e-6f, "mediodia");
    CHECK(std::abs(TrafficHourFactor(18.5f) - 1.6f) < 1e-6f, "hora pico de la tarde");
    CHECK(std::abs(TrafficHourFactor(5.75f) - 0.9f) < 1e-4f, "a mitad de la subida de las 5 a las 6,5 (0,3 a 1,5)");
    CHECK(std::abs(TrafficHourFactor(24.0f + 7.0f) - TrafficHourFactor(7.0f)) < 1e-6f && std::abs(TrafficHourFactor(-17.0f) - TrafficHourFactor(7.0f)) < 1e-6f, "el dia da la vuelta");
    CHECK(TrafficTargetVehicles(7.0f, 1) == 45 && TrafficTargetVehicles(12.0f, 1) == 27 && TrafficTargetVehicles(3.0f, 1) == 9, "normal: 45 en hora pico, 27 a mediodia y 9 de madrugada");
    CHECK(TrafficTargetVehicles(7.0f, 0) == 27 && TrafficTargetVehicles(7.0f, 3) == 57, "baja y maxima escalan toda la curva");
    CHECK(TrafficTargetVehicles(7.0f, 99) == 45, "un nivel que no existe cae en normal");
    CHECK(TrafficDensityIndex("alta") == 2 && TrafficDensityIndex("basura") == kDefaultTrafficDensity && TrafficDensityIndex("") == 1, "los niveles se reconocen por su id");
    for (float h = 0.0f; h < 24.0f; h += 0.05f) CHECK(std::abs(TrafficHourFactor(h + 0.05f) - TrafficHourFactor(h)) < 0.1f, "la flota no cambia de golpe al pasar de hora");
    if (failures == 0) std::printf("Densidad del trafico: todo correcto\n");
    return failures == 0 ? 0 : 1;
}
