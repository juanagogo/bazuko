#pragma once

#include <algorithm>
#include <cmath>
#include <vector>

#include "core/MathTypes.h"
#include "render/VisualWorld.h"
#include "world/CollisionWorld.h"

namespace bazuko {

// Luz puntual que llega al shader (valores ya con el parpadeo aplicado).
struct PooledLight {
    Vec3 position;
    Rgb color;
    double intensity = 0, distance = 0, decay = 2;
};

struct Halo {
    Vec3 position;  // sobre el suelo
    double radius;
    Rgb color;      // ya multiplicado por intensidad y distancia
};

// Un número fijo de luces reales (2) evita shaders con cientos de luces; el resto de fuentes cercanas
// se muestran como halos decorativos instanciados (LocalLights.js / LightHalos.js).
class LocalLights {
public:
    static constexpr int kPoolSize = 2;
    static constexpr size_t kHaloCapacity = 48;

    explicit LocalLights(const std::vector<LightSource>& sources, size_t haloCapacity = kHaloCapacity);

    // t = segundos de juego (parpadeo); target = jugador; groundHeight(x, z) da la cota del suelo.
    // `halosVisible(box)` filtra por la cámara (opcional).
    template <class Ground, class Visible>
    void update(double t, bool night, const Vec3& target, Ground&& groundHeight, Visible&& halosVisible);

    const PooledLight* pool() const { return pool_; }  // kPoolSize elementos (intensidad 0 si no hay fuente)
    const std::vector<Halo>& halos() const { return halos_; }

private:
    struct Entry {
        const LightSource* source;
        Vec3 position;
        double peak = 0, score = 0;
    };
    std::vector<Entry> entries_;
    std::vector<size_t> candidates_;  // índices en entries_, de mayor a menor puntuación
    PooledLight pool_[kPoolSize];
    std::vector<Halo> halos_;
    size_t haloCapacity_;
};

inline LocalLights::LocalLights(const std::vector<LightSource>& sources, size_t haloCapacity) : haloCapacity_(haloCapacity) {
    entries_.reserve(sources.size());
    for (const LightSource& s : sources) entries_.push_back({&s, s.position, 0, 0});
}

template <class Ground, class Visible>
void LocalLights::update(double t, bool night, const Vec3& target, Ground&& groundHeight, Visible&& halosVisible) {
    candidates_.clear();
    for (size_t i = 0; i < entries_.size(); ++i) {
        Entry& e = entries_[i];
        const double intensity = e.source->intensityAt(t, night);
        if (intensity <= 0) continue;
        const double dx = e.position.x - target.x, dy = e.position.y - target.y, dz = e.position.z - target.z;
        const double d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > 80.0 * 80.0) continue;
        // La llama parpadea, pero no debe intercambiar las luces elegidas en cada oscilación.
        e.peak = std::max(e.peak, intensity);
        e.score = e.peak / (1 + d2);
        candidates_.push_back(i);
    }
    std::stable_sort(candidates_.begin(), candidates_.end(), [&](size_t a, size_t b) { return entries_[a].score > entries_[b].score; });

    halos_.clear();
    for (size_t i : candidates_) {
        const Entry& e = entries_[i];
        const double distance = std::sqrt((e.position.x - target.x) * (e.position.x - target.x) +
                                          (e.position.y - target.y) * (e.position.y - target.y) +
                                          (e.position.z - target.z) * (e.position.z - target.z));
        if (distance >= 45 || halos_.size() == haloCapacity_) continue;
        const double radius = std::min(4.0, (e.source->distance > 0 ? e.source->distance : 8.0) * 0.45);
        const double height = groundHeight(e.position.x, e.position.z) + 0.025;
        const Aabb box{{e.position.x - radius, height - 0.01, e.position.z - radius}, {e.position.x + radius, height + 0.01, e.position.z + radius}};
        if (!halosVisible(box)) continue;
        const double intensity = e.source->intensityAt(t, night);
        const double k = std::min(1.0, intensity / 3) * std::min(1.0, (45 - distance) / 8);
        halos_.push_back({{e.position.x, height, e.position.z}, radius, {e.source->color.r * k, e.source->color.g * k, e.source->color.b * k}});
    }

    for (int i = 0; i < kPoolSize; ++i) {
        PooledLight& p = pool_[i];
        if (i < static_cast<int>(candidates_.size())) {
            const Entry& e = entries_[candidates_[i]];
            p = {e.position, e.source->color, e.source->intensityAt(t, night), e.source->distance, e.source->decay};
        } else {
            p.intensity = 0;  // no se ocultan las plazas vacías: el número de luces del shader es fijo
        }
    }
}

}  // namespace bazuko
