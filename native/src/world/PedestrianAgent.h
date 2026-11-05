#pragma once

#include <functional>
#include <optional>
#include <vector>

#include "core/MathTypes.h"
#include "core/Rng.h"
#include "world/PedestrianNavigation.h"

namespace bazuko {

struct AgentOptions {
    double wander = 0;  // radio para deambular alrededor de `home` si no hay navegación
    double facing = 0;
    double speed = 0;   // 0 = aleatoria entre 0.85 y 1.30 m/s
    const PedestrianNavigation* navigation = nullptr;
    std::function<bool(double, double)> isWalkable = [](double, double) { return true; };
    std::function<double(double, double)> groundHeight;  // si no se da, conserva la altura de `home`
};

// Lógica de movimiento de un peatón (sin render): sigue rutas de la red o deambula cerca de su casa.
// Un vendedor es un agente sin navegación ni radio: nunca se mueve.
class PedestrianAgent {
public:
    PedestrianAgent(const Vec3& home, AgentOptions options, Rng& rng);

    void update(double dt, Rng& rng);

    Vec3 home, position;
    double rotationY = 0;
    double walkSpeed = 1;
    bool moving = false;

private:
    std::optional<Vec3> pickTarget(Rng& rng) const;
    void advanceTarget(Rng& rng);

    AgentOptions opts_;
    std::vector<Vec3> route_;
    size_t routeIndex_ = 0;
    std::optional<Vec3> target_;
    double wait_ = 0;
};

}  // namespace bazuko
