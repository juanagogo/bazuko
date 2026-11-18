#include "SmokePuffs.hpp"

#include <algorithm>
#include <cmath>
#include <glm/gtc/matrix_transform.hpp>

namespace Bazuko {

SmokePuffs::SmokePuffs() {
    m_Disc = Mesh::CreateCylinder(1.0f, 0.002f, 16, glm::vec4(1.0f));   // un disco plano de radio 1 (eje Y): se orienta hacia la camara
}

float SmokePuffs::Random() {
    m_Seed = m_Seed * 1664525u + 1013904223u;
    return static_cast<float>((m_Seed >> 8) & 0xFFFFu) / 65535.0f - 0.5f;
}

void SmokePuffs::Emitir(const Emit& e) {
    Puff& p = m_Puffs[m_Next];
    m_Next = (m_Next + 1) % m_Puffs.size();
    p.position = e.position;
    p.velocity = glm::vec3(Random() * 0.06f, 0.18f + (Random() + 0.5f) * 0.08f, Random() * 0.06f) + e.velocity;   // sube con un poco de deriva
    p.size = e.size; p.grow = e.grow; p.life = e.life; p.age = 0.0f; p.alpha = e.alpha; p.color = e.color; p.alive = true;
}

void SmokePuffs::Update(float dt) {
    for (Puff& p : m_Puffs) {
        if (!p.alive) continue;
        p.age += dt;
        if (p.age >= p.life) { p.alive = false; continue; }
        p.velocity *= std::exp(-1.2f * dt);   // el aire frena la bocanada
        p.velocity.y += 0.05f * dt;           // y el humo caliente sube
        p.position += p.velocity * dt;
    }
}

bool SmokePuffs::Any() const {
    return std::any_of(m_Puffs.begin(), m_Puffs.end(), [](const Puff& p) { return p.alive; });
}

void SmokePuffs::Draw(Renderer& renderer, const glm::vec3& cameraPosition) const {
    for (const Puff& p : m_Puffs) {
        if (!p.alive) continue;
        const float k = p.age / p.life;
        const float radius = (p.size + p.grow * k) * 0.5f;
        const float alpha = p.alpha * (1.0f - k) * std::min(1.0f, p.age * 6.0f);
        if (alpha < 0.004f) continue;
        // el eje Y del disco apunta a la camara
        const glm::vec3 toCamera = glm::normalize(cameraPosition - p.position);
        const glm::vec3 side = glm::normalize(glm::cross(std::abs(toCamera.y) > 0.95f ? glm::vec3(1.0f, 0.0f, 0.0f) : glm::vec3(0.0f, 1.0f, 0.0f), toCamera));
        const glm::vec3 up = glm::cross(toCamera, side);
        // el sprite del original es un degradado radial (opaco al centro, nada al borde): tres discos concentricos lo aproximan
        static constexpr float kRadius[3] = {1.0f, 0.68f, 0.38f}, kShare[3] = {0.22f, 0.33f, 0.45f};
        for (int layer = 0; layer < 3; ++layer) {
            glm::mat4 model(1.0f);
            model[0] = glm::vec4(side * radius * kRadius[layer], 0.0f);
            model[1] = glm::vec4(up * radius * kRadius[layer], 0.0f);
            model[2] = glm::vec4(toCamera * (1.0f + 0.5f * static_cast<float>(layer)), 0.0f);
            model[3] = glm::vec4(p.position + toCamera * (0.0005f * static_cast<float>(layer)), 1.0f);
            renderer.Submit(*m_Disc, model, glm::vec4(p.color, alpha * kShare[layer] * 0.95f), false, true, nullptr, 2);
        }
    }
}

} // namespace Bazuko
