#version 450 core

in vec3 vFragPos;
in vec3 vNormal;
in vec2 vUV;
in vec4 vColor;

layout(std140, binding = 0) uniform CameraBlock {
    mat4 uView;
    mat4 uProjection;
    mat4 uViewProjection;
    vec3 uCameraPos;
    float uTime;
};

layout(std140, binding = 1) uniform LightBlock {
    vec3 uSunDir;
    float _pad0;
    vec3 uSunColor;
    float _pad1;
    vec3 uAmbientColor;
    float _pad2;
    vec3 uFogColor;
    float uFogDensity;
    int uLampCount;
    int _pad3a;
    int _pad3b;
    int _pad3c;
    vec4 uLampPosition[32];
    vec4 uLampColor[32];
};

uniform vec4 uAlbedo;
uniform int uUseTexture;
uniform int uUnlit = 0;   // 1 bombillas (sin iluminacion), 2 cielo (sin iluminacion ni niebla)
uniform int uAlphaMode;
uniform int uWater = 0;
uniform float uAlphaCutoff;
layout(binding = 0) uniform sampler2D uTexture;
layout(binding = 1) uniform sampler2D uSpecularTexture;
uniform int uUseSpecularTexture;
uniform float uMetallic = 0.0;    // acabado metalizado (pintura y aros del bus): reflejo del entorno y brillo nitido del sol
uniform float uRoughness = 0.5;
// Filtro de color de la psicosis: contrast(), saturate() y hue-rotate() del CSS del juego web
uniform float uWetness = 0.0;   // lluvia: suelo oscuro y brillante
uniform float uContrast = 1.0;
uniform float uSaturation = 1.0;
uniform float uHueDegrees = 0.0;
// Iluminacion en espacio lineal: los colores de textura y de vertice se pasan de sRGB a lineal antes de iluminar y el resultado
// vuelve a sRGB al final. Con luz completa (ambiente + sol = 1) el color es el original; las zonas en sombra quedan mas claras
// y con detalle, en lugar de aplastarse a negro.
uniform int uGammaCorrect = 1;
vec3 srgbToLinear(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c)); }
vec3 linearToSrgb(vec3 c) { c = max(c, vec3(0.0)); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c)); }

out vec4 FragColor;

