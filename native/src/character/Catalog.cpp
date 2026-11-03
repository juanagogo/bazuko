#include "character/Catalog.h"

#include <algorithm>
#include <cmath>
#include <fstream>
#include <sstream>
#include <stdexcept>

#include <nlohmann/json.hpp>

#include "core/MathTypes.h"

namespace bazuko {

using nlohmann::json;

Catalog Catalog::load(const std::string& path) {
    std::ifstream f(path);
    if (!f) throw std::runtime_error("no se pudo abrir el catálogo " + path);
    json j;
    try {
        j = json::parse(f);
    } catch (const json::exception& e) {
        throw std::runtime_error("catálogo inválido: " + std::string(e.what()));
    }
    Catalog c;
    try {
        for (const auto& b : j.at("cuerpos")) {
            BodyDef body;
            body.id = b.at("id");
            body.sexo = b.at("sexo");
            body.edad = b.at("edad");
            for (auto it = b.at("piezas").begin(); it != b.at("piezas").end(); ++it) {
                BodyPiece piece;
                const auto& p = it.value();
                if (p.contains("file") && !p["file"].is_null()) piece.file = p["file"];
                if (p.contains("lod") && !p["lod"].is_null()) piece.lod = p["lod"];
                if (p.contains("oculta")) piece.hidden = p["oculta"].get<std::vector<int>>();
                body.pieces[it.key()] = std::move(piece);
            }
            c.bodies_.push_back(std::move(body));
        }
        for (auto it = j.at("piezas").begin(); it != j.at("piezas").end(); ++it) {
            for (const auto& o : it.value()) {
                PieceOption opt;
                opt.id = o.at("id");
                opt.label = o.value("label", opt.id);
                if (o.contains("sexo") && !o["sexo"].is_null()) opt.sexo = o["sexo"];
                c.pieces_[it.key()].push_back(std::move(opt));
            }
        }
    } catch (const json::exception& e) {
        throw std::runtime_error("catálogo inválido: " + std::string(e.what()));
    }
    if (c.bodies_.empty()) throw std::runtime_error("catálogo sin cuerpos");
    return c;
}

const std::vector<PieceOption>& Catalog::pieces(const std::string& category) const {
    static const std::vector<PieceOption> none;
    auto it = pieces_.find(category);
    return it == pieces_.end() ? none : it->second;
}

const BodyDef* Catalog::body(const std::string& sexo, const std::string& edad) const {
    for (const BodyDef& b : bodies_)
        if (b.sexo == sexo && b.edad == edad) return &b;
    return nullptr;
}

const BodyDef& Catalog::bodyFor(const RealLook& look) const {
    const BodyDef* b = body(look.sexo, look.edad);
    return b ? *b : bodies_.front();
}

std::vector<PieceOption> Catalog::optionsFor(const std::string& category, const std::string& sexo) const {
    std::vector<PieceOption> out;
    for (const PieceOption& o : pieces(category))
        if (o.sexo.empty() || o.sexo == sexo) out.push_back(o);
    return out;
}

RealLook Catalog::normalize(RealLook r) const {
    const RealLook def;
    if (r.sexo != "hombre" && r.sexo != "mujer") r.sexo = def.sexo;
    if (r.edad != "joven" && r.edad != "adulto" && r.edad != "mayor") r.edad = def.edad;
    auto fix = [&](const std::string& cat, std::string& value) {
        const auto opts = optionsFor(cat, r.sexo);
        if (opts.empty()) return;
        if (std::none_of(opts.begin(), opts.end(), [&](const PieceOption& o) { return o.id == value; })) value = opts.front().id;
    };
    fix("pelo", r.pelo);
    fix("barba", r.barba);
    fix("ropa", r.ropa);
    fix("calzado", r.calzado);
    if (r.sexo == "mujer") r.barba = "ninguna";
    return r;
}

RealLook Catalog::randomReal(Rng& rng, const std::string& base) const {
    auto any = [&](const auto& v) -> const auto& { return v[static_cast<size_t>(rng.below(static_cast<int>(v.size())))]; };
    static const std::vector<std::string> sexos = {"hombre", "mujer"}, edades = {"joven", "adulto", "mayor"};
    RealLook r;
    r.sexo = base.empty() ? any(sexos) : base;
    r.edad = any(edades);
    auto pick = [&](const std::string& cat) { return any(optionsFor(cat, r.sexo)).id; };
    r.pelo = pick("pelo");
    r.barba = rng.next() < 0.3 ? "ninguna" : pick("barba");
    r.ropa = pick("ropa");
    r.calzado = pick("calzado");
    return normalize(r);
}

Look randomStreetLook(const Catalog& catalog, const LookData& look, Rng& rng, bool gastada) {
    auto any = [&](const auto& v) -> const auto& { return v[static_cast<size_t>(rng.below(static_cast<int>(v.size())))]; };
    const std::string sexo = rng.next() < 0.72 ? "hombre" : "mujer";
    const auto ropaOpts = catalog.optionsFor("ropa", sexo);
    static const std::vector<std::string> oldIds = {"rota", "saco", "chaqueta", "buzo", "overol", "sudadera"};
    std::vector<std::string> viejas;
    for (const PieceOption& o : ropaOpts)
        if (std::find(oldIds.begin(), oldIds.end(), o.id) != oldIds.end()) viejas.push_back(o.id);

    Look out = randomLook(defaultLook(), look, rng);
    out.piel = 1 + rng.below(5);

    static const std::vector<std::string> edades = {"joven", "adulto", "adulto", "mayor"};
    static const std::vector<std::string> beards = {"descuidada", "candado", "larga", "bigote"};
    static const std::vector<std::string> oldShoes = {"tenis-rotos", "tenis-rotos", "botas"};
    RealLook r;
    r.sexo = sexo;
    r.edad = any(edades);
    r.pelo = any(catalog.optionsFor("pelo", sexo)).id;
    r.barba = sexo == "hombre" && rng.next() < 0.7 ? any(beards) : "ninguna";
    r.ropa = gastada && !viejas.empty() ? any(viejas) : any(ropaOpts).id;
    r.calzado = gastada ? any(oldShoes) : any(catalog.optionsFor("calzado", sexo)).id;
    out.real = catalog.normalize(r);
    out.hasReal = true;
    return out;
}

Rgb paletteTone(const std::vector<std::string>& palette, int index, int fallback, double whiteMix) {
    const int i = index >= 0 && index < static_cast<int>(palette.size()) ? index : fallback;
    const std::string& hex = palette.at(static_cast<size_t>(i));
    const Rgb c = rgbFromHex(static_cast<std::uint32_t>(std::stoul(hex.substr(1), nullptr, 16)));
    return lerp(c, {1, 1, 1}, whiteMix);
}

}  // namespace bazuko
