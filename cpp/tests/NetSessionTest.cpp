// Sesion de red del juego (anfitrion y clientes por 127.0.0.1): los jugadores se ven moverse entre si, con y sin latencia/perdida; avisos de
// entrada y salida; rechazo con la partida llena; el anfitrion ignora estados fuera del mapa o no finitos. Solo se compila con -DBAZUKO_NET=ON.
#include "net/NetSession.hpp"

#include <chrono>
#include <cmath>
#include <cstdio>
#include <thread>

using namespace Bazuko;
using namespace Bazuko::Net;

static int failures = 0;
#define CHECK(condition, message) do { \
    if (!(condition)) { ++failures; std::printf("FALLO (%d): %s\n", __LINE__, message); } \
} while (0)

namespace {
struct Walker {
    glm::vec3 position;
    glm::vec3 velocity{0.0f};
    float yaw = 0.0f;
    LocalState State() const { LocalState s; s.position = position; s.velocity = velocity; s.yaw = yaw; return s; }
};

// Corre `seconds` a 30 Hz moviendo a cada uno en linea recta a 3 m/s
template <class Fn>
void Pump(double seconds, Fn each) {
    const double start = NowMs();
    double last = start;
    while (NowMs() - start < seconds * 1000.0) {
        const double now = NowMs();
        each(static_cast<float>((now - last) / 1000.0));
        last = now;
        std::this_thread::sleep_for(std::chrono::milliseconds(33));
    }
}
const RemotePlayer* Find(const NetSession& session, uint8_t id) {
    for (const RemotePlayer& r : session.Remotes()) if (r.id == id) return &r;
    return nullptr;
}
}

