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

// Colores del cielo segun la altura del sol, las nubes, la lluvia y la neblina: la paleta y las mezclas de Scene.setTimeOfDay del
// juego web (cenit, horizonte, nubes y resplandor del sol). `horizon` tambien es el color de la niebla.
struct SkyColors {
    glm::vec3 top{0.0f}, horizon{0.0f};
    glm::vec3 cloudLight{1.0f}, cloudShadow{0.5f};
    glm::vec3 sunGlow{1.0f};
    float sunGlowIntensity = 0.0f;
    float sunDisc = 0.0f;   // 0..1: el disco del sol aparece al cruzar el horizonte y se apaga con la lluvia
    float night = 0.0f;     // 0 de dia .. 1 de noche
};

inline glm::vec3 HexColor(unsigned int rgb) {
    return {static_cast<float>((rgb >> 16) & 255u) / 255.0f, static_cast<float>((rgb >> 8) & 255u) / 255.0f, static_cast<float>(rgb & 255u) / 255.0f};
}

inline SkyColors ComputeSkyColors(float sunAltitude, float cloud, float rain, float mist, float flash) {
    const auto clamp01 = [](float v) { return std::clamp(v, 0.0f, 1.0f); };
    cloud = clamp01(cloud);
    rain = clamp01(rain);
    mist = clamp01(mist);
    const float day = AtmosphereSmoothstep(-0.08f, 0.22f, sunAltitude);
    const float twilight = clamp01(1.0f - std::fabs(sunAltitude - 0.02f) / 0.17f) * (1.0f - cloud * 0.55f);
    const float lowSun = 1.0f - AtmosphereSmoothstep(0.05f, 0.4f, sunAltitude);

    SkyColors sky;
    sky.night = 1.0f - AtmosphereSmoothstep(-0.18f, 0.02f, sunAltitude);
    sky.sunDisc = AtmosphereSmoothstep(-0.02f, 0.03f, sunAltitude) * (1.0f - rain);
    sky.top = glm::mix(glm::mix(HexColor(0x060c15), HexColor(0x17151a), cloud), glm::mix(HexColor(0x2f6db0), HexColor(0x76838f), cloud), day);
    sky.top = glm::mix(sky.top, HexColor(0x34405e), twilight * 0.7f);
    sky.horizon = glm::mix(glm::mix(HexColor(0x121a24), HexColor(0x2b231f), cloud), glm::mix(HexColor(0xa9c4da), HexColor(0x9aa3ab), cloud), day);
    sky.horizon = glm::mix(sky.horizon, HexColor(0xd49a72), twilight * 0.6f);
    if (rain > 0.01f) {
        sky.top = glm::mix(sky.top, HexColor(0x3c4651), rain * 0.45f);
        sky.horizon = glm::mix(sky.horizon, HexColor(0x3c4651), rain * 0.4f);
    }
    if (mist > 0.01f) sky.horizon = glm::mix(sky.horizon, glm::mix(HexColor(0x2b2c30), HexColor(0xa9aeb2), day), mist * 0.75f);
    if (flash > 0.01f) sky.horizon = glm::mix(sky.horizon, HexColor(0x8e98b0), std::min(1.0f, flash) * 0.5f);

    sky.sunGlow = glm::mix(HexColor(0xfff2e0), HexColor(0xff9a55), lowSun);
    sky.sunGlowIntensity = (twilight + day * 0.35f * (1.0f - cloud)) * (1.0f - rain * 0.85f);
    sky.cloudLight = glm::mix(glm::mix(HexColor(0x3b322d), HexColor(0xf3f5f7), day), HexColor(0xe2a785), twilight * 0.45f);
    sky.cloudShadow = glm::mix(HexColor(0x1b1819), glm::mix(HexColor(0x9aa6b1), HexColor(0x5e6771), cloud), day);
    sky.cloudShadow = glm::mix(sky.cloudShadow, HexColor(0x6a5a66), twilight * 0.5f);
    sky.cloudShadow = glm::mix(sky.cloudShadow, HexColor(0x3c434b), rain * 0.6f * day);
    return sky;
}

} // namespace Bazuko
