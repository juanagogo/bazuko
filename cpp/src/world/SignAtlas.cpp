#include "SignAtlas.hpp"
#include "TextRaster.hpp"

#include <array>
#include <cstring>
#include <string>
#include <utility>

namespace Bazuko {

namespace {

constexpr int kCellW = 512;
constexpr int kCellH = 128;
const std::vector<std::string> kStreetNames{
    "Calle 10", "Calle 9", "Calle 8", "Calle 7", "Carrera 15", "Carrera 10", "Av. Caracas", "Carrera 8", "Carrera 6",
    "Parque", "Tercer Milenio", "Parque del Sur", "Parque de la Estación", "Parque del Lago", "Lago · Puente TransMilenio", "Bogotá"};
const int kCells = SignAtlas::kShopSigns + SignAtlas::kTags + SignAtlas::kNotes + SignAtlas::kLandmarks + static_cast<int>(kStreetNames.size());

// Nombres de local de src/world/districts/Bogota.js (SHOP_NAMES)
const std::array<std::pair<const char*, const char*>, SignAtlas::kShopSigns> kShops{{
    {"DROGUERÍA", "SALUD Y VIDA"},   {"PANADERÍA", "EL TRIGAL"},       {"CIGARRERÍA", "LA 10"},
    {"ASADERO", "POLLO DORADO"},     {"MISCELÁNEA", "TODO A MIL"},     {"COMPRAVENTA", "EL CENTAVO"},
    {"RESIDENCIAS", "EL DORADO"},    {"BILLARES", "LA BOLA 8"},        {"TIENDA", "DONDE PACHO"},
    {"FERRETERÍA", "EL TORNILLO"},   {"SASTRERÍA", "ARREGLOS"},        {"CAFETERÍA", "TINTO Y PAN"},
    {"CHATARRERÍA", "COMPRAMOS"},    {"MINUTOS", "A TODO OPERADOR"},   {"LAVANDERÍA", "AL INSTANTE"},
    {"PAPELERÍA", "FOTOCOPIAS"}}};

// Fondos de los rotulos (los mismos del original)
constexpr std::array<uint32_t, 6> kShopBackgrounds{0x0b4fa3, 0xc0392b, 0x1f6b3a, 0xf2c600, 0xffffff, 0x6a1b9a};
// Grafitis de las persianas (TAGS) y sus colores
const std::array<const char*, SignAtlas::kTags> kTagTexts{"KLAN", "LUZ", "ZONA 7", "RBQ", "LA 33", "PARCE", "ÑERO", "CALLE"};
constexpr std::array<uint32_t, 6> kTagColors{0xff3b6b, 0x2ee6a6, 0xffe14d, 0x59b4ff, 0xffffff, 0xff8a1f};
// Avisos de cartulina (SMALL_SIGNS)
const std::array<const char*, SignAtlas::kNotes> kNoteTexts{"SE ARRIENDA", "SE VENDE", "MINUTOS", "RECARGAS",
                                                         "CERRAJERÍA", "MODISTERÍA", "SE HACEN UÑAS", "FOTOCOPIAS"};
constexpr std::array<uint32_t, 4> kNoteBackgrounds{0xffffff, 0xffe600, 0xff7a1a, 0x7dff5a};

// Rotulos de la gasolinera y de la tienda D69 (GasStation.js y D69Store.js): titulo, subtitulo y fondo
struct LandmarkSign {
    const char* title;
    const char* sub;
    uint32_t background;
};
const std::array<LandmarkSign, SignAtlas::kLandmarks> kLandmarkSigns{{
    {"TEXACO", "SERVICIO · COMBUSTIBLES", 0xbc1726}, {"TIENDA", "CAFÉ · AGUA · VÍVERES", 0xbc1726},
    {"TEXACO", "ABIERTO 24 H", 0xbc1726},           {"CORRIENTE", "EXTRA · DIÉSEL", 0x252c32},
    {"D69", "TIENDA · AHORRO DIARIO", 0xb50c32},
    {"PORTAL DEL CENTRO", "TRANSMILENIO · ACCESO PEATONAL", 0xb32c35},
    {"NORTE · SUR", "ANDENES A AMBOS LADOS", 0xb32c35},
    {"TORRE COLPATRIA", "ACCESO PRINCIPAL", 0xa9aaa5},
    {"TORRE COLPATRIA", "EDIFICIO ANEXO", 0xa9aaa5},
    {"LOCALES", "CAFÉ · SERVICIOS", 0xa9aaa5},
    {"VAGÓN 1", "B12 · H27", 0xad1620}, {"VAGÓN 2", "B12 · H27", 0xad1620}, {"VAGÓN 3", "B12 · H27", 0xad1620}, {"VAGÓN 4", "B12 · H27", 0xad1620},
    {"TAQUILLA · RECARGAS", "", 0xad1620}, {"PRÓXIMOS BUSES", "B12 PORTAL CENTRO 2 MIN", 0x0c0b0a}, {"ESPERE DETRÁS DE LA LÍNEA AMARILLA", "", 0xf0c52a}}};

bool IsLight(uint32_t rgb) {
    const int r = static_cast<int>((rgb >> 16) & 0xFF), g = static_cast<int>((rgb >> 8) & 0xFF), b = static_cast<int>(rgb & 0xFF);
    return (r * 299 + g * 587 + b * 114) / 1000 > 150;
}

} // namespace

bool SignAtlas::Build(const std::string& fontPath) {
    FontRaster font;
    if (!font.Load(fontPath)) return false;

    Image atlas(kCellW, kCellH * kCells, {0, 0, 0, 0});

    // Copia una celda al atlas con la fila 0 abajo: las UV de las fachadas empiezan en la base del panel.
    auto place = [&](int index, const Image& cell) {
        for (int y = 0; y < kCellH; ++y) {
            const uint8_t* src = &cell.pixels[static_cast<size_t>(kCellH - 1 - y) * kCellW * 4];
            uint8_t* dst = &atlas.pixels[static_cast<size_t>(index * kCellH + y) * kCellW * 4];
            std::memcpy(dst, src, static_cast<size_t>(kCellW) * 4);
        }
    };

    int index = 0;
    for (size_t i = 0; i < kShops.size(); ++i, ++index) {
        const uint32_t bgHex = kShopBackgrounds[i % kShopBackgrounds.size()];
        const bool light = IsLight(bgHex);
        const Rgba bg = HexColor(bgHex);
        const Rgba fg = light ? HexColor(0x1a1a1a) : HexColor(0xffffff);
        const Rgba accent = light ? HexColor(0xb3261e) : HexColor(0xf6c400);
        Image cell(kCellW, kCellH, bg);
        cell.StrokeRect(8, 8, kCellW - 16, kCellH - 16, 5, fg);
        font.DrawCentered(cell, kShops[i].first, kCellW * 0.5f, 50.0f, 46.0f, 450.0f, fg);
        font.DrawCentered(cell, kShops[i].second, kCellW * 0.5f, 96.0f, 22.0f, 430.0f, accent);
        place(index, cell);
    }
    for (size_t i = 0; i < kTagTexts.size(); ++i, ++index) {
        Image cell(kCellW, kCellH, {0, 0, 0, 0});
        font.DrawCentered(cell, kTagTexts[i], kCellW * 0.5f, 64.0f, 84.0f, 470.0f, HexColor(kTagColors[i % kTagColors.size()]),
                          HexColor(0x111111), 4);
        place(index, cell);
    }
    for (size_t i = 0; i < kNoteTexts.size(); ++i, ++index) {
        Image cell(kCellW, kCellH, HexColor(kNoteBackgrounds[i % kNoteBackgrounds.size()]));
        cell.StrokeRect(0, 0, kCellW, kCellH, 4, HexColor(0x2b2b2b));
        font.DrawCentered(cell, kNoteTexts[i], kCellW * 0.5f, 64.0f, 62.0f, 460.0f, HexColor(0xc4161c));
        place(index, cell);
    }

    for (size_t i = 0; i < kLandmarkSigns.size(); ++i, ++index) {
        Image cell(kCellW, kCellH, HexColor(kLandmarkSigns[i].background));
        const Rgba ink = IsLight(kLandmarkSigns[i].background) ? HexColor(0x273137) : HexColor(0xffffff);   // los rotulos grises de Colpatria llevan tinta oscura
        font.DrawCentered(cell, kLandmarkSigns[i].title, kCellW * 0.5f, 52.0f, 62.0f, 470.0f, ink);
        font.DrawCentered(cell, kLandmarkSigns[i].sub, kCellW * 0.5f, 100.0f, 28.0f, 470.0f, ink);
        place(index, cell);
    }

    for (size_t i = 0; i < kStreetNames.size(); ++i, ++index) {
        Image cell(kCellW, kCellH, HexColor(0x167a62));   // placa verde azulada de Bogota: borde claro de lamina, filete interior y letras crema
        cell.StrokeRect(0, 0, kCellW, kCellH, 7, HexColor(0xd9d5c8));
        cell.StrokeRect(14, 14, kCellW - 28, kCellH - 28, 3, HexColor(0xeee9dc));
        font.DrawCentered(cell, kStreetNames[i], kCellW * 0.5f, 66.0f, 66.0f, 440.0f, HexColor(0xf3eee2));
        place(index, cell);
    }

    m_Texture = std::make_shared<Texture>(static_cast<uint32_t>(atlas.width), static_cast<uint32_t>(atlas.height), atlas.pixels.data());
    return true;
}

const std::vector<std::string>& SignAtlas::StreetNames() { return kStreetNames; }

SignUV SignAtlas::StreetName(const std::string& name) const {
    for (size_t i = 0; i < kStreetNames.size(); ++i)
        if (kStreetNames[i] == name) return StreetName(i);
    return StreetName(size_t{0});
}

SignUV SignAtlas::Cell(size_t index) const {
    const float H = static_cast<float>(kCellH * kCells);
    const float inset = 2.0f; // evita sangrado entre celdas vecinas al filtrar
    SignUV uv;
    uv.min = {inset / kCellW, (static_cast<float>(index) * kCellH + inset) / H};
    uv.max = {1.0f - inset / kCellW, (static_cast<float>(index + 1) * kCellH - inset) / H};
    return uv;
}

} // namespace Bazuko
