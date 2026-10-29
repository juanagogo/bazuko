// Persistencia del inventario y recuperacion de salud: logica de produccion sin ventana ni GPU.
#include "game/PlayerState.hpp"

#include <cmath>
#include <cstdio>

using namespace Bazuko;

static int failures = 0;
#define CHECK(condition, message) do { \
    if (!(condition)) { ++failures; std::printf("FALLO (%d): %s\n", __LINE__, message); } \
} while (0)

int main() {
    std::string error;
    const auto loaded = GameData::LoadFromFile(BAZUKO_GAME_DATA_PATH, &error);
    if (!loaded) {
        std::printf("FALLO: no se cargaron los datos: %s\n", error.c_str());
        return 1;
    }
    const auto& data = *loaded;
    const auto near = [](float a, float b) { return std::fabs(a - b) < 1e-5f; };
    const int scrapIndex = data.ItemIndex("chatarra");
    CHECK(scrapIndex >= 0, "falta chatarra en los datos reales");
    if (scrapIndex < 0) return 1;

    // Un mismo guardado debe conservar todo lo que permite llevar cada combinacion de mejoras.
    for (bool bigSack : {false, true}) {
        for (bool collector : {false, true}) {
            const std::unordered_set<std::string> talents = collector
                ? std::unordered_set<std::string>{"collector2"} : std::unordered_set<std::string>{};
            const int expectedCapacity = 20 + (collector ? 10 : 0) + (bigSack ? 20 : 0);
            CHECK(near(InventoryCapacity(data, talents, bigSack), expectedCapacity), "capacidad con mejoras incorrecta");
            const nlohmann::json state = {
                {"inventory", {{{"item", scrapIndex}, {"quantity", expectedCapacity}}}}
            };
            const auto roundTrip = nlohmann::json::parse(state.dump());
            const auto restored = RestoreInventory(roundTrip.at("inventory"), data, talents, bigSack);
            CHECK(restored.entries.size() == 1, "se perdio una pila valida al cargar");
            if (!restored.entries.empty())
                CHECK(restored.entries.front().quantity == expectedCapacity, "se perdieron unidades al cargar");
            CHECK(near(restored.weight, expectedCapacity), "peso restaurado incorrecto");
        }
    }

    // Reproduccion original: 30 kg caben en el costal grande aunque no haya talentos.
    const auto saved30 = nlohmann::json::array({{{"item", scrapIndex}, {"quantity", 30}}});
    CHECK(RestoreInventory(saved30, data, {}, true).entries.size() == 1, "se perdieron los 30 kg del costal grande");
    CHECK(RestoreInventory(saved30, data, {}, false).entries.empty(), "se acepto sobrecarga sin mejoras");
    const auto invalid = nlohmann::json::array({
        {{"item", data.items.size()}, {"quantity", 1}},
        {{"item", scrapIndex}, {"quantity", 0}},
        {{"item", scrapIndex}, {"quantity", -1}}
    });
    CHECK(RestoreInventory(invalid, data, {}, true).entries.empty(), "se aceptaron entradas invalidas");

    // Un atropello mortal con necesidades altas no revive durante los 1,8 s del ragdoll.
    std::array<float, kNeedCount> needs{100.0f, 100.0f, 94.25f, 0.0f, 100.0f, 100.0f, 80.0f};
    for (int frame = 0; frame < 108; ++frame)
        ApplyHealthRegeneration(needs, 0.0f, 0.0f, 1.0f / 60.0f);
    CHECK(needs[3] == 0.0f, "la regeneracion revivio al personaje muerto");

    needs[3] = 20.0f;
    ApplyHealthRegeneration(needs, 0.0f, 0.0f, 2.0f);
    CHECK(near(needs[3], 21.0f), "un personaje vivo debe regenerar salud");
    ApplyHealthRegeneration(needs, 1.0f, 0.0f, 2.0f);
    ApplyHealthRegeneration(needs, 0.0f, 0.1f, 2.0f);
    CHECK(near(needs[3], 21.0f), "abstinencia o enfermedad deben impedir regeneracion");
    needs[0] = 50.0f;
    ApplyHealthRegeneration(needs, 0.0f, 0.0f, 2.0f);
    CHECK(near(needs[3], 21.0f), "hambre baja debe impedir regeneracion");
    needs[0] = 100.0f;
    needs[3] = 99.9f;
    ApplyHealthRegeneration(needs, 0.0f, 0.0f, 2.0f);
    CHECK(needs[3] == 100.0f, "la salud no debe superar 100");

    std::printf("PlayerState: %s\n", failures == 0 ? "todo OK" : "hay fallos");
    return failures == 0 ? 0 : 1;
}
