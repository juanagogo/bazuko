#version 450 core

layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aUV;
layout(location = 3) in vec4 aColor;
layout(location = 4) in vec4 aJoints;
layout(location = 5) in vec4 aWeights;

layout(std140, binding = 0) uniform CameraBlock {
    mat4 uView;
    mat4 uProjection;
    mat4 uViewProjection;
    vec3 uCameraPos;
    float uTime;
};

uniform mat4 uModel;
uniform int uSkinned;
uniform vec2 uUvOffset = vec2(0.0);   // desplazamiento de UV (letrero LED del bus)
uniform float uSway = 0.0;      // arboles: amplitud (m) con que la copa se mece con el viento; crece con la altura sobre el pie
uniform float uPushOut = 0.0;   // ropa y calzado: se separan unos milimetros de la piel a lo largo de la normal (ya deformada)
uniform int uBoneCount;
layout(std140, binding = 2) uniform SkinBlock {
    mat4 uBones[128];
};

out vec3 vFragPos;
out vec3 vNormal;
out vec2 vUV;
out vec4 vColor;

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
    if (uSway > 0.0) {   // el viento mece el arbol en el shader, asi los arboles siguen compartiendo lote sin tocar la CPU
        float h = clamp((worldPos.y - uModel[3].y) / 5.4, 0.0, 1.0);
        float phase = uTime * 1.7 + uModel[3].x * 0.31 + uModel[3].z * 0.23 + worldPos.y * 0.6;
        worldPos.xz += vec2(0.8, 0.6) * (sin(phase) + 0.35 * sin(phase * 2.3 + 1.1)) * uSway * h * h;
    }
    vFragPos = worldPos.xyz;
    vNormal = mat3(transpose(inverse(uModel))) * localNormal;
    vUV = aUV + uUvOffset;
    vColor = aColor;

    gl_Position = uViewProjection * worldPos;
}
