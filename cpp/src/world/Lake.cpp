#include "Lake.hpp"
#include <algorithm>
#include <cmath>
#include <filesystem>
#include <glm/gtc/matrix_transform.hpp>
#include "CityLayout.hpp"
#include "../core/Log.hpp"
#include "../core/Paths.hpp"

namespace Bazuko {

namespace {
constexpr float kPi = 3.14159265f;

float Random01(std::mt19937& random) { return static_cast<float>(random() & 0xFFFFFF) / static_cast<float>(0x1000000); }

// Anillo plano de radio 1 (se escala al dibujarlo)
std::shared_ptr<Mesh> MakeRing(float inner, float outer) {
    constexpr int kSegments = 40;
    std::vector<Vertex> vertices;
    std::vector<uint32_t> indices;
    for (int i = 0; i < kSegments; ++i) {
        const float a = 2.0f * kPi * static_cast<float>(i) / static_cast<float>(kSegments);
        const float c = std::cos(a), s = std::sin(a);
        vertices.push_back({{c * inner, 0.0f, s * inner}, {0.0f, 1.0f, 0.0f}, {0.0f, 0.0f}, {1.0f, 1.0f, 1.0f, 1.0f}});
        vertices.push_back({{c * outer, 0.0f, s * outer}, {0.0f, 1.0f, 0.0f}, {1.0f, 0.0f}, {1.0f, 1.0f, 1.0f, 1.0f}});
    }
    for (int i = 0; i < kSegments; ++i) {
        const uint32_t a = static_cast<uint32_t>(i * 2), b = static_cast<uint32_t>(((i + 1) % kSegments) * 2);
        indices.insert(indices.end(), {a, b + 1, a + 1, a, b, b + 1});
    }
    return std::make_shared<Mesh>(vertices, indices);
}
} // namespace

Lake::Lake() {
    BuildSurface();
    m_Drop = Mesh::CreateCube({0.05f, 0.05f, 0.05f}, {0.85f, 0.94f, 1.0f, 1.0f});
    m_Ring = MakeRing(0.86f, 1.0f);
    const std::string texturePath = Paths::Find("public/models/agua/textures/Water_Diffuse.png");
    if (!texturePath.empty() && std::filesystem::exists(texturePath)) m_WaterTexture = Texture::LoadCached(texturePath, true);
    if (!m_WaterTexture) m_WaterTexture = Texture::GetDefaultWhite();
    LoadFish();
}

void Lake::BuildSurface() {
    // Cuadricula de 1 m sobre la elipse: color por profundidad (turquesa en la orilla, verde oscuro al centro) y transparencia que
    // crece con ella. Donde el fondo sube sobre el agua, la superficie queda oculta: la orilla es la elipse exacta, no las casillas.
    constexpr float kStep = 1.0f;
    const int columns = static_cast<int>(std::ceil(2.0f * (CityLayout::kLakeRadiusX + 3.0f) / kStep));
    const int rows = static_cast<int>(std::ceil(2.0f * (CityLayout::kLakeRadiusZ + 3.0f) / kStep));
    const float x0 = CityLayout::kLakeX - (CityLayout::kLakeRadiusX + 3.0f);
    const float z0 = CityLayout::kLakeZ - (CityLayout::kLakeRadiusZ + 3.0f);
    const glm::vec3 shallow(0.30f, 0.70f, 0.66f), deep(0.04f, 0.22f, 0.30f);
    std::vector<Vertex> vertices;
    std::vector<uint32_t> indices;
    vertices.reserve(static_cast<size_t>((columns + 1) * (rows + 1)));
    for (int j = 0; j <= rows; ++j) {
        for (int i = 0; i <= columns; ++i) {
            const float x = x0 + static_cast<float>(i) * kStep, z = z0 + static_cast<float>(j) * kStep;
            const float depth = CityLayout::WaterDepth(x, z);
            const float t = glm::smoothstep(0.0f, 2.0f, depth);
            const float alpha = 0.25f + 0.42f * glm::smoothstep(0.0f, 1.6f, depth);
            vertices.push_back({{x, CityLayout::kLakeSurface, z}, {0.0f, 1.0f, 0.0f}, {0.0f, 0.0f}, {glm::mix(shallow, deep, t), alpha}});
        }
    }
    for (int j = 0; j < rows; ++j) {
        for (int i = 0; i < columns; ++i) {
            const uint32_t a = static_cast<uint32_t>(j * (columns + 1) + i), b = a + 1, c = a + static_cast<uint32_t>(columns + 1), d = c + 1;
            const glm::vec2 center(x0 + (static_cast<float>(i) + 0.5f) * kStep, z0 + (static_cast<float>(j) + 0.5f) * kStep);
            const float nx = (center.x - CityLayout::kLakeX) / CityLayout::kLakeRadiusX, nz = (center.y - CityLayout::kLakeZ) / CityLayout::kLakeRadiusZ;
            if (nx * nx + nz * nz > 1.10f) continue;   // fuera del lago no hace falta superficie
            indices.insert(indices.end(), {c, d, b, b, a, c});
        }
    }
    m_Surface = std::make_shared<Mesh>(vertices, indices);
}

void Lake::LoadFish() {
    struct Source { const char* path; float length; };
    // Largo en metros de cada especie (un guppy mide ~5 cm; se agranda para que se vea desde la orilla)
    const Source sources[] = {{"public/models/pez1/scene.gltf", 0.5f}, {"public/models/pez2/source/Fish/Fish.FBX", 0.7f}};
    for (const Source& source : sources) {
        const std::string path = Paths::Find(source.path);
        if (path.empty() || !std::filesystem::exists(path)) { LogWarn("Pez no encontrado: {}", source.path); continue; }
        std::shared_ptr<Model> model = Model::LoadFromFile(path);
        if (!model) continue;
        if (model->GetAnimationClipCount() > 0) {   // el guppy trae su propio ciclo de nado: se reproduce con una copia como fuente de animacion
            if (std::shared_ptr<Model> source = Model::LoadFromFile(path)) { model->SetAnimationSource(*source); m_AnimationSources.push_back(source); }
        }
        const glm::vec3 low = model->GetBoundsMinimum(), high = model->GetBoundsMaximum(), size = high - low;
        LogInfo("Pez {}: limites {:.2f} x {:.2f} x {:.2f}", source.path, size.x, size.y, size.z);
        // El eje mas largo pasa a ser el frente (+Z); se centra y se escala al largo deseado
        const int axis = size.x > size.y && size.x > size.z ? 0 : (size.y > size.z ? 1 : 2);
        glm::mat4 align(1.0f);
        if (axis == 0) align = glm::rotate(glm::mat4(1.0f), -0.5f * kPi, glm::vec3(0, 1, 0));
        else if (axis == 1) align = glm::rotate(glm::mat4(1.0f), 0.5f * kPi, glm::vec3(1, 0, 0));
        const float scale = source.length / std::max(size[axis], 0.0001f);
        const glm::vec3 center = (low + high) * 0.5f;
        FishKind kind;
        kind.model = model;
        kind.correction = glm::scale(glm::mat4(1.0f), glm::vec3(scale)) * align * glm::translate(glm::mat4(1.0f), -center);
        m_Kinds.push_back(kind);
    }
    if (m_Kinds.empty()) return;
    constexpr int kFishCount = 16;
    for (int i = 0; i < kFishCount; ++i) {
        Fish fish;
        fish.model = static_cast<size_t>(i) % m_Kinds.size();
        fish.angle = Random01(m_Random) * 2.0f * kPi;
        fish.angularSpeed = (0.05f + 0.07f * Random01(m_Random)) * (i % 2 == 0 ? 1.0f : -1.0f);
        fish.radius = 0.25f + 0.5f * Random01(m_Random);
        fish.wobble = Random01(m_Random) * 2.0f * kPi;
        fish.depth = 0.2f + 0.4f * Random01(m_Random);
        fish.phase = Random01(m_Random) * 10.0f;
        fish.scale = 0.8f + 0.5f * Random01(m_Random);
        fish.position = FishPosition(fish, 0.0f);
        m_Fish.push_back(fish);
    }
}

glm::vec3 Lake::FishPosition(const Fish& fish, float time) const {
    const float f = fish.radius + 0.07f * std::sin(time * 0.31f + fish.wobble);
    const float x = CityLayout::kLakeX + CityLayout::kLakeRadiusX * f * std::cos(fish.angle);
    const float z = CityLayout::kLakeZ + CityLayout::kLakeRadiusZ * f * std::sin(fish.angle);
    const float water = CityLayout::WaterDepth(x, z);
    const float depth = std::min(fish.depth, water * 0.55f) + 0.04f * std::sin(time * 1.3f + fish.wobble);
    return {x, CityLayout::kLakeSurface - std::max(0.12f, depth), z};
}

void Lake::Splash(const glm::vec3& at, int count, float power) {
    for (int i = 0; i < count; ++i) {
        const float angle = Random01(m_Random) * 2.0f * kPi, spread = (0.3f + 0.7f * Random01(m_Random)) * power;
        m_Drops.push_back({{at.x, CityLayout::kLakeSurface + 0.05f, at.z},
                           {std::cos(angle) * spread, 1.6f + 2.2f * Random01(m_Random) * power, std::sin(angle) * spread},
                           0.0f, 0.45f + 0.55f * Random01(m_Random)});
    }
    if (m_Drops.size() > 400) m_Drops.erase(m_Drops.begin(), m_Drops.begin() + static_cast<long>(m_Drops.size() - 400));
    m_Ripples.push_back({{at.x, at.z}, 0.0f, 1.1f + 0.4f * power, 0.55f + 0.35f * power});
    if (m_Ripples.size() > 24) m_Ripples.erase(m_Ripples.begin());
}

void Lake::Update(float dt, float time, const glm::vec3& swimmer, float speed, float waterDepth, bool swimming) {
    dt = std::clamp(dt, 0.0f, 0.1f);
    const bool inWater = waterDepth > 0.12f;
    if (inWater && !m_WasInWater) Splash(swimmer, 26, 1.6f);   // zambullida al entrar
    if (!inWater && m_WasInWater) Splash(swimmer, 10, 0.9f);   // al salir escurre
    m_WasInWater = inWater;
    if (inWater && speed > 0.4f) {
        m_StrokeTimer -= dt;
        if (m_StrokeTimer <= 0.0f) {   // cada paso o brazada levanta gotas y una onda
            m_StrokeTimer = swimming ? 0.32f : 0.22f;
            Splash(swimmer + glm::vec3(Random01(m_Random) - 0.5f, 0.0f, Random01(m_Random) - 0.5f) * 0.5f, swimming ? 8 : 5, swimming ? 0.9f : 0.6f);
        }
    }
    for (Droplet& drop : m_Drops) {
        drop.velocity.y -= 9.8f * dt;
        drop.position += drop.velocity * dt;
        drop.life += dt;
    }
    m_Drops.erase(std::remove_if(m_Drops.begin(), m_Drops.end(), [](const Droplet& d) { return d.position.y < CityLayout::kLakeSurface || d.life > 1.6f; }), m_Drops.end());
    for (Ripple& ripple : m_Ripples) ripple.age += dt;
    m_Ripples.erase(std::remove_if(m_Ripples.begin(), m_Ripples.end(), [](const Ripple& r) { return r.age >= r.maxAge; }), m_Ripples.end());

    for (Fish& fish : m_Fish) {
        const float distance = glm::distance(glm::vec2(fish.position.x, fish.position.z), glm::vec2(swimmer.x, swimmer.z));
        const float target = inWater && distance < 4.0f ? 1.0f : 0.0f;   // se asustan de quien nada cerca
        fish.panic += (target - fish.panic) * std::min(1.0f, dt * (target > fish.panic ? 5.0f : 0.8f));
        fish.angle += fish.angularSpeed * (1.0f + 3.0f * fish.panic) * dt;
        const glm::vec3 before = fish.position;
        fish.position = FishPosition(fish, time);
        const glm::vec3 delta = fish.position - before;
        if (dt > 0.0f && glm::dot(glm::vec2(delta.x, delta.z), glm::vec2(delta.x, delta.z)) > 1e-8f) {
            const float wanted = std::atan2(delta.x, delta.z);
            float turn = wanted - fish.yaw;
            while (turn > kPi) turn -= 2.0f * kPi;
            while (turn < -kPi) turn += 2.0f * kPi;
            fish.yaw += turn * std::min(1.0f, dt * 6.0f);
        }
    }
}

void Lake::DrawFish(Renderer& renderer, float time) {
    for (const Fish& fish : m_Fish) {
        const FishKind& kind = m_Kinds[fish.model];
        glm::mat4 transform = glm::translate(glm::mat4(1.0f), fish.position);
        transform = glm::rotate(transform, fish.yaw, glm::vec3(0, 1, 0));
        transform = glm::rotate(transform, 0.12f * std::sin(time * (3.0f + 6.0f * fish.panic) + fish.phase), glm::vec3(0, 1, 0));   // coletazo
        transform = glm::scale(transform, glm::vec3(fish.scale)) * kind.correction;
        const bool animated = kind.model->GetAnimationClipCount() > 0;   // el pez sin animacion solo hace el coletazo
        kind.model->Draw(renderer, transform, glm::vec4(0.82f, 0.95f, 1.0f, 1.0f), time * (1.0f + 2.0f * fish.panic) + fish.phase, animated, 0);
    }
}

void Lake::DrawSurface(Renderer& renderer, float time) {
    (void)time;
    if (m_Surface) {
        m_WaterTexture->BindUnit(0);
        renderer.SetWater(true);
        renderer.Submit(*m_Surface, glm::mat4(1.0f), glm::vec4(1.0f), false, true, nullptr, 2);
        renderer.SetWater(false);
    }
    renderer.SetUnlit(true);
    for (const Ripple& ripple : m_Ripples) {
        const float t = ripple.age / ripple.maxAge;
        const float radius = 0.15f + ripple.speed * ripple.age;
        glm::mat4 transform = glm::translate(glm::mat4(1.0f), glm::vec3(ripple.position.x, CityLayout::kLakeSurface + 0.04f, ripple.position.y));
        transform = glm::scale(transform, glm::vec3(radius, 1.0f, radius));
        renderer.Submit(*m_Ring, transform, glm::vec4(0.9f, 0.97f, 1.0f, 0.38f * (1.0f - t) * (1.0f - t)), false, true, nullptr, 2);
    }
    for (const Droplet& drop : m_Drops) {
        const glm::mat4 transform = glm::scale(glm::translate(glm::mat4(1.0f), drop.position), glm::vec3(drop.size));
        renderer.Submit(*m_Drop, transform, glm::vec4(1.0f, 1.0f, 1.0f, 0.75f * (1.0f - drop.life / 1.6f)), false, true, nullptr, 2);
    }
    renderer.SetUnlit(false);
}

} // namespace Bazuko
