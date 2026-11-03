#pragma once
// Campo de estrellas del cielo nocturno: cuadritos fijos sobre una semiesfera que sigue a la camara. Se dibujan sin
// iluminacion ni niebla (modo "cielo" del renderer) y solo se ven al oscurecer y con el cielo despejado.
#include <algorithm>
#include <cmath>
#include <memory>
#include <random>
#include <vector>
#include <glm/glm.hpp>
#include <glm/gtc/matrix_transform.hpp>
#include "../renderer/Mesh.hpp"
#include "../renderer/Renderer.hpp"
#include "Atmosphere.hpp"

namespace Bazuko {

class StarField {
public:
    static constexpr float kRadius = 380.0f;   // dentro del plano lejano de la camara (500 m)

    explicit StarField(size_t count = 700, unsigned seed = 11) {
        std::mt19937 random(seed);
        std::uniform_real_distribution<float> unit(0.0f, 1.0f);
        std::vector<Vertex> vertices;
        std::vector<uint32_t> indices;
        vertices.reserve(count * 4);
        indices.reserve(count * 6);
        for (size_t star = 0; star < count; ++star) {
            // direccion uniforme sobre la semiesfera, sin la franja pegada al horizonte
            const float sinElevation = 0.06f + 0.94f * unit(random);
            const float cosElevation = std::sqrt(1.0f - sinElevation * sinElevation);
            const float azimuth = unit(random) * 6.2831853f;
            const glm::vec3 direction(cosElevation * std::cos(azimuth), sinElevation, cosElevation * std::sin(azimuth));
            const glm::vec3 right = glm::normalize(glm::cross(glm::vec3(0.0f, 1.0f, 0.0f), direction));
            const glm::vec3 up = glm::cross(direction, right);
            const float brightness = 0.35f + 0.65f * unit(random) * unit(random) + 0.2f * unit(random);
            const float size = 0.5f + 1.1f * std::pow(unit(random), 3.0f);   // la mayoria son puntos finos
            const float tint = unit(random);   // blancas, azuladas y algunas calidas
            const glm::vec3 color = tint < 0.55f ? glm::vec3(0.95f, 0.97f, 1.0f)
                : tint < 0.85f ? glm::vec3(0.72f, 0.82f, 1.0f) : glm::vec3(1.0f, 0.9f, 0.72f);
            const glm::vec3 center = direction * kRadius;
            const glm::vec4 rgba(color, std::clamp(brightness, 0.0f, 1.0f));
            const uint32_t base = static_cast<uint32_t>(vertices.size());
            for (const glm::vec2 corner : {glm::vec2(-1, -1), glm::vec2(1, -1), glm::vec2(1, 1), glm::vec2(-1, 1)})
                vertices.push_back({center + (right * corner.x + up * corner.y) * size * 0.5f, -direction, (corner + 1.0f) * 0.5f, rgba});
            indices.insert(indices.end(), {base, base + 1, base + 2, base + 2, base + 3, base});
        }
        m_Mesh = std::make_shared<Mesh>(vertices, indices);
        // disco unitario (32 lados) para el sol y la luna; mira a +Z
        std::vector<Vertex> disc;
        std::vector<uint32_t> discIndices;
        disc.push_back({{0.0f, 0.0f, 0.0f}, {0.0f, 0.0f, 1.0f}, {0.5f, 0.5f}, {1.0f, 1.0f, 1.0f, 1.0f}});
        for (int i = 0; i <= 32; ++i) {
            const float angle = static_cast<float>(i) / 32.0f * 6.2831853f;
            disc.push_back({{std::cos(angle), std::sin(angle), 0.0f}, {0.0f, 0.0f, 1.0f}, {0.5f, 0.5f}, {1.0f, 1.0f, 1.0f, 1.0f}});
            if (i > 0) discIndices.insert(discIndices.end(), {0u, static_cast<uint32_t>(i), static_cast<uint32_t>(i + 1)});
        }
        m_Disc = std::make_shared<Mesh>(disc, discIndices);
    }

    // Sol y luna sobre la boveda: direcciones hacia cada astro; `clear` 0..1 = cielo despejado; `night` 0..1 = oscuridad
    // La luna brilla segun su fase (fraccion iluminada) y se ve tenue de dia; el sol solo sobre el horizonte.
    void RenderCelestial(Renderer& renderer, const glm::vec3& cameraPosition, const glm::vec3& sunDirection,
                         const glm::vec3& moonDirection, float moonIllumination, float clear, float night) const {
        if (!m_Disc) return;
        const auto draw = [&](const glm::vec3& direction, float radius, const glm::vec4& color) {
            if (color.a <= 0.01f) return;
            const glm::vec3 forward = -glm::normalize(direction);   // el disco mira a la camara
            const glm::vec3 right = glm::normalize(glm::cross(glm::vec3(0.0f, 1.0f, 0.0f), forward));
            const glm::vec3 up = glm::cross(forward, right);
            glm::mat4 basis(1.0f);
            basis[0] = glm::vec4(right * radius, 0.0f);
            basis[1] = glm::vec4(up * radius, 0.0f);
            basis[2] = glm::vec4(forward, 0.0f);
            basis[3] = glm::vec4(cameraPosition + glm::normalize(direction) * (kRadius * 0.96f), 1.0f);
            renderer.Submit(*m_Disc, basis, color, false, true, nullptr, 2);
        };
        renderer.SetSky(true);
        const float sunAbove = AtmosphereSmoothstep(-0.02f, 0.12f, sunDirection.y);
        const float sunAlpha = sunAbove * (0.25f + 0.75f * clear);
        draw(sunDirection, 30.0f, glm::vec4(1.0f, 0.86f, 0.55f, 0.18f * sunAlpha));   // halo
        draw(sunDirection, 15.0f, glm::vec4(1.0f, 0.97f, 0.85f, sunAlpha));
        const float moonAbove = AtmosphereSmoothstep(-0.02f, 0.10f, moonDirection.y);
        const float moonAlpha = moonAbove * clear * (0.25f + 0.75f * night) * (0.25f + 0.75f * moonIllumination);
        draw(moonDirection, 22.0f, glm::vec4(0.7f, 0.8f, 1.0f, 0.12f * moonAlpha));    // halo
        draw(moonDirection, 11.0f, glm::vec4(0.93f, 0.95f, 1.0f, moonAlpha));
        renderer.SetSky(false);
    }

    // visibility 0..1: 0 de dia o con cielo cubierto, 1 en una noche despejada
    void Render(Renderer& renderer, const glm::vec3& cameraPosition, float visibility, float time) const {
        if (visibility <= 0.01f || !m_Mesh) return;
        // titilar muy suave para que el cielo no se vea congelado
        const float twinkle = 0.93f + 0.07f * std::sin(time * 1.7f);
        renderer.SetSky(true);
        renderer.Submit(*m_Mesh, glm::translate(glm::mat4(1.0f), cameraPosition), glm::vec4(1.0f, 1.0f, 1.0f, visibility * twinkle),
                        false, true, nullptr, 2);
        renderer.SetSky(false);
    }

private:
    std::shared_ptr<Mesh> m_Mesh;
    std::shared_ptr<Mesh> m_Disc;
};

} // namespace Bazuko
