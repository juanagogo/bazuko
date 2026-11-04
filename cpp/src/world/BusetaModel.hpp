#pragma once
// Buseta de ruta del original (carModels.js, id "buseta": 7,60 x 2,30 x 3,00 m): cara vertical con parabrisas enorme, ventanas seguidas, tablero de ruta,
// franja azul con filete rojo y faros cuadrados. Frente +X, origen en el centro sobre el suelo; las ruedas se dibujan aparte.
#include "SignalModel.hpp"

namespace Bazuko::BusetaModel {

constexpr float kLength = 7.6f, kWidth = 2.3f, kHeight = 3.0f, kFrontAxle = 2.55f, kRearAxle = -1.45f, kWheelRadius = 0.46f, kWheelTrack = 1.0f;

inline std::shared_ptr<Mesh> Build() {
    SignalModel::Builder b;
    const glm::vec4 white(0.93f, 0.92f, 0.88f, 1.0f), blue(0.08f, 0.18f, 0.42f, 1.0f), red(0.77f, 0.12f, 0.16f, 1.0f), glass(0.05f, 0.08f, 0.10f, 1.0f);
    const glm::vec4 plastic(0.10f, 0.10f, 0.11f, 1.0f), lamp(0.95f, 0.93f, 0.80f, 1.0f), tail(0.70f, 0.08f, 0.08f, 1.0f), orange(1.0f, 0.42f, 0.10f, 1.0f), roof(0.78f, 0.78f, 0.76f, 1.0f);
    b.Box({0.0f, 0.88f, 0.0f}, {kLength, 0.85f, kWidth}, white);                       // faldon
    b.Box({0.0f, 2.20f, 0.0f}, {kLength - 0.1f, 1.80f, kWidth - 0.04f}, white);          // cabina
    b.Box({0.0f, 1.16f, 0.0f}, {kLength + 0.02f, 0.28f, kWidth + 0.02f}, blue);          // franja de la empresa
    b.Box({0.0f, 0.96f, 0.0f}, {kLength + 0.02f, 0.05f, kWidth + 0.02f}, red);           // filete rojo
    b.Box({0.0f, 2.84f, 0.0f}, {kLength + 0.02f, 0.12f, kWidth + 0.02f}, blue);          // franja alta
    b.Box({0.0f, 3.0f, 0.0f}, {kLength - 0.3f, 0.06f, kWidth - 0.2f}, roof);             // techo
    for (const float side : {-1.0f, 1.0f})                                             // ventanas seguidas a los dos lados
        for (int i = 0; i < 6; ++i) b.Box({-2.88f + 1.18f * static_cast<float>(i), 2.12f, side * (kWidth * 0.5f - 0.005f)}, {1.08f, 0.85f, 0.03f}, glass);
    b.Box({kLength * 0.5f - 0.04f, 2.10f, 0.0f}, {0.04f, 1.25f, kWidth - 0.28f}, glass);   // parabrisas enorme
    b.Box({-kLength * 0.5f + 0.04f, 2.20f, 0.0f}, {0.04f, 0.95f, 1.75f}, glass);           // ventana de atras
    b.Box({kLength * 0.5f - 0.02f, 2.84f, 0.0f}, {0.05f, 0.26f, 1.1f}, orange);            // tablero de ruta
    b.Box({kLength * 0.5f + 0.06f, 0.56f, 0.0f}, {0.22f, 0.30f, kWidth + 0.04f}, plastic);  // defensa delantera
    b.Box({-kLength * 0.5f - 0.06f, 0.60f, 0.0f}, {0.22f, 0.30f, kWidth + 0.04f}, plastic);  // defensa trasera
    for (const float side : {-1.0f, 1.0f}) {
        b.Box({kLength * 0.5f + 0.01f, 1.07f, side * 0.82f}, {0.06f, 0.22f, 0.32f}, lamp);   // faros cuadrados
        b.Box({-kLength * 0.5f - 0.01f, 1.25f, side * 0.88f}, {0.05f, 0.30f, 0.26f}, tail);   // luces traseras
    }
    b.Box({kLength * 0.5f + 0.015f, 1.08f, 0.0f}, {0.04f, 0.26f, 0.58f}, plastic);             // parrilla de lamas
    for (const float side : {1.0f}) {   // unica puerta, de dos hojas, adelante del eje y del lado de la acera
        b.Box({3.09f + 0.12f, 1.58f, side * (kWidth * 0.5f + 0.005f)}, {0.24f, 2.0f, 0.03f}, plastic);
        b.Box({3.345f + 0.12f, 1.58f, side * (kWidth * 0.5f + 0.005f)}, {0.24f, 2.0f, 0.03f}, plastic);
    }
    for (int i = 0; i < 6; ++i) b.Box({-2.95f + 0.96f * static_cast<float>(i), 1.46f, 0.0f}, {0.09f, 0.82f, 1.9f}, {0.10f, 0.12f, 0.17f, 1.0f});   // filas de asientos que se alcanzan a ver
    return b.Build();
}

} // namespace Bazuko::BusetaModel
