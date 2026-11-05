#pragma once

#include <algorithm>
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
        // Tres capas anidadas (borde, medio, nucleo) y anillos que se abren con la distancia: el borde queda difuso y el haz se
        // apaga poco a poco hacia el final, como la luz dispersa por el aire. Nada de un cono liso con un borde nitido.
        constexpr int kSegments = 20;
        constexpr int kRings = 7;
        const float ringT[kRings] = {0.0f, 0.06f, 0.16f, 0.32f, 0.52f, 0.76f, 1.0f};
        const float shell[3] = {1.0f, 0.62f, 0.3f};
        const float shellAlpha[3] = {0.16f, 0.30f, 0.50f};
        std::vector<Vertex> vertices;
        std::vector<uint32_t> indices;
        for (int layer = 0; layer < 3; ++layer) {
            const uint32_t base = static_cast<uint32_t>(vertices.size());
            for (int ring = 0; ring < kRings; ++ring) {
                const float t = ringT[ring];
                const float fadeIn = std::clamp(t / 0.14f, 0.0f, 1.0f);
                const float fadeOut = std::pow(1.0f - t, 1.7f);
                const float alpha = shellAlpha[layer] * fadeIn * fadeIn * (3.0f - 2.0f * fadeIn) * fadeOut;
                const float radius = (0.05f + 0.95f * std::pow(t, 0.8f)) * shell[layer];
                for (int i = 0; i < kSegments; ++i) {
                    const float angle = static_cast<float>(i) / static_cast<float>(kSegments) * 6.2831853f;
                    Vertex vertex;
                    vertex.position = {std::cos(angle) * radius, std::sin(angle) * radius, t};
                    vertex.normal = {0.0f, 1.0f, 0.0f};
                    vertex.color = {1.0f, 0.94f, 0.80f, alpha};
                    vertices.push_back(vertex);
                }
            }
            for (int ring = 0; ring + 1 < kRings; ++ring) {
                for (int i = 0; i < kSegments; ++i) {
                    const uint32_t a0 = base + static_cast<uint32_t>(ring * kSegments + i), a1 = base + static_cast<uint32_t>(ring * kSegments + (i + 1) % kSegments);
                    const uint32_t b0 = a0 + kSegments, b1 = a1 + kSegments;
                    indices.insert(indices.end(), {a0, b0, a1, a1, b0, b1});
                }
            }
        }
        m_Cone = std::make_shared<Mesh>(vertices, indices);
    }

    // `visibility` 0..1: cuanto se ve el haz (aire humedo y poca luz)
    void Render(Renderer& renderer, const std::vector<Beam>& beams, float visibility, const glm::vec3& tint = glm::vec3(1.0f)) const {
        if (visibility < 0.04f || beams.empty()) return;
        renderer.SetUnlit(true);
        for (const Beam& beam : beams) {
            const float yaw = std::atan2(beam.direction.x, beam.direction.z);
            glm::mat4 model = glm::translate(glm::mat4(1.0f), beam.position);
            model = glm::rotate(model, yaw, glm::vec3(0.0f, 1.0f, 0.0f));
            model = glm::rotate(model, 0.07f + std::asin(std::clamp(-beam.direction.y, -1.0f, 1.0f)), glm::vec3(1.0f, 0.0f, 0.0f));   // cae un poco hacia la calle; las farolas apuntan hacia abajo
            model = glm::scale(model, glm::vec3(beam.radius, beam.radius * 0.5f, beam.length));   // el haz es mas ancho que alto: se abre hacia los lados
            renderer.Submit(*m_Cone, model, glm::vec4(tint, 0.55f * visibility), false, true, nullptr, 2, 0.0f);
        }
        renderer.SetUnlit(false);
    }

private:
    std::shared_ptr<Mesh> m_Cone;
};

} // namespace Bazuko
