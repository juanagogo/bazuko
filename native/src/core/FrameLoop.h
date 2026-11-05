#pragma once

namespace bazuko {

// Tope del dt de simulación, igual que Game._loop del juego web.
constexpr double kMaxDt = 0.1;

// Convierte el intervalo real entre frames (segundos) en el dt de simulación.
double clampDt(double realSeconds);

}  // namespace bazuko
