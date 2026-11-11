// Fumar: tiempos y reglas del original (calada cada 30 s, primera a los 2 s, dura 10 min, el porro pega al botar el humo, se cae al nadar o saltar).
#include "character/Smoking.hpp"

#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

using namespace Bazuko::Smoking;

static int failures = 0;
#define CHECK(condition, message) do { if (!(condition)) { ++failures; std::printf("FALLO (%d): %s\n", __LINE__, message); } } while (0)

int main() {
    // la curva de la mano y de la brasa
    CHECK(PuffReach(-1.0f) == 0.0f && PuffReach(0.0f) == 0.0f, "la mano empieza abajo");
    CHECK(std::abs(PuffReach(0.4f) - 0.5f) < 1e-5f, "a mitad de la subida esta a medio camino");
    CHECK(PuffReach(1.0f) == 1.0f && PuffReach(2.0f) == 1.0f, "en la boca mientras aspira");
    CHECK(PuffReach(kPuffLength) < 1e-6f && PuffReach(10.0f) == 0.0f, "vuelve abajo al terminar de bajar");
    CHECK(EmberGlow(0.0f) == 0.0f && EmberGlow(1.5f) > 0.99f && EmberGlow(kPuffLength + 1.0f) == 0.0f, "la brasa se aviva al aspirar y se apaga despues");
    CHECK(!IsExhaling(1.0f) && IsExhaling(kRaise + kHold + 0.1f) && !IsExhaling(kPuffTotal + 0.1f), "el humo sale al bajar la mano");
    CHECK(Find("cigarrillo") && Find("hierba") && !Find("pan"), "se fuman el cigarrillo y la hierba");

    {   // empezar
        State s;
        CHECK(!Start(s, "pan", {}), "no se puede fumar pan");
        CHECK(!Start(s, "cigarrillo", {true, false}), "no se prende nadando, en el aire o noqueado");
        CHECK(Start(s, "cigarrillo", {}) && s.active && s.left == kDuration, "se prende");
        CHECK(!Start(s, "hierba", {}), "ya tiene uno prendido");
    }
    {   // caladas: la primera a los 2 s y despues una cada 30 s exactos; el cigarrillo no pega
        State s; Start(s, "cigarrillo", {});
        std::vector<float> starts; bool wasPuffing = false; int hits = 0;
        for (float t = 0.0f; t < 125.0f; t += 1.0f / 60.0f) {
            const Events e = Step(s, 1.0f / 60.0f, {});
            hits += e.hit ? 1 : 0;
            if (s.puff >= 0.0f && !wasPuffing) starts.push_back(t);
            wasPuffing = s.puff >= 0.0f;
        }
        CHECK(starts.size() == 5, "cinco caladas en dos minutos (2, 32, 62, 92 y 122 s)");
        if (starts.size() == 5) CHECK(std::abs(starts[0] - 2.0f) < 0.05f && std::abs(starts[1] - 32.0f) < 0.05f && std::abs(starts[4] - 122.0f) < 0.05f, "los tiempos de las caladas");
        CHECK(hits == 0, "el cigarrillo comun no pega");
    }
    {   // el porro pega una vez por calada
        State s; Start(s, "hierba", {});
        int hits = 0; const char* effect = nullptr;
        for (float t = 0.0f; t < 65.0f; t += 1.0f / 60.0f) { const Events e = Step(s, 1.0f / 60.0f, {}); if (e.hit) { ++hits; effect = e.effect; } }
        CHECK(hits == 3 && effect && std::string(effect) == "hierba", "tres caladas del porro, tres golpes del efecto «hierba»");
    }
    {   // pelear cancela la calada y espera
        State s; Start(s, "cigarrillo", {});
        for (float t = 0.0f; t < 2.5f; t += 1.0f / 60.0f) Step(s, 1.0f / 60.0f, {});
        CHECK(s.puff >= 0.0f, "ya esta en plena calada");
        Step(s, 1.0f / 60.0f, {false, true});
        CHECK(s.puff < 0.0f, "al pelear se interrumpe la calada");
        Step(s, 1.0f / 60.0f, {false, true});
        CHECK(s.puff < 0.0f && s.active, "y sigue fumando sin dar caladas mientras pelea");
    }
    {   // se cae al nadar o saltar
        State s; Start(s, "cigarrillo", {});
        const Events e = Step(s, 0.1f, {true, false});
        CHECK(e.dropped && !s.active, "se le cae al nadar, saltar o recibir un golpe");
    }
    {   // se acaba a los 10 minutos
        State s; Start(s, "cigarrillo", {});
        bool finished = false; float at = 0.0f;
        for (float t = 0.0f; t < 700.0f && !finished; t += 0.1f) { const Events e = Step(s, 0.1f, {}); if (e.finished) { finished = true; at = t; } }
        CHECK(finished && std::abs(at - 600.0f) < 0.5f && !s.active, "se acaba a los 10 minutos");
    }
    {   // la pose se suaviza: sube al prenderlo y baja al soltarlo
        State s; Start(s, "cigarrillo", {});
        for (int i = 0; i < 60; ++i) Step(s, 1.0f / 60.0f, {});
        CHECK(s.hold > 0.95f, "en un segundo ya lo sostiene");
        Stop(s);
        CHECK(s.hold == 0.0f && !s.active, "al soltarlo se reinicia");
    }
    if (failures == 0) std::printf("Fumar: todo correcto\n");
    return failures == 0 ? 0 : 1;
}
