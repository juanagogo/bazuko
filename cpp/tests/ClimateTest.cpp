// Pruebas del clima: temporadas, transiciones entre estados y posicion del sol y la luna (logica pura).
#include "world/Climate.hpp"

#include <cstdio>

using namespace Bazuko;
using namespace Bazuko::Climate;

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

int main() {
    // 1. Cuatro dias por temporada; el dia 1 abre la seca y el ano da la vuelta tras 16 dias
    CHECK(SeasonIndexForDay(1) == 0 && SeasonIndexForDay(4) == 0, "dias 1-4 = seca");
    CHECK(SeasonIndexForDay(5) == 1 && SeasonIndexForDay(9) == 2 && SeasonIndexForDay(13) == 3, "orden de temporadas");
    CHECK(SeasonIndexForDay(17) == 0, "el ano vuelve a empezar");

    // 2. Siguiente estado: nunca el mismo, saltos de hasta dos niveles y neblina solo de madrugada
    std::mt19937 random(7);
    for (int seasonIndex = 0; seasonIndex < 4; ++seasonIndex) {
        const Season& season = SeasonByIndex(seasonIndex);
        for (int from = 0; from < kWeatherCount; ++from) {
            for (int trial = 0; trial < 200; ++trial) {
                const float hour = trial % 2 ? 12.0f : 6.0f;
                const Weather next = PickNext(static_cast<Weather>(from), season, hour, random);
                CHECK(next != static_cast<Weather>(from) || from == static_cast<int>(Weather::Cloudy), "no repite estado");
                CHECK(std::abs(Info(next).level - Info(static_cast<Weather>(from)).level) <= 2 || next == Weather::Cloudy, "salto de a lo sumo dos niveles");
                if (hour == 12.0f) CHECK(next != Weather::Fog, "sin neblina al mediodia");
            }
        }
    }

    // 3. Sol: al mediodia esta alto, a medianoche bajo el horizonte, y sale por los cerros orientales (-X) a las 6
    CHECK(SunDirection(12.0f, 1).y > 0.8f, "sol alto al mediodia (%.2f)", SunDirection(12.0f, 1).y);
    CHECK(SunDirection(0.0f, 1).y < -0.8f, "sol bajo el horizonte a medianoche");
    CHECK(SunDirection(7.0f, 1).x < 0.0f && SunDirection(17.0f, 1).x > 0.0f, "sale al este (-X) y se pone al oeste (+X)");
    for (int hour = 0; hour < 24; ++hour) CHECK(std::abs(glm::length(SunDirection(static_cast<float>(hour), 3)) - 1.0f) < 1e-3f, "direccion unitaria");

    // 4. Luna: fase en 0..1, llena a mitad del ciclo, iluminacion 0..1 y direccion unitaria
    for (int day = 1; day <= 60; ++day) {
        const float phase = MoonPhase(day, 12.0f);
        CHECK(phase >= 0.0f && phase < 1.0f, "fase fuera de rango %.3f", phase);
        const float lit = MoonIllumination(phase);
        CHECK(lit >= 0.0f && lit <= 1.0f, "iluminacion fuera de rango");
        CHECK(std::abs(glm::length(MoonDirection(20.0f, day)) - 1.0f) < 1e-3f, "direccion lunar unitaria");
    }
    CHECK(MoonIllumination(0.5f) > 0.99f && MoonIllumination(0.0f) < 0.01f, "llena y nueva");

    // 5. Los estados estan ordenados por intensidad y la tormenta es la unica con rayos plenos
    CHECK(Info(Weather::Storm).lightning == 1.0f && Info(Weather::Sunny).lightning == 0.0f, "rayos");
    CHECK(Info(Weather::Drizzle).rain >= kRainThreshold && Info(Weather::Cloudy).rain < kRainThreshold, "umbral de lluvia");

    if (g_failures == 0) std::printf("Clima: todas las pruebas pasaron\n");
    return g_failures == 0 ? 0 : 1;
}
