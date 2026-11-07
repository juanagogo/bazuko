#include "world/BusService.h"

#include <algorithm>
#include <cmath>
#include <limits>
#include <stdexcept>

namespace bazuko {

namespace {
constexpr double kAcceleration = 1.1, kBraking = 4, kCruise = 5;
constexpr double kStopSeconds = 4, kEndFade = 6;
}  // namespace

BusService::BusService(const BusRoute& r, double height) : route_(r) {
    if (!(r.startZ > r.stationZ && r.stationZ > r.endZ))
        throw std::invalid_argument("La estación debe quedar dentro del recorrido del bus.");
    position = {r.x, height, r.startZ};
}

double BusService::clearanceTo(const Vec3& p) const {
    // El frente es −Z. Incluye el radio de la persona y un margen ante el parachoques.
    if (std::abs(p.x - position.x) > kBusWidth / 2 + 0.55) return std::numeric_limits<double>::infinity();
    if (p.z > position.z + kBusLength / 2 + 0.55) return std::numeric_limits<double>::infinity();
    return std::max(0.0, position.z - p.z - kBusLength / 2 - 0.8);
}

double BusService::opacity() const {
    return std::clamp(std::min((route_.startZ - position.z) / kEndFade, (position.z - route_.endZ) / kEndFade), 0.0, 1.0);
}

void BusService::update(double dt, const Vec3* player, const std::vector<Vec3>& pedestrians) {
    double remaining = std::min(std::max(dt, 0.0), 0.5);
    traveledLast = 0;
    while (remaining > 1e-8) {
        const double step = std::min(remaining, 0.05);
        remaining -= step;
        if (dwellRemaining > 0) {
            dwellRemaining = std::max(0.0, dwellRemaining - step);
            continue;
        }
        double clearance = position.z - route_.endZ;
        if (!servedStation) clearance = std::min(clearance, position.z - route_.stationZ);
        if (player) clearance = std::min(clearance, clearanceTo(*player));
        for (const Vec3& p : pedestrians) clearance = std::min(clearance, clearanceTo(p));
        const double desired = std::min(kCruise, std::sqrt(2 * kBraking * std::max(0.0, clearance)));
        const double rate = desired < speed ? kBraking : kAcceleration;
        speed = std::clamp(desired, speed - rate * step, speed + rate * step);
        const double travel = std::min(speed * step, std::max(0.0, clearance));
        position.z -= travel;
        traveledLast += travel;
        speed = travel / step;
        if (!servedStation && position.z <= route_.stationZ + 1e-8) {
            position.z = route_.stationZ;
            servedStation = true;
            speed = 0;
            dwellRemaining = kStopSeconds;
        }
        if (position.z <= route_.endZ + 1e-8) {
            position.z = route_.startZ;
            servedStation = false;
            speed = 0;
        }
    }
}

}  // namespace bazuko
