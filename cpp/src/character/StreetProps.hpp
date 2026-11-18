#pragma once
// Lo que carga la gente de la calle (original: character/props.js): baston, morral, mochila, maletin, bolsa, bolso, costal, casco, paraguas y celular.
// Son piezas rigidas que siguen un hueso del cuerpo ya animado (RightHand, Spine2), sin trabajo por cuadro aparte de su matriz; las mallas se
// crean una vez y se comparten entre todos (el color va en el albedo). Lo usan los peatones (Simulation) y el jugador (main.cpp).
#include "../renderer/Mesh.hpp"
#include "../renderer/Renderer.hpp"
#include "IdleGestures.hpp"   // Gestures::detail::Turn: giros de huesos en los ejes del personaje
#include "Archetypes.hpp"

#include <glm/glm.hpp>
#include <glm/gtc/matrix_transform.hpp>

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <memory>

namespace Bazuko::StreetProps {

// Lo que puede cargar una persona (se combinan: mano derecha, mano izquierda, espalda o costado, cabeza)
enum : uint16_t { kNone = 0, kCane = 1, kMorral = 2, kMochila = 4, kMaletin = 8, kBolsa = 16, kBolso = 32, kCostal = 64, kCasco = 128 };

namespace detail {
struct Meshes {
    std::shared_ptr<Mesh> rod = Mesh::CreateCylinder(1.0f, 1.0f, 7);                                 // eje Z, radio y largo 1: se escala por tramo
    std::shared_ptr<Mesh> knob = Mesh::CreateSphere(1.0f, 7, 5);
    std::shared_ptr<Mesh> bag = Mesh::CreateRoundedBox({1.0f, 1.0f, 1.0f}, 0.22f, 2);
    std::shared_ptr<Mesh> strap = Mesh::CreateCube({1.0f, 1.0f, 1.0f});
    std::shared_ptr<Mesh> canopy = Mesh::CreateCone(1.0f, 1.0f, 10);   // tela del paraguas y nudo del costal (cono con la punta arriba)
};
inline const Meshes& Get() { static const Meshes meshes; return meshes; }

// Matriz de un tramo recto de `a` a `b` con ese radio (el cilindro va sobre su eje Z)
inline glm::mat4 Segment(const glm::vec3& a, const glm::vec3& b, float radius) {
    const glm::vec3 delta = b - a;
    const float length = glm::length(delta);
    if (length < 1.0e-4f) return glm::scale(glm::translate(glm::mat4(1.0f), a), glm::vec3(0.0f));
    const glm::vec3 z = delta / length;
    const glm::vec3 helper = std::abs(z.y) < 0.95f ? glm::vec3(0.0f, 1.0f, 0.0f) : glm::vec3(1.0f, 0.0f, 0.0f);
    const glm::vec3 x = glm::normalize(glm::cross(helper, z));
    const glm::vec3 y = glm::cross(z, x);
    glm::mat4 m(1.0f);
    m[0] = glm::vec4(x * radius, 0.0f);
    m[1] = glm::vec4(y * radius, 0.0f);
    m[2] = glm::vec4(z * length, 0.0f);
    m[3] = glm::vec4((a + b) * 0.5f, 1.0f);
    return m;
}

// Marco ortonormal: `up` manda, `forward` se endereza contra el
inline glm::mat4 Frame(const glm::vec3& origin, glm::vec3 up, glm::vec3 forward) {
    up = glm::normalize(up);
    forward = glm::normalize(forward - up * glm::dot(forward, up));
    const glm::vec3 right = glm::cross(up, forward);
    glm::mat4 m(1.0f);
    m[0] = glm::vec4(right, 0.0f);
    m[1] = glm::vec4(up, 0.0f);
    m[2] = glm::vec4(forward, 0.0f);
    m[3] = glm::vec4(origin, 1.0f);
    return m;
}
}

// Colores del original (archetypes.js): madera del baston y telas del morral
inline glm::vec4 CaneColor(uint32_t hash) {
    static const std::array<glm::vec3, 3> colors{{{0.37f, 0.27f, 0.18f}, {0.25f, 0.19f, 0.16f}, {0.15f, 0.14f, 0.13f}}};
    return glm::vec4(colors[hash % colors.size()], 1.0f);
}
inline glm::vec4 BagColor(uint32_t hash) {
    static const std::array<glm::vec3, 7> colors{{{0.18f, 0.23f, 0.30f}, {0.25f, 0.30f, 0.23f}, {0.35f, 0.18f, 0.21f}, {0.15f, 0.15f, 0.17f},
                                                 {0.42f, 0.35f, 0.23f}, {0.14f, 0.15f, 0.17f}, {0.18f, 0.21f, 0.25f}}};
    return glm::vec4(colors[hash % colors.size()], 1.0f);
}

// Baston en la mano: `hand` es el hueso RightHand ya animado y `root` la matriz del personaje (su origen en los pies, +Z al frente).
// Andando o quieto el palo baja de la mano al piso; corriendo se agarra por la mitad, atravesado hacia adelante (como el original).
inline void DrawCane(Renderer& renderer, const glm::mat4& hand, const glm::mat4& root, bool running, const glm::vec4& color) {
    const auto& meshes = detail::Get();
    const float scale = glm::length(glm::vec3(root[0]));
    const glm::vec3 forward = glm::normalize(glm::vec3(root[2]));
    const glm::vec3 up(0.0f, 1.0f, 0.0f);
    const glm::vec3 wrist(hand[3]);
    const glm::vec3 fingers = glm::normalize(glm::vec3(hand[1]));
    const glm::vec3 grip = wrist + fingers * (0.075f * scale);   // el puno, no la muneca
    const float radius = 0.013f * scale;
    if (running) {
        const glm::vec3 front = grip + forward * (0.42f * scale) + up * (0.05f * scale);
        const glm::vec3 back = grip - forward * (0.38f * scale) - up * (0.05f * scale);
        renderer.Submit(*meshes.rod, detail::Segment(back, front, radius), color);
        renderer.Submit(*meshes.knob, glm::scale(glm::translate(glm::mat4(1.0f), front), glm::vec3(radius * 1.6f)), color);
        return;
    }
    const float ground = root[3].y + 0.01f;
    const glm::vec3 tip(grip.x + forward.x * 0.06f * scale, ground, grip.z + forward.z * 0.06f * scale);
    const glm::vec3 top = grip + up * (0.03f * scale);
    renderer.Submit(*meshes.rod, detail::Segment(tip, top, radius), color);
    // el mango curvo: sube un poco, se dobla hacia adelante y cae
    const glm::vec3 bend = top + up * (0.035f * scale) + forward * (0.03f * scale);
    const glm::vec3 hook = bend + forward * (0.05f * scale) - up * (0.04f * scale);
    renderer.Submit(*meshes.rod, detail::Segment(top, bend, radius), color);
    renderer.Submit(*meshes.rod, detail::Segment(bend, hook, radius), color);
    renderer.Submit(*meshes.knob, glm::scale(glm::translate(glm::mat4(1.0f), bend), glm::vec3(radius)), color);
    // regaton de caucho en la punta
    renderer.Submit(*meshes.rod, detail::Segment(tip, tip + up * (0.035f * scale), radius * 1.25f), glm::vec4(0.06f, 0.06f, 0.06f, 1.0f));
}

// Baston tirado en el piso (a quien derribaron se le cae): junto a su mano derecha, acostado
inline void DrawFallenCane(Renderer& renderer, const glm::mat4& root, const glm::vec4& color) {
    const auto& meshes = detail::Get();
    const float scale = glm::length(glm::vec3(root[0]));
    const glm::vec3 right = -glm::normalize(glm::vec3(root[0]));   // +X del personaje es su izquierda
    const glm::vec3 forward = glm::normalize(glm::vec3(root[2]));
    const glm::vec3 base = glm::vec3(root[3]) + right * (0.45f * scale) + glm::vec3(0.0f, 0.02f, 0.0f);
    const glm::vec3 a = base - forward * (0.30f * scale), b = base + forward * (0.48f * scale);
    renderer.Submit(*meshes.rod, detail::Segment(a, b, 0.013f * scale), color);
    renderer.Submit(*meshes.rod, detail::Segment(b, b + right * (0.06f * scale), 0.013f * scale), color);
}

// Morral (pequeno) o mochila de viaje (grande, con la cobija enrollada encima) en la espalda: `spine` es el hueso Spine2 ya animado.
inline void DrawBag(Renderer& renderer, const glm::mat4& spine, const glm::mat4& root, bool big, const glm::vec4& color) {
    const auto& meshes = detail::Get();
    const float scale = glm::length(glm::vec3(root[0]));
    const glm::mat4 frame = detail::Frame(glm::vec3(spine[3]), glm::vec3(spine[1]), glm::vec3(root[2]));
    const auto local = [&](const glm::vec3& center, const glm::vec3& size) {
        return glm::scale(glm::translate(frame, center * scale), size * scale);
    };
    const glm::vec3 size = big ? glm::vec3(0.34f, 0.46f, 0.19f) : glm::vec3(0.29f, 0.36f, 0.13f);
    const float back = -(0.115f + size.z * 0.5f);   // el hueso va por dentro del pecho: la tela queda pegada a la espalda
    const glm::vec3 center(0.0f, big ? -0.04f : -0.02f, back);
    const glm::vec4 dark(color.r * 0.7f, color.g * 0.7f, color.b * 0.7f, 1.0f);
    renderer.Submit(*meshes.bag, local(center, size), color);
    // bolsillo de afuera
    renderer.Submit(*meshes.bag, local(center + glm::vec3(0.0f, -size.y * 0.18f, -size.z * 0.5f - 0.02f), {size.x * 0.72f, size.y * 0.42f, 0.05f}), dark);
    // tapa
    renderer.Submit(*meshes.bag, local(center + glm::vec3(0.0f, size.y * 0.36f, -0.01f), {size.x * 0.96f, size.y * 0.24f, size.z * 1.04f}), dark);
    // correas: de lo alto del morral, por encima del hombro, y bajan por el pecho
    for (const float side : {-1.0f, 1.0f}) {
        const float x = side * size.x * 0.30f;
        const glm::vec3 a = glm::vec3(x, center.y + size.y * 0.42f, back + size.z * 0.3f);
        const glm::vec3 b = glm::vec3(x * 1.15f, 0.19f, 0.0f);
        const glm::vec3 c = glm::vec3(x * 1.2f, 0.06f, 0.185f);
        const glm::vec3 d = glm::vec3(x * 1.15f, -0.17f, 0.195f);
        for (const auto& [from, to] : std::array<std::pair<glm::vec3, glm::vec3>, 3>{{{a, b}, {b, c}, {c, d}}})
            renderer.Submit(*meshes.rod, detail::Segment(glm::vec3(frame * glm::vec4(from * scale, 1.0f)), glm::vec3(frame * glm::vec4(to * scale, 1.0f)), 0.016f * scale), dark);
    }
    if (big) {   // la cobija enrollada atravesada encima
        const glm::vec3 roll(0.0f, center.y + size.y * 0.5f + 0.06f, back + 0.01f);
        const glm::vec3 a = glm::vec3(frame * glm::vec4((roll - glm::vec3(0.21f, 0.0f, 0.0f)) * scale, 1.0f));
        const glm::vec3 b = glm::vec3(frame * glm::vec4((roll + glm::vec3(0.21f, 0.0f, 0.0f)) * scale, 1.0f));
        renderer.Submit(*meshes.rod, detail::Segment(a, b, 0.065f * scale), glm::vec4(0.45f, 0.26f, 0.20f, 1.0f));
    }
}

// Maletin o bolsa en la mano izquierda: cuelgan de la mano hacia el piso (la gravedad manda, el brazo los mece al andar).
// `hand` es el hueso LeftHand ya animado. La bolsa de plastico es blanda y se ladea un poco con el paso (`time`).
inline void DrawHandBag(Renderer& renderer, const glm::mat4& hand, const glm::mat4& root, bool briefcase, const glm::vec4& color, float time) {
    const auto& meshes = detail::Get();
    const float scale = glm::length(glm::vec3(root[0]));
    const glm::vec3 forward = glm::normalize(glm::vec3(root[2]));
    const glm::vec3 grip = glm::vec3(hand[3]) + glm::normalize(glm::vec3(hand[1])) * (0.07f * scale);
    glm::vec3 down(0.0f, -1.0f, 0.0f);
    if (!briefcase) down = glm::normalize(down + forward * (0.10f * std::sin(time * 5.3f)));
    const glm::mat4 frame = detail::Frame(grip, -down, forward);
    const auto local = [&](const glm::vec3& center, const glm::vec3& size) { return glm::scale(glm::translate(frame, center * scale), size * scale); };
    const auto at = [&](const glm::vec3& p) { return glm::vec3(frame * glm::vec4(p * scale, 1.0f)); };
    if (briefcase) {   // maletin de cuero: caja plana con la manija arriba (el lado ancho va de frente a atras)
        renderer.Submit(*meshes.bag, local({0.0f, -0.20f, 0.0f}, {0.09f, 0.30f, 0.40f}), color);
        renderer.Submit(*meshes.rod, detail::Segment(at({0.0f, -0.035f, -0.05f}), at({0.0f, -0.035f, 0.05f}), 0.012f * scale), color * 0.6f);
        renderer.Submit(*meshes.strap, local({0.0f, -0.07f, 0.0f}, {0.10f, 0.012f, 0.12f}), glm::vec4(0.55f, 0.48f, 0.30f, 1.0f));   // broche
    } else {           // bolsa de plastico con lo del mercado: las asas suben a la mano y la bolsa se abomba abajo
        renderer.Submit(*meshes.bag, local({0.0f, -0.24f, 0.0f}, {0.18f, 0.26f, 0.26f}), color);
        for (const float side : {-1.0f, 1.0f}) renderer.Submit(*meshes.rod, detail::Segment(grip, at({0.0f, -0.12f, side * 0.07f}), 0.008f * scale), color);
    }
}

// Bolso de hombro: la correa pasa por el hombro derecho, cruza el pecho y el bolso cae al lado de la cadera izquierda (`spine`: Spine2)
inline void DrawShoulderBag(Renderer& renderer, const glm::mat4& spine, const glm::mat4& root, const glm::vec4& color) {
    const auto& meshes = detail::Get();
    const float scale = glm::length(glm::vec3(root[0]));
    const glm::mat4 frame = detail::Frame(glm::vec3(spine[3]), glm::vec3(spine[1]), glm::vec3(root[2]));
    const auto at = [&](const glm::vec3& p) { return glm::vec3(frame * glm::vec4(p * scale, 1.0f)); };
    renderer.Submit(*meshes.bag, glm::scale(glm::translate(frame, glm::vec3(0.22f, -0.42f, 0.02f) * scale), glm::vec3(0.09f, 0.20f, 0.27f) * scale), color);
    const glm::vec4 strap(color.r * 0.6f, color.g * 0.6f, color.b * 0.6f, 1.0f);
    const std::array<glm::vec3, 5> path{{{0.21f, -0.33f, 0.07f}, {0.13f, -0.12f, 0.16f}, {-0.02f, 0.05f, 0.17f}, {-0.12f, 0.19f, 0.03f}, {-0.10f, 0.15f, -0.12f}}};
    for (size_t i = 0; i + 1 < path.size(); ++i) renderer.Submit(*meshes.rod, detail::Segment(at(path[i]), at(path[i + 1]), 0.011f * scale), strap);
    renderer.Submit(*meshes.rod, detail::Segment(at(path.back()), at({0.20f, -0.33f, -0.04f}), 0.011f * scale), strap);
}

// Costal de fibra a la espalda (los recicladores): percudido, abultado abajo, recogido en un nudo arriba, y las cuerdas por los hombros
inline void DrawSack(Renderer& renderer, const glm::mat4& spine, const glm::mat4& root, const glm::vec4& color) {
    const auto& meshes = detail::Get();
    const float scale = glm::length(glm::vec3(root[0]));
    const glm::mat4 frame = detail::Frame(glm::vec3(spine[3]), glm::vec3(spine[1]), glm::vec3(root[2]));
    const auto at = [&](const glm::vec3& p) { return glm::vec3(frame * glm::vec4(p * scale, 1.0f)); };
    const auto local = [&](const glm::vec3& center, const glm::vec3& size) { return glm::scale(glm::translate(frame, center * scale), size * scale); };
    renderer.Submit(*meshes.knob, local({0.0f, -0.12f, -0.29f}, {0.20f, 0.27f, 0.17f}), color);
    renderer.Submit(*meshes.knob, local({0.02f, -0.24f, -0.31f}, {0.19f, 0.15f, 0.17f}), color * 0.93f);   // lo que pesa se va al fondo
    renderer.Submit(*meshes.canopy, local({0.0f, 0.17f, -0.27f}, {0.05f, 0.08f, 0.05f}), color * 0.85f);       // el nudo
    const glm::vec4 rope(0.42f, 0.36f, 0.26f, 1.0f);
    for (const float side : {-1.0f, 1.0f}) {
        const std::array<glm::vec3, 4> path{{{side * 0.08f, 0.12f, -0.22f}, {side * 0.11f, 0.19f, -0.02f}, {side * 0.13f, 0.06f, 0.18f}, {side * 0.16f, -0.17f, 0.19f}}};
        for (size_t i = 0; i + 1 < path.size(); ++i) renderer.Submit(*meshes.rod, detail::Segment(at(path[i]), at(path[i + 1]), 0.010f * scale), rope);
    }
}

// Casco de obra: copa cenida, ala corta con visera y un lomo de refuerzo (`head`: hueso Head ya animado). Medidas del original (cascoGeometry).
inline void DrawHelmet(Renderer& renderer, const glm::mat4& head, const glm::mat4& root, const glm::vec4& color, bool woman) {
    const auto& meshes = detail::Get();
    const float scale = glm::length(glm::vec3(root[0])) * (woman ? 0.95f : 1.0f);
    const glm::mat4 frame = detail::Frame(glm::vec3(head[3]), glm::vec3(head[1]), glm::vec3(root[2]));
    const auto local = [&](const glm::vec3& center, const glm::vec3& size) { return glm::scale(glm::translate(frame, center * scale), size * scale); };
    renderer.Submit(*meshes.knob, local({0.0f, 0.118f, 0.018f}, {0.123f, 0.118f, 0.146f}), color);
    renderer.Submit(*meshes.knob, local({0.0f, 0.124f, 0.018f}, {0.018f, 0.118f, 0.152f}), color * 0.92f);    // lomo de refuerzo
    // ala: un disco plano (el cilindro se acuesta), con la visera mas larga adelante
    glm::mat4 brim = glm::translate(frame, glm::vec3(0.0f, 0.112f, 0.032f) * scale);
    brim = glm::rotate(brim, glm::half_pi<float>(), glm::vec3(1.0f, 0.0f, 0.0f));
    renderer.Submit(*meshes.rod, glm::scale(brim, glm::vec3(0.128f, 0.165f, 0.008f) * scale), color * 0.95f);
}

// Los de la camioneta negra (limpieza social): pasamontanas negro con la abertura de los ojos, la gorra del jefe y la pistola corta
inline void DrawBalaclava(Renderer& renderer, const glm::mat4& head, const glm::mat4& root, const glm::vec4& skin) {
    const auto& meshes = detail::Get();
    const float scale = glm::length(glm::vec3(root[0]));
    const glm::mat4 frame = detail::Frame(glm::vec3(head[3]), glm::vec3(head[1]), glm::vec3(head[2]));   // sigue la cabeza aunque gire al correr
    const auto local = [&](const glm::vec3& center, const glm::vec3& size) { return glm::scale(glm::translate(frame, center * scale), size * scale); };
    const glm::vec4 knit(0.035f, 0.035f, 0.04f, 1.0f);
    renderer.Submit(*meshes.knob, local({0.0f, 0.092f, 0.022f}, {0.100f, 0.128f, 0.114f}), knit);
    renderer.Submit(*meshes.knob, local({0.0f, -0.005f, 0.012f}, {0.078f, 0.060f, 0.090f}), knit);   // el cuello del pasamontanas
    renderer.Submit(*meshes.strap, local({0.0f, 0.104f, 0.128f}, {0.090f, 0.024f, 0.012f}), skin * 0.85f);   // la abertura de los ojos
}

inline void DrawSquadCap(Renderer& renderer, const glm::mat4& head, const glm::mat4& root) {
    const auto& meshes = detail::Get();
    const float scale = glm::length(glm::vec3(root[0]));
    const glm::mat4 frame = detail::Frame(glm::vec3(head[3]), glm::vec3(head[1]), glm::vec3(head[2]));   // sigue la cabeza aunque gire al correr
    const auto local = [&](const glm::vec3& center, const glm::vec3& size) { return glm::scale(glm::translate(frame, center * scale), size * scale); };
    const glm::vec4 cloth(0.05f, 0.05f, 0.055f, 1.0f);
    renderer.Submit(*meshes.knob, local({0.0f, 0.150f, 0.018f}, {0.106f, 0.080f, 0.120f}), cloth);
    renderer.Submit(*meshes.strap, local({0.0f, 0.162f, 0.150f}, {0.150f, 0.012f, 0.085f}), cloth * 0.9f);   // la visera
}

inline void DrawPistol(Renderer& renderer, const glm::mat4& hand, const glm::mat4& root) {
    const auto& meshes = detail::Get();
    const float scale = glm::length(glm::vec3(root[0]));
    const glm::vec3 fingers = glm::normalize(glm::vec3(hand[1]));
    const glm::vec3 grip = glm::vec3(hand[3]) + fingers * (0.075f * scale);
    const glm::mat4 frame = detail::Frame(grip, -fingers, glm::vec3(root[2]));
    const glm::vec4 metal(0.06f, 0.06f, 0.065f, 1.0f);
    renderer.Submit(*meshes.strap, glm::scale(glm::translate(frame, glm::vec3(0.0f, 0.0f, 0.0f) * scale), glm::vec3(0.028f, 0.095f, 0.040f) * scale), metal);   // la empunadura
    renderer.Submit(*meshes.strap, glm::scale(glm::translate(frame, glm::vec3(0.0f, 0.058f, 0.055f) * scale), glm::vec3(0.030f, 0.034f, 0.165f) * scale), metal * 1.2f);   // la corredera
}

// Paraguas abierto en la mano derecha (con UmbrellaPose): el palo sube de la mano y la tela queda sobre la cabeza
inline void DrawUmbrella(Renderer& renderer, const glm::mat4& hand, const glm::mat4& root, const glm::vec4& color) {
    const auto& meshes = detail::Get();
    const float scale = glm::length(glm::vec3(root[0]));
    const glm::vec3 up(0.0f, 1.0f, 0.0f);
    const glm::vec3 grip = glm::vec3(hand[3]) + glm::normalize(glm::vec3(hand[1])) * (0.07f * scale);
    const glm::vec3 body(root[3]);
    // la tela se centra sobre la cabeza aunque la mano quede al lado: el palo se inclina un poco hacia el eje del cuerpo
    const glm::vec3 top(body.x + (grip.x - body.x) * 0.35f, body.y + 2.02f * scale, body.z + (grip.z - body.z) * 0.35f);
    const glm::vec3 low = grip - glm::normalize(top - grip) * (0.10f * scale);
    renderer.Submit(*meshes.rod, detail::Segment(low, top + up * (0.06f * scale), 0.009f * scale), glm::vec4(0.12f, 0.12f, 0.12f, 1.0f));
    renderer.Submit(*meshes.knob, glm::scale(glm::translate(glm::mat4(1.0f), low), glm::vec3(0.018f * scale)), glm::vec4(0.10f, 0.08f, 0.07f, 1.0f));   // mango
    const glm::mat4 cloth = glm::translate(glm::mat4(1.0f), top - up * (0.06f * scale));
    renderer.Submit(*meshes.canopy, glm::scale(cloth, glm::vec3(0.52f, 0.20f, 0.52f) * scale), color, false, true);   // la tela se ve tambien por debajo
}

// Celular en la mano derecha (con PhonePose): la pantalla mira a la cara
inline void DrawPhone(Renderer& renderer, const glm::mat4& hand, const glm::mat4& root) {
    const auto& meshes = detail::Get();
    const float scale = glm::length(glm::vec3(root[0]));
    const glm::vec3 grip = glm::vec3(hand[3]) + glm::normalize(glm::vec3(hand[1])) * (0.08f * scale);
    const glm::mat4 frame = detail::Frame(grip, glm::vec3(0.0f, 1.0f, 0.0f), glm::vec3(root[2]));
    const glm::mat4 phone = glm::rotate(glm::translate(frame, glm::vec3(0.0f, 0.02f, 0.0f) * scale), -1.0f, glm::vec3(1.0f, 0.0f, 0.0f));   // de pie y acostado hacia la cara
    renderer.Submit(*meshes.strap, glm::scale(phone, glm::vec3(0.072f, 0.145f, 0.010f) * scale), glm::vec4(0.06f, 0.06f, 0.07f, 1.0f));
    renderer.Submit(*meshes.strap, glm::scale(glm::translate(phone, glm::vec3(0.0f, 0.0f, 0.006f) * scale), glm::vec3(0.064f, 0.13f, 0.002f) * scale), glm::vec4(0.35f, 0.55f, 0.75f, 1.0f));   // la pantalla prendida
}

// Poses de los brazos (giros sobre la animacion, como los gestos del jugador): mirar el celular y sostener el paraguas
inline void PhonePose(std::vector<Model::BoneTurn>& turns, float weight) {
    using Gestures::detail::Turn;
    Turn(turns, "Head", 0.30f, 0.0f, 0.0f, weight);
    Turn(turns, "RightArm", -0.22f, 0.30f, -0.05f, weight);
    Turn(turns, "RightForeArm", -1.30f, 0.35f, 0.0f, weight);
}
inline void UmbrellaPose(std::vector<Model::BoneTurn>& turns, float weight) {
    using Gestures::detail::Turn;
    Turn(turns, "RightArm", -0.62f, 0.28f, -0.10f, weight);
    Turn(turns, "RightForeArm", -1.45f, 0.30f, -0.05f, weight);
}

// Paraguas oscuros y alguno de color; bolsas de plastico; cuero de maletin y bolso; casco amarillo, blanco o naranja; costal percudido
inline glm::vec4 UmbrellaColor(uint32_t hash) {
    static const std::array<glm::vec3, 6> colors{{{0.08f, 0.08f, 0.09f}, {0.10f, 0.12f, 0.20f}, {0.45f, 0.10f, 0.12f}, {0.08f, 0.08f, 0.09f}, {0.18f, 0.30f, 0.22f}, {0.30f, 0.22f, 0.38f}}};
    return glm::vec4(colors[hash % colors.size()], 1.0f);
}
inline glm::vec4 PlasticColor(uint32_t hash) {
    static const std::array<glm::vec3, 4> colors{{{0.85f, 0.85f, 0.82f}, {0.10f, 0.10f, 0.11f}, {0.20f, 0.35f, 0.62f}, {0.85f, 0.83f, 0.70f}}};
    return glm::vec4(colors[hash % colors.size()], 1.0f);
}
inline glm::vec4 LeatherColor(uint32_t hash) {
    static const std::array<glm::vec3, 4> colors{{{0.17f, 0.15f, 0.13f}, {0.23f, 0.17f, 0.13f}, {0.12f, 0.13f, 0.15f}, {0.36f, 0.22f, 0.14f}}};
    return glm::vec4(colors[hash % colors.size()], 1.0f);
}
inline glm::vec4 HelmetColor(uint32_t hash) {
    static const std::array<glm::vec3, 3> colors{{{0.92f, 0.74f, 0.12f}, {0.90f, 0.90f, 0.88f}, {0.92f, 0.45f, 0.10f}}};
    return glm::vec4(colors[hash % colors.size()], 1.0f);
}
inline glm::vec4 SackColor() { return glm::vec4(0.80f, 0.77f, 0.68f, 1.0f); }

// Posturas de las paradas (stances.js del original) como giros sobre el reposo o el andar. Las de clip propio (buscar, hablar, acurrucado) y
// cambiar el peso (el reposo relajado) no giran nada: las elige Simulation. `time` es el segundo de la postura (para la que se mueve).
inline void AppendStance(std::vector<Model::BoneTurn>& turns, People::Stance stance, float time, float weight) {
    using Gestures::detail::Turn;
    using S = People::Stance;
    switch (stance) {
        case S::Celular: PhonePose(turns, weight); break;
        case S::Telefono:   // el celular a la oreja derecha y la cabeza un poco ladeada
            Turn(turns, "Head", 0.05f, -0.10f, -0.12f, weight);
            // el brazo baja hacia adelante y el antebrazo sube a la oreja: apuntados (en ejes del modelo: +x su izquierda, +y arriba, +z al frente)
            turns.push_back({"mixamorig:RightArm", {0.0f, 0.0f, 0.0f}, {0.0f, 0.0f, 0.0f}, false, "mixamorig:RightForeArm", {-0.22f, -0.45f, 0.62f}, weight});
            turns.push_back({"mixamorig:RightForeArm", {0.0f, 0.0f, 0.0f}, {0.0f, 0.0f, 0.0f}, false, "mixamorig:RightHand", {0.40f, 0.88f, -0.25f}, weight});
            break;
        case S::BrazosCruzados: Gestures::Append(turns, Gestures::Gesture::Rub, 0.0f, weight); break;   // el frotarse, quieto: brazos cruzados
        case S::ManosAtras:   // las manos juntas a la espalda
            Turn(turns, "Spine2", -0.04f, 0.0f, 0.0f, weight);
            Turn(turns, "LeftArm", 0.38f, 0.0f, 0.18f, weight);
            Turn(turns, "LeftForeArm", 0.25f, 0.0f, -1.35f, weight);
            Turn(turns, "RightArm", 0.38f, 0.0f, -0.18f, weight);
            Turn(turns, "RightForeArm", 0.25f, 0.0f, 1.35f, weight);
            break;
        case S::Bolsillos:   // las manos en los bolsillos de adelante
            Turn(turns, "LeftArm", 0.10f, 0.0f, -0.05f, weight);
            Turn(turns, "LeftForeArm", -0.55f, -0.35f, 0.0f, weight);
            Turn(turns, "RightArm", 0.10f, 0.0f, 0.05f, weight);
            Turn(turns, "RightForeArm", -0.55f, 0.35f, 0.0f, weight);
            break;
        case S::MirarIzquierda: case S::MirarDerecha: {   // voltea a mirar la calle, y vuelve un poco cada tanto
            const float side = stance == S::MirarIzquierda ? 1.0f : -1.0f;
            const float look = 0.75f + 0.25f * std::sin(time * 0.9f);
            Turn(turns, "Head", 0.0f, side * 0.62f * look, 0.0f, weight);
            Turn(turns, "Spine2", 0.0f, side * 0.12f * look, 0.0f, weight);
            break;
        }
        case S::Frotarse: Gestures::Append(turns, Gestures::Gesture::Rub, time, weight); break;
        case S::Encogido: Gestures::Append(turns, Gestures::Gesture::Hunch, time, weight); break;
        case S::Barriga: Gestures::Append(turns, Gestures::Gesture::Belly, time, weight); break;
        default: break;
    }
}

}   // namespace Bazuko::StreetProps
