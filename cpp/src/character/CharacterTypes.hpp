#pragma once
#include <string>
#include <vector>
#include <array>
#include <random>
#include <algorithm>
#include <cctype>
#include <glm/glm.hpp>
#include <nlohmann/json.hpp>

namespace Bazuko {

// Paletas de color tomadas exactamente de src/character/look.js
// Valores convertidos de HEX sRGB a glm::vec4
inline const std::array<glm::vec4, 6> SkinPalettes = {{
    glm::vec4(0.965f, 0.827f, 0.702f, 1.0f), // Muy clara (#f6d3b3)
    glm::vec4(0.910f, 0.722f, 0.561f, 1.0f), // Clara (#e8b88f)
    glm::vec4(0.827f, 0.604f, 0.427f, 1.0f), // Trigueña (#d39a6d)
    glm::vec4(0.690f, 0.478, 0.322f, 1.0f),  // Morena (#b07a52)
    glm::vec4(0.541f, 0.353f, 0.231f, 1.0f), // Oscura (#8a5a3b)
    glm::vec4(0.369f, 0.231f, 0.153f, 1.0f)  // Muy oscura (#5e3b27)
}};

inline const std::array<std::string, 6> SkinColorNames = {{
    "Muy clara", "Clara", "Trigueña", "Morena", "Oscura", "Muy oscura"
}};

inline const std::array<glm::vec4, 9> HairPalettes = {{
    glm::vec4(0.106f, 0.078f, 0.063f, 1.0f), // Negro (#1b1410)
    glm::vec4(0.231f, 0.141f, 0.086f, 1.0f), // Castaño oscuro (#3b2416)
    glm::vec4(0.420f, 0.267f, 0.137f, 1.0f), // Castaño (#6b4423)
    glm::vec4(0.659f, 0.455f, 0.184f, 1.0f), // Cobrizo (#a8742f)
    glm::vec4(0.851f, 0.698f, 0.416f, 1.0f), // Rubio (#d9b26a)
    glm::vec4(0.549f, 0.549f, 0.549f, 1.0f), // Canoso (#8c8c8c)
    glm::vec4(0.910f, 0.886f, 0.839f, 1.0f), // Blanco (#e8e2d6)
    glm::vec4(0.557f, 0.137f, 0.200f, 1.0f), // Vinotinto (#8e2333)
    glm::vec4(0.165f, 0.302f, 0.561f, 1.0f)  // Azul (#2a4d8f)
}};

inline const std::array<std::string, 9> HairColorNames = {{
    "Negro", "Castaño oscuro", "Castaño", "Cobrizo", "Rubio", "Canoso", "Blanco", "Vinotinto", "Azul"
}};

inline const std::array<glm::vec4, 13> ClothingPalettes = {{
    glm::vec4(0.753f, 0.224f, 0.169f, 1.0f), // Rojo (#c0392b)
    glm::vec4(0.184f, 0.435f, 0.690f, 1.0f), // Azul (#2f6fb0)
    glm::vec4(0.247f, 0.478f, 0.227f, 1.0f), // Verde (#3f7a3a)
    glm::vec4(0.490f, 0.510f, 0.533f, 1.0f), // Gris (#7d8288)
    glm::vec4(0.878f, 0.588f, 0.169f, 1.0f), // Naranja (#e0962b)
    glm::vec4(0.478f, 0.310f, 0.627f, 1.0f), // Morado (#7a4fa0)
    glm::vec4(0.122f, 0.122f, 0.122f, 1.0f), // Negro (#1f1f1f)
    glm::vec4(0.910f, 0.890f, 0.839f, 1.0f), // Crema (#e8e3d6)
    glm::vec4(0.059f, 0.420f, 0.420f, 1.0f), // Verde petróleo (#0f6b6b)
    glm::vec4(0.839f, 0.200f, 0.424f, 1.0f), // Fucsia (#d6336c)
    glm::vec4(0.200f, 0.267f, 0.361f, 1.0f), // Azul jean (#33445c)
    glm::vec4(0.949f, 0.776f, 0.000f, 1.0f), // Amarillo (#f2c600)
    glm::vec4(0.420f, 0.290f, 0.180f, 1.0f)  // Café (#6b4a2e)
}};

inline const std::array<std::string, 13> ClothingColorNames = {{
    "Rojo", "Azul", "Verde", "Gris", "Naranja", "Morado", "Negro", "Crema", "Verde petróleo", "Fucsia", "Azul jean", "Amarillo", "Café"
}};

inline const std::array<glm::vec4, 5> ShoePalettes = {{
    glm::vec4(0.110f, 0.110f, 0.110f, 1.0f), // Negro (#1c1c1c)
    glm::vec4(0.914f, 0.914f, 0.914f, 1.0f), // Blanco (#e9e9e9)
    glm::vec4(0.478f, 0.290f, 0.165f, 1.0f), // Café (#7a4a2a)
    glm::vec4(0.184f, 0.435f, 0.690f, 1.0f), // Azul (#2f6fb0)
    glm::vec4(0.753f, 0.224f, 0.169f, 1.0f)  // Rojo (#c0392b)
}};

inline const std::array<std::string, 5> ShoeColorNames = {{
    "Negro", "Blanco", "Café", "Azul", "Rojo"
}};

inline const std::array<std::string, 16> NameIdeas = {{
    "Jairo", "Yeison", "Luz Dary", "Wilmer", "Yuli", "Brayan", "Marleny", "Don Chepe",
    "Nelson", "Leidy", "El Mono", "Doña Gloria", "Kevin", "La Flaca", "Fredy", "Sandra"
}};

struct OriginOption {
    std::string id;
    std::string name;
    std::string desc;
    std::string perk;
    int extraLoot = 0;
    float diseaseResist = 1.0f;
    float begMult = 1.0f;
    float sellMult = 1.0f;
};

inline const std::array<OriginOption, 4> Origins = {{
    {
        "reciclador",
        "Reciclador",
        "Llevas años en el reciclaje y sabes qué sirve en la calle.",
        "+1 objeto extra en cada bolsa de basura recolectada.",
        1, 1.0f, 1.0f, 1.0f
    },
    {
        "desplazado",
        "Desplazado",
        "Llegaste del campo huyendo de la violencia. Aguantas el frío y la intemperie.",
        "30 % más de resistencia contra enfermedades infecciosas.",
        0, 0.7f, 1.0f, 1.0f
    },
    {
        "migrante",
        "Migrante",
        "Cruzaste la frontera buscando sustento. Tienes labia y carisma con la gente.",
        "30 % más de dinero y caridad al pedir o rebuscar.",
        0, 1.0f, 1.3f, 1.0f
    },
    {
        "endeudado",
        "Gota a gota",
        "Lo perdiste todo por un préstamo gota a gota. Sabes negociar y regatear.",
        "15 % de mejor precio al vender reciclaje o mercancía.",
        0, 1.0f, 1.0f, 1.15f
    }
}};

struct CatalogPiece {
    std::string id;
    std::string label;
    std::string sexo; // "" (ambos), "hombre", "mujer"
};

inline const std::vector<CatalogPiece> HairOptions = {
    {"calvo", "Calvo", ""},
    {"rapado", "Rapado", ""},
    {"corto", "Corto", ""},
    {"desordenado", "Desordenado", ""},
    {"crespo", "Crespo", ""},
    {"largo", "Largo", ""},
    {"cola", "Cola", ""},
    {"melena", "Melena", ""}
};

inline const std::vector<CatalogPiece> BeardOptions = {
    {"ninguna", "Ninguna", "hombre"},
    {"bigote", "Bigote", "hombre"},
    {"candado", "Candado", "hombre"},
    {"descuidada", "Descuidada", "hombre"},
    {"larga", "Larga", "hombre"}
};

inline const std::vector<CatalogPiece> ClothesOptions = {
    {"chaqueta", "Chaqueta y jean", "hombre"},
    {"rayas", "Camisa a rayas", "hombre"},
    {"camisa", "Camisa de jean", "hombre"},
    {"buzo", "Buzo y jean", "hombre"},
    {"camiseta", "Camiseta y jean", "hombre"},
    {"overol", "Overol", "hombre"},
    {"blusa", "Camiseta y jean", "mujer"},
    {"short", "Camiseta y short", "mujer"},
    {"sudadera", "Sudadera", "mujer"},
    {"rota", "Camiseta rota y cargo", ""},
    {"saco", "Saco de lana y cargo", ""}
};

inline const std::vector<CatalogPiece> ShoeOptions = {
    {"tenis", "Tenis", ""},
    {"tenis-rotos", "Tenis viejos", ""},
    {"zapatos", "Zapatos", ""},
    {"botas", "Botas", ""}
};

struct CharacterLook {
    std::string nombre = "Jairo";
    std::string origen = "reciclador";
    std::string sexo = "hombre"; // "hombre" | "mujer"
    std::string edad = "joven";  // "joven" | "adulto" | "mayor"
    std::string pelo = "corto";
    std::string barba = "candado";
    std::string ropa = "chaqueta";
    std::string calzado = "tenis-rotos";
    int pielIdx = 2;        // 0..5 (Trigueña por defecto)
    int peloColorIdx = 0;   // 0..8 (Negro por defecto)
    int ropaColorIdx = 0;   // 0..12
    int calzadoColorIdx = 1;// 0..4 (Blanco sucio / gris)
};

inline std::string CleanName(const std::string& raw) {
    std::string result;
    bool prevSpace = false;
    for (char c : raw) {
        if (static_cast<unsigned char>(c) < 32 || c == '<' || c == '>') continue;
        if (std::isspace(static_cast<unsigned char>(c))) {
            if (!prevSpace && !result.empty()) {
                result.push_back(' ');
                prevSpace = true;
            }
        } else {
            result.push_back(c);
            prevSpace = false;
        }
        if (result.length() >= 16) break;
    }
    while (!result.empty() && std::isspace(static_cast<unsigned char>(result.back()))) {
        result.pop_back();
    }
    return result;
}

inline void NormalizeLook(CharacterLook& look) {
    look.nombre = CleanName(look.nombre);
    if (look.nombre.empty()) look.nombre = "Parcero";

    if (look.sexo != "hombre" && look.sexo != "mujer") look.sexo = "hombre";
    if (look.edad != "joven" && look.edad != "adulto" && look.edad != "mayor") look.edad = "joven";

    // Validar origen
    bool validOrigin = false;
    for (const auto& o : Origins) {
        if (o.id == look.origen) { validOrigin = true; break; }
    }
    if (!validOrigin) look.origen = "reciclador";

    // Validar pelo
    bool validHair = false;
    for (const auto& p : HairOptions) {
        if (p.id == look.pelo) { validHair = true; break; }
    }
    if (!validHair) look.pelo = "corto";

    // Validar barba
    if (look.sexo == "mujer") {
        look.barba = "ninguna";
    } else {
        bool validBeard = false;
        for (const auto& b : BeardOptions) {
            if (b.id == look.barba) { validBeard = true; break; }
        }
        if (!validBeard) look.barba = "candado";
    }

    // Validar ropa
    bool validClothes = false;
    for (const auto& c : ClothesOptions) {
        if (c.id == look.ropa && (c.sexo.empty() || c.sexo == look.sexo)) {
            validClothes = true;
            break;
        }
    }
    if (!validClothes) {
        look.ropa = (look.sexo == "mujer") ? "blusa" : "chaqueta";
    }

    // Validar calzado
    bool validShoes = false;
    for (const auto& s : ShoeOptions) {
        if (s.id == look.calzado) { validShoes = true; break; }
    }
    if (!validShoes) look.calzado = "tenis-rotos";

    // Clamps de paletas
    look.pielIdx = std::clamp(look.pielIdx, 0, static_cast<int>(SkinPalettes.size()) - 1);
    look.peloColorIdx = std::clamp(look.peloColorIdx, 0, static_cast<int>(HairPalettes.size()) - 1);
    look.ropaColorIdx = std::clamp(look.ropaColorIdx, 0, static_cast<int>(ClothingPalettes.size()) - 1);
    look.calzadoColorIdx = std::clamp(look.calzadoColorIdx, 0, static_cast<int>(ShoePalettes.size()) - 1);
}

inline CharacterLook RandomLook(std::mt19937& rng) {
    CharacterLook look;
    std::uniform_int_distribution<size_t> distName(0, NameIdeas.size() - 1);
    look.nombre = NameIdeas[distName(rng)];

    std::uniform_int_distribution<size_t> distOrigin(0, Origins.size() - 1);
    look.origen = Origins[distOrigin(rng)].id;

    std::uniform_int_distribution<int> distSexo(0, 1);
    look.sexo = distSexo(rng) == 0 ? "hombre" : "mujer";

    std::uniform_int_distribution<int> distEdad(0, 2);
    const char* edades[] = {"joven", "adulto", "mayor"};
    look.edad = edades[distEdad(rng)];

    std::uniform_int_distribution<size_t> distHair(0, HairOptions.size() - 1);
    look.pelo = HairOptions[distHair(rng)].id;

    if (look.sexo == "hombre") {
        std::uniform_int_distribution<size_t> distBeard(0, BeardOptions.size() - 1);
        look.barba = BeardOptions[distBeard(rng)].id;
    } else {
        look.barba = "ninguna";
    }

    std::vector<std::string> validClothes;
    for (const auto& c : ClothesOptions) {
        if (c.sexo.empty() || c.sexo == look.sexo) validClothes.push_back(c.id);
    }
    std::uniform_int_distribution<size_t> distClothes(0, validClothes.size() - 1);
    look.ropa = validClothes[distClothes(rng)];

    std::uniform_int_distribution<size_t> distShoes(0, ShoeOptions.size() - 1);
    look.calzado = ShoeOptions[distShoes(rng)].id;

    std::uniform_int_distribution<int> distPiel(0, static_cast<int>(SkinPalettes.size()) - 1);
    look.pielIdx = distPiel(rng);

    std::uniform_int_distribution<int> distPeloColor(0, static_cast<int>(HairPalettes.size()) - 1);
    look.peloColorIdx = distPeloColor(rng);

    std::uniform_int_distribution<int> distRopaColor(0, static_cast<int>(ClothingPalettes.size()) - 1);
    look.ropaColorIdx = distRopaColor(rng);

    std::uniform_int_distribution<int> distShoeColor(0, static_cast<int>(ShoePalettes.size()) - 1);
    look.calzadoColorIdx = distShoeColor(rng);

    NormalizeLook(look);
    return look;
}

inline void to_json(nlohmann::json& j, const CharacterLook& l) {
    j = nlohmann::json{
        {"nombre", l.nombre},
        {"origen", l.origen},
        {"sexo", l.sexo},
        {"edad", l.edad},
        {"pelo", l.pelo},
        {"barba", l.barba},
        {"ropa", l.ropa},
        {"calzado", l.calzado},
        {"pielIdx", l.pielIdx},
        {"peloColorIdx", l.peloColorIdx},
        {"ropaColorIdx", l.ropaColorIdx},
        {"calzadoColorIdx", l.calzadoColorIdx}
    };
}

inline void from_json(const nlohmann::json& j, CharacterLook& l) {
    l.nombre = j.value("nombre", "Jairo");
    l.origen = j.value("origen", "reciclador");
    l.sexo = j.value("sexo", "hombre");
    l.edad = j.value("edad", "joven");
    l.pelo = j.value("pelo", "corto");
    l.barba = j.value("barba", "candado");
    l.ropa = j.value("ropa", "chaqueta");
    l.calzado = j.value("calzado", "tenis-rotos");
    l.pielIdx = j.value("pielIdx", 2);
    l.peloColorIdx = j.value("peloColorIdx", 0);
    l.ropaColorIdx = j.value("ropaColorIdx", 0);
    l.calzadoColorIdx = j.value("calzadoColorIdx", 1);
    NormalizeLook(l);
}

} // namespace Bazuko
