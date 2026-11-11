// Servidor de relevo de Bazuko: reenvia paquetes entre el anfitrion y los invitados de cada sala para que se pueda jugar por internet sin abrir puertos.
// Corre en cualquier maquina con IP publica (un VPS barato basta) y no sabe nada del juego. Solo necesita que el puerto UDP elegido este abierto.
//   bazuko_relay [puerto]        (por defecto 7770)
// Los jugadores lo usan con:  bazuko --anfitrion-relay=IP[:puerto]   (crea una sala y muestra su codigo)   y   bazuko --sala=CODIGO@IP[:puerto]
#include "net/RelayProtocol.hpp"
#include "net/RelayServer.hpp"
#include "net/Transport.hpp"

#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <thread>

int main(int argc, char** argv) {
    const uint16_t port = argc > 1 ? static_cast<uint16_t>(std::atoi(argv[1])) : Bazuko::Net::Relay::kDefaultPort;
    auto server = Bazuko::Net::RelayServer::Create(port);
    if (!server) { std::fprintf(stderr, "No se pudo abrir el puerto UDP %u\n", port); return 1; }
    std::printf("Relevo de Bazuko escuchando en el puerto UDP %u (Ctrl+C para cerrar)\n", server->Port());
    double lastReport = Bazuko::Net::NowMs();
    for (;;) {
        server->Update();
        const double now = Bazuko::Net::NowMs();
        if (now - lastReport > 60000.0) {
            lastReport = now;
            std::printf("salas: %zu, invitados: %zu, MB reenviados: %.1f\n", server->RoomCount(), server->GuestCount(), static_cast<double>(server->BytesRelayed()) / 1048576.0);
            std::fflush(stdout);
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(2));
    }
}
