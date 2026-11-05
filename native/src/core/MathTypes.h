#pragma once

#include <cmath>
#include <cstdint>

#include "core/Rng.h"

namespace bazuko {

struct Vec3 {
    double x = 0, y = 0, z = 0;
};

inline double distance2D(const Vec3& a, const Vec3& b) { return std::hypot(a.x - b.x, a.z - b.z); }

// Math.round de JavaScript: las mitades suben (2.5 -> 3, -2.5 -> -2).
inline double jsRound(double v) { return std::floor(v + 0.5); }

constexpr double kPi = 3.14159265358979323846;

// Color RGB en espacio lineal (como el espacio de trabajo de three.js).
struct Rgb {
    double r = 0, g = 0, b = 0;
};

inline double srgbToLinear(double c) { return c <= 0.04045 ? c * 0.0773993808 : std::pow(c * 0.9478672986 + 0.0521327014, 2.4); }
inline double linearToSrgb(double c) { return c <= 0.0031308 ? c * 12.92 : 1.055 * std::pow(c, 0.41666) - 0.055; }

// Color desde 0xRRGGBB interpretado como sRGB, convertido a lineal.
inline Rgb rgbFromHex(std::uint32_t hex) {
    return {srgbToLinear(((hex >> 16) & 255) / 255.0), srgbToLinear(((hex >> 8) & 255) / 255.0),
            srgbToLinear((hex & 255) / 255.0)};
}
inline Rgb toSrgb(const Rgb& c) { return {linearToSrgb(c.r), linearToSrgb(c.g), linearToSrgb(c.b)}; }
inline Rgb lerp(const Rgb& a, const Rgb& b, double t) {
    return {a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t};
}
inline double clamp01(double v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

// Igual que mulberry32 de textures.js: permite reproducir en C++ las secuencias del juego web.
class Mulberry32Rng : public Rng {
public:
    explicit Mulberry32Rng(std::uint32_t seed) : s_(seed) {}
    double next() override {
        s_ += 0x6d2b79f5u;
        std::uint32_t t = (s_ ^ (s_ >> 15)) * (1u | s_);
        t = (t + (t ^ (t >> 7)) * (61u | t)) ^ t;
        return static_cast<double>(t ^ (t >> 14)) / 4294967296.0;
    }

private:
    std::uint32_t s_;
};

}  // namespace bazuko
