// Pruebas del modelo cinematico de bicicleta (logica pura).
#include "world/VehicleKinematics.hpp"

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
    BicycleParams params;
    params.wheelbase = 2.7f;

    // 1. Radio de giro con direccion fija: R = L / tan(delta); el eje trasero describe un circulo de ese radio
    {
        BicycleState state;
        ResetBicycle(state, params, {0.0f, 0.0f}, {1.0f, 0.0f});
        const float delta = 0.3f;
        const float expectedRadius = params.wheelbase / std::tan(delta);
        for (int i = 0; i < 400; ++i) StepBicycle(state, params, 3.0f, delta, 1.0f / 120.0f);   // la direccion llega a delta
        const glm::vec2 start = state.rear;
        const float headingStart = state.heading;
        // centro del circulo: a la izquierda (+90 grados) del rumbo, a distancia R del eje trasero
        const glm::vec2 centre = state.rear + glm::vec2(-std::sin(state.heading), std::cos(state.heading)) * expectedRadius;
        float worst = 0.0f;
        for (int i = 0; i < 2000; ++i) {
            StepBicycle(state, params, 3.0f, delta, 1.0f / 120.0f);
            worst = std::max(worst, std::fabs(glm::distance(state.rear, centre) - expectedRadius));
        }
        CHECK(worst < 0.01f, "el eje trasero se aparta %.4f m del circulo de radio %.2f", worst, expectedRadius);
        (void)start; (void)headingStart;
    }

    // 2. Sin derrape: la velocidad del eje trasero es siempre paralela al rumbo
    {
        BicycleState state;
        ResetBicycle(state, params, {0.0f, 0.0f}, {0.0f, 1.0f});
        float worstSlip = 0.0f;
        for (int i = 0; i < 1200; ++i) {
            const glm::vec2 before = state.rear;
            const float headingBefore = state.heading;
            StepBicycle(state, params, 4.0f, (i / 200) % 2 == 0 ? 0.5f : -0.4f, 1.0f / 120.0f);
            const glm::vec2 moved = state.rear - before;
            const glm::vec2 midForward(std::cos(0.5f * (headingBefore + state.heading)), std::sin(0.5f * (headingBefore + state.heading)));
            const float sideways = std::fabs(moved.x * -midForward.y + moved.y * midForward.x);
            worstSlip = std::max(worstSlip, sideways);
        }
        CHECK(worstSlip < 1.0e-4f, "el eje trasero se desliza de lado %.6f m por paso", worstSlip);
    }

    // 3. La direccion no chasquea: cambio brusco del angulo deseado -> el angulo real cambia con velocidad limitada
    {
        BicycleState state;
        ResetBicycle(state, params, {0.0f, 0.0f}, {1.0f, 0.0f});
        float worstRate = 0.0f, previous = state.steer;
        for (int i = 0; i < 240; ++i) {
            StepBicycle(state, params, 3.0f, i < 120 ? 0.6f : -0.6f, 1.0f / 60.0f);
            worstRate = std::max(worstRate, std::fabs(state.steer - previous) * 60.0f);
            previous = state.steer;
        }
        CHECK(worstRate <= params.steerRate * 1.001f, "la direccion gira %.3f rad/s (maximo %.3f)", worstRate, params.steerRate);
    }

    // 4. Seguimiento de ruta: sigue una esquina de 90 grados con radio 5 m sin salirse mas de 0,7 m de la trayectoria
    {
        BicycleState state;
        const float radius = 5.0f;
        // ruta: recta en +X hasta (10, 0), arco a la izquierda de radio 3.5 centrado en (10, 3.5), luego recta en +Z
        const auto routePoint = [&](float s) {
            const float arc = 1.5707963f * radius;
            if (s < 10.0f) return glm::vec2(s, 0.0f);
            if (s < 10.0f + arc) { const float a = (s - 10.0f) / radius; return glm::vec2(10.0f + radius * std::sin(a), radius - radius * std::cos(a)); }
            return glm::vec2(10.0f + radius, radius + (s - 10.0f - arc));
        };
        ResetBicycle(state, params, routePoint(0.0f), {1.0f, 0.0f});
        float progress = 0.0f, worstError = 0.0f;
        const float speed = 3.0f, dt = 1.0f / 60.0f;
        for (int i = 0; i < 60 * 12; ++i) {
            progress += speed * dt;
            const glm::vec2 target = routePoint(progress + 1.5f + 0.9f * speed);
            (void)target;
            const glm::vec2 refPoint = routePoint(progress), refAhead = routePoint(progress + 0.1f);
            const float arcStart = 10.0f, arcEnd = 10.0f + 1.5707963f * radius;
            const float curvature = (progress + 0.5f > arcStart && progress + 0.5f < arcEnd) ? 1.0f / radius : 0.0f;
            StepBicycle(state, params, speed, TrackingSteer(state, params, refPoint, glm::normalize(refAhead - refPoint), curvature, speed), dt);
            // error de la mitad del carro respecto de la ruta (se busca el punto de la ruta mas cercano)
            float best = 1.0e9f;
            for (float s = std::max(0.0f, progress - 3.0f); s < progress + 3.0f; s += 0.05f) best = std::min(best, glm::distance(state.Center(params), routePoint(s)));
            worstError = std::max(worstError, best);
        }
        CHECK(worstError < 0.7f, "el carro se aparta %.2f m de la esquina", worstError);
        CHECK(std::fabs(std::remainder(state.heading - 1.5707963f, 6.2831853f)) < 0.05f, "al final debe mirar hacia +Z (rumbo %.3f)", state.heading);
    }

    if (g_failures == 0) std::printf("Bicicleta: todo OK\n");
    return g_failures == 0 ? 0 : 1;
}
