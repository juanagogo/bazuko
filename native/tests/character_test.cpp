#include <doctest/doctest.h>

#include <algorithm>
#include <cmath>
#include <set>

#include "character/CharacterLibrary.h"
#include "test_util.h"

using namespace bazuko;
using Approx = doctest::Approx;

namespace {

const std::string kModels = BAZUKO_MODELS_DIR;

const Catalog& catalog() {
    static const Catalog c = Catalog::load(kModels + "/personaje/catalogo.json");
    return c;
}

struct FakeSink : GpuSink {
    struct Mesh { size_t vertices, indices; };
    std::vector<Mesh> meshes;
    std::vector<Image> textures;
    int uploadTexture(const Image& img) override {
        textures.push_back(img);
        return static_cast<int>(textures.size()) - 1;
    }
    int uploadSkinnedMesh(const std::vector<float>& v, const std::vector<std::uint32_t>& i) override {
        meshes.push_back({v.size() / 16, i.size()});
        return static_cast<int>(meshes.size()) - 1;
    }
};

Look makeLook(const char* sexo, const char* edad, const char* pelo, const char* barba, const char* ropa, const char* calzado) {
    Look l;
    l.piel = 2;
    l.peloColor = 1;
    l.real = {sexo, edad, pelo, barba, ropa, calzado};
    return l;
}

}  // namespace

// ---------- catálogo ----------

TEST_CASE("el catálogo trae 6 cuerpos y las piezas de cada categoría") {
    CHECK(catalog().bodies().size() == 6);
    CHECK(catalog().pieces("pelo").size() == 8);
    CHECK(catalog().pieces("barba").size() == 5);
    CHECK(catalog().pieces("ropa").size() == 11);
    CHECK(catalog().pieces("calzado").size() == 4);
    CHECK(catalog().pieces("inexistente").empty());
    const BodyDef* b = catalog().body("hombre", "adulto");
    REQUIRE(b);
    CHECK(b->id == "hombre-adulto");
    CHECK(b->pieces.at("chaqueta").hidden.size() == 5842);
    CHECK(b->pieces.at("calvo").file.empty());
    CHECK(b->pieces.at("chaqueta").lod == "lod/chaqueta.gltf");
    CHECK(catalog().body("hombre", "viejo") == nullptr);
}

TEST_CASE("las piezas válidas dependen del sexo y normalize corrige lo imposible") {
    const auto menBeards = catalog().optionsFor("barba", "hombre");
    const auto womenBeards = catalog().optionsFor("barba", "mujer");
    CHECK(menBeards.size() == 5);
    CHECK(womenBeards.size() == 1);
    CHECK(womenBeards[0].id == "ninguna");

    RealLook bad;
    bad.sexo = "otro";
    bad.edad = "anciano";
    bad.ropa = "no-existe";
    const RealLook fixed = catalog().normalize(bad);
    CHECK(fixed.sexo == "hombre");
    CHECK(fixed.edad == "adulto");
    CHECK(catalog().optionsFor("ropa", "hombre").front().id == fixed.ropa);

    RealLook woman;
    woman.sexo = "mujer";
    woman.ropa = "chaqueta";  // ropa de hombre
    woman.barba = "larga";
    const RealLook w = catalog().normalize(woman);
    CHECK(w.barba == "ninguna");
    CHECK(w.ropa != "chaqueta");
}

TEST_CASE("randomReal siempre da combinaciones válidas") {
    Mulberry32Rng rng(5);
    for (int i = 0; i < 300; ++i) {
        const RealLook r = catalog().randomReal(rng);
        CHECK(catalog().normalize(r) == r);
        CHECK(catalog().body(r.sexo, r.edad) != nullptr);
    }
}

TEST_CASE("la gente de la calle: 72 % hombres, ropa vieja en El Cartucho y determinista por semilla") {
    const LookData& look = testutil::data().look;
    Mulberry32Rng rng(11);
    int men = 0, oldClothes = 0, oldShoes = 0, bearded = 0, menCount = 0;
    const std::set<std::string> viejas = {"rota", "saco", "chaqueta", "buzo", "overol", "sudadera"};
    for (int i = 0; i < 1000; ++i) {
        const Look l = randomStreetLook(catalog(), look, rng, true);
        men += l.real.sexo == "hombre";
        oldClothes += viejas.count(l.real.ropa) > 0;
        oldShoes += l.real.calzado == "tenis-rotos" || l.real.calzado == "botas";
        if (l.real.sexo == "hombre") { ++menCount; bearded += l.real.barba != "ninguna"; }
        else CHECK(l.real.barba == "ninguna");
        CHECK((l.piel >= 1 && l.piel <= 5));
        CHECK(catalog().normalize(l.real) == l.real);
    }
    CHECK(men / 1000.0 == Approx(0.72).epsilon(0.08));
    CHECK(oldClothes == 1000);
    CHECK(oldShoes == 1000);
    CHECK(bearded / static_cast<double>(menCount) == Approx(0.7).epsilon(0.1));

    Mulberry32Rng a(3), b(3);
    CHECK(randomStreetLook(catalog(), look, a, false).real == randomStreetLook(catalog(), look, b, false).real);
}

