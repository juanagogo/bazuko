#pragma once
#include <string>

namespace Bazuko::Paths {

// Llamar una vez al inicio de main(). Admite "--public <ruta>" (carpeta public/ del juego web)
// y la variable de entorno BAZUKO_PUBLIC.
void Init(int argc, char** argv);

// Localiza un archivo del proyecto a partir de su ruta relativa ("assets/shaders/default.vert",
// "public/models/..."). Busca junto al ejecutable, en las carpetas superiores y en el directorio actual,
// asi el juego arranca desde build/, build/Release/ o con doble clic. Si no existe devuelve `relative`.
std::string Find(const std::string& relative);

} // namespace Bazuko::Paths
