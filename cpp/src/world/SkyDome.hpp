#pragma once
// Boveda celeste: esfera que sigue a la camara y se dibuja primero, en el plano lejano. Gradiente de cenit a horizonte, resplandor
// del sol y nubes de ruido que se desplazan con el viento (assets/shaders/sky.*, port del BogotaSkyShader del juego web).
#include <cmath>
#include <memory>
#include <vector>
#include <glm/glm.hpp>
#include "../core/Paths.hpp"
#include "../renderer/Mesh.hpp"
#include "../renderer/Renderer.hpp"
#include "../renderer/Shader.hpp"
#include "Atmosphere.hpp"

namespace Bazuko {

class SkyDome {
public:
    SkyDome() {
        m_Shader = std::make_unique<Shader>(Paths::Find("assets/shaders/sky.vert"), Paths::Find("assets/shaders/sky.frag"));
        constexpr int kRings = 24, kSegments = 48;
        std::vector<Vertex> vertices;
        std::vector<uint32_t> indices;
        for (int ring = 0; ring <= kRings; ++ring) {
            const float polar = 3.14159265f * static_cast<float>(ring) / static_cast<float>(kRings);
            for (int segment = 0; segment <= kSegments; ++segment) {
                const float azimuth = 6.2831853f * static_cast<float>(segment) / static_cast<float>(kSegments);
                const glm::vec3 direction(std::sin(polar) * std::cos(azimuth), std::cos(polar), std::sin(polar) * std::sin(azimuth));
                vertices.push_back({direction, -direction, {0.0f, 0.0f}, {1.0f, 1.0f, 1.0f, 1.0f}});
            }
        }
        for (int ring = 0; ring < kRings; ++ring) {
            for (int segment = 0; segment < kSegments; ++segment) {
                const uint32_t a = static_cast<uint32_t>(ring * (kSegments + 1) + segment), b = a + 1, c = a + static_cast<uint32_t>(kSegments + 1), d = c + 1;
                indices.insert(indices.end(), {a, c, b, b, c, d});
            }
        }
        m_Mesh = std::make_shared<Mesh>(vertices, indices);
    }

    // `wind` 0..1 desplaza las nubes
    void Update(float dt, float wind) {
        m_Offset.x = std::fmod(m_Offset.x + (wind * 0.006f + 0.002f) * dt, 512.0f);
        m_Offset.y = std::fmod(m_Offset.y + (wind * 0.003f + 0.001f) * dt, 512.0f);
    }

    // `octaves` 2..4 segun la calidad grafica
    // moonVisibility 0..1 (sube con la luna sobre el horizonte y con la noche); moonPhase 0 nueva, 0,5 llena
    void Render(Renderer& renderer, const SkyColors& colors, const glm::vec3& sunDirection, const glm::vec3& moonDirection, float moonPhase,
                float moonVisibility, float cloud, float flash, int octaves) {
        m_Shader->Bind();
        m_Shader->SetVec3("uTopColor", colors.top);
        m_Shader->SetVec3("uBottomColor", colors.horizon);
        m_Shader->SetVec3("uSunDirection", glm::normalize(sunDirection));
        m_Shader->SetVec3("uSunGlowColor", colors.sunGlow);
        m_Shader->SetFloat("uSunGlowIntensity", colors.sunGlowIntensity);
        m_Shader->SetFloat("uCloudCover", cloud);
        m_Shader->SetVec2("uCloudOffset", m_Offset);
        m_Shader->SetVec3("uCloudLight", colors.cloudLight);
        m_Shader->SetVec3("uCloudShadow", colors.cloudShadow);
        m_Shader->SetFloat("uOctaves", static_cast<float>(octaves));
        m_Shader->SetFloat("uFlash", flash);
        m_Shader->SetVec3("uMoonDirection", glm::normalize(moonDirection));
        m_Shader->SetFloat("uMoonPhase", moonPhase);
        m_Shader->SetFloat("uMoonVisibility", moonVisibility);
        m_Shader->SetFloat("uSunDisc", colors.sunDisc);
        glDisable(GL_CULL_FACE);
        glDepthMask(GL_FALSE);
        m_Mesh->Draw();
        glDepthMask(GL_TRUE);
        glEnable(GL_CULL_FACE);
        renderer.GetDefaultShader().Bind();
    }

private:
    std::unique_ptr<Shader> m_Shader;
    std::shared_ptr<Mesh> m_Mesh;
    glm::vec2 m_Offset{0.0f};
};

} // namespace Bazuko
