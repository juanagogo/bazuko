#pragma once

#include <cstdint>
#include <vector>

namespace bazuko {

// Imagen RGBA de 8 bits (fila 0 = arriba), no premultiplicada.
struct Image {
    int width = 0, height = 0;
    std::vector<std::uint8_t> rgba;
    bool srgb = true;      // false para datos (relieve, rugosidad)
    bool repeat = true;    // wrap RepeatWrapping (true) o ClampToEdge (false)
};

}  // namespace bazuko
