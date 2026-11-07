#include <doctest/doctest.h>

#include <algorithm>
#include <cmath>
#include <set>

#include "render/BuildingVisibility.h"
#include "render/Frustum.h"
#include "render/VisualBuilder.h"
#include "render/VisualWorld.h"
#include "test_util.h"

using namespace bazuko;
using Approx = doctest::Approx;

namespace {

const Bogota& city() {
    static const Bogota b;
    return b;
}

// Mundo completo (con texturas reales, una sola vez para todos los tests).
const VisualWorld& fullWorld() {
    static const VisualWorld w = [] {
        Mulberry32Rng rng(7);
        return buildVisualWorld(city(), rng);
    }();
    return w;
}

// Solo las manzanas, sin texturas pesadas: para recorrer muchas semillas.
VisualWorld blocksOnly(const TileMap& map, unsigned seed) {
    VisualWorld w;
    Mulberry32Rng rng(seed);
    VisualBuilder b(city(), rng, w);
    b.fast = true;
    b.mapOverride = &map;
    b.buildBlocks();
    return w;
}

// Cuántas casas cubren cada tile (se mide con la huella del zócalo, como buildings.test.js).
std::vector<int> coverage(const VisualWorld& w, const TileMap& map) {
    std::vector<int> occ(static_cast<size_t>(map.width()) * map.height(), 0);
    for (const House& h : w.houses) {
        for (int z = 0; z < map.height(); ++z)
            for (int x = 0; x < map.width(); ++x) {
                const double px = x * kTileSize, pz = z * kTileSize;
                if (px > h.bounds.min.x + 0.6 && px < h.bounds.max.x - 0.6 && pz > h.bounds.min.z + 0.6 && pz < h.bounds.max.z - 0.6)
                    ++occ[static_cast<size_t>(z) * map.width() + x];
            }
    }
    return occ;
}

size_t indexCount(const std::vector<CpuBatch>& list) {
    size_t n = 0;
    for (const auto& b : list) n += b.mesh.indices().size();
    return n;
}

}  // namespace

// ---------- construcción de las manzanas (buildings.test.js) ----------

TEST_CASE("las manzanas de Bogotá no tienen casas superpuestas ni huecos (varias semillas)") {
    const TileMap& map = city().map();
    for (unsigned seed = 1; seed <= 6; ++seed) {
        const VisualWorld w = blocksOnly(map, seed);
        const auto occ = coverage(w, map);
        for (int z = 0; z < map.height(); ++z)
            for (int x = 0; x < map.width(); ++x) {
                const Tile t = map.at(x, z);
                const int expected = (t == Tile::Building || t == Tile::Ruin || t == Tile::Wall) ? 1 : 0;
                REQUIRE_MESSAGE(occ[static_cast<size_t>(z) * map.width() + x] == expected, "semilla ", seed, ", tile ", x, ",", z);
            }
    }
}

TEST_CASE("fachadas opuestas y esquinas respetan las casas existentes en bloques estrechos") {
    for (auto [width, depth] : {std::pair{1, 8}, {2, 8}, {3, 8}, {4, 8}, {5, 8}, {8, 2}, {8, 8}}) {
        TileMap map(48, 48, Tile::Sidewalk);
        for (int i = 0; i < 48; ++i) { map.at(i, 0) = map.at(i, 47) = map.at(0, i) = map.at(47, i) = Tile::Wall; }
        for (int z = 5; z < 5 + depth; ++z)
            for (int x = 5; x < 5 + width; ++x) map.at(x, z) = Tile::Ruin;
        for (unsigned seed = 1; seed <= 3; ++seed) {
            const VisualWorld w = blocksOnly(map, seed);
            const auto occ = coverage(w, map);
            for (int z = 0; z < 48; ++z)
                for (int x = 0; x < 48; ++x) {
                    const Tile t = map.at(x, z);
                    const int expected = (t == Tile::Ruin || t == Tile::Wall) ? 1 : 0;
                    REQUIRE_MESSAGE(occ[static_cast<size_t>(z) * 48 + x] == expected, width, "x", depth, " semilla ", seed, " tile ", x, ",", z);
                }
        }
    }
}

