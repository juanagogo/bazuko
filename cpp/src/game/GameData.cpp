#include "GameData.hpp"

#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <nlohmann/json.hpp>

#include "../core/Log.hpp"
#include "../core/Paths.hpp"

namespace Bazuko {

namespace {

constexpr const char* kNeedKeys[kNeedCount] = {"hambre", "sed", "energia", "salud", "higiene", "animo", "vicio"};
constexpr const char* kNeedLabels[kNeedCount] = {"hambre", "sed", "energía", "salud", "higiene", "ánimo", "vicio"};

int NeedIndex(const std::string& key) {
    for (int index = 0; index < kNeedCount; ++index)
        if (key == kNeedKeys[index]) return index;
    return -1;
}

std::vector<LootEntry> ReadLoot(const nlohmann::json& list) {
    std::vector<LootEntry> loot;
    for (const auto& entry : list) loot.push_back({entry.at("item").get<std::string>(), entry.at("weight").get<float>()});
    return loot;
}

} // namespace

const ItemDef* GameData::FindItem(const std::string& id) const {
    const int index = ItemIndex(id);
    return index < 0 ? nullptr : &items[static_cast<size_t>(index)];
}

int GameData::ItemIndex(const std::string& id) const {
    const auto found = std::find_if(items.begin(), items.end(), [&](const ItemDef& item) { return item.id == id; });
    return found == items.end() ? -1 : static_cast<int>(found - items.begin());
}

const TalentDef* GameData::FindTalent(const std::string& id) const {
    const auto found = std::find_if(talents.begin(), talents.end(), [&](const TalentDef& talent) { return talent.id == id; });
    return found == talents.end() ? nullptr : &*found;
}

const CambuchePieceDef* GameData::FindCambuchePiece(const std::string& id) const {
    const auto found = std::find_if(cambuche.begin(), cambuche.end(), [&](const CambuchePieceDef& piece) { return piece.id == id; });
    return found == cambuche.end() ? nullptr : &*found;
}

float GameData::TalentEffect(const std::unordered_set<std::string>& unlocked, const std::string& key, float base) const {
    float value = base;
    for (const TalentDef& talent : talents) {
        if (!unlocked.contains(talent.id)) continue;
        const auto effect = talent.effects.find(key);
        if (effect == talent.effects.end()) continue;
        // El original solo multiplica las claves con "Mult" y por eso suma diseaseResist (1 + 0.6 = 1.6),
        // lo que sube el riesgo en lugar de bajarlo. Aqui "Resist" tambien multiplica, como dice la descripcion.
        const bool multiplies = key.find("Mult") != std::string::npos || key.find("Resist") != std::string::npos;
        if (multiplies) value *= effect->second;
        else value += effect->second;
    }
    return value;
}

std::optional<GameData> GameData::LoadFromFile(const std::string& path, std::string* error) {
    const auto fail = [&](const std::string& message) -> std::optional<GameData> {
        if (error) *error = message;
        return std::nullopt;
    };
    std::ifstream file(path);
    if (!file) return fail("no se pudo abrir " + path);
    try {
        const nlohmann::json json = nlohmann::json::parse(file);
        GameData data;
        data.costalBonus = json.value("costalBonus", 20.0f);
        for (const auto& source : json.at("items")) {
            ItemDef item;
            item.id = source.at("id").get<std::string>();
            item.name = source.at("name").get<std::string>();
            item.weight = source.at("weight").get<float>();
            item.value = source.at("value").get<int>();
            item.rarity = source.value("rarity", std::string{});
            item.rarityLabel = source.value("rarityLabel", std::string{});
            item.cure = source.value("cure", std::string{});
            item.desc = source.value("desc", std::string{});
            item.recyclable = source.value("recyclable", false);
            item.usable = source.value("usable", false);
            item.weapon = source.value("weapon", std::string{});
            item.build = source.value("build", false);
            item.substance = source.value("substance", false);
            item.portOnly = source.value("portOnly", false);
            item.warmth = source.value("calor", 0.0f);
            if (source.contains("consumable")) {
                item.consumableNeed = NeedIndex(source["consumable"].at("stat").get<std::string>());
                item.amount = source["consumable"].at("amount").get<float>();
                if (item.consumableNeed < 0) return fail("objeto " + item.id + ": necesidad desconocida");
            }
            if (source.contains("effects")) {
                for (const auto& [key, amount] : source["effects"].items()) {
                    const int need = NeedIndex(key);
                    if (need < 0) return fail("objeto " + item.id + ": efecto desconocido " + key);
                    item.deltas[static_cast<size_t>(need)] = amount.get<float>();
                }
            }
            data.items.push_back(std::move(item));
        }
        for (const auto& source : json.at("shop")) {
            data.shop.push_back({source.value("item", std::string{}), source.value("upgrade", std::string{}),
                                 source.at("price").get<int>(), source.value("qty", 1),
                                 source.value("label", std::string{}), source.value("desc", std::string{})});
        }
        data.lootCommon = ReadLoot(json.at("lootCommon"));
        data.lootRare = ReadLoot(json.at("lootRare"));
        data.lootSubstance = ReadLoot(json.at("lootSubstance"));
        for (const auto& source : json.at("talents")) {
            TalentDef talent;
            talent.id = source.at("id").get<std::string>();
            talent.name = source.at("name").get<std::string>();
            talent.desc = source.at("desc").get<std::string>();
            talent.branch = source.value("branch", std::string{});
            talent.cost = source.at("cost").get<int>();
            talent.prerequisites = source.at("requires").get<std::vector<std::string>>();
            for (const auto& [key, amount] : source.at("effects").items()) talent.effects[key] = amount.get<float>();
            data.talents.push_back(std::move(talent));
        }
        for (const auto& source : json.at("cambuche")) {
            CambuchePieceDef piece;
            piece.id = source.at("id").get<std::string>();
            piece.name = source.at("name").get<std::string>();
            piece.desc = source.at("desc").get<std::string>();
            piece.needs = source.value("needs", std::string{});
            for (const auto& [item, quantity] : source.at("req").items()) piece.req.emplace_back(item, quantity.get<int>());
            data.cambuche.push_back(std::move(piece));
        }
        const auto& sleep = json.at("sleep");
        data.sleep = {sleep.at("energia").get<float>(), sleep.at("energiaCama").get<float>(), sleep.at("salud").get<float>(),
                      sleep.at("saludTecho").get<float>(), sleep.at("animoFogon").get<float>(), sleep.at("hambreFogon").get<float>(),
                      sleep.at("vicioVela").get<float>(), sleep.at("roboProb").get<float>(), sleep.at("roboDinero").get<float>(),
                      sleep.at("roboMaterial").get<float>()};
        return data;
    } catch (const std::exception& problem) {
        return fail(std::string("JSON inválido: ") + problem.what());
    }
}

const GameData& GameData::Get() {
    static const GameData data = [] {
        const std::string path = Paths::Find("assets/data/game-data.json");
        std::string error;
        std::optional<GameData> loaded = LoadFromFile(path, &error);
        if (!loaded) {
            LogError("No se pudieron cargar los datos del juego ({}): {}", path, error);
            std::fprintf(stderr, "Faltan o están dañados los datos del juego: %s\n", error.c_str());
            std::exit(1);
        }
        return std::move(*loaded);
    }();
    return data;
}

std::string DescribeItemEffects(const ItemDef& item) {
    if (!item.cure.empty()) return "Cura: " + item.cure + ".";
    std::string text;
    const auto add = [&](const std::string& part) {
        if (!text.empty()) text += " · ";
        text += part;
    };
    char buffer[64];
    if (item.consumableNeed >= 0) {
        std::snprintf(buffer, sizeof(buffer), "+%.0f %s", item.amount, kNeedLabels[item.consumableNeed]);
        add(buffer);
    }
    for (int need = 0; need < kNeedCount; ++need) {
        const float amount = item.deltas[static_cast<size_t>(need)];
        if (amount == 0.0f || need == item.consumableNeed) continue;
        std::snprintf(buffer, sizeof(buffer), "%+.0f %s", amount, kNeedLabels[need]);
        add(buffer);
    }
    if (item.warmth > 0.0f) {
        std::snprintf(buffer, sizeof(buffer), "calor +%.0f min", item.warmth / 60.0f);
        add(buffer);
    }
    return text;
}

} // namespace Bazuko
