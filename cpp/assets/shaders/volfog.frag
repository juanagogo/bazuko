#version 450 core
// Niebla volumetrica: se recorre cada rayo de vista desde la camara hasta la superficie (a media resolucion). En cada paso se suma la luz del sol
// que se dispersa en el aire, atenuada por el mapa de sombras (por eso los edificios y el viaducto dejan haces), mas un aporte tenue del ambiente;
// la transmitancia dice cuanto de la escena se ve a traves de la niebla. Salida: rgb = luz dispersada (lineal), a = transmitancia.
in vec2 vUV;
layout(binding = 0) uniform sampler2D uDepth;
layout(binding = 1) uniform sampler2DShadow uShadowMap;
uniform mat4 uInvViewProjection;
uniform mat4 uShadowMatrix;
uniform vec3 uShadowCenter;
uniform float uShadowRadius = 50.0;
uniform vec3 uCameraPos;
uniform vec3 uToLight;       // direccion hacia el sol (o la luna)
uniform vec3 uSunColor;
uniform vec3 uAmbient;
uniform float uDensity = 0.01;     // extincion por metro a nivel del suelo
uniform float uHeightBoost = 1.0;  // la niebla se espesa cerca del suelo
uniform float uMaxDistance = 90.0; // hasta donde se recorre el rayo (el cielo y lo lejano usan este tope)
out vec4 FragColor;

vec3 unproject(vec2 uv, float depth) {
    const vec4 p = uInvViewProjection * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    return p.xyz / p.w;
}
float interleavedNoise(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
float henyeyGreenstein(float cosTheta, float g) {
    const float g2 = g * g;
    return (1.0 - g2) / (12.566370614 * pow(1.0 + g2 - 2.0 * g * cosTheta, 1.5));
}

void main() {
    const float depth = texture(uDepth, vUV).r;
    const vec3 origin = unproject(vUV, 0.0);
    const vec3 farPoint = unproject(vUV, 1.0);
    const vec3 direction = normalize(farPoint - origin);
    const vec3 surface = unproject(vUV, min(depth, 0.99999));
    float rayLength = depth >= 0.99999 ? uMaxDistance : min(length(surface - origin), uMaxDistance);
    rayLength = max(rayLength, 0.1);
    const int kSteps = 14;
    const float stepLength = rayLength / float(kSteps);
    const float jitter = interleavedNoise(gl_FragCoord.xy);
    const float phase = henyeyGreenstein(dot(direction, uToLight), 0.5);
    vec3 scattered = vec3(0.0);
    float transmittance = 1.0;
    for (int i = 0; i < kSteps; ++i) {
        const vec3 position = origin + direction * ((float(i) + jitter) * stepLength);
        const float density = uDensity * (1.0 + uHeightBoost * exp(-max(position.y, 0.0) * 0.16));
        float lit = 1.0;
        if (distance(position.xz, uShadowCenter.xz) < uShadowRadius * 0.95) {   // dentro del mapa de sombras del sol
            const vec4 c = uShadowMatrix * vec4(position, 1.0);
            const vec3 s = c.xyz / c.w;
            if (s.x > 0.0 && s.x < 1.0 && s.y > 0.0 && s.y < 1.0 && s.z < 1.0) lit = texture(uShadowMap, vec3(s.xy, s.z - 0.0008));
        }
        const float extinction = density * stepLength;
        const vec3 light = uSunColor * lit * phase * 12.566370614 * 0.28 + uAmbient * 0.16;   // el factor 4 pi devuelve la fase a una escala de brillo
        scattered += transmittance * (1.0 - exp(-extinction)) * light;
        transmittance *= exp(-extinction);
    }
    FragColor = vec4(scattered, transmittance);
}