TEST_CASE("los tonos de piel y pelo mezclan la paleta con blanco en espacio lineal") {
    const LookData& look = testutil::data().look;
    const Rgb piel = paletteTone(look.palettes.at("piel"), 2, 2, 0.25);
    const Rgb raw = rgbFromHex(0xd39a6d);
    CHECK(piel.r == Approx(raw.r + (1 - raw.r) * 0.25));
    CHECK(piel.b == Approx(raw.b + (1 - raw.b) * 0.25));
    // un índice fuera de la paleta usa el de reserva
    const Rgb fallback = paletteTone(look.palettes.at("pelo"), 99, 0, 0);
    CHECK(fallback.r == Approx(rgbFromHex(0x1b1410).r));
}

// ---------- biblioteca de personajes ----------

TEST_CASE("un hombre adulto se arma con cuerpo, cejas, pestañas, ojos, pelo, barba, ropa y calzado") {
    FakeSink sink;
    CharacterLibrary lib(catalog(), testutil::data().look, kModels, sink);
    const auto bp = lib.build(makeLook("hombre", "adulto", "corto", "candado", "chaqueta", "botas"), false);
    REQUIRE(bp);
    CHECK(bp->bodyId == "hombre-adulto");
    CHECK_FALSE(bp->lod);
    CHECK(bp->parts.size() == 8);  // 4 del cuerpo + pelo + barba + ropa + calzado

    int body = 0, hair = 0, beard = 0, clothes = 0, shoes = 0, blend = 0;
    for (const MeshPart& p : bp->parts) {
        CHECK(p.jointNodes.size() == 52);
        CHECK(p.inverseBind.size() == 52);
        CHECK(p.gpuMesh >= 0);
        CHECK(p.gpuTexture >= 0);
        CHECK(p.castShadow);
        for (int node : p.jointNodes) { REQUIRE(node >= 0); CHECK(bp->rig->nodes[node].isBone); }
        body += p.kind == PartKind::Body;
        hair += p.kind == PartKind::Hair;
        beard += p.kind == PartKind::Beard;
        clothes += p.kind == PartKind::Clothes;
        shoes += p.kind == PartKind::Shoes;
        blend += p.blend;
        if (p.kind == PartKind::Hair) { CHECK(p.alphaCutoff == Approx(0.08f)); CHECK(p.doubleSided); CHECK_FALSE(p.blend); }
        if (p.kind == PartKind::Clothes || p.kind == PartKind::Shoes) CHECK(p.polygonOffset);
    }
    CHECK(body == 1);
    CHECK(hair == 1);
    CHECK(beard == 1);
    CHECK(clothes == 1);
    CHECK(shoes == 1);
    CHECK(blend >= 3);  // cejas, pestañas y barba se mezclan con alfa
    CHECK(bp->clips.count("idle"));
    CHECK(bp->clips.count("walk"));
    CHECK(bp->clips.count("run"));
}

TEST_CASE("el cuerpo toma el tono de piel y el pelo, las cejas y la barba el del pelo") {
    FakeSink sink;
    CharacterLibrary lib(catalog(), testutil::data().look, kModels, sink);
    const Look look = makeLook("hombre", "adulto", "corto", "candado", "chaqueta", "botas");
    const auto bp = lib.build(look, false);
    const Rgb skin = paletteTone(testutil::data().look.palettes.at("piel"), look.piel, 2, 0.25);
    const Rgb hair = paletteTone(testutil::data().look.palettes.at("pelo"), look.peloColor, 0, 0.15);
    for (const MeshPart& p : bp->parts) {
        if (p.kind == PartKind::Body) { CHECK(p.tint.r == Approx(skin.r)); CHECK(p.tint.g == Approx(skin.g)); }
        if (p.kind == PartKind::Hair || p.kind == PartKind::Beard || p.name.find("eyebrow") != std::string::npos) CHECK(p.tint.r == Approx(hair.r));
        if (p.kind == PartKind::Clothes) CHECK(p.tint.r == 1);
    }
}

