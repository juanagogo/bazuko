#pragma once
#include <algorithm>
#include <cmath>
#include <glm/glm.hpp>

namespace Bazuko {

// Luz y cielo segun la hora, la lluvia y la niebla. Misma paleta y mismas franjas que Scene.setTimeOfDay del
// juego web: noche azul fria, amanecer gris azulado (6:12), dia nublado, atardecer ocre (18:12).
struct Atmosphere {
    glm::vec3 sunColor{1.0f};
    glm::vec3 ambientColor{1.0f};
    glm::vec3 fogColor{0.5f};   // tambien es el color del cielo
    float fogDensity = 0.015f;
    float lampPower = 0.0f;   // 0 apagadas (dia) .. 1 encendidas (noche); se encienden solas al oscurecer
};

inline float AtmosphereSmoothstep(float edge0, float edge1, float x) {
    const float t = std::clamp((x - edge0) / (edge1 - edge0), 0.0f, 1.0f);
    return t * t * (3.0f - 2.0f * t);
}

// hour 0..24; rain, mist y cloud 0..1; flash 0..1,8 es el destello de un relampago
inline Atmosphere ComputeAtmosphere(float hour, float rain, float mist, float cloud = 0.0f, float flash = 0.0f) {
    const float day = AtmosphereSmoothstep(6.5f, 8.5f, hour) * (1.0f - AtmosphereSmoothstep(17.0f, 19.0f, hour));
    const float dawn = std::max(0.0f, 1.0f - std::fabs(hour - 6.2f) / 1.3f);
    const float dusk = std::max(0.0f, 1.0f - std::fabs(hour - 18.2f) / 1.2f);

    const glm::vec3 sunDay(1.0f, 0.949f, 0.878f), sunDawn(1.0f, 0.851f, 0.702f);
    const glm::vec3 sunDusk(1.0f, 0.549f, 0.290f), sunNight(0.314f, 0.396f, 0.502f);
    // mezcla continua (el original conmuta por umbrales y la luz da un salto al amanecer y al atardecer)
    glm::vec3 sun = glm::mix(sunNight, sunDay, day);
    sun = glm::mix(sun, sunDawn, dawn);
    sun = glm::mix(sun, sunDusk, dusk);

    glm::vec3 sky(0.047f, 0.075f, 0.114f);   // noche
    if (dawn > 0.01f) sky = glm::mix(sky, glm::vec3(0.353f, 0.427f, 0.502f), dawn * 0.85f);
    if (day > 0.01f) sky = glm::mix(sky, glm::vec3(0.533f, 0.596f, 0.655f), day);
    if (dusk > 0.01f) sky = glm::mix(sky, glm::vec3(0.545f, 0.333f, 0.271f), dusk * 0.65f);

    Atmosphere result;
    const float sunPower = 0.3f + day * 1.7f + dawn * 0.8f + dusk * 0.9f;
    const float ambientPower = (0.7f + day * 0.4f + dawn * 0.1f) / 1.1f;
    // cielo cubierto: menos sol directo y cielo mas gris y apagado
    const float overcast = (1.0f - 0.4f * rain - 0.5f * mist) * (1.0f - 0.25f * cloud);
    result.sunColor = sun * sunPower * 0.48f * overcast;
    result.ambientColor = glm::mix(glm::vec3(0.35f, 0.38f, 0.45f), glm::vec3(0.16f, 0.2f, 0.3f), 1.0f - day) * ambientPower;
    const glm::vec3 grey(glm::dot(sky, glm::vec3(0.333f)));
    sky = glm::mix(sky, grey * 0.9f, 0.45f * rain);
    // la niebla es clara de dia y casi negra de noche
    sky = glm::mix(sky, glm::vec3(0.62f, 0.65f, 0.68f) * (0.12f + 0.88f * day) + sky * 0.15f, 0.7f * mist);
    result.fogColor = sky;
    result.lampPower = 1.0f - AtmosphereSmoothstep(0.05f, 0.7f, day * (1.0f - 0.4f * std::max(rain, mist)));
    result.fogDensity = 0.015f + 0.006f * rain + 0.03f * mist;
    if (flash > 0.0f) {   // relampago: el cielo y la luz ambiente se iluminan un instante
        const float f = std::min(flash, 1.0f);
        result.ambientColor += glm::vec3(0.55f, 0.6f, 0.75f) * f;
        result.fogColor = glm::mix(result.fogColor, glm::vec3(0.78f, 0.82f, 0.95f), 0.6f * f);
    }
    return result;
}

} // namespace Bazuko
