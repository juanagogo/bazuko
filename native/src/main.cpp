#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <exception>

#include "app/Game.h"

namespace {

void usage() {
    std::puts(
        "Bazuko (nativo)\n"
        "  bazuko [opciones]\n"
        "    --screenshot ARCHIVO.png   renderiza unos cuadros, guarda la imagen y sale\n"
        "    --frames N                 cuadros antes de la captura (30)\n"
        "    --hour H                   hora fija del día (0-24)\n"
        "    --iso                      cámara isométrica\n"
        "    --procedural               personaje liviano de primitivas (tecla M lo alterna)\n"
        "    --pos X Z                  posición inicial en tiles de la ciudad\n"
        "    --at X Z                   posición inicial en la rejilla original (El Cartucho: 8-21, 14-29)\n"
        "    --yaw RAD                  rumbo inicial de la cámara\n"
        "    --size W H                 tamaño de la ventana (1280 720)\n"
        "    --scale F                  resolución interna (0.5-1) sin resolución adaptativa\n"
        "    --seed N                   semilla del azar\n"
        "    --new                      ignora el guardado y abre el creador de personaje\n"
        "    --no-audio                 sin sonido\n"
        "    --save RUTA                archivo de guardado (por defecto ~/.local/share/bazuko/save.json)\n"
        "    --creator | --open PANEL   (capturas) muestra el creador o un panel: talentos, crafteo, dealer,\n"
        "                               recicladora, tienda, cambuche\n"
        "  Controles: WASD mover, Shift correr, E/Q/F/B interactuar, T talentos, C crafteo, V cámara, M modelo,\n"
        "             P apariencia, F3 rendimiento, clic derecho/flechas girar, rueda zoom, Esc cierra/sale");
}

}  // namespace

int main(int argc, char** argv) {
    bazuko::Options o;
    for (int i = 1; i < argc; ++i) {
        const char* a = argv[i];
        auto next = [&](const char* what) -> const char* {
            if (i + 1 >= argc) {
                std::fprintf(stderr, "falta el valor de %s\n", what);
                std::exit(2);
            }
            return argv[++i];
        };
        if (!std::strcmp(a, "--screenshot")) o.screenshot = next(a);
        else if (!std::strcmp(a, "--frames")) o.frames = std::atoi(next(a));
        else if (!std::strcmp(a, "--hour")) o.hour = std::atof(next(a));
        else if (!std::strcmp(a, "--iso")) o.isometric = true;
        else if (!std::strcmp(a, "--procedural")) o.procedural = true;
        else if (!std::strcmp(a, "--pos")) { o.posX = std::atof(next(a)); o.posZ = std::atof(next(a)); }
        else if (!std::strcmp(a, "--at")) { o.posX = std::atof(next(a)); o.posZ = std::atof(next(a)); o.atOriginal = true; }
        else if (!std::strcmp(a, "--yaw")) o.yaw = std::atof(next(a));
        else if (!std::strcmp(a, "--size")) { o.width = std::atoi(next(a)); o.height = std::atoi(next(a)); }
        else if (!std::strcmp(a, "--scale")) o.renderScale = std::atof(next(a));
        else if (!std::strcmp(a, "--new")) o.newGame = true;
        else if (!std::strcmp(a, "--no-audio")) o.noAudio = true;
        else if (!std::strcmp(a, "--save")) o.savePath = next(a);
        else if (!std::strcmp(a, "--creator")) o.creator = true;
        else if (!std::strcmp(a, "--open")) o.openPanel = next(a);
        else if (!std::strcmp(a, "--seed")) o.seed = static_cast<unsigned>(std::atoi(next(a)));
        else if (!std::strcmp(a, "--help") || !std::strcmp(a, "-h")) { usage(); return 0; }
        else { std::fprintf(stderr, "opción desconocida: %s\n", a); usage(); return 2; }
    }
    try {
        bazuko::Game game(o);
        return game.run();
    } catch (const std::exception& e) {
        std::fprintf(stderr, "error: %s\n", e.what());
        return 1;
    }
}
