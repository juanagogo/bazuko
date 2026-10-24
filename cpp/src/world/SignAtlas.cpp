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
constexpr int kCells = SignAtlas::kShopSigns + SignAtlas::kTags + SignAtlas::kNotes;

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

    m_Texture = std::make_shared<Texture>(static_cast<uint32_t>(atlas.width), static_cast<uint32_t>(atlas.height), atlas.pixels.data());
    return true;
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
