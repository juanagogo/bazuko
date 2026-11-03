#pragma once

#include <functional>
#include <vector>

#include "core/MathTypes.h"
#include "core/Rng.h"
#include "world/TileMap.h"

namespace bazuko {

struct NavNode {
    int x, z;
    bool crossing;  // tile de calzada que se puede cruzar
    std::vector<int> neighbors;
};

struct NavOptions {
    std::function<bool(int, int)> isCrossing = [](int, int) { return false; };
    std::function<bool(int, int)> isBlocked = [](int, int) { return false; };
    std::function<double(double, double)> groundHeight = [](double, double) { return 0.0; };
};

// Red compartida por todos los peatones: rutas por centros de tiles, sin diagonales.
class PedestrianNavigation {
public:
    PedestrianNavigation(const TileMap& map, double tileSize, NavOptions options = {});

    const std::vector<NavNode>& nodes() const { return nodes_; }
    double tileSize() const { return tileSize_; }
    double groundHeightAt(double x, double z) const { return options_.groundHeight(x, z); }

    int nodeAt(double x, double z) const;  // -1 si no hay nodo
    bool isWalkableAt(double x, double z) const { return nodeAt(x, z) >= 0; }
    // Nodo no-cruce más cercano; false si no hay ninguno.
    bool nearestPoint(double x, double z, Vec3& out) const;
    // Ruta aleatoria (>= 8 pasos si se puede, hasta 22) desde `position`. Vacía si está fuera de la red.
    std::vector<Vec3> createRoute(const Vec3& position, Rng& rng) const;

private:
    Vec3 point(int id) const;

    double tileSize_;
    NavOptions options_;
    int width_ = 0;
    std::vector<NavNode> nodes_;
    std::vector<int> grid_;  // id de nodo por tile, -1 si no hay
};

}  // namespace bazuko
