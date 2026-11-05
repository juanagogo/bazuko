#pragma once
// Semaforo de Bogota hecho por codigo (src/world/bogota/SignalModel.js del original): poste galvanizado de 6,6 m sobre un dado de concreto,
// brazo curvo de 3,95 m sobre el carril con la cabeza principal de tres lentes y su contraplaca, otra cabeza baja en el poste y dos cabezas
// peatonales. Origen en la base, a nivel de la calzada; +X es el rumbo del conductor (las luces miran a -X) y -Z sale sobre la calzada.
// Aqui solo va la carcasa; las lentes se dibujan aparte con el color de cada fase (ver Simulation::Render).
#include "../renderer/Mesh.hpp"
#include <algorithm>
#include <cmath>
#include <memory>
#include <vector>

namespace Bazuko::SignalModel {

constexpr float kPoleRadius = 0.068f, kPoleTop = 6.6f, kBaseY = 0.13f;
constexpr float kReach = 3.5f, kArmLength = 3.95f;
constexpr float kHeadY = 5.45f, kLowHeadY = 3.2f, kPedY = 2.42f;
constexpr float kModule = 0.36f, kHeadDepth = 0.2f, kLensRadius = 0.138f;
constexpr float kCounterOffset = 0.41f;   // z del contador principal respecto a la cabeza (hacia el poste)
constexpr float kPedCounterY = 0.405f;     // altura del contador peatonal sobre el centro de la cabeza peatonal

// altura del brazo a distancia d del poste: sube un poco hacia la punta
inline float ArmY(float d) { const float t = 1.0f - d / kArmLength; return 5.85f + 0.38f * (1.0f - t * t); }

class Builder {
public:
    void Box(glm::vec3 center, glm::vec3 size, glm::vec4 color) {
        const glm::vec3 h = size * 0.5f;
        const glm::vec3 n[6] = {{-1, 0, 0}, {1, 0, 0}, {0, -1, 0}, {0, 1, 0}, {0, 0, -1}, {0, 0, 1}};
        for (int f = 0; f < 6; ++f) {
            const glm::vec3 normal = n[f];
            const glm::vec3 u = std::abs(normal.y) > 0.5f ? glm::vec3(1, 0, 0) : glm::vec3(0, 1, 0);
            const glm::vec3 v = glm::cross(normal, u);
            const uint32_t base = static_cast<uint32_t>(m_Vertices.size());
            const glm::vec2 corners[4] = {{-1, -1}, {1, -1}, {1, 1}, {-1, 1}};
            for (const glm::vec2& c : corners)
                m_Vertices.push_back({center + normal * glm::dot(normal, h) + u * (c.x * glm::dot(glm::abs(u), h)) + v * (c.y * glm::dot(glm::abs(v), h)), normal, {0.5f + 0.5f * c.x, 0.5f + 0.5f * c.y}, color});
            for (uint32_t i : {0u, 1u, 2u, 0u, 2u, 3u}) m_Indices.push_back(base + i);
        }
    }

    // Triangulo y cuadrilatero planos (la cara se dibuja por los dos lados)
    void Tri(glm::vec3 a, glm::vec3 b, glm::vec3 c, glm::vec4 color) {
        glm::vec3 normal = glm::cross(b - a, c - a);
        normal = glm::length(normal) > 1.0e-8f ? glm::normalize(normal) : glm::vec3(0, 1, 0);
        const uint32_t base = static_cast<uint32_t>(m_Vertices.size());
        m_Vertices.push_back({a, normal, {0, 0}, color});
        m_Vertices.push_back({b, normal, {1, 0}, color});
        m_Vertices.push_back({c, normal, {0.5f, 1}, color});
        for (uint32_t i : {0u, 1u, 2u}) m_Indices.push_back(base + i);
    }
    void Quad(glm::vec3 a, glm::vec3 b, glm::vec3 c, glm::vec3 d, glm::vec4 color) { Tri(a, b, c, color); Tri(a, c, d, color); }

