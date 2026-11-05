// Prueba de red de punta a punta en la misma maquina (ENet por 127.0.0.1): conexion, rechazos, validacion del servidor autoritativo,
// instantaneas con y sin latencia/perdida, y resistencia a paquetes basura. Solo se compila con -DBAZUKO_NET=ON.
#include "net/ToyWorld.hpp"

#include <chrono>
#include <cmath>
#include <cstdio>
#include <memory>
#include <random>
#include <thread>

using namespace Bazuko::Net;

namespace {
int g_Failures = 0;
void Check(bool condition, const char* what) {
    if (!condition) { std::printf("FALLO: %s\n", what); ++g_Failures; }
}

struct World {
    std::unique_ptr<Host> host;
    std::unique_ptr<ToyServer> server;
    std::vector<std::unique_ptr<ToyClient>> clients;
    uint16_t port = 0;

    explicit World(uint8_t maxPlayers = 8) {
        host = Host::CreateServer(0, 16);
        port = host ? host->Port() : 0;
        if (host) server = std::make_unique<ToyServer>(*host, 1234, maxPlayers);
    }
    ToyClient& Add(const std::string& name, const NetSimConfig& sim = {}, uint32_t seed = 1) {
        clients.push_back(std::make_unique<ToyClient>(name));
        clients.back()->Start("127.0.0.1", port, sim, seed);
        return *clients.back();
    }
    // Avanza `seconds` de tiempo real a 30 Hz; `drive` decide el input de cada cliente
    template <class Drive>
    void Run(double seconds, Drive drive) {
        const double start = NowMs();
        double last = start;
        int step = 0;
        while (NowMs() - start < seconds * 1000.0) {
            const double now = NowMs();
            server->Update((now - last) / 1000.0);
            last = now;
            for (size_t i = 0; i < clients.size(); ++i) {
                clients[i]->Update();
                if (clients[i]->Connected()) { PlayerInput input = drive(i, step); input.sequence = clients[i]->NextSequence(); clients[i]->SendInput(input); }
            }
            ++step;
            std::this_thread::sleep_for(std::chrono::milliseconds(33));
        }
    }
};

PlayerInput Circle(size_t index, int step) {
    PlayerInput input;
    const float a = step * 0.05f + static_cast<float>(index);
    input.moveX = std::cos(a); input.moveZ = std::sin(a); input.buttons = 0;
    return input;
}
}

