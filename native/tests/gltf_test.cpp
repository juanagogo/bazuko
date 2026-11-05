#include <doctest/doctest.h>

#include <stdexcept>

#include "character/Gltf.h"

using namespace bazuko;
using Approx = doctest::Approx;

static std::string models(const char* rel) { return std::string(BAZUKO_MODELS_DIR) + "/" + rel; }

TEST_CASE("carga el cuerpo adulto: 52 huesos, 4 mallas, texturas WebP y el atributo _VID") {
    const GltfModel m = loadGltf(models("personaje/hombre-adulto/cuerpo.gltf"));
    CHECK(m.nodes.size() == 57);
    REQUIRE(m.skins.size() == 1);
    CHECK(m.skins[0].joints.size() == 52);
    CHECK(m.skins[0].inverseBind.size() == 52);
    CHECK(m.meshes.size() == 4);
    REQUIRE(m.roots.size() == 1);
    CHECK(m.nodes[m.roots[0]].name == "personaje");

    const GltfPrimitive& body = m.meshes[0].primitives[0];
    CHECK(body.vertexCount() == 14517);
    CHECK(body.indices.size() == 80268);
    CHECK(body.vertexIds.size() == 14517);   // atributo propio _VID
    CHECK(body.joints.size() == 14517 * 4);
    CHECK(body.weights.size() == 14517 * 4);
    for (size_t v = 0; v < body.vertexCount(); v += 97) {
        const float* w = &body.weights[v * 4];
        CHECK(w[0] + w[1] + w[2] + w[3] == Approx(1.0f).epsilon(1e-3));
        for (int k = 0; k < 4; ++k) CHECK(body.joints[v * 4 + k] < 52);
    }
    for (auto i : body.indices) REQUIRE(i < body.vertexCount());

    // materiales: cuerpo opaco, cejas y pestañas con mezcla alfa, todos de doble cara con textura
    REQUIRE(m.materials.size() == 4);
    CHECK(m.materials[0].alpha == GltfMaterial::Alpha::Opaque);
    CHECK(m.materials[1].alpha == GltfMaterial::Alpha::Blend);
    for (const auto& mat : m.materials) {
        CHECK(mat.doubleSided);
        REQUIRE(mat.baseColorImage >= 0);
        const Image& img = m.images[mat.baseColorImage];
        CHECK(img.width > 0);
        CHECK(img.rgba.size() == static_cast<size_t>(img.width) * img.height * 4);
    }
}

TEST_CASE("los nodos conservan la jerarquía y la pose de reposo de la cadera") {
    const GltfModel m = loadGltf(models("personaje/hombre-adulto/cuerpo.gltf"), {false});
    const int hips = m.findNode("mixamorig:Hips");
    REQUIRE(hips >= 0);
    CHECK(m.nodes[hips].isJoint);
    CHECK(m.nodes[hips].translation.y == Approx(0.9423022f).epsilon(1e-5));
    CHECK(m.nodes[hips].rotation.w == Approx(0.9963568f).epsilon(1e-5));  // w, x, y, z
    CHECK(m.nodes[hips].children.size() == 3);
    CHECK(m.nodes[m.nodes[hips].parent].name == "personaje");
    CHECK(m.findNode("no-existe") == -1);
    CHECK(m.images.empty());  // sin cargar imágenes
}

TEST_CASE("la versión liviana tiene el mismo esqueleto con mucha menos geometría") {
    const GltfModel full = loadGltf(models("personaje/hombre-adulto/cuerpo.gltf"), {false});
    const GltfModel lod = loadGltf(models("personaje/hombre-adulto/lod/cuerpo.gltf"), {false});
    CHECK(lod.skins[0].joints.size() == 52);
    CHECK(lod.meshes[0].primitives[0].vertexCount() == 1914);
    CHECK(lod.meshes[0].primitives[0].vertexCount() * 7 < full.meshes[0].primitives[0].vertexCount());
    for (const GltfNode& n : full.nodes)
        if (n.isJoint) CHECK(lod.findNode(n.name) >= 0);
}

TEST_CASE("carga las animaciones de prueba de Mixamo") {
    const GltfModel a = loadGltf(models("animaciones-prueba.glb"), {false});
    REQUIRE(a.animations.size() == 4);
    std::vector<std::string> names;
    for (const auto& anim : a.animations) {
        names.push_back(anim.name);
        CHECK(anim.channels.size() == 156);
        CHECK(anim.duration > 0);
        if (anim.name != "TPose") CHECK(anim.duration > 0.5);  // la TPose es un solo fotograma
    }
    CHECK(names == std::vector<std::string>{"Idle", "Run", "TPose", "Walk"});
    // el origen es el "Character" girado -90° en X y escalado 0,01 (centímetros, Z arriba)
    const GltfNode& root = a.nodes[a.roots[0]];
    CHECK(root.name == "Character");
    CHECK(root.scale.x == Approx(0.01f));
    CHECK(root.rotation.x == Approx(-0.7071068f).epsilon(1e-5));
    CHECK(a.findNode("mixamorig:Hips") >= 0);
}

TEST_CASE("una ruta inexistente lanza excepción") {
    CHECK_THROWS_AS(loadGltf(models("personaje/no-existe.gltf")), std::runtime_error);
}

TEST_CASE("todas las piezas del catálogo se cargan: 6 cuerpos con ropa, pelo, barba y calzado") {
    size_t files = 0;
    for (const char* body : {"hombre-joven", "hombre-adulto", "hombre-mayor", "mujer-joven", "mujer-adulta", "mujer-mayor"}) {
        const GltfModel c = loadGltf(models((std::string("personaje/") + body + "/cuerpo.gltf").c_str()), {false});
        CHECK(c.skins[0].joints.size() == 52);
        ++files;
    }
    CHECK(files == 6);
    const GltfModel jacket = loadGltf(models("personaje/hombre-adulto/chaqueta.gltf"), {false});
    CHECK(jacket.skins[0].joints.size() == 52);
    CHECK(jacket.meshes[0].primitives[0].vertexCount() > 1000);
}