int main() {
    // A: anfitrion y dos clientes, red limpia
    {
        auto host = NetSession::StartHost(0, "Anfitrion");
        CHECK(host != nullptr, "el anfitrion abre un puerto");
        if (!host) return 1;
        auto a = NetSession::Join("127.0.0.1", host->Port(), "Ana");
        auto b = NetSession::Join("127.0.0.1", host->Port(), "Beto");
        Walker hw{{100.0f, 0.0f, 100.0f}}, aw{{150.0f, 0.0f, 100.0f}}, bw{{110.0f, 0.0f, 130.0f}};
        hw.velocity = {3.0f, 0.0f, 0.0f}; aw.velocity = {0.0f, 0.0f, 3.0f}; bw.velocity = {-3.0f, 0.0f, 0.0f};
        std::vector<std::string> hostNotices;
        Pump(3.0, [&](float dt) {
            hw.position += hw.velocity * dt; aw.position += aw.velocity * dt; bw.position += bw.velocity * dt;
            host->Update(dt, hw.State()); a->Update(dt, aw.State()); b->Update(dt, bw.State());
            for (auto& n : host->ConsumeNotices()) hostNotices.push_back(n);
        });
        CHECK(a->Connected() && b->Connected(), "los dos clientes se conectan");
        CHECK(a->LocalId() != b->LocalId() && a->LocalId() >= 2 && b->LocalId() >= 2, "identificadores distintos y distintos del anfitrion (1)");
        CHECK(host->PlayerCount() == 3 && a->PlayerCount() == 3, "los tres se conocen");
        const RemotePlayer* hostSeenByA = Find(*a, 1);
        CHECK(hostSeenByA != nullptr, "el cliente ve al anfitrion (id 1)");
        if (hostSeenByA) CHECK(std::hypot(hostSeenByA->position.x - hw.position.x, hostSeenByA->position.z - hw.position.z) < 1.5f, "la posicion vista del anfitrion es cercana a la real");
        const RemotePlayer* aSeenByHost = Find(*host, a->LocalId());
        CHECK(aSeenByHost != nullptr, "el anfitrion ve al cliente");
        if (aSeenByHost) CHECK(std::hypot(aSeenByHost->position.x - aw.position.x, aSeenByHost->position.z - aw.position.z) < 1.5f, "la posicion vista del cliente es cercana a la real");
        const RemotePlayer* bSeenByA = Find(*a, b->LocalId());
        CHECK(bSeenByA != nullptr, "un cliente ve a otro cliente a traves del anfitrion");
        if (bSeenByA) CHECK(std::hypot(bSeenByA->position.x - bw.position.x, bSeenByA->position.z - bw.position.z) < 2.0f, "y lo ve cerca de su posicion real");
        CHECK(hostNotices.size() == 2, "el anfitrion recibe un aviso por cada jugador que entra");
        std::printf("A) 3 jugadores: ana ve al anfitrion a %.2f m de error, el anfitrion ve a ana a %.2f m; avisos: %zu\n",
                    hostSeenByA ? std::hypot(hostSeenByA->position.x - hw.position.x, hostSeenByA->position.z - hw.position.z) : -1.0f,
                    aSeenByHost ? std::hypot(aSeenByHost->position.x - aw.position.x, aSeenByHost->position.z - aw.position.z) : -1.0f, hostNotices.size());

        // un cliente se va: el anfitrion avisa y deja de verlo
        const uint8_t leftId = b->LocalId();
        b.reset();
        Pump(1.5, [&](float dt) { hw.position += hw.velocity * dt; aw.position += aw.velocity * dt; host->Update(dt, hw.State()); a->Update(dt, aw.State()); for (auto& n : host->ConsumeNotices()) hostNotices.push_back(n); });
        CHECK(hostNotices.size() == 3 && hostNotices.back().find("salió") != std::string::npos, "el anfitrion avisa cuando alguien sale");
        CHECK(Find(*host, leftId) == nullptr, "y ya no lo ve");
    }

    // B: latencia de 80 ms y 8 % de perdida en el cliente
    {
        auto host = NetSession::StartHost(0, "Anfitrion");
        auto c = NetSession::Join("127.0.0.1", host->Port(), "Cami");
        NetSimConfig sim; sim.lagMs = 80; sim.jitterMs = 20; sim.lossPercent = 8;
        c->Network().SetSimulation(sim, 5);
        host->Network().SetSimulation(sim, 6);
        Walker hw{{200.0f, 0.0f, 100.0f}}, cw{{220.0f, 0.0f, 100.0f}};
        hw.velocity = {0.0f, 0.0f, 3.0f}; cw.velocity = {0.0f, 0.0f, -3.0f};
        float worst = 0.0f; int samples = 0;
        Pump(4.0, [&](float dt) {
            hw.position += hw.velocity * dt; cw.position += cw.velocity * dt;
            host->Update(dt, hw.State()); c->Update(dt, cw.State());
            if (const RemotePlayer* seen = Find(*c, 1)) { worst = std::max(worst, std::hypot(seen->position.x - hw.position.x, seen->position.z - hw.position.z)); ++samples; }
        });
        std::printf("B) lag 80+-20 ms y 8 %% de perdida: el cliente ve al anfitrion con un atraso de hasta %.2f m (%d muestras)\n", worst, samples);
        CHECK(c->Connected() && samples > 20, "el cliente se conecta y ve al anfitrion pese a la mala red");
        CHECK(worst < 2.5f, "el atraso visual con 80 ms de lag a 3 m/s es de unos metros como mucho");
    }

    // C: partida llena y estados fuera del mapa
    {
        auto host = NetSession::StartHost(0, "Anfitrion", 2);   // anfitrion + 1
        auto one = NetSession::Join("127.0.0.1", host->Port(), "Uno");
        auto two = NetSession::Join("127.0.0.1", host->Port(), "Dos");
        Walker hw{{100.0f, 0.0f, 100.0f}}, w1{{101.0f, 0.0f, 100.0f}}, w2{{102.0f, 0.0f, 100.0f}};
        Pump(1.5, [&](float dt) { host->Update(dt, hw.State()); one->Update(dt, w1.State()); two->Update(dt, w2.State()); });
        CHECK(one->Connected() && !two->Connected() && two->Rejected(), "con la partida llena el segundo cliente se rechaza");
        w1.position = {9999.0f, 0.0f, 9999.0f};   // un estado imposible
        Pump(0.6, [&](float dt) { host->Update(dt, hw.State()); one->Update(dt, w1.State()); });
        const RemotePlayer* seen = Find(*host, one->LocalId());
        CHECK(seen == nullptr || seen->position.x < 500.0f, "el anfitrion ignora un estado fuera del mapa");
    }
    // D: combate entre jugadores (el anfitrion decide): alcance, direccion, frecuencia, dano pedido y jugadores caidos
    {
        auto host = NetSession::StartHost(0, "Anfitrion");
        auto a = NetSession::Join("127.0.0.1", host->Port(), "Ana");
        auto b = NetSession::Join("127.0.0.1", host->Port(), "Beto");
        Walker hw{{100.0f, 0.0f, 100.0f}}, aw{{101.0f, 0.0f, 100.0f}}, bw{{140.0f, 0.0f, 100.0f}};
        const auto run = [&](double seconds) { Pump(seconds, [&](float dt) { host->Update(dt, hw.State()); a->Update(dt, aw.State()); b->Update(dt, bw.State()); }); };
        run(1.2);
        CHECK(a->Connected() && b->Connected(), "D: los clientes se conectan");
        StrikeCommand jab; jab.kind = 1; jab.reach = 1.3f;
        // Ana (a 1 m del anfitrion) lo golpea mirando hacia el: -X
        jab.yaw = -1.5707963f;
        a->Strike(jab);
        run(0.4);
        auto hits = host->ConsumeHits();
        CHECK(hits.size() == 1 && hits[0].kind == 1, "D: el anfitrion recibe el golpe de Ana");
        if (!hits.empty()) CHECK(hits[0].from.x > 0.9f, "D: y sabe de que lado vino (Ana esta al este)");
        CHECK(b->ConsumeHits().empty() && a->ConsumeHits().empty(), "D: nadie mas recibe nada");
        CHECK(host->ConsumeRemoteStrikes().size() == 1, "D: el golpe de Ana tambien le llega al anfitrion para el mundo (peatones)");
        // mirando al lado contrario no le pega a nadie
        jab.yaw = 1.5707963f;
        a->Strike(jab); run(0.4);
        CHECK(host->ConsumeHits().empty(), "D: golpear hacia otro lado no alcanza");
        // dos golpes seguidos casi a la vez: el segundo se ignora (limite de frecuencia)
        jab.yaw = -1.5707963f;
        a->Strike(jab); a->Strike(jab); run(0.4);
        CHECK(host->ConsumeHits().size() == 1, "D: golpes mas rapidos de lo posible cuentan una vez");
        // el anfitrion golpea a Ana (mirando a +X): le llega por la red
        StrikeCommand cross; cross.kind = 2; cross.yaw = 1.5707963f;
        host->Strike(cross); run(0.4);
        const auto toAna = a->ConsumeHits();
        CHECK(toAna.size() == 1 && toAna[0].kind == 2, "D: Ana recibe el golpe del anfitrion por la red");
        // alcance: Ana mas lejos que el pedido; un alcance falso enorme se recorta a 3 m
        aw.position = {104.0f, 0.0f, 100.0f}; run(0.6);
        StrikeCommand far; far.kind = 3; far.yaw = -1.5707963f; far.reach = 50.0f;
        a->Strike(far); run(0.4);
        CHECK(host->ConsumeHits().empty(), "D: a 4 m no llega aunque el cliente pida un alcance de 50 m");
        aw.position = {102.5f, 0.0f, 100.0f}; run(0.6);
        run(0.3); a->Strike(far); run(0.4);
        CHECK(host->ConsumeHits().size() == 1, "D: a 2,5 m con alcance recortado a 3 m si llega");
        // un jugador caido no recibe golpes
        hw.velocity = {0.0f, 0.0f, 0.0f};
        const auto downedState = [&]() { LocalState s = hw.State(); s.knockedDown = true; return s; };
        Pump(0.5, [&](float dt) { host->Update(dt, downedState()); a->Update(dt, aw.State()); b->Update(dt, bw.State()); });
        a->Strike(far); Pump(0.4, [&](float dt) { host->Update(dt, downedState()); a->Update(dt, aw.State()); b->Update(dt, bw.State()); });
        CHECK(host->ConsumeHits().empty(), "D: un jugador tendido no recibe golpes");
        std::printf("D) combate: alcance, direccion, frecuencia y jugadores caidos validados por el anfitrion\n");
    }
    if (failures == 0) std::printf("Sesion de red: todo correcto\n");
    return failures == 0 ? 0 : 1;
}
