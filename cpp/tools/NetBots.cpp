// Servidor y bots de prueba de red (compilar con -DBAZUKO_NET=ON): bazuko_net_bots
//   bazuko_net_bots --servidor [--puerto 7777] [--jugadores 8] [--segundos N]    servidor sin ventana ni GPU
//   bazuko_net_bots --bots N [--direccion 127.0.0.1] [--puerto 7777] [--segundos N]   N bots que caminan al azar y miden la red
//   bazuko_net_bots --salas-demo [--relevo IP:puerto] [--segundos N]   abre salas de muestra para ver la lista del lobby: dos por el relevo
//                                                                     (una publica y una solo con codigo) y una en esta red
// Con BAZUKO_NET_LAG / BAZUKO_NET_JITTER / BAZUKO_NET_LOSS / BAZUKO_NET_DUP los bots simulan una mala conexion.
#include "net/NetSession.hpp"
#include "net/RelayProtocol.hpp"
#include "net/RoomDirectory.hpp"
#include "net/ToyWorld.hpp"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <random>
#include <string>
#include <thread>
#include <vector>

using namespace Bazuko::Net;

int main(int argc, char** argv) {
    std::setvbuf(stdout, nullptr, _IONBF, 0);
    bool serverMode = false;
    int bots = 0;
    uint16_t port = 7777;
    int maxPlayers = 100;
    double seconds = 0.0;   // 0 = hasta cerrar
    std::string address = "127.0.0.1";
    bool roomsDemo = false;
    std::string relay = "127.0.0.1:7770";
    for (int i = 1; i < argc; ++i) {
        if (!std::strcmp(argv[i], "--servidor")) serverMode = true;
        else if (!std::strcmp(argv[i], "--bots") && i + 1 < argc) bots = std::atoi(argv[++i]);
        else if (!std::strcmp(argv[i], "--puerto") && i + 1 < argc) port = static_cast<uint16_t>(std::atoi(argv[++i]));
        else if (!std::strcmp(argv[i], "--jugadores") && i + 1 < argc) maxPlayers = std::atoi(argv[++i]);
        else if (!std::strcmp(argv[i], "--segundos") && i + 1 < argc) seconds = std::atof(argv[++i]);
        else if (!std::strcmp(argv[i], "--direccion") && i + 1 < argc) address = argv[++i];
        else if (!std::strcmp(argv[i], "--salas-demo")) roomsDemo = true;
        else if (!std::strcmp(argv[i], "--relevo") && i + 1 < argc) relay = argv[++i];
    }
    if (roomsDemo) {
        const size_t colon = relay.rfind(':');
        const std::string relayHost = colon == std::string::npos ? relay : relay.substr(0, colon);
        const uint16_t relayPort = colon == std::string::npos ? Relay::kDefaultPort : static_cast<uint16_t>(std::atoi(relay.c_str() + colon + 1));
        auto open = NetSession::StartHostViaRelay(relayHost, relayPort, "Hugo", 8);
        auto hidden = NetSession::StartHostViaRelay(relayHost, relayPort, "Rosa", 4);
        auto local = NetSession::StartHost(0, "Lucho", 16);
        if (open) open->SetRoomInfo("Parche de la S\xC3\xA9ptima", true);
        if (hidden) hidden->SetRoomInfo("Solo con codigo", false);
        std::unique_ptr<LanBeacon> beacon = local ? LanBeacon::Create(local->Port(), "Cambuche del lago", 16) : nullptr;
        std::printf("Salas de muestra: relevo %s, red local en el puerto %u%s\n", relay.c_str(), local ? local->Port() : 0, beacon ? "" : " (sin baliza: puerto de descubrimiento ocupado)");
        const double start = NowMs();
        double last = start;
        bool announced = false;
        while (seconds <= 0.0 || NowMs() - start < seconds * 1000.0) {
            const double now = NowMs();
            const float dt = static_cast<float>((now - last) / 1000.0);
            last = now;
            const LocalState still{};
            for (auto* session : {open.get(), hidden.get(), local.get()}) if (session) session->Update(dt, still);
            if (beacon && local) beacon->Update(local->PlayerCount());
            if (!announced && open && hidden && !open->RoomCode().empty() && !hidden->RoomCode().empty()) {
                announced = true;
                std::printf("Publica: %s   Solo con codigo: %s\n", open->RoomCode().c_str(), hidden->RoomCode().c_str());
            }
            std::this_thread::sleep_for(std::chrono::milliseconds(30));
        }
        return 0;
    }
    if (!serverMode && bots <= 0) { std::printf("Uso: bazuko_net_bots --servidor [--puerto P] [--jugadores N] [--segundos S]\n     bazuko_net_bots --bots N [--direccion IP] [--puerto P] [--segundos S]\n     bazuko_net_bots --salas-demo [--relevo IP:puerto] [--segundos S]\n"); return 2; }

    if (serverMode) {
        auto host = Host::CreateServer(port, static_cast<size_t>(std::max(32, maxPlayers + 8)));
        if (!host) { std::printf("No se pudo abrir el puerto %u\n", port); return 1; }
        ToyServer server(*host, 1234, static_cast<uint8_t>(maxPlayers));
        std::printf("Servidor de prueba en el puerto %u (hasta %d jugadores, %d Hz de simulacion, %d Hz de instantaneas)\n", host->Port(), maxPlayers, ToyServer::kTickRate, ToyServer::kSnapshotRate);
        const double start = NowMs();
        double last = start, report = start;
        uint64_t reportedOut = 0;
        double busyMs = 0.0, worstMs = 0.0;
        long turns = 0;
        while (seconds <= 0.0 || NowMs() - start < seconds * 1000.0) {
            const double now = NowMs();
            server.Update((now - last) / 1000.0);
            last = now;
            const double spent = NowMs() - now;   // lo que costo atender la red y avanzar el mundo en esta vuelta
            busyMs += spent; worstMs = std::max(worstMs, spent); ++turns;
            if (now - report >= 5000.0) {
                const double outKB = (host->BytesSent() - reportedOut) / 1024.0 / ((now - report) / 1000.0);
                std::printf("[%.0f s] %zu jugadores, salida %.1f KB/s (%.1f por jugador), Update medio %.2f ms y peor %.1f ms (%.1f %% de un nucleo), descartados %llu\n",
                            (now - start) / 1000.0, server.Players().size(), outKB, server.Players().empty() ? 0.0 : outKB / static_cast<double>(server.Players().size()),
                            turns ? busyMs / turns : 0.0, worstMs, 100.0 * busyMs / (now - report), static_cast<unsigned long long>(server.RejectedPackets()));
                busyMs = 0.0; worstMs = 0.0; turns = 0;
                reportedOut = host->BytesSent();
                report = now;
            }
            std::this_thread::sleep_for(std::chrono::milliseconds(1000 / ToyServer::kTickRate));
        }
        return 0;
    }

    const NetSimConfig simulation = NetSimConfig::FromEnvironment();
    std::vector<std::unique_ptr<ToyClient>> clients;
    std::vector<std::mt19937> randoms;
    for (int i = 0; i < bots; ++i) {
        clients.push_back(std::make_unique<ToyClient>("Bot" + std::to_string(i + 1)));
        randoms.emplace_back(100u + static_cast<uint32_t>(i));
        if (!clients.back()->Start(address, port, simulation, 7u + static_cast<uint32_t>(i))) { std::printf("No se pudo conectar a %s:%u\n", address.c_str(), port); return 1; }
    }
    std::printf("%d bots hacia %s:%u%s\n", bots, address.c_str(), port, simulation.Active() ? " (con red simulada)" : "");
    const double start = NowMs();
    std::vector<float> heading(static_cast<size_t>(bots), 0.0f);
    int step = 0;
    while (seconds <= 0.0 || NowMs() - start < seconds * 1000.0) {
        for (size_t i = 0; i < clients.size(); ++i) {
            clients[i]->Update();
            if (!clients[i]->Connected()) continue;
            if (step % 45 == 0) heading[i] = std::uniform_real_distribution<float>(0.0f, 6.2831853f)(randoms[i]);   // cambia de rumbo cada ~1,5 s
            PlayerInput input; input.sequence = clients[i]->NextSequence(); input.moveX = std::cos(heading[i]); input.moveZ = std::sin(heading[i]);
            input.yaw = heading[i]; input.buttons = (step / 150) % 2 ? kRun : 0;
            clients[i]->SendInput(input);
        }
        ++step;
        std::this_thread::sleep_for(std::chrono::milliseconds(33));
        if (step % 150 == 0) {
            const double elapsed = (NowMs() - start) / 1000.0;
            uint64_t received = 0, up = 0, down = 0; int connected = 0;
            for (auto& c : clients) { received += c->SnapshotsReceived(); connected += c->Connected() ? 1 : 0; up += c->Network().BytesSent(); down += c->Network().BytesReceived(); }
            std::printf("[%.0f s] conectados %d/%d, instantaneas %.1f/s por bot, subida %.1f KB/s y bajada %.1f KB/s por bot\n", elapsed, connected, bots,
                        received / elapsed / bots, up / 1024.0 / elapsed / bots, down / 1024.0 / elapsed / bots);
        }
    }
    for (auto& c : clients) c->Leave();
    return 0;
}
