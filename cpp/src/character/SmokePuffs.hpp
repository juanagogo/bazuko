#pragma once
// Humo de un cigarrillo (port de SmokePuffs): un grupo fijo de bocanadas reutilizables, el hilo que sale de la brasa y las que se botan por la boca.
// Viven en el mundo (no en el personaje): el humo se queda atras al caminar. Cada bocanada es un disco que mira a la camara, translucido y que crece.
#include "../renderer/Mesh.hpp"
#include "../renderer/Renderer.hpp"

#include <array>
#include <memory>
#include <glm/glm.hpp>

namespace Bazuko {

class SmokePuffs {
public:
    struct Emit { glm::vec3 position{0.0f}; glm::vec3 velocity{0.0f}; float size = 0.04f, grow = 0.25f, life = 2.5f, alpha = 0.35f; glm::vec3 color{0.85f}; };
    static constexpr size_t kMax = 90;

    SmokePuffs();
    void Emitir(const Emit& e);                          // suelta una bocanada
    void Update(float dt);
    void Draw(Renderer& renderer, const glm::vec3& cameraPosition) const;
    bool Any() const;

private:
    struct Puff { glm::vec3 position{0.0f}, velocity{0.0f}, color{0.85f}; float size = 0.0f, grow = 0.0f, life = 0.0f, age = 0.0f, alpha = 0.0f; bool alive = false; };
    std::array<Puff, kMax> m_Puffs{};
    size_t m_Next = 0;
    std::shared_ptr<Mesh> m_Disc;
    uint32_t m_Seed = 7u;
    float Random();   // -0.5 .. 0.5
};

} // namespace Bazuko
