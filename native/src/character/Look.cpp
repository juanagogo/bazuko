#include "character/Look.h"

#include <algorithm>
#include <cmath>

#include <nlohmann/json.hpp>

namespace bazuko {

using nlohmann::json;

namespace {

bool hasStyle(const LookData& d, const std::string& kind, const std::string& id) {
    auto it = d.styles.find(kind);
    if (it == d.styles.end()) return false;
    return std::any_of(it->second.begin(), it->second.end(), [&](const StyleOption& o) { return o.id == id; });
}
std::string pickId(const json& raw, const char* key, const char* kind, const std::string& fallback, const LookData& d) {
    if (raw.contains(key) && raw[key].is_string() && hasStyle(d, kind, raw[key])) return raw[key];
    return fallback;
}
int clampIdx(const json& raw, const char* key, size_t size, int fallback) {
    if (raw.contains(key) && raw[key].is_number_integer()) {
        const int v = raw[key];
        if (v >= 0 && v < static_cast<int>(size)) return v;
    }
    return fallback;
}

}  // namespace

std::string cleanName(const std::string& raw) {
    std::string out;
    bool lastSpace = false;
    for (unsigned char c : raw) {
        if (c < 0x20 || c == '<' || c == '>') continue;
        const bool space = std::isspace(c) != 0;
        if (space && lastSpace) continue;
        out.push_back(static_cast<char>(c));
        lastSpace = space;
    }
    auto begin = out.find_first_not_of(" \t\n\r");
    if (begin == std::string::npos) return {};
    out = out.substr(begin, out.find_last_not_of(" \t\n\r") - begin + 1);
    // máximo 16 caracteres (no se corta en mitad de un carácter UTF-8)
    size_t chars = 0, i = 0;
    while (i < out.size() && chars < 16) {
        const unsigned char c = static_cast<unsigned char>(out[i]);
        i += c < 0x80 ? 1 : (c >> 5) == 6 ? 2 : (c >> 4) == 14 ? 3 : 4;
        ++chars;
    }
    return out.substr(0, std::min(i, out.size()));
}

Look defaultLook() { return Look{}; }

Look normalizeLook(const json& raw, const LookData& d) {
    Look l;
    if (!raw.is_object()) return l;
    const auto& pal = d.palettes;
    if (!raw.contains("v") || raw["v"] != 2) {
        // formato anterior: { piel, buzo, gorra, barba, origen }
        static const int oldCap[5] = {-1, 6, 0, 1, 11};
        if (raw.contains("piel") && raw["piel"].is_number_integer()) l.piel = std::min(5, raw["piel"].get<int>() + 1);
        l.arribaColor = clampIdx(raw, "buzo", pal.at("ropa").size(), 0);
        if (raw.contains("gorra") && raw["gorra"].is_number_integer()) {
            const int g = raw["gorra"];
            l.cabeza = g == 0 ? "nada" : "gorra";
            l.cabezaColor = g >= 0 && g < 5 && oldCap[g] >= 0 ? oldCap[g] : 0;
        }
        if (raw.contains("barba")) l.barba = raw["barba"].is_null() || raw["barba"] == false || raw["barba"] == 0 ? "ninguna" : "candado";
        if (raw.contains("origen") && raw["origen"].is_string()) l.origen = raw["origen"];
        return l;
    }
    l.nombre = cleanName(raw.value("nombre", std::string()));
    if (raw.contains("real") && raw["real"].is_object()) {
        const auto& r = raw["real"];
        l.hasReal = true;
        l.real.sexo = r.value("sexo", l.real.sexo);
        l.real.edad = r.value("edad", l.real.edad);
        l.real.pelo = r.value("pelo", l.real.pelo);
        l.real.barba = r.value("barba", l.real.barba);
        l.real.ropa = r.value("ropa", l.real.ropa);
        l.real.calzado = r.value("calzado", l.real.calzado);
    }
    if (raw.contains("origen") && raw["origen"].is_string()) l.origen = raw["origen"];
    l.cuerpo = pickId(raw, "cuerpo", "cuerpo", l.cuerpo, d);
    l.contextura = pickId(raw, "contextura", "contextura", l.contextura, d);
    l.pelo = pickId(raw, "pelo", "pelo", l.pelo, d);
    l.cejas = pickId(raw, "cejas", "cejas", l.cejas, d);
    l.barba = pickId(raw, "barba", "barba", l.barba, d);
    l.arriba = pickId(raw, "arriba", "arriba", l.arriba, d);
    l.abajo = pickId(raw, "abajo", "abajo", l.abajo, d);
    l.zapatos = pickId(raw, "zapatos", "zapatos", l.zapatos, d);
    l.cabeza = pickId(raw, "cabeza", "cabeza", l.cabeza, d);
    l.estatura = raw.contains("estatura") && raw["estatura"].is_number() ? std::min(1.08, std::max(0.92, raw["estatura"].get<double>())) : 1.0;
    l.piel = clampIdx(raw, "piel", pal.at("piel").size(), l.piel);
    l.peloColor = clampIdx(raw, "peloColor", pal.at("pelo").size(), l.peloColor);
    l.ojos = clampIdx(raw, "ojos", pal.at("ojos").size(), l.ojos);
    l.arribaColor = clampIdx(raw, "arribaColor", pal.at("ropa").size(), l.arribaColor);
    l.abajoColor = clampIdx(raw, "abajoColor", pal.at("ropa").size(), l.abajoColor);
    l.zapatoColor = clampIdx(raw, "zapatoColor", pal.at("zapato").size(), l.zapatoColor);
    l.cabezaColor = clampIdx(raw, "cabezaColor", pal.at("ropa").size(), l.cabezaColor);
    return l;
}

json lookToJson(const Look& l) {
    json j = {{"v", 2}, {"nombre", l.nombre}, {"origen", l.origen}, {"cuerpo", l.cuerpo}, {"contextura", l.contextura},
              {"estatura", l.estatura}, {"piel", l.piel}, {"pelo", l.pelo}, {"peloColor", l.peloColor}, {"ojos", l.ojos},
              {"cejas", l.cejas}, {"barba", l.barba}, {"arriba", l.arriba}, {"arribaColor", l.arribaColor}, {"abajo", l.abajo},
              {"abajoColor", l.abajoColor}, {"zapatos", l.zapatos}, {"zapatoColor", l.zapatoColor}, {"cabeza", l.cabeza},
              {"cabezaColor", l.cabezaColor}};
    if (l.hasReal)
        j["real"] = {{"sexo", l.real.sexo}, {"edad", l.real.edad}, {"pelo", l.real.pelo}, {"barba", l.real.barba},
                     {"ropa", l.real.ropa}, {"calzado", l.real.calzado}};
    return j;
}

Look randomLook(const Look& base, const LookData& d, Rng& rng) {
    auto anyStyle = [&](const char* kind) -> const std::string& {
        const auto& v = d.styles.at(kind);
        return v[static_cast<size_t>(rng.below(static_cast<int>(v.size())))].id;
    };
    const auto& pal = d.palettes;
    Look l = base;
    l.cuerpo = anyStyle("cuerpo");
    l.contextura = anyStyle("contextura");
    l.estatura = 0.94 + rng.next() * 0.12;
    l.piel = rng.below(static_cast<int>(pal.at("piel").size()));
    l.pelo = anyStyle("pelo");
    l.peloColor = rng.next() < 0.85 ? rng.below(5) : rng.below(static_cast<int>(pal.at("pelo").size()));
    l.ojos = rng.below(static_cast<int>(pal.at("ojos").size()));
    l.cejas = anyStyle("cejas");
    l.barba = rng.next() < 0.45 ? "ninguna" : anyStyle("barba");
    l.arriba = anyStyle("arriba");
    const int top = rng.below(static_cast<int>(pal.at("ropa").size()));
    l.arribaColor = top;
    static const int bottoms[5] = {10, 6, 3, 12, 2};
    int bottom = bottoms[rng.below(5)];
    if (bottom == top) bottom = 10;
    l.abajo = anyStyle("abajo");
    l.abajoColor = bottom;
    l.zapatos = anyStyle("zapatos");
    l.zapatoColor = rng.below(static_cast<int>(pal.at("zapato").size()));
    l.cabeza = rng.next() < 0.3 ? "nada" : anyStyle("cabeza");
    l.cabezaColor = rng.below(static_cast<int>(pal.at("ropa").size()));
    return l;
}

}  // namespace bazuko
