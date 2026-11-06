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
// Efectos de consumo (SubstanceLook.hpp): el filtro de color de CSS (desenfoque, sepia, tono, saturacion, brillo, contraste), la capa de color encima con su modo de mezcla
// y la estela (el promedio de los ultimos cuadros, guardado en media resolucion). Todo en sRGB, justo antes del tramado, como el filtro del lienzo en el original.
uniform int uSubstance = 0;
uniform float uSubBlur = 0.0, uSubSepia = 0.0, uSubHue = 0.0, uSubSaturate = 1.0, uSubBrightness = 1.0, uSubContrast = 1.0;
uniform int uSubOverlay = 0;
uniform float uSubOverlayOpacity = 0.0, uSubOverlayAngle = 0.0, uSubOverlayStop = 30.0;
uniform vec2 uScreenSize = vec2(1920.0, 1080.0);
layout(binding = 6) uniform sampler2D uTrail;
uniform int uUseTrail = 0;
uniform float uTrailOpacity = 0.0, uTrailShift = 0.0, uTrailScale = 1.0;
uniform float uOutAlpha = 1.0;   // al actualizar la estela, cuanto del cuadro nuevo entra
out vec4 FragColor;

vec3 subFilter(vec3 c) {
    float a = uSubSepia;
    if (a > 0.0) {
        float k = 1.0 - a;
        c = vec3(dot(c, vec3(0.393 + 0.607 * k, 0.769 - 0.769 * k, 0.189 - 0.189 * k)),
                 dot(c, vec3(0.349 - 0.349 * k, 0.686 + 0.314 * k, 0.168 - 0.168 * k)),
                 dot(c, vec3(0.272 - 0.272 * k, 0.534 - 0.534 * k, 0.131 + 0.869 * k)));
    }
    if (uSubHue != 0.0) {
        float cs = cos(radians(uSubHue)), sn = sin(radians(uSubHue));
        c = vec3(dot(c, vec3(0.213 + cs * 0.787 - sn * 0.213, 0.715 - cs * 0.715 - sn * 0.715, 0.072 - cs * 0.072 + sn * 0.928)),
                 dot(c, vec3(0.213 - cs * 0.213 + sn * 0.143, 0.715 + cs * 0.285 + sn * 0.140, 0.072 - cs * 0.072 - sn * 0.283)),
                 dot(c, vec3(0.213 - cs * 0.213 - sn * 0.787, 0.715 - cs * 0.715 + sn * 0.715, 0.072 + cs * 0.928 + sn * 0.072)));
    }
    if (uSubSaturate != 1.0) {
        float s = uSubSaturate;
        c = vec3(dot(c, vec3(0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s)),
                 dot(c, vec3(0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s)),
                 dot(c, vec3(0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s)));
    }
    c = clamp(c, 0.0, 1.0) * uSubBrightness;
    return clamp((clamp(c, 0.0, 1.0) - 0.5) * uSubContrast + 0.5, 0.0, 1.0);
}

