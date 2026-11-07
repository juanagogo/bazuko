#include <doctest/doctest.h>

#include <algorithm>
#include <cmath>
#include <memory>

#include "character/Animator.h"
#include "character/Retarget.h"

using namespace bazuko;
using Approx = doctest::Approx;

namespace {

std::string models(const char* rel) { return std::string(BAZUKO_MODELS_DIR) + "/" + rel; }

struct Fixture {
    GltfModel body = loadGltf(models("personaje/hombre-adulto/cuerpo.gltf"), {false});
    GltfModel lodBody = loadGltf(models("personaje/hombre-adulto/lod/cuerpo.gltf"), {false});
    GltfModel anims = loadGltf(models("animaciones-prueba.glb"), {false});
    Rig src = Rig::fromGltf(anims);
    Rig tgt = Rig::fromGltf(body);
    Retargeter retargeter{src, tgt};
    std::map<std::string, std::shared_ptr<const Clip>> clips;
    Fixture() {
        for (const GltfAnimation& a : anims.animations) {
            std::string name = a.name;
            for (char& c : name) c = static_cast<char>(std::tolower(c));
            clips[name] = std::make_shared<Clip>(retargeter.retarget(a));
        }
    }
};

Fixture& fx() {
    static Fixture f;
    return f;
}

float angleBetween(const glm::quat& a, const glm::quat& b) { return 2 * std::acos(std::min(1.0f, std::abs(glm::dot(a, b)))); }

}  // namespace

TEST_CASE("el esqueleto tiene 52 huesos Mixamo y se puede recorrer padres antes que hijos") {
    const Rig& r = fx().tgt;
    CHECK(r.bones.size() == 52);
    CHECK(r.boneIndex("mixamorig:Hips") >= 0);
    CHECK(r.boneIndex("mixamorig:LeftUpLeg") >= 0);
    CHECK(r.boneIndex("nada") == -1);
    std::vector<bool> seen(r.nodes.size(), false);
    for (int i : r.preorder) {
        if (r.nodes[i].parent >= 0) CHECK(seen[r.nodes[i].parent]);
        seen[i] = true;
    }
    for (bool s : seen) CHECK(s);
}

TEST_CASE("el origen de Mixamo y el cuerpo comparten los nombres de hueso") {
    const Rig& s = fx().src;
    const Rig& t = fx().tgt;
    int shared = 0;
    for (const auto& [name, idx] : t.bones) shared += s.boneIndex(name) >= 0;
    CHECK(shared >= 48);  // el destino tiene 52 y el origen 49-52
}

TEST_CASE("la pose de reposo da la cadera a ~0,94 m y los pies cerca del suelo") {
    const Rig& r = fx().body.nodes.empty() ? fx().tgt : fx().tgt;
    GltfModel fresh = loadGltf(models("personaje/hombre-adulto/cuerpo.gltf"), {false});
    Rig rest = Rig::fromGltf(fresh);
    Pose p(rest);
    CHECK(p.worldPosition(rest.boneIndex("mixamorig:Hips")).y == Approx(0.9423).epsilon(0.01));
    CHECK(p.worldPosition(rest.boneIndex("mixamorig:LeftFoot")).y < 0.25);
    (void)r;
}

TEST_CASE("retarget: todos los huesos reciben rotaciones unitarias a 30 fps") {
    for (const char* name : {"idle", "walk", "run"}) {
        const Clip& c = *fx().clips.at(name);
        CHECK(c.duration > 0.5);
        CHECK(c.times.size() == static_cast<size_t>(std::lround(c.duration * 30)) + 1);
        CHECK(c.times.front() == 0);
        CHECK(c.times.back() == Approx(static_cast<float>(c.duration)).epsilon(1e-4));
        int animated = 0;
        for (size_t n = 0; n < fx().tgt.nodes.size(); ++n) {
            if (!fx().tgt.nodes[n].isBone) { CHECK_FALSE(c.animates(static_cast<int>(n))); continue; }
            REQUIRE(c.animates(static_cast<int>(n)));
            ++animated;
            for (const glm::quat& q : c.rotation[n]) REQUIRE(glm::length(q) == Approx(1.0f).epsilon(1e-3));
        }
        CHECK(animated == 52);
    }
}

