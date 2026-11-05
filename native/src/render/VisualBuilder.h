#pragma once

#include <cmath>
#include <functional>
#include <map>
#include <string>
#include <tuple>

#include <glm/gtc/matrix_transform.hpp>

#include "render/VisualWorld.h"

namespace bazuko {

constexpr double kTile = kTileSize;
constexpr double kSidewalkY = 0.12;
inline double W(double tile) { return tile * kTile; }
inline double WX(double t) { return streetX().world(t); }
inline double WZ(double t) { return streetZ().world(t); }

inline glm::vec3 V3(double x, double y, double z) { return {static_cast<float>(x), static_cast<float>(y), static_cast<float>(z)}; }

// Estado compartido por las fases de construcción del mundo visual (suelo, casas, props).
class VisualBuilder {
public:
    VisualBuilder(const Bogota& city, Rng& rng, VisualWorld& out) : city(city), rng(rng), w(out) {}

    const Bogota& city;
    Rng& rng;
    VisualWorld& w;

    // Modo de pruebas: texturas de 1x1 en vez de dibujar las procedurales (rápido).
    bool fast = false;
    // Mapa alternativo (pruebas con manzanas sintéticas). Por defecto el del distrito.
    const TileMap* mapOverride = nullptr;
    const TileMap& map() const { return mapOverride ? *mapOverride : city.map(); }
    Image make(const std::function<Image()>& fn) const {
        if (!fast) return fn();
        Image img;
        img.width = img.height = 1;
        img.rgba = {128, 128, 128, 255};
        return img;
    }

    double rand(double a, double b) { return a + rng.next() * (b - a); }
    template <class T>
    const T& pick(const std::vector<T>& v) { return v[static_cast<size_t>(std::floor(rng.next() * v.size()))]; }

    // --- texturas y materiales ---
    int addTexture(Image img);
    int addMaterial(const MaterialDef& m);
    // Material de color plano (sin textura). `scale` > 1 da colores sobreexpuestos (llamas).
    int color(std::uint32_t hex, bool unlit = false, bool doubleSided = false, double scale = 1, bool noFog = false);
    int textured(int tex, std::uint32_t tintHex = 0xffffff, bool unlit = false, bool doubleSided = false);

    // --- mallas por sector ---
    MeshBuilder& staticMesh(double wx, double wz, int material) { return batch(statics_, w.statics, wx, wz, material); }
    MeshBuilder& closedMesh(double wx, double wz, int material) { return batch(closedIdx_, w.closed, wx, wz, material); }
    // Emite en el sector de `at` con la transformación dada y restablece la identidad.
    void draw(int material, const glm::vec3& at, const glm::mat4& transform, const std::function<void(MeshBuilder&)>& fn);
    void finalize();  // calcula los límites de cada lote

    // --- fases ---
    void buildGround();
    void buildMarkings();
    void buildBlocks();
    void buildProps();   // VisualProps.cpp
    void buildCerros();  // VisualProps.cpp

    // --- casas (VisualWorld.cpp) ---
    struct ShellSpec {
        double cx, cz, sx, sz, height;
        std::array<int, 6> materials;           // por cara de caja: +x, −x, +y, −y, +z, −z
        std::array<glm::vec2, 6> unitsMeters;   // metros que cubre una textura por cara (0 = textura completa)
        int facadeFace = -1;                    // cara con la fachada (se dibuja también por dentro en ladrillo)
        int interiorMaterial = -1;
        int wallInteriorMaterial = -1;
        glm::vec2 wallInteriorUnits{1, 1};
    };
    // Crea la casa y devuelve su índice en `w.houses`.
    size_t addShell(const ShellSpec& spec);
    // Cierra la construcción de casas: calcula límites y agrupa las piezas para tercera persona.
    void commitHouses();
    // Mallas del primer piso para añadir adornos: pared de una cara y techo.
    MeshBuilder& wallDecor(size_t house, int face, int material);
    MeshBuilder& roofDecor(size_t house, int material);

    // --- props (VisualProps.cpp) ---
    double groundAt(double x, double z) const { return city.groundHeightAt(x, z); }
    void addLight(const Vec3& p, std::uint32_t hex, double intensity, double distance, double decay, bool nightOnly, bool flicker,
                  double amp1 = 0, double f1 = 0, double amp2 = 0, double f2 = 0);

    // Texturas compartidas del distrito.
    int asphaltTex = -1, sidewalkTex = -1, dirtTex = -1, concreteTex = -1, brickTex = -1, slabTex = -1, tilesTex = -1,
        bagTex = -1, cardTex = -1;
    int facadeTexture(double widthM, int floors, int style, int variant);  // con caché
    int signTexture(const std::string& title, const std::string& sub, const std::string& bg, const std::string& fg);

private:
    using Key = std::tuple<int, int, int>;
    MeshBuilder& batch(std::map<Key, size_t>& index, std::vector<CpuBatch>& list, double wx, double wz, int material);
    std::map<Key, size_t> statics_, closedIdx_;
    std::map<std::tuple<double, int, int, int>, std::pair<int, int>> facadeCache_;  // -> (map, emissive)
    std::map<std::string, int> signCache_;
    std::map<std::tuple<std::uint32_t, int, double>, int> colorCache_;
    std::map<std::tuple<int, std::uint32_t, int>, int> texturedCache_;
    // Partes por casa mientras se construye (decoraciones).
    std::vector<std::array<std::map<int, MeshBuilder>, 5>> parts_;
    friend VisualWorld buildVisualWorld(const Bogota&, Rng&);
};

Rgb hexRgb(std::uint32_t hex);

}  // namespace bazuko
