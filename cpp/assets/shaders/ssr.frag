#version 450 core
// Reflejos en espacio de pantalla (a media resolucion) con la normal de cada pixel: el G-buffer guarda la normal del mundo (octaedrica en rg) y la
// reflectividad del pixel (b: charcos y suelo mojado). Se reconstruye la posicion en la vista con la profundidad, se refleja el rayo de vista con esa
// normal (incluidas las ondas de las gotas) y se recorre en la vista contra la profundidad de la escena actual. Salida: rgb color reflejado, a peso.
in vec2 vUV;
layout(binding = 0) uniform sampler2D uColor;
layout(binding = 1) uniform sampler2D uDepth;
layout(binding = 2) uniform sampler2D uGBuffer;
uniform mat4 uProjection;
uniform mat4 uInvProjection;
uniform mat4 uView;
out vec4 FragColor;

vec3 octDecode(vec2 f) {
    f = f * 2.0 - 1.0;
    vec3 n = vec3(f.x, f.y, 1.0 - abs(f.x) - abs(f.y));
    if (n.z < 0.0) n.xy = (1.0 - abs(n.yx)) * vec2(n.x >= 0.0 ? 1.0 : -1.0, n.y >= 0.0 ? 1.0 : -1.0);
    return normalize(n);
}
vec3 viewPosition(vec2 uv) {
    const float depth = texture(uDepth, uv).r;
    const vec4 p = uInvProjection * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    return p.xyz / p.w;
}
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }

void main() {
    const vec4 g = texture(uGBuffer, vUV);
    if (g.b < 0.10 || texture(uDepth, vUV).r >= 0.99999) { FragColor = vec4(0.0); return; }
    const vec3 position = viewPosition(vUV);
    const vec3 normal = normalize(mat3(uView) * octDecode(g.rg));
    const vec3 incident = normalize(position);
    const vec3 reflected = reflect(incident, normal);
    if (reflected.z > -0.04) { FragColor = vec4(0.0); return; }   // el rayo vuelve hacia la camara: no hay nada que encontrar en pantalla
    const float jitter = hash(gl_FragCoord.xy);
    float travelled = 0.12 + 0.10 * jitter;
    vec4 result = vec4(0.0);
    for (int i = 0; i < 28; ++i) {
        const vec3 point = position + reflected * travelled;
        const vec4 clip = uProjection * vec4(point, 1.0);
        if (clip.w <= 0.02) break;
        const vec2 uv = clip.xy / clip.w * 0.5 + 0.5;
        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;
        const float sceneDepth = texture(uDepth, uv).r;
        if (sceneDepth < 0.99999) {
            const float sceneZ = viewPosition(uv).z;
            const float gap = sceneZ - point.z;   // positivo: el punto del rayo esta detras de la superficie
            if (gap > 0.0 && gap < 0.6 + travelled * 0.25) {
                // refinamiento: se retrocede por mitades hasta apoyarse en la superficie
                float low = travelled * 0.8, high = travelled;
                for (int j = 0; j < 4; ++j) {
                    const float mid = (low + high) * 0.5;
                    const vec3 p2 = position + reflected * mid;
                    const vec4 c2 = uProjection * vec4(p2, 1.0);
                    const vec2 uv2 = c2.xy / c2.w * 0.5 + 0.5;
                    if (viewPosition(uv2).z - p2.z > 0.0) high = mid; else low = mid;
                }
                const vec4 hitClip = uProjection * vec4(position + reflected * high, 1.0);
                const vec2 hitUv = hitClip.xy / hitClip.w * 0.5 + 0.5;
                const float edge = min(min(hitUv.x, 1.0 - hitUv.x), min(hitUv.y, 1.0 - hitUv.y));
                const float fresnel = 0.04 + 0.96 * pow(1.0 - max(dot(normal, -incident), 0.0), 5.0);
                result = vec4(texture(uColor, hitUv).rgb, smoothstep(0.0, 0.1, edge) * clamp(fresnel * 2.4 + 0.20, 0.0, 0.85) * g.b * (1.0 - float(i) / 28.0 * 0.5));
                break;
            }
        }
        travelled *= 1.17;
    }
    FragColor = result;
}
