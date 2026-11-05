// Pruebas del GPS a pie (logica pura): rutas, preferencia por andenes, recalculo y llegada.
#include "world/GpsNavigation.hpp"

#include <cstdio>

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

int main() {
    // 1. Mundo abierto: la ruta une los dos puntos y mide al menos la distancia recta
    {
        GpsNavigation nav(30, 30, 2.0f, 1.0f, 1.0f, [](int, int) { return 1.0f; });
        CHECK(nav.SetWaypoint({40.0f, 10.0f}, "Prueba", {2.0f, 2.0f}, 0.0f), "hay ruta");
        CHECK(nav.Route().size() >= 2, "al menos dos puntos");
        CHECK(nav.RouteLength() >= std::hypot(38.0f, 8.0f) - 1.0f, "ruta %.1f", nav.RouteLength());
        CHECK(nav.Waypoint().has_value() && nav.Name() == "Prueba", "destino guardado");
    }

    // 2. Edificio entero en medio: rodea, nunca cruza una casilla bloqueada
    {
        const auto cost = [](int x, int z) { return (x == 10 && z < 14) ? GpsNavigation::kBlocked : 1.0f; };
        GpsNavigation nav(20, 20, 2.0f, 0.0f, 0.0f, cost);
        CHECK(nav.SetWaypoint({38.0f, 4.0f}, "Otro lado", {2.0f, 4.0f}), "rodea el muro");
        bool crossed = false;
        const auto& route = nav.Route();
        for (size_t i = 0; i + 1 < route.size(); ++i) {
            for (int s = 0; s <= 40; ++s) {
                const float t = static_cast<float>(s) / 40.0f;
                if (!nav.IsRoutable(route[i].x + (route[i + 1].x - route[i].x) * t, route[i].z + (route[i + 1].z - route[i].z) * t)) crossed = true;
            }
        }
        CHECK(!crossed, "la ruta atraviesa un tile bloqueado");
        CHECK(nav.RouteLength() > 36.0f + 10.0f, "rodeo %.1f", nav.RouteLength());
    }

    // 3. Sin camino: encerrado por muros
    {
        const auto cost = [](int x, int z) { return (x == 5 ? GpsNavigation::kBlocked : 1.0f) + 0.0f * static_cast<float>(z); };
        GpsNavigation nav(10, 10, 2.0f, 0.0f, 0.0f, cost);
        CHECK(!nav.SetWaypoint({16.0f, 8.0f}, "Inalcanzable", {2.0f, 8.0f}), "sin ruta");
        CHECK(nav.Route().empty(), "ruta vacia");
    }

    // 4. Prefiere el anden (fila 1, coste 1) a la calzada (fila 0, coste 8)
    {
        GpsNavigation nav(8, 2, 2.0f, 0.0f, 0.0f, [](int, int z) { return z == 1 ? 1.0f : 8.0f; });
        CHECK(nav.SetWaypoint({13.0f, 1.0f}, "Cruce", {1.0f, 1.0f}), "ruta por el anden");
        const auto& route = nav.Route();
        bool onSidewalk = true;
        for (size_t i = 1; i + 1 < route.size(); ++i) onSidewalk = onSidewalk && route[i].z > 2.0f;
        CHECK(route.size() >= 3 && onSidewalk, "debe subirse al anden");
    }

    // 5. Desvio: recalcula respetando el intervalo; llegada: borra el destino
    {
        GpsNavigation nav(30, 30, 2.0f, 0.0f, 0.0f, [](int, int) { return 1.0f; });
        CHECK(nav.SetWaypoint({50.0f, 1.0f}, "Prueba", {1.0f, 1.0f}, 0.0f), "ruta");
        CHECK(nav.Update({10.0f, 1.0f}, 0.1f) == GpsNavigation::Event::None, "sobre la ruta");
        CHECK(nav.Update({10.0f, 30.0f}, 0.5f) == GpsNavigation::Event::None, "respeta el intervalo");
        CHECK(nav.Update({10.0f, 30.0f}, 1.2f) == GpsNavigation::Event::Replanned, "recalcula");
        CHECK(nav.RemainingDistance({10.0f, 30.0f}) > 30.0f, "distancia restante");
        CHECK(nav.Update({48.0f, 2.0f}, 1.3f) == GpsNavigation::Event::Arrived, "llega");
        CHECK(!nav.Waypoint().has_value() && nav.LastArrivalName() == "Prueba", "destino borrado y recordado");
    }

    if (g_failures == 0) std::printf("GPS: todas las pruebas pasaron\n");
    return g_failures == 0 ? 0 : 1;
}
