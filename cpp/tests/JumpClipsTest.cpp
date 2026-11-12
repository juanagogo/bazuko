// Reparto del tiempo del salto entre los clips (character/JumpClips.hpp): sin saltos bruscos de un clip a otro, sincronizado con la fisica del salto.
#include "character/JumpClips.hpp"
#include <cmath>
#include <cstdio>

static int failures = 0;
#define CHECK(c, m) do { if (!(c)) { std::printf("FALLO (%d): %s\n", __LINE__, m); ++failures; } } while (0)

using namespace Bazuko::Jump;

int main() {
    const ClipLengths length;
    for (const bool moving : {false, true}) {
        const Timing timing = TimingFor(moving);
        const float touch = timing.takeoff + timing.air;
        const char* label = moving ? "en movimiento" : "desde quieto";
        float lastA = 0.0f; JumpClip lastClip = JumpClip::Start; float lastWeight = 0.0f; bool first = true;
        for (float t = 0.0f; t <= timing.duration + 1e-4f; t += 1.0f / 240.0f) {
            const ClipMix m = Mix(t, moving, length);
            const float limit = m.a == JumpClip::Start ? length.start : m.a == JumpClip::Loop ? length.loop : m.a == JumpClip::Land ? length.land : 1e9f;
            CHECK(m.aTime >= 0.0f && m.aTime <= limit + 1e-4f, "el tiempo de cada clip queda dentro de su duracion");
            CHECK(m.weight >= 0.0f && m.weight <= 1.0f, "el peso de la mezcla queda entre 0 y 1");
            if (!first && m.a == lastClip && m.weight >= lastWeight - 1e-6f) CHECK(m.aTime >= lastA - 1e-5f, "dentro de una fase el clip nunca retrocede");
            if (!first && m.a == lastClip) CHECK(m.weight >= lastWeight - 1e-6f || m.a == JumpClip::Locomotion, "el fundido solo sube");
            lastA = m.aTime; lastClip = m.a; lastWeight = m.weight; first = false;
        }
        CHECK(std::abs(Mix(timing.takeoff, moving, length).aTime - kStartTakeoff) < 1e-3f, "al despegar la fisica, JumpStart esta en su instante de despegue");
        // continuidad: el final de la subida (fin de JumpStart) y el inicio del aire (inicio de JumpLoop) son la misma pose
        const float riseEnd = timing.takeoff + std::min(kRiseMax, timing.air * 0.6f);
        CHECK(std::abs(Mix(riseEnd - 1e-3f, moving, length).aTime - length.start) < 0.01f, "la subida termina al final de JumpStart");
        CHECK(Mix(riseEnd + 1e-3f, moving, length).a == JumpClip::Loop && Mix(riseEnd + 1e-3f, moving, length).aTime < 0.01f, "el aire empieza al principio de JumpLoop");
        // al tocar el suelo el fundido esta completo: la mezcla ya es el clip de destino
        const ClipMix before = Mix(touch - 1e-3f, moving, length);
        CHECK(before.weight > 0.98f, "justo antes de tocar el suelo el fundido esta casi completo");
        const ClipMix after = Mix(touch + 1e-3f, moving, length);
        CHECK(after.a == (moving ? JumpClip::Locomotion : JumpClip::Land) && after.weight == 0.0f, "al tocar el suelo queda solo el clip de destino");
        if (!moving) {
            const ClipMix end = Mix(timing.duration, false, length);
            CHECK(end.a == JumpClip::Land && end.aTime > 0.8f * length.land && end.aTime <= length.land, "al terminar la accion JumpLand ya esta casi de pie");
        }
        std::printf("Salto %s: despegue %.2f s, suelo %.2f s, fin %.2f s: tiempos de los clips coherentes\n", label, timing.takeoff, touch, timing.duration);
    }
    if (failures == 0) std::printf("Salto con clips: todo correcto\n");
    return failures == 0 ? 0 : 1;
}
