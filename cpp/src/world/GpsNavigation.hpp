#pragma once
// GPS a pie: A* sobre la grilla de casillas con preferencia por andenes y cruces. Logica pura (sin graficos).
// Port de src/systems/GpsNavigation.js del juego web.
#include <algorithm>
#include <cmath>
#include <functional>
#include <limits>
#include <optional>
#include <queue>
#include <string>
#include <vector>

namespace Bazuko {

class GpsNavigation {
public:
    struct Point { float x = 0.0f, z = 0.0f; };
    enum class Event { None, Arrived, Replanned };
    static constexpr float kArrivalDistance = 4.0f;
    static constexpr float kOffRouteDistance = 6.0f;
    static constexpr float kReplanInterval = 1.0f;   // s
    static constexpr float kBlocked = std::numeric_limits<float>::infinity();

    // `cost(tx, tz)` es el coste de pisar la casilla (kBlocked si no se puede). La casilla (tx, tz) cubre
    // [tx*tile - originX, (tx+1)*tile - originX) en X y lo mismo en Z con originZ.
    using CostFn = std::function<float(int, int)>;
    GpsNavigation(int width, int height, float tileSize, float originX, float originZ, const CostFn& cost)
        : m_Width(width), m_Height(height), m_Tile(tileSize), m_OriginX(originX), m_OriginZ(originZ),
          m_Cost(static_cast<size_t>(width) * static_cast<size_t>(height)),
          m_G(m_Cost.size()), m_Parent(m_Cost.size()), m_Stamp(m_Cost.size(), 0), m_Closed(m_Cost.size(), 0) {
        for (int z = 0; z < height; ++z)
            for (int x = 0; x < width; ++x) m_Cost[static_cast<size_t>(z * width + x)] = cost(x, z);
    }

    bool IsRoutable(float x, float z) const {
        const int i = IndexAt(x, z);
        return i >= 0 && std::isfinite(m_Cost[static_cast<size_t>(i)]);
    }

    // Ruta en coordenadas del mundo, o vacia si no hay camino a pie
    std::vector<Point> FindPath(Point from, Point to) {
        const int start = NearestOpen(from, 6);
        const int goal = NearestOpen(to, 16);
        if (start < 0 || goal < 0) return {};
        const int search = ++m_Search;
        const int gx = goal % m_Width, gz = goal / m_Width;
        constexpr float kSqrt2 = 1.41421356f;
        const auto heuristic = [&](int i) {
            const float dx = static_cast<float>(std::abs(i % m_Width - gx)), dz = static_cast<float>(std::abs(i / m_Width - gz));
            return std::max(dx, dz) + (kSqrt2 - 1.0f) * std::min(dx, dz);
        };
        using Item = std::pair<float, int>;
        std::priority_queue<Item, std::vector<Item>, std::greater<Item>> open;
        m_Stamp[static_cast<size_t>(start)] = search;
        m_G[static_cast<size_t>(start)] = 0.0f;
        m_Parent[static_cast<size_t>(start)] = -1;
        open.push({heuristic(start), start});
        bool found = false;
        static const int kNeighbors[8][2] = {{1, 0}, {-1, 0}, {0, 1}, {0, -1}, {1, 1}, {1, -1}, {-1, 1}, {-1, -1}};
        while (!open.empty()) {
            const int current = open.top().second;
            open.pop();
            if (m_Closed[static_cast<size_t>(current)] == search) continue;
            m_Closed[static_cast<size_t>(current)] = search;
            if (current == goal) { found = true; break; }
            const int cx = current % m_Width, cz = current / m_Width;
            for (const auto& n : kNeighbors) {
                const int nx = cx + n[0], nz = cz + n[1];
                if (nx < 0 || nx >= m_Width || nz < 0 || nz >= m_Height) continue;
                const int next = nz * m_Width + nx;
                const float step = m_Cost[static_cast<size_t>(next)];
                if (!std::isfinite(step) || m_Closed[static_cast<size_t>(next)] == search) continue;
                // sin cortar esquinas de edificios en diagonal
                if (n[0] && n[1] && (!std::isfinite(m_Cost[static_cast<size_t>(cz * m_Width + nx)]) || !std::isfinite(m_Cost[static_cast<size_t>(nz * m_Width + cx)]))) continue;
                const float tentative = m_G[static_cast<size_t>(current)] + step * ((n[0] && n[1]) ? kSqrt2 : 1.0f);
                if (m_Stamp[static_cast<size_t>(next)] == search && tentative >= m_G[static_cast<size_t>(next)]) continue;
                m_Stamp[static_cast<size_t>(next)] = search;
                m_G[static_cast<size_t>(next)] = tentative;
                m_Parent[static_cast<size_t>(next)] = current;
                open.push({tentative + heuristic(next), next});
            }
        }
        if (!found) return {};
        std::vector<int> cells;
        for (int i = goal; i >= 0; i = m_Parent[static_cast<size_t>(i)]) cells.push_back(i);
        std::reverse(cells.begin(), cells.end());
        return Smooth(cells);
    }

