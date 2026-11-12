// Limpieza social (world/LimpiezaSocial.hpp): llega solo de noche y donde se permite, frena sin pisar al jugador, el jefe se queda
// y los otros dos pegan; si el jugador se escapa vuelven y la camioneta se va.
#include "world/LimpiezaSocial.hpp"
#include <cstdio>

static int failures = 0;
#define CHECK(c, m) do { if (!(c)) { std::printf("FALLO (%d): %s\n", __LINE__, m); ++failures; } } while (0)

using namespace Bazuko::Limpieza;

// una calle recta y larga sobre X (z = 0), cerrada en circulo de 400 m
static std::vector<Route> Street() {
    Route r;
    r.length = 400.0f;
    r.sample = [](float d, glm::vec3& p, glm::vec3& dir) { p = {d - 200.0f, 0.0f, 0.0f}; dir = {1.0f, 0.0f, 0.0f}; };
    return {r};
}

static int RunVisit(System& system, glm::vec3& player, bool flee, int& hits, int& damage, bool& left, float seconds) {
    const auto routes = Street();
    int swings = 0;
    for (float t = 0.0f; t < seconds; t += 1.0f / 60.0f) {
        if (flee && system.GetState() == State::Out) player.z += 6.5f / 60.0f;   // corre mas que ellos
        Context ctx;
        ctx.player = player;
        ctx.isNight = true;
        for (const Event& e : system.Update(1.0f / 60.0f, ctx, routes)) {
            if (e.kind == Event::Swing) ++swings;
            if (e.kind == Event::Hit) { ++hits; damage += e.damage; }
            if (e.kind == Event::Left) left = true;
        }
        if (left) break;
    }
    return swings;
}

