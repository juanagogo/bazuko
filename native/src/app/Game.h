#pragma once

#include <memory>
#include <string>

namespace bazuko {

struct Options {
    int width = 1280, height = 720;
    bool isometric = false;
    std::string screenshot;  // si no está vacío: renderiza `frames` cuadros, guarda el PNG y sale
    int frames = 30;
    double hour = -1;        // < 0: la del reloj del juego
    double posX = -1e9, posZ = -1e9;  // posición inicial en tiles (opcional)
    bool procedural = false;          // empieza con el personaje liviano (tecla M lo alterna)
    bool atOriginal = false;          // posX/posZ en la rejilla original del centro (WX/WZ), no en tiles expandidos
    double yaw = -1e9;
    double renderScale = 1;  // fracción de la ventana a la que se dibuja la escena (pruebas de resolución adaptativa)
    unsigned seed = 0;       // 0 = aleatoria
    bool newGame = false;    // ignora el guardado y abre el creador de personaje
    bool noAudio = false;
    bool creator = false;    // en capturas: muestra el creador
    std::string openPanel;   // en capturas: talentos, crafteo, dealer, recicladora, tienda o cambuche
    std::string savePath;    // vacío: la ruta por defecto (~/.local/share/bazuko/save.json)
    bool showHelp = false;
};

// Bucle principal: ventana SDL3, entrada, simulación, mundo y render.
class Game {
public:
    explicit Game(const Options& options);
    ~Game();
    Game(const Game&) = delete;
    Game& operator=(const Game&) = delete;

    int run();  // código de salida

private:
    struct Impl;
    std::unique_ptr<Impl> impl_;
};

}  // namespace bazuko
