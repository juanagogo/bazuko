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
        LogError("No se pudo decodificar una textura glTF embebida ({}).", mimeType);
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
    : m_ID(other.m_ID), m_Width(other.m_Width), m_Height(other.m_Height) {
    other.m_ID = 0;
    other.m_Width = 0;
    other.m_Height = 0;
}

Texture& Texture::operator=(Texture&& other) noexcept {
    if (this != &other) {
        if (m_ID != 0) glDeleteTextures(1, &m_ID);
        m_ID = other.m_ID;
        m_Width = other.m_Width;
        m_Height = other.m_Height;
        other.m_ID = 0;
        other.m_Width = 0;
        other.m_Height = 0;
    }
    return *this;
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
        glTextureSubImage2D(m_ID, 0, 0, 0, m_Width, m_Height, GL_RGBA, GL_UNSIGNED_BYTE, data);
        if (levels > 1) glGenerateTextureMipmap(m_ID);
    }

    if (GLAD_GL_EXT_texture_filter_anisotropic) {
        glTextureParameterf(m_ID, GL_TEXTURE_MAX_ANISOTROPY_EXT, 8.0f);
    }
    glTextureParameteri(m_ID, GL_TEXTURE_MIN_FILTER, levels > 1 ? GL_LINEAR_MIPMAP_LINEAR : GL_LINEAR);
    glTextureParameteri(m_ID, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
    glTextureParameteri(m_ID, GL_TEXTURE_WRAP_S, GL_REPEAT);
    glTextureParameteri(m_ID, GL_TEXTURE_WRAP_T, GL_REPEAT);
}

void Texture::BindUnit(uint32_t unit) const {
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
