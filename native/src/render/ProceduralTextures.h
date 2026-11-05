#pragma once

#include <string>

#include "render/Image.h"

namespace bazuko {

// Texturas procedurales del juego web (textures.js), dibujadas con Canvas2D y semilla fija.
namespace tex {

Image asphalt(unsigned seed = 7, int size = 1024);
Image sidewalk(unsigned seed = 11);
Image brick(unsigned seed = 3);
Image roofTiles(unsigned seed = 9);
Image slab(unsigned seed = 13);
Image cardboard(unsigned seed = 21);
Image trashBag(unsigned seed = 5);
Image dirt(unsigned seed = 31);
Image concrete(unsigned seed = 41);

enum class FacadeStyle { Pintada, Ladrillo, Ruina };

struct FacadeParams {
    unsigned seed = 1;
    double width = 4;  // metros
    int floors = 2;
    double pxPerM = 28;
    bool shopFront = true;
    FacadeStyle style = FacadeStyle::Pintada;
};

struct Facade {
    Image map;       // color
    Image emissive;  // ventanas encendidas (negro donde no)
};
Facade facade(const FacadeParams& p);

struct SignParams {
    std::string title, sub;
    std::string bg = "#0b4fa3", fg = "#ffffff", accent = "#f6c400";
    int w = 1024, h = 256;
};
// Letrero estilo señal informativa colombiana (signs.js).
Image sign(const SignParams& p);

// Ladrillo tolete a la vista: dimensiones reales en metros.
constexpr double kBrickW = 0.36, kBrickH = 0.12;
// La textura brick() cubre estos metros (8 x 21,3 ladrillos).
constexpr double kBrickTileW = 8 * 0.36, kBrickTileH = (512.0 / 24) * 0.12;

}  // namespace tex
}  // namespace bazuko
