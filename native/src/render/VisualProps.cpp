// Objetos de calle de Bogotá y de El Cartucho (props.js, Farol.js, Banca.js), como mallas estáticas.
#include <algorithm>

#include "render/ProceduralTextures.h"
#include "render/VisualBuilder.h"
#include "world/CityLayout.h"

namespace bazuko {

namespace {

using glm::mat4;
using glm::vec3;

const float kPiF = static_cast<float>(kPi);

mat4 T(float x, float y, float z) { return glm::translate(mat4(1.0f), vec3(x, y, z)); }
mat4 Ry(float a) { return glm::rotate(mat4(1.0f), a, vec3(0, 1, 0)); }
mat4 Rx(float a) { return glm::rotate(mat4(1.0f), a, vec3(1, 0, 0)); }
mat4 Rz(float a) { return glm::rotate(mat4(1.0f), a, vec3(0, 0, 1)); }
mat4 S(float x, float y, float z) { return glm::scale(mat4(1.0f), vec3(x, y, z)); }

const Rgb kWhite{1, 1, 1};

// Contexto de colocación de un prop: transformación base en el mundo y el constructor.
struct Ctx {
    VisualBuilder& b;
    mat4 base;
    vec3 at;

    void box(int mat, vec3 center, vec3 size, mat4 local = mat4(1.0f)) {
        b.draw(mat, at, base * T(center.x, center.y, center.z) * local, [&](MeshBuilder& mb) {
            mb.box(-size * 0.5f, size * 0.5f, kWhite, true);
        });
    }
    void cylinder(int mat, vec3 base0, float rb, float rt, float h, int seg, mat4 local = mat4(1.0f), bool open = false) {
        b.draw(mat, at, base * T(base0.x, base0.y, base0.z) * local, [&](MeshBuilder& mb) {
            mb.cylinder(rb, rt, h, seg, kWhite, true, open);
        });
    }
    void sphere(int mat, vec3 center, float r, int detail, bool flat, mat4 local = mat4(1.0f)) {
        b.draw(mat, at, base * T(center.x, center.y, center.z) * local, [&](MeshBuilder& mb) { mb.sphere(r, detail, kWhite, flat); });
    }
    void cone(int mat, vec3 center, float r, float h, int seg) {
        b.draw(mat, at, base * T(center.x, center.y, center.z), [&](MeshBuilder& mb) { mb.cone(r, h, seg, kWhite); });
    }
    void plane(int mat, vec3 center, float w, float h, mat4 local = mat4(1.0f), glm::vec2 uv1 = {1, 1}) {
        b.draw(mat, at, base * T(center.x, center.y, center.z) * local, [&](MeshBuilder& mb) {
            mb.quad({-w / 2, -h / 2, 0}, {w / 2, -h / 2, 0}, {w / 2, h / 2, 0}, {-w / 2, h / 2, 0}, {0, 0, 1}, kWhite, {0, 0},
                    {uv1.x, 0}, {uv1.x, uv1.y}, {0, uv1.y});
        });
    }
    Ctx child(mat4 local) const { return {b, base * local, at}; }
};

Ctx place(VisualBuilder& b, double x, double z, float rotY, double y = -1) {
    const double gy = y >= 0 ? y : b.groundAt(x, z);
    return {b, T(static_cast<float>(x), static_cast<float>(gy), static_cast<float>(z)) * Ry(rotY), V3(x, gy, z)};
}

// ------------------------------------------------------------------------------------ props

void trashPile(VisualBuilder& b, Ctx c, int n) {
    const int bag = b.textured(b.bagTex), card = b.textured(b.cardTex);
    for (int i = 0; i < n; ++i) {
        const float r = static_cast<float>(b.rand(0.28, 0.42));
        const mat4 rot = Ry(static_cast<float>(b.rand(0, 3))) * Rx(static_cast<float>(b.rand(0, 1))) * S(1, static_cast<float>(b.rand(0.7, 0.95)), 1);
        c.sphere(bag, {static_cast<float>(b.rand(-0.7, 0.7)), 0.25f, static_cast<float>(b.rand(-0.6, 0.6))}, r, 1, false, rot);
    }
    for (int i = 0; i < n / 2; ++i) {
        c.box(card, {static_cast<float>(b.rand(-0.8, 0.8)), 0.1f, static_cast<float>(b.rand(-0.7, 0.7))},
              {static_cast<float>(b.rand(0.4, 0.8)), static_cast<float>(b.rand(0.02, 0.3)), static_cast<float>(b.rand(0.3, 0.6))},
              Ry(static_cast<float>(b.rand(0, 3))));
    }
}

void fireBarrel(VisualBuilder& b, double x, double z) {
    Ctx c = place(b, x, z, 0);
    c.cylinder(b.color(0x4a3a2c, false, true), {0, 0, 0}, 0.3f, 0.32f, 0.9f, 12, mat4(1.0f), true);
    static const std::uint32_t flames[3] = {0xff7a1a, 0xffb347, 0xffd27a};
    for (int i = 0; i < 3; ++i)
        c.cone(b.color(flames[i], true, false, 2.5), {static_cast<float>(b.rand(-0.08, 0.08)), 1.0f, static_cast<float>(b.rand(-0.08, 0.08))},
               0.16f - i * 0.03f, 0.5f, 7);
    b.addLight({x, c.at.y + 1.4, z}, 0xff8a2a, 5, 9, 1.6, false, true, 1.2, 17, 0.8, 31);
}

void zorra(VisualBuilder& b, double x, double z, float rot) {
    Ctx c = place(b, x, z, rot);
    const int wood = b.color(0x6b4a2e), dark = b.color(0x1c1c1c);
    c.box(wood, {0, 0.55f, 0}, {1.1f, 0.08f, 1.9f});
    for (float sx : {-0.55f, 0.55f}) {
        c.box(wood, {sx, 0.78f, 0}, {0.05f, 0.4f, 1.9f});
        c.cylinder(dark, {sx * 1.1f, 0.3f, 0.2f}, 0.3f, 0.3f, 0.1f, 14, Rz(kPiF / 2) * T(0, -0.05f, 0));
    }
    for (float sx : {-0.35f, 0.35f}) c.cylinder(wood, {sx, 0.75f, -1.4f}, 0.03f, 0.03f, 1.2f, 6, Rx(kPiF / 2 - 0.25f) * T(0, -0.6f, 0));
    trashPile(b, c.child(T(0, 0.6f, 0) * S(0.75f, 0.75f, 0.75f)), 5);
}

void umbrella(VisualBuilder& b, Ctx c, std::uint32_t c0, std::uint32_t c1) {
    c.cylinder(b.color(0xcccccc), {0, 0, 0}, 0.025f, 0.025f, 2.2f, 6);
    const int segs = 8;
    for (int i = 0; i < segs; ++i) {
        const float a0 = 2 * kPiF * i / segs, a1 = 2 * kPiF * (i + 1) / segs;
        const int mat = b.color(i % 2 ? c1 : c0, false, true);
        b.draw(mat, c.at, c.base * T(0, 2.25f, 0), [&](MeshBuilder& mb) {
            mb.tri({0, 0.225f, 0}, {std::sin(a0) * 1.2f, -0.225f, std::cos(a0) * 1.2f}, {std::sin(a1) * 1.2f, -0.225f, std::cos(a1) * 1.2f}, kWhite);
        });
    }
}

void chaza(VisualBuilder& b, Ctx c, bool withUmbrella = true) {
    const int wood = b.color(0x7a5a3a), leg = b.color(0x3a3a3a);
    c.box(wood, {0, 0.75f, 0}, {0.9f, 0.7f, 0.6f});
    for (float sx : {-0.4f, 0.4f}) c.box(leg, {sx, 0.2f, 0}, {0.05f, 0.4f, 0.05f});
    static const std::uint32_t colors[7] = {0xe74c3c, 0xf1c40f, 0x2ecc71, 0x3498db, 0xecf0f1, 0xe67e22, 0x9b59b6};
    for (int i = 0; i < 14; ++i)
        c.box(b.color(colors[i % 7]), {-0.38f + (i % 7) * 0.12f, 1.13f, -0.15f + (i / 7) * 0.3f}, {0.1f, 0.05f, 0.14f});
    if (withUmbrella) {
        if (b.rng.next() < 0.5) umbrella(b, c.child(T(0.3f, 0, 0.2f)), 0xc0392b, 0xf2c600);
        else umbrella(b, c.child(T(0.3f, 0, 0.2f)), 0x2f6fb0, 0xecf0f1);
    }
}

void fritanga(VisualBuilder& b, Ctx c) {
    c.box(b.color(0x8a6a4a), {0, 0.85f, 0}, {1.4f, 0.06f, 0.7f});
    c.cylinder(b.color(0x2a2a2a), {0.9f, 0.2f, 0}, 0.3f, 0.35f, 0.6f, 12);
    b.draw(b.color(0xff5a1a, true, false, 1.8), c.at, c.base * T(0.9f, 0.81f, 0), [&](MeshBuilder& mb) { mb.disc(0.32f, 12, kWhite); });
    for (int i = 0; i < 6; ++i)
        c.sphere(b.color(i % 2 ? 0xc8902a : 0x7a3a1a), {-0.5f + i * 0.15f, 0.92f, static_cast<float>(b.rand(-0.15, 0.15))}, 0.06f, 1, true);
    umbrella(b, c.child(T(0, 0, 0.1f)), 0x2e7d32, 0xecf0f1);
    const vec3 lamp = vec3(c.base * glm::vec4(0.9f, 1.1f, 0, 1));
    b.addLight({lamp.x, lamp.y, lamp.z}, 0xff6a2a, 2.2, 5, 2, false, true, 0.4, 9, 0, 0);
}

void shack(VisualBuilder& b, double x, double z, float rot) {
    Ctx c = place(b, x, z, rot);
    const int stick = b.color(0x4a3a28);
    for (auto [px, pz, h] : {std::tuple{-1.f, -0.8f, 1.3f}, {1.f, -0.8f, 1.3f}, {-1.f, 0.8f, 0.9f}, {1.f, 0.8f, 0.9f}})
        c.cylinder(stick, {px, 0, pz}, 0.03f, 0.03f, h, 5);
    const int tarp = b.color(b.rng.next() < 0.5 ? 0x1c1c1c : 0x1f5fbf, false, true);
    c.plane(tarp, {0, 1.12f, 0}, 2.3f, 1.9f, Rx(-kPiF / 2 + 0.2f));
    c.box(b.textured(b.cardTex), {0, 0.02f, 0}, {1.9f, 0.04f, 1.5f});
    static const std::uint32_t blankets[3] = {0x7a2c2c, 0x3b4a6b, 0x6b6b2a};
    c.box(b.color(blankets[static_cast<int>(std::floor(b.rng.next() * 3))]), {-0.4f, 0.1f, 0}, {0.8f, 0.12f, 1.4f});
}

void mattress(VisualBuilder& b, double x, double z) {
    Ctx c = place(b, x, z, 0);
    c.box(b.color(0x9d9a86), {0, 0.08f, 0}, {0.95f, 0.16f, 1.9f}, Ry(static_cast<float>(b.rand(0, kPi))));
}

void clothesline(VisualBuilder& b, double x, double z) {
    Ctx c = place(b, x, z, 0);
    const float height = 3.2f, a = -2.4f, e = 2.4f;
    const float len = e - a;
    c.box(b.color(0xdddddd), {0, height, 0}, {0.02f, 0.02f, len});
    const int n = static_cast<int>(std::floor(len / 0.6f));
    static const std::uint32_t colors[7] = {0xc0392b, 0x2f6fb0, 0xecf0f1, 0x3f7a3a, 0xe0962b, 0x7a4fa0, 0x1f1f1f};
    for (int i = 1; i < n; ++i) {
        const float pz = a + len * i / n;
        c.plane(b.color(colors[i % 7], false, true), {0, height - 0.3f, pz}, 0.4f, static_cast<float>(b.rand(0.4, 0.7)), Ry(kPiF / 2));
    }
}

void streetSign(VisualBuilder& b, double x, double z, float rot, const std::vector<std::string>& lines) {
    Ctx c = place(b, x, z, rot);
    c.cylinder(b.color(0x666666), {0, 0, 0}, 0.04f, 0.04f, 2.8f, 6);
    for (size_t i = 0; i < lines.size(); ++i) {
        const int mat = b.signTexture(lines[i], "", "#ffffff", "#1b1b1b");
        c.plane(mat, {0, 2.65f - static_cast<float>(i) * 0.32f, 0}, 1.1f, 0.28f, Ry(i % 2 ? kPiF / 2 : 0));
    }
}

void tree(VisualBuilder& b, double x, double z, double scale) {
    Ctx c = place(b, x, z, 0);
    c.base = c.base * S(static_cast<float>(scale), static_cast<float>(scale), static_cast<float>(scale));
    c.cylinder(b.color(0x4a3a2a), {0, 0, 0}, 0.2f, 0.12f, 3, 7);
    static const std::uint32_t greens[3] = {0x2f5a2a, 0x3a6b30, 0x26492a};
    for (int i = 0; i < 4; ++i)
        c.sphere(b.color(greens[i % 3]), {static_cast<float>(b.rand(-0.6, 0.6)), static_cast<float>(3.2 + b.rand(0, 1)), static_cast<float>(b.rand(-0.6, 0.6))},
                 static_cast<float>(b.rand(0.9, 1.4)), 0, true);
}

void farol(VisualBuilder& b, double x, double z) {
    Ctx c = place(b, x, z, 0, kSidewalkY);
    const int metal = b.color(0x2a2a30);
    c.cylinder(metal, {0, 0, 0}, 0.08f, 0.06f, 4, 6);
    c.box(metal, {0.3f, 4, 0}, {0.6f, 0.08f, 0.08f});
    c.box(b.color(0xc9a227, true), {0.6f, 3.9f, 0}, {0.2f, 0.15f, 0.25f});
    b.addLight({x + 0.6, kSidewalkY + 3.8, z}, 0xc9a227, 1.2, 8, 2, true, false);
}

void banca(VisualBuilder& b, double x, double z, float rot) {
    Ctx c = place(b, x, z, rot);
    const int wood = b.color(0x4a3020), metal = b.color(0x1a1a20);
    c.box(wood, {0, 0.45f, 0}, {1.6f, 0.08f, 0.5f});
    c.box(wood, {0, 0.7f, -0.21f}, {1.6f, 0.5f, 0.08f});
    for (float sx : {-0.7f, 0.7f}) c.box(metal, {sx, 0.22f, 0}, {0.08f, 0.45f, 0.4f});
}

void busStation(VisualBuilder& b, double x, double z, float length) {
    Ctx c = place(b, x, z, 0, 0);
    const int concrete = b.color(0x9a9a96), red = b.color(0xc0392b), steel = b.color(0xbbbbbb);
    c.box(concrete, {0, 0.45f, 0}, {2.6f, 0.9f, length});
    c.box(red, {0, 3.3f, 0}, {3.2f, 0.12f, length + 1});
    for (float zz = -length / 2; zz <= length / 2; zz += 4)
        for (float sx : {-1.2f, 1.2f}) c.cylinder(steel, {sx, 0.9f, zz}, 0.07f, 0.07f, 2.4f, 8);
    // paneles de vidrio como láminas oscuras casi transparentes: se dibujan opacos y oscuros
    const int glass = b.color(0x6f8fa0, false, true);
    for (float sx : {-1.25f, 1.25f}) c.plane(glass, {sx, 1.7f, 0}, length, 1.6f, Ry(kPiF / 2));
    const int sign = b.signTexture("ESTACIÓN CALLE 10", "TRONCAL CARACAS", "#c0392b", "#ffffff");
    c.plane(sign, {0, 3.8f, length / 2 - 1}, 2.8f, 0.7f, Ry(kPiF / 2));
}

void vendorStall(VisualBuilder& b, const Vendor& v) {
    Ctx c = place(b, v.x, v.z, static_cast<float>(v.rotY));
    if (v.kind == VendorKind::Fritanga) fritanga(b, c);
    else chaza(b, c);
}

}  // namespace

void VisualBuilder::buildProps() {
    bagTex = addTexture(make([] { return tex::trashBag(5); }));
    cardTex = addTexture(make([] { return tex::cardboard(21); }));
    const TileMap& map = city.map();

    // faroles cada ~14 m en los andenes junto a la calzada
    for (int z = 2; z < map.height() - 2; z += 7) {
        for (int x = 2; x < map.width() - 2; x += 7) {
            int bx = -1, bz = -1;
            for (int dz = 0; dz < 7 && bx < 0; ++dz)
                for (int dx = 0; dx < 7 && bx < 0; ++dx) {
                    const int tx = x + dx, tz = z + dz;
                    if (map.atOr(tx, tz, Tile::Wall) != Tile::Sidewalk) continue;
                    for (auto [a, c] : {std::pair{1, 0}, {-1, 0}, {0, 1}, {0, -1}})
                        if (map.atOr(tx + a, tz + c, Tile::Wall) == Tile::Road) { bx = tx; bz = tz; break; }
                }
            if (bx >= 0) farol(*this, W(bx), W(bz));
        }
    }
    // placas en las esquinas
    const auto& calles = cityCalles();
    std::vector<Band> carr = cityCarreras();
    carr.push_back({caracas().lanes[0].a, caracas().lanes[1].b, "Av. Caracas"});
    for (const Band& cz : calles)
        for (const Band& cx : carr) streetSign(*this, W(cx.a - 1), W(cz.a - 1), 0.4f, {cz.name, cx.name});

    // estación de la troncal
    const auto& bw = caracas().busway;
    busStation(*this, (W(bw.a) + W(bw.b)) / 2, WZ(21.5), 16);

    // vendedores (el vendedor en sí es un peatón quieto)
    for (const Vendor& v : city.vendors()) vendorStall(*this, v);

    // El Cartucho: canecas con fuego, zorras, cambuches, basura, colchones y ropa colgada
    for (auto [x, z] : {std::pair{13.0, 19.0}, {16.5, 24.5}, {10.0, 21.5}, {19.5, 22.0}}) fireBarrel(*this, WX(x), WZ(z));
    for (auto [x, z, r] : {std::tuple{9.5, 22.5, 0.3}, {12.5, 24.5, 1.9}, {18.5, 21.0, -0.8}, {20.5, 15.0, 1.2}})
        zorra(*this, WX(x), WZ(z), static_cast<float>(r));
    for (auto [x, z, r] : {std::tuple{12.5, 18.3, 0.0}, {15.0, 18.3, 0.0}, {17.4, 20.0, kPi / 2}, {12.3, 25.5, kPi}, {11.0, 22.5, kPi / 2}})
        shack(*this, WX(x), WZ(z), static_cast<float>(r));
    for (int i = 0; i < 9; ++i) {
        const double x = rand(9.5, 20.5), z = rng.next() < 0.5 ? rand(21, 22.5) : rand(18.5, 25);
        if (std::hypot(WX(x) - WX(14.5), WZ(z) - WZ(21.5)) < 3) continue;
        if (rng.next() < 0.75) {
            Ctx c = place(*this, WX(x), WZ(z), static_cast<float>(rand(0, 3)));
            trashPile(*this, c, 4 + static_cast<int>(std::floor(rng.next() * 5)));
        } else {
            mattress(*this, WX(x), WZ(z));
        }
    }
    for (double x : {10.5, 18.5}) clothesline(*this, WX(x), WZ(21.5));

    // parque del centro
    for (int i = 0; i < 9; ++i) {
        const double x = rand(29.5, 38.5), z = rand(33.5, 45.5);
        if (std::abs(x - 33.5) < 1.6 || std::abs(z - 39) < 1.2) continue;
        tree(*this, WX(x), WZ(z), rand(0.9, 1.3));
    }
    for (auto [x, z, r] : {std::tuple{32.0, 37.0, kPi / 2}, {35.0, 41.0, -kPi / 2}, {31.0, 39.8, 0.0}, {36.5, 38.2, kPi}})
        banca(*this, WX(x), WZ(z), static_cast<float>(r));
    streetSign(*this, WX(29), WZ(33), -0.6f, {"Parque", "Tercer Milenio"});

    // parques de los barrios nuevos
    for (const Park& park : extensionParks()) {
        for (int z = park.z0 + 1; z < park.z1; z += 4)
            for (int x = park.x0 + 1; x < park.x1; x += 4)
                if (map.at(x, z) == Tile::Grass) tree(*this, W(x), W(z), rand(0.9, 1.3));
        const int pathZ = (park.z0 + park.z1) / 2;
        for (int x : {park.x0 + 2, park.x1 - 2}) banca(*this, W(x), W(pathZ), 0);
        streetSign(*this, W(park.x0), W(pathZ), 0, {park.name, "Bogotá"});
    }
}

void VisualBuilder::buildCerros() {
    // Silueta lejana de los cerros orientales con la iglesia en la cima; no recibe niebla.
    const int far = color(0x3d5245, true, true, 1, true), near = color(0x2c3d33, true, true, 1, true);
    const int church = color(0xe8e3d6, true, true, 1, true);
    const float width = 260, height = 70;
    const int nx = 60, ny = 12;
    auto ridge = [](float x) { return 22 + std::sin(x * 0.03f) * 10 + std::sin(x * 0.081f + 1) * 6 + std::sin(x * 0.17f) * 2.5f; };
    auto strip = [&](int mat, const mat4& m) {
        MeshBuilder& mb = staticMesh(-130, W(city.height() / 2.0) - 30, mat);
        mb.setTransform(m);
        for (int j = 0; j < ny; ++j) {
            for (int i = 0; i < nx; ++i) {
                auto vert = [&](int ii, int jj) {
                    const float x = -width / 2 + width * ii / nx, y = -height / 2 + height * jj / ny;
                    return vec3(x, std::min(y, -35 + ridge(x)), 0);
                };
                mb.quad(vert(i, j), vert(i + 1, j), vert(i + 1, j + 1), vert(i, j + 1), {0, 0, 1}, kWhite);
            }
        }
        mb.setTransform(mat4(1.0f));
    };
    const mat4 group = T(-130, 0, static_cast<float>(W(city.height() / 2.0) - 30)) * Ry(kPiF / 2);
    strip(far, group);
    strip(near, group * T(30, -8, 15) * S(1.1f, 0.75f, 1));
    MeshBuilder& mb = staticMesh(-130, W(city.height() / 2.0) - 30, church);
    mb.setTransform(group * T(-18, -35 + 22 + std::sin(-18 * 0.03f) * 10 + std::sin(-18 * 0.081f + 1) * 6 + 1.6f, 2));
    mb.box({-1.5f, -1.1f, -0.5f}, {1.5f, 1.1f, 0.5f}, kWhite);
    mb.setTransform(mat4(1.0f));
}

}  // namespace bazuko
