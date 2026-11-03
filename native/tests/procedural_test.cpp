#include <doctest/doctest.h>

#include <algorithm>
#include <cmath>
#include <set>

#include <nlohmann/json.hpp>

#include "character/Look.h"
#include "character/ProceduralCharacter.h"
#include "test_util.h"

using namespace bazuko;
using nlohmann::json;
using Approx = doctest::Approx;

namespace {

struct Sink : GpuSink {
    std::vector<std::pair<size_t, size_t>> meshes;  // vértices, índices
    int textures = 0;
    int uploadTexture(const Image&) override { return textures++; }
    int uploadSkinnedMesh(const std::vector<float>& v, const std::vector<std::uint32_t>& i) override {
        meshes.emplace_back(v.size() / 16, i.size());
        return static_cast<int>(meshes.size()) - 1;
    }
};

const LookData& data() { return testutil::data().look; }

}  // namespace

// ---------- Look (look.js) ----------

TEST_CASE("cleanName deja texto plano, sin espacios dobles ni < > y de máximo 16 caracteres") {
    CHECK(cleanName("  Don   Chepe ") == "Don Chepe");
    CHECK(cleanName("<b>Jairo</b>") == "bJairo/b");
    CHECK(cleanName("a\tb\nc") == "abc");  // los caracteres de control se eliminan antes de colapsar espacios
    CHECK(cleanName("Nombre larguísimo de prueba") == "Nombre larguísim");  // 16 caracteres, sin partir la í por la mitad
    CHECK(cleanName("").empty());
    CHECK(cleanName("   ").empty());
    CHECK(cleanName("ñandú").size() == 7);  // ñ y ú ocupan 2 bytes
}

TEST_CASE("normalizeLook corrige estilos y colores inválidos y acota la estatura") {
    json raw = {{"v", 2}, {"nombre", " Yuli "}, {"pelo", "inventado"}, {"barba", "completa"}, {"peloColor", 99},
                {"piel", 3}, {"estatura", 5}, {"arriba", "rayas"}, {"zapatoColor", -1}, {"cabeza", "sombrero"}};
    const Look l = normalizeLook(raw, data());
    CHECK(l.nombre == "Yuli");
    CHECK(l.pelo == "corto");       // inválido: vuelve al valor por defecto
    CHECK(l.barba == "completa");
    CHECK(l.peloColor == 0);
    CHECK(l.piel == 3);
    CHECK(l.estatura == Approx(1.08));
    CHECK(l.arriba == "rayas");
    CHECK(l.zapatoColor == 1);
    CHECK(l.cabeza == "sombrero");
    CHECK_FALSE(l.hasReal);
    CHECK(normalizeLook(json(5), data()).nombre.empty());  // basura: apariencia por defecto
    CHECK(normalizeLook(json::object(), data()).cuerpo == "a");  // sin v:2 → formato antiguo
}

TEST_CASE("migra el formato anterior de apariencia { piel, buzo, gorra, barba, origen }") {
    const Look l = normalizeLook(json{{"piel", 1}, {"buzo", 4}, {"gorra", 2}, {"barba", true}, {"origen", "migrante"}}, data());
    CHECK(l.piel == 2);              // piel + 1
    CHECK(l.arribaColor == 4);
    CHECK(l.cabeza == "gorra");
    CHECK(l.cabezaColor == 0);       // oldCap[2]
    CHECK(l.barba == "candado");
    CHECK(l.origen == "migrante");
    const Look none = normalizeLook(json{{"gorra", 0}, {"barba", false}}, data());
    CHECK(none.cabeza == "nada");
    CHECK(none.barba == "ninguna");
}

TEST_CASE("el JSON de la apariencia ida y vuelta conserva todo, incluidas las piezas realistas") {
    Look l;
    l.nombre = "Wilmer";
    l.piel = 4; l.peloColor = 7; l.cuerpo = "b"; l.contextura = "robusto"; l.estatura = 1.05;
    l.hasReal = true;
    l.real = {"mujer", "mayor", "melena", "ninguna", "blusa", "tenis"};
    const json j = lookToJson(l);
    CHECK(j["v"] == 2);
    CHECK(j["real"]["ropa"] == "blusa");
    const Look back = normalizeLook(j, data());
    CHECK(back.nombre == "Wilmer");
    CHECK(back.cuerpo == "b");
    CHECK(back.contextura == "robusto");
    CHECK(back.estatura == Approx(1.05));
    CHECK(back.peloColor == 7);
    CHECK(back.hasReal);
    CHECK(back.real == l.real);
    // sin piezas realistas no se escribe `real`
    CHECK_FALSE(lookToJson(Look{}).contains("real"));
}

