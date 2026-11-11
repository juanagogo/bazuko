#pragma once
// Pose de la calada, tal cual la del original (src/character/smoking.js: SMOKE_POSE y createSmokeOverlay): el brazo izquierdo sostiene el cigarrillo con el
// antebrazo apenas doblado y, en la calada, sube la mano a la boca; la cabeza se inclina un poco hacia ella. Se superpone a cualquier animacion (se puede fumar
// caminando) girando huesos con Model::BoneTurn en el espacio de la pose, igual que `rotateInFrame`: ejes del personaje (+x su izquierda, +y arriba, +z al frente).
#include "../renderer/Model.hpp"

#include <vector>

namespace Bazuko::Smoking {

// SMOKE_POSE del original: angulos (x, y, z) en radianes
inline constexpr float kMouthArm[3] = {-0.61f, -0.9f, 0.08f};
inline constexpr float kMouthForearm[3] = {-1.92f, -0.22f, 0.08f};
inline constexpr float kHoldForearm[3] = {-0.45f, 0.0f, 0.0f};

namespace detail {
// `rotateInFrame(frame, bone, x, y, z)` del original compone los giros como Euler 'YXZ' (Y despues de X despues de Z): se emiten en ese orden
inline void RotateInFrame(std::vector<Model::BoneTurn>& turns, const char* bone, float x, float y, float z) {
    if (x == 0.0f && y == 0.0f && z == 0.0f) return;
    const std::string name = std::string("mixamorig:") + bone;
    if (z != 0.0f) turns.push_back({name, {0.0f, 0.0f, z}, {0.0f, 0.0f, 0.0f}, true});
    if (x != 0.0f) turns.push_back({name, {x, 0.0f, 0.0f}, {0.0f, 0.0f, 0.0f}, true});
    if (y != 0.0f) turns.push_back({name, {0.0f, y, 0.0f}, {0.0f, 0.0f, 0.0f}, true});
}
}

// `hold` 0..1: que tanto lo sostiene; `reach` 0..1: que tan cerca de la boca tiene la mano.
inline void AppendPose(std::vector<Model::BoneTurn>& turns, float hold, float reach) {
    if (hold < 0.001f && reach < 0.001f) return;
    detail::RotateInFrame(turns, "LeftArm", kMouthArm[0] * reach, kMouthArm[1] * reach, kMouthArm[2] * reach);
    const auto forearm = [&](int i) { return kHoldForearm[i] * hold * (1.0f - reach) + kMouthForearm[i] * reach; };
    detail::RotateInFrame(turns, "LeftForeArm", forearm(0), forearm(1), forearm(2));
    detail::RotateInFrame(turns, "Head", 0.12f * reach, 0.1f * reach, 0.0f);   // inclina un poco la cabeza hacia la mano al aspirar
}

} // namespace Bazuko::Smoking
