#include "Halftone.hpp"
#include "../core/Log.hpp"
#include <webp/decode.h>
#include <algorithm>
#include <cmath>
#include <fstream>
#include <iterator>

namespace Bazuko::Carton {

namespace {

struct Picture {
    int width = 0, height = 0;
    uint8_t* pixels = nullptr;   // RGBA, de WebPDecodeRGBA
    ~Picture() { if (pixels) WebPFree(pixels); }
    bool Load(const std::string& path) {
        std::ifstream file(path, std::ios::binary);
        if (!file) return false;
        const std::vector<uint8_t> bytes((std::istreambuf_iterator<char>(file)), std::istreambuf_iterator<char>());
        pixels = WebPDecodeRGBA(bytes.data(), bytes.size(), &width, &height);
        return pixels != nullptr;
    }
    // media de cuatro puntos del pixel de origen: luminancia 0..1 y alfa 0..1
    void Sample(float u, float v, float& luma, float& alpha) const {
        float sumLuma = 0.0f, sumAlpha = 0.0f;
        for (int k = 0; k < 4; ++k) {
            const float du = (k & 1 ? 0.5f : -0.5f), dv = (k & 2 ? 0.5f : -0.5f);
            const int x = std::clamp(static_cast<int>(u + du), 0, width - 1), y = std::clamp(static_cast<int>(v + dv), 0, height - 1);
            const uint8_t* p = pixels + (static_cast<size_t>(y) * static_cast<size_t>(width) + static_cast<size_t>(x)) * 4;
            sumLuma += (0.299f * p[0] + 0.587f * p[1] + 0.114f * p[2]) / 255.0f;
            sumAlpha += p[3] / 255.0f;
        }
        luma = sumLuma * 0.25f;
        alpha = sumAlpha * 0.25f;
    }
};

float Percentile(std::vector<float>& values, float fraction) {
    if (values.empty()) return 0.0f;
    const size_t index = std::min(values.size() - 1, static_cast<size_t>(fraction * static_cast<float>(values.size())));
    std::nth_element(values.begin(), values.begin() + static_cast<std::ptrdiff_t>(index), values.end());
    return values[index];
}

} // namespace

std::vector<HalftoneDot> BuildHalftone(const std::string& backgroundPath, const std::string& characterPath, float width, float height, float ceiling) {
    Picture background, character;
    if (!background.Load(backgroundPath) || !character.Load(characterPath)) {
        LogWarn("No se pudo leer el arte de carga para el semitono: {}", backgroundPath);
        return {};
    }
    const float cell = std::clamp(std::round(std::sqrt(width * height) / 165.0f), 4.0f, 8.0f);
    const float step = cell / std::sqrt(2.0f);
    const bool portrait = height > width, small = !portrait && (width < 900.0f || height <= 520.0f);
    // fondo: cubre la pantalla sin deformarse
    const float bgScale = std::max(width / static_cast<float>(background.width), height / static_cast<float>(background.height));
    const float bgW = static_cast<float>(background.width) * bgScale, bgH = static_cast<float>(background.height) * bgScale;
    const float bgX = (width - bgW) * (portrait ? 0.62f : 0.5f), bgY = (height - bgH) * 0.5f;
    // personaje: abajo a la derecha, debajo de la palabra
    const float boxH = small ? height * 0.96f : std::max(height * 0.4f, height - ceiling - 8.0f);
    const float boxW = portrait ? width * 1.15f : width * (small ? 0.54f : 0.72f);
    const float chScale = std::min(boxW / static_cast<float>(character.width), boxH / static_cast<float>(character.height));
    const float chW = static_cast<float>(character.width) * chScale, chH = static_cast<float>(character.height) * chScale;
    const float chX = (portrait ? (width - chW) * 0.5f : width - boxW + (boxW - chW)), chY = height - boxH + (boxH - chH);

    const int cols = static_cast<int>(std::ceil(width / step)) + 2, rows = static_cast<int>(std::ceil(height / step)) + 2;
    struct Cell { float x, y, luma; bool isCharacter; };
    std::vector<Cell> cells;
    cells.reserve(static_cast<size_t>(cols) * static_cast<size_t>(rows) / 2);
    std::vector<float> backgroundLuma, characterLuma;
    for (int j = 0; j < rows; ++j) {
        for (int i = 0; i < cols; ++i) {
            if ((i + j) % 2 != 0) continue;
            const float x = static_cast<float>(i) * step, y = static_cast<float>(j) * step;
            float luma = 1.0f, alpha = 0.0f;
            bool isCharacter = false;
            const float cu = (x - chX) / chScale, cv = (y - chY) / chScale;
            if (cu >= 0.0f && cv >= 0.0f && cu < static_cast<float>(character.width) && cv < static_cast<float>(character.height)) {
                character.Sample(cu, cv, luma, alpha);
                isCharacter = alpha >= 0.5f;
            }
            if (!isCharacter) {
                const float bu = (x - bgX) / bgScale, bv = (y - bgY) / bgScale;
                float unusedAlpha = 0.0f;
                if (bu >= 0.0f && bv >= 0.0f && bu < static_cast<float>(background.width) && bv < static_cast<float>(background.height)) background.Sample(bu, bv, luma, unusedAlpha);
                else luma = 1.0f;
            }
            cells.push_back({x, y, luma, isCharacter});
            (isCharacter ? characterLuma : backgroundLuma).push_back(luma);
        }
    }
    // niveles por percentiles de cada capa: el negro cierra y el claro queda sin punto
    const float bgBlack = Percentile(backgroundLuma, 0.08f), bgWhite = Percentile(backgroundLuma, 0.97f);
    const float chBlack = Percentile(characterLuma, 0.05f), chWhite = Percentile(characterLuma, 0.97f);
    std::vector<HalftoneDot> dots;
    dots.reserve(cells.size());
    constexpr float kMax = 0.60f;   // radio maximo de un punto, en celdas
    for (const Cell& c : cells) {
        const float black = c.isCharacter ? chBlack : bgBlack, white = c.isCharacter ? chWhite : bgWhite;
        float tone = std::clamp((c.luma - black) / std::max(0.01f, white - black), 0.0f, 1.0f);
        tone = std::pow(tone, c.isCharacter ? 0.9f : 0.7f);
        float radius = cell * kMax * std::sqrt(1.0f - tone);
        if (!c.isCharacter) radius *= 0.62f;   // el fondo queda mas suave que el personaje
        // zonas reservadas a lo que se escribe encima: la palabra arriba y el texto abajo a la izquierda
        const auto reserved = [&](float left, float top, float right, float bottom, float soft) {
            const float dx = std::max({left - c.x, 0.0f, c.x - right}), dy = std::max({top - c.y, 0.0f, c.y - bottom});
            const float d = std::hypot(dx, dy);
            return d >= soft ? 0.0f : 1.0f - d / soft;
        };
        const float hidden = std::max(reserved(0.0f, 0.0f, width, ceiling, 70.0f), reserved(0.0f, height - 120.0f, width * 0.48f, height, 70.0f));
        radius *= 1.0f - 0.85f * hidden;
        if (radius >= 0.45f) dots.push_back({c.x, c.y, radius});
    }
    return dots;
}

} // namespace Bazuko::Carton
