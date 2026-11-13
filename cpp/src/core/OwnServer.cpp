#include "OwnServer.hpp"

#include <filesystem>

#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#endif

namespace Bazuko {

OwnServerResult StartOwnServer(const std::string& playitPath, unsigned short port) {
    OwnServerResult result;
#ifdef _WIN32
    char selfPath[MAX_PATH] = {};
    if (GetModuleFileNameA(nullptr, selfPath, MAX_PATH) == 0) { result.message = "no se encontro la carpeta del juego"; return result; }
    const std::filesystem::path folder = std::filesystem::path(selfPath).parent_path();
    const std::filesystem::path relay = folder / "bazuko_relay.exe";
    if (!std::filesystem::exists(relay)) { result.message = "falta bazuko_relay.exe junto al juego"; return result; }
    std::string command = "\"" + relay.string() + "\" " + std::to_string(port) + " --mientras-juegue --registro \"" + (folder / "bazuko_relay.log").string() + "\"";
    if (!playitPath.empty()) {
        if (std::filesystem::exists(playitPath)) command += " --playit \"" + playitPath + "\"";
        else result.message = "no esta playit en " + playitPath + "; ";
    }
    STARTUPINFOA startup{};
    startup.cb = sizeof startup;
    PROCESS_INFORMATION info{};
    // proceso aparte, sin ventana y fuera del juego: sigue vivo cuando el juego se cierra (y se cierra solo cuando nadie juega)
    const DWORD flags = DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW;
    BOOL ok = CreateProcessA(nullptr, command.data(), nullptr, nullptr, FALSE, flags | CREATE_BREAKAWAY_FROM_JOB, nullptr, folder.string().c_str(), &startup, &info);
    if (!ok) ok = CreateProcessA(nullptr, command.data(), nullptr, nullptr, FALSE, flags, nullptr, folder.string().c_str(), &startup, &info);
    if (!ok) { result.message += "no se pudo abrir bazuko_relay.exe"; return result; }
    CloseHandle(info.hThread);
    CloseHandle(info.hProcess);
    result.started = true;
    result.message += "relevo lanzado en el puerto " + std::to_string(port) + (playitPath.empty() ? " (sin playit)" : " con playit");
#else
    (void)playitPath; (void)port;
    result.message = "el servidor propio automatico solo esta disponible en Windows";
#endif
    return result;
}

} // namespace Bazuko
