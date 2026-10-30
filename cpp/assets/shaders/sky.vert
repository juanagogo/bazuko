#version 450 core

layout(location = 0) in vec3 aPos;

layout(std140, binding = 0) uniform CameraBlock {
    mat4 uView;
    mat4 uProjection;
    mat4 uViewProjection;
    vec3 uCameraPos;
    float uTime;
};

out vec3 vDirection;

void main() {
    // la boveda sigue a la camara y no rota ni escala: la posicion local es la direccion de vista
    vDirection = aPos;
    vec4 clip = uViewProjection * vec4(aPos * 400.0 + uCameraPos, 1.0);
    gl_Position = clip.xyww;
    gl_Position.z = clip.w * 0.99999;   // siempre en el plano lejano
}
