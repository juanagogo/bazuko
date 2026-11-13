#pragma once
// Lista de servidores de salas (relevos) que el lobby descarga al abrir: asi la direccion se puede cambiar (otro tunel, un VPS, un segundo relevo)
// editando un archivo publicado, sin sacar otra version del juego. Si no hay internet o el archivo falla, el lobby usa la ultima lista que bajo
// y, si nunca bajo una, la direccion grabada al compilar (BAZUKO_SERVIDOR_SALAS).
//
//   servidores.json:  { "version": 1, "servidores": [ { "direccion": "nombre.tun.ply.gg:12345", "nota": "..." }, ... ] }
#include <memory>
#include <optional>
#include <string>
#include <vector>

namespace Bazuko {

// GET de una URL http(s) con un User-Agent generico ("Bazuko/1.0") y sin datos del jugador; una ruta sin http se lee del disco (pruebas).
// Devuelve el cuerpo con respuesta 200 y a lo sumo 64 KB; nullopt si falla o pasa `timeoutMs`.
std::optional<std::string> HttpGet(const std::string& url, int timeoutMs = 6000);

// Direcciones "host:puerto" validas del archivo (a lo sumo 8, sin repetir); vacio si el archivo no se entiende.
std::vector<std::string> ParseServerList(const std::string& json);

// Direccion de la lista y servidor de respaldo grabados al compilar (variables de entorno BAZUKO_LISTA_SERVIDORES y BAZUKO_SERVIDOR_SALAS los cambian).
std::string ServerListUrl();
std::string FallbackServer();

// Descarga en un hilo aparte: el lobby no se congela mientras espera la red.
class ServerListFetch {
public:
    void Start(const std::string& url);
    bool Done() const;
    // Despues de Done(): las direcciones bajadas (vacio si fallo).
    std::vector<std::string> Result() const;

private:
    struct State;
    std::shared_ptr<State> m_State;
};

} // namespace Bazuko
