#pragma once

#include <array>
#include <string>
#include <vector>

#include "core/MathTypes.h"

namespace bazuko {

constexpr double kTileSize = 2.0;
constexpr int kOriginalSize = 48;
constexpr int kSidewalkTiles = 2;
constexpr int kWorldLayoutVersion = 3;

// Banda de calzada [a, b] en tiles (inclusive), con nombre opcional.
struct Band {
    int a = 0, b = 0;
    std::string name;
};

// Eje con calzadas ensanchadas: inserta terreno sin reducir las manzanas ni la escala de los objetos.
struct StreetAxis {
    std::vector<int> widths;  // tiles resultantes por cada tile original
    std::vector<int> starts;
    int size = 0;

    static StreetAxis build(const std::vector<Band>& roads, int sidewalkWidth = kSidewalkTiles);

    double tile(double original) const;      // tile original -> tile expandido
    double original(double expanded) const;  // inversa de tile()
    double world(double original) const { return tile(original) * kTileSize; }
    Band band(const Band& originalBand) const;
};

struct CaracasBands {
    std::array<Band, 2> lanes;
    Band busway;
};

// Calles originales del centro (tiles de la rejilla de 48x48).
const std::vector<Band>& originalCarreras();
const CaracasBands& originalCaracas();
const std::vector<Band>& originalCalles();

// Ejes expandidos y bandas en tiles expandidos.
const StreetAxis& streetX();
const StreetAxis& streetZ();
const std::vector<Band>& carreras();
const std::vector<Band>& calles();
const CaracasBands& caracas();

// Migra una posición guardada de una versión anterior del trazado. version >= 2 no cambia nada.
Vec3 migrateStreetPosition(const Vec3& position, int version);

}  // namespace bazuko
