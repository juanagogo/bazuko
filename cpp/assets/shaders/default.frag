#version 450 core

in vec3 vFragPos;
in vec3 vNormal;
in vec2 vUV;
in vec4 vColor;
in vec2 vGrass;
uniform int uGrass = 0;
in vec4 vTangent;

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
    vec4 uLampPosition[256];
    vec4 uLampColor[256];
};

// Clustered forward shading: cada celda (16 x 9 x 24, profundidad logaritmica) guarda la lista de luces que la tocan (Renderer::BuildClusters)
#define CLUSTER_X 16
#define CLUSTER_Y 9
#define CLUSTER_Z 24
layout(std430, binding = 3) readonly buffer ClusterTable { uvec2 uClusterRange[]; };   // x desplazamiento, y cantidad
layout(std430, binding = 4) readonly buffer ClusterIndices { uint uClusterIndex[]; };
uniform float uClusterNear = 0.1;
uniform float uClusterFar = 500.0;
uniform vec2 uViewportSize = vec2(1920.0, 1080.0);
uvec2 clusterRangeAt(vec3 worldPos) {
    const float depth = -(uView * vec4(worldPos, 1.0)).z;
    const int slice = clamp(int(floor(log(max(depth, uClusterNear) / uClusterNear) / log(uClusterFar / uClusterNear) * float(CLUSTER_Z))), 0, CLUSTER_Z - 1);
    const ivec2 tile = clamp(ivec2(gl_FragCoord.xy / uViewportSize * vec2(float(CLUSTER_X), float(CLUSTER_Y))), ivec2(0), ivec2(CLUSTER_X - 1, CLUSTER_Y - 1));
    return uClusterRange[(slice * CLUSTER_Y + tile.y) * CLUSTER_X + tile.x];
}

uniform vec4 uAlbedo;
uniform int uUseTexture;
uniform int uUnlit = 0;   // 1 bombillas (sin iluminacion), 2 cielo (sin iluminacion ni niebla)
uniform int uAlphaMode;
uniform int uWater = 0;
// Sombras: mapa de profundidad de la luz alrededor del jugador (ver Renderer::RenderShadowMap)
uniform int uShadowEnabled = 0;
uniform mat4 uShadowMatrix;
uniform vec3 uShadowCenter;
uniform vec3 uShadowBias = vec3(0.5, 1.0, 0.00025);   // desplazamiento sobre la normal (texeles: base y por pendiente) y sesgo de profundidad
uniform vec3 uShadowParams;   // x alcance (m), y metros por pixel del mapa, z 1 / resolucion
layout(binding = 4) uniform sampler2DShadow uShadowMap;
uniform int uFarShadowEnabled = 0;   // sombra lejana (calidad alta): mapa de 1024 px y 170 m de radio que se rehace cada ~1,5 s
uniform mat4 uFarShadowMatrix;
uniform vec3 uFarShadowCenter;
layout(binding = 7) uniform sampler2DShadow uFarShadowMap;
uniform int uUltraShadowEnabled = 0;   // tercera cascada: 450 m con solo la ciudad fija
uniform mat4 uUltraShadowMatrix;
uniform vec3 uUltraShadowCenter;
layout(binding = 8) uniform sampler2DShadow uUltraShadowMap;
uniform float uAlphaCutoff;
layout(binding = 0) uniform sampler2D uTexture;
layout(binding = 1) uniform sampler2D uSpecularTexture;
uniform int uUseSpecularTexture;
layout(binding = 2) uniform sampler2D uNormalTexture;   // mapa de normales en espacio tangente (relieve de ladrillo, laminas, ropa)
uniform int uUseNormalTexture = 0;
uniform int uDebugShadow = 0;   // diagnostico: muestra solo el termino de sombra
uniform float uHeightFog = 0.0;   // niebla por altura: la bruma se espesa cerca del suelo
// Reflejos en pantalla: el cuadro anterior (color y profundidad) sirve de escena reflejada en los charcos
uniform int uUseSsr = 0;
uniform mat4 uPreviousViewProjection;
layout(binding = 5) uniform sampler2D uPreviousColor;
layout(binding = 6) uniform sampler2D uPreviousDepth;
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
layout(location = 1) out vec4 GBuffer;   // normal del mundo (octaedrica en rg) y reflectividad (b): lo usan los reflejos en pantalla
// Normal en octaedro (2 canales de 8 bits): lo que se guarda en el G-buffer para los reflejos en pantalla
vec2 octEncode(vec3 n) {
    n /= (abs(n.x) + abs(n.y) + abs(n.z));
    vec2 e = n.xy;
    if (n.z < 0.0) e = (1.0 - abs(e.yx)) * vec2(n.x >= 0.0 ? 1.0 : -1.0, n.y >= 0.0 ? 1.0 : -1.0);
    return e * 0.5 + 0.5;
}

