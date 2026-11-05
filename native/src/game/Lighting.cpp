#include "game/Lighting.h"

#include <algorithm>
#include <cmath>

namespace bazuko {

namespace {
double smoothstep(double x, double lo, double hi) {
    if (x <= lo) return 0;
    if (x >= hi) return 1;
    x = (x - lo) / (hi - lo);
    return x * x * (3 - 2 * x);
}
}  // namespace

Lighting lightingAt(double hour) {
    static const Rgb kDay = rgbFromHex(0x9aa5b1);  // nublado bogotano
    static const Rgb kNight = rgbFromHex(0x0b0f18);
    static const Rgb kDusk = rgbFromHex(0xff9a55);
    static const Rgb kDuskSky = rgbFromHex(0xc07a5a);
    static const Rgb kSun = rgbFromHex(0xffe8cc);

    const double day = smoothstep(hour, 5.5, 7.5) * (1 - smoothstep(hour, 17.5, 19.5));
    const double dusk = std::max(0.0, 1 - std::abs(hour - 18.3) / 1.3) + std::max(0.0, 1 - std::abs(hour - 6) / 1);
    Lighting l;
    l.sunIntensity = 0.1 + day * 2.2;
    l.hemiIntensity = 0.25 + day * 0.9;
    l.envIntensity = 0.12 + day * 0.55;
    l.sunColor = lerp(kSun, kDusk, std::min(1.0, dusk) * 0.6);
    l.background = lerp(lerp(kNight, kDay, day), kDuskSky, std::min(1.0, dusk) * 0.35);
    l.fogNear = 35 + day * 25;
    l.fogFar = 110 + day * 60;
    l.hemiSky = rgbFromHex(0x556070);
    l.hemiGround = rgbFromHex(0x0a0a0a);
    return l;
}

void applyDesaturation(Lighting& l, double d) {
    if (d <= 0) return;
    const Rgb& c = l.background;
    const double gray = (c.r + c.g + c.b) / 3;
    l.background = lerp(c, {gray, gray, gray}, d);
}

Vec3 sunDirection() {
    const double len = std::sqrt(30.0 * 30 + 60.0 * 60 + 18.0 * 18);
    return {30 / len, 60 / len, 18 / len};
}

}  // namespace bazuko
