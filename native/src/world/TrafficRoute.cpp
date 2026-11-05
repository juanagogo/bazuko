#include "world/TrafficRoute.h"

#include <cmath>
#include <stdexcept>

namespace bazuko {

TrafficRoute::TrafficRoute(double left, double right, double top, double bottom, double radius) {
    if (radius <= 0 || right - left <= radius * 2 || bottom - top <= radius * 2)
        throw std::invalid_argument("El circuito de tráfico necesita espacio para sus giros.");
    auto line = [](double x, double z, double dx, double dz, double length) {
        return Segment{false, x, z, dx, dz, 0, 0, length};
    };
    auto arc = [radius](double x, double z, double angle) {
        return Segment{true, x, z, 0, 0, angle, radius, kPi * radius / 2};
    };
    segments_ = {line(left + radius, top, 1, 0, right - left - 2 * radius),
                 arc(right - radius, top + radius, -kPi / 2),
                 line(right, top + radius, 0, 1, bottom - top - 2 * radius),
                 arc(right - radius, bottom - radius, 0),
                 line(right - radius, bottom, -1, 0, right - left - 2 * radius),
                 arc(left + radius, bottom - radius, kPi / 2),
                 line(left, bottom - radius, 0, -1, bottom - top - 2 * radius),
                 arc(left + radius, top + radius, kPi)};
    for (const auto& s : segments_) length_ += s.length;
}

void TrafficRoute::sample(double distance, Vec3& position, Vec3& direction) const {
    double remaining = std::fmod(std::fmod(distance, length_) + length_, length_);
    const Segment* last = &segments_.back();
    for (const Segment& s : segments_) {
        last = &s;
        if (remaining > s.length) { remaining -= s.length; continue; }
        if (s.arc) {
            const double a = s.angle + remaining / s.radius;
            position = {s.x + std::cos(a) * s.radius, 0, s.z + std::sin(a) * s.radius};
            direction = {-std::sin(a), 0, std::cos(a)};
        } else {
            position = {s.x + s.dx * remaining, 0, s.z + s.dz * remaining};
            direction = {s.dx, 0, s.dz};
        }
        return;
    }
    // Error de redondeo al final del circuito: extremo del último tramo.
    position = {last->x + std::cos(last->angle + last->length / last->radius) * last->radius, 0,
                last->z + std::sin(last->angle + last->length / last->radius) * last->radius};
    direction = {0, 0, 0};
}

}  // namespace bazuko