TEST_CASE("randomLook siempre produce apariencias válidas y variadas") {
    Mulberry32Rng rng(8);
    std::set<std::string> hair, tops;
    for (int i = 0; i < 400; ++i) {
        const Look l = randomLook(defaultLook(), data(), rng);
        const Look n = normalizeLook(lookToJson(l), data());
        CHECK(n.pelo == l.pelo);
        CHECK(n.arribaColor == l.arribaColor);
        CHECK(n.abajoColor == l.abajoColor);
        CHECK((l.abajoColor != l.arribaColor || l.arribaColor == 10));  // la ropa contrasta (10 es el color de reemplazo)
        CHECK((l.estatura >= 0.94 && l.estatura <= 1.06));
        hair.insert(l.pelo);
        tops.insert(l.arriba);
    }
    CHECK(hair.size() == data().styles.at("pelo").size());
    CHECK(tops.size() == data().styles.at("arriba").size());
}

// ---------- personaje procedural ----------

TEST_CASE("el personaje procedural se arma con piezas por material y un esqueleto de 16 huesos") {
    Sink sink;
    ProceduralCharacter c(defaultLook(), data(), sink);
    CHECK(c.drawCount() >= 8);
    CHECK(c.triangleCount() > 5000);
    CHECK(c.triangleCount() < 60000);  // es el personaje liviano
    CHECK(ProceduralCharacter::BoneCount == 16);
    for (auto& [v, i] : sink.meshes) { CHECK(v > 0); CHECK(i % 3 == 0); }
    CHECK(sink.textures == 1);  // la textura de rayas
}

TEST_CASE("cada combinación de estilos se construye sin errores y con geometría válida") {
    Sink sink;
    Look l;
    size_t built = 0;
    for (const auto& body : data().styles.at("cuerpo"))
        for (const auto& build : data().styles.at("contextura"))
            for (const auto& hair : data().styles.at("pelo"))
                for (const auto& top : data().styles.at("arriba"))
                    for (const auto& head : data().styles.at("cabeza")) {
                        l.cuerpo = body.id; l.contextura = build.id; l.pelo = hair.id; l.arriba = top.id; l.cabeza = head.id;
                        ProceduralCharacter c(l, data(), sink);
                        REQUIRE(c.drawCount() > 0);
                        ++built;
                    }
    CHECK(built == 2 * 3 * 7 * 4 * 5);
    for (auto& [v, i] : sink.meshes) REQUIRE(v > 0);
    size_t beardCases = 0;
    for (const auto& beard : data().styles.at("barba"))
        for (const auto& shoes : data().styles.at("zapatos"))
            for (const auto& bottom : data().styles.at("abajo")) {
                l = Look{};
                l.barba = beard.id; l.zapatos = shoes.id; l.abajo = bottom.id;
                ProceduralCharacter c(l, data(), sink);
                REQUIRE(c.drawCount() > 0);
                ++beardCases;
            }
    CHECK(beardCases == 4 * 3 * 3);
}

TEST_CASE("el pelo rapado o la gorra tapan el pelo y un hombre calvo tiene menos geometría") {
    Sink sink;
    Look hairy, bald, hat;
    hairy.pelo = "crespo"; hairy.cabeza = "nada";
    bald.pelo = "calvo"; bald.cabeza = "nada";
    hat.pelo = "crespo"; hat.cabeza = "gorra";
    ProceduralCharacter a(hairy, data(), sink), b(bald, data(), sink), c(hat, data(), sink);
    CHECK(a.triangleCount() > b.triangleCount());
    CHECK(c.triangleCount() < a.triangleCount() + 3000);  // con gorra el pelo crespo se reduce a 8 bolas
}

