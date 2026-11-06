// Sesion de red del juego (anfitrion y clientes por 127.0.0.1): los jugadores se ven moverse entre si, con y sin latencia/perdida; avisos de
// entrada y salida; rechazo con la partida llena; el anfitrion ignora estados fuera del mapa o no finitos. Solo se compila con -DBAZUKO_NET=ON.
#include "net/NetSession.hpp"
#include "net/RelayServer.hpp"

#include <chrono>
#include <filesystem>
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
    std::setvbuf(stdout, nullptr, _IONBF, 0);
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
    // E: economia: el anfitrion lleva una copia de la plata y el costal del invitado y revierte lo que no se explica
    {
        std::string error;
        const auto loaded = GameData::LoadFromFile(BAZUKO_GAME_DATA_PATH, &error);
        CHECK(loaded.has_value(), "E: datos del juego");
        if (loaded) {
            const GameData& data = *loaded;
            uint16_t pan = 0;
            for (size_t i = 0; i < data.items.size(); ++i) if (data.items[i].id == "pan") pan = static_cast<uint16_t>(i);
            auto host = NetSession::StartHost(0, "Anfitrion");
            host->SetEconomyData(&data);
            auto c = NetSession::Join("127.0.0.1", host->Port(), "Cami");
            Walker hw{{100.0f, 0.0f, 100.0f}}, cw{{101.0f, 0.0f, 100.0f}};
            EconomyMirror mirror;
            EconomySnapshot mine; mine.money = 20000.0f;
            double clockSeconds = 0.0;
            int adoptions = 0;
            const auto run = [&](double seconds) {
                Pump(seconds, [&](float dt) {
                    clockSeconds += dt;
                    host->Update(dt, hw.State()); c->Update(dt, cw.State());
                    if (c->Connected()) {
                        if (const auto report = mirror.Poll(Canonical(mine, data.items.size()), clockSeconds)) c->SendEconomy(*report);
                        if (const auto sync = c->ConsumeEconomySync())
                            if (const auto adopt = mirror.OnSync(*sync, Canonical(mine, data.items.size()))) { mine = *adopt; ++adoptions; }
                    }
                });
            };
            run(1.0);
            CHECK(host->LedgerOf(c->LocalId()) && host->LedgerOf(c->LocalId())->Started(), "E: el anfitrion lleva la copia del invitado");
            mine.money -= 1500.0f; mine.items.push_back({pan, 1});   // compra honesta
            run(0.8);
            CHECK(adoptions == 0 && host->EconomyRejections() == 0 && mine.money == 18500.0f, "E: una compra honesta no se toca");
            CHECK(std::abs(host->LedgerOf(c->LocalId())->State().money - 18500.0f) < 0.01f, "E: y la copia del anfitrion la sigue");
            mine.money += 5.0e6f;   // trampa: cinco millones de la nada
            run(1.0);
            CHECK(host->EconomyRejections() >= 1 && adoptions == 1, "E: la trampa se rechaza y el invitado adopta la copia del anfitrion");
            CHECK(std::abs(mine.money - 18500.0f) < 0.01f, "E: la plata vuelve a lo que el anfitrion aceptó");
            std::printf("E) economia: compra honesta intacta; trampa de 5 millones revertida (rechazos: %zu)\n", host->EconomyRejections());
        }
    }
    // F: perfiles en el anfitrion: se guardan al salir, mandan al volver (aunque el invitado traiga otra cosa), una clave no se conecta dos veces y un perfil nuevo se recorta
    {
        std::string error;
        const auto loaded = GameData::LoadFromFile(BAZUKO_GAME_DATA_PATH, &error);
        CHECK(loaded.has_value(), "F: datos del juego");
        if (loaded) {
            namespace fs = std::filesystem;
            const GameData& data = *loaded;
            uint16_t pan = 0;
            for (size_t i = 0; i < data.items.size(); ++i) if (data.items[i].id == "pan") pan = static_cast<uint16_t>(i);
            const fs::path folder = fs::temp_directory_path() / ("bazuko_perfiles_prueba_" + NewPlayerKey());
            auto host = NetSession::StartHost(0, "Anfitrion");
            host->SetEconomyData(&data);
            host->SetProfileFolder(folder);
            Walker hw{{100.0f, 0.0f, 100.0f}}, cw{{101.0f, 0.0f, 100.0f}}, dw{{102.0f, 0.0f, 100.0f}};
            struct Guest { std::unique_ptr<NetSession> session; EconomyMirror mirror; EconomySnapshot mine; int adoptions = 0; bool profileNotice = false; };
            double clockSeconds = 0.0;
            const auto step = [&](float dt, Guest& g, const Walker& w) {
                if (!g.session) return;
                g.session->Update(dt, w.State());
                if (!g.session->Connected()) return;
                if (const auto report = g.mirror.Poll(Canonical(g.mine, data.items.size()), clockSeconds)) g.session->SendEconomy(*report);
                if (const auto sync = g.session->ConsumeEconomySync()) {
                    const bool profile = sync->profile;
                    if (const auto adopt = g.mirror.OnSync(*sync, Canonical(g.mine, data.items.size()))) { g.mine = *adopt; ++g.adoptions; g.profileNotice = g.profileNotice || profile; }
                }
            };
            Guest a, b, c;
            const std::string key = NewPlayerKey();
            a.session = NetSession::Join("127.0.0.1", host->Port(), "Cami", key);
            a.mine.money = 20000.0f; a.mine.items.push_back({pan, 2});
            const auto run = [&](double seconds) { Pump(seconds, [&](float dt) { clockSeconds += dt; host->Update(dt, hw.State()); step(dt, a, cw); step(dt, b, dw); step(dt, c, dw); }); };
            run(1.2);
            CHECK(a.adoptions == 0 && host->EconomyRejections() == 0, "F: un perfil nuevo dentro del limite empieza sin correcciones");
            a.mine.money -= 1500.0f; a.mine.items.back().second = 3;   // compra honesta
            run(0.8);
            CHECK(a.adoptions == 0 && host->EconomyRejections() == 0, "F: la compra no se toca");
            // se repite la clave mientras el primero sigue conectado: se rechaza
            b.session = NetSession::Join("127.0.0.1", host->Port(), "Otro", key);
            run(1.0);
            CHECK(b.session->Rejected() && !b.session->Connected(), "F: una clave no puede estar conectada dos veces");
            b.session.reset();
            a.session.reset();   // sale: el anfitrion guarda su perfil
            run(1.0);
            CHECK(ProfileStore(folder).Exists(key), "F: el perfil queda guardado en el anfitrion al salir");
            // vuelve con la misma clave pero con trampa local: la plata y el costal guardados mandan
            c.session = NetSession::Join("127.0.0.1", host->Port(), "Cami", key);
            c.mine.money = 9.0e6f; c.mine.items.push_back({pan, 500});
            run(1.5);
            CHECK(c.adoptions == 1 && c.profileNotice, "F: al volver recibe su perfil guardado");
            CHECK(std::abs(c.mine.money - 18500.0f) < 0.01f && !c.mine.items.empty() && c.mine.items[0].second == 3, "F: con la plata y el costal de antes, no con la trampa local");
            // perfil nuevo con trampa: se recorta
            b.session = NetSession::Join("127.0.0.1", host->Port(), "Nuevo", NewPlayerKey());
            b.mine.money = 9.0e6f; b.mine.items.push_back({pan, 500});
            run(1.5);
            CHECK(b.adoptions == 1 && b.mine.money == 50000.0f && b.mine.items[0].second == 60, "F: un perfil nuevo con trampa arranca recortado");
            std::printf("F) perfiles: guardado al salir, perfil manda al volver, clave unica y perfil nuevo recortado\n");
            b.session.reset(); c.session.reset(); host.reset();
            std::error_code ec; fs::remove_all(folder, ec);
        }
    }
    // G: migracion de anfitrion: el anfitrion se va, el jugador de menor id abre la partida en el mismo puerto, los demas se reconectan y nadie pierde su perfil
    {
        std::string error;
        const auto loaded = GameData::LoadFromFile(BAZUKO_GAME_DATA_PATH, &error);
        CHECK(loaded.has_value(), "G: datos del juego");
        if (loaded) {
            namespace fs = std::filesystem;
            const GameData& data = *loaded;
            uint16_t pan = 0;
            for (size_t i = 0; i < data.items.size(); ++i) if (data.items[i].id == "pan") pan = static_cast<uint16_t>(i);
            const fs::path folderHost = fs::temp_directory_path() / ("bazuko_migracion_a_" + NewPlayerKey());
            const fs::path folderNew = fs::temp_directory_path() / ("bazuko_migracion_b_" + NewPlayerKey());
            auto host = NetSession::StartHost(0, "Anfitrion");
            host->SetEconomyData(&data);
            host->SetProfileFolder(folderHost);
            const uint16_t port = host->Port();
            struct Guest { std::unique_ptr<NetSession> session; EconomyMirror mirror; EconomySnapshot mine; uint32_t epoch = 0; std::string key; };
            Walker hw{{100.0f, 0.0f, 100.0f}}, aw{{101.0f, 0.0f, 100.0f}}, bw{{102.0f, 0.0f, 100.0f}};
            double clockSeconds = 0.0;
            bool promotedSeen = false;
            const auto step = [&](float dt, Guest& g, const Walker& w) {
                if (!g.session) return;
                g.session->Update(dt, w.State());
                if (g.session->ConsumePromotion()) { promotedSeen = true; g.session->SetEconomyData(&data); g.session->SetProfileFolder(folderNew); }
                if (g.session->GetRole() != NetSession::Role::Client || !g.session->Connected()) return;
                if (g.epoch != g.session->Epoch()) { g.epoch = g.session->Epoch(); g.mirror.Restart(); }
                if (const auto report = g.mirror.Poll(Canonical(g.mine, data.items.size()), clockSeconds)) g.session->SendEconomy(*report);
                if (const auto sync = g.session->ConsumeEconomySync())
                    if (const auto adopt = g.mirror.OnSync(*sync, Canonical(g.mine, data.items.size()))) g.mine = *adopt;
            };
            Guest a, b;
            a.key = NewPlayerKey(); b.key = NewPlayerKey();
            a.session = NetSession::Join("127.0.0.1", port, "Ana", a.key);
            b.session = NetSession::Join("127.0.0.1", port, "Beto", b.key);
            a.mine.money = 20000.0f; a.mine.level = 5; a.mine.xp = 40; a.mine.talentPoints = 4;
            b.mine.money = 10000.0f; b.mine.level = 3; b.mine.talentPoints = 2;
            const auto run = [&](double seconds) { Pump(seconds, [&](float dt) { clockSeconds += dt; if (host) host->Update(dt, hw.State()); step(dt, a, aw); step(dt, b, bw); }); };
            run(2.0);
            CHECK(a.session->Connected() && b.session->Connected(), "G: los dos se conectan");
            b.mine.money -= 1500.0f; b.mine.items.push_back({pan, 1}); b.mine.xp = 90;   // Beto compra y gana experiencia justo antes de la caida
            run(2.5);
            const float betoMoney = b.mine.money;
            host.reset();   // el anfitrion se va sin avisar de nada mas
            run(7.0);
            CHECK(promotedSeen && a.session->GetRole() == NetSession::Role::Host, "G: Ana (la de menor id) pasa a ser la anfitriona");
            CHECK(b.session->GetRole() == NetSession::Role::Client && b.session->Connected() && !b.session->Migrating(), "G: Beto se reconecta a ella");
            CHECK(a.session->Port() == port, "G: abre la partida en el mismo puerto");
            const NetSession::Role roleA = a.session->GetRole();
            (void)roleA;
            const RemotePlayer* betoSeenByAna = nullptr;
            for (const RemotePlayer& r : a.session->Remotes()) betoSeenByAna = &r;
            CHECK(betoSeenByAna != nullptr, "G: Ana ve a Beto en la partida nueva");
            const RemotePlayer* anaSeenByBeto = nullptr;
            for (const RemotePlayer& r : b.session->Remotes()) if (r.id == 1) anaSeenByBeto = &r;
            CHECK(anaSeenByBeto != nullptr, "G: Beto ve a Ana como anfitriona (id 1)");
            const Ledger* betoLedger = a.session->LedgerOf(b.session->LocalId());
            CHECK(betoLedger && betoLedger->Started() && std::abs(betoLedger->State().money - betoMoney) < 0.01f, "G: la nueva anfitriona conserva la plata de Beto");
            CHECK(betoLedger && betoLedger->State().xp == 90 && betoLedger->State().level == 3, "G: y su experiencia y su nivel");
            CHECK(ProfileStore(folderNew).Exists(b.key) && ProfileStore(folderNew).Exists(a.key), "G: los perfiles de todos quedaron guardados en la carpeta de la nueva anfitriona");
            if (const auto savedAna = ProfileStore(folderNew).Load(a.key)) CHECK(savedAna->value("level", 0) == 5 && savedAna->value("talentPoints", 0) == 4, "G: el perfil de Ana conserva nivel y puntos de talento");
            b.mine.money += 3.0e6f;   // una trampa despues de la migracion
            run(1.0);
            CHECK(a.session->EconomyRejections() >= 1 && std::abs(b.mine.money - betoMoney) < 0.01f, "G: la nueva anfitriona sigue validando: la trampa se revierte");
            std::printf("G) migracion: Ana asume como anfitriona, Beto se reconecta, perfiles (plata, nivel, experiencia, talentos) conservados\n");
            b.session.reset(); a.session.reset();
            std::error_code ec; fs::remove_all(folderHost, ec); fs::remove_all(folderNew, ec);
        }
    }
    // H: internet por relevo: nadie abre puertos; se juega por una sala del servidor de relevo, incluida la migracion de anfitrion (la sala se retoma con su secreto)
    {
        std::string error;
        const auto loaded = GameData::LoadFromFile(BAZUKO_GAME_DATA_PATH, &error);
        CHECK(loaded.has_value(), "H: datos del juego");
        auto relay = RelayServer::Create(0);
        CHECK(relay != nullptr, "H: el relevo abre un puerto");
        if (loaded && relay) {
            namespace fs = std::filesystem;
            const GameData& data = *loaded;
            uint16_t pan = 0;
            for (size_t i = 0; i < data.items.size(); ++i) if (data.items[i].id == "pan") pan = static_cast<uint16_t>(i);
            const fs::path folderA = fs::temp_directory_path() / ("bazuko_relevo_a_" + NewPlayerKey());
            const fs::path folderB = fs::temp_directory_path() / ("bazuko_relevo_b_" + NewPlayerKey());
            auto host = NetSession::StartHostViaRelay("127.0.0.1", relay->Port(), "Anfitrion");
            CHECK(host != nullptr, "H: el anfitrion se conecta al relevo");
            host->SetEconomyData(&data);
            host->SetProfileFolder(folderA);
            struct Guest { std::unique_ptr<NetSession> session; EconomyMirror mirror; EconomySnapshot mine; uint32_t epoch = 0; std::string key; };
            Walker hw{{100.0f, 0.0f, 100.0f}}, aw{{101.0f, 0.0f, 100.0f}}, bw{{102.0f, 0.0f, 100.0f}};
            double clockSeconds = 0.0;
            bool promotedSeen = false;
            const auto step = [&](float dt, Guest& g, const Walker& w) {
                if (!g.session) return;
                g.session->Update(dt, w.State());
                if (g.session->ConsumePromotion()) { promotedSeen = true; g.session->SetEconomyData(&data); g.session->SetProfileFolder(folderB); }
                if (g.session->GetRole() != NetSession::Role::Client || !g.session->Connected()) return;
                if (g.epoch != g.session->Epoch()) { g.epoch = g.session->Epoch(); g.mirror.Restart(); }
                if (const auto report = g.mirror.Poll(Canonical(g.mine, data.items.size()), clockSeconds)) g.session->SendEconomy(*report);
                if (const auto sync = g.session->ConsumeEconomySync())
                    if (const auto adopt = g.mirror.OnSync(*sync, Canonical(g.mine, data.items.size()))) g.mine = *adopt;
            };
            Guest a, b, bad;
            const auto run = [&](double seconds) { Pump(seconds, [&](float dt) { clockSeconds += dt; relay->Update(); if (host) host->Update(dt, hw.State()); step(dt, a, aw); step(dt, b, bw); step(dt, bad, bw); }); };
            run(1.0);
            const std::string code = host->RoomCode();
            CHECK(code.size() == 6 && !host->RoomFailed(), "H: el relevo da un codigo de sala de 6 caracteres");
            a.key = NewPlayerKey(); b.key = NewPlayerKey();
            a.session = NetSession::JoinViaRelay("127.0.0.1", relay->Port(), code, "Ana", a.key);
            b.session = NetSession::JoinViaRelay("127.0.0.1", relay->Port(), code, "Beto", b.key);
            a.mine.money = 20000.0f; a.mine.level = 5; a.mine.talentPoints = 4;
            b.mine.money = 10000.0f;
            bad.session = NetSession::JoinViaRelay("127.0.0.1", relay->Port(), "ZZZZZZ", "Intruso");
            run(2.5);
            CHECK(a.session->Connected() && b.session->Connected(), "H: los invitados entran por el codigo");
            CHECK(!bad.session->Connected(), "H: un codigo que no existe no entra");
            CHECK(relay->RoomCount() == 1 && relay->GuestCount() == 2, "H: el relevo lleva una sala con dos invitados");
            bool anaSeesHost = false, hostSeesAna = false;
            for (const RemotePlayer& r : a.session->Remotes()) anaSeesHost = anaSeesHost || r.id == 1;
            for (const RemotePlayer& r : host->Remotes()) hostSeesAna = hostSeesAna || r.id == a.session->LocalId();
            CHECK(anaSeesHost && hostSeesAna, "H: se ven entre ellos a traves del relevo");
            b.mine.money += 4.0e6f;   // trampa: se revierte por el relevo igual que en directo
            run(1.2);
            CHECK(host->EconomyRejections() >= 1 && std::abs(b.mine.money - 10000.0f) < 0.01f, "H: la validacion de economia funciona por el relevo");
            b.mine.money -= 1500.0f; b.mine.items.push_back({pan, 1});
            run(2.5);
            const float betoMoney = b.mine.money;
            host.reset();   // el anfitrion cae: la sala queda sin anfitrion en el relevo
            run(8.0);
            CHECK(promotedSeen && a.session->GetRole() == NetSession::Role::Host, "H: Ana asume como anfitriona retomando la misma sala");
            CHECK(a.session->RoomCode() == code, "H: con el mismo codigo de sala");
            CHECK(b.session->Connected() && b.session->GetRole() == NetSession::Role::Client, "H: Beto vuelve a entrar a la sala por el relevo");
            const Ledger* betoLedger = a.session->LedgerOf(b.session->LocalId());
            CHECK(betoLedger && std::abs(betoLedger->State().money - betoMoney) < 0.01f, "H: la plata de Beto sobrevivio a la migracion por relevo");
            std::printf("H) relevo: sala %s, dos invitados por internet simulado, trampa revertida, migracion retomando la sala (bytes reenviados: %llu)\n", code.c_str(), static_cast<unsigned long long>(relay->BytesRelayed()));
            b.session.reset(); a.session.reset(); bad.session.reset();
            std::error_code ec; fs::remove_all(folderA, ec); fs::remove_all(folderB, ec);
        }
    }
    // I: relevo voluntario: el anfitrion le pasa la partida al siguiente y vuelve a entrar como invitado, sin perder su perfil ni el de nadie
    for (const bool viaRelay : {false, true}) {
        std::string error;
        const auto loaded = GameData::LoadFromFile(BAZUKO_GAME_DATA_PATH, &error);
        auto relay = viaRelay ? RelayServer::Create(0) : nullptr;
        if (!loaded || (viaRelay && !relay)) { CHECK(false, "I: datos o relevo"); continue; }
        namespace fs = std::filesystem;
        const GameData& data = *loaded;
        const fs::path folder = fs::temp_directory_path() / ("bazuko_traspaso_" + NewPlayerKey());
        const std::string hostKey = NewPlayerKey();
        auto host = viaRelay ? NetSession::StartHostViaRelay("127.0.0.1", relay->Port(), "Hugo") : NetSession::StartHost(0, "Hugo");
        host->SetEconomyData(&data); host->SetLocalKey(hostKey);
        EconomySnapshot hostMoney; hostMoney.money = 33333.0f; hostMoney.level = 4; hostMoney.talentPoints = 3;
        host->SetHostEconomy(hostMoney);
        struct Guest { std::unique_ptr<NetSession> session; EconomyMirror mirror; EconomySnapshot mine; uint32_t epoch = 0; std::string key; };
        Walker hw{{100.0f, 0.0f, 100.0f}}, aw{{101.0f, 0.0f, 100.0f}}, bw{{102.0f, 0.0f, 100.0f}};
        double clockSeconds = 0.0;
        bool promoted = false;
        const auto step = [&](float dt, Guest& g, const Walker& w) {
            if (!g.session) return;
            g.session->Update(dt, w.State());
            if (g.session->ConsumePromotion()) { promoted = true; g.session->SetEconomyData(&data); g.session->SetProfileFolder(folder); }
            if (g.session->GetRole() != NetSession::Role::Client || !g.session->Connected()) return;
            if (g.epoch != g.session->Epoch()) { g.epoch = g.session->Epoch(); g.mirror.Restart(); }
            if (const auto report = g.mirror.Poll(Canonical(g.mine, data.items.size()), clockSeconds)) g.session->SendEconomy(*report);
            if (const auto sync = g.session->ConsumeEconomySync())
                if (const auto adopt = g.mirror.OnSync(*sync, Canonical(g.mine, data.items.size()))) g.mine = *adopt;
        };
        Guest a, b;
        const auto run = [&](double seconds) { Pump(seconds, [&](float dt) { clockSeconds += dt; if (relay) relay->Update(); step(dt, a, aw); step(dt, b, bw); }); };
        // el anfitrion (hw) se maneja aparte para poder entregarlo al traspaso
        const auto runWithHost = [&](double seconds) { Pump(seconds, [&](float dt) { clockSeconds += dt; if (relay) relay->Update(); host->Update(dt, hw.State()); step(dt, a, aw); step(dt, b, bw); }); };
        if (viaRelay) runWithHost(1.0);
        a.key = NewPlayerKey(); b.key = NewPlayerKey();
        a.session = viaRelay ? NetSession::JoinViaRelay("127.0.0.1", relay->Port(), host->RoomCode(), "Ana", a.key) : NetSession::Join("127.0.0.1", host->Port(), "Ana", a.key);
        b.session = viaRelay ? NetSession::JoinViaRelay("127.0.0.1", relay->Port(), host->RoomCode(), "Beto", b.key) : NetSession::Join("127.0.0.1", host->Port(), "Beto", b.key);
        a.mine.money = 20000.0f; b.mine.money = 10000.0f;
        runWithHost(2.5);
        CHECK(a.session->Connected() && b.session->Connected(), "I: los invitados estan dentro");
        CHECK(host->HandOver(true), "I: el anfitrion puede traspasar (hay a quien)");
        bool hostBecameGuest = false;
        EconomyMirror oldHostMirror; uint32_t oldHostEpoch = 0;
        Pump(9.0, [&](float dt) {
            clockSeconds += dt; if (relay) relay->Update();
            host->Update(dt, hw.State()); step(dt, a, aw); step(dt, b, bw);
            hostBecameGuest = hostBecameGuest || (host->GetRole() == NetSession::Role::Client && host->Connected());
            if (host->GetRole() == NetSession::Role::Client && host->Connected()) {   // como invitado cuenta su economia igual que los demas
                if (oldHostEpoch != host->Epoch()) { oldHostEpoch = host->Epoch(); oldHostMirror.Restart(); }
                if (const auto report = oldHostMirror.Poll(Canonical(hostMoney, data.items.size()), clockSeconds)) host->SendEconomy(*report);
            }
        });
        CHECK(promoted && a.session->GetRole() == NetSession::Role::Host, viaRelay ? "I(relevo): Ana recibe la partida" : "I: Ana recibe la partida");
        CHECK(hostBecameGuest && host->GetRole() == NetSession::Role::Client, "I: el antiguo anfitrion vuelve a entrar como invitado");
        CHECK(b.session->Connected() && b.session->GetRole() == NetSession::Role::Client, "I: Beto sigue dentro");
        const Ledger* hostLedger = a.session->LedgerOf(host->LocalId());
        CHECK(hostLedger && hostLedger->Started() && std::abs(hostLedger->State().money - 33333.0f) < 0.01f && hostLedger->State().level == 4, "I: el perfil del antiguo anfitrion (plata y nivel) viajo con el traspaso");
        std::printf("I) traspaso voluntario%s: Hugo pasa la partida a Ana y vuelve como invitado con su perfil\n", viaRelay ? " por relevo" : "");
        b.session.reset(); a.session.reset(); host.reset();
        std::error_code ec; fs::remove_all(folder, ec);
    }
    // J: apariencias: cada jugador ve a los demas con su propia apariencia (la del saludo), tambien a los que entran despues y tras migrar
    {
        auto host = NetSession::StartHost(0, "Anfitrion");
        host->SetLook("host|look");
        auto a = NetSession::Join("127.0.0.1", host->Port(), "Ana");
        a->SetLook("ana|look");
        Walker hw{{100.0f, 0.0f, 100.0f}}, aw{{101.0f, 0.0f, 100.0f}}, bw{{102.0f, 0.0f, 100.0f}};
        std::unique_ptr<NetSession> b;
        const auto run = [&](double seconds) { Pump(seconds, [&](float dt) { if (host) host->Update(dt, hw.State()); if (a) a->Update(dt, aw.State()); if (b) b->Update(dt, bw.State()); }); };
        run(1.5);
        b = NetSession::Join("127.0.0.1", host->Port(), "Beto");   // entra despues
        b->SetLook("beto|look");
        run(1.5);
        const auto lookOf = [](const NetSession& s, uint8_t id) { for (const RemotePlayer& r : s.Remotes()) if (r.id == id) return r.look; return std::string("(no esta)"); };
        CHECK(lookOf(*a, 1) == "host|look", "J: Ana ve al anfitrion con su apariencia");
        CHECK(lookOf(*host, a->LocalId()) == "ana|look" && lookOf(*host, b->LocalId()) == "beto|look", "J: el anfitrion ve a los dos con la suya");
        CHECK(lookOf(*b, a->LocalId()) == "ana|look" && lookOf(*a, b->LocalId()) == "beto|look", "J: y se ven entre ellos, aunque Beto haya entrado despues");
        CHECK(lookOf(*b, 1) == "host|look", "J: Beto ve la del anfitrion");
        std::printf("J) apariencias: cada jugador ve a los demas con su personaje (anfitrion, quien estaba y quien entro despues)\n");
    }
    if (failures == 0) std::printf("Sesion de red: todo correcto\n");
    return failures == 0 ? 0 : 1;
}