    // Fija un destino y calcula la ruta desde `from`; false si no hay camino a pie
    bool SetWaypoint(Point waypoint, std::string name, Point from, float now = 0.0f) {
        if (!std::isfinite(waypoint.x) || !std::isfinite(waypoint.z)) return false;
        m_Waypoint = waypoint;
        m_Name = std::move(name);
        return Plan(from, now);
    }

    void Clear() {
        m_Waypoint.reset();
        m_Route.clear();
        m_Suffix.clear();
        m_RouteLength = 0.0f;
        m_Progress = 0;
    }

    // Avanza el GPS: Arrived al llegar (borra el destino), Replanned al recalcular tras desviarse
    Event Update(Point pos, float now) {
        if (!m_Waypoint) return Event::None;
        if (std::hypot(pos.x - m_Waypoint->x, pos.z - m_Waypoint->z) < kArrivalDistance) {
            m_LastArrival = *m_Waypoint;
            m_LastArrivalName = m_Name;
            Clear();
            return Event::Arrived;
        }
        const float off = m_Route.size() > 1 ? Track(pos) : std::numeric_limits<float>::infinity();
        if (off > kOffRouteDistance && now - m_LastPlan >= kReplanInterval) {
            Plan(pos, now);
            return Event::Replanned;
        }
        return Event::None;
    }

    // Puntos que faltan, empezando por el jugador
    std::vector<Point> RemainingRoute(Point pos) const {
        if (m_Route.empty()) return {};
        std::vector<Point> result{pos};
        for (size_t i = m_Progress + 1; i < m_Route.size(); ++i) result.push_back(m_Route[i]);
        return result;
    }

    float RemainingDistance(Point pos) const {
        if (!m_Waypoint) return 0.0f;
        if (m_Progress + 1 >= m_Route.size()) return std::hypot(m_Waypoint->x - pos.x, m_Waypoint->z - pos.z);
        const Point& next = m_Route[m_Progress + 1];
        return std::hypot(next.x - pos.x, next.z - pos.z) + m_Suffix[m_Progress + 1];
    }

    const std::optional<Point>& Waypoint() const { return m_Waypoint; }
    const std::string& Name() const { return m_Name; }
    const std::vector<Point>& Route() const { return m_Route; }
    float RouteLength() const { return m_RouteLength; }
    const std::string& LastArrivalName() const { return m_LastArrivalName; }

private:
    int IndexAt(float x, float z) const {
        const int tx = static_cast<int>(std::floor((x + m_OriginX) / m_Tile));
        const int tz = static_cast<int>(std::floor((z + m_OriginZ) / m_Tile));
        if (tx < 0 || tx >= m_Width || tz < 0 || tz >= m_Height) return -1;
        return tz * m_Width + tx;
    }

    Point PointOf(int i) const {
        return {static_cast<float>(i % m_Width) * m_Tile + m_Tile * 0.5f - m_OriginX,
                static_cast<float>(i / m_Width) * m_Tile + m_Tile * 0.5f - m_OriginZ};
    }

    // Casilla transitable mas cercana (en anillos), util para destinos dentro de edificios
    int NearestOpen(Point p, int maxRadius) const {
        const int direct = IndexAt(p.x, p.z);
        if (direct >= 0 && std::isfinite(m_Cost[static_cast<size_t>(direct)])) return direct;
        const int tx = static_cast<int>(std::floor((p.x + m_OriginX) / m_Tile));
        const int tz = static_cast<int>(std::floor((p.z + m_OriginZ) / m_Tile));
        int best = -1;
        int bestDistance = std::numeric_limits<int>::max();
        for (int r = 1; r <= maxRadius && best < 0; ++r) {
            for (int dz = -r; dz <= r; ++dz) {
                for (int dx = -r; dx <= r; ++dx) {
                    if (std::max(std::abs(dx), std::abs(dz)) != r) continue;
                    const int x = tx + dx, z = tz + dz;
                    if (x < 0 || x >= m_Width || z < 0 || z >= m_Height) continue;
                    const int i = z * m_Width + x;
                    if (!std::isfinite(m_Cost[static_cast<size_t>(i)])) continue;
                    const int d = dx * dx + dz * dz;
                    if (d < bestDistance) { bestDistance = d; best = i; }
                }
            }
        }
        return best;
    }

