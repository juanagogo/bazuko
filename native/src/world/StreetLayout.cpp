#include "world/StreetLayout.h"

#include <algorithm>

namespace bazuko {

StreetAxis StreetAxis::build(const std::vector<Band>& roads, int sidewalkWidth) {
    auto isRoad = [&](int i) {
        return std::any_of(roads.begin(), roads.end(), [i](const Band& r) { return i >= r.a && i <= r.b; });
    };
    StreetAxis axis;
    int size = 0;
    for (int i = 0; i < kOriginalSize; ++i) {
        const int w = isRoad(i) ? 3 : (isRoad(i - 1) || isRoad(i + 1)) ? sidewalkWidth : 1;
        axis.widths.push_back(w);
        axis.starts.push_back(size);
        size += w;
    }
    axis.size = size;
    return axis;
}

double StreetAxis::tile(double value) const {
    const int i = std::max(0, std::min(kOriginalSize - 1, static_cast<int>(std::floor(value + 0.5))));
    return starts[i] - 0.5 + (value - i + 0.5) * widths[i];
}

double StreetAxis::original(double value) const {
    int i = 0;
    while (i < static_cast<int>(widths.size()) - 1 && value >= starts[i] + widths[i] - 0.5) ++i;
    return i - 0.5 + (value - starts[i] + 0.5) / widths[i];
}

Band StreetAxis::band(const Band& b) const {
    return {starts[b.a], starts[b.b] + widths[b.b] - 1, b.name};
}

const std::vector<Band>& originalCarreras() {
    static const std::vector<Band> v = {{6, 7, "Carrera 15"}, {40, 41, "Carrera 10"}};
    return v;
}
const CaracasBands& originalCaracas() {
    static const CaracasBands v = {{{{22, 23, ""}, {26, 27, ""}}}, {24, 25, ""}};
    return v;
}
const std::vector<Band>& originalCalles() {
    static const std::vector<Band> v = {{12, 13, "Calle 10"}, {30, 31, "Calle 9"}};
    return v;
}

static std::vector<Band> verticalBands(const std::vector<Band>& carreras, const CaracasBands& c) {
    std::vector<Band> v = carreras;
    v.push_back(c.lanes[0]);
    v.push_back(c.lanes[1]);
    v.push_back(c.busway);
    return v;
}

const StreetAxis& streetX() {
    static const StreetAxis a = StreetAxis::build(verticalBands(originalCarreras(), originalCaracas()));
    return a;
}
const StreetAxis& streetZ() {
    static const StreetAxis a = StreetAxis::build(originalCalles());
    return a;
}
const std::vector<Band>& carreras() {
    static const std::vector<Band> v = [] {
        std::vector<Band> out;
        for (const auto& b : originalCarreras()) out.push_back(streetX().band(b));
        return out;
    }();
    return v;
}
const std::vector<Band>& calles() {
    static const std::vector<Band> v = [] {
        std::vector<Band> out;
        for (const auto& b : originalCalles()) out.push_back(streetZ().band(b));
        return out;
    }();
    return v;
}
const CaracasBands& caracas() {
    static const CaracasBands v = {
        {{streetX().band(originalCaracas().lanes[0]), streetX().band(originalCaracas().lanes[1])}},
        streetX().band(originalCaracas().busway)};
    return v;
}

Vec3 migrateStreetPosition(const Vec3& p, int version) {
    // La ampliación v3 añade terreno sin desplazar las coordenadas de la v2.
    if (version >= 2) return p;
    static const StreetAxis previousX = StreetAxis::build(verticalBands(originalCarreras(), originalCaracas()), 1);
    static const StreetAxis previousZ = StreetAxis::build(originalCalles(), 1);
    const double tx = version == 1 ? previousX.original(p.x / kTileSize) : p.x / kTileSize;
    const double tz = version == 1 ? previousZ.original(p.z / kTileSize) : p.z / kTileSize;
    return {streetX().world(tx), p.y, streetZ().world(tz)};
}

}  // namespace bazuko
