#pragma once
#include <vector>
#include <array>
#include <memory>
#include <string>
#include <functional>
#include <glm/glm.hpp>
#include "../renderer/Mesh.hpp"
#include "../renderer/Model.hpp"
#include "../renderer/Renderer.hpp"
#include "../renderer/Texture.hpp"
#include "SignAtlas.hpp"
#include "Station.hpp"

namespace Bazuko {

enum class TileType : uint8_t {
    Grass,
    Road,
    Busway,
    Sidewalk,
    Building,
    Plaza,
    Wall,
    Water,   // lago: no transitable
    Floor,   // suelo duro de un lote (gasolinera), transitable como un anden
    Solid,   // edificio unico (tienda D69, Colpatria...): bloquea el paso pero no genera la caja generica
    Dirt,    // tierra del Cartucho y del lote del cambuche: transitable
    Ruin     // casa en ruina del Cartucho: baja, oscura y solida
};

// Caja solida de un hito urbano (surtidores, columnas, torres de la pasarela...)
struct StaticBox {
    glm::vec3 center;
    glm::vec3 half;
};

struct BuildingInstance {
    glm::vec3 position;
    glm::vec3 size;
    glm::vec4 color;
    int urbanDesign = -1;
    int floors = 0;
    int modelVariant = -1;
};

class CityLayout {
public:
    static constexpr int WIDTH = 120;
    static constexpr float TILE_SIZE = 2.0f;
    // El mapa es el del juego original (src/world/bogota/CityLayout.js), generado por tools/export-city-map.py:
    // 120 baldosas de ancho y 198 de alto (las 161 del original mas 37 al norte con la estacion Portal del Centro).
    // El marco de coordenadas es el del original: la baldosa (x, z) del original esta centrada en (2x, 2z) metros, asi que
    // todas las posiciones del original (cambuche, hitos, bus...) se usan tal cual.
    static constexpr int NORTH_ROWS = 37;
    static constexpr int HEIGHT = 161 + NORTH_ROWS;
    static constexpr float ORIGIN_X = 1.0f;
    static constexpr float ORIGIN_Z = 1.0f + NORTH_ROWS * TILE_SIZE;

    using CityLoadProgress = std::function<void(size_t completed, size_t total, const std::string& stage)>;
    explicit CityLayout(const CityLoadProgress& progressCallback = nullptr);
    ~CityLayout() = default;

    void Render(Renderer& renderer, const glm::vec3& focusPosition);

    TileType GetTileAt(int x, int z) const;
    // Letra original de la casilla (b, r, B, s, g, p, w, W, f, d, R, S, C, A, M); 'w' fuera del mapa
    char GetMapCode(int x, int z) const {
        if (x < 0 || x >= WIDTH || z < 0 || z >= HEIGHT) return 'w';
        return m_MapCodes.empty() ? 'b' : m_MapCodes[static_cast<size_t>(z * WIDTH + x)];
    }
    // Lago (Parque del Lago): elipse suave de 50 x 26 m con fondo en cuenco. `allowLake` deja pisar el agua (solo el jugador nada);
    // peatones, perro y carros siguen fuera de ella
    static constexpr float kLakeX = 75.0f, kLakeZ = 262.0f, kLakeRadiusX = 50.0f, kLakeRadiusZ = 26.0f;
    static constexpr float kLakeMaxDepth = 2.6f;    // profundidad del fondo en el centro (m bajo la calle)
    static constexpr float kLakeSurface = -0.12f;   // cota de la superficie del agua
    static float LakeDepth(float worldX, float worldZ);   // 0 fuera de la orilla; metros bajo el nivel de la calle dentro
    static float WaterDepth(float worldX, float worldZ) { return std::max(0.0f, LakeDepth(worldX, worldZ) + kLakeSurface); }   // agua sobre el fondo
    bool IsWalkable(float worldX, float worldZ, bool allowLake = false) const;
    bool IsRoad(float worldX, float worldZ) const;
    bool IsSidewalk(float worldX, float worldZ) const;
    bool IsBlocked(float worldX, float worldZ, float radius = 0.0f, bool allowLake = false) const;
    // Solo las cajas estaticas (bombas, pilares, columnas...): el jugador ya respeta el mapa por casillas
    bool HitsObstacle(float worldX, float worldZ, float radius) const;

