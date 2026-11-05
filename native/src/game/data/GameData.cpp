#include "game/data/GameData.h"

#include <fstream>
#include <sstream>
#include <stdexcept>

#include <nlohmann/json.hpp>

namespace bazuko {

using nlohmann::json;

namespace {

template <class T>
T opt(const json& j, const char* key, T fallback) {
    auto it = j.find(key);
    return it == j.end() || it->is_null() ? fallback : it->get<T>();
}

std::optional<std::string> optStr(const json& j, const char* key) {
    auto it = j.find(key);
    if (it == j.end() || it->is_null()) return std::nullopt;
    return it->get<std::string>();
}

std::map<std::string, double> numMap(const json& j) {
    std::map<std::string, double> m;
    for (auto it = j.begin(); it != j.end(); ++it) m[it.key()] = it.value().get<double>();
    return m;
}

std::vector<std::pair<std::string, int>> countList(const json& j) {
    std::vector<std::pair<std::string, int>> v;
    for (auto it = j.begin(); it != j.end(); ++it) v.emplace_back(it.key(), it.value().get<int>());
    return v;
}

std::vector<LootEntry> loot(const json& j) {
    std::vector<LootEntry> v;
    for (const auto& e : j) v.push_back({e.at("item").get<std::string>(), e.at("weight").get<double>()});
    return v;
}

}  // namespace

double GameData::c(const std::string& key) const {
    auto it = constants.find(key);
    if (it == constants.end()) throw std::runtime_error("constante inexistente: " + key);
    return it->second;
}

const ItemDef* GameData::item(const std::string& id) const {
    for (const auto& i : items) if (i.id == id) return &i;
    return nullptr;
}
const DiseaseDef* GameData::disease(const std::string& id) const {
    for (const auto& d : diseases) if (d.id == id) return &d;
    return nullptr;
}
const Talent* GameData::talent(const std::string& id) const {
    for (const auto& t : talents) if (t.id == id) return &t;
    return nullptr;
}
const Origin* GameData::origin(const std::string& id) const {
    for (const auto& o : origins) if (o.id == id) return &o;
    return nullptr;
}

GameData GameData::load(const std::string& path) {
    std::ifstream f(path);
    if (!f) throw std::runtime_error("no se pudo abrir " + path);
    std::stringstream ss;
    ss << f.rdbuf();
    return parse(ss.str());
}

GameData GameData::parse(const std::string& text) {
    json j = json::parse(text);  // lanza json::parse_error (derivada de std::exception)
    GameData d;
    try {
        d.constants = numMap(j.at("constants"));
        const auto& dc = j.at("decay");
        d.decay = {dc.at("hambre"), dc.at("sed"), dc.at("energia"), dc.at("higiene"), dc.at("animo"), dc.at("vicio")};
        d.survivalDamage = {j.at("survivalDamage").at("hambre"), j.at("survivalDamage").at("sed")};
        d.statThresholds = numMap(j.at("statThresholds"));
        d.withdrawal = numMap(j.at("withdrawal"));

        for (const auto& e : j.at("items")) {
            ItemDef it;
            it.id = e.at("id");
            it.name = e.at("name");
            it.icon = opt<std::string>(e, "icon", "box");
            it.weight = e.at("weight");
            it.value = e.at("value");
            it.consumable = optStr(e, "consumable");
            it.amount = opt(e, "amount", 0.0);
            it.animo = opt(e, "animo", 0.0);
            it.energia = opt(e, "energia", 0.0);
            it.salud = opt(e, "salud", 0.0);
            it.cure = optStr(e, "cure");
            it.substance = opt(e, "substance", false);
            it.build = opt(e, "build", false);
            it.rare = opt(e, "rare", false);
            d.items.push_back(std::move(it));
        }
        d.lootCommon = loot(j.at("lootCommon"));
        d.lootRare = loot(j.at("lootRare"));
        d.lootSubstance = loot(j.at("lootSubstance"));

        for (const auto& e : j.at("shopItems")) {
            ShopEntry s;
            s.item = opt<std::string>(e, "item", "");
            s.upgrade = opt<std::string>(e, "upgrade", "");
            s.price = e.at("price");
            s.qty = opt(e, "qty", 1);
            s.label = opt<std::string>(e, "label", "");
            s.desc = opt<std::string>(e, "desc", "");
            s.icon = opt<std::string>(e, "icon", "");
            d.shopItems.push_back(std::move(s));
        }
        d.costalBonus = j.at("costalBonus");

        for (const auto& e : j.at("recipes")) {
            Recipe r;
            r.id = e.at("id"); r.name = e.at("name"); r.emoji = e.at("emoji");
            r.result = e.at("result"); r.qty = e.at("qty");
            r.ingredients = countList(e.at("ingredients"));
            d.recipes.push_back(std::move(r));
        }
        for (const auto& e : j.at("talents")) {
            Talent t;
            t.id = e.at("id"); t.name = e.at("name"); t.desc = e.at("desc");
            t.branch = e.at("branch"); t.cost = e.at("cost");
            t.prereqs = e.at("requires").get<std::vector<std::string>>();
            t.effects = numMap(e.at("effects"));
            d.talents.push_back(std::move(t));
        }
        for (const auto& e : j.at("branches"))
            d.branches.push_back({e.at("id"), e.at("name"), e.at("emoji")});
        for (const auto& e : j.at("origins")) {
            Origin o;
            o.id = e.at("id"); o.name = e.at("name"); o.desc = e.at("desc");
            o.effects = numMap(e.at("effects"));
            d.origins.push_back(std::move(o));
        }
        for (const auto& e : j.at("cambuche")) {
            CambuchePiece p;
            p.id = e.at("id"); p.name = e.at("name"); p.icon = e.at("icon"); p.desc = e.at("desc");
            p.needs = opt<std::string>(e, "needs", "");
            p.req = countList(e.at("req"));
            d.cambuche.push_back(std::move(p));
        }
        const auto& s = j.at("sleep");
        d.sleep = {s.at("energia"), s.at("energiaCama"), s.at("salud"), s.at("saludTecho"),
                   s.at("animoFogon"), s.at("hambreFogon"), s.at("vicioVela"),
                   s.at("roboProb"), s.at("roboDinero"), s.at("roboMaterial")};
        const auto& lk = j.at("look");
        for (auto it = lk.at("palettes").begin(); it != lk.at("palettes").end(); ++it)
            d.look.palettes[it.key()] = it.value().get<std::vector<std::string>>();
        for (auto it = lk.at("colorNames").begin(); it != lk.at("colorNames").end(); ++it)
            d.look.colorNames[it.key()] = it.value().get<std::vector<std::string>>();
        for (auto it = lk.at("styles").begin(); it != lk.at("styles").end(); ++it)
            for (const auto& o : it.value()) d.look.styles[it.key()].push_back({o.at("id"), o.at("label")});
        d.look.nameIdeas = lk.at("nameIdeas").get<std::vector<std::string>>();
        for (const auto& e : j.at("diseases"))
            d.diseases.push_back({e.at("id"), e.at("name"), e.at("emoji"),
                                  e.at("healthDrain"), e.at("mentalDrain"), e.at("duration")});
    } catch (const json::exception& ex) {
        throw std::runtime_error(std::string("game_data.json inválido: ") + ex.what());
    }
    return d;
}

}  // namespace bazuko
