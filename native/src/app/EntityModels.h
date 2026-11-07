#pragma once

#include <vector>

#include "game/Entities.h"
#include "game/GameState.h"
#include "render/Renderer.h"
#include "world/BusService.h"
#include "world/TrafficSystem.h"

namespace bazuko {

// Modelos de las entidades de juego, armados como mallas fusionadas con color de vértice (los carros se
// reutilizan con otra pintura mediante el tinte). Se suben una sola vez a la GPU.
class EntityModels {
public:
    // Cuánto se retrasa (en -Z) la tienda respecto a su punto de interacción (y su caja de colisión).
    static constexpr double kShopBack = 1.3;
    explicit EntityModels(Renderer& renderer);

    // Añade al cuadro lo visible de `e` (bolsas, carros aparcados, lugares fijos, cambuche).
    void collect(const Entities& e, const GameState& state, const Vec3& player, double time, const struct InteractionView& view,
                 std::vector<MeshDraw>& out) const;
    void collectTraffic(const TrafficSystem& traffic, const BusService& bus, std::vector<MeshDraw>& out) const;

    static Rgb paintColor(int index);

private:
    struct Part { int mesh = -1; bool tinted = false; };
    int bag_ = -1, bagKnot_ = -1, ringGreen_ = -1, ringAmber_ = -1, ringRed_ = -1, aura_ = -1, bar_ = -1;
    int carBody_ = -1, carDetail_ = -1;
    int dealer_ = -1, shop_ = -1, shopAwning_ = -1, craft_ = -1;
    int bus_ = -1, busDetail_ = -1;
    int cambuche_[6] = {-1, -1, -1, -1, -1, -1};
};

// Lo que el modelo necesita saber de la interacción en curso.
struct InteractionView {
    bool boost = false;
    int sortingIndex = -1;
    double sortTime = 1.5;
};

}  // namespace bazuko
