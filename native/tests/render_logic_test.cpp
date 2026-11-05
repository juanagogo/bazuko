#include <doctest/doctest.h>

#include <fstream>

#include <nlohmann/json.hpp>

#include "core/Input.h"
#include "game/CameraRig.h"
#include "game/Lighting.h"
#include "game/PlayerMotor.h"

using namespace bazuko;
using nlohmann::json;

namespace {

const json& ref() {
    static const json j = [] {
        std::ifstream f(std::string(BAZUKO_DATA_DIR) + "/render_reference.json");
        REQUIRE_MESSAGE(f.good(), "falta data/render_reference.json: node tools/export_render.mjs");
        return json::parse(f);
    }();
    return j;
}

constexpr double kEps = 1e-9;
using Approx = doctest::Approx;
Approx near(double v) { return Approx(v).epsilon(kEps).scale(1.0); }

Vec3 vec(const json& a) { return {a[0], a[1], a[2]}; }

void checkRgb(const Rgb& got, const json& want) {
    CHECK(got.r == near(want[0].get<double>()));
    CHECK(got.g == near(want[1].get<double>()));
    CHECK(got.b == near(want[2].get<double>()));
}

Vec3 unit(const Vec3& from, const Vec3& to) {
    Vec3 d{to.x - from.x, to.y - from.y, to.z - from.z};
    const double len = std::sqrt(d.x * d.x + d.y * d.y + d.z * d.z);
    return {d.x / len, d.y / len, d.z / len};
}

CollisionWorld worldFrom(const json& boxes) {
    CollisionWorld w;
    for (const auto& b : boxes) {
        const Vec3 lo = vec(b[0]), hi = vec(b[1]);
        w.add({(lo.x + hi.x) / 2, lo.y, (lo.z + hi.z) / 2}, {hi.x - lo.x, hi.y - lo.y, hi.z - lo.z});
    }
    return w;
}

}  // namespace

// ---------- iluminación ----------

TEST_CASE("el ciclo día/noche coincide con SceneManager.setTimeOfDay a todas las horas") {
    for (const auto& s : ref()["lighting"]) {
        const Lighting l = lightingAt(s["hour"]);
        INFO("hora ", s["hour"]);
        CHECK(l.sunIntensity == near(s["sun"]));
        CHECK(l.hemiIntensity == near(s["hemi"]));
        CHECK(l.envIntensity == near(s["env"]));
        checkRgb(l.sunColor, s["sunColor"]);
        checkRgb(l.background, s["background"]);
        CHECK(l.fogNear == near(s["fogNear"]));
        CHECK(l.fogFar == near(s["fogFar"]));
    }
    const Lighting l = lightingAt(12);
    checkRgb(l.hemiSky, ref()["hemiColors"]["sky"]);
    checkRgb(l.hemiGround, ref()["hemiColors"]["ground"]);
}

TEST_CASE("la noche es oscura, el día claro y la niebla se abre de día") {
    const Lighting night = lightingAt(2), day = lightingAt(12);
    CHECK(day.sunIntensity > night.sunIntensity * 10);
    CHECK(day.background.r > night.background.r);
    CHECK(day.fogFar > night.fogFar);
}

TEST_CASE("la desaturación por ánimo bajo mezcla el fondo hacia gris") {
    for (const auto& s : ref()["desat"]) {
        Lighting l = lightingAt(12);
        applyDesaturation(l, s["d"]);
        checkRgb(l.background, s["background"]);
    }
}

TEST_CASE("el sol queda arriba y hacia +x,+z del jugador") {
    const Vec3 d = sunDirection();
    CHECK(std::sqrt(d.x * d.x + d.y * d.y + d.z * d.z) == Approx(1.0));
    CHECK(d.y > d.x);
    CHECK(d.x > 0);
}

// ---------- cámara ----------

