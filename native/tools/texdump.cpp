// Vuelca las texturas procedurales a PNG para revisarlas a ojo: texdump <directorio>
#include <cstdio>
#include <filesystem>
#include <string>

#define STB_IMAGE_WRITE_IMPLEMENTATION
#include <stb_image_write.h>

#include "render/ProceduralTextures.h"

using namespace bazuko;

static void save(const std::string& dir, const std::string& name, const Image& img) {
    const std::string path = dir + "/" + name + ".png";
    stbi_write_png(path.c_str(), img.width, img.height, 4, img.rgba.data(), img.width * 4);
    std::printf("%s (%dx%d)\n", path.c_str(), img.width, img.height);
}

int main(int argc, char** argv) {
    const std::string dir = argc > 1 ? argv[1] : ".";
    std::filesystem::create_directories(dir);
    save(dir, "asphalt", tex::asphalt(7, 512));
    save(dir, "sidewalk", tex::sidewalk());
    save(dir, "brick", tex::brick());
    save(dir, "roofTiles", tex::roofTiles());
    save(dir, "slab", tex::slab());
    save(dir, "cardboard", tex::cardboard());
    save(dir, "trashBag", tex::trashBag());
    save(dir, "dirt", tex::dirt());
    save(dir, "concrete", tex::concrete());
    int i = 0;
    for (auto style : {tex::FacadeStyle::Pintada, tex::FacadeStyle::Ladrillo, tex::FacadeStyle::Ruina}) {
        tex::FacadeParams p;
        p.seed = 100 + i;
        p.width = 6;
        p.floors = 3;
        p.pxPerM = style == tex::FacadeStyle::Pintada ? 28 : 40;
        p.style = style;
        const auto f = tex::facade(p);
        save(dir, "facade" + std::to_string(i), f.map);
        save(dir, "facade" + std::to_string(i) + "_emissive", f.emissive);
        ++i;
    }
    tex::SignParams s;
    s.title = "DROGUERÍA";
    s.sub = "SALUD Y VIDA";
    s.w = 768;
    s.h = 192;
    save(dir, "sign", tex::sign(s));
}
