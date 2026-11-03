#version 450 core
in vec2 vUV;
layout(binding = 0) uniform sampler2D uImage;
layout(binding = 1) uniform sampler2D uAo;      // oclusion ambiental (media resolucion), solo si uUseAo
layout(binding = 2) uniform sampler2D uBloom;   // brillos desenfocados, solo si uBloomStrength > 0
layout(binding = 3) uniform sampler2D uDepth;   // profundidad resuelta: el cielo (profundidad 1) es lo que deja pasar los rayos
uniform float uShaftStrength = 0.0;   // rayos de luz del sol (calidad alta): 0 los apaga
uniform vec3 uShaftColor = vec3(1.0, 0.85, 0.6);
uniform vec2 uSunUv = vec2(0.5);      // posicion del sol en la pantalla (0..1)
uniform int uToneMap = 1;        // 1 mapeo tonal ACES, 0 pasa la imagen tal cual (comparaciones)
uniform float uExposure = 1.0;
uniform int uUseAo = 0;
uniform float uBloomStrength = 0.0;
layout(binding = 5) uniform sampler2D uReflections;   // reflejos en pantalla (media resolucion): rgb color, a peso
uniform int uUseReflections = 0;
layout(binding = 4) uniform sampler2D uVolume;   // niebla volumetrica: rgb luz dispersada, a transmitancia
uniform int uUseVolume = 0;
uniform int uDebugBloom = 0;   // pruebas: muestra solo el aporte del bloom (x10)
uniform float uSharpen = 0.0;   // nitidez al presentar una imagen reescalada (sobremuestreo 1,5x o resolucion dinamica): el filtro bilineal la suaviza
out vec4 FragColor;

// La escena se dibuja en un buffer de coma flotante (RGBA16F) en el mismo espacio de color que antes (sRGB, con niebla y filtros ya aplicados);
// los brillos que pasan de 1 (luces de la patrulla, relampagos, soles y reflejos) llegan sin recortar. Aqui se pasa a lineal, se asienta la
// escena con la oclusion ambiental, se suma el bloom, se aplica la curva filmica ACES (hombro suave en vez de blancos planos) y se vuelve a sRGB.
vec3 srgbToLinear(vec3 c) { c = max(c, vec3(0.0)); return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c)); }
vec3 linearToSrgb(vec3 c) { c = max(c, vec3(0.0)); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c)); }

// Ajuste de Narkowicz a la curva ACES
vec3 acesFilm(vec3 x) {
    const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
    return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

float interleavedNoise(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }

void main() {
    vec3 color = texture(uImage, vUV).rgb;
    if (uSharpen > 0.0) {   // mascara de enfoque con cuatro vecinos a medio pixel de la imagen de origen; el limite evita halos en bordes muy contrastados
        const vec2 texel = 0.75 / vec2(textureSize(uImage, 0));
        const vec3 around = (texture(uImage, vUV + vec2(texel.x, 0.0)).rgb + texture(uImage, vUV - vec2(texel.x, 0.0)).rgb
                           + texture(uImage, vUV + vec2(0.0, texel.y)).rgb + texture(uImage, vUV - vec2(0.0, texel.y)).rgb) * 0.25;
        color = max(color + clamp(color - around, vec3(-0.12), vec3(0.12)) * uSharpen, vec3(0.0));
    }
    if (uToneMap == 1) {
        vec3 linear = srgbToLinear(color);
        if (uUseReflections == 1) { const vec4 reflection = texture(uReflections, vUV); linear = mix(linear, srgbToLinear(reflection.rgb), reflection.a); }
        if (uUseAo == 1) linear *= texture(uAo, vUV).r;
        if (uUseVolume == 1) { const vec4 volume = texture(uVolume, vUV); linear = linear * volume.a + volume.rgb; }   // la escena se ve a traves de la niebla y se le suma la luz dispersada
        if (uBloomStrength > 0.0) linear += texture(uBloom, vUV).rgb * uBloomStrength;
        if (uShaftStrength > 0.0) {   // rayos de luz: desenfoque radial del cielo visible hacia el sol (los edificios y el viaducto dejan haces entre si)
            const int kSteps = 16;
            const vec2 stepVector = (uSunUv - vUV) * (0.85 / float(kSteps));
            vec2 uv = vUV;
            float light = 0.0, decay = 1.0;
            for (int i = 0; i < kSteps; ++i) {
                uv += stepVector;
                light += step(0.99999, texture(uDepth, uv).r) * decay;
                decay *= 0.93;
            }
            const float toSun = length(uSunUv - vUV);
            linear += uShaftColor * (light / float(kSteps)) * uShaftStrength * smoothstep(1.4, 0.1, toSun);
        }
        color = linearToSrgb(acesFilm(linear * uExposure));
        if (uDebugBloom == 1 && uBloomStrength > 0.0) color = clamp(texture(uBloom, vUV).rgb * uBloomStrength * 10.0, 0.0, 1.0);
    } else {
        color = clamp(color, 0.0, 1.0);
    }
    color += (interleavedNoise(gl_FragCoord.xy) - 0.5) / 255.0;   // tramado: sin bandas en cielos y niebla
    FragColor = vec4(color, 1.0);
}