TEST_CASE("la cámara en tercera persona coincide con CameraRig.follow, con y sin paredes") {
    for (const auto& c : ref()["cameras"]) {
        CameraRig rig;
        rig.yaw = c["yaw"];
        rig.pitch = c["pitch"];
        rig.distance = c["distance"];
        const CollisionWorld w = worldFrom(c["boxes"]);
        rig.follow(vec(c["target"]), 1.0 / 60, &w);
        const Vec3 want = vec(c["position"]);
        CHECK(rig.position.x == near(want.x));
        CHECK(rig.position.y == near(want.y));
        CHECK(rig.position.z == near(want.z));
        const Vec3 dir = unit(rig.position, rig.lookAt);
        const Vec3 wd = vec(c["direction"]);
        CHECK(dir.x == near(wd.x));
        CHECK(dir.y == near(wd.y));
        CHECK(dir.z == near(wd.z));
        CHECK(rig.armDistance() == near(c["arm"]));
    }
}

TEST_CASE("el brazo se acorta de inmediato ante una pared y se recupera suavemente") {
    CameraRig rig;
    rig.yaw = 0;
    CollisionWorld w;
    w.add({0, 0, 3}, {10, 12, 2});  // z entre 2 y 4
    rig.follow({0, 0, 0}, 1.0 / 60, &w);
    CHECK(rig.position.z < 1.8);
    const double shortened = rig.armDistance();
    const auto& rec = ref()["recovery"];
    CHECK(shortened == near(rec[0]));
    size_t k = 1;
    for (int i = 0; i < 60; ++i) {
        rig.follow({0, 0, 0}, 1.0 / 60);
        if (i == 0) CHECK((rig.armDistance() > shortened && rig.armDistance() < rig.distance));
        if (i % 10 == 0) CHECK(rig.armDistance() == near(rec[k++]));
    }
    for (int i = 0; i < 180; ++i) rig.follow({0, 0, 0}, 1.0 / 60);
    CHECK(rig.armDistance() == Approx(rig.distance));
    rig.yaw = kPi;  // la pared queda al otro lado
    rig.follow({0, 0, 0}, 0, &w);
    CHECK(rig.armDistance() == Approx(rig.distance));
}

TEST_CASE("la cámara isométrica se coloca de golpe y luego sigue suavizada") {
    CameraRig rig;
    rig.toggle();
    CHECK(rig.mode == CameraMode::Isometric);
    const auto& iso = ref()["iso"];
    rig.follow({40, 0, 22}, 0);
    CHECK(rig.position.x == near(iso[0]["position"][0]));
    CHECK(rig.position.y == near(iso[0]["position"][1]));
    CHECK(rig.position.z == near(iso[0]["position"][2]));
    CHECK(rig.position.x == 52);
    CHECK(rig.position.y == 16);
    CHECK(rig.position.z == 34);
    size_t k = 1;
    for (int i = 0; i < 30; ++i) {
        rig.follow({46 + i * 0.1, 0, 30}, 1.0 / 60);
        if (i % 5 == 0) {
            const Vec3 want = vec(iso[k]["position"]);
            CHECK(rig.position.x == near(want.x));
            CHECK(rig.position.z == near(want.z));
            const Vec3 d = unit(rig.position, rig.lookAt), wd = vec(iso[k]["direction"]);
            CHECK(d.x == near(wd.x));
            CHECK(d.y == near(wd.y));
            ++k;
        }
    }
}

TEST_CASE("giro y zoom respetan sus límites") {
    CameraRig rig;
    const auto& o = ref()["orbit"];
    rig.orbit(100, 100000);
    CHECK(rig.yaw == near(o[0][0]));
    CHECK(rig.pitch == near(o[0][1]));
    rig.orbit(0, -100000);
    CHECK(rig.pitch == near(o[1][1]));
    rig.zoom(100000);
    CHECK(rig.distance == near(o[2][2]));
    rig.zoom(-100000);
    CHECK(rig.distance == near(o[3][2]));
    rig.toggle(kPi / 2);
    rig.toggle(kPi / 2);
    CHECK(rig.yaw == near(o[4][0]));
}

TEST_CASE("las flechas giran la cámara solo en tercera persona") {
    CameraRig rig;
    const double yaw = rig.yaw;
    rig.arrowOrbit(0.1, 1, 0);
    CHECK(rig.yaw == Approx(yaw - 250 * 0.1 * 0.005));
    rig.toggle();
    const double y2 = rig.yaw;
    rig.arrowOrbit(0.1, 1, 1);
    CHECK(rig.yaw == y2);
}

