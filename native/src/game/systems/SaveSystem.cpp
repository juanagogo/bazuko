#include "game/systems/SaveSystem.h"

#include <cmath>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <stdexcept>

#include <nlohmann/json.hpp>

namespace bazuko {

using nlohmann::json;
namespace fs = std::filesystem;

namespace {

constexpr double kV1ToCop = 250;  // las partidas v1 guardaban "dólares"

// El juego web llamaba 'intoxication' a lo que aquí es 'intoxicacion'.
std::string migrateDiseaseId(const std::string& id) { return id == "intoxication" ? "intoxicacion" : id; }

double num(const json& j, const char* key, double fallback) {
    auto it = j.find(key);
    return it != j.end() && it->is_number() ? it->get<double>() : fallback;
}

SaveData::Stats readStats(const json& j) {
    SaveData::Stats s;
    s.hambre = num(j, "hambre", s.hambre);
    s.sed = num(j, "sed", s.sed);
    s.energia = num(j, "energia", s.energia);
    s.salud = num(j, "salud", s.salud);
    s.higiene = num(j, "higiene", s.higiene);
    s.animo = j.contains("animo") ? num(j, "animo", s.animo) : num(j, "saludMental", s.animo);
    s.vicio = num(j, "vicio", s.vicio);
    s.dinero = num(j, "dinero", s.dinero);
    s.xp = num(j, "xp", s.xp);
    s.level = static_cast<int>(num(j, "level", s.level));
    return s;
}

}  // namespace

SaveData capture(const GameState& g) {
    SaveData d;
    const auto& st = g.stats;
    d.stats = {st.hambre, st.sed, st.energia, st.salud, st.higiene, st.animo, st.vicio, st.dinero, st.xp, st.level};
    d.day = g.clock.day;
    d.hour = g.clock.hour;
    for (const auto& s : g.inventory.items()) d.inventory.emplace_back(s.id, s.qty);
    d.talentPoints = g.talents.points();
    d.talents = g.talents.unlocked();
    d.diseases = g.diseases.active();
    d.built = g.built;
    d.costal = g.costal;
    return d;
}

void apply(GameState& g, const SaveData& d) {
    auto& st = g.stats;
    st.hambre = d.stats.hambre; st.sed = d.stats.sed; st.energia = d.stats.energia;
    st.salud = d.stats.salud; st.higiene = d.stats.higiene; st.animo = d.stats.animo;
    st.vicio = d.stats.vicio; st.dinero = d.stats.dinero; st.xp = d.stats.xp; st.level = d.stats.level;
    g.clock.day = d.day;
    g.clock.hour = d.hour;
    g.built = d.built;
    g.costal = d.costal;
    g.talents.restore(d.talentPoints, d.talents);
    g.diseases.restore(d.diseases);
    g.refreshMaxWeight();
    g.inventory.restore(d.inventory);
}

std::string serialize(const SaveData& d) {
    json j;
    j["v"] = kSaveVersion;
    j["stats"] = {{"hambre", d.stats.hambre}, {"sed", d.stats.sed}, {"energia", d.stats.energia},
                  {"salud", d.stats.salud}, {"higiene", d.stats.higiene}, {"animo", d.stats.animo},
                  {"vicio", d.stats.vicio}, {"dinero", d.stats.dinero}, {"xp", d.stats.xp},
                  {"level", d.stats.level}};
    j["clock"] = {{"day", d.day}, {"hour", d.hour}};
    j["inventory"] = json::array();
    for (const auto& [id, qty] : d.inventory) j["inventory"].push_back({{"id", id}, {"qty", qty}});
    j["talents"] = {{"points", d.talentPoints}, {"unlocked", d.talents}};
    j["diseases"] = d.diseases;
    if (d.playerPos) j["player"] = {{"pos", *d.playerPos}};
    j["worldLayoutVersion"] = d.worldLayoutVersion;
    if (!d.lookJson.empty()) j["look"] = json::parse(d.lookJson);
    j["built"] = d.built;
    j["costal"] = d.costal;
    return j.dump(2);
}

SaveData parse(const std::string& text) {
    json j;
    try {
        j = json::parse(text);
        if (!j.is_object()) throw std::runtime_error("la raíz no es un objeto");

        SaveData d;
        const int version = j.contains("v") ? j["v"].get<int>() : 1;
        if (version > kSaveVersion) throw std::runtime_error("guardado de una versión más nueva");

        if (j.contains("stats")) d.stats = readStats(j["stats"]);
        if (version < 2 && j.contains("stats") && j["stats"].contains("dinero"))
            d.stats.dinero = std::floor(d.stats.dinero * kV1ToCop + 0.5);

        if (j.contains("clock")) {
            d.day = static_cast<int>(num(j["clock"], "day", d.day));
            d.hour = num(j["clock"], "hour", d.hour);
        }

        if (version >= 3) {
            for (const auto& e : j.value("inventory", json::array()))
                d.inventory.emplace_back(e.at("id").get<std::string>(), e.at("qty").get<int>());
            if (j.contains("talents")) {
                d.talentPoints = static_cast<int>(num(j["talents"], "points", 0));
                for (const auto& id : j["talents"].value("unlocked", json::array()))
                    d.talents.insert(id.get<std::string>());
            }
            const json dis = j.value("diseases", json::object());
            for (auto it = dis.begin(); it != dis.end(); ++it)
                d.diseases[migrateDiseaseId(it.key())] = it.value().get<double>();
        } else {
            // Formato del juego web: inventory.items[{id,qty,...}], talents.unlocked{id:true},
            // diseases.active{id:{timeLeft}}.
            if (j.contains("inventory"))
                for (const auto& e : j["inventory"].value("items", json::array()))
                    d.inventory.emplace_back(e.at("id").get<std::string>(), e.at("qty").get<int>());
            if (j.contains("talents")) {
                d.talentPoints = static_cast<int>(num(j["talents"], "points", 0));
                const json un = j["talents"].value("unlocked", json::object());
                for (auto it = un.begin(); it != un.end(); ++it)
                    if (it.value().get<bool>()) d.talents.insert(it.key());
            }
            if (j.contains("diseases")) {
                const json act = j["diseases"].value("active", json::object());
                for (auto it = act.begin(); it != act.end(); ++it)
                    d.diseases[migrateDiseaseId(it.key())] = num(it.value(), "timeLeft", 0);
            }
        }

        if (j.contains("player") && j["player"].contains("pos")) {
            const auto& p = j["player"]["pos"];
            d.playerPos = std::array<double, 3>{p.at(0).get<double>(), p.at(1).get<double>(), p.at(2).get<double>()};
        }
        d.worldLayoutVersion = static_cast<int>(num(j, "worldLayoutVersion", 0));
        if (j.contains("look") && j["look"].is_object()) d.lookJson = j["look"].dump();
        if (j.contains("built"))
            for (auto it = j["built"].begin(); it != j["built"].end(); ++it) d.built[it.key()] = it.value().get<bool>();
        d.costal = j.value("costal", false);
        return d;
    } catch (const json::exception& e) {
        throw std::runtime_error(std::string("guardado inválido: ") + e.what());
    }
}

std::string defaultSavePath() {
    const char* xdg = std::getenv("XDG_DATA_HOME");
    const char* home = std::getenv("HOME");
    fs::path base = xdg && *xdg ? fs::path(xdg) : fs::path(home ? home : ".") / ".local" / "share";
    return (base / "bazuko" / "save.json").string();
}

bool SaveSystem::save(const SaveData& d, std::string* error) const {
    try {
        const fs::path target(path_);
        if (target.has_parent_path()) fs::create_directories(target.parent_path());
        const fs::path tmp = target.string() + ".tmp";
        {
            std::ofstream f(tmp, std::ios::trunc);
            if (!f) throw std::runtime_error("no se pudo escribir " + tmp.string());
            f << serialize(d);
            f.flush();
            if (!f) throw std::runtime_error("error al escribir " + tmp.string());
        }
        fs::rename(tmp, target);  // atómico en el mismo sistema de archivos
        return true;
    } catch (const std::exception& e) {
        if (error) *error = e.what();
        return false;
    }
}

LoadResult SaveSystem::load() const {
    LoadResult r;
    std::error_code ec;
    if (!fs::exists(path_, ec)) return r;  // primera partida
    std::ifstream f(path_);
    if (!f) {
        r.error = "no se pudo abrir " + path_;
        return r;
    }
    std::stringstream ss;
    ss << f.rdbuf();
    try {
        r.data = parse(ss.str());
    } catch (const std::exception& e) {
        r.error = e.what();
        r.corrupt = true;
        f.close();
        fs::rename(path_, path_ + ".corrupt", ec);  // conserva el archivo para inspección
    }
    return r;
}

void SaveSystem::clear() const {
    std::error_code ec;
    fs::remove(path_, ec);
}

}  // namespace bazuko
