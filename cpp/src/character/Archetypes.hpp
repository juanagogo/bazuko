#pragma once
// La gente de Bogota (original: character/archetypes.js): cada tipo dice como se viste, como anda, que carga y que hace cuando se para;
// cada zona de la ciudad dice cuantos hay de cada uno. Son solo datos y cuentas, sin dibujo: Simulation arma los trajes con ellos y decide
// quien es cada peaton al nacer. Nada lleva marcas, y ningun cuerpo joven lleva prendas que dejen al aire el torso o las piernas.
#include "../world/Zones.hpp"

#include <glm/glm.hpp>

#include <array>
#include <cstdint>
#include <string>
#include <vector>

namespace Bazuko::People {

enum class Archetype : uint8_t { Oficinista, Estudiante, Senora, Abuelo, Obrero, Vendedor, Reciclador, Habitante, Count };
constexpr size_t kArchetypeCount = static_cast<size_t>(Archetype::Count);

// Lo que hace parado o andando. Las que van con clip propio: Buscar (arrodillarse a mirar el piso), Hablar y Acurrucado.
enum class Stance : uint8_t { None, Celular, Telefono, BrazosCruzados, ManosAtras, Bolsillos, MirarIzquierda, MirarDerecha, CambiarPeso,
                              Frotarse, Encogido, Barriga, Buscar, Hablar, Acurrucado, Count };
constexpr size_t kStanceCount = static_cast<size_t>(Stance::Count);

// Manos que pide cada postura: quien lleva algo en una mano no la usa (el objeto se iria con ella). 0 ninguna, 1 derecha, 2 ambas.
inline int StanceHands(Stance stance) {
    switch (stance) {
        case Stance::Celular: case Stance::Telefono: return 1;
        case Stance::BrazosCruzados: case Stance::ManosAtras: case Stance::Bolsillos: case Stance::Frotarse: case Stance::Encogido:
        case Stance::Barriga: case Stance::Buscar: case Stance::Hablar: case Stance::Acurrucado: return 2;
        default: return 0;
    }
}

// Prendas que dejan al aire el torso o las piernas (UNCOVERED_GARMENTS del original): ningun cuerpo joven las lleva. No se negocia.
inline bool GarmentAllowed(const std::string& garment, bool young) {
    return !young || (garment != "short" && garment != "sudadera" && garment != "rota");
}

struct Weighted { Stance stance; float weight; };

struct ArchetypeInfo {
    const char* id;
    float woman;                              // probabilidad de que sea mujer
    std::array<float, 3> age;                 // pesos joven, adulto, mayor
    std::vector<std::string> clothesMan, clothesWoman;
    std::vector<std::string> shoes;
    std::vector<std::string> hair;
    std::vector<std::string> beards;          // vacio: sin barba
    float beardChance;
    std::vector<std::string> hats;
    float hatChance;
    bool worn;                                // ropa gastada (vive o rebusca en la calle)
    std::vector<glm::vec3> tones;             // colores de la ropa (de arriba)
    float speedMin, speedMax;                 // m/s (las mujeres andan un 12 % menos)
    float umbrella;                           // probabilidad de sacar el paraguas si llueve
    float pause;                              // probabilidad de quedarse un rato al terminar un recorrido
    std::vector<Weighted> stops;              // lo que hace cuando se queda
    std::vector<Weighted> walking;            // probabilidad de andar con cada postura (el resto, manos libres)
    std::vector<std::string> phrases;
};

inline glm::vec3 Hex(uint32_t rgb) { return {((rgb >> 16) & 255) / 255.0f, ((rgb >> 8) & 255) / 255.0f, (rgb & 255) / 255.0f}; }

inline const std::array<ArchetypeInfo, kArchetypeCount>& Table() {
    using S = Stance;
    static const std::array<ArchetypeInfo, kArchetypeCount> table{{
        {"oficinista", 0.46f, {0.35f, 0.58f, 0.07f}, {"camisa", "camisa", "rayas", "chaqueta", "saco"}, {"blusa", "blusa", "saco"}, {"zapatos"},
         {"corto", "corto", "rapado", "cola", "melena", "largo"}, {"candado", "bigote"}, 0.34f, {}, 0.0f, false,
         {Hex(0xdfe3e6), Hex(0xb9cbdc), Hex(0x8f9aa5), Hex(0xd8cfc0), Hex(0x5e6b7a), Hex(0x7a3b3f), Hex(0x46525e)},
         1.30f, 1.50f, 0.75f, 0.42f,
         {{S::Telefono, 3}, {S::Celular, 3}, {S::BrazosCruzados, 1}, {S::ManosAtras, 1}, {S::MirarIzquierda, 1}, {S::MirarDerecha, 1}, {S::CambiarPeso, 1}},
         {{S::Telefono, 0.10f}, {S::Celular, 0.12f}, {S::Bolsillos, 0.06f}},
         {"Permiso, que voy tarde.", "Sí, ya casi llego a la oficina.", "Buenas, ¿me regala la hora?"}},
        {"estudiante", 0.5f, {0.65f, 0.35f, 0.0f}, {"camiseta", "camiseta", "buzo", "rayas"}, {"blusa", "blusa", "saco", "saco"}, {"tenis"},
         {"corto", "rapado", "desordenado", "crespo", "cola", "largo", "melena"}, {"candado", "bigote"}, 0.2f, {"gorro-lana"}, 0.1f, false,
         {Hex(0x2f5f8a), Hex(0x8a3a3a), Hex(0x3f6e52), Hex(0xb7a453), Hex(0x44474f), Hex(0xd5d3cc), Hex(0x6a4c7d), Hex(0x8f2f4a)},
         1.02f, 1.22f, 0.35f, 0.5f,
         {{S::Celular, 5}, {S::Bolsillos, 2}, {S::CambiarPeso, 2}, {S::MirarIzquierda, 1}, {S::MirarDerecha, 1}, {S::Telefono, 1}},
         {{S::Celular, 0.2f}, {S::Bolsillos, 0.14f}, {S::Telefono, 0.05f}},
         {"Qué pereza ese parcial.", "¿Tiene hora? Voy tarde pa' clase.", "Parce, ¿por dónde coge el bus?"}},
        {"senora", 1.0f, {0.0f, 0.55f, 0.45f}, {"saco"}, {"saco", "saco", "blusa"}, {"zapatos", "zapatos", "tenis"},
         {"melena", "melena", "corto", "cola", "largo"}, {}, 0.0f, {}, 0.0f, false,
         {Hex(0x7c4a57), Hex(0x5a6e7a), Hex(0x76516e), Hex(0x4e6a58)},
         1.02f, 1.18f, 0.8f, 0.55f,
         {{S::MirarIzquierda, 2}, {S::MirarDerecha, 2}, {S::CambiarPeso, 2}, {S::Telefono, 1}, {S::BrazosCruzados, 1}, {S::ManosAtras, 1}},
         {{S::Telefono, 0.05f}},
         {"Ay mijo, cuidado con esa bolsa.", "Esto está carísimo, Dios mío.", "Con permiso, mi niño."}},
        {"abuelo", 0.3f, {0.0f, 0.0f, 1.0f}, {"saco", "saco", "chaqueta", "camisa"}, {"saco", "blusa"}, {"zapatos"},
         {"corto", "corto", "rapado", "melena", "cola"}, {"bigote", "bigote", "candado", "descuidada"}, 0.5f, {"boina", "boina", "gorro-lana"}, 0.45f, false,
         {Hex(0x6a5d4d), Hex(0x55585c), Hex(0x4f5a4a), Hex(0x3c3f45), Hex(0x7a6a55)},
         0.66f, 0.80f, 0.35f, 0.68f,
         {{S::MirarIzquierda, 3}, {S::MirarDerecha, 3}, {S::CambiarPeso, 1}, {S::ManosAtras, 4}, {S::BrazosCruzados, 1}},
         {{S::ManosAtras, 0.5f}},
         {"En mis tiempos esto era distinto, mijo.", "Dios lo bendiga, joven.", "¿Ya almorzó, mijito?"}},
        {"obrero", 0.05f, {0.35f, 0.6f, 0.05f}, {"overol", "overol", "camiseta", "chaqueta", "buzo"}, {"saco"}, {"botas", "botas", "botas", "tenis"},
         {"corto", "rapado", "rapado", "cola"}, {"bigote", "candado", "descuidada"}, 0.55f, {}, 0.0f, false,
         {Hex(0xb5632f), Hex(0x2f4d75), Hex(0x4a5a3f), Hex(0x77736a), Hex(0x86622f)},
         1.22f, 1.42f, 0.05f, 0.48f,
         {{S::BrazosCruzados, 4}, {S::Bolsillos, 2}, {S::Celular, 2}, {S::MirarIzquierda, 1}, {S::MirarDerecha, 1}},
         {{S::Bolsillos, 0.08f}, {S::Celular, 0.06f}},
         {"Qué hubo, maestro.", "Pilas que ahí van a descargar material.", "Toca volver a la obra."}},
        {"vendedor", 0.42f, {0.25f, 0.55f, 0.2f}, {"saco", "buzo", "camisa", "chaqueta"}, {"blusa", "saco"}, {"tenis", "tenis", "zapatos", "botas"},
         {"corto", "rapado", "desordenado", "cola", "melena"}, {"bigote", "descuidada", "candado"}, 0.5f, {"gorro-lana", "boina"}, 0.45f, false,
         {Hex(0x5b6a78), Hex(0x4f6658), Hex(0x8c7a55), Hex(0x684f5c), Hex(0x3f4852)},
         0.98f, 1.16f, 0.5f, 0.6f,
         {{S::BrazosCruzados, 4}, {S::Celular, 2}, {S::MirarIzquierda, 2}, {S::MirarDerecha, 2}, {S::CambiarPeso, 1}, {S::Hablar, 1}},
         {{S::Celular, 0.05f}},
         {"Lleve, lleve, a la orden.", "A la orden el tintico, veci.", "¿Qué le vamos a llevar hoy?", "Barato, barato, mi rey."}},
        {"reciclador", 0.22f, {0.1f, 0.62f, 0.28f}, {"rota", "overol", "buzo", "saco", "camiseta"}, {"rota", "saco"}, {"tenis-rotos", "tenis-rotos", "botas"},
         {"desordenado", "corto", "rapado", "crespo", "cola", "largo"}, {"descuidada", "descuidada", "bigote", "larga"}, 0.75f, {"gorro-lana", "boina"}, 0.45f, true,
         {Hex(0x6b6552), Hex(0x5a5a52), Hex(0x7a6248), Hex(0x4b5a5a), Hex(0x65594d)},
         0.78f, 0.94f, 0.0f, 0.78f,
         {{S::Buscar, 6}, {S::Barriga, 1}, {S::CambiarPeso, 1}, {S::MirarIzquierda, 1}, {S::MirarDerecha, 1}},
         {},
         {"¿Tiene cartón o botellas que no le sirvan?", "Aquí trabajando, patrón.", "Con permiso, que voy cargado."}},
        {"habitante", 0.18f, {0.18f, 0.6f, 0.22f}, {"rota", "rota", "saco", "chaqueta", "buzo", "overol"}, {"rota", "saco"}, {"tenis-rotos", "tenis-rotos", "botas"},
         {"desordenado", "desordenado", "largo", "crespo", "rapado", "cola"}, {"descuidada", "larga", "descuidada"}, 0.85f, {"gorro-lana"}, 0.28f, true,
         {Hex(0x4f4a42), Hex(0x5c5446), Hex(0x3e3e3c), Hex(0x6a5c4a), Hex(0x47504a)},
         0.72f, 0.90f, 0.0f, 0.8f,
         {{S::Encogido, 2}, {S::Frotarse, 2}, {S::Barriga, 2}, {S::Acurrucado, 4}, {S::Buscar, 2}, {S::BrazosCruzados, 2}},
         {{S::Encogido, 0.25f}, {S::Bolsillos, 0.1f}},
         {"¿Tiene una monedita que le sobre?", "Regáleme pa'l pan, mi rey.", "Dios se lo pague, vecino."}},
    }};
    return table;
}

inline const ArchetypeInfo& Info(Archetype archetype) { return Table()[static_cast<size_t>(archetype)]; }

// Cuantos de cada uno en cada zona (ZONE_WEIGHTS del original). Orden: oficinista, estudiante, senora, abuelo, obrero, vendedor, reciclador, habitante.
inline std::array<float, kArchetypeCount> ZoneWeights(Zone zone) {
    switch (zone) {
        case Zone::Cartucho:   return {0.0f, 0.0f, 0.03f, 0.04f, 0.05f, 0.08f, 0.25f, 0.55f};
        case Zone::Barrio:     return {0.12f, 0.15f, 0.2f, 0.12f, 0.14f, 0.07f, 0.09f, 0.11f};
        case Zone::Candelaria: return {0.15f, 0.3f, 0.15f, 0.12f, 0.06f, 0.1f, 0.05f, 0.07f};
        case Zone::Chapinero:  return {0.3f, 0.22f, 0.18f, 0.08f, 0.08f, 0.05f, 0.04f, 0.05f};
        case Zone::Parque: case Zone::Lago: return {0.1f, 0.2f, 0.2f, 0.2f, 0.0f, 0.1f, 0.05f, 0.15f};
        case Zone::Andenes: default: return {0.18f, 0.14f, 0.16f, 0.08f, 0.14f, 0.1f, 0.08f, 0.12f};
    }
}

// `roll` en [0, 1)
inline Archetype PickArchetype(Zone zone, float roll) {
    const auto weights = ZoneWeights(zone);
    float total = 0.0f;
    for (const float w : weights) total += w;
    float pick = roll * total;
    for (size_t i = 0; i < weights.size(); ++i) {
        if (weights[i] <= 0.0f) continue;
        if ((pick -= weights[i]) <= 0.0f) return static_cast<Archetype>(i);
    }
    return Archetype::Oficinista;
}

// Una postura de la lista con sus pesos, saltando las que piden una mano ocupada (`busyHands`: 0 libres, 1 derecha ocupada, 2 izquierda, 3 ambas)
inline Stance PickStop(const ArchetypeInfo& info, int busyHands, float roll) {
    const auto usable = [&](Stance stance) {
        const int hands = StanceHands(stance);
        return hands == 0 || (hands == 1 && !(busyHands & 1)) || (hands == 2 && busyHands == 0);
    };
    float total = 0.0f;
    for (const Weighted& w : info.stops) if (usable(w.stance)) total += w.weight;
    if (total <= 0.0f) return Stance::CambiarPeso;
    float pick = roll * total;
    for (const Weighted& w : info.stops) {
        if (!usable(w.stance)) continue;
        if ((pick -= w.weight) <= 0.0f) return w.stance;
    }
    return Stance::CambiarPeso;
}

// Con que postura anda (fija por persona): `roll` en [0, 1)
inline Stance PickWalking(const ArchetypeInfo& info, int busyHands, float roll) {
    for (const Weighted& w : info.walking) {
        const int hands = StanceHands(w.stance);
        const bool usable = hands == 0 || (hands == 1 && !(busyHands & 1)) || (hands == 2 && busyHands == 0);
        if (roll < w.weight) return usable ? w.stance : Stance::None;
        roll -= w.weight;
    }
    return Stance::None;
}

} // namespace Bazuko::People