int main() {
    // A: tres clientes, red limpia
    {
        World world;
        Check(world.server != nullptr, "el servidor abre un puerto");
        for (const char* name : {"Ana", "Beto", "Cami"}) world.Add(name);
        world.Run(3.0, Circle);
        bool allConnected = true;
        for (auto& c : world.clients) allConnected = allConnected && c->Connected();
        Check(allConnected, "los tres clientes reciben Welcome");
        Check(world.server->Players().size() == 3, "el servidor conoce a los tres jugadores");
        Check(world.clients[0]->Id() != world.clients[1]->Id() && world.clients[1]->Id() != world.clients[2]->Id(), "identificadores distintos");
        for (auto& c : world.clients) {
            Check(c->SnapshotsReceived() >= 40, "cada cliente recibe unas 20 instantaneas por segundo");
            Check(c->KnownPlayers().size() == 3, "cada cliente conoce a los tres jugadores");
            Check(c->AckedInput() > 30, "el servidor confirma los input aplicados");
        }
        std::printf("A) limpia: %llu instantaneas por cliente en 3 s, ack del ultimo input %u, RTT %u ms\n",
                    static_cast<unsigned long long>(world.clients[0]->SnapshotsReceived()), world.clients[0]->AckedInput(), world.clients[0]->Network().RoundTripMs(1));
    }

    // B: 60 ms de latencia, 20 ms de jitter y 10 % de perdida en los dos sentidos (solo lo no fiable pierde)
    {
        World world;
        NetSimConfig sim; sim.lagMs = 60; sim.jitterMs = 20; sim.lossPercent = 10;
        world.host->SetSimulation(sim, 5);   // tambien lo que sale del servidor
        world.Add("Ana", sim, 11); world.Add("Beto", sim, 22);
        world.Run(4.0, Circle);
        for (auto& c : world.clients) Check(c->Connected(), "el saludo fiable sobrevive a la latencia");
        const auto& truth = world.server->Players();
        for (auto& c : world.clients) {
            const double fraction = static_cast<double>(c->SnapshotsReceived()) / (4.0 * 20.0);
            Check(fraction > 0.5 && fraction < 1.0, "con 10 % de perdida llegan la mayoria de las instantaneas, pero no todas");
            // lo que el cliente ve del otro jugador no se aleja mas de lo que se mueve en ~0,3 s
            for (const auto& seen : c->LastSnapshot().players)
                for (const auto& [peer, real] : truth)
                    if (real.id == seen.id) Check(std::hypot(seen.x - real.x, seen.z - real.z) < 2.5, "la posicion vista esta cerca de la autoritativa");
            Check(c->AckedInput() > 20, "los input llegan pese a la perdida");
        }
        std::printf("B) lag 60+-20 ms, 10 %% perdida: %.0f %% de instantaneas recibidas\n", 100.0 * world.clients[0]->SnapshotsReceived() / (4.0 * 20.0));
    }

    // C: el servidor decide (el cliente no puede acelerar ni salirse del mapa)
    {
        World world;
        auto& cheater = world.Add("Tramposo");
        world.Run(0.5, [](size_t, int) { return PlayerInput{}; });
        const float x0 = world.server->Players().begin()->second.x;
        world.Run(2.0, [](size_t, int) { PlayerInput input; input.moveX = 1.0f; input.moveZ = 0.0f; input.buttons = kRun; return input; });
        const float travelled = world.server->Players().begin()->second.x - x0;
        Check(travelled > 3.0f && travelled < 2.3f * ToyServer::kRunSpeed, "la velocidad la limita el servidor aunque el cliente pida mas");
        std::printf("C) distancia en ~2 s corriendo: %.1f m (limite %.1f m/s)\n", travelled, ToyServer::kRunSpeed);
        (void)cheater;
    }

    // D: rechazos (protocolo distinto, servidor lleno, nombre vacio) y basura
    {
        World world(2);
        world.Add("Uno"); world.Add("Dos");
        world.Run(0.8, Circle);
        auto& third = world.Add("Tres");
        auto& nameless = world.Add("");
        world.Run(1.0, [](size_t, int) { return PlayerInput{}; });
        std::printf("   estado: Tres conectado=%d rechazado=%d caido=%d; vacio conectado=%d rechazado=%d caido=%d; jugadores=%zu\n", third.Connected(), third.Rejected(), third.DisconnectedByServer(), nameless.Connected(), nameless.Rejected(), nameless.DisconnectedByServer(), world.server->Players().size());
        Check(!third.Connected() && third.Rejected(), "un tercer jugador se rechaza con el servidor lleno (maximo 2)");
        Check(!nameless.Connected() && nameless.Rejected(), "un nombre vacio se rechaza");

        auto raw = Host::CreateClient();
        raw->Connect("127.0.0.1", world.port);
        std::mt19937 random(9);
        double start = NowMs();
        uint32_t peer = 0;
        int sent = 0;
        while (NowMs() - start < 1200.0) {
            NetEvent event;
            while (raw->Poll(event)) if (event.type == NetEvent::Type::Connected) peer = event.peer;
            if (peer && sent < 200) {
                std::vector<uint8_t> junk(1 + random() % 40);
                for (auto& b : junk) b = static_cast<uint8_t>(random());
                raw->Send(peer, kChannelReliable, junk, true);
                ++sent;
            }
            world.server->Update(0.033);
            std::this_thread::sleep_for(std::chrono::milliseconds(5));
        }
        Check(sent > 100, "se enviaron paquetes basura");
        Check(world.server->RejectedPackets() > 50, "el servidor descarta la basura sin caerse");
        Check(world.server->Players().size() == 2, "la basura no crea jugadores");
        std::printf("D) rechazos y basura: %llu paquetes descartados\n", static_cast<unsigned long long>(world.server->RejectedPackets()));
    }

    if (g_Failures == 0) std::printf("Red de punta a punta: todo correcto\n");
    return g_Failures == 0 ? 0 : 1;
}
