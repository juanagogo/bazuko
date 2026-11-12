// Servidor de relevo de Bazuko: reenvia paquetes entre el anfitrion y los invitados de cada sala para que se pueda jugar por internet sin abrir puertos.
// Corre en cualquier maquina con IP publica (un VPS barato basta) y no sabe nada del juego. Solo necesita que el puerto UDP elegido este abierto.
//   bazuko_relay [puerto] [--mientras-juegue] [--playit RUTA] [--registro ARCHIVO]
//     puerto              por defecto 7770
//     --mientras-juegue   modo «servidor propio» (lo lanza el juego al abrir, ver core/OwnServer.hpp): se cierra solo cuando en este equipo ya no hay
//                         ningun juego abierto Y no queda ninguna sala en uso durante un minuto, asi cerrar el juego no corta a quien sigue jugando
//     --playit RUTA       levanta el agente de playit.gg (el tunel) y lo cierra al salir; si ya esta corriendo, lo deja como esta
//     --registro ARCHIVO  escribe los mensajes en ese archivo (cuando corre sin consola)
// Los jugadores lo usan con:  bazuko --anfitrion-relay=IP[:puerto]   (crea una sala y muestra su codigo)   y   bazuko --sala=CODIGO@IP[:puerto]
#include "net/RelayProtocol.hpp"
#include "net/RelayServer.hpp"
#include "net/Transport.hpp"

#include <chrono>
#include <cstdarg>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <thread>

#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <tlhelp32.h>
#endif

namespace {
constexpr double kCheckEveryMs = 5000.0;
constexpr double kIdleBeforeExitMs = 60000.0;   // sin juego abierto y sin salas: espera un minuto antes de cerrarse

void Log(const char* format, ...) {
    va_list args;
    va_start(args, format);
    std::vprintf(format, args);
    va_end(args);
    std::printf("\n");
    std::fflush(stdout);
}

#ifdef _WIN32
bool ProcessRunning(const char* exeName) {   // ¿hay algun proceso con ese nombre de ejecutable? (sin distinguir mayusculas)
    HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (snapshot == INVALID_HANDLE_VALUE) return true;   // ante la duda, se sigue
    PROCESSENTRY32 entry{};
    entry.dwSize = sizeof(entry);
    bool found = false;
    for (BOOL ok = Process32First(snapshot, &entry); ok && !found; ok = Process32Next(snapshot, &entry))
        found = _stricmp(entry.szExeFile, exeName) == 0;
    CloseHandle(snapshot);
    return found;
}

// El agente de playit va dentro de un «job» que lo cierra si este relevo se cierra o se cae: nunca queda un tunel huerfano
struct PlayitAgent {
    HANDLE job = nullptr, process = nullptr;
    bool Start(const std::string& path) {
        const std::string exe = path.substr(path.find_last_of("/\\") + 1);
        if (ProcessRunning(exe.c_str())) { Log("playit ya estaba corriendo: se deja como esta"); return true; }
        job = CreateJobObjectA(nullptr, nullptr);
        if (job) {
            JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            SetInformationJobObject(job, JobObjectExtendedLimitInformation, &limits, sizeof limits);
        }
        std::string folder = path.substr(0, path.find_last_of("/\\"));
        std::string command = "\"" + path + "\" -s";
        SECURITY_ATTRIBUTES inherit{sizeof(SECURITY_ATTRIBUTES), nullptr, TRUE};
        HANDLE logFile = CreateFileA((folder + "\\playit.log").c_str(), GENERIC_WRITE, FILE_SHARE_READ, &inherit, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
        STARTUPINFOA startup{};
        startup.cb = sizeof startup;
        if (logFile != INVALID_HANDLE_VALUE) { startup.dwFlags = STARTF_USESTDHANDLES; startup.hStdOutput = logFile; startup.hStdError = logFile; startup.hStdInput = nullptr; }
        PROCESS_INFORMATION info{};
        const BOOL ok = CreateProcessA(nullptr, command.data(), nullptr, nullptr, logFile != INVALID_HANDLE_VALUE, CREATE_NO_WINDOW | CREATE_SUSPENDED, nullptr,
                                       folder.empty() ? nullptr : folder.c_str(), &startup, &info);
        if (logFile != INVALID_HANDLE_VALUE) CloseHandle(logFile);
        if (!ok) { Log("No se pudo abrir playit (%s): el relevo sigue, pero solo se alcanza en esta red", path.c_str()); return false; }
        if (job) AssignProcessToJobObject(job, info.hProcess);
        ResumeThread(info.hThread);
        CloseHandle(info.hThread);
        process = info.hProcess;
        Log("playit abierto (registro en %s\\playit.log)", folder.c_str());
        return true;
    }
    ~PlayitAgent() {
        if (process) { TerminateProcess(process, 0); CloseHandle(process); }
        if (job) CloseHandle(job);
    }
};
#else
bool ProcessRunning(const char*) { return true; }   // fuera de Windows el modo «mientras se juegue» no se usa: el relevo sigue hasta que lo cierren
struct PlayitAgent { bool Start(const std::string&) { Log("--playit solo esta disponible en Windows"); return false; } };
#endif
}

int main(int argc, char** argv) {
    uint16_t port = Bazuko::Net::Relay::kDefaultPort;
    bool whilePlaying = false;
    std::string playitPath, logPath;
    for (int i = 1; i < argc; ++i) {
        if (!std::strcmp(argv[i], "--mientras-juegue")) whilePlaying = true;
        else if (!std::strcmp(argv[i], "--playit") && i + 1 < argc) playitPath = argv[++i];
        else if (!std::strcmp(argv[i], "--registro") && i + 1 < argc) logPath = argv[++i];
        else if (argv[i][0] != '-') port = static_cast<uint16_t>(std::atoi(argv[i]));
    }
    if (!logPath.empty()) std::freopen(logPath.c_str(), "a", stdout);
    auto server = Bazuko::Net::RelayServer::Create(port);
    if (!server) { Log("No se pudo abrir el puerto UDP %u (puede que el relevo ya este corriendo)", port); return 1; }   // antes de tocar playit: otra copia ya lo maneja
    Log("Relevo de Bazuko escuchando en el puerto UDP %u%s", server->Port(), whilePlaying ? " (se cierra solo cuando nadie juegue)" : " (Ctrl+C para cerrar)");
    PlayitAgent playit;
    if (!playitPath.empty()) playit.Start(playitPath);
    double lastReport = Bazuko::Net::NowMs(), lastCheck = lastReport, idleSince = -1.0;
    for (;;) {
        server->Update();
        const double now = Bazuko::Net::NowMs();
        if (now - lastReport > 60000.0) {
            lastReport = now;
            Log("salas: %zu, invitados: %zu, MB reenviados: %.1f", server->RoomCount(), server->GuestCount(), static_cast<double>(server->BytesRelayed()) / 1048576.0);
        }
        if (whilePlaying && now - lastCheck > kCheckEveryMs) {
            lastCheck = now;
            const bool busy = server->RoomCount() > 0 || ProcessRunning("bazuko.exe");   // una sala en uso (o esperando a su nuevo anfitrion) o un juego abierto
            if (busy) idleSince = -1.0;
            else if (idleSince < 0.0) idleSince = now;
            else if (now - idleSince > kIdleBeforeExitMs) { Log("Nadie juega desde hace un minuto: se cierra el relevo"); break; }
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(2));
    }
    return 0;
}