// 1 = iluminado, 0 = en sombra. Pixel desplazado a lo largo de la normal contra el moire, filtro de 3 x 3 y desvanecido hacia el borde del mapa
float shadowFactor(vec3 pos, vec3 n, vec3 l) {
    float distanceFromCenter = distance(pos.xz, uShadowCenter.xz);
    float fade = 1.0 - smoothstep(uShadowParams.x * 0.78, uShadowParams.x * 0.96, distanceFromCenter);
    float nearShadow = 1.0;
    float slope = 1.0 - clamp(dot(n, l), 0.0, 1.0);
    if (fade > 0.0) {
        vec3 p = pos + n * (uShadowParams.y * (uShadowBias.x + uShadowBias.y * slope));
        vec4 c = uShadowMatrix * vec4(p, 1.0);
        vec3 s = c.xyz / c.w;
        if (!(s.x < 0.0 || s.x > 1.0 || s.y < 0.0 || s.y > 1.0 || s.z > 1.0)) {
            // 8 muestras en espiral (disco de Vogel) giradas al azar por pixel: el borde de la sombra pierde los escalones del texel
            // y queda con un grano fino en lugar de una rejilla; cada muestra ya es un filtro bilineal por hardware
            const float turn = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) * 6.2831853;
            float sum = 0.0;
            for (int i = 0; i < 8; ++i) {
                const float radius = sqrt((float(i) + 0.5) / 8.0) * 1.7;
                const float angle = float(i) * 2.39996323 + turn;
                sum += texture(uShadowMap, vec3(s.xy + vec2(cos(angle), sin(angle)) * radius * uShadowParams.z, s.z - uShadowBias.z));
            }
            nearShadow = sum / 8.0;
        }
    }
    float ultraShadow = 1.0;
    if (uUltraShadowEnabled == 1 && fade < 1.0) {   // mas alla de la lejana: la ciudad fija a 450 m (un texel mide ~0,9 m: sesgo grande)
        float ultraFade = 1.0 - smoothstep(450.0 * 0.80, 450.0 * 0.97, distance(pos.xz, uUltraShadowCenter.xz));
        if (ultraFade > 0.0) {
            vec3 p = pos + n * (0.9 * (1.5 + 2.0 * slope));
            vec4 c = uUltraShadowMatrix * vec4(p, 1.0);
            vec3 s = c.xyz / c.w;
            if (!(s.x < 0.0 || s.x > 1.0 || s.y < 0.0 || s.y > 1.0 || s.z > 1.0))
                ultraShadow = mix(1.0, texture(uUltraShadowMap, vec3(s.xy, s.z - 0.0016)), ultraFade);
        }
    }
    float farShadow = ultraShadow;
    if (uFarShadowEnabled == 1 && fade < 1.0) {   // mas alla del mapa cercano: sombra lejana, con una sola lectura filtrada por hardware
        float farFade = 1.0 - smoothstep(170.0 * 0.80, 170.0 * 0.97, distance(pos.xz, uFarShadowCenter.xz));
        if (farFade > 0.0) {
            vec3 p = pos + n * (0.35 * 2.0 * (1.0 + 1.5 * slope));
            vec4 c = uFarShadowMatrix * vec4(p, 1.0);
            vec3 s = c.xyz / c.w;
            if (!(s.x < 0.0 || s.x > 1.0 || s.y < 0.0 || s.y > 1.0 || s.z > 1.0))
                farShadow = mix(ultraShadow, texture(uFarShadowMap, vec3(s.xy, s.z - 0.0009)), farFade);
        }
    }
    return mix(farShadow, mix(1.0, nearShadow, 1.0), fade);
}

// Ruido de valor (charcos) y ondas de gotas (anillos que se abren y se desvanecen en una rejilla); solo se usan con el suelo mojado
float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float valueNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}
vec2 rainRipples(vec2 p, float t) {
    vec2 slope = vec2(0.0);
    for (int layer = 0; layer < 2; ++layer) {
        const vec2 q = p * (2.2 + float(layer) * 1.3) + float(layer) * 17.0;
        const vec2 cell = floor(q);
        const vec2 offset = fract(q) - 0.5;
        const float seed = hash21(cell);
        const float phase = fract(t * (0.8 + 0.3 * seed) + seed * 7.0);
        const float ring = length(offset) - phase * 0.45;
        const float strength = (1.0 - phase) * (1.0 - phase) * exp(-ring * ring * 700.0);
        slope += normalize(offset + 1.0e-4) * cos(ring * 38.0) * strength;
    }
    return slope;
}

