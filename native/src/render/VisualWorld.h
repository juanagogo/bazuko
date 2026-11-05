#pragma once

#include <array>
#include <map>
#include <string>
#include <tuple>
#include <vector>

#include "core/MathTypes.h"
#include "core/Rng.h"
#include "render/Image.h"
#include "render/MeshBuilder.h"
#include "world/Bogota.h"
#include "world/CollisionWorld.h"

namespace bazuko {

// Material de dibujo (equivale a los MeshStandard/Basic/Lambert del juego web).
struct MaterialDef {
    int map = -1;       // índice en VisualWorld::textures
    int emissive = -1;  // textura emisiva
    Rgb tint{1, 1, 1};  // se multiplica por la textura y el color de vértice
    float emissiveIntensity = 0;
    bool nightEmissive = false;  // el emisivo solo se enciende de noche (ventanas)
    bool unlit = false;          // no recibe luz (carteles, llamas)
    bool noFog = false;          // cerros lejanos
    bool doubleSided = false;
    bool polygonOffset = false;  // marcas viales sobre el asfalto
    bool castShadow = true;      // suelo, marcas y carteles no proyectan sombra
};

// Mallas de un material dentro de un sector de 32 m.
struct CpuBatch {
    int cx = 0, cz = 0;
    int material = 0;
    MeshBuilder mesh;
    Aabb bounds{};
};

// Una pieza de una casa que se desvanece de forma independiente (pared alta o techo).
struct HousePart {
    std::vector<std::pair<int, MeshBuilder>> draws;  // material -> malla
    Aabb bounds{};
    bool roof = false;
};

// Casa o bloque: zócalo siempre visible, cuatro paredes altas y techo.
struct House {
    unsigned id = 0;  // 1..N (0 = ninguna)
    Aabb bounds{};    // volumen completo ampliado 0,6 m (descarte previo de los rayos)
    std::array<HousePart, 4> walls;
    HousePart roof;
};

struct LightSource {
    Vec3 position;
    Rgb color;
    double intensity = 1, distance = 0, decay = 2;
    bool nightOnly = false;  // faroles: solo de noche
    bool flicker = false;    // fuego
    // Parpadeo: intensidad = base + amp1 * sin(t * f1) + amp2 * sin(t * f2)
    double amp1 = 0, f1 = 0, amp2 = 0, f2 = 0;

    // Intensidad en el instante t (segundos) con el día o la noche dados.
    double intensityAt(double t, bool night) const;
};

// Todo lo visual del distrito en CPU: texturas, materiales, mallas por sector y casas.
struct VisualWorld {
    std::vector<Image> textures;
    std::vector<MaterialDef> materials;
    std::vector<CpuBatch> statics;  // suelo, marcas, zócalos, props (siempre visibles)
    std::vector<CpuBatch> closed;   // paredes altas y techos agrupados (tercera persona)
    std::vector<House> houses;
    std::vector<LightSource> lights;
    int skyMaterial = -1;
};

// Alto de un piso y límites de la geometría de las casas (iguales a BuildingVisibility.js).
constexpr double kFloorHeight = 3.0;
constexpr double kLowWallHeight = 0.65;

// Construye el mundo visual. El `rng` decide anchos de casa, estilos y adornos (no es reproducible
// bit a bit con el juego web, que usa Math.random).
VisualWorld buildVisualWorld(const Bogota& city, Rng& rng);

}  // namespace bazuko
