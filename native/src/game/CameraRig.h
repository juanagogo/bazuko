#pragma once

#include "core/MathTypes.h"
#include "world/CollisionWorld.h"

namespace bazuko {

enum class CameraMode { ThirdPerson, Isometric };

constexpr double kCameraFovDegrees = 55, kCameraNear = 0.1, kCameraFar = 500;

// Cámara de seguimiento: tercera persona orbital con brazo que se acorta ante paredes, o isométrica.
// Solo calcula posición y punto de mira; las matrices las arma el renderer.
class CameraRig {
public:
    CameraMode mode = CameraMode::ThirdPerson;
    double yaw = -kPi / 2;  // mira a lo largo de la calle al comenzar
    double pitch = 0.22;
    double distance = 5.5;

    Vec3 position{12, 16, 12};
    Vec3 lookAt;

    // Cambia de modo; al entrar en tercera persona queda detrás de `facing`. Devuelve el modo nuevo.
    CameraMode toggle(double facing = 0);
    void orbit(double dx, double dy);  // píxeles de arrastre
    void zoom(double delta);           // píxeles de rueda
    // Flechas del teclado: gira la cámara (solo en tercera persona).
    void arrowOrbit(double dt, int horizontal, int vertical);
    void follow(const Vec3& target, double dt = 1.0 / 60, const CollisionWorld* collisions = nullptr);

    // Rumbo horizontal de la cámara (unitario). Sirve antes de llamar a follow().
    void forwardXZ(double& x, double& z) const;
    double armDistance() const { return arm_; }
    void snapNext() { snap_ = true; }

private:
    bool snap_ = true;
    double arm_ = 5.5;
};

}  // namespace bazuko
