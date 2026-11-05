#include "render/Frustum.h"

namespace bazuko {

Frustum Frustum::fromViewProjection(const glm::mat4& m) {
    Frustum f;
    auto row = [&](int i) { return glm::vec4(m[0][i], m[1][i], m[2][i], m[3][i]); };
    const glm::vec4 r0 = row(0), r1 = row(1), r2 = row(2), r3 = row(3);
    f.planes_[0] = r3 + r0;  // izquierda
    f.planes_[1] = r3 - r0;  // derecha
    f.planes_[2] = r3 + r1;  // abajo
    f.planes_[3] = r3 - r1;  // arriba
    f.planes_[4] = r3 + r2;  // cercano
    f.planes_[5] = r3 - r2;  // lejano
    return f;
}

bool Frustum::intersects(const Aabb& b) const {
    for (const glm::vec4& p : planes_) {
        // vértice de la caja más alejado en la dirección de la normal del plano
        const double x = p.x >= 0 ? b.max.x : b.min.x;
        const double y = p.y >= 0 ? b.max.y : b.min.y;
        const double z = p.z >= 0 ? b.max.z : b.min.z;
        if (p.x * x + p.y * y + p.z * z + p.w < 0) return false;
    }
    return true;
}

}  // namespace bazuko
