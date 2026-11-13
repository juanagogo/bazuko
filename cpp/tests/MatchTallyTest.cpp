// Lo que el anfitrion cuenta de cada jugador para la clasificacion: tiempo dentro, dias, plata ganada (no gastada), peleas ganadas y caidas.
#include "online/Match.hpp"
#include "online/Social.hpp"

#include <cstdio>
#include <string>

using namespace Bazuko::Online;

static int failures = 0;
#define CHECK(cond, msg) do { if (!(cond)) { std::printf("FALLO: %s\n", msg); ++failures; } } while (0)

static const MatchResult* Find(const std::vector<MatchResult>& list, const std::string& name) {
    for (const auto& r : list) if (r.name == name) return &r;
    return nullptr;
}

int main() {
    MatchTally tally;
    double now = 0.0;
    const auto frame = [&](std::vector<MatchTally::Seen> seen) { tally.Observe(now, seen); now += 0.5; };

    // 120 cuadros de medio segundo con los dos dentro: 60 s cada uno (el primero no suma)
    for (int i = 0; i < 121; ++i) frame({{"Anfi", false, true, 1000.0}, {"Beto", false, true, 500.0}});
    // Anfi gana 300 y gasta 100; a Beto el anfitrion le devuelve su perfil (salto enorme): eso no es ganancia
    frame({{"Anfi", false, true, 1300.0}, {"Beto", false, true, 900000.0}});
    frame({{"Anfi", false, true, 1200.0}, {"Beto", false, true, 900050.0}});
    // Anfi golpea a Beto y Beto cae: pelea ganada para Anfi, caida para Beto
    tally.Hit("Anfi", "Beto", now);
    frame({{"Anfi", false, true, 1200.0}, {"Beto", true, true, 900050.0}});
    // Beto se levanta y vuelve a caer sin golpe reciente: caida, pero nadie gana la pelea
    frame({{"Anfi", false, true, 1200.0}, {"Beto", false, true, 900050.0}});
    now += 10.0;
    frame({{"Anfi", false, true, 1200.0}, {"Beto", true, true, 900050.0}});
    tally.NewDay();
    // Beto sale; el dia siguiente solo es de Anfi
    frame({{"Anfi", false, true, 1200.0}});
    tally.NewDay();

    const auto first = tally.Take();
    const MatchResult* anfi = Find(first, "Anfi");
    const MatchResult* beto = Find(first, "Beto");
    CHECK(anfi && beto, "salen los dos");
    if (anfi && beto) {
        CHECK(anfi->seconds >= 61 && anfi->seconds <= 64, "el tiempo es el de los cuadros, y un cuadro largo no regala tiempo");
        CHECK(anfi->money == 300, "solo cuenta la plata ganada, no la gastada");
        CHECK(beto->money == 50, "el salto por perfil devuelto no cuenta");
        CHECK(anfi->fights == 1 && beto->fights == 0, "pelea ganada solo con golpe reciente");
        CHECK(beto->deaths == 2 && anfi->deaths == 0, "cada caida cuenta");
        CHECK(anfi->days == 2 && beto->days == 1, "los dias son de quien esta en la sala");
    }
    const auto again = tally.Take();
    CHECK(again.empty(), "lo ya entregado no se vuelve a mandar");

    // Al juntar informes pendientes se suma por nombre, sin mayusculas
    std::vector<MatchResult> pending{{"Anfi", 1, 100, 0, 0, 60}};
    MergeResults(pending, {{"anfi", 0, 50, 1, 0, 30}, {"Caro", 0, 0, 0, 1, 10}});
    CHECK(pending.size() == 2 && pending[0].money == 150 && pending[0].seconds == 90 && pending[0].fights == 1, "se suman los informes que no salieron");
    CHECK(MatchResultJson({{"Anfi", 1, 2, 3, 4, 5}}) == R"({"jugadores":[{"dias":1,"muertes":4,"nombre":"Anfi","peleas":3,"plata":2,"tiempo":5}]})", "el cuerpo del informe");

    if (failures == 0) std::printf("Partida: todo correcto\n");
    return failures == 0 ? 0 : 1;
}
