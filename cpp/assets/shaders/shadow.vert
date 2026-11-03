#version 450 core

// Pasada de profundidad desde la luz: solo posicion (con piel, viento y separacion de la ropa como en default.vert)
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aUV;
layout(location = 4) in vec4 aJoints;
layout(location = 5) in vec4 aWeights;

layout(std140, binding = 2) uniform SkinBlock {
    mat4 uBones[128];
};

uniform mat4 uLightViewProjection;
uniform mat4 uModel;
uniform int uSkinned;
uniform int uBoneCount;
uniform float uSway = 0.0;
uniform float uPushOut = 0.0;

out vec2 vUV;

void main() {
    vec4 localPos = vec4(aPos, 1.0);
    vec3 localNormal = aNormal;
    if (uSkinned == 1) {
        ivec4 joints = clamp(ivec4(aJoints), ivec4(0), ivec4(max(uBoneCount - 1, 0)));
        float weightSum = dot(aWeights, vec4(1.0));
        if (weightSum > 0.0001) {
            vec4 weights = aWeights / weightSum;
            mat4 skin = uBones[joints.x] * weights.x + uBones[joints.y] * weights.y + uBones[joints.z] * weights.z + uBones[joints.w] * weights.w;
            localPos = skin * localPos;
            localNormal = mat3(skin) * localNormal;
        }
    }
    if (uPushOut != 0.0) localPos.xyz += normalize(localNormal) * uPushOut;
    vec4 worldPos = uModel * localPos;
    if (uSway > 0.0) {
        float h = clamp((worldPos.y - uModel[3].y) / 5.4, 0.0, 1.0);
        float phase = 0.0;   // el viento solo mece unos centimetros: la sombra no necesita seguirlo
        worldPos.xz += vec2(0.8, 0.6) * sin(phase) * uSway * h * h;
    }
    vUV = aUV;
    gl_Position = uLightViewProjection * worldPos;
}
