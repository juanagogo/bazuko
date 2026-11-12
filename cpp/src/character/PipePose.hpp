#pragma once
// Pose del basuco, tal cual la del original (BASUCO_POSE y createBasucoOverlay): las dos manos en la boca, el tronco inclinado, los muslos adelante y las rodillas
// dobladas. Giros de huesos en el espacio de la pose, compuestos como `rotateInFrame` (ver SmokingPose.hpp). `drop` es cuanto baja el cuerpo (m) para que los pies sigan en el piso.
#include "SmokingPose.hpp"

namespace Bazuko::Pipe {

inline constexpr float kLeftArm[3] = {-0.66f, -1.16f, -0.25f}, kLeftForearm[3] = {-2.18f, -0.61f, 0.4f};
inline constexpr float kRightArm[3] = {-1.3f, 1.08f, 0.2f}, kRightForearm[3] = {-1.04f, -0.16f, -0.76f};
inline constexpr float kSpine = 0.45f, kHead = 0.18f, kThigh = -0.38f, kKnee = 0.75f, kDrop = 0.06f;

inline float Drop(float reach) { return kDrop * reach; }

inline void AppendPose(std::vector<Model::BoneTurn>& turns, float reach) {
    if (reach < 0.001f) return;
    using Smoking::detail::RotateInFrame;
    for (const char* bone : {"Spine", "Spine1"}) RotateInFrame(turns, bone, kSpine * reach / 2.0f, 0.0f, 0.0f);   // el tronco se reparte entre las vertebras
    for (const char* side : {"Left", "Right"}) {
        RotateInFrame(turns, (std::string(side) + "UpLeg").c_str(), kThigh * reach, 0.0f, 0.0f);
        RotateInFrame(turns, (std::string(side) + "Leg").c_str(), kKnee * reach, 0.0f, 0.0f);
    }
    RotateInFrame(turns, "LeftArm", kLeftArm[0] * reach, kLeftArm[1] * reach, kLeftArm[2] * reach);
    RotateInFrame(turns, "LeftForeArm", kLeftForearm[0] * reach, kLeftForearm[1] * reach, kLeftForearm[2] * reach);
    RotateInFrame(turns, "RightArm", kRightArm[0] * reach, kRightArm[1] * reach, kRightArm[2] * reach);
    RotateInFrame(turns, "RightForeArm", kRightForearm[0] * reach, kRightForearm[1] * reach, kRightForearm[2] * reach);
    RotateInFrame(turns, "Head", kHead * reach, 0.0f, 0.0f);
}

} // namespace Bazuko::Pipe
