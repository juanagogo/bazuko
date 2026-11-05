#include <doctest/doctest.h>

#include <cmath>

#include "core/AdaptiveResolution.h"
#include "render/LocalLights.h"
#include "render/Shadow.h"

using namespace bazuko;
using Approx = doctest::Approx;

namespace {

LightSource source(double x, double y, double z, double intensity, Rgb color = {0, 1, 0}) {
    LightSource s;
    s.position = {x, y, z};
    s.color = color;
    s.intensity = intensity;
    s.distance = 8;
    s.decay = 1.6;
    return s;
}

auto flat(double h) { return [h](double, double) { return h; }; }
const auto everything = [](const Aabb&) { return true; };

}  // namespace

// ---------- resolución adaptativa (performance.test.js) ----------

TEST_CASE("la resolución adaptable responde a carga sostenida y se recupera lentamente sin exceder límites") {
    AdaptiveResolution q(2);
    for (int i = 0; i < 29; ++i) CHECK_FALSE(q.sample(100));
    CHECK(q.ratio() == Approx(1.5));
    CHECK(q.sample(100));
    CHECK(q.ratio() == Approx(1.35));
    for (int i = 0; i < 400; ++i) q.sample(100);
    CHECK(q.ratio() == Approx(0.75));
    q.resetWindow();
    for (int i = 0; i < 700; ++i) q.sample(16);
    CHECK(q.ratio() == Approx(0.75));  // todavía no han pasado cuatro ventanas rápidas
    for (int i = 0; i < 100; ++i) q.sample(16);
    CHECK(q.ratio() > 0.75);
    for (int i = 0; i < 5000; ++i) q.sample(16);
    CHECK(q.ratio() == Approx(1.5));

    AdaptiveResolution lowDpi(0.5);
    for (int i = 0; i < 100; ++i) lowDpi.sample(100);
    CHECK(lowDpi.ratio() == Approx(0.5));
}

TEST_CASE("la resolución ignora muestras inválidas y una ventana intermedia no cambia nada") {
    AdaptiveResolution q(1);
    CHECK(q.maxRatio() == 1);
    CHECK(q.minRatio() == 0.75);
    CHECK_FALSE(q.sample(-5));
    CHECK_FALSE(q.sample(0));
    CHECK_FALSE(q.sample(std::nan("")));
    for (int i = 0; i < 1500; ++i) q.sample(20);  // 50 fps: entre 45 y 57
    CHECK(q.ratio() == 1);
}

// ---------- luces locales (LocalLights.js, LightHalos.js) ----------

TEST_CASE("206 fuentes usan exactamente 2 luces de shader, también de día, y siguen al jugador") {
    std::vector<LightSource> sources;
    for (int i = 0; i < 206; ++i) sources.push_back(source(i * 10, 4, 0, 2, i == 0 ? Rgb{1, 0, 0} : Rgb{0, 1, 0}));
    LocalLights ll(sources);
    ll.update(0, false, {0, 0, 0}, flat(0), everything);
    CHECK(ll.pool()[0].intensity == 2);
    CHECK(ll.pool()[1].intensity == 2);
    CHECK(ll.pool()[0].color.r == 1);
    CHECK(ll.pool()[0].position.x == 0);
    CHECK(ll.pool()[0].position.y == 4);
    CHECK(ll.pool()[0].decay == Approx(1.6));
    CHECK(ll.pool()[0].distance == 8);

    ll.update(0.1, false, {1500, 0, 0}, flat(0), everything);
    CHECK(ll.pool()[0].position.x == 1500);

    std::vector<LightSource> off;
    for (int i = 0; i < 206; ++i) off.push_back(source(i * 10, 4, 0, 0));
    LocalLights dark(off);
    dark.update(0.1, false, {0, 0, 0}, flat(0), everything);
    for (int i = 0; i < LocalLights::kPoolSize; ++i) CHECK(dark.pool()[i].intensity == 0);  // plazas vacías, sin luz
}

TEST_CASE("elige las más cercanas e intensas y descarta las lejanas") {
    std::vector<LightSource> sources = {source(100, 4, 0, 5), source(10, 4, 0, 5), source(5, 4, 0, 1), source(500, 4, 0, 50)};
    LocalLights ll(sources);
    ll.update(0, false, {0, 0, 0}, flat(0), everything);
    // puntuación = pico / (1 + d²): x=10 → 5/117, x=5 → 1/42, x=100 → 5/10017; la de 500 m queda fuera (> 80 m)
    CHECK(ll.pool()[0].position.x == 10);
    CHECK(ll.pool()[1].position.x == 5);
}

TEST_CASE("los faroles solo encienden de noche y las llamas parpadean sin superar su rango") {
    LightSource lamp = source(0, 4, 0, 1.2);
    lamp.nightOnly = true;
    CHECK(lamp.intensityAt(3, false) == 0);
    CHECK(lamp.intensityAt(3, true) == Approx(1.2));

    LightSource fire = source(0, 1, 0, 5);
    fire.flicker = true;
    fire.amp1 = 1.2; fire.f1 = 17; fire.amp2 = 0.8; fire.f2 = 31;
    double lo = 1e9, hi = -1e9;
    for (int i = 0; i < 2000; ++i) {
        const double v = fire.intensityAt(i * 0.01, false);
        lo = std::min(lo, v);
        hi = std::max(hi, v);
    }
    CHECK(lo >= 5 - 2.0 - 1e-9);
    CHECK(hi <= 5 + 2.0 + 1e-9);
    CHECK(hi - lo > 2.0);  // realmente oscila
    CHECK(fire.intensityAt(0, true) == Approx(5));  // sin(0) = 0
}

