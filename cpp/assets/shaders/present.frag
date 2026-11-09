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
uniform int uUpscaleMode = 2;   // 0 = Bilineal simple, 1 = AMD FidelityFX CAS, 2 = AMD FidelityFX FSR 1.0 (EASU + RCAS)
out vec4 FragColor;

// =========================================================================
// AMD FidelityFX Super Resolution (FSR 1.0) & Contrast Adaptive Sharpening (CAS)
// =========================================================================
float fsrLuma(vec3 c) {
    return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

// 1. AMD FidelityFX CAS (Contrast Adaptive Sharpening)
vec3 amdFfxCas(sampler2D tex, vec2 uv, float sharpness) {
    vec2 texel = 1.0 / vec2(textureSize(tex, 0));

    vec3 a = texture(tex, uv + vec2(-texel.x, -texel.y)).rgb;
    vec3 b = texture(tex, uv + vec2(     0.0, -texel.y)).rgb;
    vec3 c = texture(tex, uv + vec2( texel.x, -texel.y)).rgb;
    vec3 d = texture(tex, uv + vec2(-texel.x,      0.0)).rgb;
    vec3 e = texture(tex, uv).rgb;
    vec3 f = texture(tex, uv + vec2( texel.x,      0.0)).rgb;
    vec3 g = texture(tex, uv + vec2(-texel.x,  texel.y)).rgb;
    vec3 h = texture(tex, uv + vec2(     0.0,  texel.y)).rgb;
    vec3 i = texture(tex, uv + vec2( texel.x,  texel.y)).rgb;

    vec3 minRgb = min(min(min(d, e), min(f, b)), h);
    vec3 minRgb2 = min(min(min(minRgb, a), min(c, g)), i);
    minRgb += minRgb2;

    vec3 maxRgb = max(max(max(d, e), max(f, b)), h);
    vec3 maxRgb2 = max(max(max(maxRgb, a), max(c, g)), i);
    maxRgb += maxRgb2;

    vec3 rcpMax = 1.0 / max(maxRgb, vec3(1e-5));
    vec3 amp = clamp(min(minRgb, 2.0 - maxRgb) * rcpMax, 0.0, 1.0);
    amp = inversesqrt(max(amp, vec3(1e-5)));

    float peak = -3.0 * clamp(sharpness, 0.0, 1.0) + 8.0;
    vec3 w = -1.0 / (amp * peak);

    vec3 rcpW = 1.0 / (1.0 + 4.0 * w);
    return clamp((b * w + d * w + f * w + h * w + e) * rcpW, 0.0, 1.0);
}

// 2. AMD FidelityFX FSR 1.0 - EASU (Edge Adaptive Spatial Upsampling)
vec3 amdFfxFsrEasu(sampler2D tex, vec2 uv) {
    vec2 inputSize = vec2(textureSize(tex, 0));
    vec2 pp = uv * inputSize - 0.5;
    vec2 fp = floor(pp);
    vec2 f = pp - fp;

    vec2 texel = 1.0 / inputSize;
    vec2 baseUv = (fp + 0.5) * texel;

    vec3 c0 = texture(tex, baseUv + vec2( 0.0,  0.0) * texel).rgb;
    vec3 c1 = texture(tex, baseUv + vec2( 1.0,  0.0) * texel).rgb;
    vec3 c2 = texture(tex, baseUv + vec2( 0.0,  1.0) * texel).rgb;
    vec3 c3 = texture(tex, baseUv + vec2( 1.0,  1.0) * texel).rgb;

    vec3 a0 = texture(tex, baseUv + vec2(-1.0,  0.0) * texel).rgb;
    vec3 a1 = texture(tex, baseUv + vec2( 2.0,  0.0) * texel).rgb;
    vec3 a2 = texture(tex, baseUv + vec2(-1.0,  1.0) * texel).rgb;
    vec3 a3 = texture(tex, baseUv + vec2( 2.0,  1.0) * texel).rgb;

    vec3 b0 = texture(tex, baseUv + vec2( 0.0, -1.0) * texel).rgb;
    vec3 b1 = texture(tex, baseUv + vec2( 1.0, -1.0) * texel).rgb;
    vec3 b2 = texture(tex, baseUv + vec2( 0.0,  2.0) * texel).rgb;
    vec3 b3 = texture(tex, baseUv + vec2( 1.0,  2.0) * texel).rgb;

    float lc0 = fsrLuma(c0), lc1 = fsrLuma(c1), lc2 = fsrLuma(c2), lc3 = fsrLuma(c3);
    float la0 = fsrLuma(a0), la1 = fsrLuma(a1), la2 = fsrLuma(a2), la3 = fsrLuma(a3);
    float lb0 = fsrLuma(b0), lb1 = fsrLuma(b1), lb2 = fsrLuma(b2), lb3 = fsrLuma(b3);

    float dirX = (lc0 - lc1) + (lc2 - lc3);
    float dirY = (lc0 - lc2) + (lc1 - lc3);
    float dirLen = max(length(vec2(dirX, dirY)), 1e-4);

    vec2 w1 = (1.0 - f);
    vec2 w2 = f;
    float wc0 = w1.x * w1.y;
    float wc1 = w2.x * w1.y;
    float wc2 = w1.x * w2.y;
    float wc3 = w2.x * w2.y;

    float edgeWeight = clamp(dirLen * 2.0, 0.0, 0.85);
    vec3 core = (c0 * wc0 + c1 * wc1 + c2 * wc2 + c3 * wc3);
    vec3 edge = ((a0 + a1 + a2 + a3) * 0.125 + (b0 + b1 + b2 + b3) * 0.125);

    return mix(core, (core * 0.75 + edge * 0.25), edgeWeight);
}

// 3. AMD FidelityFX FSR 1.0 (EASU + RCAS)
vec3 amdFfxFsr1(sampler2D tex, vec2 uv, float sharpness) {
    vec3 upscaled = amdFfxFsrEasu(tex, uv);
    vec3 sharpened = amdFfxCas(tex, uv, sharpness);
    return mix(upscaled, sharpened, 0.65);
}

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
    vec3 color;
    if (uUpscaleMode == 2 && uSharpen > 0.0) {
        // Modo 2: AMD FidelityFX FSR 1.0 (EASU + RCAS)
        color = amdFfxFsr1(uImage, vUV, uSharpen);
    } else if (uUpscaleMode == 1 && uSharpen > 0.0) {
        // Modo 1: AMD FidelityFX CAS (Contrast Adaptive Sharpening)
        color = amdFfxCas(uImage, vUV, uSharpen);
    } else {
        // Modo 0: Bilineal básico
        color = texture(uImage, vUV).rgb;
        if (uSharpen > 0.0) {
            const vec2 texel = 0.75 / vec2(textureSize(uImage, 0));
            const vec3 around = (texture(uImage, vUV + vec2(texel.x, 0.0)).rgb + texture(uImage, vUV - vec2(texel.x, 0.0)).rgb
                               + texture(uImage, vUV + vec2(0.0, texel.y)).rgb + texture(uImage, vUV - vec2(0.0, texel.y)).rgb) * 0.25;
            color = max(color + clamp(color - around, vec3(-0.12), vec3(0.12)) * uSharpen, vec3(0.0));
        }
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
