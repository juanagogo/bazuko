#version 450 core
// SSAO: oclusion ambiental en espacio de pantalla a media resolucion. Se reconstruye la posicion en la vista con la profundidad, la normal sale de
// las derivadas de la posicion y se comparan puntos de un hemisferio (espiral de Fibonacci girada al azar por pixel) con la profundidad de la escena.
in vec2 vUV;
layout(binding = 0) uniform sampler2D uDepth;
uniform mat4 uInvProjection;
uniform mat4 uProjection;
uniform int uSamples = 8;
uniform float uRadius = 0.9;     // metros
uniform float uBias = 0.03;
uniform vec3 uSunView = vec3(0.0, 1.0, 0.0);   // direccion hacia el sol en la vista
uniform float uContact = 0.0;                  // fuerza de las sombras de contacto (0 las apaga: de noche o con cielo cubierto)
out float FragColor;

vec3 viewPosition(vec2 uv) {
    const float depth = texture(uDepth, uv).r;
    const vec4 p = uInvProjection * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    return p.xyz / p.w;
}
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }

void main() {
    if (texture(uDepth, vUV).r >= 0.99999) { FragColor = 1.0; return; }   // cielo
    const vec3 position = viewPosition(vUV);
    vec3 normal = normalize(cross(dFdx(position), dFdy(position)));
    if (dot(normal, -position) < 0.0) normal = -normal;
    const float angle = hash(gl_FragCoord.xy) * 6.2831853;
    const vec3 randomVector = vec3(cos(angle), sin(angle), 0.0);
    vec3 tangent = randomVector - normal * dot(randomVector, normal);
    if (dot(tangent, tangent) < 1.0e-6) tangent = cross(normal, vec3(0.0, 1.0, 0.0));
    tangent = normalize(tangent);
    const mat3 basis = mat3(tangent, cross(normal, tangent), normal);
    float occlusion = 0.0;
    for (int i = 0; i < uSamples; ++i) {
        const float f = (float(i) + 0.5) / float(uSamples);
        const float r = sqrt(f);
        const float phi = float(i) * 2.39996323 + angle;
        const vec3 hemisphere = vec3(cos(phi) * r, sin(phi) * r, sqrt(max(1.0 - f, 0.0)));
        const vec3 samplePosition = position + basis * hemisphere * (uRadius * mix(0.2, 1.0, f * f));
        const vec4 projected = uProjection * vec4(samplePosition, 1.0);
        const vec2 uv = projected.xy / projected.w * 0.5 + 0.5;
        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) continue;
        const float sceneZ = viewPosition(uv).z;   // z de la vista: negativo hacia adelante
        const float range = smoothstep(0.0, 1.0, uRadius / max(abs(position.z - sceneZ), 1.0e-4));
        occlusion += (sceneZ >= samplePosition.z + uBias ? 1.0 : 0.0) * range;
    }
    float result = clamp(1.0 - occlusion / float(uSamples) * 1.15, 0.0, 1.0);
    if (uContact > 0.0) {
        // sombras de contacto: un rayo corto hacia el sol contra la profundidad. Aporta la autosombra fina (pliegues, balcones, hojas, ropa)
        // que el mapa de sombras no resuelve; solo en superficies de cara al sol, y atenuada hacia el final del rayo
        const float facing = dot(normal, uSunView);
        if (facing > 0.05) {
            const float jitter = hash(gl_FragCoord.xy + 7.0);
            float blocked = 0.0;
            for (int i = 0; i < 10; ++i) {
                const float t = (float(i) + 0.4 + jitter) / 10.0;
                const vec3 point = position + uSunView * (t * t * 0.9) + normal * 0.02;
                const vec4 clip = uProjection * vec4(point, 1.0);
                const vec2 uv = clip.xy / clip.w * 0.5 + 0.5;
                if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;
                if (texture(uDepth, uv).r >= 0.99999) continue;
                const float gap = viewPosition(uv).z - point.z;   // positivo: algo de la escena queda delante del punto del rayo
                if (gap > 0.025 && gap < 0.3 + t * 0.4) { blocked = 1.0 - t * 0.5; break; }
            }
            result *= 1.0 - uContact * blocked * smoothstep(0.05, 0.35, facing);
        }
    }
    FragColor = result;
}