    glm::vec3 GetSpawnPoint() const;

    // Datos del mapa del original (assets/data/city-map.json)
    struct Band { int first, last; };
    struct ParkSign { float x, z; std::array<std::string, 2> lines; };
    struct VendorSite { std::string name, kind; float x, z, rotation; std::vector<std::string> items; };
    struct CityData {
        std::vector<Band> carreras, calles, caracasLanes;
        std::vector<std::string> carrerasNames, callesNames;
        Band caracasBusway{35, 40};
        std::vector<VendorSite> vendors;
        glm::vec2 spawn{112.98f, 97.84f}, bed{112.98f, 94.64f}, sell, dealer, craft, shop;
        std::vector<glm::vec4> parks;   // x0, x1, z0, z1 de los parques con palomas (metros)
        std::vector<ParkSign> parkSigns;
    };
    const CityData& GetData() const { return m_Data; }

    // Hitos con nombre para el radar: gasolinera, tienda D69, pasarela y Parque del Lago
    struct Landmark {
        std::string name;
        glm::vec3 position;
    };
    const std::vector<Landmark>& GetLandmarks() const { return m_Landmarks; }
    const std::vector<StaticBox>& GetObstacles() const { return m_Obstacles; }
    // Cota del suelo a nivel de calle: sube sobre la isla de la estacion y es 0 en el resto
    // Cota del suelo bajo un punto: andenes, plazas y pisos estan 0,15 m sobre la calle (con un bordillo suave de 0,3 m) y la isla de la estacion sube mas
    float GetGroundHeight(float worldX, float worldZ) const;
    // 0..1: las luces de Colpatria se encienden de noche
    void SetNightGlow(float glow) { m_NightGlow = glow; }

private:
    void GenerateCityMap();
    void BuildMeshes(const CityLoadProgress& progressCallback = nullptr);

    CityData m_Data;
    std::vector<TileType> m_Grid;
    std::vector<char> m_MapCodes;   // letra original de cada casilla en city-map.json (distingue Colpatria, su anexo, la tienda D69...)
    std::shared_ptr<Mesh> m_GroundMesh;
    std::shared_ptr<Mesh> m_SidewalkMesh;
    std::shared_ptr<Mesh> m_NatureMesh;
    std::shared_ptr<Mesh> m_LakeBedMesh;   // orilla y fondo del lago en cuenco (reemplaza las casillas de pasto y agua)
    std::shared_ptr<Mesh> m_MarkingMesh;
    std::shared_ptr<Mesh> m_BuildingMesh;
    std::shared_ptr<Mesh> m_FacadeDetailMesh;
    std::shared_ptr<Mesh> m_SignMesh;
    std::shared_ptr<Mesh> m_WindowLightMesh;      // ventanas encendidas de los edificios (brillan de noche)
    std::shared_ptr<Mesh> m_ColpatriaLightMesh;   // franjas de colores de la torre (brillan de noche)
    std::shared_ptr<Mesh> m_GlassMesh;            // vidrios de la estacion (mezcla alfa)
    float m_NightGlow = 0.0f;
    std::shared_ptr<Mesh> m_LandmarkMesh;   // cajas de color de la gasolinera, la tienda D69 y la pasarela
    std::vector<Landmark> m_Landmarks;
    std::vector<StaticBox> m_Obstacles;
    std::array<std::shared_ptr<Model>, 2> m_BuildingModels;
    std::array<std::shared_ptr<Model>, 3> m_ModularBuildingModels;
    SignAtlas m_SignAtlas;
    std::shared_ptr<Texture> m_AsphaltTexture;
    std::shared_ptr<Texture> m_SidewalkTexture;
    std::shared_ptr<Texture> m_BrickTexture;
    std::vector<BuildingInstance> m_Buildings;
};

} // namespace Bazuko
