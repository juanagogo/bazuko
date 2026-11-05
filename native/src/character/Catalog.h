#pragma once

#include <map>
#include <string>
#include <vector>

#include "character/Look.h"
#include "core/MathTypes.h"
#include "core/Rng.h"
#include "game/data/GameData.h"

namespace bazuko {

struct PieceOption {
    std::string id, label, sexo;  // sexo vacío = para ambos
};

struct BodyPiece {
    std::string file;  // vacío = sin pieza (calvo, ninguna)
    std::string lod;   // versión liviana, si existe
    std::vector<int> hidden;  // vértices del cuerpo que tapa (atributo _VID)
};

struct BodyDef {
    std::string id, sexo, edad;
    std::map<std::string, BodyPiece> pieces;
};

// Catálogo exportado por tools/personaje: cuerpos (sexo × edad) y piezas con sus etiquetas.
class Catalog {
public:
    // Lanza std::runtime_error si no se puede leer.
    static Catalog load(const std::string& path);

    const std::vector<BodyDef>& bodies() const { return bodies_; }
    const std::vector<PieceOption>& pieces(const std::string& category) const;  // pelo, barba, ropa, calzado
    const BodyDef* body(const std::string& sexo, const std::string& edad) const;
    const BodyDef& bodyFor(const RealLook& look) const;  // el primero si no existe la combinación

    // Piezas válidas para un sexo.
    std::vector<PieceOption> optionsFor(const std::string& category, const std::string& sexo) const;
    // Corrige una apariencia para que todas sus piezas existan en ese cuerpo.
    RealLook normalize(RealLook look) const;
    // Combinación al azar de piezas realistas.
    RealLook randomReal(Rng& rng, const std::string& sexo = "") const;

private:
    std::vector<BodyDef> bodies_;
    std::map<std::string, std::vector<PieceOption>> pieces_;
};

// Apariencia al azar de la gente de la calle; `gastada` prefiere ropa vieja (El Cartucho).
Look randomStreetLook(const Catalog& catalog, const LookData& look, Rng& rng, bool gastada);

// Color de la paleta (hex "#rrggbb" → lineal) mezclado con blanco `whiteMix`: tono de piel y de pelo.
Rgb paletteTone(const std::vector<std::string>& palette, int index, int fallback, double whiteMix);

}  // namespace bazuko