int main() {
    const auto routes = Street();
    {   // de dia no llega; cerca del cambuche tampoco; de noche, con el tiempo, si
        System system;
        Context day;
        day.player = {0.0f, 0.0f, 8.0f};
        for (int i = 0; i < 60 * 1200; ++i) system.Update(1.0f / 60.0f, day, routes);
        CHECK(!system.Active(), "de dia no llega");
        Context cambuche = day;
        cambuche.isNight = true;
        cambuche.allowSpawn = false;
        for (int i = 0; i < 60 * 1200; ++i) system.Update(1.0f / 60.0f, cambuche, routes);
        CHECK(!system.Active(), "junto al cambuche no llega");
        Context night = cambuche;
        night.allowSpawn = true;
        bool came = false;
        for (int i = 0; i < 60 * 3600 && !came; ++i) { system.Update(1.0f / 60.0f, night, routes); came = system.Active(); }
        CHECK(came, "de noche, en una hora, llega alguna vez");
    }
    {   // llega, frena junto al jugador sin pisarlo, se bajan y le pegan; el jefe no persigue
        System system;
        glm::vec3 player{0.0f, 0.0f, 6.0f};
        CHECK(system.Trigger(player, routes), "hay calle cerca: viene");
        CHECK(!System().Trigger({0.0f, 0.0f, 60.0f}, routes), "sin calle a menos de 20 m no viene");
        int hits = 0, damage = 0;
        bool left = false;
        const int swings = RunVisit(system, player, false, hits, damage, left, 12.0f);
        CHECK(std::abs(system.SuvPosition().x - player.x) < 1.0f, "frena junto al jugador");
        CHECK(swings > 0 && hits > 0, "los matones lo alcanzan y le pegan");
        CHECK(hits == 0 || (damage >= hits * 20 && damage <= hits * 30), "cada cachazo quita entre 20 y 30");
        const Member& leader = system.Members()[0];
        CHECK(leader.Active() && glm::distance(leader.position, leader.door) < 0.5f, "el jefe se queda junto a la camioneta");
        CHECK(leader.point > 0.9f, "el jefe senala");
        CHECK(!leader.bubble.empty(), "el jefe da la orden");
    }
    {   // en el carril: frena antes de pisarlo
        System system;
        glm::vec3 player{0.0f, 0.0f, 3.2f};
        system.Trigger(player, routes);
        player = {system.SuvPosition().x + 30.0f, 0.0f, 0.3f};   // se para en el carril, adelante
        for (int i = 0; i < 60 * 8 && system.GetState() == State::Arriving; ++i) {
            Context ctx; ctx.player = player; ctx.isNight = true;
            system.Update(1.0f / 60.0f, ctx, routes);
        }
        CHECK(player.x - system.SuvPosition().x > 2.6f, "no pisa a quien esta en el carril");
    }
    {   // vienen sentados; al frenar se bajan por su puerta (uno tras otro) y, antes de irse, se vuelven a subir
        System system;
        glm::vec3 player{0.0f, 0.0f, 6.0f};
        system.Trigger(player, routes);
        bool seatedWhileArriving = true, exited = false, boardedBeforeLeaving = false, onFootDuringExit = false;
        float firstOut = -1.0f;
        for (float t = 0.0f; t < 120.0f; t += 1.0f / 60.0f) {
            if (system.GetState() == State::Out) player.z += 6.5f / 60.0f;
            Context ctx; ctx.player = player; ctx.isNight = true;
            const State before = system.GetState();
            for (const Event& e : system.Update(1.0f / 60.0f, ctx, routes)) {
                if (e.kind == Event::DroppedOff) {
                    for (const Member& m : system.Members()) exited = exited || m.act == Act::Exiting;
                    for (const Member& m : system.Members()) onFootDuringExit = onFootDuringExit || m.Active();
                }
            }
            if (before == State::Arriving) for (const Member& m : system.Members()) seatedWhileArriving = seatedWhileArriving && m.Seated();
            if (firstOut < 0.0f && system.Members()[1].Active()) firstOut = t;
            if (before == State::Out && system.GetState() == State::Leaving) {
                boardedBeforeLeaving = true;
                for (const Member& m : system.Members()) boardedBeforeLeaving = boardedBeforeLeaving && m.Seated();
            }
            if (!system.Active()) break;
        }
        CHECK(seatedWhileArriving, "vienen sentados en la camioneta");
        CHECK(exited && !onFootDuringExit, "al frenar empiezan a bajarse; nadie aparece de pie de una");
        CHECK(firstOut > 0.0f, "termina de bajarse y queda en la calle");
        CHECK(boardedBeforeLeaving, "la camioneta arranca con los tres sentados");
        const System fresh;
        CHECK(glm::distance(fresh.DoorPoint(1), fresh.DoorPoint(2)) > 3.0f, "las puertas de atras quedan a lado y lado");
    }
    {   // si se escapa, se cansan, vuelven y la camioneta se va
        System system;
        glm::vec3 player{0.0f, 0.0f, 6.0f};
        system.Trigger(player, routes);
        int hits = 0, damage = 0;
        bool left = false;
        RunVisit(system, player, true, hits, damage, left, 120.0f);
        CHECK(left && !system.Active(), "se suben y se van");
        for (const Member& m : system.Members()) CHECK(!m.Active(), "nadie queda en la calle");
        CHECK(system.Cooldown() > 200.0f, "no vuelven enseguida");
    }
    {   // dormido o muerto: dejan de perseguir; Reset los sube a todos
        System system;
        glm::vec3 player{0.0f, 0.0f, 6.0f};
        system.Trigger(player, routes);
        for (int i = 0; i < 60 * 6; ++i) { Context ctx; ctx.player = player; ctx.isNight = true; system.Update(1.0f / 60.0f, ctx, routes); }
        Context asleep; asleep.player = player; asleep.isNight = true; asleep.canChase = false;
        bool hit = false;
        for (int i = 0; i < 60 * 3; ++i) for (const Event& e : system.Update(1.0f / 60.0f, asleep, routes)) hit = hit || e.kind == Event::Hit;
        CHECK(!hit, "sin poder perseguir no pegan");
        system.Reset();
        CHECK(!system.Active(), "tras recuperarse no queda nadie");
        CHECK(system.Update(0.0f, asleep, routes).empty(), "en pausa no pasa nada");
    }
    if (failures == 0) std::printf("Limpieza social: todo bien\n");
    return failures == 0 ? 0 : 1;
}