TEST_CASE("al volver a tercera persona la cámara queda detrás del personaje") {
    CameraRig rig;
    rig.toggle();
    rig.follow({40, 0, 22}, 0);
    rig.toggle(kPi / 2);  // el personaje mira hacia +x
    rig.follow({40, 0, 22}, 0);
    CHECK(rig.position.x < 40);
    CHECK(rig.position.z == Approx(22).epsilon(1e-6));
}

// ---------- movimiento ----------

TEST_CASE("WASD y la velocidad coinciden con Player.update en 103 casos") {
    const char* names[] = {"idle", "walk", "run"};
    int n = 0;
    for (const auto& m : ref()["motion"]) {
        CameraRig rig;
        rig.yaw = m["yaw"];
        if (m["mode"] == "isometric") rig.toggle();
        double fx = 0, fz = 0;
        rig.forwardXZ(fx, fz);
        PlayerMotor p;
        p.position = {0, 0, 0};
        const bool run = m["opts"].value("running", false);
        const double mult = m["opts"].value("mult", 1.0);
        p.update(0.1, {m["axis"]["x"], m["axis"]["z"]}, run, rig.mode, fx, fz, mult, nullptr);
        const Vec3 want = vec(m["position"]);
        INFO("modo ", m["mode"].get<std::string>(), " yaw ", m["yaw"].get<double>(), " axis ", m["axis"]["x"].get<int>(), ",", m["axis"]["z"].get<int>(), " opts ", m["opts"].dump());
        ++n;
        CHECK(p.position.x == near(want.x));
        CHECK(p.position.z == near(want.z));
        CHECK(p.rotationY == near(m["rotationY"]));
        CHECK(p.speed == near(m["speed"]));
        CHECK(std::string(names[static_cast<int>(p.state)]) == m["state"].get<std::string>());
    }
}

TEST_CASE("el movimiento respeta las paredes igual que el juego web") {
    CollisionWorld w;
    w.add({2, 0, 2}, {2, 8, 2});
    for (const auto& c : ref()["collide"]) {
        CameraRig rig;
        rig.yaw = kPi;
        double fx, fz;
        rig.forwardXZ(fx, fz);
        PlayerMotor p;
        p.position = vec(c["start"]);
        p.update(0.5, {c["axis"]["x"], c["axis"]["z"]}, true, rig.mode, fx, fz, 1.0, &w);
        const Vec3 want = vec(c["position"]);
        CHECK(p.position.x == near(want.x));
        CHECK(p.position.z == near(want.z));
        CHECK(p.speed == near(c["speed"]));
    }
}

TEST_CASE("en diagonal no se acelera") {
    CameraRig rig;
    double fx, fz;
    rig.forwardXZ(fx, fz);
    PlayerMotor p;
    p.update(0.1, {1, -1}, false, rig.mode, fx, fz, 1.0, nullptr);
    CHECK(std::hypot(p.position.x - 16, p.position.z - 16) == Approx(0.3));
}

// ---------- teclado ----------

TEST_CASE("Input: eje, correr y pulsaciones de un solo uso") {
    Input in;
    in.setKey(Key::W, true);
    in.setKey(Key::D, true);
    CHECK(in.axis().x == 1);
    CHECK(in.axis().z == -1);
    in.setKey(Key::A, true);
    CHECK(in.axis().x == 0);  // A y D se anulan
    CHECK_FALSE(in.isRunning());
    in.setKey(Key::ShiftRight, true);
    CHECK(in.isRunning());

    in.setKey(Key::E, true);
    CHECK(in.consumePress(Key::E));
    CHECK_FALSE(in.consumePress(Key::E));  // una sola vez
    in.setKey(Key::E, true);               // mantener pulsada no repite
    CHECK_FALSE(in.consumePress(Key::E));
    in.setKey(Key::E, false);
    in.setKey(Key::E, true);
    CHECK(in.consumePress(Key::E));

    in.setKey(Key::V, true);
    in.endFrame();
    CHECK_FALSE(in.consumePress(Key::V));
    CHECK(in.isDown(Key::V));
    in.releaseAll();
    CHECK_FALSE(in.isDown(Key::V));
    CHECK(in.axis().x == 0);
}
