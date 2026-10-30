#version 450 core
in vec2 vUV;
layout(binding = 0) uniform sampler2D uImage;
out vec4 FragColor;
void main() {
    FragColor = vec4(texture(uImage, vUV).rgb, 1.0);
}