TEST_CASE("cada casa tiene zócalo, cuatro paredes altas y techo con geometría válida") {
    const VisualWorld& w = fullWorld();
    CHECK(w.houses.size() > 300);
    for (const House& h : w.houses) {
        CHECK(h.id >= 1);
        const double height = h.bounds.max.y - 0.6;
        CHECK((height == Approx(4.5) || height == Approx(6) || height == Approx(9) || height == Approx(6.5) || height == Approx(12)));
        for (const HousePart& wall : h.walls) {
            REQUIRE_FALSE(wall.draws.empty());
            CHECK(wall.bounds.max.y > wall.bounds.min.y);
            CHECK(wall.bounds.min.y >= kLowWallHeight - 0.1);  // las paredes altas empiezan sobre el zócalo
        }
        REQUIRE_FALSE(h.roof.draws.empty());
        CHECK(h.roof.roof);
        CHECK(h.roof.bounds.max.y >= height - 0.1);
    }
}

TEST_CASE("la vista agrupada conserva los triángulos de las piezas sueltas") {
    const VisualWorld& w = fullWorld();
    size_t parts = 0;
    for (const House& h : w.houses) {
        for (const HousePart& wall : h.walls) for (const auto& [m, mesh] : wall.draws) parts += mesh.indices().size();
        for (const auto& [m, mesh] : h.roof.draws) parts += mesh.indices().size();
    }
    CHECK(indexCount(w.closed) == parts);
    // los vértices agrupados llevan el id de su casa; los sueltos y el zócalo no
    std::set<unsigned> ids;
    for (const CpuBatch& b : w.closed)
        for (size_t v = 0; v < b.mesh.vertexCount(); ++v) ids.insert(static_cast<unsigned>(b.mesh.vertices()[v * 12 + 11]));
    CHECK(ids.size() == w.houses.size());
    CHECK(*ids.begin() == 1);
    CHECK(*ids.rbegin() == w.houses.size());
    for (const CpuBatch& b : w.statics)
        for (size_t v = 0; v < b.mesh.vertexCount(); ++v) REQUIRE(b.mesh.vertices()[v * 12 + 11] == 0.0f);
}

TEST_CASE("el mundo visual es consistente: índices, materiales, normales y UV") {
    const VisualWorld& w = fullWorld();
    CHECK(w.textures.size() > 10);
    for (const MaterialDef& m : w.materials) {
        CHECK(m.map < static_cast<int>(w.textures.size()));
        CHECK(m.emissive < static_cast<int>(w.textures.size()));
    }
    size_t triangles = 0;
    for (const auto* list : {&w.statics, &w.closed}) {
        for (const CpuBatch& b : *list) {
            REQUIRE(b.material >= 0);
            REQUIRE(b.material < static_cast<int>(w.materials.size()));
            REQUIRE_FALSE(b.mesh.empty());
            const size_t verts = b.mesh.vertexCount();
            for (auto i : b.mesh.indices()) REQUIRE(i < verts);
            for (size_t v = 0; v < verts; ++v) {
                const float* p = &b.mesh.vertices()[v * 12];
                const float len = std::sqrt(p[3] * p[3] + p[4] * p[4] + p[5] * p[5]);
                REQUIRE(len == Approx(1.0f).epsilon(1e-3));
                REQUIRE(std::isfinite(p[0] + p[1] + p[2] + p[9] + p[10]));
            }
            // el lote se declara dentro de su caja
            for (size_t v = 0; v < verts; ++v) {
                const float* p = &b.mesh.vertices()[v * 12];
                REQUIRE(p[0] >= b.bounds.min.x - 1e-3);
                REQUIRE(p[0] <= b.bounds.max.x + 1e-3);
                REQUIRE(p[1] >= b.bounds.min.y - 1e-3);
                REQUIRE(p[1] <= b.bounds.max.y + 1e-3);
            }
            triangles += b.mesh.triangleCount();
        }
    }
    CHECK(triangles > 50000);
}

