#include "world/TileMap.h"

#include <stdexcept>

namespace bazuko {

char tileChar(Tile t) {
    switch (t) {
        case Tile::Wall: return 'W';
        case Tile::Road: return 'R';
        case Tile::Busway: return 'B';
        case Tile::Sidewalk: return 'S';
        case Tile::Dirt: return 'D';
        case Tile::Grass: return 'G';
        case Tile::Plaza: return 'P';
        case Tile::Floor: return 'F';
        case Tile::Building: return 'b';
        case Tile::Ruin: return 'r';
    }
    return '?';
}

Tile tileFromChar(char c) {
    switch (c) {
        case 'W': return Tile::Wall;
        case 'R': return Tile::Road;
        case 'B': return Tile::Busway;
        case 'S': return Tile::Sidewalk;
        case 'D': return Tile::Dirt;
        case 'G': return Tile::Grass;
        case 'P': return Tile::Plaza;
        case 'F': return Tile::Floor;
        case 'b': return Tile::Building;
        case 'r': return Tile::Ruin;
    }
    throw std::invalid_argument(std::string("tile desconocido: ") + c);
}

double groundHeight(Tile t) {
    switch (t) {
        case Tile::Road: return 0;
        case Tile::Busway: return 0.02;
        case Tile::Sidewalk:
        case Tile::Floor:
        case Tile::Plaza: return 0.12;
        case Tile::Dirt: return 0.04;
        case Tile::Grass: return 0.06;
        default: return 0;
    }
}

std::string TileMap::row(int z) const {
    std::string s;
    for (int x = 0; x < w_; ++x) s += tileChar(at(x, z));
    return s;
}

}  // namespace bazuko
