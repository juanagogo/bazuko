#pragma once
// Cuanta flota quiere la ciudad segun la hora y el nivel elegido (port de src/systems/trafficDensity.js). Sin motor ni mundo: lo comparten el menu, la simulacion y las pruebas.
#include <array>
#include <cmath>
#include <cstddef>
#include <string_view>

namespace Bazuko {

struct TrafficDensityLevel { const char* id; const char* label; int midday; };

// Cada nivel fija la flota del mediodia; la hora la multiplica.
inline constexpr std::array<TrafficDensityLevel, 4> kTrafficDensityLevels{{
    {"baja", "Baja", 18}, {"normal", "Normal", 30}, {"alta", "Alta", 34}, {"maxima", "Máxima", 38}}};
inline constexpr int kDefaultTrafficDensity = 1;   // normal

inline int TrafficDensityIndex(std::string_view id) {   // cualquier otra cosa (sin guardar, corrupta) cae en el de siempre
    for (size_t i = 0; i < kTrafficDensityLevels.size(); ++i) if (id == kTrafficDensityLevels[i].id) return static_cast<int>(i);
    return kDefaultTrafficDensity;
}

// Pico a la entrada (6 a 9) y a la salida (17 a 20), mediodia ocupado y madrugada floja; se interpola entre anclas para que la flota no cambie de golpe.
inline float TrafficHourFactor(float hour) {
    static constexpr float curve[][2] = {{0, .3f}, {5, .3f}, {6.5f, 1.5f}, {9, 1.5f}, {12, .9f}, {16, .9f}, {18.5f, 1.6f}, {20.5f, 1.45f}, {22, .7f}, {24, .3f}};
    constexpr size_t count = sizeof(curve) / sizeof(curve[0]);
    float h = std::fmod(hour, 24.0f);
    if (h < 0.0f) h += 24.0f;
    for (size_t i = 0; i + 1 < count; ++i) {
        if (h <= curve[i + 1][0]) return curve[i][1] + (curve[i + 1][1] - curve[i][1]) * (h - curve[i][0]) / (curve[i + 1][0] - curve[i][0]);
    }
    return curve[count - 1][1];
}

// Vehiculos que caben a esa hora y nivel, sin contar las patrullas.
inline int TrafficTargetVehicles(float hour, int level) {
    const int index = level >= 0 && level < static_cast<int>(kTrafficDensityLevels.size()) ? level : kDefaultTrafficDensity;
    return static_cast<int>(std::lround(kTrafficDensityLevels[static_cast<size_t>(index)].midday * TrafficHourFactor(hour)));
}

} // namespace Bazuko
