#include "game/PlayerMotor.h"

#include <algorithm>
#include <cmath>

namespace bazuko {

void PlayerMotor::update(double dt, Input::Axis axis, bool wantsRun, CameraMode mode, double fx, double fz,
                         double speedMult, const CollisionWorld* collisions) {
    const bool moving = axis.x != 0 || axis.z != 0;
    const bool running = wantsRun && moving;
    const double velocity = (running ? kSpeedRun : kSpeedWalk) * speedMult;

    double dx = axis.x, dz = axis.z;
    if (mode == CameraMode::ThirdPerson) {
        const double len = std::hypot(fx, fz);
        fx /= len;
        fz /= len;
        const double rx = -fz, rz = fx;  // derecha de la cámara
        dx = rx * axis.x + fx * -axis.z;
        dz = rz * axis.x + fz * -axis.z;
    }
    if (moving) {
        const double len = std::hypot(dx, dz);
        dx /= len;
        dz /= len;
    }
    const Vec3 delta{moving ? dx * velocity * dt : 0, 0, moving ? dz * velocity * dt : 0};

    const Vec3 before = position;
    position = collisions ? collisions->resolveMove(position, delta, kPlayerRadius)
                          : Vec3{position.x + delta.x, position.y, position.z + delta.z};
    speed = dt > 0 ? std::hypot(position.x - before.x, position.z - before.z) / dt : 0;

    if (moving) {
        double diff = std::atan2(dx, dz) - rotationY;
        while (diff > kPi) diff -= kPi * 2;
        while (diff < -kPi) diff += kPi * 2;
        rotationY += diff * std::min(1.0, 12 * dt);
    }
    state = !moving ? MoveState::Idle : (running ? MoveState::Run : MoveState::Walk);
}

}  // namespace bazuko