TEST_CASE("retarget de un clip sin canales deja el cuerpo en su pose de reposo") {
    GltfModel body = loadGltf(models("personaje/hombre-adulto/cuerpo.gltf"), {false});
    Rig tgt = Rig::fromGltf(body);
    Retargeter rt(fx().src, tgt);
    GltfAnimation empty;
    empty.name = "vacia";
    empty.duration = 1;
    const Clip clip = rt.retarget(empty);
    // sin animar, cada hueso con contraparte queda con exactamente su rotación de reposo emparejada
    int checked = 0;
    for (const auto& [name, idx] : tgt.bones) {
        if (fx().src.boneIndex(name) < 0) continue;
        CHECK(angleBetween(clip.rotation[idx][0], tgt.nodes[idx].rotation) < 1e-3f);
        ++checked;
    }
    CHECK(checked >= 48);
}

TEST_CASE("al caminar los pies avanzan y retroceden, y la cadera se mantiene a su altura") {
    const Clip& walk = *fx().clips.at("walk");
    const Rig& rig = fx().tgt;
    Pose p(rig);
    const int lf = rig.boneIndex("mixamorig:LeftFoot"), rf = rig.boneIndex("mixamorig:RightFoot"), hips = rig.boneIndex("mixamorig:Hips");
    float minZ = 1e9f, maxZ = -1e9f, minY = 1e9f, hipMin = 1e9f, hipMax = -1e9f;
    float sumL = 0, sumR = 0;
    int n = 0;
    for (double t = 0; t < walk.duration; t += 1.0 / 30) {
        for (size_t i = 0; i < rig.nodes.size(); ++i)
            if (walk.animates(static_cast<int>(i))) p.rotation[i] = walk.sample(static_cast<int>(i), t);
        p.update();
        const glm::vec3 l = p.worldPosition(lf), r = p.worldPosition(rf), h = p.worldPosition(hips);
        minZ = std::min({minZ, l.z, r.z});
        maxZ = std::max({maxZ, l.z, r.z});
        minY = std::min({minY, l.y, r.y});
        hipMin = std::min(hipMin, h.y);
        hipMax = std::max(hipMax, h.y);
        sumL += l.z; sumR += r.z; ++n;
    }
    CHECK(maxZ - minZ > 0.4f);      // zancada de más de 40 cm de amplitud
    CHECK(minY > -0.1f);            // los pies no se hunden en el suelo
    CHECK(hipMin > 0.7f);           // la cadera no cae
    CHECK(hipMax - hipMin < 0.2f);  // y solo rebota un poco
    CHECK(std::abs(sumL / n) < 0.3f);  // en el sitio: la animación no desplaza al personaje
}

TEST_CASE("el personaje retargeteado camina de frente: los pies oscilan a lo largo de +Z") {
    const Clip& walk = *fx().clips.at("walk");
    const Rig& rig = fx().tgt;
    Pose p(rig);
    const int lf = rig.boneIndex("mixamorig:LeftFoot");
    float zRange = 0, xRange = 0, zMin = 1e9f, zMax = -1e9f, xMin = 1e9f, xMax = -1e9f;
    for (double t = 0; t < walk.duration; t += 1.0 / 30) {
        for (size_t i = 0; i < rig.nodes.size(); ++i)
            if (walk.animates(static_cast<int>(i))) p.rotation[i] = walk.sample(static_cast<int>(i), t);
        p.update();
        const glm::vec3 pos = p.worldPosition(lf);
        zMin = std::min(zMin, pos.z); zMax = std::max(zMax, pos.z);
        xMin = std::min(xMin, pos.x); xMax = std::max(xMax, pos.x);
    }
    zRange = zMax - zMin;
    xRange = xMax - xMin;
    CHECK(zRange > xRange * 2);  // la zancada es hacia adelante/atrás, no de lado
}

