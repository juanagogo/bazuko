#include "world/CityLayout.h"

namespace bazuko {

namespace {
constexpr int kCartuchoX0 = 8, kCartuchoX1 = 21, kCartuchoZ0 = 14, kCartuchoZ1 = 29;
}

int originalCityWidth() { return streetX().size; }
int originalCityHeight() { return streetZ().size; }
double cityAreaMultiplier() {
    return static_cast<double>(kCityWidth) * kCityHeight / (originalCityWidth() * originalCityHeight());
}

const std::vector<Band>& cityCarreras() {
    static const std::vector<Band> v = [] {
        auto out = carreras();
        out.push_back({84, 89, "Carrera 8"});
        out.push_back({106, 111, "Carrera 6"});
        return out;
    }();
    return v;
}
const std::vector<Band>& cityCalles() {
    static const std::vector<Band> v = [] {
        auto out = calles();
        out.push_back({72, 77, "Calle 8"});
        out.push_back({94, 99, "Calle 7"});
        return out;
    }();
    return v;
}
const std::vector<Park>& extensionParks() {
    static const std::vector<Park> v = {{92, 103, 21, 34, "Parque de la Estación"}, {69, 81, 80, 91, "Parque del Sur"}};
    return v;
}

TileMap buildOriginalLayout() {
    const int S = kOriginalSize;
    TileMap m(S, S, Tile::Building);
    auto set = [&](int x, int z, Tile v) {
        if (x >= 0 && z >= 0 && x < S && z < S) m.at(x, z) = v;
    };
    for (int i = 0; i < S; ++i) {
        set(i, 0, Tile::Wall); set(i, S - 1, Tile::Wall); set(0, i, Tile::Wall); set(S - 1, i, Tile::Wall);
    }
    const auto& cr = originalCarreras();
    const auto& cc = originalCaracas();
    const auto& ca = originalCalles();
    for (int i = 1; i < S - 1; ++i) {
        for (const auto& b : cr) for (int x = b.a; x <= b.b; ++x) set(x, i, Tile::Road);
        for (const auto& b : cc.lanes) for (int x = b.a; x <= b.b; ++x) set(x, i, Tile::Road);
        for (int x = cc.busway.a; x <= cc.busway.b; ++x) set(x, i, Tile::Busway);
        for (const auto& b : ca) for (int z = b.a; z <= b.b; ++z) set(i, z, Tile::Road);
    }
    // los cruces de la troncal con las calles son calzada normal
    for (const auto& b : ca)
        for (int z = b.a; z <= b.b; ++z)
            for (int x = cc.busway.a; x <= cc.busway.b; ++x) set(x, z, Tile::Road);

    // andén alrededor de cada manzana
    for (int z = 1; z < S - 1; ++z) {
        for (int x = 1; x < S - 1; ++x) {
            if (m.at(x, z) != Tile::Building) continue;
            bool near = false;
            for (int dz = -1; dz <= 1; ++dz)
                for (int dx = -1; dx <= 1; ++dx)
                    if (isStreet(m.at(x + dx, z + dz))) near = true;
            if (near) m.at(x, z) = Tile::Sidewalk;
        }
    }
    // El Cartucho: casas en ruina, callejón (z 21-22) y la olla (x 12-17, z 18-25)
    for (int z = kCartuchoZ0 + 1; z < kCartuchoZ1; ++z) {
        for (int x = kCartuchoX0 + 1; x < kCartuchoX1; ++x) {
            if (m.at(x, z) == Tile::Building) m.at(x, z) = Tile::Ruin;
            if (z == 21 || z == 22) m.at(x, z) = Tile::Dirt;
            if (x >= 12 && x <= 17 && z >= 18 && z <= 25) m.at(x, z) = Tile::Dirt;
        }
    }
    // bodega de reciclaje: portón abierto frente a la Calle 9
    for (int z = 33; z <= 35; ++z) for (int x = 13; x <= 16; ++x) m.at(x, z) = Tile::Floor;
    // parque
    for (int z = 33; z <= 45; ++z)
        for (int x = 29; x <= 38; ++x) m.at(x, z) = (x == 33 || x == 34 || z == 39) ? Tile::Plaza : Tile::Grass;
    // lote baldío del cambuche
    for (int z = 33; z <= 45; ++z) for (int x = 43; x <= 46; ++x) m.at(x, z) = Tile::Dirt;
    return m;
}

TileMap expandStreets(const TileMap& original) {
    const auto& wx = streetX().widths;
    const auto& wz = streetZ().widths;
    TileMap out(streetX().size, streetZ().size, Tile::Building);
    int oz = 0;
    for (int z = 0; z < original.height(); ++z) {
        for (int rz = 0; rz < wz[z]; ++rz, ++oz) {
            int ox = 0;
            for (int x = 0; x < original.width(); ++x)
                for (int rx = 0; rx < wx[x]; ++rx, ++ox) out.at(ox, oz) = original.at(x, z);
        }
    }
    return out;
}

TileMap expandCity(const TileMap& center) {
    const int W = kCityWidth, H = kCityHeight;
    const int OW = originalCityWidth(), OH = originalCityHeight();
    TileMap map(W, H, Tile::Building);
    auto original = [&](int x, int z) { return x < OW - 1 && z < OH - 1; };
    for (int z = 0; z < OH - 1; ++z)
        for (int x = 0; x < OW - 1; ++x) map.at(x, z) = center.at(x, z);

    const auto& ccarreras = cityCarreras();
    const auto& ccalles = cityCalles();
    const auto& lanes = caracas().lanes;
    const auto& busway = caracas().busway;
    for (int z = 1; z < H - 1; ++z) {
        for (const auto& b : ccarreras)
            for (int x = b.a; x <= b.b; ++x) if (!original(x, z)) map.at(x, z) = Tile::Road;
        for (const auto& b : lanes)
            for (int x = b.a; x <= b.b; ++x) if (!original(x, z)) map.at(x, z) = Tile::Road;
        for (int x = busway.a; x <= busway.b; ++x) if (!original(x, z)) map.at(x, z) = Tile::Busway;
    }
    for (const auto& b : ccalles)
        for (int z = b.a; z <= b.b; ++z)
            for (int x = 1; x < W - 1; ++x) if (!original(x, z)) map.at(x, z) = Tile::Road;

    for (int z = 1; z < H - 1; ++z) {
        for (int x = 1; x < W - 1; ++x) {
            if (original(x, z) || map.at(x, z) != Tile::Building) continue;
            bool near = false;
            for (int dz = -kSidewalkTiles; dz <= kSidewalkTiles && !near; ++dz) {
                for (int dx = -kSidewalkTiles; dx <= kSidewalkTiles; ++dx) {
                    if (map.inside(x + dx, z + dz) && isStreet(map.at(x + dx, z + dz))) { near = true; break; }
                }
            }
            if (near) map.at(x, z) = Tile::Sidewalk;
        }
    }
    for (const auto& park : extensionParks()) {
        const int pathX = (park.x0 + park.x1) / 2, pathZ = (park.z0 + park.z1) / 2;
        for (int z = park.z0; z <= park.z1; ++z)
            for (int x = park.x0; x <= park.x1; ++x) {
                if (map.at(x, z) != Tile::Building) continue;
                map.at(x, z) = (x == pathX || z == pathZ) ? Tile::Plaza : Tile::Grass;
            }
    }
    for (int x = 0; x < W; ++x) map.at(x, 0) = map.at(x, H - 1) = Tile::Wall;
    for (int z = 0; z < H; ++z) map.at(0, z) = map.at(W - 1, z) = Tile::Wall;
    return map;
}

TileMap buildCityMap() { return expandCity(expandStreets(buildOriginalLayout())); }

}  // namespace bazuko
