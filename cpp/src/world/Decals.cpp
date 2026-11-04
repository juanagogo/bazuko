#include "Decals.hpp"

#include "CityLayout.hpp"
#include "../renderer/Mesh.hpp"
#include "../renderer/Renderer.hpp"
#include "../renderer/Texture.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <glm/gtc/matrix_transform.hpp>

namespace Bazuko {

namespace {

constexpr int kTextureSize = 128;

uint32_t HashTile(int x, int z, uint32_t salt) {
    uint32_t h = static_cast<uint32_t>(x) * 73856093u ^ static_cast<uint32_t>(z) * 19349663u ^ salt * 83492791u;
    h ^= h >> 13; h *= 0x5bd1e995u; h ^= h >> 15;
    return h;
}
float Unit(uint32_t h) { return static_cast<float>(h & 0xFFFFFF) / 16777216.0f; }

float ValueNoise(float x, float y, uint32_t salt) {
    const int ix = static_cast<int>(std::floor(x)), iy = static_cast<int>(std::floor(y));
    const float fx = x - static_cast<float>(ix), fy = y - static_cast<float>(iy);
    const float sx = fx * fx * (3.0f - 2.0f * fx), sy = fy * fy * (3.0f - 2.0f * fy);
    const float a = Unit(HashTile(ix, iy, salt)), b = Unit(HashTile(ix + 1, iy, salt));
    const float c = Unit(HashTile(ix, iy + 1, salt)), d = Unit(HashTile(ix + 1, iy + 1, salt));
    return glm::mix(glm::mix(a, b, sx), glm::mix(c, d, sx), sy);
}

// Imagen RGBA con composicion "sobre": cada trazo se mezcla con lo que ya hay
struct Canvas {
    int width, height;
    std::vector<uint8_t> pixels;
    Canvas(int w, int h) : width(w), height(h), pixels(static_cast<size_t>(w) * h * 4, 0) {}
    void blend(int x, int y, const glm::vec3& color, float alpha) {
        if (x < 0 || y < 0 || x >= width || y >= height || alpha <= 0.0f) return;
        uint8_t* p = &pixels[(static_cast<size_t>(y) * width + x) * 4];
        const float da = p[3] / 255.0f;
        const float outAlpha = alpha + da * (1.0f - alpha);
        for (int c = 0; c < 3; ++c) {
            const float dst = p[c] / 255.0f;
            const float out = (color[c] * alpha + dst * da * (1.0f - alpha)) / std::max(outAlpha, 1.0e-4f);
            p[c] = static_cast<uint8_t>(std::clamp(out, 0.0f, 1.0f) * 255.0f);
        }
        p[3] = static_cast<uint8_t>(std::clamp(outAlpha, 0.0f, 1.0f) * 255.0f);
    }
    // disco con borde suave
    void disc(float cx, float cy, float radius, const glm::vec3& color, float alpha) {
        const int x0 = static_cast<int>(std::floor(cx - radius - 1)), x1 = static_cast<int>(std::ceil(cx + radius + 1));
        const int y0 = static_cast<int>(std::floor(cy - radius - 1)), y1 = static_cast<int>(std::ceil(cy + radius + 1));
        for (int y = y0; y <= y1; ++y)
            for (int x = x0; x <= x1; ++x) {
                const float dx = static_cast<float>(x) + 0.5f - cx, dy = static_cast<float>(y) + 0.5f - cy;
                blend(x, y, color, alpha * glm::clamp(radius - std::sqrt(dx * dx + dy * dy) + 0.5f, 0.0f, 1.0f));
            }
    }
    void line(glm::vec2 a, glm::vec2 b, float radius, const glm::vec3& color, float alpha) {
        const float length = glm::length(b - a);
        const int steps = std::max(1, static_cast<int>(length / std::max(0.5f, radius * 0.4f)));
        for (int i = 0; i <= steps; ++i) { const glm::vec2 p = glm::mix(a, b, static_cast<float>(i) / static_cast<float>(steps)); disc(p.x, p.y, radius, color, alpha); }
    }
    void rect(float x0, float y0, float x1, float y1, const glm::vec3& color, float alpha) {
        for (int y = static_cast<int>(y0); y < static_cast<int>(y1); ++y)
            for (int x = static_cast<int>(x0); x < static_cast<int>(x1); ++x) blend(x, y, color, alpha);
    }
};

// Mancha de aceite: mancha oscura de borde irregular con un centro mas denso y un tenue brillo irisado en el borde
std::vector<uint8_t> OilTexture() {
    std::vector<uint8_t> pixels(static_cast<size_t>(kTextureSize) * kTextureSize * 4, 0);
    for (int y = 0; y < kTextureSize; ++y)
        for (int x = 0; x < kTextureSize; ++x) {
            const float u = (static_cast<float>(x) + 0.5f) / kTextureSize * 2.0f - 1.0f, v = (static_cast<float>(y) + 0.5f) / kTextureSize * 2.0f - 1.0f;
            const float angle = std::atan2(v, u);
            const float radius = 0.55f + 0.30f * ValueNoise(std::cos(angle) * 1.7f + 5.0f, std::sin(angle) * 1.7f + 5.0f, 1) + 0.12f * ValueNoise(u * 4.0f, v * 4.0f, 2);
            const float distance = std::sqrt(u * u + v * v);
            const float body = glm::smoothstep(radius, radius * 0.55f, distance);
            const float rim = glm::smoothstep(radius * 0.95f, radius * 0.72f, distance) * (1.0f - glm::smoothstep(radius * 0.72f, radius * 0.45f, distance));
            const float grain = 0.8f + 0.2f * ValueNoise(u * 14.0f, v * 14.0f, 3);
            uint8_t* p = &pixels[(static_cast<size_t>(y) * kTextureSize + x) * 4];
            p[0] = static_cast<uint8_t>(std::clamp(18.0f + 30.0f * rim * ValueNoise(u * 6.0f, v * 6.0f, 4), 0.0f, 255.0f));
            p[1] = static_cast<uint8_t>(std::clamp(16.0f + 26.0f * rim * ValueNoise(u * 6.0f, v * 6.0f, 5), 0.0f, 255.0f));
            p[2] = static_cast<uint8_t>(std::clamp(14.0f + 34.0f * rim * ValueNoise(u * 6.0f, v * 6.0f, 6), 0.0f, 255.0f));
            p[3] = static_cast<uint8_t>(std::clamp(body * grain * 0.82f, 0.0f, 1.0f) * 255.0f);
        }
    return pixels;
}

// Grieta: caminatas aleatorias que se ramifican desde el centro
std::vector<uint8_t> CrackTexture() {
    Canvas canvas(kTextureSize, kTextureSize);
    uint32_t seed = 11;
    const auto random = [&]() { seed = seed * 1664525u + 1013904223u; return static_cast<float>((seed >> 8) & 0xFFFF) / 65535.0f; };
    const auto walk = [&](auto&& self, float x, float y, float direction, int steps, float alpha, int depth) -> void {
        for (int i = 0; i < steps; ++i) {
            direction += (random() - 0.5f) * 0.9f;
            x += std::cos(direction) * 1.4f;
            y += std::sin(direction) * 1.4f;
            canvas.disc(x, y, 1.0f, glm::vec3(0.28f, 0.27f, 0.25f), alpha * (1.0f - static_cast<float>(i) / static_cast<float>(steps) * 0.6f) * 0.92f);
            if (depth < 2 && random() < 0.05f) self(self, x, y, direction + (random() < 0.5f ? 1.0f : -1.0f) * (0.5f + random()), steps / 2, alpha * 0.8f, depth + 1);
        }
    };
    const float center = kTextureSize * 0.5f;
    for (int arm = 0; arm < 4; ++arm) walk(walk, center, center, static_cast<float>(arm) * 1.57f + random() * 0.6f, 38, 1.0f, 0);
    return canvas.pixels;
}

// Mancha de mugre: sombra difusa, sin borde nitido
std::vector<uint8_t> DirtTexture() {
    std::vector<uint8_t> pixels(static_cast<size_t>(kTextureSize) * kTextureSize * 4, 0);
    for (int y = 0; y < kTextureSize; ++y)
        for (int x = 0; x < kTextureSize; ++x) {
            const float u = (static_cast<float>(x) + 0.5f) / kTextureSize * 2.0f - 1.0f, v = (static_cast<float>(y) + 0.5f) / kTextureSize * 2.0f - 1.0f;
            const float falloff = glm::smoothstep(1.0f, 0.15f, std::sqrt(u * u + v * v));
            const float blotch = ValueNoise(u * 3.0f + 9.0f, v * 3.0f + 9.0f, 7) * 0.65f + ValueNoise(u * 9.0f, v * 9.0f, 8) * 0.35f;
            uint8_t* p = &pixels[(static_cast<size_t>(y) * kTextureSize + x) * 4];
            p[0] = 120; p[1] = 108; p[2] = 88;   // polvo y tierra arrastrados
            p[3] = static_cast<uint8_t>(std::clamp(falloff * glm::smoothstep(0.30f, 0.80f, blotch) * 0.46f, 0.0f, 1.0f) * 255.0f);
        }
    return pixels;
}

// Grafiti (256 x 128): firma de trazos gruesos con contorno negro, brillo y chorreones de pintura, mas salpicaduras alrededor
Canvas GraffitiTexture(uint32_t variant) {
    Canvas canvas(256, 128);
    static const glm::vec3 fills[4] = {{0.95f, 0.78f, 0.12f}, {0.20f, 0.72f, 0.90f}, {0.92f, 0.22f, 0.45f}, {0.55f, 0.85f, 0.25f}};
    static const glm::vec3 accents[4] = {{0.90f, 0.28f, 0.15f}, {0.95f, 0.95f, 0.98f}, {0.98f, 0.82f, 0.30f}, {0.12f, 0.12f, 0.15f}};
    const glm::vec3 fill = fills[variant % 4], accent = accents[variant % 4], outline(0.04f, 0.04f, 0.05f);
    uint32_t seed = 977u + variant * 131u;
    const auto random = [&]() { seed = seed * 1664525u + 1013904223u; return static_cast<float>((seed >> 8) & 0xFFFF) / 65535.0f; };
    // trazos: curvas suaves de izquierda a derecha con bucles y subidas, como las letras de una firma
    std::vector<std::vector<glm::vec2>> strokes;
    const int letters = 3 + static_cast<int>(variant % 3);
    for (int letter = 0; letter < letters; ++letter) {
        const float left = 22.0f + static_cast<float>(letter) * (212.0f / static_cast<float>(letters));
        const float width = 212.0f / static_cast<float>(letters) - 8.0f;
        std::vector<glm::vec2> points;
        const int count = 7;
        for (int i = 0; i < count; ++i) {
            const float t = static_cast<float>(i) / static_cast<float>(count - 1);
            points.push_back({left + width * (0.5f + 0.5f * std::sin(t * 6.2f + random() * 2.0f)) * (0.55f + 0.45f * t) + width * 0.25f * t,
                              20.0f + 88.0f * (0.5f + 0.5f * std::sin(t * 9.0f + static_cast<float>(letter) + random()) * (0.6f + 0.4f * random()))});
        }
        strokes.push_back(points);
    }
    const auto drawStroke = [&](const std::vector<glm::vec2>& points, float radius, const glm::vec3& color, float alpha, glm::vec2 offset) {
        for (size_t i = 0; i + 1 < points.size(); ++i) {
            const glm::vec2 a = points[i] + offset, b = points[i + 1] + offset;
            const glm::vec2 c0 = glm::mix(a, b, 0.33f) + glm::vec2(0.0f, 4.0f * std::sin(static_cast<float>(i) * 2.0f)), c1 = glm::mix(a, b, 0.66f);
            canvas.line(a, c0, radius, color, alpha);
            canvas.line(c0, c1, radius, color, alpha);
            canvas.line(c1, b, radius, color, alpha);
        }
    };
    for (const auto& points : strokes) drawStroke(points, 7.6f, outline, 0.90f, {1.5f, 2.0f});   // contorno y sombra
    for (const auto& points : strokes) drawStroke(points, 5.2f, fill, 0.96f, {0.0f, 0.0f});
    for (const auto& points : strokes) drawStroke(points, 1.6f, accent, 0.85f, {-1.4f, -1.6f});   // brillo del color de acento
    // chorreones: la pintura baja por la pared desde algunos puntos de los trazos
    for (const auto& points : strokes)
        for (const glm::vec2& p : points) {
            if (random() < 0.45f) continue;
            const float length = 10.0f + 26.0f * random();
            for (float d = 0.0f; d < length; d += 1.0f) canvas.disc(p.x + 1.5f, p.y + 4.0f + d, 1.0f + 0.5f * (1.0f - d / length), fill, 0.85f * (1.0f - d / length * 0.7f));
            canvas.disc(p.x + 1.5f, p.y + 4.0f + length, 2.0f, fill, 0.9f);
        }
    // salpicaduras
    for (int i = 0; i < 70; ++i) canvas.disc(random() * 256.0f, random() * 128.0f, 0.6f + 1.2f * random(), random() < 0.5f ? fill : accent, 0.35f + 0.3f * random());
    return canvas;
}

// Afiche (128 x 192): papel con borde roto, cabecera de color, titulo, foto y lineas de texto; pegado con cinta y envejecido
Canvas PosterTexture(uint32_t variant) {
    Canvas canvas(128, 192);
    static const glm::vec3 papers[4] = {{0.93f, 0.92f, 0.86f}, {0.95f, 0.86f, 0.55f}, {0.80f, 0.88f, 0.94f}, {0.94f, 0.74f, 0.76f}};
    static const glm::vec3 headers[4] = {{0.82f, 0.18f, 0.18f}, {0.15f, 0.25f, 0.55f}, {0.15f, 0.50f, 0.30f}, {0.25f, 0.20f, 0.35f}};
    const glm::vec3 paper = papers[variant % 4], header = headers[variant % 4];
    uint32_t seed = 4242u + variant * 733u;
    const auto random = [&]() { seed = seed * 1664525u + 1013904223u; return static_cast<float>((seed >> 8) & 0xFFFF) / 65535.0f; };
    // hoja con borde irregular
    for (int y = 0; y < 192; ++y)
        for (int x = 0; x < 128; ++x) {
            const float torn = 3.0f * ValueNoise(static_cast<float>(x) * 0.15f, static_cast<float>(y) * 0.15f, 21 + variant) + 2.0f * ValueNoise(static_cast<float>(x) * 0.5f, static_cast<float>(y) * 0.5f, 22 + variant);
            const float dx = std::min(static_cast<float>(x), 127.0f - static_cast<float>(x)), dy = std::min(static_cast<float>(y), 191.0f - static_cast<float>(y));
            const float inside = glm::clamp(std::min(dx, dy) - torn - 1.0f, 0.0f, 1.0f);
            if (inside <= 0.0f) continue;
            const float age = 0.9f + 0.1f * ValueNoise(static_cast<float>(x) * 0.08f, static_cast<float>(y) * 0.08f, 23);
            canvas.blend(x, y, paper * age, inside);
        }
    canvas.rect(8.0f, 8.0f, 120.0f, 56.0f, header, 0.95f);   // cabecera
    for (int i = 0; i < 2; ++i) canvas.rect(16.0f, 16.0f + static_cast<float>(i) * 18.0f, 16.0f + (70.0f + 30.0f * random()), 28.0f + static_cast<float>(i) * 18.0f, glm::vec3(0.98f, 0.96f, 0.90f), 0.92f);   // titulo
    canvas.rect(14.0f, 66.0f, 114.0f, 118.0f, glm::mix(header, glm::vec3(0.2f), 0.45f + 0.2f * random()), 0.85f);   // foto
    canvas.disc(64.0f, 92.0f, 18.0f, glm::vec3(0.88f, 0.76f, 0.62f), 0.55f);
    for (int i = 0; i < 6; ++i) canvas.rect(14.0f, 128.0f + static_cast<float>(i) * 9.0f, 14.0f + (60.0f + 40.0f * random()), 132.0f + static_cast<float>(i) * 9.0f, glm::vec3(0.22f), 0.78f);   // texto
    canvas.rect(0.0f, 0.0f, 30.0f, 11.0f, glm::vec3(0.86f, 0.80f, 0.62f), 0.5f);     // cintas en las esquinas
    canvas.rect(98.0f, 0.0f, 128.0f, 11.0f, glm::vec3(0.86f, 0.80f, 0.62f), 0.5f);
    for (int i = 0; i < 40; ++i) canvas.disc(random() * 128.0f, random() * 192.0f, 0.8f + random(), glm::vec3(0.35f, 0.3f, 0.25f), 0.12f);   // manchas del tiempo
    return canvas;
}

glm::mat4 GroundModel(const glm::vec3& position, float yaw, float size) {
    glm::mat4 model = glm::translate(glm::mat4(1.0f), position);
    model = glm::rotate(model, yaw, glm::vec3(0.0f, 1.0f, 0.0f));
    return glm::scale(model, glm::vec3(size, 1.0f, size));
}

// Cuadrado vertical sobre una pared o un poste: `normal` sale de la superficie; la imagen queda derecha (arriba es +Y)
glm::mat4 WallModel(const glm::vec3& center, const glm::vec3& normal, float width, float height) {
    const glm::vec3 tangent = glm::normalize(glm::vec3(normal.z, 0.0f, -normal.x));
    return glm::mat4(glm::vec4(tangent * width, 0.0f), glm::vec4(normal, 0.0f), glm::vec4(0.0f, -height, 0.0f, 0.0f), glm::vec4(center, 1.0f));
}

} // namespace

Decals::Decals() = default;
Decals::~Decals() = default;

size_t Decals::CountWall() const { return static_cast<size_t>(std::count_if(m_Decals.begin(), m_Decals.end(), [](const Decal& d) { return d.wall; })); }

void Decals::Build(const CityLayout& city, const std::vector<glm::vec3>& lampPositions) {
    m_Decals.clear();
    m_Quad = Mesh::CreatePlane(1.0f, 1.0f, glm::vec4(1.0f), 1.0f);
    const auto oil = OilTexture(), crack = CrackTexture(), dirt = DirtTexture();
    m_Textures[Oil] = std::make_shared<Texture>(kTextureSize, kTextureSize, oil.data());
    m_Textures[Crack] = std::make_shared<Texture>(kTextureSize, kTextureSize, crack.data());
    m_Textures[Dirt] = std::make_shared<Texture>(kTextureSize, kTextureSize, dirt.data());
    for (uint32_t v = 0; v < 4; ++v) {
        const Canvas graffiti = GraffitiTexture(v);
        m_Textures[GraffitiFirst + v] = std::make_shared<Texture>(graffiti.width, graffiti.height, graffiti.pixels.data());
        const Canvas poster = PosterTexture(v);
        m_Textures[PosterFirst + v] = std::make_shared<Texture>(poster.width, poster.height, poster.pixels.data());
    }
    // suelo
    for (int z = 0; z < CityLayout::HEIGHT; ++z)
        for (int x = 0; x < CityLayout::WIDTH; ++x) {
            const TileType tile = city.GetTileAt(x, z);
            const bool road = tile == TileType::Road, sidewalk = tile == TileType::Sidewalk;
            if (!road && !sidewalk) continue;
            const float worldX = (static_cast<float>(x) + 0.5f) * CityLayout::TILE_SIZE - CityLayout::ORIGIN_X;
            const float worldZ = (static_cast<float>(z) + 0.5f) * CityLayout::TILE_SIZE - CityLayout::ORIGIN_Z;
            const float ground = city.GetGroundHeight(worldX, worldZ);
            if (ground > 1.2f || ground < -0.5f) continue;   // rampas, el puente y el fondo del lago no
            const uint32_t h = HashTile(x, z, 91);
            const float roll = Unit(h);
            Decal decal;
            decal.position = glm::vec3(worldX + (Unit(h >> 3) - 0.5f) * 1.2f, ground + 0.02f, worldZ + (Unit(h >> 7) - 0.5f) * 1.2f);
            const float yaw = Unit(HashTile(x, z, 5)) * 6.2831853f;
            decal.strength = 0.65f + 0.35f * Unit(HashTile(x, z, 6));
            float size = 0.0f;
            if (road && roll < 0.006f) { decal.kind = Oil; size = 1.6f + 1.6f * Unit(HashTile(x, z, 7)); }
            else if (roll > 0.006f && roll < 0.016f) { decal.kind = Crack; size = 2.2f + 2.4f * Unit(HashTile(x, z, 8)); }
            else if (roll > 0.016f && roll < 0.022f) { decal.kind = Dirt; size = 2.4f + 2.0f * Unit(HashTile(x, z, 9)); }
            else continue;
            decal.model = GroundModel(decal.position, yaw, size);
            m_Decals.push_back(decal);
        }
    // paredes: grafitis en las caras de edificios y muros que dan a la calle, y algun afiche
    const auto streetAt = [&](const glm::vec3& point) {
        const TileType tile = city.GetTileAt(static_cast<int>(std::floor((point.x + CityLayout::ORIGIN_X) / CityLayout::TILE_SIZE)),
                                             static_cast<int>(std::floor((point.z + CityLayout::ORIGIN_Z) / CityLayout::TILE_SIZE)));
        return tile == TileType::Road || tile == TileType::Sidewalk;
    };
    const std::vector<BuildingInstance>& buildings = city.GetBuildings();
    // Los edificios con modelo se dibujan mas chicos que su caja y con balcones que sobresalen: en lugar de fiarse de la caja, se lanza un rayo
    // contra la malla dibujada a varias alturas y anchos y se pega el cartel al muro (la mediana de los impactos). Sin muro a la vista, no hay cartel.
    // `wall` es el punto del plano de la caja sobre el que se pensaba poner (centro del cartel); devuelve false si no hay muro.
    const auto snapToWall = [&](size_t index, const BuildingInstance& building, const glm::vec3& normal, const glm::vec3& tangent, float halfWidth, glm::vec3& wall) {
        if (building.modelVariant < 0) return true;   // casas y torres con caja exacta: ya van pegadas a la caja
        std::array<float, 9> hits{};
        size_t count = 0;
        for (int row = -1; row <= 1; ++row)
            for (int column = -1; column <= 1; ++column) {
                const glm::vec3 from = wall + normal * 2.0f + tangent * (static_cast<float>(column) * halfWidth * 0.8f) + glm::vec3(0.0f, static_cast<float>(row) * 0.45f, 0.0f);
                const float t = city.RayBuildingDistance(index, from, -normal);
                if (t > 0.0f && t < 6.0f) hits[count++] = t;
            }
        if (count < 4) return false;
        std::sort(hits.begin(), hits.begin() + static_cast<std::ptrdiff_t>(count));
        wall += normal * (2.0f - hits[count / 2]);   // del plano de la caja al muro real (negativo = hacia adentro)
        return true;
    };
    for (size_t index = 0; index < buildings.size(); ++index) {
        const BuildingInstance& building = buildings[index];
        if (building.size.y < 3.5f || building.size.x < 1.0f || building.size.z < 1.0f) continue;
        const float base = building.position.y - building.size.y * 0.5f;
        if (base > 1.0f) continue;   // edificios sobre el viaducto o elevados
        for (int face = 0; face < 4; ++face) {
            const glm::vec3 normal = face == 0 ? glm::vec3(1, 0, 0) : face == 1 ? glm::vec3(-1, 0, 0) : face == 2 ? glm::vec3(0, 0, 1) : glm::vec3(0, 0, -1);
            const bool alongZ = face < 2;   // la cara +X / -X se extiende a lo largo de Z
            const float length = alongZ ? building.size.z : building.size.x;
            const float reach = alongZ ? building.size.x : building.size.z;
            const glm::vec3 faceCenter = building.position + normal * (reach * 0.5f);
            if (!streetAt(faceCenter + normal * 2.4f) || !streetAt(faceCenter + normal * 1.0f)) continue;   // solo caras sobre la calle o el anden
            const glm::vec3 tangent = glm::normalize(glm::vec3(normal.z, 0.0f, -normal.x));
            const uint32_t h = HashTile(static_cast<int>(index), face, 31);
            if (length >= 3.0f && Unit(h) < 0.20f) {   // grafiti
                Decal decal;
                const float width = std::min(length - 0.4f, 2.6f + 1.6f * Unit(h >> 5)), height = width * 0.5f;
                const float offset = (Unit(h >> 9) - 0.5f) * std::max(0.0f, length - width - 0.2f);
                const float centerY = base + 1.15f + height * 0.5f + 0.5f * Unit(h >> 13);
                glm::vec3 wall = faceCenter + tangent * offset + glm::vec3(0.0f, centerY - building.position.y, 0.0f);
                if (!snapToWall(index, building, normal, tangent, width * 0.5f, wall)) continue;
                decal.position = wall + normal * 0.03f;
                decal.model = WallModel(decal.position, normal, width, height);
                decal.kind = GraffitiFirst + static_cast<int>((h >> 17) % 4);
                decal.strength = 1.0f;
                decal.wall = true;
                m_Decals.push_back(decal);
            } else if (length >= 1.4f && Unit(h >> 3) < 0.30f) {   // afiche
                Decal decal;
                const float width = 0.62f + 0.2f * Unit(h >> 5), height = width * 1.5f;
                const float offset = (Unit(h >> 9) - 0.5f) * std::max(0.0f, length - width - 0.3f);
                glm::vec3 wall = faceCenter + tangent * offset + glm::vec3(0.0f, base + 1.3f + 0.5f * Unit(h >> 13) + height * 0.5f - building.position.y, 0.0f);
                if (!snapToWall(index, building, normal, tangent, width * 0.5f, wall)) continue;
                decal.position = wall + normal * 0.03f;
                decal.model = WallModel(decal.position, normal, width, height);
                decal.kind = PosterFirst + static_cast<int>((h >> 17) % 4);
                decal.strength = 1.0f;
                decal.wall = true;
                m_Decals.push_back(decal);
            }
        }
    }
    // postes: afiches a la altura de la vista, del lado de la calle
    for (size_t index = 0; index < lampPositions.size(); ++index) {
        const uint32_t h = HashTile(static_cast<int>(index), 77, 41);
        if (Unit(h) > 0.38f) continue;
        static const glm::vec3 directions[4] = {{1, 0, 0}, {-1, 0, 0}, {0, 0, 1}, {0, 0, -1}};
        glm::vec3 chosen(0.0f);
        float bestScore = -1.0f;
        for (const glm::vec3& d : directions) {   // el lado con mas calle (calzada) por delante
            float score = 0.0f;
            for (float step : {1.4f, 2.6f, 4.0f}) {
                const glm::vec3 point = lampPositions[index] + d * step;
                const TileType tile = city.GetTileAt(static_cast<int>(std::floor((point.x + CityLayout::ORIGIN_X) / CityLayout::TILE_SIZE)),
                                                     static_cast<int>(std::floor((point.z + CityLayout::ORIGIN_Z) / CityLayout::TILE_SIZE)));
                score += tile == TileType::Road ? 2.0f : tile == TileType::Sidewalk ? 0.5f : -1.0f;
            }
            if (score > bestScore) { bestScore = score; chosen = d; }
        }
        if (bestScore < 2.0f) continue;
        Decal decal;
        const float width = 0.30f, height = 0.45f;
        const float ground = city.GetGroundHeight(lampPositions[index].x, lampPositions[index].z);
        decal.position = glm::vec3(lampPositions[index].x, ground + 1.55f, lampPositions[index].z) + chosen * 0.12f;
        decal.model = WallModel(decal.position, chosen, width, height);
        decal.kind = PosterFirst + static_cast<int>((h >> 7) % 4);
        decal.strength = 1.0f;
        decal.wall = true;
        m_Decals.push_back(decal);
    }
}

void Decals::Render(Renderer& renderer, const glm::vec3& focus, float maxDistance) const {
    if (!m_Quad) return;
    static const bool logDecals = std::getenv("BAZUKO_LOG_DECALS") != nullptr;
    if (logDecals) {
        static bool printed = false;
        if (!printed) {
            printed = true;
            size_t walls = 0, grounds = 0;
            for (const Decal& d : m_Decals) (d.wall ? walls : grounds)++;
            std::fprintf(stderr, "DECALS suelo %zu pared/poste %zu\n", grounds, walls);
            int shown = 0;
            for (const Decal& d : m_Decals) if (d.wall && shown++ < 6) std::fprintf(stderr, "DECAL pared tipo %d en (%.1f, %.2f, %.1f)\n", d.kind, d.position.x, d.position.y, d.position.z);
        }
    }
    const float limit2 = maxDistance * maxDistance;
    for (const Decal& decal : m_Decals) {
        const float dx = decal.position.x - focus.x, dz = decal.position.z - focus.z;
        if (dx * dx + dz * dz > limit2) continue;
        m_Textures[static_cast<size_t>(decal.kind)]->BindUnit(0);
        renderer.Submit(*m_Quad, decal.model, glm::vec4(1.0f, 1.0f, 1.0f, decal.strength), true, true, nullptr, 2, 0.0f);   // mezcla alfa, sin escribir profundidad
    }
}

} // namespace Bazuko
