#pragma once

#include <vector>

#include "core/MathTypes.h"

namespace bazuko {

struct Aabb {
    Vec3 min, max;
};

// Sólidos estáticos como cajas alineadas a los ejes. El jugador es un círculo en XZ.
class CollisionWorld {
public:
    // Caja centrada en (cx, cz) apoyada en y: ocupa [y, y + size.y].
    void add(const Vec3& base, const Vec3& size);
    void clear() { boxes_.clear(); }
    const std::vector<Aabb>& boxes() const { return boxes_; }

    // Nueva posición válida tras moverse `delta` (eje X y luego Z, deslizando por las paredes).
    Vec3 resolveMove(const Vec3& pos, const Vec3& delta, double radius = 0.4) const;

private:
    void moveAxis(Vec3& pos, double radius, int axis, double delta) const;
    std::vector<Aabb> boxes_;
};

}  // namespace bazuko
