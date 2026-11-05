#include <doctest/doctest.h>

#include "core/FrameLoop.h"
#include "core/FrameMetrics.h"

using bazuko::FrameMetrics;

TEST_CASE("FrameMetrics usa intervalos reales y promedio ponderado") {
    FrameMetrics m;
    CHECK_FALSE(m.sample(0));       // la primera muestra solo fija la referencia
    CHECK(m.sample(10));            // 100 fps
    CHECK(m.current() == doctest::Approx(100.0));
    CHECK(m.sample(40));            // 30 ms -> 33.3 fps
    CHECK(m.min() == doctest::Approx(1000.0 / 30.0));
    CHECK(m.max() == doctest::Approx(100.0));
    CHECK(m.average() == doctest::Approx(2 * 1000.0 / 40.0));  // 2 frames en 40 ms
}

TEST_CASE("FrameMetrics ignora tiempos no crecientes y se reinicia al pausar") {
    FrameMetrics m;
    m.sample(100);
    CHECK_FALSE(m.sample(100));
    CHECK_FALSE(m.sample(50, false));  // inactivo: descarta la referencia
    CHECK_FALSE(m.sample(200));
    CHECK(m.sample(216));
    CHECK(m.frameMs() == doctest::Approx(16.0));
    m.reset();
    CHECK(m.average() == 0);
    CHECK(m.max() == 0);
}

TEST_CASE("clampDt limita el paso de simulación a 0.1 s") {
    CHECK(bazuko::clampDt(0.016) == doctest::Approx(0.016));
    CHECK(bazuko::clampDt(0.5) == doctest::Approx(0.1));
    CHECK(bazuko::clampDt(-1.0) == 0.0);
}
