#version 450 core

// Boveda celeste del juego web (Scene.js, BogotaSkyShader): gradiente cenit-horizonte, resplandor del sol y nubes por ruido fbm
// con umbral segun la cobertura. Los colores llegan ya en espacio de pantalla (sRGB), igual que la niebla.
in vec3 vDirection;

uniform vec3 uTopColor;
uniform vec3 uBottomColor;
uniform vec3 uSunDirection;
uniform vec3 uSunGlowColor;
uniform float uSunGlowIntensity;
uniform float uCloudCover;
uniform vec2 uCloudOffset;
uniform vec3 uCloudLight;
uniform vec3 uCloudShadow;
uniform float uOctaves;
uniform float uFlash;
uniform vec3 uMoonDirection;
uniform float uMoonPhase;
uniform float uMoonVisibility;
uniform float uSunDisc;

out vec4 FragColor;

float hash21(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
               mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}

float fbm(vec2 p) {
    float value = 0.0, amplitude = 0.5, total = 0.0;
    for (int i = 0; i < 4; i++) {
        if (float(i) >= uOctaves) break;
        value += amplitude * noise(p);
        total += amplitude;
        p = p * 2.03 + vec2(17.1, 9.2);
        amplitude *= 0.5;
    }
    return value / total;
}

void main() {
    vec3 dir = normalize(vDirection);
    float h = max(dir.y + 0.04, 0.0);
    vec3 sky = mix(uBottomColor, uTopColor, pow(h, 0.55));
    float sunDot = max(dot(dir, uSunDirection), 0.0);
    sky += uSunGlowColor * (pow(sunDot, 5.0) * 0.6 + pow(sunDot, 48.0) * 0.5) * uSunGlowIntensity;

    // luna con fase: esfera iluminada desde el lado del sol, con mares y un halo que crece con la fraccion iluminada
    float moonDot = dot(dir, uMoonDirection);
    if (uMoonVisibility > 0.01 && moonDot > 0.97) {
        vec3 right = normalize(cross(uMoonDirection, vec3(0.0, 1.0, 0.0)) + vec3(0.0001, 0.0, 0.0));
        vec3 up = cross(right, uMoonDirection);
        vec3 rel = dir - uMoonDirection * moonDot;
        vec2 q = vec2(dot(rel, right), dot(rel, up)) / 0.03;
        float r2 = dot(q, q);
        float angle = uMoonPhase * 6.2831853;
        if (r2 < 1.0) {
            vec3 normal = vec3(q, sqrt(1.0 - r2));
            float lit = smoothstep(-0.04, 0.1, dot(normal, vec3(sin(angle), 0.0, -cos(angle))));
            float maria = 0.8 + 0.2 * noise(q * 2.6 + 4.0);
            vec3 moon = vec3(0.93, 0.93, 0.88) * maria * (0.05 + lit * 1.15);
            sky = mix(sky, moon, smoothstep(1.0, 0.85, r2) * uMoonVisibility);
        }
        float brightness = (1.0 - cos(angle)) * 0.5;
        sky += vec3(0.55, 0.65, 0.85) * pow(max(moonDot, 0.0), 900.0) * 0.35 * brightness * uMoonVisibility;
    }
    // disco solar nitido; las nubes lo tapan mas abajo
    sky += uSunGlowColor * smoothstep(0.99955, 0.9998, sunDot) * uSunDisc * 6.0;

    // nubes proyectadas sobre un plano alto: densidad por fbm y umbral de cobertura
    if (dir.y > 0.0 && uCloudCover > 0.01) {
        vec2 uv = dir.xz / (dir.y + 0.12) * 1.7 + uCloudOffset;
        float n = fbm(uv);
        float threshold = mix(0.74, 0.22, uCloudCover);
        float density = smoothstep(threshold, threshold + 0.26, n);
        density = max(density, smoothstep(0.86, 1.0, uCloudCover) * 0.92);
        density *= smoothstep(0.0, 0.14, dir.y);
        float thickness = clamp((n - threshold) * 2.2 + uCloudCover * 0.35, 0.0, 1.0);
        vec3 cloud = mix(uCloudLight, uCloudShadow, thickness);
        cloud += uSunGlowColor * pow(sunDot, 10.0) * (1.0 - thickness) * uSunGlowIntensity * 0.8;
        cloud += vec3(0.75, 0.8, 0.95) * uFlash * (0.4 + thickness);
        sky = mix(sky, cloud, density);
        sky += uSunGlowColor * pow(sunDot, 24.0) * density * (1.0 - thickness) * uSunDisc * 0.5;
    }
    sky += vec3(0.5, 0.55, 0.7) * uFlash * 0.25;
    FragColor = vec4(sky, 1.0);
}
