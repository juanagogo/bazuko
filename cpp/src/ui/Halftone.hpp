#pragma once
// Semitono de una sola tinta sobre carton: el arte de la pantalla de carga del original (src/ui/impresion.js y LoadingArtwork.js).
// Cada imagen se reduce a una malla de puntos a 45 grados cuyo radio crece con la tinta que hace falta; los niveles salen de la propia
// imagen por percentiles, para que un cuadro de noche y uno de mediodia se vean igual de claros.
#include <imgui.h>
#include <string>
#include <vector>

namespace Bazuko::Carton {

struct HalftoneDot {
    float x, y, radius;
};

// Puntos para una pantalla de W x H pixeles. `techo` es hasta donde baja la palabra BAZUKO: el personaje se para debajo de ella.
// Devuelve una lista vacia si no se pudieron leer las imagenes.
std::vector<HalftoneDot> BuildHalftone(const std::string& backgroundPath, const std::string& characterPath, float width, float height, float ceiling);

} // namespace Bazuko::Carton
