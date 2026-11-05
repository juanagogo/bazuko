#pragma once
// Moto urbana de 125 cc del original (src/world/bogota/motos.js): tanque, asiento y colin de volumen, motor con cilindro inclinado,
// escape, horquilla, faro, manubrio con espejos y ruedas de radios. Frente +X, apoyada sobre el suelo; la pintura es el color dado.
#include "SignalModel.hpp"

#include <vector>

namespace Bazuko::MotoModel {

// los siete colores de pintura del original
inline constexpr glm::vec3 kPaints[7] = {{0.76f, 0.11f, 0.10f}, {0.10f, 0.11f, 0.125f}, {0.90f, 0.90f, 0.89f}, {0.11f, 0.25f, 0.48f},
                                         {0.43f, 0.45f, 0.47f}, {0.73f, 0.54f, 0.10f}, {0.125f, 0.15f, 0.17f}};

inline std::shared_ptr<Mesh> Build(const glm::vec3& paintRgb) {
    SignalModel::Builder b;
    const glm::vec4 paint(paintRgb, 1.0f), dark(0.08f, 0.08f, 0.09f, 1.0f), rubber(0.03f, 0.03f, 0.035f, 1.0f), steel(0.62f, 0.64f, 0.66f, 1.0f);
    const glm::vec4 seat(0.03f, 0.03f, 0.033f, 1.0f), engine(0.03f, 0.03f, 0.033f, 1.0f), alu(0.30f, 0.31f, 0.32f, 1.0f), exhaust(0.45f, 0.44f, 0.42f, 1.0f);

    // cuerpo inflado: el contorno al centro y encogido a cada lado
    const auto pillow = [&](const std::vector<glm::vec2>& points, float halfWidth, float shrink, const glm::vec4& color) {
        glm::vec2 c(0.0f);
        for (const glm::vec2& p : points) c += p;
        c /= static_cast<float>(points.size());
        const size_t n = points.size();
        for (size_t i = 0; i < n; ++i) {
            const size_t j = (i + 1) % n;
            const glm::vec2 a = c + (points[i] - c) * shrink, bb = c + (points[j] - c) * shrink;
            for (float side : {1.0f, -1.0f}) b.Quad({a.x, a.y, side * halfWidth}, {bb.x, bb.y, side * halfWidth}, {points[j].x, points[j].y, 0.0f}, {points[i].x, points[i].y, 0.0f}, color);
        }
        for (size_t i = 1; i + 1 < n; ++i)
            for (float side : {1.0f, -1.0f}) {
                const glm::vec2 p0 = c + (points[0] - c) * shrink, p1 = c + (points[i] - c) * shrink, p2 = c + (points[i + 1] - c) * shrink;
                b.Tri({p0.x, p0.y, side * halfWidth}, {p1.x, p1.y, side * halfWidth}, {p2.x, p2.y, side * halfWidth}, color);
            }
    };
    const auto rod = [&](glm::vec3 p0, glm::vec3 p1, float r, const glm::vec4& color, bool mirror = false) {
        b.Tube(p0, p1, r, r, 5, color, false, true);
        if (mirror) b.Tube({p0.x, p0.y, -p0.z}, {p1.x, p1.y, -p1.z}, r, r, 5, color, false, true);
    };
    const auto wheel = [&](float x, float r) {
        const int segments = 14;
        for (int i = 0; i < segments; ++i) {   // neumatico y aro: anillos de segmentos
            const float a0 = 6.2831853f * i / segments, a1 = 6.2831853f * (i + 1) / segments;
            const glm::vec3 p0(x + (r - 0.042f) * std::cos(a0), r + (r - 0.042f) * std::sin(a0), 0.0f), p1(x + (r - 0.042f) * std::cos(a1), r + (r - 0.042f) * std::sin(a1), 0.0f);
            b.Tube(p0, p1, 0.045f, 0.045f, 5, rubber, false, false);
        }
        for (int k = 0; k < 3; ++k) {
            const float a = 3.1415927f * k / 3.0f + 0.3f, s = r - 0.095f;
            rod({x - s * std::cos(a), r - s * std::sin(a), 0.0f}, {x + s * std::cos(a), r + s * std::sin(a), 0.0f}, 0.008f, steel);
        }
        b.Tube({x, r, -0.05f}, {x, r, 0.05f}, 0.05f, 0.05f, 7, alu, true, true);
    };
    const float r = 0.3f, front = 0.66f, rear = -0.66f;
    wheel(front, r);
    wheel(rear, r);
    // guardabarros (arco delgado sobre cada rueda)
    for (const auto& f : {std::array<float, 4>{front, 0.55f, 2.5f, 0.055f}, std::array<float, 4>{rear, 0.55f, 2.2f, 0.06f}}) {
        const bool isFront = f[0] > 0.0f;
        for (int i = 0; i < 6; ++i) {
            const float a0 = f[1] + (f[2] - f[1]) * i / 6.0f, a1 = f[1] + (f[2] - f[1]) * (i + 1) / 6.0f, rr = r + 0.035f;
            b.Quad({f[0] + rr * std::cos(a0), r + rr * std::sin(a0), -f[3]}, {f[0] + rr * std::cos(a1), r + rr * std::sin(a1), -f[3]},
                   {f[0] + rr * std::cos(a1), r + rr * std::sin(a1), f[3]}, {f[0] + rr * std::cos(a0), r + rr * std::sin(a0), f[3]}, isFront ? paint : dark);
        }
    }
    // tanque, asiento, colin y tapa lateral
    pillow({{-0.13f, 0.84f}, {0.10f, 0.76f}, {0.31f, 0.75f}, {0.37f, 0.81f}, {0.30f, 0.91f}, {0.12f, 0.965f}, {-0.07f, 0.94f}}, 0.135f, 0.74f, paint);
    pillow({{-0.72f, 0.875f}, {-0.62f, 0.825f}, {-0.10f, 0.825f}, {-0.05f, 0.90f}, {-0.07f, 0.935f}, {-0.35f, 0.925f}, {-0.62f, 0.925f}}, 0.118f, 0.8f, seat);
    pillow({{-0.87f, 0.83f}, {-0.72f, 0.77f}, {-0.44f, 0.73f}, {-0.44f, 0.83f}, {-0.74f, 0.875f}}, 0.09f, 0.74f, paint);
    pillow({{-0.40f, 0.655f}, {-0.20f, 0.62f}, {-0.07f, 0.72f}, {-0.12f, 0.81f}, {-0.40f, 0.80f}}, 0.105f, 0.74f, paint);
    b.Box({-0.86f, 0.825f, 0.0f}, {0.05f, 0.05f, 0.13f}, {0.6f, 0.03f, 0.03f, 1.0f});   // luz trasera
    // motor, cilindro inclinado y tapa de embrague
    pillow({{-0.18f, 0.28f}, {0.02f, 0.22f}, {0.22f, 0.30f}, {0.23f, 0.49f}, {-0.02f, 0.54f}, {-0.20f, 0.46f}}, 0.125f, 0.86f, engine);
    pillow({{0.06f, 0.50f}, {0.20f, 0.48f}, {0.33f, 0.62f}, {0.24f, 0.70f}, {0.09f, 0.63f}}, 0.075f, 0.9f, alu);
    b.Tube({0.03f, 0.37f, -0.15f}, {0.03f, 0.37f, -0.12f}, 0.095f, 0.095f, 9, alu, true, true);
    // chasis: bajante, basculante, amortiguadores y cadena
    rod({0.40f, 0.86f, 0.0f}, {0.20f, 0.50f, 0.0f}, 0.05f, dark);
    rod({-0.10f, 0.42f, 0.08f}, {rear, r, 0.08f}, 0.03f, dark, true);
    rod({-0.52f, 0.34f, 0.095f}, {-0.38f, 0.72f, 0.095f}, 0.026f, steel, true);
    b.Box({-0.33f, 0.37f, -0.098f}, {0.54f, 0.018f, 0.04f}, dark);
    // escape
    rod({0.25f, 0.46f, 0.08f}, {0.14f, 0.25f, 0.12f}, 0.022f, exhaust);
    rod({0.14f, 0.25f, 0.12f}, {-0.20f, 0.27f, 0.15f}, 0.022f, exhaust);
    b.Tube({-0.20f, 0.27f, 0.15f}, {-0.70f, 0.38f, 0.15f}, 0.047f, 0.047f, 7, steel, true, true);
    // horquilla, faro, tablero y manubrio con espejos
    rod({front, r, 0.062f}, {0.415f, 0.93f, 0.062f}, 0.032f, steel, true);
    b.Box({0.42f, 0.90f, 0.0f}, {0.09f, 0.03f, 0.17f}, dark);
    b.Box({0.51f, 0.95f, 0.0f}, {0.15f, 0.17f, 0.17f}, {0.82f, 0.83f, 0.80f, 1.0f});
    b.Box({0.40f, 1.01f, 0.0f}, {0.07f, 0.05f, 0.13f}, dark);
    rod({0.40f, 1.02f, 0.0f}, {0.37f, 1.06f, 0.34f}, 0.02f, dark, true);
    rod({0.375f, 1.055f, 0.24f}, {0.367f, 1.062f, 0.36f}, 0.033f, rubber, true);
    rod({0.38f, 1.05f, 0.20f}, {0.35f, 1.20f, 0.25f}, 0.009f, dark, true);
    b.Box({0.35f, 1.23f, 0.255f}, {0.012f, 0.1f, 0.1f}, dark);
    b.Box({0.35f, 1.23f, -0.255f}, {0.012f, 0.1f, 0.1f}, dark);
    // gato lateral y estriberas
    rod({-0.12f, 0.28f, -0.11f}, {-0.20f, 0.01f, -0.21f}, 0.02f, dark);
    rod({-0.06f, 0.28f, 0.10f}, {-0.06f, 0.28f, 0.20f}, 0.022f, rubber, true);
    return b.Build();
}

} // namespace Bazuko::MotoModel