TEST_CASE("la ropa oculta los triángulos del cuerpo que tapa") {
    FakeSink sink;
    CharacterLibrary lib(catalog(), testutil::data().look, kModels, sink);
    auto bodyTriangles = [&](const char* ropa) {
        const auto bp = lib.build(makeLook("hombre", "adulto", "rapado", "ninguna", ropa, "tenis"), false);
        for (const MeshPart& p : bp->parts)
            if (p.kind == PartKind::Body) return p.triangles;
        return size_t{0};
    };
    const size_t jacket = bodyTriangles("chaqueta"), coat = bodyTriangles("saco");
    CHECK(jacket < coat);                               // la chaqueta tapa mucho más del cuerpo
    CHECK(coat < 80268 / 3);                            // y el calzado siempre tapa los pies
    CHECK(jacket > 10000);                              // pero el cuerpo no desaparece
}

TEST_CASE("las mallas y texturas se comparten entre personajes con las mismas piezas") {
    FakeSink sink;
    CharacterLibrary lib(catalog(), testutil::data().look, kModels, sink);
    const Look a = makeLook("hombre", "adulto", "corto", "ninguna", "chaqueta", "botas");
    const auto first = lib.build(a, false);
    const size_t meshesAfterFirst = sink.meshes.size(), texturesAfterFirst = sink.textures.size();
    CHECK(lib.build(a, false) == first);                       // el mismo look reutiliza el plano
    Look b = a;
    b.piel = 4;
    b.peloColor = 6;                                           // solo cambian los tintes
    const auto second = lib.build(b, false);
    CHECK(second != first);
    CHECK(sink.meshes.size() == meshesAfterFirst);             // sin geometría nueva
    CHECK(sink.textures.size() == texturesAfterFirst);
    CHECK(second->parts[0].gpuMesh == first->parts[0].gpuMesh);
    CHECK(second->rig == first->rig);                          // mismo esqueleto retargeteado
    CHECK(second->parts[0].tint.r != first->parts[0].tint.r);  // pero otro tono de piel
}

TEST_CASE("la versión liviana usa el cuerpo proxy, no proyecta sombra y comparte las animaciones") {
    FakeSink sink;
    CharacterLibrary lib(catalog(), testutil::data().look, kModels, sink);
    const Look look = makeLook("hombre", "adulto", "corto", "ninguna", "chaqueta", "botas");
    const auto full = lib.build(look, false);
    const auto light = lib.build(look, true);
    REQUIRE(light->lod);
    CHECK(light->rig != full->rig);
    size_t fullVerts = 0, lightVerts = 0;
    for (const MeshPart& p : full->parts) if (p.kind == PartKind::Body) fullVerts = sink.meshes[p.gpuMesh].vertices;
    for (const MeshPart& p : light->parts) if (p.kind == PartKind::Body) lightVerts = sink.meshes[p.gpuMesh].vertices;
    CHECK(fullVerts == 14517);
    CHECK(lightVerts == 1914);
    for (const MeshPart& p : light->parts) CHECK_FALSE(p.castShadow);
    size_t fullTris = 0, lightTris = 0;
    for (const MeshPart& p : full->parts) fullTris += p.triangles;
    for (const MeshPart& p : light->parts) lightTris += p.triangles;
    CHECK(lightTris * 3 < fullTris);
    CHECK(light->clips.count("walk"));
}

TEST_CASE("cualquier combinación al azar de la calle se arma sin errores (80 personajes)") {
    FakeSink sink;
    CharacterLibrary lib(catalog(), testutil::data().look, kModels, sink);
    Mulberry32Rng rng(21);
    std::set<std::string> bodies;
    for (int i = 0; i < 80; ++i) {
        const Look look = randomStreetLook(catalog(), testutil::data().look, rng, i % 2 == 0);
        const auto bp = lib.build(look, i % 3 == 0);
        REQUIRE(bp);
        CHECK(bp->parts.size() >= 5);
        bodies.insert(bp->bodyId);
        for (const MeshPart& p : bp->parts) REQUIRE(p.gpuMesh >= 0);
    }
    CHECK(bodies.size() >= 5);                  // los seis cuerpos aparecen
    CHECK(sink.meshes.size() < 80 * 8);         // la caché evita subir cada pieza una vez por personaje
    CHECK(lib.loadedModels() > 10);
}

// ---------- instancia animada ----------

#include "character/Character.h"

