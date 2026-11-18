// Tipos de peaton (character/Archetypes.hpp): quien anda por cada zona, que ropa no lleva un cuerpo joven y que postura cabe con las manos ocupadas.
#include "character/Archetypes.hpp"
#include "character/CharacterTypes.hpp"
#include <filesystem>
#include <array>
#include <cstdio>

static int failures = 0;
#define CHECK(c, m) do { if (!(c)) { std::printf("FALLO (%d): %s\n", __LINE__, m); ++failures; } } while (0)

using namespace Bazuko;
using namespace Bazuko::People;

static std::array<int, kArchetypeCount> Census(Zone zone) {
    std::array<int, kArchetypeCount> count{};
    for (int i = 0; i < 1000; ++i) ++count[static_cast<size_t>(PickArchetype(zone, (static_cast<float>(i) + 0.5f) / 1000.0f))];
    return count;
}

int main() {
    // zonas
    const auto cartucho = Census(Zone::Cartucho);
    CHECK(cartucho[static_cast<size_t>(Archetype::Habitante)] > 500, "en El Cartucho la mayoria vive en la calle");
    CHECK(cartucho[static_cast<size_t>(Archetype::Oficinista)] == 0 && cartucho[static_cast<size_t>(Archetype::Estudiante)] == 0, "en El Cartucho no hay oficinistas ni estudiantes");
    const auto chapinero = Census(Zone::Chapinero);
    CHECK(chapinero[static_cast<size_t>(Archetype::Oficinista)] > chapinero[static_cast<size_t>(Archetype::Habitante)] * 4, "Chapinero es de oficinas");
    for (const Zone zone : {Zone::Cartucho, Zone::Parque, Zone::Candelaria, Zone::Chapinero, Zone::Andenes, Zone::Barrio, Zone::Lago}) {
        const auto weights = ZoneWeights(zone);
        float total = 0.0f;
        for (const float w : weights) total += w;
        CHECK(total > 0.95f && total < 1.05f, "los pesos de cada zona suman uno");
    }

    // ropa: ningun cuerpo joven lleva prendas que dejen al aire el torso o las piernas
    for (const char* garment : {"short", "sudadera", "rota"}) {
        CHECK(!GarmentAllowed(garment, true), "un cuerpo joven no lleva esa prenda");
        CHECK(GarmentAllowed(garment, false), "un adulto si puede");
    }
    CHECK(GarmentAllowed("saco", true), "el saco lo lleva cualquiera");

    // cada tipo tiene datos completos
    for (const ArchetypeInfo& info : Table()) {
        CHECK(!info.tones.empty() && !info.phrases.empty() && !info.stops.empty(), "cada tipo tiene colores, frases y paradas");
        CHECK(info.speedMin > 0.5f && info.speedMax >= info.speedMin && info.speedMax < 1.6f, "paso de peaton");
        CHECK(info.pause > 0.0f && info.pause < 1.0f, "probabilidad de quedarse");
    }

    // manos: con una bolsa en la izquierda nada que pida las dos; con el baston, ninguna de manos
    for (int i = 0; i < 200; ++i) {
        const float roll = (static_cast<float>(i) + 0.5f) / 200.0f;
        for (const ArchetypeInfo& info : Table()) {
            CHECK(StanceHands(PickStop(info, 2, roll)) != 2, "con la mano izquierda ocupada, nada que pida las dos manos (la derecha si: el celular)");
            const Stance withCane = PickStop(info, 1, roll);
            CHECK(StanceHands(withCane) == 0, "con el baston, ninguna postura de manos");
            CHECK(StanceHands(PickWalking(info, 3, roll)) == 0, "andando con las dos manos ocupadas, manos libres");
        }
    }
    CHECK(PickStop(Info(Archetype::Reciclador), 0, 0.1f) == Stance::Buscar, "el reciclador se para sobre todo a buscar en el piso");

    // estilos de calle del creador (presets.js): cada uno queda tal cual tras normalizar, con piezas que existen, y el sombrero viaja por la red
    for (size_t i = 0; i < StreetPresets.size(); ++i) {
        CharacterLook look;
        look.nombre = "Prueba"; look.origen = "migrante";
        ApplyStreetPreset(look, StreetPresets[i]);
        CHECK(MatchingStreetPreset(look) == static_cast<int>(i), "el estilo queda tal cual al normalizar");
        CHECK(look.nombre == "Prueba" && look.origen == "migrante", "el estilo no toca nombre ni origen");
        const std::string folder = std::string(PERSONAJE_DIR) + "/" + (look.sexo == "mujer" && look.edad == "adulto" ? std::string("mujer-adulta") : look.sexo + "-" + look.edad) + "/";
        for (const std::string& piece : {look.ropa, look.pelo, look.calzado, look.cabeza, look.sexo == "hombre" ? look.barba : std::string("ninguna")})
            if (piece != "descalzo" && piece != "sin-sombrero" && piece != "ninguna" && piece != "calvo")
                CHECK(std::filesystem::exists(folder + piece + ".gltf"), "cada pieza del estilo existe");
        CharacterLook back;
        CHECK(DecodeLook(EncodeLook(look), back) && back.cabeza == look.cabeza && back.calzado == look.calzado, "el sombrero y el calzado viajan por la red");
    }
    CharacterLook oldLook;
    CHECK(DecodeLook("Jairo|reciclador|hombre|joven|corto|candado|chaqueta|tenis|2|0|0|1", oldLook) && oldLook.cabeza == "sin-sombrero", "un jugador con la version de antes se sigue leyendo");
    for (const char* garment : {"short", "sudadera", "rota"}) {
        CharacterLook young;
        young.sexo = "mujer"; young.edad = "joven"; young.ropa = garment;
        NormalizeLook(young);
        CHECK(!GarmentUncovered(young.ropa), "el creador no deja a un cuerpo joven con el torso o las piernas al aire");
    }
    std::mt19937 rng(7);
    for (int i = 0; i < 500; ++i) { const CharacterLook random = RandomLook(rng); CHECK(random.edad != "joven" || !GarmentUncovered(random.ropa), "el azar tampoco"); }

    if (failures == 0) std::printf("Tipos de peaton: todo bien\n");
    return failures == 0 ? 0 : 1;
}
