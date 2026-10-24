#pragma once
#include <string>
#include <string_view>
#include <cstdint>
#include <cstddef>
#include <memory>
#include <glad/gl.h>

namespace Bazuko {

class Texture {
public:
    Texture(const std::string& filepath, bool flipY = true);
    Texture(uint32_t width, uint32_t height, const uint8_t* rgbaData);
    ~Texture();

    Texture(const Texture&) = delete;
    Texture& operator=(const Texture&) = delete;
    Texture(Texture&& other) noexcept;
    Texture& operator=(Texture&& other) noexcept;

    void BindUnit(uint32_t unit = 0) const;

    GLuint GetID() const { return m_ID; }
    uint32_t GetWidth() const { return m_Width; }
    uint32_t GetHeight() const { return m_Height; }

    static std::shared_ptr<Texture> GetDefaultWhite();
    static std::shared_ptr<Texture> LoadFromMemory(const uint8_t* data, size_t size, const std::string& mimeType);
    // Carga con cache por ruta (las texturas de glTF no se voltean: su origen de UV es arriba-izquierda).
    static std::shared_ptr<Texture> LoadCached(const std::string& filepath, bool flipY = false);

private:
    void InitFromRGBA(uint32_t width, uint32_t height, const uint8_t* data);

    GLuint m_ID = 0;
    uint32_t m_Width = 0;
    uint32_t m_Height = 0;
};

} // namespace Bazuko
