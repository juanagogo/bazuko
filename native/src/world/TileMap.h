#pragma once

#include <string>
#include <vector>

namespace bazuko {

enum class Tile : unsigned char { Wall, Road, Busway, Sidewalk, Dirt, Grass, Plaza, Floor, Building, Ruin };

// Carácter con el que world_reference.json codifica cada tipo de tile.
char tileChar(Tile t);
Tile tileFromChar(char c);  // lanza std::invalid_argument si no existe

inline bool isWalkable(Tile t) {
    return t == Tile::Road || t == Tile::Busway || t == Tile::Sidewalk || t == Tile::Dirt || t == Tile::Grass ||
           t == Tile::Plaza || t == Tile::Floor;
}
inline bool isSolid(Tile t) { return t == Tile::Building || t == Tile::Ruin || t == Tile::Wall; }
inline bool isStreet(Tile t) { return t == Tile::Road || t == Tile::Busway; }

// Cota del suelo (m) por tipo de tile; coincide con la malla del terreno.
double groundHeight(Tile t);

// Rejilla de tiles indexada [z][x].
class TileMap {
public:
    TileMap() = default;
    TileMap(int width, int height, Tile fill) : w_(width), h_(height), t_(static_cast<size_t>(width) * height, fill) {}

    int width() const { return w_; }
    int height() const { return h_; }
    bool inside(int x, int z) const { return x >= 0 && z >= 0 && x < w_ && z < h_; }
    Tile at(int x, int z) const { return t_[static_cast<size_t>(z) * w_ + x]; }
    Tile& at(int x, int z) { return t_[static_cast<size_t>(z) * w_ + x]; }
    // Tile o `fallback` si queda fuera (JS devolvía undefined).
    Tile atOr(int x, int z, Tile fallback) const { return inside(x, z) ? at(x, z) : fallback; }

    std::string row(int z) const;

private:
    int w_ = 0, h_ = 0;
    std::vector<Tile> t_;
};

}  // namespace bazuko