// Traza el rayo reflejado (8 pasos que se alargan) contra la profundidad del cuadro anterior; devuelve el color del acierto y su peso (0 sin acierto)
vec4 screenReflection(vec3 origin, vec3 direction) {
    float t = 0.5;
    for (int i = 0; i < 8; ++i) {
        const vec4 clip = uPreviousViewProjection * vec4(origin + direction * t, 1.0);
        if (clip.w <= 0.05) return vec4(0.0);
        const vec2 uv = clip.xy / clip.w * 0.5 + 0.5;
        if (uv.x < 0.02 || uv.x > 0.98 || uv.y < 0.02 || uv.y > 0.98) return vec4(0.0);
        const float sceneDepth = texture(uPreviousDepth, uv).r;
        const float n = uClusterNear, f = uClusterFar;
        const float sceneLinear = 2.0 * n * f / (f + n - (sceneDepth * 2.0 - 1.0) * (f - n));
        const float rayLinear = clip.w;
        if (sceneDepth < 0.99999 && rayLinear > sceneLinear && rayLinear - sceneLinear < 1.0 + t * 0.25) {
            const float edge = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
            return vec4(texture(uPreviousColor, uv).rgb, smoothstep(0.02, 0.12, edge) * (1.0 - float(i) / 8.0 * 0.5));
        }
        t *= 1.6;
    }
    return vec4(0.0);
}