TEST_CASE("el sentido de giro de cada triángulo coincide con su normal (culling correcto)") {
    const VisualWorld& w = fullWorld();
    size_t bad = 0, total = 0;
    for (const auto* list : {&w.statics, &w.closed}) {
        for (const CpuBatch& b : *list) {
            // los materiales de doble cara no se descartan por culling: no importa su sentido
            if (w.materials[b.material].doubleSided) continue;
            const auto& v = b.mesh.vertices();
            const auto& idx = b.mesh.indices();
            for (size_t t = 0; t + 2 < idx.size(); t += 3) {
                auto P = [&](size_t i) { return glm::vec3(v[idx[t + i] * 12], v[idx[t + i] * 12 + 1], v[idx[t + i] * 12 + 2]); };
                auto N = [&](size_t i) { return glm::vec3(v[idx[t + i] * 12 + 3], v[idx[t + i] * 12 + 4], v[idx[t + i] * 12 + 5]); };
                const glm::vec3 geo = glm::cross(P(1) - P(0), P(2) - P(0));
                if (glm::length(geo) < 1e-9f) continue;  // triángulo degenerado
                ++total;
                if (glm::dot(geo, N(0) + N(1) + N(2)) < 0) ++bad;
            }
        }
    }
    CHECK(total > 40000);
    CHECK(bad == 0);
}

TEST_CASE("el distrito tiene luces: faroles solo de noche, fuegos y fritangas") {
    const VisualWorld& w = fullWorld();
    int lamps = 0, fires = 0;
    for (const LightSource& l : w.lights) {
        if (l.nightOnly) ++lamps;
        else if (l.flicker) ++fires;
        CHECK(l.distance > 0);
    }
    CHECK(lamps > 40);
    CHECK(fires == 4 + 2);  // 4 canecas del Cartucho + 2 fritangas
}

TEST_CASE("los materiales de ventanas se encienden solo de noche y los carteles no reciben luz") {
    const VisualWorld& w = fullWorld();
    int night = 0, unlit = 0;
    for (const MaterialDef& m : w.materials) {
        night += m.nightEmissive;
        unlit += m.unlit && m.map >= 0;
        if (m.nightEmissive) CHECK(m.emissive >= 0);
    }
    CHECK(night > 5);
    CHECK(unlit > 5);
}

// ---------- visibilidad de edificios (visibility.test.js) ----------

namespace {

struct Fixture {
    VisualWorld world;
    std::unique_ptr<BuildingVisibility> vis;
    Vec3 camera{0, 6, 9}, player{0, 0, -5};
    Fixture() {
        Mulberry32Rng rng(1);
        VisualBuilder b(city(), rng, world);
        b.fast = true;
        const int mat = b.color(0xff0000);
        const int floor = b.color(0x675e50);
        for (double x : {0.0, 15.0}) {
            VisualBuilder::ShellSpec s;
            s.cx = x; s.cz = 0; s.sx = 4; s.sz = 4; s.height = 8;
            s.materials.fill(mat);
            s.unitsMeters.fill({4, 4});
            s.interiorMaterial = floor;
            b.addShell(s);
        }
        b.commitHouses();
        vis = std::make_unique<BuildingVisibility>(world.houses);
    }
    void advance(int frames = 60, bool iso = true) {
        for (int i = 0; i < frames; ++i) vis->update(1.0 / 60, iso, camera, {1, 0, 0}, player);
    }
};
// paredes: 0 = +x, 1 = -x, 2 = +z, 3 = -z (orden de VisualWorld::House::walls)
constexpr int kEast = 0, kWest = 1, kSouth = 2, kNorth = 3;

}  // namespace

