#include "game/Entities.h"

#include <algorithm>
#include <cmath>

namespace bazuko {

namespace {

void shuffle(auto& v, Rng& rng) {
    for (size_t i = v.size(); i > 1; --i) std::swap(v[i - 1], v[static_cast<size_t>(rng.below(static_cast<int>(i)))]);
}

}  // namespace

Vec3 findValidSpawn(const Bogota& city, const Entities& e, Rng& rng, const Vec3* exclude, double minDist) {
    const double T = kTileSize;
    const int w = city.width(), h = city.height();
    for (int attempt = 0; attempt < 200; ++attempt) {
        const int tx = 3 + rng.below(w - 6), tz = 3 + rng.below(h - 6);
        const double x = tx * T, z = tz * T;
        if (!city.isWalkableAt(x, z) || city.isNearReserved(x, z)) continue;
        bool tooClose = false;
        auto check = [&](const Vec3& p) {
            if (exclude && &p == exclude) return;
            if (std::hypot(p.x - x, p.z - z) < minDist) tooClose = true;
        };
        for (const Pickup& p : e.pickups) check(p.position);
        for (const ParkedCar& c : e.cars) check(c.position);
        if (tooClose) continue;
        return {x, 0, z};
    }
    const Spot& s = city.reserved().spawn;
    return {s.x, 0, s.z};
}

Entities spawnEntities(const Bogota& city, Rng& rng) {
    Entities e;

    // ===== Basura: sobre la rejilla de aparición (barajada); si no alcanza, en puntos válidos =====
    auto grid = city.spawnGrid();
    shuffle(grid, rng);
    const int desired = static_cast<int>(jsRound(14 * city.populationScale()));
    for (int i = 0; i < desired; ++i) {
        Pickup p;
        if (i < static_cast<int>(grid.size())) p.position = {grid[i].x, city.groundHeightAt(grid[i].x, grid[i].z), grid[i].z};
        else p.position = findValidSpawn(city, e, rng);
        e.pickups.push_back(p);
    }

    // ===== Carros aparcados junto al andén y alineados con la calle =====
    auto parking = city.parkingSpots();
    shuffle(parking, rng);
    const int carCount = static_cast<int>(jsRound(5 * city.populationScale()));
    std::vector<ParkingSpot> placed;
    for (int i = 0; i < carCount; ++i) {
        const ParkingSpot* spot = nullptr;
        for (const ParkingSpot& p : parking) {
            if (std::all_of(placed.begin(), placed.end(), [&](const ParkingSpot& q) { return std::hypot(p.x - q.x, p.z - q.z) > 8; })) {
                spot = &p;
                break;
            }
        }
        ParkedCar c;
        if (spot) {
            placed.push_back(*spot);
            c.position = {spot->x, 0, spot->z};
            c.rotation = spot->rot;
        } else {
            c.position = findValidSpawn(city, e, rng, nullptr, 6);
            c.rotation = rng.next() * kPi * 2;
        }
        c.taxi = rng.next() < 0.3;
        c.paint = rng.below(8);
        e.cars.push_back(c);
    }

    // ===== Lugares fijos =====
    const Reserved& r = city.reserved();
    auto place = [&](const Spot& s) { return Place{{s.x, city.groundHeightAt(s.x, s.z), s.z}}; };
    e.recycler = place(r.sell);
    e.dealer = place(r.dealer);
    e.craft = place(r.craft);
    e.cambuche = place(r.bed);
    e.shop = place(r.shop);
    return e;
}

void updateEntities(Entities& e, const Bogota& city, Rng& rng, double dt) {
    for (size_t i = 0; i < e.pickups.size(); ++i) {
        Pickup& p = e.pickups[i];
        if (p.sorting && !p.used) p.sortProgress += dt;
        if (p.cooldown > 0) {
            p.cooldown -= dt;
            if (p.cooldown <= 0) {
                p.position = findValidSpawn(city, e, rng, &p.position);  // reaparece en otro sitio
                p.position.y = city.groundHeightAt(p.position.x, p.position.z);
                p.used = false;
            }
        }
        p.markerSpin += dt * 0.8;
    }
    for (ParkedCar& c : e.cars) {
        if (c.cooldown > 0) {
            c.cooldown -= dt;
            if (c.cooldown <= 0) c.used = false;
        }
        c.markerSpin += dt * 0.5;
    }
}

}  // namespace bazuko
