#pragma once
#include <cstdint>
#include <filesystem>
#include <memory>
#include <string>
#include <vector>

namespace Bazuko {

struct Rgba {
    uint8_t r = 0, g = 0, b = 0, a = 255;
};

constexpr Rgba HexColor(uint32_t rgb, uint8_t alpha = 255) {
    return {static_cast<uint8_t>((rgb >> 16) & 0xFF), static_cast<uint8_t>((rgb >> 8) & 0xFF), static_cast<uint8_t>(rgb & 0xFF), alpha};
}

// Imagen RGBA en CPU (fila 0 = arriba).
struct Image {
    int width = 0, height = 0;
    std::vector<uint8_t> pixels;

    Image(int w, int h, Rgba fill = {0, 0, 0, 0});
    void FillRect(int x, int y, int w, int h, Rgba color);
    void StrokeRect(int x, int y, int w, int h, int thickness, Rgba color);
};

// Dibuja texto TrueType (UTF-8) sobre una Image, sin depender del sistema ni de la interfaz.
class FontRaster {
public:
    bool Load(const std::filesystem::path& ttf);
    bool Loaded() const { return !m_Data.empty(); }

    float Measure(const std::string& utf8, float pixelHeight) const;

    // Texto centrado en (cx, cy). Si no cabe en maxWidth se reduce. `outline` > 0 dibuja un borde.
    void DrawCentered(Image& image, const std::string& utf8, float cx, float cy, float pixelHeight, float maxWidth,
                      Rgba color, Rgba outlineColor = {0, 0, 0, 255}, int outline = 0) const;

private:
    std::vector<uint8_t> m_Data;
    struct Impl;
    std::shared_ptr<Impl> m_Impl;
};

} // namespace Bazuko
