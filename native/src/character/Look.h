#pragma once

#include <string>

#include <nlohmann/json_fwd.hpp>

#include "core/Rng.h"
#include "game/data/GameData.h"

namespace bazuko {

// Apariencia realista: qué pieza usa el personaje en cada categoría.
struct RealLook {
    std::string sexo = "hombre", edad = "adulto", pelo = "desordenado", barba = "descuidada", ropa = "chaqueta", calzado = "tenis-rotos";
    bool operator==(const RealLook&) const = default;
};

// Apariencia compartida (la que edita el creador). Los colores son índices en las paletas de `LookData`;
// los estilos son ids de `LookData::styles`. `real` son las piezas del personaje realista.
struct Look {
    std::string nombre;
    std::string origen = "reciclador";
    std::string cuerpo = "a", contextura = "normal";
    double estatura = 1;
    int piel = 2;
    std::string pelo = "corto";  // estilo del personaje procedural (el realista usa real.pelo)
    int peloColor = 0, ojos = 0;
    std::string cejas = "gruesas", barba = "candado";
    std::string arriba = "buzo";
    int arribaColor = 0;
    std::string abajo = "jean";
    int abajoColor = 10;
    std::string zapatos = "tenis";
    int zapatoColor = 1;
    std::string cabeza = "gorra";
    int cabezaColor = 0;
    RealLook real;
    bool hasReal = false;  // false hasta que el creador (o un guardado) fija piezas realistas
};

// Texto plano, sin espacios dobles ni < >, máximo 16 caracteres.
std::string cleanName(const std::string& raw);

// Normaliza (y migra) cualquier apariencia guardada al formato actual. Acepta el JSON del guardado web
// (v2, o el formato anterior con { piel, buzo, gorra, barba, origen }).
Look normalizeLook(const nlohmann::json& raw, const LookData& data);
Look defaultLook();

// Combinación al azar, curada: pelo casi siempre natural, ropa que contrasta.
Look randomLook(const Look& base, const LookData& data, Rng& rng);

// JSON del guardado (mismo esquema que el juego web: v2 con `real` opcional).
nlohmann::json lookToJson(const Look& look);

}  // namespace bazuko
