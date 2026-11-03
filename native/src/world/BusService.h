#pragma once

#include <vector>

#include "core/MathTypes.h"

namespace bazuko {

constexpr double kBusLength = 18.2, kBusWidth = 2.52;  // bus articulado

struct BusRoute {
    double x, startZ, endZ, stationZ;
};

// Servicio hacia el norte (−Z) por el carril exclusivo, con parada en la estación y relevo en los extremos.
class BusService {
public:
    // Lanza std::invalid_argument si la estación no está entre el inicio y el final.
    explicit BusService(const BusRoute& route, double height = 0.02);

    void update(double dt, const Vec3* player, const std::vector<Vec3>& pedestrians);

    Vec3 position;
    double speed = 0;
    bool servedStation = false;
    double dwellRemaining = 0;
    double opacity() const;  // se desvanece en los extremos del recorrido
    double traveledLast = 0; // metros del último paso (ruedas)
    const BusRoute& route() const { return route_; }

private:
    double clearanceTo(const Vec3& p) const;
    BusRoute route_;
};

}  // namespace bazuko
