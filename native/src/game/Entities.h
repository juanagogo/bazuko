#pragma once

#include <vector>

#include "core/MathTypes.h"
#include "core/Rng.h"
#include "game/data/GameData.h"
#include "world/Bogota.h"

namespace bazuko {

// Bolsa de basura que se recoge (o se selecciona manteniendo Q); revive a los 20 s en otro sitio.
struct Pickup {
    Vec3 position;
    bool used = false;
    double cooldown = 0;
    bool sorting = false;
    double sortProgress = 0;
    double markerSpin = 0;  // giro del anillo (visual)

    bool sortComplete(double sortTime) const { return sortProgress >= sortTime; }
};

// Carro aparcado al que se le pueden robar los retrovisores; revive a los 40 s.
struct ParkedCar {
    Vec3 position;
    double rotation = 0;
    bool taxi = false;
    int paint = 0;
    bool used = false;
    double cooldown = 0;
    double markerSpin = 0;
};

// Lugares fijos con los que se interactúa.
struct Place {
    Vec3 position;
};

// Todo lo que vive en el distrito y se puede tocar.
struct Entities {
    std::vector<Pickup> pickups;
    std::vector<ParkedCar> cars;
    Place recycler, dealer, craft, cambuche, shop;
};

// Rejilla de basura + puestos de parqueo + lugares reservados (game.js `_spawnEntities`).
// Basura: round(14 · populationScale); autos: round(5 · populationScale), separados más de 8 m.
Entities spawnEntities(const Bogota& city, Rng& rng);

// Posición válida al azar (transitable, lejos de lo reservado y de otras entidades).
Vec3 findValidSpawn(const Bogota& city, const Entities& e, Rng& rng, const Vec3* exclude = nullptr, double minDist = 4);

// Avanza los temporizadores: la basura y los carros reviven; la basura se reubica al revivir.
void updateEntities(Entities& e, const Bogota& city, Rng& rng, double dt);

}  // namespace bazuko
