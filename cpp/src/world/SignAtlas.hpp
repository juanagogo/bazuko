#pragma once
#include <filesystem>
#include <memory>
#include <string>
#include <vector>
#include <glm/glm.hpp>
#include "../renderer/Texture.hpp"

namespace Bazuko {

struct SignUV {
    glm::vec2 min{0.0f};
    glm::vec2 max{1.0f};
};

// Atlas de rotulos legibles para las fachadas (equivale a signTexture/lightbox y a los grafitis y
// avisos de cartulina de src/world/bogota/textures.js). Celdas de 512x128:
// 16 rotulos de tiendas, 8 grafitis (fondo transparente) y 8 avisos de cartulina.
class SignAtlas {
public:
    static constexpr int kShopSigns = 16;
    static constexpr int kTags = 8;
    static constexpr int kNotes = 8;
    static constexpr int kLandmarks = 17;   // gasolinera (4), D69, estacion Portal del Centro (2) y torre Colpatria (3)

    // Placas blancas de nomenclatura vial (Calle 10, Carrera 15, Av. Caracas...) y de parques; indices en `StreetNames()`.
    static const std::vector<std::string>& StreetNames();
    SignUV StreetName(size_t i) const { return Cell(kShopSigns + kTags + kNotes + kLandmarks + i); }
    // Celda de la placa con ese texto (la primera si no existe)
    SignUV StreetName(const std::string& name) const;

    // false si no hay fuente: el llamador dibuja los rotulos de color liso como antes.
    bool Build(const std::string& fontPath);

    std::shared_ptr<Texture> GetTexture() const { return m_Texture; }
    SignUV Shop(size_t i) const { return Cell(i % kShopSigns); }
    SignUV Tag(size_t i) const { return Cell(kShopSigns + i % kTags); }
    SignUV Note(size_t i) const { return Cell(kShopSigns + kTags + i % kNotes); }
    SignUV Landmark(size_t i) const { return Cell(kShopSigns + kTags + kNotes + i % kLandmarks); }

private:
    SignUV Cell(size_t index) const;
    std::shared_ptr<Texture> m_Texture;
};

} // namespace Bazuko
