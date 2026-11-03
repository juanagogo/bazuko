#pragma once

#include <array>
#include <memory>
#include <vector>
#include <glm/glm.hpp>

namespace Bazuko {

class CityLayout;
class Mesh;
class Renderer;
class Texture;

// Calcomanias: manchas de aceite, grietas y mugre en el suelo, y grafitis y afiches en las paredes y los postes. Son cuadrados con una
// textura generada en codigo (con transparencia) que se apoyan unos milimetros sobre la superficie: no duplican la geometria de la ciudad.
// Su posicion sale de un hash de cada baldosa, edificio o poste, asi que son siempre las mismas.
class Decals {
public:
    Decals();
    ~Decals();
    // `lampPositions`: pie de cada farola (los afiches se pegan en sus postes)
    void Build(const CityLayout& city, const std::vector<glm::vec3>& lampPositions);
    // Dibuja las que estan a menos de `maxDistance` metros del foco
    void Render(Renderer& renderer, const glm::vec3& focus, float maxDistance) const;
    size_t Count() const { return m_Decals.size(); }
    size_t CountWall() const;

private:
    enum Kind { Oil = 0, Crack, Dirt, GraffitiFirst, GraffitiLast = GraffitiFirst + 3, PosterFirst, PosterLast = PosterFirst + 3, KindCount };
    struct Decal {
        glm::vec3 position{0.0f};
        glm::mat4 model{1.0f};
        int kind = 0;
        float strength = 1.0f;
        bool wall = false;
    };
    std::vector<Decal> m_Decals;
    std::shared_ptr<Mesh> m_Quad;
    std::array<std::shared_ptr<Texture>, KindCount> m_Textures;
};

} // namespace Bazuko