void main() {
    vec3 norm = normalize(vNormal);
    vec3 lightDir = normalize(-uSunDir);

    float diff = max(dot(norm, lightDir), 0.0);
    vec3 diffuse = diff * uSunColor;
    vec3 ambient = uAmbientColor;
    vec3 viewDir = normalize(uCameraPos - vFragPos);
    vec3 reflectedLight = reflect(-lightDir, norm);
    float specularStrength = uUseSpecularTexture == 1
        ? texture(uSpecularTexture, vUV).r * 0.35 : 0.0;
    vec3 specular = pow(max(dot(viewDir, reflectedLight), 0.0), 24.0)
        * uSunColor * specularStrength;

    vec4 baseColor = uAlbedo * vColor;
    if (uGammaCorrect == 1) baseColor.rgb = srgbToLinear(clamp(baseColor.rgb, 0.0, 1.0));
    if (uUseTexture == 1) {
        vec4 texel = texture(uTexture, vUV);
        if (uGammaCorrect == 1) texel.rgb = srgbToLinear(texel.rgb);
        baseColor *= texel;
    }
    const vec3 fogColor = uGammaCorrect == 1 ? srgbToLinear(uFogColor) : uFogColor;
    if (uAlphaMode == 1) {
        if (baseColor.a < uAlphaCutoff) discard;
        baseColor.a = 1.0;
    } else if (uAlphaMode == 0) {
        baseColor.a = 1.0;
    }

    vec3 result = (ambient + diffuse) * baseColor.rgb * (1.0 - 0.15 * uMetallic) + specular;
    if (uMetallic > 0.0) {
        // entorno falso: cielo azul arriba, velo de niebla en el horizonte y suelo oscuro abajo; el color del metal tiñe el reflejo
        const vec3 reflection = reflect(-viewDir, norm);
        const float light = clamp(dot(uAmbientColor + uSunColor, vec3(0.34)), 0.08, 1.3);
        const vec3 zenith = (uGammaCorrect == 1 ? vec3(0.07, 0.20, 0.55) : vec3(0.30, 0.50, 0.85)) * light;
        const vec3 ground = fogColor * 0.35 + baseColor.rgb * 0.05;
        vec3 environment = reflection.y > 0.0 ? mix(fogColor, zenith, smoothstep(0.0, 0.7, reflection.y))
                                              : mix(fogColor * 0.7, ground, smoothstep(0.0, 0.4, -reflection.y));
        environment += uSunColor * pow(max(dot(reflection, lightDir), 0.0), 160.0) * 4.0;   // sol reflejado
        const float fresnel = pow(1.0 - max(dot(norm, viewDir), 0.0), 3.0);
        const float mirror = uMetallic * (1.0 - 0.6 * uRoughness) * (0.20 + 0.60 * fresnel);
        result = mix(result, environment * mix(vec3(1.0), baseColor.rgb * 2.4, uMetallic), mirror);
        result += pow(max(dot(viewDir, reflectedLight), 0.0), mix(120.0, 18.0, uRoughness)) * uSunColor * uMetallic * 1.4;
    }
    if (uWater == 1) {
        // agua: la textura se desliza en dos capas, el color viene por vertice (turquesa en la orilla, verde oscuro al fondo) y la
        // transparencia crece con la profundidad; el cielo se refleja mas con el angulo rasante y el sol deja un brillo nitido
        const vec2 flow1 = vFragPos.xz * 0.045 + vec2(uTime * 0.012, uTime * 0.007);
        const vec2 flow2 = vFragPos.xz * 0.083 + vec2(-uTime * 0.009, uTime * 0.011);
        vec3 detail = (texture(uTexture, flow1).rgb + texture(uTexture, flow2).rgb) * 0.5;
        if (uGammaCorrect == 1) detail = srgbToLinear(detail);
        const vec3 tint = uGammaCorrect == 1 ? srgbToLinear(clamp(vColor.rgb, 0.0, 1.0)) : vColor.rgb;
        const vec3 body = tint * (0.45 + detail * 1.25);
        const float fresnel = pow(1.0 - max(dot(norm, viewDir), 0.0), 3.0);
        const float light = clamp(dot(uAmbientColor + uSunColor, vec3(0.34)), 0.08, 1.3);
        const vec3 zenith = (uGammaCorrect == 1 ? vec3(0.07, 0.20, 0.55) : vec3(0.30, 0.50, 0.85)) * light;
        const vec3 sky = mix(fogColor, zenith, 0.6);
        vec3 water = (ambient + diffuse * 0.6) * body;
        water = mix(water, sky, 0.12 + 0.6 * fresnel);
        const vec3 mirror = reflect(-viewDir, norm);
        water += uSunColor * pow(max(dot(mirror, lightDir), 0.0), 110.0) * 2.2 + uSunColor * pow(max(dot(mirror, lightDir), 0.0), 12.0) * 0.08;
        result = water;
        baseColor.a = clamp(vColor.a * uAlbedo.a + fresnel * 0.3, 0.0, 0.96);
    }
    // farolas encendidas: luz puntual calida con caida suave hasta su alcance
    for (int i = 0; i < uLampCount; ++i) {
        const vec3 toLamp = uLampPosition[i].xyz - vFragPos;
        const float lampDistance = length(toLamp);
        const float lampRange = uLampPosition[i].w;
        if (lampDistance >= lampRange) continue;
        float falloff = 1.0 - lampDistance / lampRange;
        falloff *= falloff;
        const float facingLamp = max(dot(norm, toLamp / max(lampDistance, 0.001)), 0.0) * 0.8 + 0.2;
        result += baseColor.rgb * uLampColor[i].rgb * uLampColor[i].w * falloff * facingLamp;
    }
    if (uWetness > 0.0 && uWater == 0) {
        // superficies que miran hacia arriba (calles, andenes): mas oscuras, con brillo del sol y reflejo del cielo
        const float wet = uWetness * smoothstep(0.75, 0.95, norm.y);
        const float facing = max(dot(norm, viewDir), 0.0);
        result *= 1.0 - 0.2 * wet;
        result += pow(max(dot(viewDir, reflectedLight), 0.0), 40.0) * uSunColor * 0.7 * wet;
        result = mix(result, fogColor, 0.2 * wet * pow(1.0 - facing, 3.0));
    }

    float dist = length(uCameraPos - vFragPos);
    float fogFactor = 1.0 - exp(-dist * uFogDensity);
    fogFactor = clamp(fogFactor, 0.0, 1.0);
    // la niebla se mezcla ya en sRGB (espacio de pantalla): asi la distancia conserva el mismo velo que antes de la correccion gamma
    vec3 displayColor = uGammaCorrect == 1 ? linearToSrgb(result) : result;
    vec3 displayBase = uGammaCorrect == 1 ? linearToSrgb(baseColor.rgb) : baseColor.rgb;
    result = mix(displayColor, uFogColor, fogFactor);
    // bombillas y halos: casi no los apaga la niebla, se ven encendidos desde lejos
    if (uUnlit == 1) result = mix(displayBase, uFogColor, fogFactor * 0.25);
    else if (uUnlit == 2) result = displayBase;   // cielo: las estrellas no llevan niebla

    if (uContrast != 1.0 || uSaturation != 1.0 || uHueDegrees != 0.0) {
        const vec3 luma = vec3(0.2126, 0.7152, 0.0722);
        result = mix(vec3(dot(result, luma)), result, uSaturation);
        const float angle = radians(uHueDegrees);
        const float c = cos(angle);
        const float s = sin(angle);
        result = vec3(
            dot(vec3(0.213 + 0.787 * c - 0.213 * s, 0.715 - 0.715 * c - 0.715 * s, 0.072 - 0.072 * c + 0.928 * s), result),
            dot(vec3(0.213 - 0.213 * c + 0.143 * s, 0.715 + 0.285 * c + 0.140 * s, 0.072 - 0.072 * c - 0.283 * s), result),
            dot(vec3(0.213 - 0.213 * c - 0.787 * s, 0.715 - 0.715 * c + 0.715 * s, 0.072 + 0.928 * c + 0.072 * s), result));
        result = clamp((result - 0.5) * uContrast + 0.5, 0.0, 1.0);
    }
    FragColor = vec4(result, baseColor.a);
}
