#version 450 core
// Ampliacion de la cadena de bloom: filtro de tienda (3 x 3) que se suma al nivel de arriba (mezcla aditiva)
in vec2 vUV;
layout(binding = 0) uniform sampler2D uImage;
out vec4 FragColor;
void main() {
    const vec2 t = 1.0 / vec2(textureSize(uImage, 0));
    vec3 s = texture(uImage, vUV + t * vec2(-1.0, -1.0)).rgb + texture(uImage, vUV + t * vec2(1.0, -1.0)).rgb
           + texture(uImage, vUV + t * vec2(-1.0, 1.0)).rgb + texture(uImage, vUV + t * vec2(1.0, 1.0)).rgb;
    s += 2.0 * (texture(uImage, vUV + t * vec2(0.0, -1.0)).rgb + texture(uImage, vUV + t * vec2(-1.0, 0.0)).rgb
              + texture(uImage, vUV + t * vec2(1.0, 0.0)).rgb + texture(uImage, vUV + t * vec2(0.0, 1.0)).rgb);
    s += 4.0 * texture(uImage, vUV).rgb;
    FragColor = vec4(s / 16.0, 1.0);
}
