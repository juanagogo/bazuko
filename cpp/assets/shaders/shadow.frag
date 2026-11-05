#version 450 core

in vec2 vUV;

uniform int uUseTexture;
uniform int uAlphaMode;
uniform float uAlphaCutoff;
uniform float uAlbedoAlpha = 1.0;
layout(binding = 0) uniform sampler2D uTexture;

void main() {
    // hojas y recortes: el pixel transparente no proyecta sombra
    if (uAlphaMode == 1) {
        float alpha = uAlbedoAlpha;
        if (uUseTexture == 1) alpha *= texture(uTexture, vUV).a;
        if (alpha < uAlphaCutoff) discard;
    }
}
