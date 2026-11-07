#pragma once

#include <vector>

#include "core/MathTypes.h"

namespace bazuko {

// Circuito de carril cerrado: cuatro rectas unidas por cuatro giros circulares. Metros.
class TrafficRoute {
public:
    // Lanza std::invalid_argument si no hay espacio para los giros.
    TrafficRoute(double left, double right, double top, double bottom, double radius = 1);

    double length() const { return length_; }
    // Posición y dirección unitaria a `distance` metros del inicio (da la vuelta al circuito).
    void sample(double distance, Vec3& position, Vec3& direction) const;

    struct Segment {
        bool arc;
        double x, z;
        double dx, dz;  // rectas
        double angle, radius;  // arcos
        double length;
    };
    const std::vector<Segment>& segments() const { return segments_; }

private:
    std::vector<Segment> segments_;
    double length_ = 0;
};

}  // namespace bazuko
