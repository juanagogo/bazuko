#include "render/VisualWorld.h"

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <set>

#include "render/ProceduralTextures.h"
#include "render/VisualBuilder.h"
#include "world/CityLayout.h"

namespace bazuko {

namespace {
constexpr double kChunk = 32;
int chunkOf(double m) { return static_cast<int>(std::floor(m / kChunk)); }

// Metros que cubre una textura (texturas procedurales del juego web).
const glm::vec2 kBrickUnits{static_cast<float>(tex::kBrickTileW), static_cast<float>(tex::kBrickTileH)};
const glm::vec2 kSlabUnits{4, 4};
const glm::vec2 kTileUnits{2, 2};

const std::vector<std::pair<std::string, std::string>> kShopNames = {
    {"DROGUERÍA", "SALUD Y VIDA"}, {"PANADERÍA", "EL TRIGAL"},     {"CIGARRERÍA", "LA 10"},
    {"ASADERO", "POLLO DORADO"},   {"MISCELÁNEA", "TODO A MIL"},   {"COMPRAVENTA", "EL CENTAVO"},
    {"RESIDENCIAS", "EL DORADO"},  {"BILLARES", "LA BOLA 8"},      {"TIENDA", "DONDE PACHO"},
    {"FERRETERÍA", "EL TORNILLO"}, {"SASTRERÍA", "ARREGLOS"},      {"CAFETERÍA", "TINTO Y PAN"},
    {"CHATARRERÍA", "COMPRAMOS"},  {"MINUTOS", "A TODO OPERADOR"}, {"LAVANDERÍA", "AL INSTANTE"},
    {"PAPELERÍA", "FOTOCOPIAS"}};
const std::vector<std::string> kSignBackgrounds = {"#0b4fa3", "#c0392b", "#1f6b3a", "#f2c600", "#ffffff", "#6a1b9a"};

}  // namespace

Rgb hexRgb(std::uint32_t hex) { return rgbFromHex(hex); }

// ------------------------------------------------------------------ texturas y materiales

int VisualBuilder::addTexture(Image img) {
    w.textures.push_back(std::move(img));
    return static_cast<int>(w.textures.size()) - 1;
}

int VisualBuilder::addMaterial(const MaterialDef& m) {
    w.materials.push_back(m);
    return static_cast<int>(w.materials.size()) - 1;
}

int VisualBuilder::color(std::uint32_t hex, bool unlit, bool doubleSided, double scale, bool noFog) {
    const int flags = (unlit ? 1 : 0) | (doubleSided ? 2 : 0) | (noFog ? 4 : 0);
    const auto key = std::make_tuple(hex, flags, scale);
    auto it = colorCache_.find(key);
    if (it != colorCache_.end()) return it->second;
    MaterialDef m;
    const Rgb c = rgbFromHex(hex);
    m.tint = {c.r * scale, c.g * scale, c.b * scale};
    m.unlit = unlit;
    m.castShadow = !unlit;  // llamas, carteles y cerros no proyectan sombra
    m.doubleSided = doubleSided;
    m.noFog = noFog;
    return colorCache_[key] = addMaterial(m);
}

int VisualBuilder::textured(int tex, std::uint32_t tintHex, bool unlit, bool doubleSided) {
    const int flags = (unlit ? 1 : 0) | (doubleSided ? 2 : 0);
    const auto key = std::make_tuple(tex, tintHex, flags);
    auto it = texturedCache_.find(key);
    if (it != texturedCache_.end()) return it->second;
    MaterialDef m;
    m.map = tex;
    m.tint = rgbFromHex(tintHex);
    m.unlit = unlit;
    m.castShadow = !unlit;
    m.doubleSided = doubleSided;
    return texturedCache_[key] = addMaterial(m);
}

int VisualBuilder::facadeTexture(double widthM, int floors, int style, int variant) {
    const auto key = std::make_tuple(widthM, floors, style, variant);
    auto it = facadeCache_.find(key);
    if (it == facadeCache_.end()) {
        tex::FacadeParams p;
        p.seed = static_cast<unsigned>(std::floor(rng.next() * 1e6));
        p.width = widthM;
        p.floors = floors;
        p.style = static_cast<tex::FacadeStyle>(style);
        // el ladrillo necesita más resolución para que cada ladrillo (36 x 12 cm) se distinga
        p.pxPerM = p.style == tex::FacadeStyle::Pintada ? 28 : 40;
        tex::Facade f;
        if (fast) { f.map = make([] { return Image{}; }); f.emissive = f.map; }
        else f = tex::facade(p);
        const int map = addTexture(std::move(f.map));
        const int emissive = addTexture(std::move(f.emissive));
        it = facadeCache_.emplace(key, std::make_pair(map, emissive)).first;
    }
    MaterialDef m;
    m.map = it->second.first;
    m.emissive = it->second.second;
    m.emissiveIntensity = 1.2f;
    m.nightEmissive = true;
    // una fachada por casa comparte la textura; el material se reutiliza por textura
    const auto mk = std::make_tuple(m.map, 0xfacadeu, 0);
    auto mt = texturedCache_.find(mk);
    if (mt != texturedCache_.end()) return mt->second;
    return texturedCache_[mk] = addMaterial(m);
}

int VisualBuilder::signTexture(const std::string& title, const std::string& sub, const std::string& bg, const std::string& fg) {
    const std::string key = title + "|" + sub + "|" + bg + "|" + fg;
    auto it = signCache_.find(key);
    if (it != signCache_.end()) return it->second;
    tex::SignParams p;
    p.title = title; p.sub = sub; p.bg = bg; p.fg = fg;
    p.w = 768;
    p.h = 192;
    if (sub.empty()) { p.w = 512; p.h = 128; }
    const int t = addTexture(make([&] { return tex::sign(p); }));
    MaterialDef m;
    m.map = t;
    m.unlit = true;
    m.doubleSided = true;
    m.castShadow = false;
    return signCache_[key] = addMaterial(m);
}

void VisualBuilder::addLight(const Vec3& p, std::uint32_t hex, double intensity, double distance, double decay, bool nightOnly,
                             bool flicker, double amp1, double f1, double amp2, double f2) {
    LightSource l;
    l.position = p;
    l.color = rgbFromHex(hex);
    l.intensity = intensity;
    l.distance = distance;
    l.decay = decay;
    l.nightOnly = nightOnly;
    l.flicker = flicker;
    l.amp1 = amp1; l.f1 = f1; l.amp2 = amp2; l.f2 = f2;
    w.lights.push_back(l);
}

double LightSource::intensityAt(double t, bool night) const {
    if (nightOnly && !night) return 0;
    if (!flicker) return intensity;
    return intensity + amp1 * std::sin(t * f1) + amp2 * std::sin(t * f2);
}

// ------------------------------------------------------------------------- lotes por sector

MeshBuilder& VisualBuilder::batch(std::map<Key, size_t>& index, std::vector<CpuBatch>& list, double wx, double wz, int material) {
    const Key key{chunkOf(wx), chunkOf(wz), material};
    auto it = index.find(key);
    if (it == index.end()) {
        CpuBatch b;
        b.cx = std::get<0>(key);
        b.cz = std::get<1>(key);
        b.material = material;
        list.push_back(std::move(b));
        it = index.emplace(key, list.size() - 1).first;
    }
    return list[it->second].mesh;
}

void VisualBuilder::draw(int material, const glm::vec3& at, const glm::mat4& transform, const std::function<void(MeshBuilder&)>& fn) {
    MeshBuilder& mb = staticMesh(at.x, at.z, material);
    mb.setTransform(transform);
    fn(mb);
    mb.setTransform(glm::mat4(1.0f));
}

void VisualBuilder::finalize() {
    for (auto* list : {&w.statics, &w.closed}) {
        for (CpuBatch& b : *list) {
            glm::vec3 lo, hi;
            if (b.mesh.computeBounds(lo, hi)) b.bounds = {{lo.x, lo.y, lo.z}, {hi.x, hi.y, hi.z}};
        }
    }
}

// --------------------------------------------------------------------------------- suelo

void VisualBuilder::buildGround() {
    asphaltTex = addTexture(make([] { return tex::asphalt(7, 1024); }));
    sidewalkTex = addTexture(make([] { return tex::sidewalk(11); }));
    dirtTex = addTexture(make([] { return tex::dirt(31); }));
    concreteTex = addTexture(make([] { return tex::concrete(41); }));

    struct Spec { int mat; double scale; };
    std::map<Tile, Spec> spec;
    spec[Tile::Road] = {textured(asphaltTex, 0xb4b4b4), 14};
    spec[Tile::Busway] = {textured(asphaltTex, 0xa8726a), 14};
    spec[Tile::Sidewalk] = {textured(sidewalkTex, 0xb9b4aa), 6};
    spec[Tile::Floor] = {textured(concreteTex, 0x8a8a86), 6};
    spec[Tile::Dirt] = {textured(dirtTex, 0x8a7a64), 8};
    // FIX: en la versión web el césped (textura de tierra casi negra x verde oscuro) quedaba prácticamente negro.
    // El tinte se amplifica para que el verde se vea manteniendo el relieve de la textura.
    spec[Tile::Grass] = {[&] {
        MaterialDef m;
        m.map = dirtTex;
        const Rgb g = rgbFromHex(0x3e5a2c);
        m.tint = {g.r * 12, g.g * 12, g.b * 12};
        return addMaterial(m);
    }(), 8};
    spec[Tile::Plaza] = {textured(sidewalkTex, 0xc9b9a0), 6};
    const int curb = color(0xd8d4c8);
    w.materials[curb].castShadow = false;
    for (auto& kv : spec) w.materials[kv.second.mat].castShadow = false;  // el suelo recibe sombra pero no la proyecta

    const TileMap& map = this->map();
    const float H = static_cast<float>(kTile) / 2;
    for (int z = 0; z < map.height(); ++z) {
        for (int x = 0; x < map.width(); ++x) {
            const Tile t = map.at(x, z);
            auto it = spec.find(t);
            if (it == spec.end()) continue;
            const float cx = static_cast<float>(W(x)), cz = static_cast<float>(W(z));
            const float y = static_cast<float>(groundHeight(t));
            const double sc = it->second.scale;
            MeshBuilder& mb = staticMesh(cx, cz, it->second.mat);
            auto uv = [&](float px, float pz) { return glm::vec2(static_cast<float>(px / sc), static_cast<float>(pz / sc)); };
            mb.quad({cx - H, y, cz - H}, {cx - H, y, cz + H}, {cx + H, y, cz + H}, {cx + H, y, cz - H}, {0, 1, 0}, {1, 1, 1},
                    uv(cx - H, cz - H), uv(cx - H, cz + H), uv(cx + H, cz + H), uv(cx + H, cz - H));
            // bordillo: cara vertical hacia la calle
            if (groundHeight(t) >= kSidewalkY) {
                for (auto [dx, dz] : {std::pair{1, 0}, {-1, 0}, {0, 1}, {0, -1}}) {
                    if (!map.inside(x + dx, z + dz) || !isStreet(map.at(x + dx, z + dz))) continue;
                    const float ex = cx + dx * H, ez = cz + dz * H;
                    MeshBuilder& cb = staticMesh(cx, cz, curb);
                    const glm::vec3 n(static_cast<float>(dx), 0, static_cast<float>(dz));
                    if (dx != 0) cb.quad({ex, 0, cz - H}, {ex, 0, cz + H}, {ex, y, cz + H}, {ex, y, cz - H}, n, {1, 1, 1});
                    else cb.quad({cx - H, 0, ez}, {cx + H, 0, ez}, {cx + H, y, ez}, {cx - H, y, ez}, n, {1, 1, 1});
                }
            }
        }
    }
}

// --------------------------------------------------------------------------------- marcas

void VisualBuilder::buildMarkings() {
    const int white = [&] { MaterialDef m; m.tint = rgbFromHex(0xe2e2dc); m.polygonOffset = true; return addMaterial(m); }();
    const int yellow = [&] { MaterialDef m; m.tint = rgbFromHex(0xe0a800); m.polygonOffset = true; return addMaterial(m); }();
    w.materials[white].castShadow = w.materials[yellow].castShadow = false;
    const int sep = color(0xcfcac0);
    const auto& calles = cityCalles();
    const auto& carreras = cityCarreras();
    const auto& lanes = caracas().lanes;
    const auto& busway = caracas().busway;
    const double T = kTile;

    auto plane = [&](int mat, double wdt, double dpt, double x, double z) {
        staticMesh(x, z, mat).quad(V3(x - wdt / 2, 0.015, z - dpt / 2), V3(x - wdt / 2, 0.015, z + dpt / 2),
                                   V3(x + wdt / 2, 0.015, z + dpt / 2), V3(x + wdt / 2, 0.015, z - dpt / 2), {0, 1, 0}, {1, 1, 1});
    };
    std::vector<Band> carrX = carreras;
    carrX.push_back({lanes[0].a, lanes[1].b, ""});

    // línea amarilla al centro de las calles
    for (const Band& b : calles) {
        const double zc = (W(b.a) + W(b.b)) / 2;
        for (double x = 2; x < W(city.width()) - 2; x += 3) plane(yellow, 1.6, 0.12, x, zc);
    }
    for (const Band& b : carreras) {
        const double xc = (W(b.a) + W(b.b)) / 2;
        for (double z = 2; z < W(city.height()) - 2; z += 3) plane(yellow, 0.12, 1.6, xc, z);
    }
    // cebras a ambos lados de cada cruce
    for (const Band& cz : calles) {
        for (const Band& cx : carrX) {
            const double x0 = W(cx.a) - T / 2, x1 = W(cx.b) + T / 2;
            for (double zEdge : {W(cz.a) - T / 2 - kSidewalkTiles * T / 2, W(cz.b) + T / 2 + kSidewalkTiles * T / 2})
                for (double x = x0 + 0.4; x < x1; x += 0.9) plane(white, 0.5, kSidewalkTiles * T - 0.4, x, zEdge);
            for (double xEdge : {W(cx.a) - T / 2 - kSidewalkTiles * T / 2, W(cx.b) + T / 2 + kSidewalkTiles * T / 2})
                for (double z = W(cz.a) - T / 2 + 0.4; z < W(cz.b) + T / 2; z += 0.9) plane(white, kSidewalkTiles * T - 0.4, 0.5, xEdge, z);
        }
    }
    // separadores de concreto de la troncal
    for (double x : {W(busway.a) - T / 2, W(busway.b) + T / 2}) {
        for (int z = 1; z < city.height() - 1; ++z) {
            bool inStreet = false;
            for (const Band& b : calles) inStreet |= z >= b.a - 0.5 && z <= b.b + 0.5;
            if (inStreet) continue;
            staticMesh(x, W(z), sep).box(V3(x - 0.15, 0, W(z) - T / 2), V3(x + 0.15, 0.25, W(z) + T / 2), {1, 1, 1});
        }
    }
}

// --------------------------------------------------------------------------------- casas

namespace {

struct FaceFrame {
    glm::vec3 n, origin, right;
    double width;
};

// Marco de una cara vertical de la caja, vista desde fuera: `origin` es la esquina izquierda.
FaceFrame faceFrame(int face, double cx, double cz, double sx, double sz, double inward) {
    const double hx = sx / 2, hz = sz / 2;
    switch (face) {
        case 0: return {{1, 0, 0}, V3(cx + hx - inward, 0, cz + hz), {0, 0, -1}, sz};
        case 1: return {{-1, 0, 0}, V3(cx - hx + inward, 0, cz - hz), {0, 0, 1}, sz};
        case 4: return {{0, 0, 1}, V3(cx - hx, 0, cz + hz - inward), {1, 0, 0}, sx};
        default: return {{0, 0, -1}, V3(cx + hx, 0, cz - hz + inward), {-1, 0, 0}, sx};
    }
}

constexpr std::array<int, 4> kWallFaces = {0, 1, 4, 5};

// Pared entre y0 e y1. Con `units` (> 0) las UV son en metros del mundo; si no, la textura cubre toda la cara.
void wallQuad(MeshBuilder& mb, const FaceFrame& f, double y0, double y1, double height, glm::vec2 units, bool inside) {
    const glm::vec3 a = f.origin + glm::vec3(0, static_cast<float>(y0), 0);
    const glm::vec3 b = a + f.right * static_cast<float>(f.width);
    const glm::vec3 c = b + glm::vec3(0, static_cast<float>(y1 - y0), 0);
    const glm::vec3 d = a + glm::vec3(0, static_cast<float>(y1 - y0), 0);
    float u1, v0, v1;
    if (units.x > 0) { u1 = static_cast<float>(f.width / units.x); v0 = static_cast<float>(y0 / units.y); v1 = static_cast<float>(y1 / units.y); }
    else { u1 = 1; v0 = static_cast<float>(y0 / height); v1 = static_cast<float>(y1 / height); }
    // El interior se ve desde dentro: mismas esquinas, normal opuesta (el UV sigue a las esquinas).
    mb.quad(a, b, c, d, inside ? -f.n : f.n, {1, 1, 1}, {0, v0}, {u1, v0}, {u1, v1}, {0, v1});
}

void topQuad(MeshBuilder& mb, double cx, double cz, double sx, double sz, double y, glm::vec2 units) {
    const float x0 = static_cast<float>(cx - sx / 2), x1 = static_cast<float>(cx + sx / 2);
    const float z0 = static_cast<float>(cz - sz / 2), z1 = static_cast<float>(cz + sz / 2);
    auto uv = [&](float x, float z) { return glm::vec2(x / units.x, z / units.y); };
    mb.quad({x0, static_cast<float>(y), z0}, {x0, static_cast<float>(y), z1}, {x1, static_cast<float>(y), z1}, {x1, static_cast<float>(y), z0},
            {0, 1, 0}, {1, 1, 1}, uv(x0, z0), uv(x0, z1), uv(x1, z1), uv(x1, z0));
}

struct HouseExtra {
    VisualBuilder::ShellSpec spec;
};
std::vector<VisualBuilder::ShellSpec> g_specs;  // por casa, para calcular límites (se limpia al construir)

}  // namespace

size_t VisualBuilder::addShell(const ShellSpec& s) {
    const size_t index = w.houses.size();
    House house;
    house.id = static_cast<unsigned>(index + 1);
    w.houses.push_back(std::move(house));
    parts_.emplace_back();
    g_specs.push_back(s);

    const double h = s.height;
    // Zócalo cerrado (siempre visible): las cuatro paredes bajas y el piso interior.
    for (int face : kWallFaces) {
        const FaceFrame f = faceFrame(face, s.cx, s.cz, s.sx, s.sz, 0);
        wallQuad(staticMesh(s.cx, s.cz, s.materials[face]), f, 0, kLowWallHeight, h, s.unitsMeters[face], false);
    }
    topQuad(staticMesh(s.cx, s.cz, s.interiorMaterial >= 0 ? s.interiorMaterial : s.materials[2]), s.cx, s.cz, s.sx, s.sz,
            kLowWallHeight, s.unitsMeters[2].x > 0 ? s.unitsMeters[2] : kSlabUnits);

    // Paredes altas: cada una se desvanece por separado. Se separan 1,5 cm hacia adentro de las vecinas.
    for (size_t i = 0; i < kWallFaces.size(); ++i) {
        const int face = kWallFaces[i];
        const FaceFrame f = faceFrame(face, s.cx, s.cz, s.sx, s.sz, 0.015);
        wallQuad(parts_[index][i][s.materials[face]], f, kLowWallHeight, h, h, s.unitsMeters[face], false);
        if (face == s.facadeFace && s.wallInteriorMaterial >= 0) {
            // Desde dentro se ve ladrillo, no el aviso de la tienda escrito al revés.
            wallQuad(parts_[index][i][s.wallInteriorMaterial], f, kLowWallHeight, h, h, s.wallInteriorUnits, true);
        }
    }
    topQuad(parts_[index][4][s.materials[2]], s.cx, s.cz, s.sx, s.sz, h, s.unitsMeters[2].x > 0 ? s.unitsMeters[2] : kSlabUnits);
    return index;
}

MeshBuilder& VisualBuilder::wallDecor(size_t house, int face, int material) {
    const size_t part = static_cast<size_t>(std::find(kWallFaces.begin(), kWallFaces.end(), face) - kWallFaces.begin());
    return parts_[house][part][material];
}

MeshBuilder& VisualBuilder::roofDecor(size_t house, int material) { return parts_[house][4][material]; }

void VisualBuilder::commitHouses() {
    for (size_t i = 0; i < w.houses.size(); ++i) {
        House& house = w.houses[i];
        const auto& s = g_specs[i];
        house.bounds = {{s.cx - s.sx / 2 - 0.6, -0.6, s.cz - s.sz / 2 - 0.6}, {s.cx + s.sx / 2 + 0.6, s.height + 0.6, s.cz + s.sz / 2 + 0.6}};
        for (size_t p = 0; p < 5; ++p) {
            HousePart& part = p < 4 ? house.walls[p] : house.roof;
            part.roof = p == 4;
            bool any = false;
            Aabb box{{1e30, 1e30, 1e30}, {-1e30, -1e30, -1e30}};
            for (auto& [mat, mesh] : parts_[i][p]) {
                if (mesh.empty()) continue;
                glm::vec3 lo, hi;
                mesh.computeBounds(lo, hi);
                box.min = {std::min<double>(box.min.x, lo.x), std::min<double>(box.min.y, lo.y), std::min<double>(box.min.z, lo.z)};
                box.max = {std::max<double>(box.max.x, hi.x), std::max<double>(box.max.y, hi.y), std::max<double>(box.max.z, hi.z)};
                any = true;
                part.draws.emplace_back(mat, mesh);  // sin id de casa: se dibujan por separado al desvanecerse
                closedMesh(s.cx, s.cz, mat).appendWithHouse(mesh, house.id);
            }
            if (any) part.bounds = {{box.min.x - 0.08, box.min.y - 0.08, box.min.z - 0.08}, {box.max.x + 0.08, box.max.y + 0.08, box.max.z + 0.08}};
        }
    }
    parts_.clear();
    g_specs.clear();
}

void VisualBuilder::buildBlocks() {
    const TileMap& map = this->map();
    const int mw = map.width(), mh = map.height();
    auto isB = [&](int x, int z) { return map.inside(x, z) && (map.at(x, z) == Tile::Building || map.at(x, z) == Tile::Ruin); };
    auto walk = [&](int x, int z) { return map.inside(x, z) && isWalkable(map.at(x, z)); };
    std::vector<char> covered(static_cast<size_t>(mw) * mh, 0);
    auto cov = [&](int x, int z) -> char& { return covered[static_cast<size_t>(z) * mw + x]; };

    brickTex = addTexture(make([] { return tex::brick(3); }));
    slabTex = addTexture(make([] { return tex::slab(13); }));
    tilesTex = addTexture(make([] { return tex::roofTiles(9); }));
    const int sideMat = textured(brickTex, 0xc8b2a2);
    const int roofMat = textured(slabTex);
    const int tileRoof = textured(tilesTex);
    const int interiorMat = textured(slabTex, 0x675e50);
    const int wood = color(0x5a3d24), woodOld = color(0x4a3626), tankMat = color(0x1c1f22);
    const int wallMat = color(0x3a3532);
    const double T = kTile;

    // dirs: dx, dz, índice de cara de la caja
    static const int DIRS[4][3] = {{0, -1, 5}, {0, 1, 4}, {-1, 0, 1}, {1, 0, 0}};

    auto house = [&](const std::vector<std::pair<int, int>>& tiles, int dx, int dz, int face, bool alongX) {
        bool ruin = false;
        for (auto [x, z] : tiles) ruin |= map.at(x, z) == Tile::Ruin;
        // Profundidad: hasta 3 tiles hacia adentro, sin invadir casas ya construidas.
        int depth = 1;
        for (;;) {
            bool ok = depth < 3;
            for (auto [x, z] : tiles) {
                if (!ok) break;
                const int tx = x - dx * depth, tz = z - dz * depth;
                ok = isB(tx, tz) && !cov(tx, tz);
            }
            if (!ok) break;
            ++depth;
        }
        for (auto [x, z] : tiles)
            for (int d = 0; d < depth; ++d) cov(x - dx * d, z - dz * d) = 1;

        const double widthM = tiles.size() * T;
        const int floors = ruin ? 2 + (rng.next() < 0.3 ? 1 : 0) : 2 + static_cast<int>(std::floor(rng.next() * 3));
        const double h = floors * kFloorHeight;
        const int style = ruin ? 2 : (rng.next() < 0.55 ? 1 : 0);  // 0 pintada, 1 ladrillo, 2 ruina
        const int variant = static_cast<int>(std::floor(rng.next() * 2));
        const int facadeMat = facadeTexture(widthM, floors, style, variant);

        const auto [x0, z0] = tiles.front();
        const auto [x1, z1] = tiles.back();
        const double cx = (W(x0) + W(x1)) / 2 - dx * (depth - 1) * T / 2;
        const double cz = (W(z0) + W(z1)) / 2 - dz * (depth - 1) * T / 2;
        const bool clay = rng.next() < 0.4 || ruin;

        ShellSpec s;
        s.cx = cx; s.cz = cz; s.height = h;
        s.sx = alongX ? widthM : depth * T;
        s.sz = alongX ? depth * T : widthM;
        s.materials = {sideMat, sideMat, clay ? tileRoof : roofMat, roofMat, sideMat, sideMat};
        s.materials[face] = facadeMat;
        s.unitsMeters = {kBrickUnits, kBrickUnits, clay ? kTileUnits : kSlabUnits, kSlabUnits, kBrickUnits, kBrickUnits};
        s.unitsMeters[face] = {0, 0};  // la fachada usa su textura completa
        s.facadeFace = face;
        s.interiorMaterial = interiorMat;
        s.wallInteriorMaterial = sideMat;
        s.wallInteriorUnits = kBrickUnits;
        const size_t idx = addShell(s);

        // punto de la fachada (centro, al ras de la calle) y orientación hacia afuera
        const double fx = (W(x0) + W(x1)) / 2 + dx * T / 2;
        const double fz = (W(z0) + W(z1)) / 2 + dz * T / 2;
        const float yaw = static_cast<float>(std::atan2(dx, dz));

        // aviso de local en el primer piso
        if (!ruin && rng.next() < 0.55) {
            const auto& [title, sub] = pick(kShopNames);
            const int signMat = signTexture(title, sub, pick(kSignBackgrounds), "#ffffff");
            const double sw = std::min(widthM * 0.85, 3.6), sh = sw / 4;
            const glm::mat4 m = glm::rotate(glm::translate(glm::mat4(1.0f), V3(fx + dx * 0.06, 3.05, fz + dz * 0.06)), yaw, glm::vec3(0, 1, 0));
            MeshBuilder& mb = wallDecor(idx, face, signMat);
            mb.setTransform(m);
            mb.quad({-static_cast<float>(sw) / 2, -static_cast<float>(sh) / 2, 0}, {static_cast<float>(sw) / 2, -static_cast<float>(sh) / 2, 0},
                    {static_cast<float>(sw) / 2, static_cast<float>(sh) / 2, 0}, {-static_cast<float>(sw) / 2, static_cast<float>(sh) / 2, 0},
                    {0, 0, 1}, {1, 1, 1}, {0, 0}, {1, 0}, {1, 1}, {0, 1});
            mb.setTransform(glm::mat4(1.0f));
        }
        // balcón de madera en las casas viejas (Cartucho) o en algunas de ladrillo
        if ((ruin && rng.next() < 0.6) || (style == 1 && rng.next() < 0.2)) {
            const int bm = ruin ? woodOld : wood;
            const float bw = static_cast<float>(std::min(widthM * 0.7, 3.5));
            MeshBuilder& mb = wallDecor(idx, face, bm);
            mb.setTransform(glm::rotate(glm::translate(glm::mat4(1.0f), V3(fx + dx * 0.35, 3.1, fz + dz * 0.35)), yaw, glm::vec3(0, 1, 0)));
            mb.box({-bw / 2, -0.06f, -0.35f}, {bw / 2, 0.06f, 0.35f}, {1, 1, 1}, true);
            mb.box({-bw / 2, 0.86f, 0.29f}, {bw / 2, 0.94f, 0.35f}, {1, 1, 1});
            for (int i = 0; i <= static_cast<int>(std::floor(bw / 0.25f)); ++i) {
                const float px = -bw / 2 + i * 0.25f;
                mb.box({px - 0.02f, 0, 0.30f}, {px + 0.02f, 0.9f, 0.34f}, {1, 1, 1});
            }
            mb.setTransform(glm::mat4(1.0f));
        }
        // tanque de agua negro en la terraza
        if (!ruin && rng.next() < 0.35) {
            MeshBuilder& mb = roofDecor(idx, tankMat);
            mb.setTransform(glm::translate(glm::mat4(1.0f), V3(cx + rand(-0.5, 0.5), h, cz + rand(-0.5, 0.5))));
            mb.cylinder(0.45f, 0.5f, 0.9f, 12, {1, 1, 1});
            mb.setTransform(glm::mat4(1.0f));
        }
    };

    for (const auto& d : DIRS) {
        const int dx = d[0], dz = d[1], face = d[2];
        const bool alongX = dz != 0;  // la fachada corre a lo largo de x
        const int outer = alongX ? mh : mw;
        for (int a = 1; a < outer - 1; ++a) {
            // recorre la línea perpendicular buscando tramos de tiles con fachada hacia (dx, dz)
            std::vector<std::pair<int, int>> run;
            auto flush = [&] {
                size_t i = 0;
                while (i < run.size()) {
                    const size_t wTiles = std::min<size_t>(run.size() - i, 2 + static_cast<size_t>(std::floor(rng.next() * 3)));
                    house({run.begin() + i, run.begin() + i + wTiles}, dx, dz, face, alongX);
                    i += wTiles;
                }
                run.clear();
            };
            const int limit = (alongX ? mw : mh) - 1;
            for (int b = 1; b < limit; ++b) {
                const int x = alongX ? b : a, z = alongX ? a : b;
                // Cada tile pertenece a una sola casa, también al recorrer otra fachada.
                const bool faces = isB(x, z) && !cov(x, z) && walk(x + dx, z + dz);
                if (faces) run.emplace_back(x, z);
                else flush();
            }
            flush();
        }
    }

    // El relleno y el perímetro también se dividen en cajas para poder ocultarlos por separado.
    for (int z = 0; z < mh; ++z) {
        for (int x = 0; x < mw; ++x) {
            const Tile type = map.at(x, z);
            if ((!isB(x, z) && type != Tile::Wall) || cov(x, z)) continue;
            int width = 1, depth = 1;
            auto available = [&](int tx, int tz) { return map.inside(tx, tz) && map.at(tx, tz) == type && !cov(tx, tz); };
            while (width < 4 && available(x + width, z)) ++width;
            for (;;) {
                if (depth >= 4) break;
                bool all = true;
                for (int i = 0; i < width; ++i) all &= available(x + i, z + depth);
                if (!all) break;
                ++depth;
            }
            for (int dz = 0; dz < depth; ++dz)
                for (int dx = 0; dx < width; ++dx) cov(x + dx, z + dz) = 1;
            const double h = type == Tile::Wall ? 9 : type == Tile::Ruin ? 4.5 : 6.5;
            const int material = type == Tile::Wall ? wallMat : roofMat;
            ShellSpec s;
            s.cx = W(x) + (width - 1) * T / 2;
            s.cz = W(z) + (depth - 1) * T / 2;
            s.sx = width * T;
            s.sz = depth * T;
            s.height = h;
            s.materials.fill(material);
            s.unitsMeters.fill(kSlabUnits);
            s.interiorMaterial = interiorMat;
            addShell(s);
        }
    }
    commitHouses();
}

// ----------------------------------------------------------------------------- entrada

VisualWorld buildVisualWorld(const Bogota& city, Rng& rng) {
    VisualWorld world;
    VisualBuilder b(city, rng, world);
    // BAZUKO_PROFILE=1 imprime lo que tarda cada fase.
    const bool profile = std::getenv("BAZUKO_PROFILE") != nullptr;
    auto last = std::chrono::steady_clock::now();
    auto lap = [&](const char* name) {
        if (!profile) return;
        const auto now = std::chrono::steady_clock::now();
        std::fprintf(stderr, "  %-10s %6.0f ms\n", name, std::chrono::duration<double, std::milli>(now - last).count());
        last = now;
    };
    b.buildGround();   lap("suelo");
    b.buildMarkings(); lap("marcas");
    b.buildBlocks();   lap("casas");
    b.buildProps();    lap("props");
    b.buildCerros();   lap("cerros");
    b.finalize();      lap("lotes");
    return world;
}

}  // namespace bazuko