void main() {
    vec3 norm = normalize(vNormal);
    if (uUseNormalTexture == 1 && uWater == 0) {   // se inclina la normal con el mapa: base TBN (tangente, bitangente, normal) en el mundo
        vec3 tangent = vTangent.xyz - norm * dot(norm, vTangent.xyz);
        if (dot(tangent, tangent) > 1.0e-8) {
            tangent = normalize(tangent);
            const vec3 bitangent = cross(norm, tangent) * vTangent.w;
            vec3 tn = texture(uNormalTexture, vUV).xyz * 2.0 - 1.0;
            tn.xy *= 1.0;
            norm = normalize(mat3(tangent, bitangent, norm) * normalize(tn));
        }
    }
    vec3 gNormal = norm;      // normal que se guarda en el G-buffer (la del suelo mojado lleva las ondas de las gotas)
    float gReflect = 0.0;     // reflectividad: 0 en casi todo, hasta 1 en los charcos
    vec3 lightDir = normalize(-uSunDir);

    float diff = max(dot(norm, lightDir), 0.0);
    float shadow = 1.0;
    if (uShadowEnabled == 1 && uUnlit == 0 && uWater == 0 && diff > 0.0) shadow = shadowFactor(vFragPos, norm, lightDir);
    vec3 diffuse = diff * uSunColor * shadow;
    vec3 ambient = uAmbientColor;
    vec3 viewDir = normalize(uCameraPos - vFragPos);
    vec3 reflectedLight = reflect(-lightDir, norm);
    float specularStrength = uUseSpecularTexture == 1
        ? texture(uSpecularTexture, vUV).r * 0.35 : 0.0;
    vec3 specular = pow(max(dot(viewDir, reflectedLight), 0.0), 24.0)
        * uSunColor * specularStrength * shadow;

    vec4 baseColor = uAlbedo * vColor;
    if (uGammaCorrect == 1) baseColor.rgb = srgbToLinear(clamp(baseColor.rgb, 0.0, 1.0));
    if (uUseTexture == 1) {
        vec4 texel = texture(uTexture, vUV);
        if (uGammaCorrect == 1) texel.rgb = srgbToLinear(texel.rgb);
        baseColor *= texel;
    }
    if (uGrass == 1) {   // pasto sin textura: raiz oscura y punta clara, y cada mata con su propio matiz entre verde fresco y paja
        const float tip = smoothstep(0.0, 0.55, vGrass.x);
        const vec3 variation = mix(vec3(0.86, 1.04, 0.80), vec3(1.18, 1.05, 0.62), vGrass.y);
        baseColor.rgb *= mix(0.38, 1.22, tip) * variation;
    }
    const vec3 fogColor = uGammaCorrect == 1 ? srgbToLinear(uFogColor) : uFogColor;
    if (uAlphaMode == 1) {
        // alfa a cobertura (MSAA): el borde de hojas y pasto se suaviza con las muestras en vez de dentarse; el ancho sale de la derivada del alfa
        const float softness = max(fwidth(baseColor.a), 0.02);
        const float coverage = clamp((baseColor.a - uAlphaCutoff) / softness + 0.5, 0.0, 1.0);
        if (coverage <= 0.0) discard;
        baseColor.a = coverage;
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
    const uvec2 clusterLights = clusterRangeAt(vFragPos);   // solo las luces de mi celda
    for (uint k = 0u; k < clusterLights.y; ++k) {
        const uint i = uClusterIndex[clusterLights.x + k];
        const vec3 toLamp = uLampPosition[i].xyz - vFragPos;
        const float lampDistance = length(toLamp);
        const float lampRange = uLampPosition[i].w;
        if (lampDistance >= lampRange) continue;
        float falloff = 1.0 - lampDistance / lampRange;
        falloff *= falloff;
        const float facingLamp = max(dot(norm, toLamp / max(lampDistance, 0.001)), 0.0) * 0.8 + 0.2;
        result += baseColor.rgb * uLampColor[i].rgb * uLampColor[i].w * falloff * facingLamp;
    }
    if (uWetness > 0.0 && uWater == 0 && norm.y > 0.75) {   // solo superficies horizontales
        // Suelo mojado: las superficies horizontales (calles, andenes) se oscurecen al absorber agua y, donde se forman charcos, su rugosidad baja
        // hasta 0,02: reflejan el sol, el cielo y las farolas casi como un espejo. Las gotas dibujan ondas sobre los charcos mientras llueve.
        const float horizontal = smoothstep(0.75, 0.95, norm.y);
        const float wet = uWetness * horizontal;
        const float puddleNoise = valueNoise(vFragPos.xz * 0.22) * 0.65 + valueNoise(vFragPos.xz * 0.9) * 0.35;
        const float puddle = wet * smoothstep(0.50, 0.68, puddleNoise + (uWetness - 1.0) * 0.28);   // donde se acumula el agua
        const float roughness = mix(mix(0.55, 0.22, wet), 0.02, puddle);
        vec3 wetNormal = norm;
        if (puddle > 0.05) {
            const vec2 slope = rainRipples(vFragPos.xz, uTime) * 0.22 * puddle;
            wetNormal = normalize(norm + vec3(slope.x, 0.0, slope.y));
        }
        gNormal = wetNormal;
        gReflect = puddle;
        const vec3 reflection = reflect(-viewDir, wetNormal);
        const float facing = max(dot(wetNormal, viewDir), 0.0);
        const float fresnel = 0.04 + 0.96 * pow(1.0 - facing, 5.0);
        const float shininess = 2.0 / (roughness * roughness + 1.0e-4) - 2.0;
        result *= 1.0 - mix(0.18, 0.45, puddle) * wet;
        // reflejo del sol (nitido en los charcos) y del cielo (la niebla hace de horizonte)
        result += pow(max(dot(reflection, lightDir), 0.0), min(shininess, 900.0)) * uSunColor * (0.5 + 4.0 * puddle) * wet * shadow;
        const vec3 skyTone = mix(fogColor, vec3(0.07, 0.20, 0.55) * clamp(dot(uAmbientColor + uSunColor, vec3(0.34)), 0.08, 1.3), clamp(reflection.y, 0.0, 1.0));
        result = mix(result, skyTone, clamp(fresnel * (0.25 + 0.75 * puddle) * 1.6, 0.0, 0.85) * wet);
        if (uUseSsr == 1 && puddle > 0.12 && reflection.y > 0.05) {   // en los charcos se reflejan los edificios, los carros y la gente que ya se ven en pantalla
            const vec4 hit = screenReflection(vFragPos + wetNormal * 0.05, reflection);
            result = mix(result, srgbToLinear(hit.rgb), hit.a * clamp(fresnel * 2.2 + 0.18, 0.0, 0.8) * puddle);
        }
        // reflejo de las luces locales (farolas, faros, balizas): la mancha se estira hacia quien mira, como en el asfalto mojado
        for (uint k = 0u; k < clusterLights.y; ++k) {
            const uint i = uClusterIndex[clusterLights.x + k];
            const vec3 toLamp = uLampPosition[i].xyz - vFragPos;
            const float lampDistance = length(toLamp);
            const float lampRange = uLampPosition[i].w;
            if (lampDistance >= lampRange) continue;
            float falloff = 1.0 - lampDistance / lampRange;
            falloff *= falloff;
            const float glint = pow(max(dot(reflection, toLamp / max(lampDistance, 0.001)), 0.0), mix(60.0, 420.0, puddle));
            result += uLampColor[i].rgb * uLampColor[i].w * falloff * glint * (0.35 + 1.4 * puddle) * wet;
        }
    }

    float dist = length(uCameraPos - vFragPos);
    const float meanHeight = max(0.0, (vFragPos.y + uCameraPos.y) * 0.5);
    float fogFactor = 1.0 - exp(-dist * uFogDensity * (1.0 + uHeightFog * exp(-meanHeight * 0.16)));   // mas densa cerca del suelo
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
    if (uDebugShadow == 1 && uUnlit == 0 && uWater == 0 && baseColor.a > 0.5) result = vec3(shadow * max(dot(norm, lightDir), 0.0) * 0.8 + 0.1);
    GBuffer = vec4(octEncode(normalize(gNormal)), gReflect, 1.0);
    FragColor = vec4(result, baseColor.a);
}
