#pragma once

#include "core/MathTypes.h"

namespace bazuko {

// Cielo, luces y niebla según la hora (equivale a SceneManager.setTimeOfDay).
struct Lighting {
    double sunIntensity, hemiIntensity, envIntensity;
    Rgb sunColor;
    Rgb background;  // también es el color de la niebla (lineal)
    double fogNear, fogFar;
    Rgb hemiSky, hemiGround;
};

// Cielo de Bogotá: de día nublado gris azulado, atardecer cálido, de noche azul muy oscuro.
Lighting lightingAt(double hour);

// Mezcla el fondo/niebla hacia gris (0 = normal, 1 = gris total) según el ánimo.
void applyDesaturation(Lighting& l, double desaturation);

// Dirección unitaria hacia el sol (el sol sigue al jugador: offset fijo 30, 60, 18).
Vec3 sunDirection();

}  // namespace bazuko
