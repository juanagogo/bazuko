// Frases de la calle: las reglas del original (alcance, una a la vez, enfriamientos por persona y por grabacion, hueco entre frases, los 4 mas cercanos).
#include "audio/StreetVoices.hpp"
#include "world/PoliceSound.hpp"

#include <cmath>
#include <cstdio>

using namespace Bazuko;
using Kind = StreetVoiceDirector::Action::Kind;

static int failures = 0;
#define CHECK(condition, message) do { if (!(condition)) { ++failures; std::printf("FALLO (%d): %s\n", __LINE__, message); } } while (0)

static std::vector<StreetVoiceCandidate> One(uint32_t id, float distance) { return {{id, distance}}; }

int main() {
    // caida por distancia (como distanceGain: cuadratica, pleno a 5 m, mudo a 18 m)
    CHECK(std::abs(StreetVoiceDirector::Gain(3.0f) - 1.0f) < 1e-6f && std::abs(StreetVoiceDirector::Gain(18.0f)) < 1e-6f && std::abs(StreetVoiceDirector::Gain(30.0f)) < 1e-6f, "pleno de cerca, mudo desde 18 m");
    CHECK(std::abs(StreetVoiceDirector::Gain(11.5f) - 0.25f) < 1e-5f, "a la mitad del recorrido suena a un cuarto");

    CHECK(std::abs(SirenGain(8.0f) - 1.0f) < 1e-6f && std::abs(SirenGain(55.0f)) < 1e-6f && std::abs(SirenGain(90.0f)) < 1e-6f, "sirena: plena de cerca, muda desde 55 m");
    CHECK(std::abs(SirenGain(33.5f) - 0.25f) < 1e-5f, "sirena: a la mitad del recorrido, un cuarto");
    {   // una frase no empieza si quien la dice esta tan lejos que no se oiria
        StreetVoiceDirector director(21);
        CHECK(director.Update(0.0, false, false, false, One(1, 15.0f)).kind == Kind::None, "a 15 m no empieza");
        CHECK(director.Update(0.1, false, false, false, One(1, 8.0f)).kind == Kind::Start, "a 8 m si");
    }
    {   // quien habla ya tiene su burbuja (no disponible para otra frase) y la frase NO se corta por eso
        StreetVoiceDirector director(5);
        CHECK(director.Update(0.0, false, false, false, One(1, 6.0f)).kind == Kind::Start, "empieza");
        director.Started(0.0);
        const std::vector<StreetVoiceCandidate> withBubble{{1, 6.0f, false}};
        CHECK(director.Update(0.05, false, true, false, withBubble).kind == Kind::SetVolume, "con burbuja sigue sonando");
        CHECK(director.Update(20.0, false, false, false, withBubble).kind == Kind::None, "con burbuja nadie mas lo elige");
    }
    {   // empezar, seguir y cortar
        StreetVoiceDirector director(1);
        CHECK(director.Update(0.0, false, false, false, {}).kind == Kind::None, "sin nadie cerca no pasa nada");
        const auto start = director.Update(0.0, false, false, false, One(7, 3.0f));
        CHECK(start.kind == Kind::Start && start.person == 7 && start.clip < 5 && std::abs(start.volume - 1.0f) < 1e-6f, "alguien a 3 m empieza una frase a todo volumen");
        director.Started(0.0);
        const auto follow = director.Update(0.5, false, true, false, One(7, 11.5f));
        CHECK(follow.kind == Kind::SetVolume && std::abs(follow.volume - 0.25f) < 1e-5f, "mientras suena, el volumen sigue la distancia de quien habla");
        const auto away = director.Update(1.0, false, true, false, One(7, 25.0f));
        CHECK(away.kind == Kind::Stop, "si quien hablaba se aleja de 18 m, se corta");
        CHECK(director.Update(1.5, false, false, false, One(7, 3.0f)).kind == Kind::None, "y la misma persona no vuelve a hablar enseguida (hueco y enfriamiento)");
    }
    {   // una sola a la vez y sin pisar otra voz
        StreetVoiceDirector director(2);
        const auto start = director.Update(0.0, false, false, false, One(1, 4.0f));
        director.Started(0.0);
        CHECK(director.Update(0.2, false, true, false, {{1, 4.0f}, {2, 2.0f}}).kind == Kind::SetVolume, "mientras una suena no empieza otra");
        StreetVoiceDirector blocked(3);
        CHECK(blocked.Update(0.0, false, false, true, One(1, 4.0f)).kind == Kind::None, "con otra voz (robo o conductor) no habla");
        CHECK(blocked.Update(0.1, false, false, false, One(1, 4.0f)).kind == Kind::Start, "y habla en cuanto queda libre");
        (void)start;
    }
    {   // hueco entre frases
        StreetVoiceDirector director(4);
        director.Update(0.0, false, false, false, One(1, 4.0f)); director.Started(0.0);
        director.Update(0.5, false, false, false, {});   // termino de sonar
        CHECK(director.Update(3.0, false, false, false, One(2, 4.0f)).kind == Kind::None, "antes de 6 s no empieza otra frase");
        const auto next = director.Update(14.0, false, false, false, One(2, 4.0f));
        CHECK(next.kind == Kind::Start && next.person == 2, "pasados 13 s puede hablar otra persona");
    }
    {   // enfriamiento por persona: con una sola persona cerca, no vuelve a hablar hasta pasados 25 s
        StreetVoiceDirector director(6);
        director.Update(0.0, false, false, false, One(1, 4.0f)); director.Started(0.0);
        director.Update(0.5, false, false, false, {});
        CHECK(director.Update(15.0, false, false, false, One(1, 4.0f)).kind == Kind::None, "la misma persona sigue en su enfriamiento (ya paso el hueco de 13 s)");
        CHECK(director.Update(26.0, false, false, false, One(1, 4.0f)).kind == Kind::Start, "pasados 25 s vuelve a poder hablar");
    }
    {   // ninguna grabacion se repite antes de 50 s, aunque siempre haya alguien nuevo cerca
        StreetVoiceDirector director(5);
        std::array<double, 5> lastStart{};
        lastStart.fill(-1.0e9);
        double shortest = 1.0e9; int started = 0;
        uint32_t person = 1;
        for (double now = 0.0; now < 3000.0; now += 0.5) {
            const auto action = director.Update(now, false, false, false, One(person, 4.0f));
            if (action.kind != Kind::Start) continue;
            shortest = std::min(shortest, now - lastStart[action.clip]);
            lastStart[action.clip] = now;
            director.Started(now); ++started; ++person;
            director.Update(now + 0.25, false, false, false, {});
        }
        CHECK(started > 100, "con gente nueva cerca habla seguido");
        CHECK(shortest >= 50.0 - 1e-9, "la misma grabacion nunca se repite antes de 50 s");
    }
    {   // entre los 4 mas cercanos, y un sonido que no cargo se reintenta en un segundo
        int farChosen = 0;
        for (uint32_t seed = 1; seed <= 200; ++seed) {
            StreetVoiceDirector director(seed);
            std::vector<StreetVoiceCandidate> crowd;
            for (uint32_t i = 1; i <= 10; ++i) crowd.push_back({i, static_cast<float>(i)});
            const auto action = director.Update(0.0, false, false, false, crowd);
            if (action.kind != Kind::Start || action.person > 4) ++farChosen;
        }
        CHECK(farChosen == 0, "solo habla uno de los cuatro mas cercanos");
        StreetVoiceDirector director(9);
        director.Update(0.0, false, false, false, One(1, 4.0f));
        director.Failed(0.0);
        CHECK(director.Update(0.5, false, false, false, One(1, 4.0f)).kind == Kind::None && director.Update(1.2, false, false, false, One(1, 4.0f)).kind == Kind::Start, "si el sonido no esta listo, reintenta al segundo");
    }
    {   // al pausar se calla
        StreetVoiceDirector director(11);
        director.Update(0.0, false, false, false, One(1, 4.0f)); director.Started(0.0);
        CHECK(director.Update(1.0, true, true, false, One(1, 4.0f)).kind == Kind::Stop, "al pausar se corta la frase");
    }
    if (failures == 0) std::printf("Voces de la calle: todo correcto\n");
    return failures == 0 ? 0 : 1;
}
