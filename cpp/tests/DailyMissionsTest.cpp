// Misiones diarias (game/DailyMissions.hpp): tres distintas por dia, deterministas, con avance por tipo, recompensa al cumplir y guardado.
#include "game/DailyMissions.hpp"
#include <cstdio>
#include <set>

static int failures = 0;
#define CHECK(c, m) do { if (!(c)) { std::printf("FALLO (%d): %s\n", __LINE__, m); ++failures; } } while (0)

using namespace Bazuko::Missions;

int main() {
    for (int day = 1; day <= 40; ++day) {
        const std::vector<Mission> missions = DailyMissions::Generate(day);
        CHECK(missions.size() == 3, "cada dia hay tres misiones");
        std::set<std::string> types;
        for (const Mission& mission : missions) types.insert(mission.type);
        CHECK(types.size() == 3, "las tres misiones del dia son de tipos distintos");
        CHECK(DailyMissions::Generate(day).front().id == missions.front().id, "la eleccion del dia es determinista");
    }
    CHECK(DailyMissions::Generate(1).front().id != DailyMissions::Generate(2).front().id, "dias distintos rotan las misiones");

    DailyMissions daily;
    daily.Init(1);
    const std::string type = daily.Missions().front().type;
    const int target = daily.Missions().front().target;
    CHECK(daily.Report("no_existe").empty(), "un tipo que no es de hoy no avanza nada");
    int done = 0;
    for (int step = 0; step < target + 2; ++step) done += static_cast<int>(daily.Report(type, 1).size());
    CHECK(done == 1, "la mision se cumple una sola vez aunque se siga reportando");
    CHECK(daily.Missions().front().completed && daily.Missions().front().progress == target, "el progreso se detiene en la meta");

    DailyMissions restored;
    restored.Deserialize(daily.Serialize());
    CHECK(restored.Missions().size() == 3 && restored.Missions().front().completed, "el guardado conserva el avance");
    CHECK(restored.Day() == daily.Day(), "el guardado conserva el dia");

    CHECK(!daily.Update(1), "el mismo dia no renueva las misiones");
    CHECK(daily.Update(2) && !daily.Missions().front().completed, "un dia nuevo renueva las misiones");
    CHECK(daily.ActiveText().rfind("MISIÓN: ", 0) == 0, "el texto del HUD empieza por MISIÓN");

    DailyMissions all;
    all.Init(3);
    for (const Mission& mission : std::vector<Mission>(all.Missions())) all.Report(mission.type, mission.target);
    CHECK(all.ActiveText() == "MISIONES DEL DÍA COMPLETADAS", "con todas cumplidas el HUD lo dice");

    if (failures == 0) std::printf("Misiones diarias: todo correcto\n");
    return failures == 0 ? 0 : 1;
}
