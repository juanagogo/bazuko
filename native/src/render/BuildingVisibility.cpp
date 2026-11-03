#include "render/BuildingVisibility.h"

#include <algorithm>
#include <cmath>

#include "world/RayBox.h"

namespace bazuko {

namespace {
const double kSampleHeights[5] = {0.45, 1.1, 1.85, 1.1, 1.1};
}

BuildingVisibility::BuildingVisibility(const std::vector<House>& houses)
    : houses_(houses), state_(houses.size()), separate_(houses.size() + 1, 0) {}

void BuildingVisibility::fade(Part& p, bool hidden, double dt, bool reset) {
    p.clearTime = hidden ? 0 : p.clearTime + dt;
    const bool target = !(hidden || p.clearTime < kRestoreDelay);
    const double opacity = reset ? 1.0 : std::clamp(p.opacity + (target ? 1 : -1) * dt / kFadeSeconds, 0.0, 1.0);
    if (reset) p.clearTime = kRestoreDelay;
    p.opacity = opacity;
}

bool BuildingVisibility::intersects(const Aabb& box) const {
    for (const Ray& r : rays_) {
        const double t = rayAabb(r.origin, r.dir, box);
        if (t < 0) continue;
        const double limit = r.distance - 0.08;
        if (t * t < limit * limit) return true;  // el punto de entrada queda antes del jugador
    }
    return false;
}

void BuildingVisibility::update(double dt, bool isometric, const Vec3& camera, const Vec3& right, const Vec3& player) {
    enabled_ = isometric;
    if (closedMode_ != !enabled_) {
        // Cambio de vista: se restauran todas las piezas de golpe.
        closedMode_ = !enabled_;
        for (HouseState& h : state_)
            for (Part& p : h.parts) fade(p, false, dt, true);
        std::fill(separate_.begin(), separate_.end(), 0);
    }
    if (!enabled_) return;

    camera_ = camera;
    for (int i = 0; i < 5; ++i) {
        Vec3 target{player.x, player.y + kSampleHeights[i], player.z};
        if (i >= 3) {
            const double side = i == 3 ? -0.45 : 0.45;
            target.x += right.x * side;
            target.z += right.z * side;
        }
        Vec3 d{target.x - camera.x, target.y - camera.y, target.z - camera.z};
        const double len = std::sqrt(d.x * d.x + d.y * d.y + d.z * d.z);
        rays_[i] = {camera, {d.x / len, d.y / len, d.z / len}, len};
    }

    for (size_t i = 0; i < houses_.size(); ++i) {
        const House& house = houses_[i];
        HouseState& st = state_[i];
        const bool candidate = intersects(house.bounds);
        bool blocked = candidate && intersects(house.roof.bounds);
        for (int w = 0; w < 4; ++w) {
            const bool hidden = candidate && !house.walls[w].draws.empty() && intersects(house.walls[w].bounds);
            blocked = blocked || hidden;
            fade(st.parts[w], hidden, dt);
        }
        fade(st.parts[4], blocked, dt);
        bool faded = false;
        for (const Part& p : st.parts) faded |= p.opacity < 1;
        separate_[house.id] = faded ? 1 : 0;
    }
}

}  // namespace bazuko
