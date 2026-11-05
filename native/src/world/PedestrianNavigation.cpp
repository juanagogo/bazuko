#include "world/PedestrianNavigation.h"

#include <limits>

namespace bazuko {

namespace {
bool pedestrianTile(Tile t) {
    return t == Tile::Sidewalk || t == Tile::Dirt || t == Tile::Grass || t == Tile::Plaza || t == Tile::Floor;
}
}  // namespace

PedestrianNavigation::PedestrianNavigation(const TileMap& map, double tileSize, NavOptions options)
    : tileSize_(tileSize), options_(std::move(options)), width_(map.width()),
      grid_(static_cast<size_t>(map.width()) * map.height(), -1) {
    for (int z = 0; z < map.height(); ++z) {
        for (int x = 0; x < map.width(); ++x) {
            const Tile t = map.at(x, z);
            if (options_.isBlocked(x, z) || !(pedestrianTile(t) || (isStreet(t) && options_.isCrossing(x, z)))) continue;
            grid_[static_cast<size_t>(z) * width_ + x] = static_cast<int>(nodes_.size());
            nodes_.push_back({x, z, isStreet(t), {}});
        }
    }
    const int height = map.height();
    for (NavNode& node : nodes_) {
        static const int dirs[4][2] = {{1, 0}, {-1, 0}, {0, 1}, {0, -1}};
        for (const auto& d : dirs) {
            const int nx = node.x + d[0], nz = node.z + d[1];
            if (nx < 0 || nz < 0 || nx >= width_ || nz >= height) continue;
            const int id = grid_[static_cast<size_t>(nz) * width_ + nx];
            if (id >= 0) node.neighbors.push_back(id);
        }
    }
}

int PedestrianNavigation::nodeAt(double x, double z) const {
    const int tx = static_cast<int>(jsRound(x / tileSize_));
    const int tz = static_cast<int>(jsRound(z / tileSize_));
    if (tx < 0 || tz < 0 || tx >= width_ || static_cast<size_t>(tz) * width_ + tx >= grid_.size()) return -1;
    return grid_[static_cast<size_t>(tz) * width_ + tx];
}

Vec3 PedestrianNavigation::point(int id) const {
    const NavNode& n = nodes_[id];
    const double x = n.x * tileSize_, z = n.z * tileSize_;
    return {x, options_.groundHeight(x, z), z};
}

bool PedestrianNavigation::nearestPoint(double x, double z, Vec3& out) const {
    int nearest = -1;
    double best = std::numeric_limits<double>::infinity();
    for (int i = 0; i < static_cast<int>(nodes_.size()); ++i) {
        const NavNode& n = nodes_[i];
        if (n.crossing) continue;
        const double dx = n.x * tileSize_ - x, dz = n.z * tileSize_ - z;
        const double d = dx * dx + dz * dz;
        if (d < best) { best = d; nearest = i; }
    }
    if (nearest < 0) return false;
    out = point(nearest);
    return true;
}

std::vector<Vec3> PedestrianNavigation::createRoute(const Vec3& position, Rng& rng) const {
    const int start = nodeAt(position.x, position.z);
    if (start < 0) return {};
    const int n = static_cast<int>(nodes_.size());
    std::vector<int> queue(n), previous(n, -1), distance(n, 0);
    previous[start] = start;
    queue[0] = start;
    int head = 0, tail = 1;
    std::vector<int> destinations, nearby;
    while (head < tail) {
        const int id = queue[head++];
        const NavNode& node = nodes_[id];
        if (id != start && !node.crossing) {
            nearby.push_back(id);
            if (distance[id] >= 8) destinations.push_back(id);
        }
        if (distance[id] >= 22) continue;
        for (int next : node.neighbors) {
            if (previous[next] != -1) continue;
            previous[next] = id;
            distance[next] = distance[id] + 1;
            queue[tail++] = next;
        }
    }
    const auto& choices = destinations.empty() ? nearby : destinations;
    if (choices.empty()) return {};
    int id = choices[rng.below(static_cast<int>(choices.size()))];
    std::vector<Vec3> route;
    while (id != start) {
        route.push_back(point(id));
        id = previous[id];
    }
    route.push_back(point(start));
    return {route.rbegin(), route.rend()};
}

}  // namespace bazuko
