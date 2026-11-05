#include "Texture.hpp"
#include "../core/Log.hpp"

#define STB_IMAGE_IMPLEMENTATION
#include <stb_image.h>
#include <webp/decode.h>

#include <fstream>
#include <vector>
#include <utility>
#include <algorithm>
#include <limits>
#include <unordered_map>

namespace Bazuko {

Texture::Texture(const std::string& filepath, bool flipY) {
    bool isWebp = (filepath.length() >= 5 && filepath.substr(filepath.length() - 5) == ".webp");

    uint8_t* rgba = nullptr;
    int w = 0, h = 0;

    if (isWebp) {
        std::ifstream file(filepath, std::ios::binary | std::ios::ate);
        if (file.is_open()) {
            std::streamsize size = file.tellg();
            file.seekg(0, std::ios::beg);
            std::vector<uint8_t> buffer(size);
            if (file.read(reinterpret_cast<char*>(buffer.data()), size)) {
                rgba = WebPDecodeRGBA(buffer.data(), buffer.size(), &w, &h);
            }
        }
    } else {
        int channels = 0;
        stbi_set_flip_vertically_on_load(flipY ? 1 : 0);
        rgba = stbi_load(filepath.c_str(), &w, &h, &channels, 4);
    }

    if (!rgba) {
        LogError("No se pudo cargar textura: {}", filepath);
        // Fallback a textura blanca 1x1
        uint32_t white = 0xFFFFFFFF;
        InitFromRGBA(1, 1, reinterpret_cast<const uint8_t*>(&white));
        return;
    }

    m_Width = static_cast<uint32_t>(w);
    m_Height = static_cast<uint32_t>(h);

    InitFromRGBA(m_Width, m_Height, rgba);

    if (isWebp) {
        WebPFree(rgba);
    } else {
        stbi_image_free(rgba);
    }
}

Texture::Texture(uint32_t width, uint32_t height, const uint8_t* rgbaData) {
    InitFromRGBA(width, height, rgbaData);
}

std::shared_ptr<Texture> Texture::LoadFromMemory(const uint8_t* data, size_t size, const std::string& mimeType) {
    if (!data || size == 0) {
        LogError("No se pudo cargar una textura glTF embebida vacia.");
        return nullptr;
    }

    int width = 0;
    int height = 0;
    uint8_t* rgba = nullptr;
    const bool isWebp = mimeType == "image/webp";
    if (isWebp) {
        rgba = WebPDecodeRGBA(data, size, &width, &height);
    } else if (size <= static_cast<size_t>(std::numeric_limits<int>::max())) {
        int channels = 0;
        stbi_set_flip_vertically_on_load(0);
        rgba = stbi_load_from_memory(data, static_cast<int>(size), &width, &height, &channels, 4);
    }
    if (!rgba || width <= 0 || height <= 0) {
        if (rgba) {
            if (isWebp) WebPFree(rgba);
            else stbi_image_free(rgba);
        }
        if (mimeType.find("exr") != std::string::npos) {   // el formato EXR (HDR) no lo lee stb: el material queda con su color base y no vale un error por textura
            static bool warned = false;
            if (!warned) { warned = true; LogWarn("Texturas EXR embebidas (por ejemplo en mascota.fbx) no soportadas: esos materiales usan su color base."); }
        } else {
            LogError("No se pudo decodificar una textura glTF embebida ({}).", mimeType);
        }
        return nullptr;
    }

    auto texture = std::make_shared<Texture>(static_cast<uint32_t>(width), static_cast<uint32_t>(height), rgba);
    if (isWebp) WebPFree(rgba);
    else stbi_image_free(rgba);
    return texture;
}

Texture::~Texture() {
    if (m_ID != 0) {
        glDeleteTextures(1, &m_ID);
    }
}

Texture::Texture(Texture&& other) noexcept
    : m_ID(other.m_ID), m_HasTransparency(other.m_HasTransparency), m_Width(other.m_Width), m_Height(other.m_Height) {
    other.m_ID = 0;
    other.m_Width = 0;
    other.m_Height = 0;
}

Texture& Texture::operator=(Texture&& other) noexcept {
    if (this != &other) {
        if (m_ID != 0) glDeleteTextures(1, &m_ID);
        m_ID = other.m_ID;
        m_HasTransparency = other.m_HasTransparency;
        m_Width = other.m_Width;
        m_Height = other.m_Height;
        other.m_ID = 0;
        other.m_Width = 0;
        other.m_Height = 0;
    }
    return *this;
}

// Texturas recortadas por transparencia (hojas, pasto): el mipmap automatico mezcla el color de los texeles transparentes (casi siempre claro o negro)
// con el de la hoja y reparte el alfa, de modo que a distancia las copas se ven lavadas, borrosas y mas ralas. Aqui el color se promedia ponderado por el
// alfa, el color del borde se extiende hacia los texeles transparentes y el alfa de cada nivel se escala para conservar la cobertura del original.
void Texture::UploadCutoutMipmaps(const uint8_t* data, uint32_t levels) {
    constexpr float kCutoff = 0.4f;   // el mismo umbral del recorte en el material
    uint32_t width = m_Width, height = m_Height;
    std::vector<uint8_t> current(data, data + static_cast<size_t>(width) * height * 4);
    {   // extiende el color de los bordes hacia lo transparente (evita halos al ampliar y al filtrar)
        std::vector<uint8_t> filled(static_cast<size_t>(width) * height);
        for (size_t i = 0; i < filled.size(); ++i) filled[i] = current[i * 4 + 3] >= 32 ? 1 : 0;
        for (int pass = 0; pass < 6; ++pass) {
            std::vector<uint8_t> nextFilled = filled;
            std::vector<uint8_t> next = current;
            for (uint32_t y = 0; y < height; ++y) for (uint32_t x = 0; x < width; ++x) {
                const size_t index = static_cast<size_t>(y) * width + x;
                if (filled[index]) continue;
                int sum[3] = {0, 0, 0}, count = 0;
                for (int dy = -1; dy <= 1; ++dy) for (int dx = -1; dx <= 1; ++dx) {
                    const int nx = static_cast<int>(x) + dx, ny = static_cast<int>(y) + dy;
                    if (nx < 0 || ny < 0 || nx >= static_cast<int>(width) || ny >= static_cast<int>(height)) continue;
                    const size_t other = static_cast<size_t>(ny) * width + nx;
                    if (!filled[other]) continue;
                    for (int c = 0; c < 3; ++c) sum[c] += current[other * 4 + c];
                    ++count;
                }
                if (count == 0) continue;
                for (int c = 0; c < 3; ++c) next[index * 4 + c] = static_cast<uint8_t>(sum[c] / count);
                nextFilled[index] = 1;
            }
            current.swap(next);
            filled.swap(nextFilled);
        }
    }
    auto coverage = [&](const std::vector<uint8_t>& image, float scale) {
        size_t covered = 0;
        for (size_t i = 3; i < image.size(); i += 4) if (std::min(1.0f, image[i] / 255.0f * scale) >= kCutoff) ++covered;
        return static_cast<float>(covered) / static_cast<float>(image.size() / 4);
    };
    const float targetCoverage = coverage(current, 1.0f);
    glTextureSubImage2D(m_ID, 0, 0, 0, width, height, GL_RGBA, GL_UNSIGNED_BYTE, current.data());
    for (uint32_t level = 1; level < levels; ++level) {
        const uint32_t nextWidth = std::max(1u, width / 2), nextHeight = std::max(1u, height / 2);
        std::vector<uint8_t> next(static_cast<size_t>(nextWidth) * nextHeight * 4);
        for (uint32_t y = 0; y < nextHeight; ++y) for (uint32_t x = 0; x < nextWidth; ++x) {
            float color[3] = {0, 0, 0}, alpha = 0.0f, weight = 0.0f;
            for (uint32_t dy = 0; dy < 2; ++dy) for (uint32_t dx = 0; dx < 2; ++dx) {
                const uint32_t sx = std::min(width - 1, x * 2 + dx), sy = std::min(height - 1, y * 2 + dy);
                const uint8_t* texel = &current[(static_cast<size_t>(sy) * width + sx) * 4];
                const float a = texel[3] / 255.0f;
                for (int c = 0; c < 3; ++c) color[c] += texel[c] * (a + 0.004f);
                weight += a + 0.004f;
                alpha += a;
            }
            uint8_t* out = &next[(static_cast<size_t>(y) * nextWidth + x) * 4];
            for (int c = 0; c < 3; ++c) out[c] = static_cast<uint8_t>(std::clamp(color[c] / weight, 0.0f, 255.0f));
            out[3] = static_cast<uint8_t>(std::clamp(alpha * 0.25f * 255.0f, 0.0f, 255.0f));
        }
        float low = 1.0f, high = 6.0f;   // escala del alfa que devuelve la cobertura original (busqueda binaria)
        if (coverage(next, 1.0f) < targetCoverage) {
            for (int i = 0; i < 12; ++i) { const float mid = (low + high) * 0.5f; if (coverage(next, mid) < targetCoverage) low = mid; else high = mid; }
            for (size_t i = 3; i < next.size(); i += 4) next[i] = static_cast<uint8_t>(std::min(255.0f, next[i] * high));
        }
        glTextureSubImage2D(m_ID, level, 0, 0, nextWidth, nextHeight, GL_RGBA, GL_UNSIGNED_BYTE, next.data());
        current.swap(next);
        width = nextWidth;
        height = nextHeight;
    }
}

void Texture::InitFromRGBA(uint32_t width, uint32_t height, const uint8_t* data) {
    m_Width = width;
    m_Height = height;

    // OpenGL 4.5 Direct State Access (DSA) para texturas 2D
    uint32_t levels = 1;
    for (uint32_t size = std::max(m_Width, m_Height); size > 1; size >>= 1) ++levels;

    glCreateTextures(GL_TEXTURE_2D, 1, &m_ID);
    glTextureStorage2D(m_ID, static_cast<GLsizei>(levels), GL_RGBA8, m_Width, m_Height);

    if (data) {
        size_t transparent = 0;
        const size_t pixels = static_cast<size_t>(m_Width) * m_Height;
        for (size_t pixel = 0; pixel < pixels; pixel += 7) if (data[pixel * 4 + 3] < 128) ++transparent;
        m_HasTransparency = transparent * 7 > pixels / 100;   // mas del 1 % de pixeles transparentes
        if (m_HasTransparency && levels > 1) {
            UploadCutoutMipmaps(data, levels);
        } else {
            glTextureSubImage2D(m_ID, 0, 0, 0, m_Width, m_Height, GL_RGBA, GL_UNSIGNED_BYTE, data);
            if (levels > 1) glGenerateTextureMipmap(m_ID);
        }
    }

    if (GLAD_GL_EXT_texture_filter_anisotropic) {
        glTextureParameterf(m_ID, GL_TEXTURE_MAX_ANISOTROPY_EXT, 16.0f);
    }
    glTextureParameteri(m_ID, GL_TEXTURE_MIN_FILTER, levels > 1 ? GL_LINEAR_MIPMAP_LINEAR : GL_LINEAR);
    glTextureParameteri(m_ID, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
    glTextureParameteri(m_ID, GL_TEXTURE_WRAP_S, GL_REPEAT);
    glTextureParameteri(m_ID, GL_TEXTURE_WRAP_T, GL_REPEAT);
}

void Texture::BindUnit(uint32_t unit) const {
    if (unit == 0) s_LastBoundUnit0 = m_ID;
    glBindTextureUnit(unit, m_ID);
}

std::shared_ptr<Texture> Texture::LoadCached(const std::string& filepath, bool flipY) {
    static std::unordered_map<std::string, std::shared_ptr<Texture>> s_Cache;
    auto it = s_Cache.find(filepath);
    if (it != s_Cache.end()) return it->second;
    auto tex = std::make_shared<Texture>(filepath, flipY);
    s_Cache[filepath] = tex;
    return tex;
}

std::shared_ptr<Texture> Texture::GetDefaultWhite() {
    static std::shared_ptr<Texture> s_White = nullptr;
    if (!s_White) {
        uint32_t white = 0xFFFFFFFF;
        s_White = std::make_shared<Texture>(1, 1, reinterpret_cast<const uint8_t*>(&white));
    }
    return s_White;
}

} // namespace Bazuko
