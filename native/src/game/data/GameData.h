#pragma once

#include <map>
#include <optional>
#include <string>
#include <vector>

namespace bazuko {

struct ItemDef {
    std::string id, name, icon;
    double weight = 0, value = 0;
    std::optional<std::string> consumable;  // necesidad que restaura (hambre, sed...)
    double amount = 0;
    double animo = 0, energia = 0, salud = 0;  // efectos secundarios del consumible
    std::optional<std::string> cure;           // id de enfermedad que cura
    bool substance = false, build = false, rare = false;

    // La recicladora compra lo que no se come, no cura, no es sustancia ni sirve para construir.
    bool recyclable() const { return !consumable && !cure && !substance && !build; }
};

struct LootEntry { std::string item; double weight = 0; };

struct ShopEntry {
    std::string item;     // vacío si es una mejora
    std::string upgrade;  // "costal"
    double price = 0;
    int qty = 1;
    std::string label, desc, icon;
};

struct Recipe {
    std::string id, name, emoji, result;
    int qty = 1;
    std::vector<std::pair<std::string, int>> ingredients;
};

struct Talent {
    std::string id, name, desc, branch;
    int cost = 1;
    std::vector<std::string> prereqs;  // ids de talentos requeridos ("requires" es palabra reservada)
    std::map<std::string, double> effects;
};

struct Branch { std::string id, name, emoji; };

struct Origin {
    std::string id, name, desc;
    std::map<std::string, double> effects;
};

struct CambuchePiece {
    std::string id, name, icon, desc, needs;  // needs vacío si no depende de otra pieza
    std::vector<std::pair<std::string, int>> req;
};

struct SleepConsts {
    double energia, energiaCama, salud, saludTecho, animoFogon, hambreFogon, vicioVela;
    double roboProb, roboDinero, roboMaterial;
};

struct DiseaseDef {
    std::string id, name, emoji;
    double healthDrain = 0, mentalDrain = 0, duration = 0;
};

// Catálogo de apariencia del creador de personajes (look.js).
struct StyleOption { std::string id, label; };
struct LookData {
    std::map<std::string, std::vector<std::string>> palettes;     // piel, pelo, ojos, ropa, zapato (hex "#rrggbb")
    std::map<std::string, std::vector<std::string>> colorNames;
    std::map<std::string, std::vector<StyleOption>> styles;       // cuerpo, contextura, pelo, cejas, barba, arriba...
    std::vector<std::string> nameIdeas;
};

struct Needs6 { double hambre, sed, energia, higiene, animo, vicio; };

struct GameData {
    std::map<std::string, double> constants;  // constantes numéricas sueltas (XP_PICKUP, ...)
    Needs6 decay{};
    struct { double hambre, sed; } survivalDamage{};
    std::map<std::string, double> statThresholds;
    std::map<std::string, double> withdrawal;

    std::vector<ItemDef> items;
    std::vector<LootEntry> lootCommon, lootRare, lootSubstance;
    std::vector<ShopEntry> shopItems;
    double costalBonus = 0;
    std::vector<Recipe> recipes;
    std::vector<Talent> talents;
    std::vector<Branch> branches;
    std::vector<Origin> origins;
    std::vector<CambuchePiece> cambuche;
    SleepConsts sleep{};
    std::vector<DiseaseDef> diseases;
    LookData look;

    double c(const std::string& key) const;  // constante numérica; lanza si no existe
    const ItemDef* item(const std::string& id) const;
    const DiseaseDef* disease(const std::string& id) const;
    const Talent* talent(const std::string& id) const;
    const Origin* origin(const std::string& id) const;

    // Lee y valida el JSON exportado por tools/export_data.mjs. Lanza std::runtime_error.
    static GameData load(const std::string& path);
    static GameData parse(const std::string& jsonText);
};

}  // namespace bazuko
