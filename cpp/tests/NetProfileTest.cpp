// Perfiles de jugador del servidor: claves seguras (nada de rutas fuera de la carpeta), sobre con version, guardado atomico,
// archivos corruptos y reparacion de guardados manipulados. Logica pura: sin ventana, GPU ni red.
#include "net/ProfileStore.hpp"

#include <cmath>
#include <cstdio>
#include <fstream>

using namespace Bazuko;
using namespace Bazuko::Net;
using nlohmann::json;

static int failures = 0;
#define CHECK(condition, message) do { \
    if (!(condition)) { ++failures; std::printf("FALLO (%d): %s\n", __LINE__, message); } \
} while (0)

int main() {
    std::string error;
    const auto loaded = GameData::LoadFromFile(BAZUKO_GAME_DATA_PATH, &error);
    if (!loaded) { std::printf("FALLO: no se cargaron los datos: %s\n", error.c_str()); return 1; }
    const GameData& data = *loaded;

    // claves
    const std::string key = NewPlayerKey();
    CHECK(IsValidPlayerKey(key), "la clave generada es valida");
    CHECK(NewPlayerKey() != key, "dos claves generadas son distintas");
    for (const char* bad : {"", "abc", "../../etc/passwd", "..\\..\\x", "0123456789abcdef0123456789abcdeg", "0123456789ABCDEF0123456789ABCDEF",
                            "0123456789abcdef0123456789abcde/", "0123456789abcdef0123456789abcdef0"})
        CHECK(!IsValidPlayerKey(bad), "una clave no valida o con ruta se rechaza");

    // un guardado como el real del juego
    json save = {
        {"money", 112166.4}, {"playerX", 112.98}, {"playerZ", 97.84}, {"level", 4}, {"xp", 160}, {"talentPoints", 3}, {"day", 1}, {"dayProgress", 0.5},
        {"needs", json::array({92.1, 88.3, 53.0, 100.0, 70.0, 60.0, 80.0})},
        {"inventory", json::array({{{"item", 0}, {"quantity", 6}}, {{"item", 1}, {"quantity", 1}}})},
        {"character", {{"nombre", "Jairo"}, {"origen", "reciclador"}}}};
    json clean = save;
    CHECK(Sanitize(clean, data).empty() && clean == save, "un guardado limpio no se toca");

    // reparaciones
    json hacked = save;
    hacked["money"] = -50.0; hacked["playerX"] = 99999.0; hacked["playerZ"] = -9999.0; hacked["level"] = 5000; hacked["dayProgress"] = 7.0;
    hacked["needs"] = json::array({500.0, -3.0, "mucha"});
    hacked["inventory"] = json::array({{{"item", 0}, {"quantity", 6}}, {{"item", 99999}, {"quantity", 3}}, {{"item", -1}, {"quantity", 3}},
                                       {{"item", 1}, {"quantity", -4}}, {{"item", 1}, {"quantity", 100000}}, "basura", {{"item", "x"}}});
    hacked["character"]["nombre"] = std::string("Jai\x01ro") + std::string(60, 'x');
    const auto fixes = Sanitize(hacked, data);
    CHECK(!fixes.empty(), "se informan las correcciones");
    CHECK(hacked["money"] == 0.0, "dinero negativo pasa a 0");
    CHECK(hacked["playerX"] == 400.0 && hacked["playerZ"] == -74.0, "la posicion se recorta al mapa");
    CHECK(hacked["level"] == 100.0 && hacked["dayProgress"] == 1.0, "nivel y hora se limitan");
    CHECK(hacked["needs"][0] == 100.0 && hacked["needs"][1] == 0.0 && hacked["needs"][2] == 50.0, "necesidades entre 0 y 100 y numericas");
    CHECK(hacked["inventory"].size() == 2, "solo quedan las pilas validas (la de 100000 se limita)");
    CHECK(hacked["inventory"][1]["quantity"] == 999, "la cantidad se limita a 999");
    const std::string name = hacked["character"]["nombre"];
    CHECK(name.size() <= 24 && name.find('\x01') == std::string::npos, "el nombre queda sin controles y con maximo 24 caracteres");
    json notObject = json::array(); Sanitize(notObject, data);
    CHECK(notObject.is_object(), "un guardado que no es objeto se reemplaza por uno vacio");
    json weird = {{"money", "mucho"}, {"playerX", nullptr}}; Sanitize(weird, data);
    CHECK(weird["money"] == 0.0 && weird["playerX"] == 112.98, "valores no numericos se reemplazan");

    // sobre y almacen
    CHECK(UnwrapProfile(WrapSave(save, key), key) == save, "envolver y desenvolver conserva el guardado");
    CHECK(!UnwrapProfile(WrapSave(save, key), NewPlayerKey()), "un perfil de otra clave se rechaza");
    CHECK(!UnwrapProfile(json{{"formato", 99}, {"jugador", key}, {"guardado", json::object()}}, key), "otra version del formato se rechaza");

    const std::filesystem::path root = std::filesystem::temp_directory_path() / ("bazuko_perfiles_" + key);
    {
        ProfileStore store(root);
        CHECK(!store.Exists(key) && !store.Load(key), "no existe antes de guardar");
        CHECK(store.Save(key, save) && store.Exists(key), "guarda");
        CHECK(store.Load(key) == save, "carga lo mismo que guardo");
        json second = save; second["money"] = 5.0;
        CHECK(store.Save(key, second) && store.Load(key)->at("money") == 5.0, "sobrescribe el perfil existente");
        CHECK(!std::filesystem::exists(root / (key + ".json.tmp")), "no deja archivos temporales");
        CHECK(!store.Save("../fuera", save) && !store.Load("../fuera") && !store.Exists("../fuera"), "una clave con ruta nunca toca el disco");
        CHECK(!std::filesystem::exists(root.parent_path() / "fuera.json"), "no se escribio fuera de la carpeta");
        { std::ofstream corrupt(root / (key + ".json")); corrupt << "{ esto no es json"; }
        CHECK(!store.Load(key), "un archivo corrupto se trata como inexistente (no cae)");
        { std::ofstream wrong(root / (key + ".json")); wrong << json{{"formato", 1}, {"jugador", NewPlayerKey()}, {"guardado", json::object()}}.dump(); }
        CHECK(!store.Load(key), "un perfil copiado de otro jugador se rechaza");
    }
    std::error_code ec;
    std::filesystem::remove_all(root, ec);

    if (failures == 0) std::printf("Perfiles de jugador: todo correcto\n");
    return failures == 0 ? 0 : 1;
}
