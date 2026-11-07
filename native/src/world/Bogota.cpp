#include "world/Bogota.h"

#include <algorithm>
#include <cmath>

namespace bazuko {

namespace {

constexpr double T = kTileSize;
double W(double tile) { return tile * T; }
double WX(double t) { return streetX().world(t); }
double WZ(double t) { return streetZ().world(t); }

// Centro de una banda [a, b] desplazado a un lado del carril (side = ±1).
double lane(const Band& b, double side) { return W((b.a + b.b) / 2.0 + side * (b.b - b.a + 1) / 4.0); }

bool inAnyBand(const std::vector<Band>& bands, double v, double margin) {
    return std::any_of(bands.begin(), bands.end(), [&](const Band& b) { return v >= b.a - margin && v <= b.b + margin; });
}

}  // namespace

Bogota::Bogota() : map_(buildCityMap()), populationScale_(cityAreaMultiplier()) {
    reserved_ = {
        {WX(20), WZ(11)},      // spawn
        {WX(14.5), WZ(34)},    // sell: dentro del portón de la bodega
        {WX(44.5), WZ(40)},    // bed: lote baldío
        {WX(14.5), WZ(21.5)},  // dealer: la olla de El Cartucho
        {WX(16.5), WZ(24.5)},  // craft
        {WX(34), WZ(29)},      // shop: andén de la Calle 9
    };
    const double pi = kPi;
    const auto& cc = cityCarreras();
    const auto& cl = cityCalles();
    vendors_ = {
        {WX(21), WZ(18.5), pi / 2, VendorKind::Chaza, "Chaza de don Efraín", {"cigarrillo", "cafe", "pan", "agua"}},
        {WX(28), WZ(29), 0, VendorKind::Fritanga, "Fritanga La Mona", {"lataComida", "pan", "refresco"}},
        {WX(39), WZ(36), -pi / 2, VendorKind::Chaza, "Dulces y minutos", {"cigarrillo", "refresco", "agua"}},
        {WX(18.5), WZ(21.5), 0, VendorKind::Chaza, "Chaza del callejón", {"cigarrillo", "pan", "agua"}},
        {W(cc[2].a - 1.5), W(55), pi / 2, VendorKind::Chaza, "Chaza de la Carrera 8", {"agua", "pan", "cafe"}},
        {W(52), W(cl[2].a - 1.5), 0, VendorKind::Fritanga, "Fritanga del Sur", {"lataComida", "pan", "refresco"}},
    };
}

bool Bogota::isWalkableAt(double wx, double wz) const {
    const int tx = static_cast<int>(jsRound(wx / T)), tz = static_cast<int>(jsRound(wz / T));
    return map_.inside(tx, tz) && isWalkable(map_.at(tx, tz));
}

double Bogota::groundHeightAt(double x, double z) const {
    const int tx = static_cast<int>(jsRound(x / T)), tz = static_cast<int>(jsRound(z / T));
    return map_.inside(tx, tz) ? groundHeight(map_.at(tx, tz)) : 0.0;
}

bool Bogota::isNearReserved(double x, double z, double dist) const {
    for (const Spot* r : reserved_.all())
        if (std::hypot(x - r->x, z - r->z) < dist) return true;
    return false;
}

std::vector<Spot> Bogota::spawnGrid() const {
    std::vector<Spot> grid;
    for (int tz = 2; tz < height() - 2; tz += 3) {
        for (int tx = 2; tx < width() - 2; tx += 3) {
            const Tile t = map_.at(tx, tz);
            if (t != Tile::Sidewalk && t != Tile::Dirt && t != Tile::Grass && t != Tile::Plaza) continue;
            const double x = W(tx), z = W(tz);
            if (isNearReserved(x, z)) continue;
            grid.push_back({x, z});
        }
    }
    return grid;
}

std::vector<ParkingSpot> Bogota::parkingSpots() const {
    const auto& cc = cityCarreras();
    const auto& cl = cityCalles();
    const auto& lanes = caracas().lanes;
    std::vector<Band> crossRoads = cc;
    crossRoads.push_back(lanes[0]);
    crossRoads.push_back(lanes[1]);
    auto nearCross = [&](int x, int z) { return inAnyBand(cl, z, 2) && inAnyBand(crossRoads, x, 2); };

    std::vector<ParkingSpot> spots;
    for (int z = 2; z < height() - 2; ++z) {
        // Los circuitos centrales quedan libres; se conserva el parqueo en los extremos.
        if (z >= cl[0].a - 2 && z <= cl[1].b + 2) continue;
        for (int x = 2; x < width() - 2; ++x) {
            if (map_.at(x, z) != Tile::Road || nearCross(x, z)) continue;
            if (x >= lanes[0].a && x <= lanes[1].b) continue;  // la Caracas no se parquea
            static const int dirs[4][2] = {{1, 0}, {-1, 0}, {0, 1}, {0, -1}};
            for (const auto& d : dirs) {
                if (map_.at(x + d[0], z + d[1]) != Tile::Sidewalk) continue;
                const bool alongZ = d[0] != 0;  // andén a los lados en x → la calle corre a lo largo de z
                spots.push_back({W(x) + d[0] * 0.4, W(z) + d[1] * 0.4, alongZ ? kPi / 2 : 0.0});
            }
        }
    }
    return spots;
}

std::vector<TrafficRoute> Bogota::trafficRoutes() const {
    const auto& cc = cityCarreras();
    const auto& cl = cityCalles();
    const auto& lanes = caracas().lanes;
    const double top = lane(cl[0], 1), bottom = lane(cl[1], -1), last = lane(cl.back(), -1);
    return {
        TrafficRoute(lane(cc[0], 1), lane(lanes[0], -1), top, bottom),
        TrafficRoute(lane(lanes[1], 1), lane(cc[1], -1), top, bottom),
        TrafficRoute(lane(cc[1], 1), lane(cc[2], -1), top, last),
        TrafficRoute(lane(cc[2], 1), lane(cc[3], -1), top, last),
        TrafficRoute(lane(cc[0], 1), lane(lanes[0], -1), lane(cl[1], 1), last),
        TrafficRoute(lane(lanes[1], 1), lane(cc[1], -1), lane(cl[1], 1), last),
    };
}

BusRoute Bogota::busRoute() const {
    const auto& bw = caracas().busway;
    const double centerX = (W(bw.a) + W(bw.b)) / 2;
    return {centerX + 3.5, W(height() - 2) - kBusLength / 2, W(1) + kBusLength / 2, WZ(21.5)};
}

CollisionWorld Bogota::buildCollisions() const {
    CollisionWorld world;
    for (int z = 0; z < height(); ++z) {
        int x = 0;
        while (x < width()) {
            if (!isSolid(map_.at(x, z))) { ++x; continue; }
            int x2 = x;
            while (x2 + 1 < width() && isSolid(map_.at(x2 + 1, z))) ++x2;
            world.add({(W(x) + W(x2)) / 2, 0, W(z)}, {(x2 - x + 1) * T, 8, T});
            x = x2 + 1;
        }
    }
    // estación de la troncal
    const auto& bw = caracas().busway;
    world.add({(W(bw.a) + W(bw.b)) / 2, 0, WZ(21.5)}, {2.6, 3, 16});
    return world;
}

PedestrianNavigation Bogota::createPedestrianNavigation() const {
    const auto& cc = cityCarreras();
    const auto& cl = cityCalles();
    const auto& lanes = caracas().lanes;
    std::vector<Band> carrerasAndCaracas = cc;
    carrerasAndCaracas.push_back({lanes[0].a, lanes[1].b, ""});
    const int shopX = static_cast<int>(jsRound(reserved_.shop.x / T));
    const int shopZ = static_cast<int>(jsRound(reserved_.shop.z / T));

    NavOptions opts;
    // Prolongación de los andenes en los cruces; no pasean por los carriles ni la estación.
    opts.isCrossing = [cl, carrerasAndCaracas](int x, int z) {
        for (const auto& b : cl)
            if ((z >= b.a - kSidewalkTiles && z < b.a) || (z > b.b && z <= b.b + kSidewalkTiles)) return true;
        for (const auto& b : carrerasAndCaracas)
            if ((x >= b.a - kSidewalkTiles && x < b.a) || (x > b.b && x <= b.b + kSidewalkTiles)) return true;
        return false;
    };
    opts.isBlocked = [shopX, shopZ](int x, int z) { return x == shopX && z == shopZ; };
    opts.groundHeight = [this](double x, double z) { return groundHeightAt(x, z); };
    return PedestrianNavigation(map_, T, std::move(opts));
}

std::vector<Vec3> Bogota::pedestrianSpawns(const PedestrianNavigation& nav) const {
    static const double spots[][2] = {
        // El Cartucho y parque.
        {13.5, 20}, {15.5, 20.5}, {13, 23}, {16, 23.5}, {11, 21.8}, {18, 22.4},
        {17, 19}, {12.5, 21}, {19.8, 21.5}, {33.5, 36}, {34, 43}, {21, 30},
        // Andenes, incluyendo la calle donde empieza el jugador.
        {18, 11}, {21, 11}, {21, 16}, {28, 19}, {39, 20}, {8, 27},
        {5, 18}, {30, 29}, {37, 32}, {8, 37}};
    const int spotCount = static_cast<int>(sizeof(spots) / sizeof(spots[0]));
    std::vector<Vec3> out;
    for (const auto& s : spots) {
        Vec3 p;
        if (nav.nearestPoint(WX(s[0]), WZ(s[1]), p)) out.push_back(p);
    }
    // Mantiene la densidad del centro y distribuye peatones por los barrios nuevos.
    std::vector<const NavNode*> candidates;
    for (const auto& n : nav.nodes())
        if (!n.crossing && (n.x >= originalCityWidth() - 1 || n.z >= originalCityHeight() - 1)) candidates.push_back(&n);
    const int count = std::min(static_cast<int>(candidates.size()),
                               static_cast<int>(jsRound(spotCount * (populationScale_ - 1))));
    for (int i = 0; i < count; ++i) {
        const NavNode* n = candidates[static_cast<size_t>(std::floor((i + 0.5) * candidates.size() / count))];
        out.push_back({W(n->x), groundHeightAt(W(n->x), W(n->z)), W(n->z)});
    }
    return out;
}

}  // namespace bazuko
