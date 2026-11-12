#pragma once
// Primera Linea del Metro de Bogota (PLMB), recreada como en el original (src/world/bogota/MetroBogota.js): un viaducto elevado de concreto sobre el
// separador de la Av. Caracas, el tren oficial verde y blanco detenido sobre la via oriental, dos estaciones elevadas y los cerramientos de obra en la
// superficie (polisombra verde y maletines naranjas). Todo es geometria estatica: aqui solo estan las medidas y el dibujo, que Simulation::Draw llama.
#include <algorithm>
#include <array>
#include <cmath>
#include <memory>
#include <vector>
#include <glm/glm.hpp>
#include <glm/gtc/matrix_transform.hpp>
#include "../renderer/Mesh.hpp"
#include "../renderer/Renderer.hpp"

namespace Bazuko::Metro {

constexpr float kX = 75.0f;              // eje central sobre el separador de la Caracas
constexpr float kZStart = 10.0f;         // extremo norte del viaducto
constexpr float kZEnd = 310.0f;          // extremo sur
constexpr float kTrackHeight = 12.5f;    // cota de la via elevada (m sobre el suelo)
constexpr float kDeckWidth = 8.4f;       // ancho para doble via
constexpr float kDeckThickness = 1.4f;
constexpr float kPillarSpacing = 24.0f;
constexpr float kPillarRadius = 1.1f;
constexpr std::array<float, 2> kStationsZ{{115.0f, 193.0f}};          // Calle 72 y Calle 26
constexpr std::array<float, 5> kWorkZonesZ{{65.0f, 95.0f, 125.0f, 160.0f, 200.0f}};

// Posiciones Z de las pilas (cada 24 m, empezando 6 m despues del extremo norte)
inline std::vector<float> PillarsZ() {
    std::vector<float> result;
    for (float z = kZStart + 6.0f; z <= kZEnd - 6.0f + 1.0e-3f; z += kPillarSpacing) result.push_back(z);
    return result;
}

// Dibuja el metro si el jugador (`focus`) esta cerca de la Caracas. Los volumenes son los del original (cajas y cilindros), con sus colores.
inline void Draw(Renderer& renderer, const glm::vec3& focus) {
    if (std::abs(focus.x - kX) > 140.0f || focus.z < kZStart - 140.0f || focus.z > kZEnd + 140.0f) return;
    using MeshPtr = std::shared_ptr<Mesh>;
    constexpr float length = kZEnd - kZStart, centerZ = (kZStart + kZEnd) * 0.5f;
    static const glm::vec4 concrete{0.62f, 0.62f, 0.60f, 1.0f}, darkConcrete{0.36f, 0.37f, 0.35f, 1.0f}, ballastColor{0.23f, 0.23f, 0.23f, 1.0f};
    static const glm::vec4 steel{0.80f, 0.80f, 0.80f, 1.0f}, white{0.95f, 0.95f, 0.94f, 1.0f}, green{0.12f, 0.49f, 0.28f, 1.0f}, glass{0.07f, 0.09f, 0.10f, 1.0f};
    static const MeshPtr deck = Mesh::CreateCube({kDeckWidth, kDeckThickness, length}, darkConcrete);
    static const MeshPtr parapet = Mesh::CreateCube({0.35f, 1.2f, length}, concrete);
    static const MeshPtr ballast = Mesh::CreateCube({kDeckWidth - 1.2f, 0.15f, length}, ballastColor);
    static const MeshPtr rail = Mesh::CreateCube({0.1f, 0.18f, length}, steel);
    const glm::mat4 world(1.0f);
    renderer.Submit(*deck, glm::translate(world, {kX, kTrackHeight - kDeckThickness * 0.5f, centerZ}));
    for (const float side : {-1.0f, 1.0f}) renderer.Submit(*parapet, glm::translate(world, {kX + side * (kDeckWidth * 0.5f - 0.175f), kTrackHeight + 0.6f, centerZ}));
    renderer.Submit(*ballast, glm::translate(world, {kX, kTrackHeight + 0.08f, centerZ}));
    for (const float railX : {-2.6f, -1.2f, 1.2f, 2.6f}) renderer.Submit(*rail, glm::translate(world, {kX + railX, kTrackHeight + 0.22f, centerZ}));

    // pilas y capiteles
    static const float pillarHeight = kTrackHeight - kDeckThickness;
    static const MeshPtr pillar = Mesh::CreateCylinder(kPillarRadius * 1.07f, pillarHeight, 16, concrete);
    static const MeshPtr cap = Mesh::CreateCube({kDeckWidth * 0.95f, 1.2f, 3.2f}, darkConcrete);
    for (const float z : PillarsZ()) {
        if (std::abs(z - focus.z) > 200.0f) continue;
        renderer.Submit(*pillar, glm::rotate(glm::translate(world, {kX, pillarHeight * 0.5f, z}), -1.5708f, glm::vec3(1.0f, 0.0f, 0.0f)));   // el cilindro viene con el eje en Z: se para
        renderer.Submit(*cap, glm::translate(world, {kX, pillarHeight + 0.6f, z}));
    }

    // el tren oficial: tres coches (blanco, franja y techo verdes, ventanas oscuras), con la cabina y los faros en el primero
    constexpr float carLength = 18.0f, carWidth = 3.1f, carHeight = 3.4f;
    static const MeshPtr body = Mesh::CreateCube({carWidth, carHeight, carLength}, white);
    static const MeshPtr stripe = Mesh::CreateCube({carWidth + 0.04f, 0.85f, carLength + 0.02f}, green);
    static const MeshPtr roof = Mesh::CreateCube({carWidth - 0.2f, 0.4f, carLength}, green);
    static const MeshPtr windows = Mesh::CreateCube({carWidth + 0.08f, 1.1f, carLength * 0.85f}, glass);
    static const MeshPtr bellows = Mesh::CreateCube({carWidth * 0.9f, carHeight * 0.9f, 0.6f}, ballastColor);
    static const MeshPtr nose = Mesh::CreateCube({carWidth * 0.8f, carHeight * 0.7f, 1.8f}, green);
    static const MeshPtr headlight = Mesh::CreateRoundedBox({0.44f, 0.44f, 0.3f}, 0.15f, 2, {1.0f, 0.96f, 0.76f, 1.0f});
    const float trainY = kTrackHeight + 0.3f + carHeight * 0.5f;
    for (int car = 0; car < 3; ++car) {
        const glm::mat4 carBase = glm::translate(world, {kX + 1.9f, trainY, 95.0f - static_cast<float>(car) * (carLength + 0.6f)});
        renderer.Submit(*body, carBase);
        renderer.Submit(*stripe, glm::translate(carBase, {0.0f, -carHeight * 0.28f, 0.0f}));
        renderer.Submit(*roof, glm::translate(carBase, {0.0f, carHeight * 0.5f + 0.15f, 0.0f}));
        renderer.Submit(*windows, glm::translate(carBase, {0.0f, 0.2f, 0.0f}));
        if (car < 2) renderer.Submit(*bellows, glm::translate(carBase, {0.0f, 0.0f, -carLength * 0.5f - 0.3f}));
        if (car == 0) {
            renderer.Submit(*nose, glm::translate(carBase, {0.0f, -0.1f, carLength * 0.5f + 0.9f}));
            for (const float side : {-0.85f, 0.85f}) renderer.Submit(*headlight, glm::translate(carBase, {side, -0.6f, carLength * 0.5f + 1.9f}));
        }
    }

    // estaciones elevadas: plataforma, cubierta verde a dos aguas (aproxima la boveda) y las escaleras de acceso
    constexpr float stationWidth = 14.0f, stationLength = 32.0f;
    static const MeshPtr platform = Mesh::CreateCube({stationWidth, 0.4f, stationLength}, concrete);
    static const MeshPtr roofPanel = Mesh::CreateCube({stationWidth * 0.62f, 0.25f, stationLength}, {0.18f, 0.49f, 0.20f, 1.0f});
    static const MeshPtr stairs = Mesh::CreateCube({3.5f, kTrackHeight, 4.5f}, concrete);
    for (const float stationZ : kStationsZ) {
        if (std::abs(stationZ - focus.z) > 200.0f) continue;
        const glm::mat4 base = glm::translate(world, {kX, 0.0f, stationZ});
        renderer.Submit(*platform, glm::translate(base, {0.0f, kTrackHeight + 0.3f, 0.0f}));
        for (const float side : {-1.0f, 1.0f}) {
            glm::mat4 panel = glm::translate(base, {side * stationWidth * 0.2f, kTrackHeight + 4.7f, 0.0f});
            panel = glm::rotate(panel, side * -0.38f, glm::vec3(0.0f, 0.0f, 1.0f));
            renderer.Submit(*roofPanel, panel, glm::vec4(1.0f), false, true);
        }
        for (const float side : {-1.0f, 1.0f}) renderer.Submit(*stairs, glm::translate(base, {side * (stationWidth * 0.5f + 1.8f), kTrackHeight * 0.5f, 0.0f}));
    }

    // cerramientos de obra en superficie: polisombra verde y maletines viales naranjas y blancos
    static const MeshPtr shade = Mesh::CreateCube({0.05f, 2.2f, 16.0f}, {0.08f, 0.35f, 0.20f, 1.0f});
    static const MeshPtr jerseyOrange = Mesh::CreateCube({0.5f, 0.75f, 1.2f}, {0.90f, 0.32f, 0.0f, 1.0f});
    static const MeshPtr jerseyWhite = Mesh::CreateCube({0.5f, 0.75f, 1.2f}, {0.96f, 0.96f, 0.96f, 1.0f});
    for (const float workZ : kWorkZonesZ) {
        if (std::abs(workZ - focus.z) > 90.0f) continue;
        for (const float side : {-3.2f, 3.2f}) renderer.Submit(*shade, glm::translate(world, {kX + side, 1.1f, workZ}));
        for (float offset = -7.0f; offset <= 7.0f; offset += 2.4f) {
            const bool orange = std::abs(static_cast<int>(std::lround(offset))) % 2 == 0;
            renderer.Submit(orange ? *jerseyOrange : *jerseyWhite, glm::translate(world, {kX - 3.4f, 0.38f, workZ + offset}));
        }
    }
}

} // namespace Bazuko::Metro
