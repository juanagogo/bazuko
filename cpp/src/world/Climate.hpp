#pragma once
// Clima de Bogota sin dependencias graficas: temporadas, estados del tiempo y posicion del sol y la luna.
// Port de src/world/Climate.js del juego web (mismos pesos, niveles y formulas astronomicas).
#include <algorithm>
#include <array>
#include <cmath>
#include <random>
#include <glm/glm.hpp>

namespace Bazuko::Climate {

constexpr int kDaysPerSeason = 4;      // el ano completo dura cuatro temporadas
constexpr float kLunarDays = 29.53f;
constexpr float kRainThreshold = 0.12f;   // lluvia minima (ya mezclada) para considerar que llueve

enum class Weather { Sunny, Partly, Cloudy, Fog, Drizzle, Downpour, Storm };
constexpr int kWeatherCount = 7;

struct WeatherInfo {
    int level;               // intensidad: los saltos entre estados son de dos niveles como maximo
    const char* label;
    const char* nightLabel;  // nullptr = el mismo de dia
    float cloud, rain, wind, fog, lightning;
    const char* toast;
};

inline const WeatherInfo& Info(Weather weather) {
    static const std::array<WeatherInfo, kWeatherCount> table{{
        {0, "Soleado", "Despejado", 0.10f, 0.00f, 0.20f, 0.75f, 0.00f, "Se despeja el cielo: sale el sol sobre Monserrate."},
        {1, "Parcialmente nublado", nullptr, 0.42f, 0.00f, 0.35f, 0.90f, 0.00f, "Las nubes se abren a ratos sobre el centro."},
        {2, "Nublado", nullptr, 0.85f, 0.00f, 0.30f, 1.00f, 0.00f, "El cielo se cierra: tipico dia gris bogotano."},
        {2, "Neblina", nullptr, 0.75f, 0.00f, 0.05f, 2.40f, 0.00f, "Baja la neblina de los cerros orientales."},
        {3, "Llovizna", nullptr, 0.92f, 0.30f, 0.30f, 1.25f, 0.00f, "Comienza a lloviznar en el centro de Bogota..."},
        {4, "Aguacero", nullptr, 0.97f, 0.72f, 0.55f, 1.50f, 0.15f, "Se largo el aguacero! Busca donde escampar."},
        {5, "Tormenta electrica", nullptr, 1.00f, 1.00f, 0.90f, 1.70f, 1.00f, "Tormenta electrica sobre la ciudad. Truenos en los cerros."},
    }};
    return table[static_cast<size_t>(weather)];
}

struct Season {
    const char* id;
    const char* label;
    const char* months;
    float windMul;
    float cold;                                   // frio adicional de madrugadas y noches
    std::array<float, kWeatherCount> weights;     // probabilidad relativa de cada estado, en el orden de Weather
};

// Regimen bimodal de Bogota: dos temporadas secas y dos de lluvias
inline const Season& SeasonByIndex(int index) {
    static const std::array<Season, 4> seasons{{
        {"seca", "Temporada seca", "dic - feb", 1.0f, 0.25f, {4.0f, 4.0f, 2.0f, 1.2f, 1.0f, 0.35f, 0.12f}},
        {"lluvias1", "Primeras lluvias", "mar - may", 1.0f, 0.10f, {1.0f, 2.0f, 3.0f, 1.0f, 3.0f, 2.4f, 1.2f}},
        {"veranillo", "Veranillo de vientos", "jun - ago", 1.6f, 0.05f, {3.0f, 4.0f, 2.5f, 0.5f, 1.5f, 0.5f, 0.2f}},
        {"lluvias2", "Segundas lluvias", "sep - nov", 1.1f, 0.15f, {0.8f, 1.5f, 3.0f, 1.2f, 3.0f, 3.0f, 1.6f}},
    }};
    return seasons[static_cast<size_t>(((index % 4) + 4) % 4)];
}

// El dia 1 abre la temporada seca
inline int SeasonIndexForDay(int day) { return std::max(0, day - 1) / kDaysPerSeason % 4; }
inline const Season& SeasonForDay(int day) { return SeasonByIndex(SeasonIndexForDay(day)); }

// Fraccion del ano de juego 0..1; 0 equivale a comienzos de diciembre
inline float YearFraction(int day, float hour) {
    const float length = static_cast<float>(kDaysPerSeason * 4);
    float value = std::fmod(static_cast<float>(day - 1) + hour / 24.0f, length);
    if (value < 0.0f) value += length;
    return value / length;
}

// Elige el siguiente estado con los pesos de la temporada. Solo permite saltos de hasta dos niveles para que el
// sol no pase directo a la tormenta; la neblina es matinal (4:00-9:30).
inline Weather PickNext(Weather current, const Season& season, float hour, std::mt19937& random) {
    const int from = Info(current).level;
    std::array<std::pair<Weather, float>, kWeatherCount> candidates{};
    size_t count = 0;
    float total = 0.0f;
    for (int id = 0; id < kWeatherCount; ++id) {
        const Weather weather = static_cast<Weather>(id);
        if (weather == current) continue;
        if (std::abs(Info(weather).level - from) > 2) continue;
        if (weather == Weather::Fog && (hour < 4.0f || hour > 9.5f)) continue;
        const float weight = season.weights[static_cast<size_t>(id)];
        if (weight <= 0.0f) continue;
        candidates[count++] = {weather, weight};
        total += weight;
    }
    if (count == 0) return Weather::Cloudy;
    float roll = std::uniform_real_distribution<float>(0.0f, 1.0f)(random) * total;
    for (size_t i = 0; i < count; ++i) {
        roll -= candidates[i].second;
        if (roll <= 0.0f) return candidates[i].first;
    }
    return candidates[count - 1].first;
}

constexpr float kBogotaLatitude = 4.6f * 3.14159265f / 180.0f;

// Mundo: los cerros orientales estan en -X; el Portal del Centro (norte) en -Z
inline glm::vec3 DirectionFromAngles(float hourAngle, float declination) {
    const float cosD = std::cos(declination), sinD = std::sin(declination);
    const float cosL = std::cos(kBogotaLatitude), sinL = std::sin(kBogotaLatitude);
    const float east = -cosD * std::sin(hourAngle);
    const float north = cosL * sinD - sinL * cosD * std::cos(hourAngle);
    const float up = sinL * sinD + cosL * cosD * std::cos(hourAngle);
    return {-east, up, -north};
}

// Declinacion solar de la fraccion del ano (minima a finales de diciembre)
inline float SolarDeclination(int day, float hour) {
    return -23.44f * 3.14159265f / 180.0f * std::cos(2.0f * 3.14159265f * (YearFraction(day, hour) + 0.055f));
}

// Direccion unitaria hacia el sol: sale por los cerros a las 6:00 y cruza casi por el cenit
inline glm::vec3 SunDirection(float hour, int day) {
    return DirectionFromAngles((hour - 12.0f) / 24.0f * 2.0f * 3.14159265f, SolarDeclination(day, hour));
}

// Fase lunar 0..1: 0 luna nueva, 0,5 luna llena
inline float MoonPhase(int day, float hour) {
    const float value = (static_cast<float>(day) + hour / 24.0f + 14.0f) / kLunarDays;
    return value - std::floor(value);
}

// Fraccion iluminada del disco lunar segun la fase
inline float MoonIllumination(float phase) { return (1.0f - std::cos(phase * 2.0f * 3.14159265f)) / 2.0f; }

// La luna se retrasa respecto al sol segun su fase: llena sale al anochecer
inline glm::vec3 MoonDirection(float hour, int day) {
    const float phase = MoonPhase(day, hour);
    const float hourAngle = (hour - 12.0f) / 24.0f * 2.0f * 3.14159265f - phase * 2.0f * 3.14159265f;
    return DirectionFromAngles(hourAngle, -SolarDeclination(day, hour) * 0.8f);
}

} // namespace Bazuko::Climate
