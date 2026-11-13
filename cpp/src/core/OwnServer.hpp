#pragma once
// Servidor de salas propio: en el equipo que aloja el servidor de salas (el relevo, bazuko_relay, y el tunel de playit), el juego lo levanta solo al abrir.
// El relevo corre aparte y en modo «mientras se juegue»: se cierra solo cuando ya no hay ningun juego abierto en este equipo y ninguna sala en uso,
// asi cerrar el juego no corta a quien sigue jugando en el. Si ya esta corriendo (porque otros seguian jugando), no se abre otro.
// Se activa en bazuko_ajustes.json: "servidorPropio": { "activo": true, "playit": "C:/ruta/playit-cli.exe" }. Solo Windows.
#include <string>

namespace Bazuko {

struct OwnServerResult {
    bool started = false;   // se lanzo el relevo (si ya corria, el nuevo se cierra solo y el de antes sigue)
    std::string message;    // para el registro
};

OwnServerResult StartOwnServer(const std::string& playitPath, unsigned short port = 7770);

} // namespace Bazuko