    // Tronco de cono entre dos puntos, con tapas opcionales.
    void Tube(glm::vec3 a, glm::vec3 b, float radiusA, float radiusB, int sides, glm::vec4 color, bool capA = false, bool capB = true) {
        const glm::vec3 axis = glm::normalize(b - a);
        const glm::vec3 helper = std::abs(axis.y) > 0.9f ? glm::vec3(1, 0, 0) : glm::vec3(0, 1, 0);
        const glm::vec3 u = glm::normalize(glm::cross(axis, helper)), v = glm::cross(axis, u);
        const uint32_t base = static_cast<uint32_t>(m_Vertices.size());
        for (int ring = 0; ring < 2; ++ring) {
            const glm::vec3 center = ring ? b : a;
            const float radius = ring ? radiusB : radiusA;
            for (int k = 0; k <= sides; ++k) {
                const float angle = static_cast<float>(k) / static_cast<float>(sides) * 6.2831853f;
                const glm::vec3 dir = u * std::cos(angle) + v * std::sin(angle);
                m_Vertices.push_back({center + dir * radius, dir, {static_cast<float>(k) / sides, static_cast<float>(ring)}, color});
            }
        }
        for (int k = 0; k < sides; ++k) {
            const uint32_t i0 = base + static_cast<uint32_t>(k), i1 = i0 + 1, i2 = i0 + static_cast<uint32_t>(sides) + 1, i3 = i2 + 1;
            for (uint32_t i : {i0, i2, i1, i1, i2, i3}) m_Indices.push_back(i);
        }
        const auto cap = [&](glm::vec3 center, float radius, glm::vec3 normal) {
            const uint32_t centerIndex = static_cast<uint32_t>(m_Vertices.size());
            m_Vertices.push_back({center, normal, {0.5f, 0.5f}, color});
            for (int k = 0; k <= sides; ++k) {
                const float angle = static_cast<float>(k) / static_cast<float>(sides) * 6.2831853f;
                m_Vertices.push_back({center + (u * std::cos(angle) + v * std::sin(angle)) * radius, normal, {0.5f, 0.5f}, color});
            }
            for (int k = 0; k < sides; ++k) for (uint32_t i : {centerIndex, centerIndex + 1 + static_cast<uint32_t>(k), centerIndex + 2 + static_cast<uint32_t>(k)}) m_Indices.push_back(i);
        };
        if (capA) cap(a, radiusA, -axis);
        if (capB) cap(b, radiusB, axis);
    }

