// Basuco en pipa: los tiempos del original (agacharse 0,9 s, prender y aspirar 3,2 s, bajar 0,9 s, humo hasta 6,9 s) y sus reglas.
#include "character/Pipe.hpp"

#include <cmath>
#include <cstdio>

using namespace Bazuko::Pipe;

static int failures = 0;
#define CHECK(condition, message) do { if (!(condition)) { ++failures; std::printf("FALLO (%d): %s\n", __LINE__, message); } } while (0)

int main() {
    CHECK(std::abs(kLength - 5.0f) < 1e-5f && std::abs(kTotal - 6.9f) < 1e-5f, "5 s quieto con la pipa y 6,9 s hasta el fin del humo");
    CHECK(Reach(-1.0f) == 0.0f && Reach(0.0f) == 0.0f && std::abs(Reach(0.45f) - 0.5f) < 1e-5f && Reach(2.0f) == 1.0f && Reach(kLength) < 1e-5f, "agachado al subir las manos, arriba al aspirar, de pie al terminar");
    CHECK(!IsLit(0.5f) && IsLit(0.8f) && IsLit(3.0f) && !IsLit(kBend + kLight) , "la llama se prende al llegar arriba y se apaga al dejar de aspirar");
    CHECK(!IsExhaling(3.0f) && IsExhaling(4.2f) && !IsExhaling(kTotal + 0.1f), "la bocanada sale al bajar las manos");
    {
        State s;
        CHECK(!Start(s, {true, false}) && !Start(s, {false, true}), "no se prende ocupado, nadando ni en el aire");
        CHECK(Start(s, {}) && s.active && Holding(s), "se prende");
        CHECK(!Start(s, {}), "ya tiene la pipa");
        bool inhaled = false, stowed = false; float inhaledAt = 0.0f, stowedAt = 0.0f, endedAt = 0.0f;
        for (float t = 0.0f; t < 8.0f; t += 1.0f / 60.0f) {
            const Events e = Step(s, 1.0f / 60.0f, {});
            if (e.inhaled && !inhaled) { inhaled = true; inhaledAt = t; }
            if (e.stowedNow && !stowed) { stowed = true; stowedAt = t; }
            if (!s.active && endedAt == 0.0f) endedAt = t;
        }
        CHECK(inhaled && std::abs(inhaledAt - 4.1f) < 0.05f, "el efecto llega al terminar de aspirar (a los 4,1 s)");
        CHECK(stowed && std::abs(stowedAt - 5.0f) < 0.05f, "guarda la pipa a los 5 s");
        CHECK(endedAt > 0.0f && std::abs(endedAt - 6.9f) < 0.05f && !Holding(s), "y el humo termina a los 6,9 s");
    }
    {   // quieto con la pipa y suelta al guardarla
        State s; Start(s, {});
        for (int i = 0; i < 60 * 3; ++i) Step(s, 1.0f / 60.0f, {});
        CHECK(Holding(s) && s.reach > 0.95f, "a los 3 s esta agachado con la pipa en la boca");
        for (int i = 0; i < 60 * 2; ++i) Step(s, 1.0f / 60.0f, {});
        CHECK(!Holding(s) && s.reach < 0.2f, "pasados los 5 s se para de nuevo");
    }
    {   // se corta al nadar, saltar o caer
        State s; Start(s, {});
        for (int i = 0; i < 30; ++i) Step(s, 1.0f / 60.0f, {});
        Step(s, 1.0f / 60.0f, {false, true});
        CHECK(!s.active, "si lo aturden o cae, se guarda sin efecto");
    }
    if (failures == 0) std::printf("Basuco en pipa: todo correcto\n");
    return failures == 0 ? 0 : 1;
}