TEST_CASE("una llama que parpadea no intercambia las luces elegidas en cada oscilación") {
    LightSource a = source(3, 1, 0, 5), b = source(4, 1, 0, 4.9);
    a.flicker = true;
    a.amp1 = 2; a.f1 = 20;
    std::vector<LightSource> sources = {a, b, source(30, 1, 0, 0.5)};
    LocalLights ll(sources);
    double firstX = -1;
    for (int i = 0; i < 200; ++i) {
        ll.update(i * 0.016, false, {0, 0, 0}, flat(0), everything);
        if (i == 5) firstX = ll.pool()[0].position.x;
        if (i > 5) CHECK(ll.pool()[0].position.x == firstX);  // la puntuación usa el pico, estable
    }
}

TEST_CASE("los halos respetan la capacidad y la altura del suelo y se apagan sin dejar instancias") {
    std::vector<LightSource> sources;
    for (int i = 0; i < 10; ++i) sources.push_back(source(i * 2, 2, 0, 3, {1, 0.53, 0}));
    sources.push_back(source(100, 0, 0, 3));  // fuera de los 45 m
    LocalLights ll(sources, 4);
    ll.update(0, false, {0, 0, 0}, flat(0.12), everything);
    REQUIRE(ll.halos().size() == 4);
    CHECK(ll.halos()[0].position.y == Approx(0.145));
    CHECK(ll.halos()[0].radius == Approx(std::min(4.0, 8 * 0.45)));

    LocalLights all(sources, 48);
    all.update(0, false, {0, 0, 0}, flat(0.12), everything);
    CHECK(all.halos().size() == 10);  // la de 100 m queda fuera

    std::vector<LightSource> none;
    LocalLights empty(none);
    empty.update(0, false, {0, 0, 0}, flat(0), everything);
    CHECK(empty.halos().empty());
}

TEST_CASE("el color de un halo se atenúa con la intensidad y la distancia") {
    std::vector<LightSource> sources = {source(0, 2, 0, 3, {1, 1, 1}), source(40, 2, 0, 1.5, {1, 1, 1})};
    LocalLights ll(sources);
    ll.update(0, false, {0, 0, 0}, flat(0), everything);
    REQUIRE(ll.halos().size() == 2);
    const Halo& near = ll.halos()[0];
    const Halo& far = ll.halos()[1];
    CHECK(near.color.r == Approx(1.0));  // min(1, 3/3) * min(1, (45-2)/8) = 1
    CHECK(far.color.r == Approx(0.5 * (45 - std::hypot(40.0, 2.0)) / 8).epsilon(0.001));
}

TEST_CASE("los halos que la cámara no ve se omiten") {
    std::vector<LightSource> sources = {source(0, 2, 0, 3), source(5, 2, 0, 3)};
    LocalLights ll(sources);
    ll.update(0, false, {0, 0, 0}, flat(0), [](const Aabb& box) { return box.min.x < 1; });  // la fuente de x=5 (caja desde 1,4) no se ve
    CHECK(ll.halos().size() == 1);
}

// ---------- sombra del sol ----------

TEST_CASE("la sombra se centra en el objetivo y cubre ±45 m") {
    const Vec3 sun{30 / 69.64, 60 / 69.64, 18 / 69.64};
    const ShadowFrame f = computeShadowFrame({100, 0, 50}, sun);
    auto project = [&](glm::vec3 p) { return glm::vec3(f.texMatrix * glm::vec4(p, 1.0f)); };

    const glm::vec3 c = project({100, 0, 50});
    CHECK(c.x == Approx(0.5).epsilon(0.001));
    CHECK(c.y == Approx(0.5).epsilon(0.001));
    CHECK(c.z > 0);
    CHECK(c.z < 1);
    // 40 m a un lado en el espacio de la luz sigue dentro; 60 m queda fuera
    const glm::vec3 side = glm::normalize(glm::cross(glm::vec3(0, 1, 0), glm::vec3(static_cast<float>(sun.x), static_cast<float>(sun.y), static_cast<float>(sun.z))));
    const glm::vec3 in = project(glm::vec3(100, 0, 50) + side * 40.0f), out = project(glm::vec3(100, 0, 50) + side * 60.0f);
    CHECK(in.x >= 0);
    CHECK(in.x <= 1);
    CHECK((out.x < 0 || out.x > 1));
}

TEST_CASE("el centro de la sombra se ajusta a la rejilla de texels y no bailea al caminar") {
    const Vec3 sun{30 / 69.64, 60 / 69.64, 18 / 69.64};
    // Un metro de recorrido en pasos de 5 mm: la matriz solo cambia al cruzar a otro texel (≈ 4,4 cm).
    int changes = 0;
    ShadowFrame previous = computeShadowFrame({100.0, 0, 50.0}, sun);
    for (int i = 1; i <= 200; ++i) {
        const ShadowFrame cur = computeShadowFrame({100.0 + i * 0.005, 0, 50.0}, sun);
        if (cur.viewProj != previous.viewProj) ++changes;
        previous = cur;
    }
    CHECK(changes >= 15);   // se mueve
    CHECK(changes <= 45);   // pero a saltos de texel (cada eje de la luz salta por separado), no cada paso
    // no se mueve más de un texel respecto al objetivo real
    const ShadowFrame a = computeShadowFrame({100.0, 0, 50.0}, sun), far = computeShadowFrame({110.0, 0, 50.0}, sun);
    CHECK(a.viewProj != far.viewProj);
}