TEST_CASE("al caminar las piernas y los brazos se mueven en oposición y vuelven a reposo") {
    Sink sink;
    ProceduralCharacter c(defaultLook(), data(), sink);
    auto footZ = [&](ProceduralCharacter::Bone knee) { return (c.boneWorld(knee) * glm::vec4(0, -0.2f, 0, 1)).z; };
    for (int i = 0; i < 60; ++i) c.update(1.0 / 60, {0, false, {}, i / 60.0});
    const float restA = footZ(ProceduralCharacter::KneeA);
    float minA = 1e9f, maxA = -1e9f, minB = 1e9f, maxB = -1e9f;
    double clock = 1;
    for (int i = 0; i < 180; ++i) {
        c.update(1.0 / 60, {1.4, false, {}, clock += 1.0 / 60});
        minA = std::min(minA, footZ(ProceduralCharacter::KneeA)); maxA = std::max(maxA, footZ(ProceduralCharacter::KneeA));
        minB = std::min(minB, footZ(ProceduralCharacter::KneeB)); maxB = std::max(maxB, footZ(ProceduralCharacter::KneeB));
    }
    CHECK(maxA - minA > 0.15f);
    CHECK(maxB - minB > 0.15f);
    // en oposición: cuando una pierna va adelante la otra va atrás
    c.update(1.0 / 60, {1.4, false, {}, clock});
    for (int i = 0; i < 120; ++i) c.update(1.0 / 60, {0, false, {}, clock += 1.0 / 60});  // se detiene
    CHECK(std::abs(footZ(ProceduralCharacter::KneeA) - restA) < 0.03f);
}

TEST_CASE("acostado al dormir el cuerpo se tumba y la cabeza queda a ras de suelo") {
    Sink sink;
    ProceduralCharacter c(defaultLook(), data(), sink);
    auto headY = [&] { return (c.boneWorld(ProceduralCharacter::Head) * glm::vec4(0, 0, 0, 1)).y; };
    for (int i = 0; i < 30; ++i) c.update(1.0 / 60, {0, false, {}, i / 60.0});
    const float standing = headY();
    for (int i = 0; i < 120; ++i) c.update(1.0 / 60, {0, false, "dormir", i / 60.0});
    CHECK(standing > 1.1f);
    CHECK(headY() < 0.6f);
}

TEST_CASE("el costal solo se dibuja cargado y la ropa se oscurece con la suciedad") {
    Sink sink;
    ProceduralCharacter c(defaultLook(), data(), sink);
    std::vector<SkinnedDraw> clean, loaded, dirty;
    c.update(1.0 / 60, {0, false, {}, 0, 0.0});
    c.collect(glm::mat4(1.0f), false, clean);
    c.update(1.0 / 60, {0, false, {}, 0, 1.0, 0.0});
    c.collect(glm::mat4(1.0f), false, loaded);
    CHECK(loaded.size() == clean.size() + 1);  // aparece el costal
    c.update(1.0 / 60, {0, false, {}, 0, 0.0, 1.0});
    c.collect(glm::mat4(1.0f), false, dirty);
    // la pieza de la camiseta (primera con tinte rojo) es más oscura
    auto litRed = [](const std::vector<SkinnedDraw>& v) { double sum = 0; for (const auto& d : v) if (!d.unlit) sum += d.tint.r; return sum; };
    CHECK(litRed(dirty) < litRed(clean));
    for (const SkinnedDraw& d : clean) { CHECK(d.palette != nullptr); CHECK(d.paletteCount == ProceduralCharacter::BoneCount); }
}

TEST_CASE("los ojos y la boca no reciben luz y la silueta se marca solo si se pide") {
    Sink sink;
    ProceduralCharacter c(defaultLook(), data(), sink);
    std::vector<SkinnedDraw> a, b;
    c.collect(glm::mat4(1.0f), true, a);
    c.collect(glm::mat4(1.0f), false, b);
    int unlit = 0;
    for (const auto& d : a) { CHECK(d.silhouette); unlit += d.unlit; }
    for (const auto& d : b) CHECK_FALSE(d.silhouette);
    CHECK(unlit == 3);  // blanco de los ojos, iris y boca (la pupila sí recibe luz)
}

TEST_CASE("cambiar la apariencia reconstruye la geometría y aplica el tono de piel nuevo") {
    Sink sink;
    ProceduralCharacter c(defaultLook(), data(), sink);
    Look l = defaultLook();
    l.piel = 5;
    l.arriba = "chaqueta";
    c.setLook(l);
    CHECK(c.look().piel == 5);
    std::vector<SkinnedDraw> draws;
    c.collect(glm::mat4(1.0f), false, draws);
    const Rgb dark = rgbFromHex(0x5e3b27);
    bool found = false;
    for (const auto& d : draws) found |= std::abs(d.tint.r - dark.r) < 1e-6 && std::abs(d.tint.g - dark.g) < 1e-6;
    CHECK(found);
}
