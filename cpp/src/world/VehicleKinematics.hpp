#pragma once
// Modelo cinematico de bicicleta para los carros del trafico (logica pura, sin dependencias del motor).
//
// El eje trasero es la referencia: avanza siempre en la direccion del rumbo (las llantas traseras no derrapan) y el rumbo gira
// segun el angulo de direccion de las llantas delanteras:
//     x' = v cos(theta)     z' = v sin(theta)     theta' = v tan(delta) / L
// El angulo de direccion tiene tope y limite de velocidad angular, y se suaviza de forma exponencial: no hay chasquidos al
// empezar o terminar el giro. Una persecucion pura (pure pursuit) sobre un punto de la ruta calcula el angulo deseado.
// El rumbo es el angulo del vector (x, z) del mundo: direccion = (cos theta, sin theta); el yaw del dibujo es -theta.
#include <algorithm>
#include <cmath>
#include <glm/glm.hpp>

namespace Bazuko {

struct BicycleParams {
    float wheelbase = 2.7f;      // distancia entre ejes (m)
    float maxSteer = 0.70f;      // tope del angulo de direccion (rad, ~40 grados)
    float steerRate = 2.4f;      // velocidad angular maxima de la direccion (rad/s)
    float steerSmoothing = 10.0f; // 1/s: amortiguacion exponencial hacia el angulo deseado
};

struct BicycleState {
    glm::vec2 rear{0.0f};   // eje trasero (x, z)
    float heading = 0.0f;   // rumbo (rad)
    float steer = 0.0f;     // angulo actual de las llantas delanteras (rad, positivo = giro hacia +heading)
    bool ready = false;

    glm::vec2 Forward() const { return {std::cos(heading), std::sin(heading)}; }
    glm::vec2 Center(const BicycleParams& p) const { return rear + Forward() * (p.wheelbase * 0.5f); }
    glm::vec2 Front(const BicycleParams& p) const { return rear + Forward() * p.wheelbase; }
    float Yaw() const { return -heading; }   // yaw del dibujo (rotacion sobre Y; el frente local del carro es +X)
};

// Coloca el modelo con el centro del carro en `center` y mirando hacia `direction`
inline void ResetBicycle(BicycleState& state, const BicycleParams& params, const glm::vec2& center, const glm::vec2& direction) {
    const glm::vec2 forward = glm::length(direction) > 1.0e-5f ? glm::normalize(direction) : glm::vec2(1.0f, 0.0f);
    state.heading = std::atan2(forward.y, forward.x);
    state.rear = center - forward * (params.wheelbase * 0.5f);
    state.steer = 0.0f;
    state.ready = true;
}

// Angulo de direccion que lleva el eje trasero hacia `target` por un arco (persecucion pura)
inline float PurePursuitSteer(const BicycleState& state, const BicycleParams& params, const glm::vec2& target) {
    const glm::vec2 toTarget = target - state.rear;
    const float distance = glm::length(toTarget);
    if (distance < 0.05f) return 0.0f;
    float alpha = std::atan2(toTarget.y, toTarget.x) - state.heading;
    alpha = std::remainder(alpha, 6.28318531f);
    return std::clamp(std::atan2(2.0f * params.wheelbase * std::sin(alpha), distance), -params.maxSteer, params.maxSteer);
}

// Direccion para seguir una ruta (tipo Stanley con anticipacion): `routeCurvature` es el giro por metro de la ruta unos decimos de
// segundo adelante (da el angulo que pide la curva), y se corrige el error de rumbo y el error lateral del centro del carro.
// `reference` y `referenceDirection` son el punto de la ruta que corresponde al centro y su direccion.
inline float TrackingSteer(const BicycleState& state, const BicycleParams& params, const glm::vec2& reference,
                           const glm::vec2& referenceDirection, float routeCurvature, float speed) {
    const glm::vec2 center = state.Center(params);
    const glm::vec2 forward = state.Forward();
    const float headingError = std::remainder(std::atan2(referenceDirection.y, referenceDirection.x) - state.heading, 6.28318531f);
    const float crossTrack = (reference.x - center.x) * -forward.y + (reference.y - center.y) * forward.x;   // + = ruta a la izquierda
    const float feedForward = 1.08f * std::atan(params.wheelbase * routeCurvature);
    return feedForward + 1.4f * headingError + std::atan(2.0f * crossTrack / (speed + 1.0f));
}

// Avanza `dt` segundos con velocidad lineal `speed` (>= 0) y angulo deseado `desiredSteer`
inline void StepBicycle(BicycleState& state, const BicycleParams& params, float speed, float desiredSteer, float dt) {
    if (dt <= 0.0f) return;
    const float wanted = std::clamp(desiredSteer, -params.maxSteer, params.maxSteer);
    const float blend = 1.0f - std::exp(-params.steerSmoothing * dt);
    const float step = std::clamp((wanted - state.steer) * blend, -params.steerRate * dt, params.steerRate * dt);
    state.steer = std::clamp(state.steer + step, -params.maxSteer, params.maxSteer);
    // el rumbo gira primero la mitad del paso y el eje trasero avanza por ese rumbo medio (integracion de punto medio)
    const float turn = speed * std::tan(state.steer) / params.wheelbase * dt;
    const float midHeading = state.heading + turn * 0.5f;
    state.rear += glm::vec2(std::cos(midHeading), std::sin(midHeading)) * (speed * dt);
    state.heading += turn;
}

} // namespace Bazuko
