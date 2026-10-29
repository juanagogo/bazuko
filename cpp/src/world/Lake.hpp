#pragma once
#include <memory>
#include <random>
#include <vector>
#include <glm/glm.hpp>
#include "../renderer/Mesh.hpp"
#include "../renderer/Model.hpp"
#include "../renderer/Renderer.hpp"
#include "../renderer/Texture.hpp"

namespace Bazuko {

// Vida del Parque del Lago: superficie del agua (translucida, con oleaje y color por profundidad), peces que nadan bajo ella
// y las salpicaduras y ondas que deja quien se mete. La orilla y el fondo en cuenco los construye CityLayout.
class Lake {
public:
    Lake();

    // `swimmer`: pies del jugador; `waterDepth`: metros de agua sobre el fondo en ese punto; `swimming`: nada (agua profunda)
    void Update(float dt, float time, const glm::vec3& swimmer, float speed, float waterDepth, bool swimming);
    void DrawFish(Renderer& renderer, float time);      // opaco: se dibuja antes que el agua
    void DrawSurface(Renderer& renderer, float time);   // agua, ondas y gotas (mezcla alfa): al final de la escena

private:
    struct Fish {
        size_t model = 0;
        float angle = 0.0f, angularSpeed = 0.2f, radius = 0.5f, wobble = 0.0f, depth = 0.5f, phase = 0.0f, scale = 1.0f;
        float panic = 0.0f;   // 0..1: huye al nadar alguien cerca
        glm::vec3 position{0.0f};
        float yaw = 0.0f;
    };
    struct Droplet { glm::vec3 position, velocity; float life, size; };
    struct Ripple { glm::vec2 position; float age, maxAge, speed; };
    struct FishKind { std::shared_ptr<Model> model; glm::mat4 correction{1.0f}; };

    void Splash(const glm::vec3& at, int count, float power);
    void BuildSurface();
    void LoadFish();
    glm::vec3 FishPosition(const Fish& fish, float time) const;

    std::shared_ptr<Mesh> m_Surface, m_Drop, m_Ring;
    std::shared_ptr<Texture> m_WaterTexture;
    std::vector<FishKind> m_Kinds;
    std::vector<std::shared_ptr<Model>> m_AnimationSources;
    std::vector<Fish> m_Fish;
    std::vector<Droplet> m_Drops;
    std::vector<Ripple> m_Ripples;
    std::mt19937 m_Random{0x1a60u};
    float m_StrokeTimer = 0.0f;
    bool m_WasInWater = false;
};

} // namespace Bazuko