TEST_CASE("oculta las paredes y el techo que tapan al jugador, conservando muros bajos y casas vecinas") {
    Fixture f;
    f.advance();
    CHECK(f.vis->opacity(0, 4) == 0);        // techo
    CHECK(f.vis->opacity(0, kSouth) == 0);   // pared hacia la cámara
    CHECK(f.vis->opacity(0, kNorth) == 0);   // pared detrás de la casa, entre cámara y jugador
    CHECK(f.vis->opacity(0, kEast) == 1);
    CHECK(f.vis->opacity(0, kWest) == 1);
    for (int p = 0; p < 5; ++p) CHECK(f.vis->opacity(1, p) == 1);  // la casa vecina no se toca
    CHECK(f.vis->separate()[1] == 1);
    CHECK(f.vis->separate()[2] == 0);
}

TEST_CASE("las transiciones son graduales y una esquina no hace reaparecer la pared por un cuadro") {
    Fixture f;
    f.advance(1);
    CHECK(f.vis->opacity(0, 4) > 0);
    CHECK(f.vis->opacity(0, 4) < 1);
    f.advance();
    f.camera.x = 40;  // el rayo deja de cruzar la casa
    f.advance(1);
    CHECK(f.vis->opacity(0, 4) == 0);  // espera RESTORE_DELAY antes de volver
    f.advance(13);
    CHECK(f.vis->opacity(0, 4) > 0);
    CHECK(f.vis->opacity(0, 4) < 1);
    f.advance();
    for (int p = 0; p < 5; ++p) CHECK(f.vis->opacity(0, p) == 1);
    CHECK(f.vis->separate()[1] == 0);  // todo opaco: vuelve al lote agrupado
}

TEST_CASE("volver a tercera persona restaura de inmediato todas las piezas") {
    Fixture f;
    f.advance();
    CHECK(f.vis->separate()[1] == 1);
    f.advance(1, false);
    CHECK_FALSE(f.vis->enabled());
    for (int h = 0; h < 2; ++h)
        for (int p = 0; p < 5; ++p) CHECK(f.vis->opacity(h, p) == 1);
    for (auto flag : f.vis->separate()) CHECK(flag == 0);
    f.advance(1, true);  // y al volver a isométrica el recorte se reanuda
    CHECK(f.vis->opacity(0, 4) < 1);
}

TEST_CASE("el zócalo y las paredes conservan altura y huella") {
    Fixture f;
    const House& h = f.world.houses[0];
    CHECK(h.bounds.min.x == Approx(-2.6));
    CHECK(h.bounds.max.x == Approx(2.6));
    CHECK(h.bounds.max.y == Approx(8.6));
    CHECK(h.roof.bounds.max.y == Approx(8.08));
    // paredes vecinas separadas más de 0,02 m (sin superficies coplanares)
    CHECK(h.walls[kSouth].bounds.min.z != Approx(h.walls[kNorth].bounds.max.z));
    // el piso interior está a 0,65 m
    bool floorAtLowWall = false;
    for (const CpuBatch& b : f.world.statics) {
        glm::vec3 lo, hi;
        b.mesh.computeBounds(lo, hi);
        floorAtLowWall |= std::abs(hi.y - static_cast<float>(kLowWallHeight)) < 1e-4;
    }
    CHECK(floorAtLowWall);
}

// ---------- frustum ----------

TEST_CASE("el frustum descarta lo que queda detrás o a un lado de la cámara") {
    const glm::mat4 view = glm::lookAt(glm::vec3(0, 2, 0), glm::vec3(0, 2, -10), glm::vec3(0, 1, 0));
    const glm::mat4 proj = glm::perspective(glm::radians(55.0f), 16.0f / 9, 0.1f, 100.0f);
    const Frustum f = Frustum::fromViewProjection(proj * view);
    CHECK(f.intersects({{-1, 0, -21}, {1, 3, -19}}));      // delante
    CHECK_FALSE(f.intersects({{-1, 0, 19}, {1, 3, 21}}));  // detrás
    CHECK_FALSE(f.intersects({{80, 0, -21}, {82, 3, -19}}));  // lejos a la derecha
    CHECK_FALSE(f.intersects({{-1, 0, -200}, {1, 3, -190}}));  // más allá del plano lejano
    CHECK(f.intersects({{-100, -1, -50}, {100, 0, -5}}));  // un suelo enorme cruza el volumen
}
