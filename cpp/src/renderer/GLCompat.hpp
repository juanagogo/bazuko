#pragma once
// Modo OpenGL 4.1 (macOS): Apple se quedo en 4.1 Core, sin Direct State Access (4.5), sin almacenamiento inmutable de texturas (4.2), sin
// layout(binding=) en GLSL (4.2) y sin buffers de almacenamiento (4.3). En vez de duplicar el renderer, Install() deja las mismas llamadas DSA
// del codigo apuntando a versiones que enlazan el objeto, lo editan y devuelven el enlace que habia: el resto del motor no se entera.
// Shader.cpp quita los binding= de los shaders y los asigna desde C++; las luces por cluster se leen de texture buffers en vez de SSBO.
// En Windows y Linux se activa a mano con BAZUKO_GL41=1 para probar este camino sin un Mac.
#include <glad/gl.h>

namespace Bazuko::GLCompat {

// Llamar justo despues de gladLoadGL. Decide el modo (contexto sin 4.5 o BAZUKO_GL41=1) y, en modo 4.1, instala las versiones emuladas.
void Install();

// true si el juego corre por el camino de OpenGL 4.1.
bool Legacy();

// Version de GLSL que se escribe en los shaders y en ImGui: "#version 450" o "#version 410".
const char* GlslVersion();

} // namespace Bazuko::GLCompat
