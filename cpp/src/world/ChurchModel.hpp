#pragma once
// Iglesia colonial y fuente de piedra de la plaza de La Candelaria (src/world/bogota/EastLandmarks.js del original), en version de
// geometria sencilla con color por vertice: nave blanca con tejado a dos aguas, dos torres con campanario abierto y remate de teja,
// portada de piedra con puerta, roseton y frontón, y dos gradas. Origen en el centro de la planta; la portada mira a -X (hacia la plaza).
#include "SignalModel.hpp"
#include <cmath>

namespace Bazuko::ChurchModel {

constexpr float kLength = 24.0f, kWidth = 20.0f, kNaveHeight = 12.6f;   // X (de la portada al fondo), Z, alto de la nave

inline std::shared_ptr<Mesh> BuildChurch() {
    SignalModel::Builder b;
    const glm::vec4 wall(0.93f, 0.91f, 0.85f, 1.0f), clay(0.60f, 0.29f, 0.20f, 1.0f), stoneLight(0.82f, 0.80f, 0.73f, 1.0f);
    const glm::vec4 stoneGray(0.60f, 0.59f, 0.56f, 1.0f), wood(0.30f, 0.18f, 0.10f, 1.0f), dark(0.10f, 0.11f, 0.13f, 1.0f), iron(0.09f, 0.09f, 0.10f, 1.0f);
    const glm::vec4 glass(0.20f, 0.30f, 0.38f, 1.0f);
    const float frontX = -kLength * 0.5f;
    // nave y tejado a dos aguas con la cumbrera hacia la plaza
    b.Box({0.0f, kNaveHeight * 0.5f, 0.0f}, {kLength, kNaveHeight, kWidth}, wall);
    const float ridge = kNaveHeight + 5.0f, hw = kWidth * 0.5f + 0.4f;
    b.Quad({frontX - 0.3f, kNaveHeight - 0.3f, -hw}, {kLength * 0.5f + 0.3f, kNaveHeight - 0.3f, -hw}, {kLength * 0.5f + 0.3f, ridge, 0.0f}, {frontX - 0.3f, ridge, 0.0f}, clay);
    b.Quad({frontX - 0.3f, ridge, 0.0f}, {kLength * 0.5f + 0.3f, ridge, 0.0f}, {kLength * 0.5f + 0.3f, kNaveHeight - 0.3f, hw}, {frontX - 0.3f, kNaveHeight - 0.3f, hw}, clay);
    b.Tri({kLength * 0.5f + 0.2f, kNaveHeight - 0.3f, -hw}, {kLength * 0.5f + 0.2f, kNaveHeight - 0.3f, hw}, {kLength * 0.5f + 0.2f, ridge, 0.0f}, wall);
    // contrafuertes y ventanas altas en los costados
    for (int i = 0; i < 4; ++i) {
        const float x = -kLength * 0.5f + kLength * (static_cast<float>(i) + 0.5f) / 4.0f;
        for (float side : {-1.0f, 1.0f}) {
            b.Box({x - kLength / 8.0f, 4.3f, side * (kWidth * 0.5f + 0.2f)}, {0.8f, 8.6f, 0.4f}, stoneGray);
            b.Box({x, 6.5f, side * (kWidth * 0.5f + 0.02f)}, {1.3f, 3.2f, 0.06f}, glass);
        }
    }
    // dos torres que sobresalen de la nave, con tres cuerpos, campanario abierto y remate piramidal de teja con cruz
    const float towerW = 6.2f, towerH = 24.0f, towerX = frontX - 0.9f + 2.95f, belfry = towerH - 7.5f, up = 4.6f;
    for (float side : {-1.0f, 1.0f}) {
        const float z = side * (kWidth * 0.5f - towerW * 0.5f);
        b.Box({towerX, belfry * 0.5f, z}, {5.9f, belfry, towerW}, wall);
        b.Box({frontX - 0.85f, 0.45f, z}, {0.2f, 0.9f, towerW + 0.1f}, stoneGray);   // zocalo
        for (float y : {7.0f, 14.0f}) b.Box({towerX, y - 0.12f, z}, {6.1f, 0.24f, towerW + 0.2f}, stoneLight);   // cornisas
        for (float y : {7.4f, 11.2f}) b.Box({frontX - 0.92f, y + 1.1f, z}, {0.06f, 2.2f, 1.2f}, glass);
        for (float dx : {-2.45f, 2.45f}) for (float dz : {-2.6f, 2.6f}) b.Box({towerX + dx, belfry + up * 0.5f, z + dz}, {1.0f, up, 1.0f}, stoneLight);   // pilares
        b.Box({towerX, belfry - 0.1f, z}, {6.1f, 0.3f, towerW + 0.2f}, stoneGray);
        b.Box({towerX, belfry + up + 0.25f, z}, {6.1f, 0.5f, towerW + 0.2f}, stoneLight);
        b.Tube({towerX, belfry + 1.0f, z}, {towerX, belfry + 2.4f, z}, 0.5f, 0.15f, 8, iron, false, true);   // campana
        const float top = belfry + up + 0.5f, apex = top + 4.2f, hx = 3.1f, hz = towerW * 0.5f + 0.15f;
        b.Tri({towerX - hx, top, z + hz}, {towerX + hx, top, z + hz}, {towerX, apex, z}, clay);
        b.Tri({towerX + hx, top, z + hz}, {towerX + hx, top, z - hz}, {towerX, apex, z}, clay);
        b.Tri({towerX + hx, top, z - hz}, {towerX - hx, top, z - hz}, {towerX, apex, z}, clay);
        b.Tri({towerX - hx, top, z - hz}, {towerX - hx, top, z + hz}, {towerX, apex, z}, clay);
        b.Box({towerX, apex + 0.7f, z}, {0.12f, 1.5f, 0.12f}, iron);
        b.Box({towerX, apex + 1.1f, z}, {0.12f, 0.1f, 0.8f}, iron);
    }
    // portada central de piedra entre las torres: puerta con arco, pilastras, roseton y frontón con cruz
    const float centerW = kWidth - towerW * 2.0f;
    b.Box({frontX - 0.25f, 4.7f, 0.0f}, {0.5f, 9.2f, centerW * 0.6f}, stoneLight);
    b.Box({frontX - 0.62f, 2.9f, 0.0f}, {0.24f, 5.6f, 3.6f}, stoneGray);
    b.Box({frontX - 0.78f, 2.1f, 0.0f}, {0.1f, 3.9f, 2.6f}, wood);
    for (float side : {-1.0f, 1.0f}) {
        b.Box({frontX - 0.7f, 3.4f, side * 2.5f}, {0.34f, 6.5f, 0.5f}, stoneLight);
        b.Box({frontX - 0.55f, 4.4f, side * 3.3f}, {0.3f, 8.6f, 0.3f}, stoneGray);
    }
    for (int i = 0; i <= 8; ++i) {   // dovelas del arco de la puerta
        const float a = 3.14159265f * static_cast<float>(i) / 8.0f;
        b.Box({frontX - 0.82f, 4.05f + std::sin(a) * 1.55f, std::cos(a) * 1.55f}, {0.16f, 0.44f, 0.46f}, stoneLight);
    }
    b.Box({frontX - 0.72f, 6.77f, 0.0f}, {0.42f, 0.34f, 6.4f}, stoneLight);
    b.Box({frontX - 0.55f, 8.0f, 0.0f}, {0.1f, 1.7f, 2.1f}, glass);   // roseton
    b.Box({frontX - 0.4f, 9.45f, 0.0f}, {0.6f, 0.3f, centerW + 0.4f}, stoneLight);
    b.Tri({frontX - 0.1f, 9.6f, -centerW * 0.5f}, {frontX - 0.1f, 9.6f, centerW * 0.5f}, {frontX - 0.1f, 13.4f, 0.0f}, wall);
    b.Box({frontX - 0.1f, 14.0f, 0.0f}, {0.16f, 1.5f, 0.16f}, iron);
    b.Box({frontX - 0.1f, 14.4f, 0.0f}, {0.12f, 0.1f, 0.9f}, iron);
    // atrio: dos gradas de piedra delante de la portada (decorativas: la calle sigue plana)
    b.Box({frontX - 2.15f, 0.06f, 0.0f}, {4.3f, 0.12f, kWidth - 1.0f}, stoneGray);
    b.Box({frontX - 1.15f, 0.12f, 0.0f}, {2.3f, 0.24f, kWidth - 3.0f}, stoneLight);
    (void)dark;
    return b.Build();
}

// Fuente de piedra: taza ancha, columna y plato alto, con agua en la taza. Origen en el centro, a nivel del suelo.
inline std::shared_ptr<Mesh> BuildFountain(float radius) {
    SignalModel::Builder b;
    const glm::vec4 stone(0.72f, 0.70f, 0.64f, 1.0f), stoneDark(0.55f, 0.54f, 0.50f, 1.0f), water(0.30f, 0.52f, 0.62f, 1.0f);
    b.Tube({0, 0.0f, 0}, {0, 0.75f, 0}, radius, radius - 0.15f, 24, stoneDark, true, false);            // pared de la taza
    b.Tube({0, 0.75f, 0}, {0, 0.9f, 0}, radius + 0.12f, radius + 0.12f, 24, stone, false, true);          // borde
    b.Tube({0, 0.6f, 0}, {0, 0.62f, 0}, radius - 0.2f, radius - 0.2f, 24, water, false, true);            // agua
    b.Tube({0, 0.6f, 0}, {0, 2.4f, 0}, 0.55f, 0.35f, 12, stone, false, true);                              // columna
    b.Tube({0, 2.4f, 0}, {0, 2.7f, 0}, 1.5f, 0.9f, 20, stone, true, true);                                 // plato alto
    b.Tube({0, 2.7f, 0}, {0, 2.74f, 0}, 0.85f, 0.85f, 20, water, false, true);
    b.Tube({0, 2.74f, 0}, {0, 3.4f, 0}, 0.2f, 0.08f, 8, stone, false, true);                                // remate
    return b.Build();
}

} // namespace Bazuko::ChurchModel
