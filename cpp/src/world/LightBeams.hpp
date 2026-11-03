#pragma once

#include <cmath>
#include <memory>
#include <vector>
#include <glm/glm.hpp>
#include <glm/gtc/matrix_transform.hpp>
#include "../renderer/Mesh.hpp"
#include "../renderer/Renderer.hpp"

namespace Bazuko {

// Conos de luz de los faros: con niebla, llovizna o bruma el haz se ve en el aire. Es un cono translucido sin iluminacion (el vertice del foco es
// opaco y la base se desvanece) que se dibuja con mezcla alfa; su intensidad sigue a la humedad del aire y a la oscuridad.
class LightBeams {
public:
    struct Beam {
        glm::vec3 position{0.0f};    // foco del haz
        glm::vec3 direction{0.0f, 0.0f, 1.0f};
        float length = 14.0f;
        float radius = 3.6f;
    };

    LightBeams() {
        constexpr int kSegments = 18;
        std::vector<Vertex> vertices;
        std::vector<uint32_t> indices;
        Vertex apex;
        apex.position = {0.0f, 0.0f, 0.0f};
        apex.normal = {0.0f, 1.0f, 0.0f};
        apex.color = {1.0f, 0.94f, 0.80f, 0.85f};
        vertices.push_back(apex);
        for (int i = 0; i < kSegments; ++i) {
            const float angle = static_cast<float>(i) / static_cast<float>(kSegments) * 6.2831853f;
            Vertex rim;
            rim.position = {std::cos(angle), std::sin(angle), 1.0f};
            rim.normal = {0.0f, 1.0f, 0.0f};
            rim.color = {1.0f, 0.94f, 0.80f, 0.0f};
            vertices.push_back(rim);
        }
        for (int i = 0; i < kSegments; ++i) {
            indices.push_back(0);
            indices.push_back(static_cast<uint32_t>(1 + i));
            indices.push_back(static_cast<uint32_t>(1 + (i + 1) % kSegments));
        }
        m_Cone = std::make_shared<Mesh>(vertices, indices);
    }

    // `visibility` 0..1: cuanto se ve el haz (aire humedo y poca luz)
    void Render(Renderer& renderer, const std::vector<Beam>& beams, float visibility) const {
        if (visibility < 0.04f || beams.empty()) return;
        renderer.SetUnlit(true);
        for (const Beam& beam : beams) {
            const float yaw = std::atan2(beam.direction.x, beam.direction.z);
            glm::mat4 model = glm::translate(glm::mat4(1.0f), beam.position);
            model = glm::rotate(model, yaw, glm::vec3(0.0f, 1.0f, 0.0f));
            model = glm::rotate(model, 0.07f, glm::vec3(1.0f, 0.0f, 0.0f));   // cae un poco hacia la calle
            model = glm::scale(model, glm::vec3(beam.radius, beam.radius, beam.length));
            renderer.Submit(*m_Cone, model, glm::vec4(1.0f, 1.0f, 1.0f, 0.55f * visibility), false, true, nullptr, 2, 0.0f);
        }
        renderer.SetUnlit(false);
    }

private:
    std::shared_ptr<Mesh> m_Cone;
};

} // namespace Bazuko
