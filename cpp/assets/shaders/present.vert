#version 450 core
// Triangulo de pantalla completa para presentar la imagen renderizada a otra escala (sin glBlit: la ventana es multimuestra)
out vec2 vUV;
void main() {
    vec2 position = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
    vUV = position;
    gl_Position = vec4(position * 2.0 - 1.0, 0.0, 1.0);
}
