#version 450 core
// Desenfoque de la oclusion que respeta los bordes: cada lectura pesa segun cuanto se aleja su profundidad de la del pixel (3 x 3 a media
// resolucion), asi la oclusion de un muro no se corre sobre el cielo ni sobre lo que tiene detras y las fachadas no quedan empañadas.
in vec2 vUV;
layout(binding = 0) uniform sampler2D uAo;
layout(binding = 1) uniform sampler2D uDepth;
uniform mat4 uInvProjection;
out float FragColor;
float viewDepth(vec2 uv) {
    const float depth = texture(uDepth, uv).r;
    const vec4 p = uInvProjection * vec4(0.0, 0.0, depth * 2.0 - 1.0, 1.0);
    return -p.z / p.w;
}
void main() {
    const vec2 texel = 1.0 / vec2(textureSize(uAo, 0));
    const float center = viewDepth(vUV);
    float sum = 0.0, weights = 0.0;
    for (int y = -1; y <= 1; ++y) {
        for (int x = -1; x <= 1; ++x) {
            const vec2 uv = vUV + texel * vec2(float(x), float(y)) * 1.5;
            const float difference = abs(viewDepth(uv) - center);
            const float w = exp(-difference / (0.03 * center + 0.04));
            sum += texture(uAo, uv).r * w;
            weights += w;
        }
    }
    FragColor = sum / max(weights, 1.0e-4);
}
