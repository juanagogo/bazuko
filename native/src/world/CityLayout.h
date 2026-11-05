#pragma once

#include <vector>

#include "world/StreetLayout.h"
#include "world/TileMap.h"

namespace bazuko {

constexpr int kCityWidth = 120;
constexpr int kCityHeight = 111;

struct Park {
    int x0, x1, z0, z1;
    const char* name;
};

const std::vector<Band>& cityCarreras();  // las del centro + Carrera 8 y 6
const std::vector<Band>& cityCalles();    // las del centro + Calle 8 y 7
const std::vector<Park>& extensionParks();

int originalCityWidth();   // 74
int originalCityHeight();  // 60
// Área de la ciudad / área del centro (3). Escala la población.
double cityAreaMultiplier();

// Rejilla de 48x48 del centro con calles de un tile (trazado original de Bogotá).
TileMap buildOriginalLayout();
// Duplica filas/columnas según los anchos de calzada y andén.
TileMap expandStreets(const TileMap& original);
// Añade barrios al oriente y al sur sin desplazar el centro.
TileMap expandCity(const TileMap& center);
// Ciudad completa de 120x111 tiles.
TileMap buildCityMap();

}  // namespace bazuko
