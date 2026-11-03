#pragma once
// Datos del juego compartidos con la version web: objetos, tienda, tablas de botin y talentos.
// Se leen de assets/data/game-data.json, que genera tools/export-game-data.mjs desde src/data/*.js.
#include <array>
#include <map>
#include <optional>
#include <string>
#include <unordered_set>
#include <vector>

namespace Bazuko {

// Orden de las necesidades en todo el juego: hambre, sed, energia, salud, higiene, animo, vicio.
inline constexpr int kNeedCount = 7;

struct ItemDef {
    std::string id;
    std::string name;
    float weight = 0.0f;
    int value = 0;               // lo que paga la recicladora (COP)
    std::string rarity;          // "", "common", "uncommon", "rare", "veryRare"
    std::string rarityLabel;
    std::string cure;            // enfermedad que cura
    std::string desc;
    std::string weapon;          // arma cuerpo a cuerpo que se saca al usarlo ("cuchillo", ...), vacio si no es arma
    bool recyclable = false;
    bool usable = false;
    bool build = false;
    bool substance = false;
    bool portOnly = false;       // existe solo en el port (recetas sin objeto en el original)
    int consumableNeed = -1;     // necesidad que restaura al consumirlo, o -1
    float amount = 0.0f;         // cuanto restaura
    std::array<float, kNeedCount> deltas{};  // efectos adicionales sobre cada necesidad
};

struct ShopEntry {
    std::string item;            // id del objeto, vacio si es una mejora
    std::string upgrade;         // "costal"
    int price = 0;
    int qty = 1;
    std::string label;
    std::string desc;
};

struct LootEntry {
    std::string item;
    float weight = 0.0f;
};

struct TalentDef {
    std::string id;
    std::string name;
    std::string desc;
    std::string branch;
    int cost = 1;
    std::vector<std::string> prerequisites;
    std::map<std::string, float> effects;
};

struct CambuchePieceDef {
    std::string id;
    std::string name;
    std::string desc;
    std::string needs;                               // pieza previa ("base") o vacio
    std::vector<std::pair<std::string, int>> req;    // materiales (id de objeto, cantidad)
};

// Efectos de dormir segun lo construido (SLEEP de src/data/cambuche.js)
struct SleepData {
    float energia = 45.0f, energiaCama = 35.0f, salud = 10.0f, saludTecho = 15.0f;
    float animoFogon = 15.0f, hambreFogon = 15.0f, vicioVela = 15.0f;
    float roboProb = 0.25f, roboDinero = 0.4f, roboMaterial = 0.5f;
};

struct GameData {
    float costalBonus = 20.0f;
    std::vector<ItemDef> items;
    std::vector<ShopEntry> shop;
    std::vector<LootEntry> lootCommon;
    std::vector<LootEntry> lootRare;
    std::vector<LootEntry> lootSubstance;
    std::vector<TalentDef> talents;
    std::vector<CambuchePieceDef> cambuche;
    SleepData sleep;

    const ItemDef* FindItem(const std::string& id) const;
    int ItemIndex(const std::string& id) const;   // -1 si no existe
    const TalentDef* FindTalent(const std::string& id) const;
    const CambuchePieceDef* FindCambuchePiece(const std::string& id) const;

    // Valor acumulado de un efecto entre los talentos desbloqueados (reglas de TalentSystem.getEffect):
    // las claves con "Mult" o "Resist" multiplican, el resto suma.
    float TalentEffect(const std::unordered_set<std::string>& unlocked, const std::string& key, float base = 1.0f) const;

    static std::optional<GameData> LoadFromFile(const std::string& path, std::string* error = nullptr);
    // Busca assets/data/game-data.json junto al ejecutable; si falta o esta dañado termina el juego con un mensaje.
    static const GameData& Get();
};

// Texto corto con los efectos de un objeto ("+40 energía · +15 ánimo", "Cura: gripe.").
std::string DescribeItemEffects(const ItemDef& item);

} // namespace Bazuko