vec3 blendOverlay(vec3 b, vec3 s) { return mix(2.0 * b * s, vec3(1.0) - 2.0 * (vec3(1.0) - b) * (vec3(1.0) - s), step(0.5, b)); }
vec3 blendSoftLight(vec3 b, vec3 s) {
    vec3 d = mix(sqrt(b), ((16.0 * b - 12.0) * b + 4.0) * b, step(b, vec3(0.25)));
    return mix(b - (1.0 - 2.0 * s) * b * (1.0 - b), b + (2.0 * s - 1.0) * (d - b), step(0.5, s));
}
// interpola dos paradas (rgba) como CSS: en premultiplicado
vec4 stopMix(vec4 a, vec4 b, float t) {
    vec4 pa = vec4(a.rgb * a.a, a.a), pb = vec4(b.rgb * b.a, b.a);
    vec4 m = mix(pa, pb, t);
    return vec4(m.a > 0.0001 ? m.rgb / m.a : vec3(0.0), m.a);
}
vec3 subOverlay(vec3 base, vec2 uv) {
    if (uSubOverlay == 0) return base;
    float radial = length((uv - 0.5) / (0.5 * 1.41421356));   // elipse hasta la esquina mas lejana: 1 en las esquinas
    vec4 layer = vec4(0.0);
    vec3 result = base;
    if (uSubOverlay == 1) {   // pastilla: degradado conico de colores (overlay)
        vec2 q = (uv - 0.5) * vec2(uScreenSize.x / uScreenSize.y, 1.0);
        float turn = (degrees(atan(q.x, q.y)) - uSubOverlayAngle) / 360.0;
        turn = fract(turn);
        const vec3 stops[6] = vec3[6](vec3(1.0, 0.239, 0.498), vec3(1.0, 0.824, 0.239), vec3(0.239, 1.0, 0.545), vec3(0.239, 0.773, 1.0), vec3(0.690, 0.239, 1.0), vec3(1.0, 0.239, 0.498));
        float scaled = turn * 5.0;
        int idx = min(int(scaled), 4);
        vec3 color = mix(stops[idx], stops[idx + 1], scaled - float(idx));
        result = mix(base, blendOverlay(base, color), uSubOverlayOpacity);
    } else if (uSubOverlay == 2) {   // pegante: transparente hasta el 35 % y luego verde oscuro (multiply)
        float a = 0.85 * clamp((radial - 0.35) / 0.65, 0.0, 1.0);
        result = mix(base, base * vec3(20.0, 50.0, 10.0) / 255.0, a * uSubOverlayOpacity);
    } else if (uSubOverlay == 3) {   // hierba: resplandor calido al centro y borde pardo (soft-light)
        vec4 c0 = vec4(vec3(255.0, 200.0, 90.0) / 255.0, 0.55), c1 = vec4(vec3(255.0, 150.0, 40.0) / 255.0, 0.15), c2 = vec4(vec3(40.0, 20.0, 0.0) / 255.0, 0.6);
        layer = radial < 0.45 ? stopMix(c0, c1, radial / 0.45) : stopMix(c1, c2, clamp((radial - 0.45) / 0.55, 0.0, 1.0));
        result = mix(base, blendSoftLight(base, layer.rgb), layer.a * uSubOverlayOpacity);
    } else {   // basuco: tunel con un pulso rojizo en los bordes (multiply)
        float s0 = uSubOverlayStop / 100.0;
        vec4 c1 = vec4(vec3(70.0, 0.0, 10.0) / 255.0, 0.55), c2 = vec4(vec3(5.0, 0.0, 2.0) / 255.0, 0.95);
        layer = radial < s0 ? vec4(0.0) : radial < 0.62 ? stopMix(vec4(0.0), c1, (radial - s0) / max(0.62 - s0, 0.0001)) : stopMix(c1, c2, clamp((radial - 0.62) / 0.38, 0.0, 1.0));
        result = mix(base, base * layer.rgb, layer.a * uSubOverlayOpacity);
    }
    return result;
}

// La escena se dibuja en un buffer de coma flotante (RGBA16F) en el mismo espacio de color que antes (sRGB, con niebla y filtros ya aplicados);
// los brillos que pasan de 1 (luces de la patrulla, relampagos, soles y reflejos) llegan sin recortar. Aqui se pasa a lineal, se asienta la
// escena con la oclusion ambiental, se suma el bloom, se aplica la curva filmica ACES (hombro suave en vez de blancos planos) y se vuelve a sRGB.
vec3 srgbToLinear(vec3 c) { c = max(c, vec3(0.0)); return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c)); }
vec3 linearToSrgb(vec3 c) { c = max(c, vec3(0.0)); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c)); }

// Ajuste de Narkowicz a la curva ACES
vec3 acesFilm(vec3 x) {
    float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
    return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

float interleavedNoise(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }

void main() {
    vec3 color = texture(uImage, vUV).rgb;
    if (uSubstance == 1 && uSubBlur > 0.01) {   // desenfoque gaussiano de la sustancia (sigma en pixeles de pantalla), con una rejilla de 3 x 3
        vec2 step1 = vec2(uSubBlur) / uScreenSize;
        vec3 sum = vec3(0.0); float weight = 0.0;
        for (int y = -1; y <= 1; ++y) for (int x = -1; x <= 1; ++x) {
            float w = exp(-0.5 * float(x * x + y * y));
            sum += texture(uImage, vUV + vec2(float(x), float(y)) * step1).rgb * w;
            weight += w;
        }
        color = sum / weight;
    }
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
    if (uSubstance == 1) {
        color = subFilter(color);
        if (uUseTrail == 1 && uTrailOpacity > 0.0) {   // la estela se dibuja debajo con el mismo filtro, algo desplazada y respirando
            vec2 trailUv = (vUV - 0.5 - vec2(uTrailShift / uScreenSize.x, 0.0)) / uTrailScale + 0.5;
            vec4 trail = texture(uTrail, trailUv);
            color = mix(color, subFilter(trail.rgb), uTrailOpacity * trail.a);
        }
        color = subOverlay(color, vUV);
    }
    color += (interleavedNoise(gl_FragCoord.xy) - 0.5) / 255.0;   // tramado: sin bandas en cielos y niebla
    FragColor = vec4(color, uOutAlpha);
}
