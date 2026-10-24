#include "TextRaster.hpp"
#include "../core/Log.hpp"

#include <algorithm>
#include <cmath>
#include <fstream>
#include <iterator>

// stb_truetype viene con Dear ImGui (imstb_truetype.h); se compila aqui como copia privada.
#define STBTT_STATIC
#define STB_TRUETYPE_IMPLEMENTATION
#include <imstb_truetype.h>

namespace Bazuko {

Image::Image(int w, int h, Rgba fill) : width(w), height(h), pixels(static_cast<size_t>(w) * static_cast<size_t>(h) * 4) {
    for (size_t i = 0; i < pixels.size(); i += 4) {
        pixels[i] = fill.r; pixels[i + 1] = fill.g; pixels[i + 2] = fill.b; pixels[i + 3] = fill.a;
    }
}

void Image::FillRect(int x, int y, int w, int h, Rgba c) {
    for (int yy = std::max(0, y); yy < std::min(height, y + h); ++yy) {
        for (int xx = std::max(0, x); xx < std::min(width, x + w); ++xx) {
            uint8_t* p = &pixels[(static_cast<size_t>(yy) * static_cast<size_t>(width) + static_cast<size_t>(xx)) * 4];
            p[0] = c.r; p[1] = c.g; p[2] = c.b; p[3] = c.a;
        }
    }
}

void Image::StrokeRect(int x, int y, int w, int h, int t, Rgba c) {
    FillRect(x, y, w, t, c);
    FillRect(x, y + h - t, w, t, c);
    FillRect(x, y, t, h, c);
    FillRect(x + w - t, y, t, h, c);
}

struct FontRaster::Impl {
    stbtt_fontinfo info{};
};

bool FontRaster::Load(const std::filesystem::path& ttf) {
    std::ifstream in(ttf, std::ios::binary);
    if (!in) {
        LogWarn("No se encontro la fuente de los rotulos: {}", ttf.string());
        return false;
    }
    m_Data.assign(std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>());
    m_Impl = std::make_shared<Impl>();
    if (!stbtt_InitFont(&m_Impl->info, m_Data.data(), stbtt_GetFontOffsetForIndex(m_Data.data(), 0))) {
        LogError("Fuente TrueType invalida: {}", ttf.string());
        m_Data.clear();
        return false;
    }
    return true;
}

namespace {

std::vector<int> DecodeUtf8(const std::string& s) {
    std::vector<int> out;
    for (size_t i = 0; i < s.size();) {
        const unsigned char c = static_cast<unsigned char>(s[i]);
        int cp = c, len = 1;
        if (c >= 0xF0) { cp = c & 0x07; len = 4; }
        else if (c >= 0xE0) { cp = c & 0x0F; len = 3; }
        else if (c >= 0xC0) { cp = c & 0x1F; len = 2; }
        for (int k = 1; k < len && i + static_cast<size_t>(k) < s.size(); ++k) {
            cp = (cp << 6) | (static_cast<unsigned char>(s[i + static_cast<size_t>(k)]) & 0x3F);
        }
        out.push_back(cp);
        i += static_cast<size_t>(len);
    }
    return out;
}

} // namespace

float FontRaster::Measure(const std::string& utf8, float pixelHeight) const {
    if (!Loaded()) return 0.0f;
    const stbtt_fontinfo& f = m_Impl->info;
    const float scale = stbtt_ScaleForPixelHeight(&f, pixelHeight);
    const auto cps = DecodeUtf8(utf8);
    float width = 0.0f;
    for (size_t i = 0; i < cps.size(); ++i) {
        int adv = 0, lsb = 0;
        stbtt_GetCodepointHMetrics(&f, cps[i], &adv, &lsb);
        width += static_cast<float>(adv) * scale;
        if (i + 1 < cps.size()) width += static_cast<float>(stbtt_GetCodepointKernAdvance(&f, cps[i], cps[i + 1])) * scale;
    }
    return width;
}

void FontRaster::DrawCentered(Image& image, const std::string& utf8, float cx, float cy, float pixelHeight, float maxWidth,
                              Rgba color, Rgba outlineColor, int outline) const {
    if (!Loaded() || utf8.empty()) return;
    const stbtt_fontinfo& f = m_Impl->info;

    float px = pixelHeight;
    const float natural = Measure(utf8, px);
    if (maxWidth > 0.0f && natural > maxWidth) px *= maxWidth / natural;
    const float scale = stbtt_ScaleForPixelHeight(&f, px);
    const float width = Measure(utf8, px);

    int ascent = 0, descent = 0, gap = 0;
    stbtt_GetFontVMetrics(&f, &ascent, &descent, &gap);
    // linea base para centrar verticalmente el cuerpo de las mayusculas
    const float capHeight = static_cast<float>(ascent) * scale * 0.72f;
    const float baseline = cy + capHeight * 0.5f;

    const auto cps = DecodeUtf8(utf8);
    float penX = cx - width * 0.5f;

    auto blend = [&](int x, int y, Rgba c, uint8_t cov) {
        if (x < 0 || y < 0 || x >= image.width || y >= image.height || cov == 0) return;
        uint8_t* p = &image.pixels[(static_cast<size_t>(y) * static_cast<size_t>(image.width) + static_cast<size_t>(x)) * 4];
        const float a = static_cast<float>(cov) / 255.0f * static_cast<float>(c.a) / 255.0f;
        const float dstA = static_cast<float>(p[3]) / 255.0f;
        const float outA = a + dstA * (1.0f - a);
        if (outA <= 0.0f) return;
        p[0] = static_cast<uint8_t>((static_cast<float>(c.r) * a + static_cast<float>(p[0]) * dstA * (1.0f - a)) / outA);
        p[1] = static_cast<uint8_t>((static_cast<float>(c.g) * a + static_cast<float>(p[1]) * dstA * (1.0f - a)) / outA);
        p[2] = static_cast<uint8_t>((static_cast<float>(c.b) * a + static_cast<float>(p[2]) * dstA * (1.0f - a)) / outA);
        p[3] = static_cast<uint8_t>(outA * 255.0f + 0.5f);
    };

    for (int pass = (outline > 0 ? 0 : 1); pass < 2; ++pass) {
        float x = penX;
        for (size_t i = 0; i < cps.size(); ++i) {
            int x0, y0, x1, y1;
            stbtt_GetCodepointBitmapBox(&f, cps[i], scale, scale, &x0, &y0, &x1, &y1);
            const int gw = x1 - x0, gh = y1 - y0;
            if (gw > 0 && gh > 0) {
                std::vector<uint8_t> bmp(static_cast<size_t>(gw) * static_cast<size_t>(gh));
                stbtt_MakeCodepointBitmap(&f, bmp.data(), gw, gh, gw, scale, scale, cps[i]);
                const int gx = static_cast<int>(std::lround(x)) + x0;
                const int gy = static_cast<int>(std::lround(baseline)) + y0;
                for (int yy = 0; yy < gh; ++yy) {
                    for (int xx = 0; xx < gw; ++xx) {
                        const uint8_t cov = bmp[static_cast<size_t>(yy) * static_cast<size_t>(gw) + static_cast<size_t>(xx)];
                        if (!cov) continue;
                        if (pass == 0) {
                            for (int oy = -outline; oy <= outline; ++oy)
                                for (int ox = -outline; ox <= outline; ++ox)
                                    if (ox * ox + oy * oy <= outline * outline) blend(gx + xx + ox, gy + yy + oy, outlineColor, cov);
                        } else {
                            blend(gx + xx, gy + yy, color, cov);
                        }
                    }
                }
            }
            int adv = 0, lsb = 0;
            stbtt_GetCodepointHMetrics(&f, cps[i], &adv, &lsb);
            x += static_cast<float>(adv) * scale;
            if (i + 1 < cps.size()) x += static_cast<float>(stbtt_GetCodepointKernAdvance(&f, cps[i], cps[i + 1])) * scale;
        }
    }
}

} // namespace Bazuko
