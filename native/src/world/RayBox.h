#pragma once

#include <algorithm>
#include <limits>

#include "world/CollisionWorld.h"

namespace bazuko {

// Distancia a la que el rayo entra en la caja (o sale, si el origen está dentro); -1 si no la toca.
inline double rayAabb(const Vec3& o, const Vec3& d, const Aabb& b) {
    double tmin = -std::numeric_limits<double>::infinity(), tmax = std::numeric_limits<double>::infinity();
    const double os[3] = {o.x, o.y, o.z}, ds[3] = {d.x, d.y, d.z};
    const double lo[3] = {b.min.x, b.min.y, b.min.z}, hi[3] = {b.max.x, b.max.y, b.max.z};
    for (int i = 0; i < 3; ++i) {
        if (ds[i] == 0) {
            if (os[i] < lo[i] || os[i] > hi[i]) return -1;
            continue;
        }
        double t0 = (lo[i] - os[i]) / ds[i], t1 = (hi[i] - os[i]) / ds[i];
        if (t0 > t1) std::swap(t0, t1);
        tmin = std::max(tmin, t0);
        tmax = std::min(tmax, t1);
    }
    if (tmax < tmin || tmax < 0) return -1;
    return tmin >= 0 ? tmin : tmax;
}

}  // namespace bazuko
