#include "world/PedestrianAgent.h"

#include <algorithm>
#include <cmath>

namespace bazuko {

PedestrianAgent::PedestrianAgent(const Vec3& h, AgentOptions options, Rng& rng)
    : home(h), position(h), opts_(std::move(options)) {
    walkSpeed = opts_.speed > 0 ? opts_.speed : 0.85 + rng.next() * 0.45;
    rotationY = opts_.facing;
    wait_ = opts_.navigation ? 0 : rng.next() * 6;
    if (!opts_.groundHeight) {
        const double y = h.y;
        opts_.groundHeight = [y](double, double) { return y; };
    }
}

std::optional<Vec3> PedestrianAgent::pickTarget(Rng& rng) const {
    for (int i = 0; i < 12; ++i) {
        const double a = rng.next() * kPi * 2;
        const double r = rng.next() * opts_.wander;
        const double x = home.x + std::cos(a) * r, z = home.z + std::sin(a) * r;
        if (opts_.isWalkable(x, z)) return Vec3{x, 0, z};
    }
    return std::nullopt;
}

void PedestrianAgent::advanceTarget(Rng& rng) {
    if (opts_.navigation) {
        target_ = ++routeIndex_ < route_.size() ? std::optional<Vec3>(route_[routeIndex_]) : std::nullopt;
    } else {
        target_ = std::nullopt;
    }
    if (!target_) wait_ = opts_.navigation ? 1 + rng.next() * 3 : 3 + rng.next() * 8;
}

void PedestrianAgent::update(double dt, Rng& rng) {
    moving = false;
    if (!opts_.navigation && opts_.wander <= 0) return;
    if (!target_) {
        wait_ -= dt;
        if (wait_ > 0) return;
        if (opts_.navigation) {
            route_ = opts_.navigation->createRoute(position, rng);
            routeIndex_ = 0;
            target_ = route_.empty() ? std::nullopt : std::optional<Vec3>(route_[0]);
        } else {
            target_ = pickTarget(rng);
        }
        if (!target_) { wait_ = 2; return; }
    }
    double dx = target_->x - position.x, dz = target_->z - position.z;
    const double dist = std::hypot(dx, dz);
    if (dist < 0.001) {
        advanceTarget(rng);
        return;
    }
    const double step = std::min(dist, walkSpeed * dt);
    dx /= dist; dz /= dist;
    const double nx = position.x + dx * step, nz = position.z + dz * step;
    if (!opts_.isWalkable(nx, nz)) {
        target_ = std::nullopt;
        route_.clear();
        wait_ = 0.5;
        return;
    }
    position = {nx, opts_.groundHeight(nx, nz), nz};
    moving = step > 0;
    double diff = std::atan2(dx, dz) - rotationY;
    while (diff > kPi) diff -= kPi * 2;
    while (diff < -kPi) diff += kPi * 2;
    rotationY += diff * std::min(1.0, dt * 5);
    if (step >= dist) advanceTarget(rng);
}

}  // namespace bazuko
