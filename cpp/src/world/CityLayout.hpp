#pragma once
#include <vector>
#include <memory>
#include <glm/glm.hpp>
#include "../renderer/Mesh.hpp"
#include "../renderer/Renderer.hpp"
#include "../renderer/Texture.hpp"
#include "SignAtlas.hpp"

namespace Bazuko {

enum class TileType : uint8_t {
    Grass,
    Road,
    Busway,
    Sidewalk,
    Building,
    Plaza,
    Wall
};

struct BuildingInstance {
    glm::vec3 position;
    glm::vec3 size;
    glm::vec4 color;
    int urbanDesign = -1;
    int floors = 0;
};

class CityLayout {
public:
    static constexpr int WIDTH = 120;
    static constexpr int HEIGHT = 111;
    static constexpr float TILE_SIZE = 2.0f; // 2 metros por baldosa (240x222m total)

    CityLayout();
    ~CityLayout() = default;

    void Render(Renderer& renderer);

    TileType GetTileAt(int x, int z) const;
    bool IsWalkable(float worldX, float worldZ) const;
    bool IsRoad(float worldX, float worldZ) const;
    bool IsSidewalk(float worldX, float worldZ) const;
    bool IsBlocked(float worldX, float worldZ, float radius = 0.0f) const;

    glm::vec3 GetSpawnPoint() const;

private:
    void GenerateCityMap();
    void BuildMeshes();

    std::vector<TileType> m_Grid;
    std::shared_ptr<Mesh> m_GroundMesh;
    std::shared_ptr<Mesh> m_SidewalkMesh;
    std::shared_ptr<Mesh> m_NatureMesh;
    std::shared_ptr<Mesh> m_MarkingMesh;
    std::shared_ptr<Mesh> m_BuildingMesh;
    std::shared_ptr<Mesh> m_FacadeDetailMesh;
    std::shared_ptr<Mesh> m_SignMesh;
    SignAtlas m_SignAtlas;
    std::shared_ptr<Texture> m_AsphaltTexture;
    std::shared_ptr<Texture> m_SidewalkTexture;
    std::shared_ptr<Texture> m_BrickTexture;
    std::vector<BuildingInstance> m_Buildings;
};

} // namespace Bazuko