    // Linea de vision sobre la grilla: cada casilla atravesada debe estar en la ruta o costar a lo sumo lo que las omitidas
    bool LineClear(int a, int b, float maxCost) const {
        const Point pa = PointOf(a), pb = PointOf(b);
        const int steps = static_cast<int>(std::ceil(std::hypot(pb.x - pa.x, pb.z - pa.z) / (m_Tile * 0.35f)));
        for (int s = 1; s < steps; ++s) {
            const float t = static_cast<float>(s) / static_cast<float>(steps);
            const int i = IndexAt(pa.x + (pb.x - pa.x) * t, pa.z + (pb.z - pa.z) * t);
            if (i < 0 || !(m_Cost[static_cast<size_t>(i)] <= maxCost || m_Closed[static_cast<size_t>(i)] == m_PathMark)) return false;
        }
        return true;
    }

    std::vector<Point> Smooth(const std::vector<int>& cells) {
        std::vector<Point> points;
        if (cells.size() <= 2) {
            for (int i : cells) points.push_back(PointOf(i));
            return points;
        }
        m_PathMark = ++m_Search;
        for (int i : cells) m_Closed[static_cast<size_t>(i)] = m_PathMark;
        points.push_back(PointOf(cells.front()));
        size_t anchor = 0;
        while (anchor < cells.size() - 1) {
            size_t next = anchor + 1;
            float maxCost = 0.0f;
            for (size_t j = anchor + 2; j < cells.size(); ++j) {
                const float segmentMax = std::max(maxCost, m_Cost[static_cast<size_t>(cells[j - 1])]);
                if (!LineClear(cells[anchor], cells[j], segmentMax)) break;
                next = j;
                maxCost = segmentMax;
            }
            points.push_back(PointOf(cells[next]));
            anchor = next;
        }
        return points;
    }

    bool Plan(Point from, float now) {
        m_LastPlan = now;
        std::vector<Point> path = FindPath(from, *m_Waypoint);
        if (path.empty()) {
            m_Route.clear();
            m_Suffix.clear();
            m_RouteLength = 0.0f;
            return false;
        }
        // el ultimo punto es el destino real aunque este dentro de un solar
        const Point end = path.back();
        if (std::hypot(end.x - m_Waypoint->x, end.z - m_Waypoint->z) > 0.5f && IsRoutable(m_Waypoint->x, m_Waypoint->z)) path.push_back(*m_Waypoint);
        m_Route = std::move(path);
        m_Suffix.assign(m_Route.size(), 0.0f);
        for (size_t i = m_Route.size() - 1; i-- > 0;)
            m_Suffix[i] = m_Suffix[i + 1] + std::hypot(m_Route[i + 1].x - m_Route[i].x, m_Route[i + 1].z - m_Route[i].z);
        m_RouteLength = m_Suffix.empty() ? 0.0f : m_Suffix[0];
        m_Progress = 0;
        return true;
    }

    // Distancia del jugador a la ruta; el avance solo mira hacia adelante para no retroceder en rutas que se cruzan
    float Track(Point pos) {
        float best = std::numeric_limits<float>::infinity();
        size_t bestSegment = m_Progress;
        for (size_t i = m_Progress; i + 1 < m_Route.size() && i < m_Progress + 12; ++i) {
            const Point& a = m_Route[i];
            const Point& b = m_Route[i + 1];
            const float vx = b.x - a.x, vz = b.z - a.z;
            const float len2 = vx * vx + vz * vz;
            const float t = std::clamp(((pos.x - a.x) * vx + (pos.z - a.z) * vz) / (len2 > 0.0f ? len2 : 1.0f), 0.0f, 1.0f);
            const float d = std::hypot(a.x + vx * t - pos.x, a.z + vz * t - pos.z);
            if (d < best - 0.01f) { best = d; bestSegment = i; }
        }
        m_Progress = bestSegment;
        return best;
    }

    int m_Width, m_Height;
    float m_Tile, m_OriginX, m_OriginZ;
    std::vector<float> m_Cost, m_G;
    std::vector<int> m_Parent;
    std::vector<unsigned> m_Stamp, m_Closed;
    unsigned m_Search = 0, m_PathMark = 0;
    std::optional<Point> m_Waypoint;
    std::string m_Name, m_LastArrivalName;
    std::optional<Point> m_LastArrival;
    std::vector<Point> m_Route;
    std::vector<float> m_Suffix;
    float m_RouteLength = 0.0f;
    float m_LastPlan = -1.0e9f;
    size_t m_Progress = 0;
};

} // namespace Bazuko