    // Pintura gastada: variacion de tono por posicion (mugre), oxido que sube desde la base y manchas de calle en el zocalo.
    std::shared_ptr<Mesh> Build() {
        const auto hash = [](float x, float y, float z) {
            const float h = std::sin(x * 127.1f + y * 311.7f + z * 74.7f) * 43758.5453f;
            return h - std::floor(h);
        };
        for (Vertex& v : m_Vertices) {
            const float grime = hash(std::floor(v.position.x * 9.0f), std::floor(v.position.y * 9.0f), std::floor(v.position.z * 9.0f));
            float tone = 0.88f + 0.24f * grime;
            glm::vec3 rgb = glm::vec3(v.color) * tone;
            const float low = std::clamp(1.0f - v.position.y / 1.1f, 0.0f, 1.0f);
            rgb = glm::mix(rgb, glm::vec3(0.34f, 0.21f, 0.13f), low * low * (0.25f + 0.35f * grime));   // oxido y salpicado de calle cerca del piso
            v.color = glm::vec4(rgb, v.color.a);
        }
        return std::make_shared<Mesh>(m_Vertices, m_Indices);
    }

private:
    std::vector<Vertex> m_Vertices;
    std::vector<uint32_t> m_Indices;
};

// Cabeza de vehiculo de tres modulos (rojo, amarillo, verde de arriba abajo), con visera por modulo. `center` es el centro del modulo amarillo.
inline void VehicleHead(Builder& b, glm::vec3 center, bool backPlate) {
    const glm::vec4 housing(0.22f, 0.23f, 0.24f, 1.0f), dark(0.03f, 0.03f, 0.035f, 1.0f);
    for (int i = 0; i < 3; ++i) {
        const float y = center.y + kModule * (1.0f - static_cast<float>(i));
        b.Box({center.x, y, center.z}, {kHeadDepth, kModule - 0.01f, 0.4f}, housing);
        // visera: techo largo y dos costados cortos, abierta por debajo
        b.Box({center.x - kHeadDepth * 0.5f - 0.11f, y + kLensRadius + 0.012f, center.z}, {0.22f, 0.012f, 0.30f}, housing);
        b.Box({center.x - kHeadDepth * 0.5f - 0.07f, y, center.z - kLensRadius - 0.012f}, {0.14f, 0.18f, 0.012f}, housing);
        b.Box({center.x - kHeadDepth * 0.5f - 0.07f, y, center.z + kLensRadius + 0.012f}, {0.14f, 0.18f, 0.012f}, housing);
        b.Box({center.x - kHeadDepth * 0.5f - 0.001f, y, center.z}, {0.004f, 0.27f, 0.27f}, dark);   // fondo negro tras el lente
    }
    if (backPlate) {   // contraplaca negra con borde amarillo retrorreflectivo
        const float x = center.x + kHeadDepth * 0.5f + 0.013f;
        b.Box({x, center.y, center.z}, {0.012f, 1.36f, 0.76f}, {0.95f, 0.77f, 0.08f, 1.0f});
        b.Box({x - 0.004f, center.y, center.z}, {0.012f, 1.25f, 0.65f}, {0.06f, 0.06f, 0.065f, 1.0f});
    }
}

// Cabeza peatonal: caja con dos ventanas (parar arriba, caminar abajo). `facing` es la direccion hacia donde mira.
inline void PedHead(Builder& b, glm::vec3 center, bool facingZ) {
    const glm::vec4 housing(0.22f, 0.23f, 0.24f, 1.0f), dark(0.03f, 0.03f, 0.035f, 1.0f);
    const glm::vec3 size = facingZ ? glm::vec3(0.28f, 0.52f, 0.13f) : glm::vec3(0.13f, 0.52f, 0.28f);
    b.Box(center, size, housing);
    for (float y : {0.125f, -0.125f}) {
        const glm::vec3 offset = facingZ ? glm::vec3(0.0f, y, -0.066f) : glm::vec3(0.066f, y, 0.0f);
        b.Box(center + offset, facingZ ? glm::vec3(0.2f, 0.2f, 0.004f) : glm::vec3(0.004f, 0.2f, 0.2f), dark);
    }
}

inline std::shared_ptr<Mesh> BuildBody() {
    Builder b;
    const glm::vec4 concrete(0.52f, 0.51f, 0.47f, 1.0f), plate(0.43f, 0.45f, 0.46f, 1.0f), darkPaint(0.16f, 0.17f, 0.17f, 1.0f);
    const glm::vec4 yellow(0.80f, 0.64f, 0.14f, 1.0f), galvanized(0.58f, 0.60f, 0.61f, 1.0f), galvanizedDark(0.40f, 0.41f, 0.42f, 1.0f);
    const float R = kPoleRadius;
    b.Box({0.0f, kBaseY * 0.5f, 0.0f}, {0.64f, kBaseY, 0.64f}, concrete);            // dado de concreto
    b.Box({0.0f, kBaseY + 0.012f, 0.0f}, {0.32f, 0.024f, 0.32f}, plate);              // platina
    b.Tube({0, kBaseY + 0.024f, 0}, {0, 0.6f, 0}, 0.118f, 0.074f, 10, darkPaint);     // zocalo pintado
    b.Tube({0, 0.6f, 0}, {0, 1.05f, 0}, 0.074f, R, 10, yellow);                       // franja amarilla
    b.Tube({0, 1.05f, 0}, {0, kPoleTop, 0}, R, R, 8, galvanized);                     // poste
    b.Tube({0, kPoleTop, 0}, {0, kPoleTop + 0.04f, 0}, R, R * 0.35f, 6, galvanizedDark);
    // brazo curvo sobre el carril, en tramos
    const float stops[5] = {0.0f, 0.9f, 1.7f, 2.6f, kArmLength}, radii[5] = {0.062f, 0.054f, 0.05f, 0.046f, 0.042f};
    for (int i = 0; i < 4; ++i)
        b.Tube({0, ArmY(stops[i]), -stops[i]}, {0, ArmY(stops[i + 1]), -stops[i + 1]}, radii[i], radii[i + 1], 6, galvanized, false, i == 3);
    b.Tube({0, 5.74f, 0}, {0, 5.97f, 0}, R + 0.012f, R + 0.012f, 8, galvanizedDark, true, true);   // collar del brazo
    // tirante: del poste a media luz del brazo
    b.Tube({0, 6.5f, -R}, {0, ArmY(2.05f) + 0.03f, -2.05f}, 0.014f, 0.014f, 4, plate);
    // cabeza principal sobre el carril con su soporte
    const float armAtHead = ArmY(kReach);
    b.Box({0.045f, armAtHead, -kReach}, {0.05f, 0.05f, 0.24f}, plate);
    b.Tube({0.075f, armAtHead + 0.1f, -kReach}, {0.075f, kHeadY - 0.62f, -kReach}, 0.022f, 0.022f, 4, plate, true, true);
    VehicleHead(b, {-0.075f, kHeadY, -kReach}, true);
    // contador de segundos: modulo aparte, pegado a la cabeza del lado del poste (arriba, a la altura del rojo), con fondo negro y visera
    {
        const glm::vec4 housing(0.22f, 0.23f, 0.24f, 1.0f), dark(0.03f, 0.03f, 0.035f, 1.0f);
        const float z = -kReach + kCounterOffset, y = kHeadY + kModule;
        b.Box({-0.075f, y, z}, {kHeadDepth, kModule - 0.01f, 0.40f}, housing);
        b.Box({-0.075f - kHeadDepth * 0.5f - 0.11f, y + 0.18f - 0.006f, z}, {0.22f, 0.012f, 0.34f}, housing);
        b.Box({-0.075f - kHeadDepth * 0.5f - 0.07f, y, z - 0.18f}, {0.14f, 0.34f, 0.012f}, housing);
        b.Box({-0.075f - kHeadDepth * 0.5f - 0.07f, y, z + 0.18f}, {0.14f, 0.34f, 0.012f}, housing);
        b.Box({-0.075f - kHeadDepth * 0.5f - 0.001f, y, z}, {0.004f, 0.32f, 0.36f}, dark);
        b.Tube({0.075f, ArmY(kReach - kCounterOffset) + 0.1f, z}, {0.075f, y + 0.18f, z}, 0.022f, 0.022f, 4, plate, true, true);
    }
    // cabeza baja en el poste
    for (float y : {kLowHeadY + 0.36f, kLowHeadY - 0.36f}) b.Tube({0, y - 0.022f, 0}, {0, y + 0.022f, 0}, R + 0.009f, R + 0.009f, 8, plate, true, true);
    VehicleHead(b, {-(R + 0.165f), kLowHeadY, 0.0f}, false);
    // cabezas peatonales: una hacia la calzada y otra paralela al poste
    PedHead(b, {0.0f, kPedY, -(R + 0.105f)}, true);
    PedHead(b, {R + 0.105f, kPedY, 0.0f}, false);
    {   // sobre cada cabeza peatonal, su contador con fondo negro
        const glm::vec4 housing(0.22f, 0.23f, 0.24f, 1.0f), dark(0.03f, 0.03f, 0.035f, 1.0f);
        b.Box({0.0f, kPedY + kPedCounterY, -(R + 0.105f)}, {0.28f, 0.29f, 0.13f}, housing);
        b.Box({0.0f, kPedY + kPedCounterY, -(R + 0.105f) - 0.066f}, {0.25f, 0.23f, 0.004f}, dark);
        b.Box({R + 0.105f, kPedY + kPedCounterY, 0.0f}, {0.13f, 0.29f, 0.28f}, housing);
        b.Box({R + 0.105f + 0.066f, kPedY + kPedCounterY, 0.0f}, {0.004f, 0.23f, 0.25f}, dark);
    }
    // gabinete de control a un lado de la base
    b.Box({0.05f, 0.95f, R + 0.2f}, {0.30f, 0.62f, 0.20f}, {0.62f, 0.63f, 0.58f, 1.0f});
    // boton peatonal
    b.Box({-(R + 0.03f), 1.15f, 0.0f}, {0.05f, 0.17f, 0.09f}, yellow);
    return b.Build();
}

// Digito de matriz de puntos 5 x 7 (como los contadores de los semaforos de Bogota): un hexagono por punto encendido, centrado en el origen y
// mirando a +Z. `cell` es la separacion entre puntos.
inline std::shared_ptr<Mesh> BuildDigit(int digit, float cell) {
    static const char* const font[10][7] = {
        {"01110", "10001", "10011", "10101", "11001", "10001", "01110"}, {"00100", "01100", "00100", "00100", "00100", "00100", "01110"},
        {"01110", "10001", "00001", "00010", "00100", "01000", "11111"}, {"11110", "00001", "00001", "01110", "00001", "00001", "11110"},
        {"00010", "00110", "01010", "10010", "11111", "00010", "00010"}, {"11111", "10000", "11110", "00001", "00001", "10001", "01110"},
        {"00110", "01000", "10000", "11110", "10001", "10001", "01110"}, {"11111", "00001", "00010", "00100", "01000", "01000", "01000"},
        {"01110", "10001", "10001", "01110", "10001", "10001", "01110"}, {"01110", "10001", "10001", "01111", "00001", "00010", "01100"}};
    std::vector<Vertex> vertices;
    std::vector<uint32_t> indices;
    for (int row = 0; row < 7; ++row)
        for (int col = 0; col < 5; ++col) {
            if (font[digit][row][col] != '1') continue;
            const glm::vec3 center((static_cast<float>(col) - 2.0f) * cell, (3.0f - static_cast<float>(row)) * cell, 0.0f);
            const uint32_t base = static_cast<uint32_t>(vertices.size());
            vertices.push_back({center, {0, 0, 1}, {0.5f, 0.5f}, glm::vec4(1.0f)});
            for (int k = 0; k < 6; ++k) {
                const float angle = static_cast<float>(k) / 6.0f * 6.2831853f;
                vertices.push_back({center + glm::vec3(std::cos(angle), std::sin(angle), 0.0f) * cell * 0.44f, {0, 0, 1}, {0.5f, 0.5f}, glm::vec4(1.0f)});
            }
            for (uint32_t k = 0; k < 6; ++k) { indices.push_back(base); indices.push_back(base + 1 + k); indices.push_back(base + 1 + (k + 1) % 6); }
        }
    return std::make_shared<Mesh>(vertices, indices);
}

} // namespace Bazuko::SignalModel