// ---------- mezcla ----------

TEST_CASE("el animador empieza en idle y los pesos sumados siempre dan 1") {
    Animator a(fx().tgt, fx().clips);
    CHECK(a.weight("idle") == 1);
    CHECK(a.weight("walk") == 0);
    for (int i = 0; i < 100; ++i) {
        a.update(1.0 / 60, {i < 50 ? 1.4 : 4.0, i >= 50, ""});
        double sum = 0;
        for (const char* c : {"idle", "walk", "run"}) sum += a.weight(c);
        REQUIRE(sum == Approx(1.0).epsilon(1e-9));
    }
    CHECK(a.weight("run") > 0.9);
}

TEST_CASE("el animador pasa de idle a caminar y a correr según la velocidad") {
    Animator a(fx().tgt, fx().clips);
    for (int i = 0; i < 60; ++i) a.update(1.0 / 30, {0, false, ""});
    CHECK(a.weight("idle") > 0.99);
    for (int i = 0; i < 60; ++i) a.update(1.0 / 30, {1.4, false, ""});
    CHECK(a.weight("walk") > 0.99);
    for (int i = 0; i < 60; ++i) a.update(1.0 / 30, {4, true, ""});
    CHECK(a.weight("run") > 0.99);
    for (int i = 0; i < 60; ++i) a.update(1.0 / 30, {4, false, ""});  // sin Shift camina aunque vaya rápido
    CHECK(a.weight("walk") > 0.99);
}

TEST_CASE("la velocidad de los clips sigue a la del personaje con sus límites") {
    Animator a(fx().tgt, fx().clips);
    const double walk0 = a.time("walk");
    a.update(0.1, {5.6, false, ""});  // speed/1.4 = 4 -> tope 1,6
    CHECK(a.time("walk") - walk0 == Approx(0.1 * 1.6).epsilon(1e-6));
    Animator b(fx().tgt, fx().clips);
    b.update(0.1, {0.2, false, ""});  // 0,2/1,4 = 0,14 -> mínimo 0,6
    CHECK(b.time("walk") == Approx(0.1 * 0.6).epsilon(1e-6));
}

TEST_CASE("las acciones sin clip caen en idle") {
    Animator a(fx().tgt, fx().clips);
    CHECK_FALSE(a.hasClip("buscar"));
    for (int i = 0; i < 60; ++i) a.update(1.0 / 30, {0, false, "buscar"});
    CHECK(a.weight("idle") > 0.99);
}

TEST_CASE("la pose del animador es continua y mueve las piernas al caminar") {
    Animator a(fx().tgt, fx().clips);
    const Rig& rig = fx().tgt;
    const int lf = rig.boneIndex("mixamorig:LeftFoot");
    for (int i = 0; i < 60; ++i) a.update(1.0 / 30, {1.4, false, ""});  // se estabiliza en walk
    glm::vec3 prev = a.pose().worldPosition(lf);
    float zMin = 1e9f, zMax = -1e9f, maxStep = 0;
    for (int i = 0; i < 90; ++i) {
        a.update(1.0 / 60, {1.4, false, ""});
        const glm::vec3 pos = a.pose().worldPosition(lf);
        maxStep = std::max(maxStep, glm::length(pos - prev));
        prev = pos;
        zMin = std::min(zMin, pos.z); zMax = std::max(zMax, pos.z);
    }
    CHECK(zMax - zMin > 0.3f);
    CHECK(maxStep < 0.1f);  // sin saltos entre cuadros (un pie en balanceo recorre ~6 cm en 1/60 s)
}

TEST_CASE("el esqueleto liviano acepta las mismas animaciones") {
    Rig lodRig = Rig::fromGltf(fx().lodBody);
    Retargeter rt(fx().src, lodRig);
    const Clip walk = rt.retarget(fx().anims.animations[3]);
    CHECK(walk.name == "Walk");
    CHECK(walk.rotation[lodRig.boneIndex("mixamorig:Hips")].size() > 10);
}
