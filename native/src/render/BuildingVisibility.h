#pragma once

#include <cstdint>
#include <vector>

#include "core/MathTypes.h"
#include "render/VisualWorld.h"

namespace bazuko {

constexpr double kFadeSeconds = 0.22, kRestoreDelay = 0.18;

// En vista isométrica las paredes y techos que tapan al jugador se desvanecen gradualmente
// (BuildingVisibility.js). En tercera persona todo vuelve a ser opaco de inmediato.
class BuildingVisibility {
public:
    static constexpr int kParts = 5;  // 4 paredes altas + techo

    explicit BuildingVisibility(const std::vector<House>& houses);

    // `camera` y `right` (horizontal, unitario) describen la cámara; `player` son los pies del jugador.
    void update(double dt, bool isometric, const Vec3& camera, const Vec3& right, const Vec3& player);

    double opacity(size_t house, int part) const { return state_[house].parts[part].opacity; }
    bool enabled() const { return enabled_; }
    // Indicadores por id de casa (índice 0 = ninguna): 1 si se dibuja por piezas (alguna está atenuada).
    const std::vector<std::uint8_t>& separate() const { return separate_; }

private:
    struct Part {
        double opacity = 1, clearTime = kRestoreDelay;
    };
    struct HouseState {
        Part parts[kParts];
    };
    struct Ray {
        Vec3 origin, dir;
        double distance;
    };
    void fade(Part& p, bool hidden, double dt, bool reset = false);
    bool intersects(const Aabb& box) const;

    const std::vector<House>& houses_;
    std::vector<HouseState> state_;
    std::vector<std::uint8_t> separate_;
    bool enabled_ = false;
    bool closedMode_ = true;  // la vista agrupada está activa (tercera persona)
    Vec3 camera_;
    Ray rays_[5];
};

}  // namespace bazuko
