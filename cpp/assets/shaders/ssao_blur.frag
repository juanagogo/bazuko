#version 450 core
// Desenfoque 4 x 4 de la oclusion (quita el ruido del giro aleatorio por pixel)
in vec2 vUV;
layout(binding = 0) uniform sampler2D uAo;
out float FragColor;
void main() {
    const vec2 texel = 1.0 / vec2(textureSize(uAo, 0));
    // cuatro lecturas bilineales en los vertices equivalen a una caja de 4 x 4
    FragColor = 0.25 * (texture(uAo, vUV + texel * vec2(-1.0, -1.0)).r + texture(uAo, vUV + texel * vec2(1.0, -1.0)).r
                      + texture(uAo, vUV + texel * vec2(-1.0, 1.0)).r + texture(uAo, vUV + texel * vec2(1.0, 1.0)).r);
}
