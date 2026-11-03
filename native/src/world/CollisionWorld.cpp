#include "world/CollisionWorld.h"

#include <algorithm>

namespace bazuko {

namespace {
double& comp(Vec3& v, int axis) { return axis == 0 ? v.x : v.z; }
double comp(const Vec3& v, int axis) { return axis == 0 ? v.x : v.z; }
}  // namespace

void CollisionWorld::add(const Vec3& base, const Vec3& size) {
    boxes_.push_back({{base.x - size.x / 2, base.y, base.z - size.z / 2},
                      {base.x + size.x / 2, base.y + size.y, base.z + size.z / 2}});
}

Vec3 CollisionWorld::resolveMove(const Vec3& current, const Vec3& delta, double radius) const {
    Vec3 pos = current;
    moveAxis(pos, radius, 0, delta.x);
    moveAxis(pos, radius, 2, delta.z);
    return pos;
}

void CollisionWorld::moveAxis(Vec3& pos, double radius, int axis, double delta) const {
    if (delta == 0) return;
    const int other = axis == 0 ? 2 : 0;
    const double epsilon = 1e-7;
    const double start = comp(pos, axis);
    double end = start + delta;
    for (const Aabb& box : boxes_) {
        // El contacto tangencial no es penetración (incluye error de coma flotante).
        const double bmin = comp(box.min, other), bmax = comp(box.max, other);
        if (comp(pos, other) <= bmin - radius + epsilon || comp(pos, other) >= bmax + radius - epsilon) continue;
        const double min = comp(box.min, axis) - radius;
        const double max = comp(box.max, axis) + radius;
        if (delta > 0 && start <= min + epsilon && end > min) {
            end = std::max(start, min);
        } else if (delta < 0 && start >= max - epsilon && end < max) {
            end = std::min(start, max);
        } else if (start > min + epsilon && start < max - epsilon) {
            // Una posición ya solapada puede salir por el lado más cercano, nunca saltando al otro extremo.
            if ((delta > 0 && start < (min + max) / 2) || (delta < 0 && start > (min + max) / 2)) end = start;
        }
    }
    comp(pos, axis) = end;
}

}  // namespace bazuko
