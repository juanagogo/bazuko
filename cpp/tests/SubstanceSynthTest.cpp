// Sonidos de las sustancias: la sintesis del original (osciladores, ruido, filtros y envolventes) produce sonidos finitos, acotados y con lo que se espera de cada uno.
#include "audio/SubstanceSynth.hpp"

#include <cmath>
#include <cstdio>

using namespace Bazuko;

static int failures = 0;
#define CHECK(condition, message) do { if (!(condition)) { ++failures; std::printf("FALLO (%d): %s\n", __LINE__, message); } } while (0)

static constexpr float kRate = 44100.0f;

static float Peak(const std::vector<float>& v, size_t from, size_t to) { float p = 0.0f; for (size_t i = from; i < to && i < v.size(); ++i) p = std::max(p, std::abs(v[i])); return p; }
static bool Finite(const std::vector<float>& v) { for (float x : v) if (!std::isfinite(x)) return false; return true; }
static float Goertzel(const std::vector<float>& v, float hz) {   // energia a una frecuencia
    const float w = 6.2831853f * hz / kRate, c = 2.0f * std::cos(w);
    float s1 = 0.0f, s2 = 0.0f;
    for (float x : v) { const float s = x + c * s1 - s2; s2 = s1; s1 = s; }
    return (s1 * s1 + s2 * s2 - c * s1 * s2) / static_cast<float>(v.size() * v.size());
}
static size_t PeakAt(const std::vector<float>& v, size_t window) {   // en que ventana esta el pico de energia
    size_t best = 0; float bestEnergy = -1.0f;
    for (size_t at = 0; at + window <= v.size(); at += window) { float e = 0.0f; for (size_t i = at; i < at + window; ++i) e += v[i] * v[i]; if (e > bestEnergy) { bestEnergy = e; best = at; } }
    return best;
}

int main() {
    CHECK(SubstanceHasSound("pastilla") && SubstanceHasSound("pegante") && SubstanceHasSound("hierba") && SubstanceHasSound("basuco") && !SubstanceHasSound("tintico"), "cuatro sustancias suenan");
    CHECK(std::abs(SubstanceMuffleHz(0.0f) - 20000.0f) < 1.0f && std::abs(SubstanceMuffleHz(1.0f) - 700.0f) < 1.0f && SubstanceMuffleHz(0.5f) < 4000.0f && SubstanceMuffleHz(0.5f) > 3500.0f, "el filtro de agudos va de 20 000 Hz a 700 Hz con la intensidad");
    CHECK(RenderSubstanceOnset("tintico", kRate, 1).empty(), "lo que no suena no genera nada");

    for (const char* id : {"pastilla", "pegante", "hierba", "basuco"}) {
        const auto a = RenderSubstanceOnset(id, kRate, 7), b = RenderSubstanceOnset(id, kRate, 7);
        CHECK(a.size() == static_cast<size_t>(kRate * kSubstanceOnsetLength) && Finite(a), "el sonido de consumir dura 2,5 s y es finito");
        CHECK(a == b, "con la misma semilla es igual");
        const float peak = Peak(a, 0, a.size());
        CHECK(peak > 0.03f && peak < 1.0f, "tiene volumen y no recorta");
        CHECK(Peak(a, a.size() - static_cast<size_t>(kRate * 0.05f), a.size()) < 0.01f, "termina en silencio");
    }
    {   // el trago de la pastilla es lo primero; el brillo sube despues
        const auto p = RenderSubstanceOnset("pastilla", kRate, 3);
        CHECK(Goertzel(std::vector<float>(p.begin(), p.begin() + static_cast<long>(kRate * 0.15f)), 80.0f) > Goertzel(std::vector<float>(p.begin() + static_cast<long>(kRate * 1.0f), p.begin() + static_cast<long>(kRate * 1.15f)), 80.0f), "el trago grave esta al principio");
    }
    {   // la inhalacion del pegante tarda 0,9 s en llegar a su pico; la de la hierba, mas de un segundo
        const auto g = RenderSubstanceOnset("pegante", kRate, 3);
        const size_t at = PeakAt(g, static_cast<size_t>(kRate * 0.1f));
        CHECK(at > kRate * 0.6f && at < kRate * 1.5f, "el pico de la inhalacion del pegante llega cerca del segundo");
        const auto h = RenderSubstanceOnset("hierba", kRate, 3);
        const size_t skip = static_cast<size_t>(kRate * 0.35f);   // pasados los chispazos del encendedor
        const size_t hat = skip + PeakAt(std::vector<float>(h.begin() + static_cast<long>(skip), h.end()), static_cast<size_t>(kRate * 0.1f));
        CHECK(hat > kRate * 1.0f && hat < kRate * 2.2f, "la inhalacion larga de la hierba pica entre 1 y 2 s");
        const auto b = RenderSubstanceOnset("basuco", kRate, 3);
        CHECK(Peak(b, 0, static_cast<size_t>(kRate * 0.3f)) > 0.05f, "el basuco abre con chispazos");
    }
    {   // capas sostenidas: finitas, acotadas, y con su tono caracteristico
        for (const char* id : {"pastilla", "pegante", "hierba", "basuco"}) {
            SubstanceSustain sustain(id, kRate, 5);
            CHECK(sustain.Valid(), "la capa existe");
            std::vector<float> buffer(static_cast<size_t>(kRate * 2.0f));
            for (size_t at = 0; at < buffer.size(); at += 512) sustain.Render(buffer.data() + at, std::min<size_t>(512, buffer.size() - at));
            CHECK(Finite(buffer) && Peak(buffer, 0, buffer.size()) > 0.005f && Peak(buffer, 0, buffer.size()) < 0.5f, "es finita, se oye y es suave");
            if (std::string(id) == "pegante") {
                CHECK(Goertzel(buffer, 6200.0f) > 20.0f * Goertzel(buffer, 5000.0f) && sustain.WantsMuffle(), "el pegante lleva el pitido de oidos de 6200 Hz y cierra los agudos");
            } else if (std::string(id) == "basuco") {
                CHECK(Goertzel(buffer, 7400.0f) > 20.0f * Goertzel(buffer, 6000.0f) && !sustain.WantsMuffle(), "el basuco lleva el pitido de 7400 Hz");
            } else CHECK(!sustain.WantsMuffle(), "solo el pegante apaga los agudos");
        }
        CHECK(!SubstanceSustain("tintico", kRate, 1).Valid(), "lo que no suena no tiene capa");
    }
    if (failures == 0) std::printf("Sonidos de las sustancias: todo correcto\n");
    return failures == 0 ? 0 : 1;
}
