// Efectos de consumo: los tiempos del original (subida de 3 s, bajada de 6 s, desvanecido de 1 s en cortes y reemplazos), las recetas por sustancia y lo que hace cada una en calidad baja.
#include "effects/SubstanceEffects.hpp"

#include <cmath>
#include <cstdio>

using namespace Bazuko;

static int failures = 0;
#define CHECK(condition, message) do { if (!(condition)) { ++failures; std::printf("FALLO (%d): %s\n", __LINE__, message); } } while (0)

static void Run(SubstanceEffects& fx, float seconds, double& now) {
    for (float t = 0.0f; t < seconds; t += 1.0f / 60.0f) { fx.Update(1.0f / 60.0f); now += 1.0 / 60.0; }
}

int main() {
    {   // un efecto nuevo: sube 3 s, se sostiene y baja los ultimos 6 s; la pastilla dura 45 s
        SubstanceEffects fx; double now = 0.0;
        CHECK(!fx.Consume("tintico", now).known && !fx.Active(now), "una sustancia sin efecto (tintico) no hace nada");
        CHECK(fx.Consume("pastilla", now).known && fx.Active(now), "la pastilla arranca");
        CHECK(fx.Intensity(now) == 0.0f, "empieza en cero");
        Run(fx, 1.5f, now);
        CHECK(std::abs(fx.Intensity(now) - 0.5f) < 0.02f, "a mitad de la subida va por la mitad");
        Run(fx, 3.0f, now);
        CHECK(fx.Intensity(now) > 0.99f, "arriba despues de la subida");
        Run(fx, 45.0f - 4.5f - 3.0f - 0.0f, now);   // faltan 3 s: a media bajada
        CHECK(std::abs(fx.Intensity(now) - 0.5f) < 0.05f, "a 3 s del final baja por la mitad");
        Run(fx, 4.0f, now);
        CHECK(!fx.Active(now), "termina a los 45 s");
        const auto events = fx.ConsumeSoundEvents();
        CHECK(events.size() == 3 && events[0].kind == SubstanceEffects::SoundEvent::Kind::Onset && events[1].kind == SubstanceEffects::SoundEvent::Kind::StartSustain && events[2].kind == SubstanceEffects::SoundEvent::Kind::StopSustain, "suena el consumo, arranca la capa sostenida y se suelta al terminar");
    }
    {   // repetir la misma sustancia renueva la duracion sin bajar la intensidad
        SubstanceEffects fx; double now = 0.0;
        fx.Consume("hierba", now); Run(fx, 20.0f, now);
        const float before = fx.Intensity(now);
        fx.Consume("hierba", now); Run(fx, 0.1f, now);
        CHECK(fx.Intensity(now) >= before - 0.001f, "la segunda calada no baja la intensidad");
        Run(fx, 55.0f, now);
        CHECK(fx.Active(now), "y la duracion se renovo: a los 75 s de la primera sigue activo");
    }
    {   // cambiar de sustancia: la anterior se desvanece en 1 s de tiempo real y entonces arranca la nueva
        SubstanceEffects fx; double now = 0.0;
        fx.Consume("pegante", now); Run(fx, 10.0f, now);
        fx.Consume("basuco", now);
        CHECK(fx.CurrentId(now) == "pegante", "mientras se desvanece sigue siendo el pegante");
        const float start = fx.Intensity(now);
        now += 0.5;
        CHECK(std::abs(fx.Intensity(now) - start * 0.5f) < 0.02f, "a medio segundo va por la mitad");
        now += 0.6;
        CHECK(fx.CurrentId(now) == "basuco", "a los 1,1 s entra el basuco");
    }
    {   // corte forzado: se desvanece en 1 s, nunca de golpe
        SubstanceEffects fx; double now = 0.0;
        fx.Consume("pastilla", now); Run(fx, 10.0f, now);
        fx.End(now);
        CHECK(fx.Active(now) && fx.Intensity(now) > 0.9f, "al cortar no baja de golpe");
        now += 1.1;
        CHECK(!fx.Active(now), "y a 1 s ya no hay efecto");
    }
    {   // paranoia del basuco, y recetas
        SubstanceEffects fx; double now = 0.0;
        const auto basuco = fx.Consume("basuco", now);
        CHECK(basuco.known && basuco.paranoiaSeconds == 50.0f && std::abs(basuco.paranoiaSeverity - 0.8f) < 1e-6f, "el basuco da paranoia de 50 s con severidad 0,8");
        SubstanceEffects other; CHECK(other.Consume("pastilla", now).paranoiaSeconds == 0.0f, "la pastilla no da paranoia");
        Run(fx, 10.0f, now);
        const auto frame = fx.BeforeRender(now, false);
        CHECK(frame.look.active && frame.look.overlay == 4 && frame.look.trail && frame.look.contrast > 1.0f && frame.look.saturate < 1.0f, "basuco: contraste, menos saturacion, tunel y estela");
        const auto low = fx.BeforeRender(now, true);
        CHECK(!low.look.trail && low.look.trailOpacity == 0.0f && low.look.blurPx == 0.0f, "en calidad baja no hay estela ni desenfoque");
        SubstanceEffects glue; double t2 = 0.0; glue.Consume("pegante", t2); Run(glue, 10.0f, t2);
        const auto g = glue.BeforeRender(t2, false);
        CHECK(g.look.blurPx > 1.5f && g.look.overlay == 2 && g.look.sepia > 0.3f, "pegante: borroso, verdoso y bordes oscuros");
        CHECK(glue.BeforeRender(t2, true).look.blurPx == 0.0f, "el desenfoque se omite en calidad baja");
        CHECK(std::abs(g.cameraFovDegrees) <= 6.0f + 1e-4f && std::abs(g.cameraRollRadians) <= 0.07f + 1e-4f, "la camara no se mueve mas de lo de la receta");
    }
    {   // movimiento reducido: la camara y la estela al 20 %
        SubstanceEffects calm(0.2f), normal(1.0f); double a = 0.0, b = 0.0;
        calm.Consume("pegante", a); normal.Consume("pegante", b);
        Run(calm, 12.0f, a); Run(normal, 12.0f, b);
        const auto fc = calm.BeforeRender(a, false), fn = normal.BeforeRender(b, false);
        CHECK(fc.look.trailOpacity < fn.look.trailOpacity * 0.25f && std::abs(fc.cameraFovDegrees) <= std::abs(fn.cameraFovDegrees) + 1e-5f, "con movimiento reducido baja la estela");
    }
    if (failures == 0) std::printf("Efectos de consumo: todo correcto\n");
    return failures == 0 ? 0 : 1;
}
