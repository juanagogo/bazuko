#include "world/TrafficSystem.h"

#include <algorithm>
#include <cmath>
#include <limits>

namespace bazuko {

namespace {
constexpr double kGap = 1.8, kAcceleration = 1.8, kBraking = 5, kProbeStep = 0.5;
constexpr double kInf = std::numeric_limits<double>::infinity();
}  // namespace

TrafficSystem::TrafficSystem(std::vector<TrafficRoute> routes, int carsPerRoute, Rng& rng) : routes_(std::move(routes)) {
    for (int r = 0; r < static_cast<int>(routes_.size()); ++r) {
        // Evita una población inicial mayor que el espacio disponible en el circuito.
        const int count = std::min(carsPerRoute, static_cast<int>(std::floor(routes_[r].length() / 12)));
        for (int i = 0; i < count; ++i) {
            TrafficVehicle v;
            v.route = r;
            v.distance = (i + 0.4) * routes_[r].length() / count;
            Vec3 dir;
            routes_[r].sample(v.distance, v.position, dir);
            v.rotationY = std::atan2(-dir.z, dir.x);
            v.cruiseSpeed = 3.5 + rng.next() * 1.5;
            v.nextDistance = v.distance;
            vehicles_.push_back(v);
        }
    }
}

bool TrafficSystem::personInCar(const Vec3& person, const Vec3& probePos, const Vec3& probeDir,
                                const TrafficVehicle& v) {
    const double dx = person.x - probePos.x, dz = person.z - probePos.z;
    const double forward = dx * probeDir.x + dz * probeDir.z;
    const double sideways = dx * -probeDir.z + dz * probeDir.x;
    // Incluye el radio del peatón y un margen de frenado alrededor de la carrocería.
    return std::abs(forward) < v.length / 2 + 0.8 && std::abs(sideways) < v.width / 2 + 0.55;
}

double TrafficSystem::clearance(int index, const Vec3* player, const std::vector<Vec3>& pedestrians) const {
    const TrafficVehicle& vehicle = vehicles_[index];
    const TrafficRoute& route = routes_[vehicle.route];
    double clear = kInf;
    for (int i = 0; i < static_cast<int>(vehicles_.size()); ++i) {
        const TrafficVehicle& other = vehicles_[i];
        if (i == index || other.route != vehicle.route) continue;
        const double gap = std::fmod(other.distance - vehicle.distance + route.length(), route.length());
        clear = std::min(clear, std::max(0.0, gap - (vehicle.length + other.length) / 2 - kGap));
    }
    // Mira también alrededor de los giros; no solo en línea recta frente al carro.
    const double speed = vehicle.speed;
    const double lookAhead = std::max(5.0, speed * speed / (2 * kBraking) + speed * 0.2 + 2);
    // Descarte amplio y conservador una vez por carro, no por cada muestra de su ruta.
    const double radius = lookAhead + std::hypot(vehicle.length / 2 + 0.8, vehicle.width / 2 + 0.55);
    std::vector<const Vec3*> nearby;
    for (const Vec3& p : pedestrians) {
        const double dx = p.x - vehicle.position.x, dz = p.z - vehicle.position.z;
        if (dx * dx + dz * dz <= radius * radius) nearby.push_back(&p);
    }
    Vec3 probePos, probeDir;
    for (double ahead = 0; ahead <= std::min(lookAhead, clear); ahead += kProbeStep) {
        route.sample(vehicle.distance + ahead, probePos, probeDir);
        if (player && personInCar(*player, probePos, probeDir, vehicle)) return std::max(0.0, ahead - kProbeStep);
        for (const Vec3* p : nearby)
            if (personInCar(*p, probePos, probeDir, vehicle)) return std::max(0.0, ahead - kProbeStep);
    }
    return clear;
}

void TrafficSystem::update(double dt, const Vec3* player, const std::vector<Vec3>& pedestrians) {
    if (dt <= 0) return;
    // Subpasos acotados: un cuadro lento no puede saltarse a otro vehículo o peatón.
    double remaining = std::min(dt, 0.5);
    while (remaining > 1e-8) {
        const double step = std::min(remaining, 0.05);
        for (int i = 0; i < static_cast<int>(vehicles_.size()); ++i) {
            TrafficVehicle& v = vehicles_[i];
            const double clear = clearance(i, player, pedestrians);
            const double desired = std::min(v.cruiseSpeed, std::sqrt(2 * kBraking * clear));
            const double rate = desired < v.speed ? kBraking : kAcceleration;
            const double speed = std::clamp(desired, v.speed - rate * step, v.speed + rate * step);
            const double travel = std::min(std::max(0.0, speed * step), clear);
            v.nextDistance = std::fmod(v.distance + travel, routes_[v.route].length());
            v.nextSpeed = travel / step;
        }
        // Todos consultan las mismas posiciones antes de aplicar el movimiento.
        for (TrafficVehicle& v : vehicles_) {
            v.traveled = std::fmod(v.nextDistance - v.distance + routes_[v.route].length(), routes_[v.route].length());
            v.distance = v.nextDistance;
            v.speed = v.nextSpeed;
            Vec3 dir;
            routes_[v.route].sample(v.distance, v.position, dir);
            v.rotationY = std::atan2(-dir.z, dir.x);
            v.braking = v.speed < v.cruiseSpeed * 0.7;
        }
        remaining -= step;
    }
}

}  // namespace bazuko
