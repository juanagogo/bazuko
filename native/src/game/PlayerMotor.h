#pragma once

#include "core/Input.h"
#include "core/MathTypes.h"
#include "game/CameraRig.h"
#include "world/CollisionWorld.h"

namespace bazuko {

constexpr double kPlayerRadius = 0.4, kSpeedWalk = 3, kSpeedRun = 6;

enum class MoveState { Idle, Walk, Run };

// Movimiento del jugador: WASD relativo a la cámara (tercera persona) o a los ejes (isométrica).
class PlayerMotor {
public:
    Vec3 position{16, 0, 16};
    double rotationY = 0;
    double speed = 0;  // m/s reales del último paso
    MoveState state = MoveState::Idle;

    // forward = rumbo horizontal de la cámara; speedMult viene de StatsSystem::getSpeedMultiplier.
    void update(double dt, Input::Axis axis, bool running, CameraMode mode, double forwardX, double forwardZ,
                double speedMult, const CollisionWorld* collisions);
};

}  // namespace bazuko