namespace {

// Posiciones de varios vértices del cuerpo con el skinning aplicado en CPU (palette = mundo · inverseBind).
std::vector<glm::vec3> skinnedBody(const GltfModel& body, const SkinnedDraw& draw, size_t step) {
    const GltfPrimitive& prim = body.meshes[0].primitives[0];
    std::vector<glm::vec3> out;
    for (size_t v = 0; v < prim.vertexCount(); v += step) {
        glm::vec4 p(0);
        const glm::vec4 rest(prim.positions[v * 3], prim.positions[v * 3 + 1], prim.positions[v * 3 + 2], 1);
        for (int k = 0; k < 4; ++k) p += prim.weights[v * 4 + k] * (draw.palette[prim.joints[v * 4 + k]] * rest);
        out.emplace_back(p);
    }
    return out;
}

}  // namespace

TEST_CASE("el personaje animado conserva su forma y su altura en idle, caminando y corriendo") {
    FakeSink sink;
    CharacterLibrary lib(catalog(), testutil::data().look, kModels, sink);
    const auto bp = lib.build(makeLook("hombre", "adulto", "corto", "ninguna", "chaqueta", "botas"), false);
    Character c(bp);
    const GltfModel body = loadGltf(kModels + "/personaje/hombre-adulto/cuerpo.gltf", {false});

    struct Case { double speed; bool running; int frames; };
    for (const Case& k : {Case{0, false, 40}, Case{1.4, false, 120}, Case{4.0, true, 120}}) {
        for (int i = 0; i < k.frames; ++i) c.update(1.0 / 60, {k.speed, k.running, {}});
        std::vector<SkinnedDraw> draws;
        c.collect(glm::mat4(1.0f), true, draws);
        REQUIRE(draws.size() == bp->parts.size());
        const SkinnedDraw* bodyDraw = nullptr;
        for (size_t i = 0; i < draws.size(); ++i) if (bp->parts[i].kind == PartKind::Body) bodyDraw = &draws[i];
        REQUIRE(bodyDraw);
        REQUIRE(bodyDraw->paletteCount == 52);

        float minY = 1e9f, maxY = -1e9f, maxXZ = 0;
        for (const glm::vec3& p : skinnedBody(body, *bodyDraw, 40)) {
            REQUIRE(std::isfinite(p.x + p.y + p.z));
            minY = std::min(minY, p.y);
            maxY = std::max(maxY, p.y);
            maxXZ = std::max({maxXZ, std::abs(p.x), std::abs(p.z)});
        }
        INFO("velocidad ", k.speed);
        CHECK(minY > -0.15f);          // los pies no se hunden
        CHECK(minY < 0.1f);            // y apoyan cerca del suelo
        CHECK(maxY > 1.55f);           // mide ~1,7 m
        CHECK(maxY < 1.95f);
        CHECK(maxXZ < 1.0f);           // ningún vértice sale disparado
    }
}

TEST_CASE("collect entrega una pieza dibujable por malla con la transformación y los tintes del plano") {
    FakeSink sink;
    CharacterLibrary lib(catalog(), testutil::data().look, kModels, sink);
    const auto bp = lib.build(makeLook("mujer", "joven", "melena", "ninguna", "blusa", "tenis"), false);
    Character c(bp);
    std::vector<SkinnedDraw> draws;
    const glm::mat4 model = glm::translate(glm::mat4(1.0f), glm::vec3(5, 0, 7));
    c.collect(model, false, draws);
    REQUIRE(draws.size() == bp->parts.size());
    for (size_t i = 0; i < draws.size(); ++i) {
        CHECK(draws[i].mesh == bp->parts[i].gpuMesh);
        CHECK(draws[i].texture == bp->parts[i].gpuTexture);
        CHECK(draws[i].model == model);
        CHECK(draws[i].tint.r == Approx(bp->parts[i].tint.r));
        CHECK(draws[i].blend == bp->parts[i].blend);
        CHECK_FALSE(draws[i].silhouette);
        CHECK(draws[i].palette != nullptr);
    }
    CHECK(kRealisticScale == Approx(1.08));
}

TEST_CASE("dos personajes con el mismo plano se animan de forma independiente") {
    FakeSink sink;
    CharacterLibrary lib(catalog(), testutil::data().look, kModels, sink);
    const auto bp = lib.build(makeLook("hombre", "joven", "rapado", "ninguna", "camiseta", "tenis"), true);
    Character a(bp), b(bp);
    a.update(0.5, {0, false, {}});
    CHECK(a.animator().time("idle") == Approx(0.5));
    CHECK(b.animator().time("idle") == Approx(0));
    std::vector<SkinnedDraw> da, db;
    a.collect(glm::mat4(1.0f), false, da);
    b.collect(glm::mat4(1.0f), false, db);
    CHECK(da[0].palette != db[0].palette);
    bool differ = false;
    for (int j = 0; j < da[0].paletteCount; ++j) differ |= da[0].palette[j] != db[0].palette[j];
    CHECK(differ);
}
