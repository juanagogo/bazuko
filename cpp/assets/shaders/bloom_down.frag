#version 450 core
// Reduccion de la cadena de bloom (filtro de 13 muestras, sin parpadeo). En la primera pasada solo pasan los brillos que superan 1 (luces, balizas, relampagos).
in vec2 vUV;
layout(binding = 0) uniform sampler2D uImage;
uniform int uThreshold = 0;
uniform float uKnee = 0.15;
out vec4 FragColor;
vec3 fetch(vec2 uv) {
    vec3 c = texture(uImage, uv).rgb;
    if (uThreshold == 1) {
        c = c * c;   // aproximacion barata de sRGB a lineal (13 muestras por pixel)
        const float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
        const float soft = clamp(lum - 1.0 + uKnee, 0.0, 2.0 * uKnee);
        const float contribution = max(soft * soft / (4.0 * uKnee + 1.0e-4), lum - 1.0) / max(lum, 1.0e-4);
        c *= contribution;
    }
    return c;
}
void main() {
    const vec2 t = 1.0 / vec2(textureSize(uImage, 0));
    const vec3 a = fetch(vUV + t * vec2(-2.0, -2.0)), b = fetch(vUV + t * vec2(0.0, -2.0)), c = fetch(vUV + t * vec2(2.0, -2.0));
    const vec3 d = fetch(vUV + t * vec2(-2.0, 0.0)), e = fetch(vUV), f = fetch(vUV + t * vec2(2.0, 0.0));
    const vec3 g = fetch(vUV + t * vec2(-2.0, 2.0)), h = fetch(vUV + t * vec2(0.0, 2.0)), i = fetch(vUV + t * vec2(2.0, 2.0));
    const vec3 j = fetch(vUV + t * vec2(-1.0, -1.0)), k = fetch(vUV + t * vec2(1.0, -1.0));
    const vec3 l = fetch(vUV + t * vec2(-1.0, 1.0)), m = fetch(vUV + t * vec2(1.0, 1.0));
    vec3 result = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
    FragColor = vec4(min(result, vec3(64.0)), 1.0);   // tope contra destellos enormes
}
