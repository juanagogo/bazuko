#pragma once

#include <vector>

#include "core/MathTypes.h"
#include "core/Rng.h"
#include "world/TrafficRoute.h"

namespace bazuko {

constexpr double kCarLength = 4.3, kCarWidth = 1.76;  // carro y taxi (makeVehicle)

struct TrafficVehicle {
    int route = 0;
    double distance = 0, speed = 0, cruiseSpeed = 0;
    double nextDistance = 0, nextSpeed = 0;
    double length = kCarLength, width = kCarWidth;
    Vec3 position;
    double rotationY = 0;     // atan2(-dir.z, dir.x): el frente del modelo es +X local
    bool braking = false;     // luces de freno
    double traveled = 0;      // metros recorridos en el último paso (animar ruedas)
};

// Carros que circulan por circuitos cerrados, frenan ante el de adelante, el jugador y los peatones.
class TrafficSystem {
public:
    TrafficSystem(std::vector<TrafficRoute> routes, int carsPerRoute, Rng& rng);

    const std::vector<TrafficVehicle>& vehicles() const { return vehicles_; }
    std::vector<TrafficVehicle>& vehicles() { return vehicles_; }
    const std::vector<TrafficRoute>& routes() const { return routes_; }

    // `player` puede ser nulo; `pedestrians` son posiciones de peatones.
    void update(double dt, const Vec3* player, const std::vector<Vec3>& pedestrians);

    // Distancia libre delante del vehículo (exposición para pruebas).
    double clearance(int vehicleIndex, const Vec3* player, const std::vector<Vec3>& pedestrians) const;

    // ¿Está la persona dentro de la carrocería (más un margen de frenado) del vehículo en esa pose?
    static bool personInCar(const Vec3& person, const Vec3& probePos, const Vec3& probeDir, const TrafficVehicle& v);

private:
    std::vector<TrafficRoute> routes_;
    std::vector<TrafficVehicle> vehicles_;
};

}  // namespace bazuko
