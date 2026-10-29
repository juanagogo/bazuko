#include "CityLayout.hpp"
#include "Viaduct.hpp"
#include "../core/Paths.hpp"
#include "../core/Log.hpp"
#include <fstream>
#include <nlohmann/json.hpp>
#include <cmath>
#include <algorithm>
#include <tuple>
#include <array>
#include <random>
#include <cstdint>

namespace Bazuko {

namespace {

std::shared_ptr<Texture> MakeSurfaceTexture(int surface, uint32_t seed) {
    constexpr int size = 128;
    std::mt19937 random(seed);
    std::uniform_int_distribution<int> noise(-10, 10);
    std::vector<uint8_t> pixels(size * size * 4, 255);
    for (int y = 0; y < size; ++y) for (int x = 0; x < size; ++x) {
        int red = 57, green = 59, blue = 62;
        const int variation = noise(random);
        if (surface == 1) {
            const int brickHeight = 12;
            const int brickWidth = 37;
            const int staggeredX = (x + (y / brickHeight % 2) * (brickWidth / 2)) % brickWidth;
            const bool mortar = y % brickHeight < 2 || staggeredX < 2;
            constexpr std::array<std::array<int, 3>, 6> brickTones{{
                {{138,75,50}}, {{125,68,48}}, {{148,85,58}},
                {{110,59,42}}, {{160,95,64}}, {{133,72,47}}
            }};
            const auto& tone = brickTones[static_cast<size_t>((x / brickWidth + y / brickHeight) % brickTones.size())];
            red = mortar ? 90 : tone[0] + variation;
            green = mortar ? 68 : tone[1] + variation;
            blue = mortar ? 55 : tone[2] + variation;
        } else if (surface == 2) {
            const bool grout = x % 32 < 2 || y % 32 < 2;
            red = grout ? 105 : 153 + variation;
            green = grout ? 101 : 149 + variation;
            blue = grout ? 96 : 138 + variation;
        } else {
            red += variation;
            green += variation;
            blue += variation;
        }
        const size_t index = static_cast<size_t>((y * size + x) * 4);
        pixels[index] = static_cast<uint8_t>(std::clamp(red, 0, 255));
        pixels[index + 1] = static_cast<uint8_t>(std::clamp(green, 0, 255));
        pixels[index + 2] = static_cast<uint8_t>(std::clamp(blue, 0, 255));
        pixels[index + 3] = 255;
    }
    return std::make_shared<Texture>(size, size, pixels.data());
}

}

CityLayout::CityLayout(const CityLoadProgress& progressCallback)
    : m_Grid(WIDTH * HEIGHT, TileType::Building) {
    if (progressCallback) progressCallback(1, 7, "Generando trazado urbano y calles de Bogotá...");
    GenerateCityMap();
    BuildMeshes(progressCallback);
}

TileType CityLayout::GetTileAt(int x, int z) const {
    if (x < 0 || x >= WIDTH || z < 0 || z >= HEIGHT) return TileType::Wall;
    return m_Grid[z * WIDTH + x];
}

bool CityLayout::IsWalkable(float worldX, float worldZ) const {
    int tileX = static_cast<int>(std::floor((worldX + ORIGIN_X) / TILE_SIZE));
    int tileZ = static_cast<int>(std::floor((worldZ + ORIGIN_Z) / TILE_SIZE));

    TileType tile = GetTileAt(tileX, tileZ);
    return tile != TileType::Building && tile != TileType::Wall && tile != TileType::Water && tile != TileType::Solid && tile != TileType::Ruin;
}

bool CityLayout::IsRoad(float worldX, float worldZ) const {
    const int x = static_cast<int>(std::floor((worldX + ORIGIN_X) / TILE_SIZE));
    const int z = static_cast<int>(std::floor((worldZ + ORIGIN_Z) / TILE_SIZE));
    const auto tile = GetTileAt(x, z);
    return tile == TileType::Road || tile == TileType::Busway;
}

bool CityLayout::IsSidewalk(float worldX, float worldZ) const {
    const int x = static_cast<int>(std::floor((worldX + ORIGIN_X) / TILE_SIZE));
    const int z = static_cast<int>(std::floor((worldZ + ORIGIN_Z) / TILE_SIZE));
    const auto tile = GetTileAt(x, z);
    return tile == TileType::Sidewalk || tile == TileType::Plaza || tile == TileType::Grass || tile == TileType::Floor || tile == TileType::Dirt;
}

bool CityLayout::IsBlocked(float worldX, float worldZ, float radius) const {
    if (!IsWalkable(worldX - radius, worldZ - radius) || !IsWalkable(worldX + radius, worldZ - radius)
        || !IsWalkable(worldX - radius, worldZ + radius) || !IsWalkable(worldX + radius, worldZ + radius)) return true;
    for (const StaticBox& box : m_Obstacles) {
        // circulo contra caja en planta
        const float nearestX = std::clamp(worldX, box.center.x - box.half.x, box.center.x + box.half.x);
        const float nearestZ = std::clamp(worldZ, box.center.z - box.half.z, box.center.z + box.half.z);
        const float dx = worldX - nearestX, dz = worldZ - nearestZ;
        if (dx * dx + dz * dz < radius * radius + 0.0001f) return true;
    }
    return false;
}

bool CityLayout::HitsObstacle(float worldX, float worldZ, float radius) const {
    for (const StaticBox& box : m_Obstacles) {
        const float nearestX = std::clamp(worldX, box.center.x - box.half.x, box.center.x + box.half.x);
        const float nearestZ = std::clamp(worldZ, box.center.z - box.half.z, box.center.z + box.half.z);
        const float dx = worldX - nearestX, dz = worldZ - nearestZ;
        if (dx * dx + dz * dz < radius * radius) return true;
    }
    return false;
}

glm::vec3 CityLayout::GetSpawnPoint() const {
    // La partida empieza junto al cambuche (SHELTER_RESPAWN del original)
    return glm::vec3(m_Data.spawn.x, 0.0f, m_Data.spawn.y);
}

void CityLayout::GenerateCityMap() {
    // El mapa es el del juego original: tools/export-city-map.py lo genera con la misma logica que
    // src/world/bogota/CityLayout.js y lo guarda en assets/data/city-map.json
    const std::string path = Paths::Find("assets/data/city-map.json");
    std::ifstream file(path);
    nlohmann::json json = nlohmann::json::parse(file, nullptr, false);
    if (json.is_discarded()) {
        LogError("No se pudo leer el mapa de la ciudad: {}", path);
        std::fill(m_Grid.begin(), m_Grid.end(), TileType::Wall);
        return;
    }
    if (json.value("width", 0) != WIDTH || json.value("height", 0) != HEIGHT) {
        LogError("El mapa de la ciudad mide {} x {} y se esperaba {} x {}", json.value("width", 0), json.value("height", 0), WIDTH, HEIGHT);
    }
    static const std::array<std::pair<char, TileType>, 15> kCodes{{
        {'b', TileType::Building}, {'r', TileType::Road}, {'B', TileType::Busway}, {'s', TileType::Sidewalk}, {'g', TileType::Grass},
        {'p', TileType::Plaza}, {'w', TileType::Wall}, {'W', TileType::Water}, {'f', TileType::Floor}, {'d', TileType::Dirt},
        {'R', TileType::Ruin}, {'S', TileType::Solid}, {'C', TileType::Solid}, {'A', TileType::Solid}, {'M', TileType::Solid}}};
    const auto& rows = json.at("rows");
    m_MapCodes.assign(static_cast<size_t>(WIDTH * HEIGHT), 'w');
    for (int z = 0; z < HEIGHT && z < static_cast<int>(rows.size()); ++z) {
        const std::string row = rows[static_cast<size_t>(z)].get<std::string>();
        for (int x = 0; x < WIDTH && x < static_cast<int>(row.size()); ++x) {
            TileType tile = TileType::Wall;
            for (const auto& [code, type] : kCodes) if (code == row[static_cast<size_t>(x)]) { tile = type; break; }
            m_Grid[static_cast<size_t>(z * WIDTH + x)] = tile;
            m_MapCodes[static_cast<size_t>(z * WIDTH + x)] = row[static_cast<size_t>(x)];
        }
    }
    const auto bands = [&](const char* key) {
        std::vector<Band> result;
        for (const auto& band : json.at(key)) result.push_back({band[0].get<int>(), band[1].get<int>()});
        return result;
    };
    m_Data.carreras = bands("carreras");
    m_Data.calles = bands("calles");
    m_Data.caracasLanes = bands("caracasLanes");
    m_Data.caracasBusway = {json.at("caracasBusway")[0].get<int>(), json.at("caracasBusway")[1].get<int>()};
    m_Data.carrerasNames = json.at("carrerasNames").get<std::vector<std::string>>();
    m_Data.callesNames = json.at("callesNames").get<std::vector<std::string>>();
    const auto& reserved = json.at("reserved");
    const auto point = [&](const char* key) { return glm::vec2(reserved.at(key)[0].get<float>(), reserved.at(key)[1].get<float>()); };
    m_Data.spawn = point("spawn");
    m_Data.bed = point("bed");
    m_Data.sell = point("sell");
    m_Data.dealer = point("dealer");
    m_Data.craft = point("craft");
    m_Data.shop = point("shop");
    for (const auto& vendor : json.at("vendors")) {
        m_Data.vendors.push_back({vendor.at("name").get<std::string>(), vendor.at("kind").get<std::string>(), vendor.at("x").get<float>(),
                                  vendor.at("z").get<float>(), vendor.at("rot").get<float>(), vendor.at("items").get<std::vector<std::string>>()});
    }
    for (const auto& park : json.at("pigeonParks")) {
        m_Data.parks.emplace_back(park[0].get<float>(), park[1].get<float>(), park[2].get<float>(), park[3].get<float>());
    }
    for (const auto& sign : json.at("parkSigns")) {
        m_Data.parkSigns.push_back({sign.at("x").get<float>(), sign.at("z").get<float>(),
                                    {sign.at("lines")[0].get<std::string>(), sign.at("lines")[1].get<std::string>()}});
    }
}

void CityLayout::BuildMeshes(const CityLoadProgress& progressCallback) {
    m_Buildings.clear();
    if (progressCallback) progressCallback(2, 7, "Cargando arquitectura: Edificio 1 (Only_Building.fbx)...");
    m_BuildingModels[0] = Model::LoadFromFile(Paths::Find("public/models/Edificio 1/Only_Building.fbx"));
    if (progressCallback) progressCallback(3, 7, "Cargando arquitectura: Edificio 3 (highrise.fbx)...");
    m_BuildingModels[1] = Model::LoadFromFile(Paths::Find("public/models/Edificio 3/highrise.fbx"));
    constexpr std::array<const char*, 3> modularBuildingFiles{{
        "Building_LevelModularShell_Bottom.fbx",
        "Building_LevelModularShell_Mid.fbx",
        "Building_LevelModularShell_Top.fbx"
    }};
    for (size_t index = 0; index < modularBuildingFiles.size(); ++index) {
        if (progressCallback) {
            progressCallback(4 + index, 7, "Cargando módulos urbanos (" + std::to_string(index + 1) + "/3: " + modularBuildingFiles[index] + ")...");
        }
        m_ModularBuildingModels[index] = Model::LoadFromFile(Paths::Find(
            std::string("public/models/Edificio 2/Models/FBX/") + modularBuildingFiles[index]));
    }
    if (progressCallback) progressCallback(7, 7, "Construyendo mallas de calzadas, andenes y señalética...");
    const auto availableBuildingVariant = [&](int preferred) {
        for (int offset = 0; offset < 3; ++offset) {
            const int variant = (preferred + offset) % 3;
            const bool available = variant == 1
                ? std::all_of(m_ModularBuildingModels.begin(), m_ModularBuildingModels.end(),
                              [](const auto& model) { return static_cast<bool>(model); })
                : static_cast<bool>(m_BuildingModels[variant == 0 ? 0 : 1]);
            if (available) return variant;
        }
        return -1;
    };
    std::vector<Vertex> groundVertices;
    std::vector<uint32_t> groundIndices;
    std::vector<Vertex> sidewalkVertices;
    std::vector<uint32_t> sidewalkIndices;
    std::vector<Vertex> parkVertices;
    std::vector<uint32_t> parkIndices;
    std::vector<Vertex> markingVertices;
    std::vector<uint32_t> markingIndices;

    float halfWidth = ORIGIN_X;
    float halfHeight = ORIGIN_Z;

    auto getColorForTile = [](TileType type) -> glm::vec4 {
        switch (type) {
            case TileType::Road:     return glm::vec4(0.20f, 0.21f, 0.23f, 1.0f); // Asfalto
            case TileType::Busway:   return glm::vec4(0.42f, 0.22f, 0.20f, 1.0f); // Carril TransMilenio
            case TileType::Sidewalk: return glm::vec4(0.55f, 0.54f, 0.52f, 1.0f); // Andén bogotano
            case TileType::Grass:    return glm::vec4(0.25f, 0.38f, 0.22f, 1.0f); // Prado
            case TileType::Plaza:    return glm::vec4(0.60f, 0.58f, 0.54f, 1.0f); // Adoquín plaza
            case TileType::Water:    return glm::vec4(0.10f, 0.27f, 0.36f, 1.0f); // Agua del lago
            case TileType::Floor:    return glm::vec4(0.50f, 0.50f, 0.48f, 1.0f); // Suelo duro de la gasolinera y la bodega
            case TileType::Dirt:     return glm::vec4(0.36f, 0.28f, 0.20f, 1.0f); // Tierra del Cartucho y del lote del cambuche
            default:                 return glm::vec4(0.30f, 0.30f, 0.30f, 1.0f);
        }
    };

    m_AsphaltTexture = MakeSurfaceTexture(0, 22);
    m_BrickTexture = MakeSurfaceTexture(1, 43);
    m_SidewalkTexture = MakeSurfaceTexture(2, 87);
    std::mt19937 rng(42); // Seed fija para reproducibilidad
    std::uniform_real_distribution<float> heightDist(6.5f, 15.5f);
    std::uniform_int_distribution<int> colorTypeDist(0, 3);

    std::vector<Vertex> buildingVertices;
    std::vector<uint32_t> buildingIndices;
    std::vector<Vertex> windowLightVertices;   // ventanas con la luz encendida (solo se ven de noche)
    std::vector<uint32_t> windowLightIndices;
    std::vector<Vertex> detailVertices;
    std::vector<uint32_t> detailIndices;
    std::vector<Vertex> signVertices;
    std::vector<uint32_t> signIndices;
    std::vector<uint8_t> modelOccupied(static_cast<size_t>(WIDTH * HEIGHT), 0);
    std::vector<uint8_t> visitedBuildingTiles(static_cast<size_t>(WIDTH * HEIGHT), 0);
    const auto urbanHash = [](int x, int z) {
        return static_cast<uint32_t>((static_cast<uint32_t>(x + 17) * 73856093u)
            ^ (static_cast<uint32_t>(z + 31) * 19349663u));
    };
    constexpr std::array<glm::vec4, 4> urbanColors{{
        {0.78f, 0.40f, 0.27f, 1.0f}, {0.65f, 0.67f, 0.67f, 1.0f},
        {0.81f, 0.77f, 0.68f, 1.0f}, {0.60f, 0.64f, 0.66f, 1.0f}
    }};
    constexpr std::array<int, 8> blockFloorCounts{{5, 6, 7, 8, 10, 12, 16, 24}};
    std::vector<size_t> componentQueue;
    for (int startZ = 1; startZ < HEIGHT - 1; ++startZ) {
        for (int startX = 1; startX < WIDTH - 1; ++startX) {
            const size_t startIndex = static_cast<size_t>(startZ * WIDTH + startX);
            if (m_Grid[startIndex] != TileType::Building || visitedBuildingTiles[startIndex]) continue;
            componentQueue.clear();
            componentQueue.push_back(startIndex);
            visitedBuildingTiles[startIndex] = 1;
            int minX = startX, maxX = startX, minZ = startZ, maxZ = startZ;
            for (size_t current = 0; current < componentQueue.size(); ++current) {
                const int x = static_cast<int>(componentQueue[current] % WIDTH);
                const int z = static_cast<int>(componentQueue[current] / WIDTH);
                minX = std::min(minX, x);
                maxX = std::max(maxX, x);
                minZ = std::min(minZ, z);
                maxZ = std::max(maxZ, z);
                for (const auto [dx, dz] : {std::pair{-1, 0}, std::pair{1, 0},
                                            std::pair{0, -1}, std::pair{0, 1}}) {
                    const int nextX = x + dx, nextZ = z + dz;
                    if (GetTileAt(nextX, nextZ) != TileType::Building) continue;
                    const size_t nextIndex = static_cast<size_t>(nextZ * WIDTH + nextX);
                    if (visitedBuildingTiles[nextIndex]) continue;
                    visitedBuildingTiles[nextIndex] = 1;
                    componentQueue.push_back(nextIndex);
                }
            }
            const int tilesX = maxX - minX + 1;
            const int tilesZ = maxZ - minZ + 1;
            const size_t boundingArea = static_cast<size_t>(tilesX * tilesZ);
            const float coverage = static_cast<float>(componentQueue.size()) / static_cast<float>(boundingArea);
            const uint32_t seed = urbanHash(minX, minZ);
            const int variant = availableBuildingVariant(static_cast<int>(seed % 3u));
            if (variant < 0 || tilesX < 4 || tilesZ < 4 || coverage < 1.0f) continue;
            for (const size_t tile : componentQueue) modelOccupied[tile] = 1;
            const int floors = seed % 17u == 0u ? 24
                : blockFloorCounts[static_cast<size_t>((seed >> 8) % blockFloorCounts.size())];
            const float width = std::max(0.5f, static_cast<float>(tilesX) * TILE_SIZE - 0.5f);
            const float depth = std::max(0.5f, static_cast<float>(tilesZ) * TILE_SIZE - 0.5f);
            const float height = static_cast<float>(floors) * 3.2f;
            const float centerX = (static_cast<float>(minX + maxX + 1) * TILE_SIZE) * 0.5f - ORIGIN_X;
            const float centerZ = static_cast<float>(minZ + maxZ + 1) * TILE_SIZE * 0.5f - ORIGIN_Z;
            m_Buildings.push_back({{centerX, height * 0.5f, centerZ},
                                   {width, height, depth},
                                   urbanColors[seed % urbanColors.size()], -1, floors, variant});
        }
    }
    // Rotulos con texto: si no hay fuente se vuelve a los letreros de color liso.
    const bool hasSigns = m_SignAtlas.Build(Paths::Find("assets/fonts/Roboto-Medium.ttf"));
    const auto appendSignQuad = [&](const glm::vec3& center, const glm::vec3& normal, float width, float height,
                                    const SignUV& uv, float angle, float shiftU) {
        const glm::vec3 axisU = normal.z != 0.0f ? glm::vec3(normal.z > 0 ? 1.0f : -1.0f, 0, 0)
                                                : glm::vec3(0, 0, normal.x > 0 ? -1.0f : 1.0f);
        const glm::vec3 axisV(0, 1, 0);
        const glm::vec3 c = center + axisU * shiftU;
        const float ca = std::cos(angle), sa = std::sin(angle);
        const glm::vec3 u = (axisU * ca + axisV * sa) * (width * 0.5f);
        const glm::vec3 v = (axisV * ca - axisU * sa) * (height * 0.5f);
        const glm::vec4 white(1.0f);
        const uint32_t base = static_cast<uint32_t>(signVertices.size());
        signVertices.push_back({c - u - v, normal, {uv.min.x, uv.min.y}, white});
        signVertices.push_back({c + u - v, normal, {uv.max.x, uv.min.y}, white});
        signVertices.push_back({c + u + v, normal, {uv.max.x, uv.max.y}, white});
        signVertices.push_back({c - u + v, normal, {uv.min.x, uv.max.y}, white});
        signIndices.insert(signIndices.end(), {base, base + 1, base + 2, base + 2, base + 3, base});
    };
    const auto appendFacadePanel = [&](const glm::vec3& center, const glm::vec3& normal,
                                       float width, float height, const glm::vec4& color, float offset) {
        const glm::vec3 axisU = normal.z != 0.0f ? glm::vec3(normal.z > 0 ? 1.0f : -1.0f,0,0)
                                                : glm::vec3(0,0,normal.x > 0 ? -1.0f : 1.0f);
        const glm::vec3 axisV(0,1,0);
        const glm::vec3 surface = center + normal * offset;
        const glm::vec3 halfU = axisU * (width * 0.5f);
        const glm::vec3 halfV = axisV * (height * 0.5f);
        const uint32_t base = static_cast<uint32_t>(detailVertices.size());
        detailVertices.push_back({surface-halfU-halfV,normal,{0,0},color});
        detailVertices.push_back({surface+halfU-halfV,normal,{1,0},color});
        detailVertices.push_back({surface+halfU+halfV,normal,{1,1},color});
        detailVertices.push_back({surface-halfU+halfV,normal,{0,1},color});
        detailIndices.insert(detailIndices.end(),{base,base+1,base+2,base+2,base+3,base});
    };
    // Luz de un apartamento tras una ventana: la tercera parte de las ventanas, elegidas por un hash estable de su
    // posicion, con luz calida, blanca o azulada de television. Los edificios de dia no cambian.
    const auto appendWindowLight = [&](const glm::vec3& center, const glm::vec3& normal, float width, float height) {
        const uint32_t hash = static_cast<uint32_t>(static_cast<int>(std::floor(center.x * 3.1f))) * 73856093u
            ^ static_cast<uint32_t>(static_cast<int>(std::floor(center.y * 1.9f))) * 19349663u
            ^ static_cast<uint32_t>(static_cast<int>(std::floor(center.z * 3.1f))) * 83492791u;
        if ((hash >> 4) % 100 >= 42) return;
        static const std::array<glm::vec4, 5> lamps{{
            {1.00f, 0.80f, 0.46f, 1.0f}, {1.00f, 0.88f, 0.62f, 1.0f}, {1.00f, 0.68f, 0.36f, 1.0f},
            {0.96f, 0.95f, 0.88f, 1.0f}, {0.62f, 0.78f, 1.00f, 1.0f}}};
        const glm::vec4 color = lamps[(hash >> 12) % lamps.size()] * (0.75f + 0.25f * static_cast<float>((hash >> 20) % 100) / 100.0f);
        const glm::vec3 axisU = normal.z != 0.0f ? glm::vec3(normal.z > 0 ? 1.0f : -1.0f, 0, 0)
                                                : glm::vec3(0, 0, normal.x > 0 ? -1.0f : 1.0f);
        const glm::vec3 halfU = axisU * (width * 0.5f), halfV = glm::vec3(0, 1, 0) * (height * 0.5f);
        const glm::vec3 surface = center + normal * 0.012f;
        const uint32_t base = static_cast<uint32_t>(windowLightVertices.size());
        windowLightVertices.push_back({surface - halfU - halfV, normal, {0, 0}, glm::vec4(color.r, color.g, color.b, 1.0f)});
        windowLightVertices.push_back({surface + halfU - halfV, normal, {1, 0}, glm::vec4(color.r, color.g, color.b, 1.0f)});
        windowLightVertices.push_back({surface + halfU + halfV, normal, {1, 1}, glm::vec4(color.r, color.g, color.b, 1.0f)});
        windowLightVertices.push_back({surface - halfU + halfV, normal, {0, 1}, glm::vec4(color.r, color.g, color.b, 1.0f)});
        windowLightIndices.insert(windowLightIndices.end(), {base, base + 1, base + 2, base + 2, base + 3, base});
    };

    for (int z = 0; z < HEIGHT; ++z) {
        for (int x = 0; x < WIDTH; ++x) {
            TileType type = m_Grid[z * WIDTH + x];
            const size_t tileIndex = static_cast<size_t>(z * WIDTH + x);
            if (type == TileType::Building && modelOccupied[tileIndex] != 0) continue;

            float x0 = x * TILE_SIZE - halfWidth;
            float z0 = z * TILE_SIZE - halfHeight;
            float x1 = x0 + TILE_SIZE;
            float z1 = z0 + TILE_SIZE;

            if (type == TileType::Wall) {
                // Muro perimetral (Bogota.js, wallMat): solo las baldosas que dan a terreno abierto, 9 m de alto y
                // fundidas por filas en un solo bloque para no llenar el borde de cajas
                const auto opens = [&](int dx, int dz) { return GetTileAt(x + dx, z + dz) != TileType::Wall && x + dx >= 0 && x + dx < WIDTH && z + dz >= 0 && z + dz < HEIGHT; };
                const bool exposed = opens(-1, 0) || opens(1, 0) || opens(0, -1) || opens(0, 1) || opens(-1, -1) || opens(1, -1) || opens(-1, 1) || opens(1, 1);
                if (exposed) {
                    int run = 1;
                    const auto exposedAt = [&](int cx) {
                        const auto open = [&](int dx, int dz) { const int nx = cx + dx, nz = z + dz; return nx >= 0 && nx < WIDTH && nz >= 0 && nz < HEIGHT && GetTileAt(nx, nz) != TileType::Wall; };
                        return open(-1, 0) || open(1, 0) || open(0, -1) || open(0, 1) || open(-1, -1) || open(1, -1) || open(-1, 1) || open(1, 1);
                    };
                    while (x + run < WIDTH && GetTileAt(x + run, z) == TileType::Wall && exposedAt(x + run)) ++run;
                    const float length = static_cast<float>(run) * TILE_SIZE;
                    m_Buildings.push_back({glm::vec3(x0 + length * 0.5f, 4.5f, z0 + TILE_SIZE * 0.5f), glm::vec3(length, 9.0f, TILE_SIZE),
                                           glm::vec4(0.23f, 0.21f, 0.20f, 1.0f), -1});
                    x += run - 1;
                }
            } else if (type == TileType::Ruin) {
                // casa en ruina del Cartucho: baja y oscura, de 2,4 a 5,2 m
                const float ruinHeight = 2.4f + 2.8f * static_cast<float>((x * 7 + z * 13) % 10) / 9.0f;
                const float tone = 0.50f + 0.06f * static_cast<float>((x + z) % 4);
                m_Buildings.push_back({glm::vec3(x0 + TILE_SIZE * 0.5f, ruinHeight * 0.5f, z0 + TILE_SIZE * 0.5f),
                                       glm::vec3(TILE_SIZE, ruinHeight, TILE_SIZE), glm::vec4(tone, tone * 0.92f, tone * 0.85f, 1.0f), -1});
            } else if (type == TileType::Building) {
                float bHeight = heightDist(rng);
                int colorVariant = colorTypeDist(rng);
                glm::vec4 bColor;
                if (colorVariant == 0) {
                    bColor = glm::vec4(0.96f, 0.88f, 0.82f, 1.0f);
                } else if (colorVariant == 1) {
                    bColor = glm::vec4(0.82f, 0.86f, 0.88f, 1.0f);
                } else if (colorVariant == 2) {
                    bColor = glm::vec4(0.98f, 0.91f, 0.78f, 1.0f);
                } else {
                    bColor = glm::vec4(0.78f, 0.80f, 0.82f, 1.0f);
                }

                constexpr float buildingWidth = TILE_SIZE;
                const float buildingDepth = buildingWidth;
                m_Buildings.push_back({
                    glm::vec3(x0 + buildingWidth * 0.5f, bHeight * 0.5f,
                              z0 + buildingDepth * 0.5f),
                    glm::vec3(buildingWidth, bHeight, buildingDepth),
                    bColor,
                    -1
                });
                const std::array<std::pair<TileType, glm::vec3>,4> facadeSides{{
                    {GetTileAt(x,z-1),{0,0,-1}}, {GetTileAt(x,z+1),{0,0,1}},
                    {GetTileAt(x-1,z),{-1,0,0}}, {GetTileAt(x+1,z),{1,0,0}}
                }};
                std::array<int, 4> streetSideIndices{};
                int streetSideCount = 0;
                for (size_t i = 0; i < facadeSides.size(); ++i) {
                    const TileType neighbor = facadeSides[i].first;
                    if (neighbor == TileType::Sidewalk || neighbor == TileType::Road || neighbor == TileType::Busway) {
                        streetSideIndices[streetSideCount++] = static_cast<int>(i);
                    }
                }

                int storefrontSide = -1;
                std::uniform_int_distribution<int> storefrontChanceDist(0, 99);
                if (streetSideCount > 0 && storefrontChanceDist(rng) < 30) {
                    std::uniform_int_distribution<int> sideChoiceDist(0, streetSideCount - 1);
                    storefrontSide = streetSideIndices[sideChoiceDist(rng)];
                }

                int sideIndex = -1;
                for (const auto& [neighbor, normal] : facadeSides) {
                    ++sideIndex;
                    if (neighbor != TileType::Sidewalk && neighbor != TileType::Road && neighbor != TileType::Busway) continue;
                    const glm::vec3 wallCenter(x0 + TILE_SIZE*0.5f,0.0f,z0 + TILE_SIZE*0.5f);
                    const float wallOffset = TILE_SIZE * 0.5f + 0.012f;
                    for (float y=4.5f; y<bHeight-0.8f; y+=2.7f) {
                        const glm::vec3 paneCenter = wallCenter + glm::vec3(0,y,0) + normal*wallOffset;
                        appendFacadePanel(paneCenter,normal,0.94f,1.22f,{0.90f,0.82f,0.67f,1.0f},0.0f);
                        appendFacadePanel(paneCenter+normal*0.014f,normal,0.76f,0.98f,{0.10f,0.17f,0.22f,1.0f},0.0f);
                        appendWindowLight(paneCenter+normal*0.014f,normal,0.70f,0.90f);
                        appendFacadePanel(paneCenter+glm::vec3(0,0.03f,0)+normal*0.03f,normal,0.035f,0.92f,{0.72f,0.67f,0.56f,1.0f},0.0f);
                    }
                    if (sideIndex == storefrontSide) {
                        const float storefrontOffset = wallOffset + 0.012f;
                        appendFacadePanel(wallCenter+glm::vec3(0,1.12f,0)+normal*storefrontOffset,normal,1.62f,2.18f,{0.39f,0.42f,0.41f,1.0f},0.0f);
                        for (int slat = 0; slat < 11; ++slat) {
                            const float y = 0.18f + slat * 0.18f;
                            appendFacadePanel(wallCenter+glm::vec3(0,y,0)+normal*(storefrontOffset+0.012f),normal,1.60f,0.025f,
                                              slat % 2 == 0 ? glm::vec4(0.25f,0.28f,0.28f,1.0f) : glm::vec4(0.55f,0.57f,0.55f,1.0f),0.0f);
                        }
                        if (hasSigns) {
                            // hash estable por fachada: nombre del local, grafiti de la persiana y aviso de cartulina
                            const uint32_t h = static_cast<uint32_t>(x * 73856093) ^ static_cast<uint32_t>(z * 19349663) ^
                                               static_cast<uint32_t>((sideIndex + 1) * 83492791);
                            appendSignQuad(wallCenter + glm::vec3(0, 2.55f, 0) + normal * (storefrontOffset + 0.026f), normal,
                                           1.72f, 0.43f, m_SignAtlas.Shop(h % SignAtlas::kShopSigns), 0.0f, 0.0f);
                            if ((h >> 5) % 100 < 75) {
                                const float tilt = (static_cast<float>((h >> 9) % 100) / 100.0f - 0.5f) * 0.3f;
                                appendSignQuad(wallCenter + glm::vec3(0, 0.95f, 0) + normal * (storefrontOffset + 0.04f), normal,
                                               1.30f, 0.33f, m_SignAtlas.Tag((h >> 3) % SignAtlas::kTags), tilt, 0.0f);
                            }
                            if ((h >> 13) % 100 < 55) {
                                const float shift = (static_cast<float>((h >> 17) % 100) / 100.0f - 0.5f) * 0.7f;
                                appendSignQuad(wallCenter + glm::vec3(0, 1.80f, 0) + normal * (storefrontOffset + 0.045f), normal,
                                               0.72f, 0.18f, m_SignAtlas.Note((h >> 7) % SignAtlas::kNotes), 0.0f, shift);
                            }
                        } else {
                            const std::array<glm::vec4, 4> signColors{{
                                {0.88f,0.13f,0.12f,1.0f}, {0.91f,0.72f,0.12f,1.0f},
                                {0.10f,0.48f,0.27f,1.0f}, {0.16f,0.35f,0.72f,1.0f}
                            }};
                            const size_t signVariant = static_cast<size_t>((x * 7 + z * 11) % static_cast<int>(signColors.size()));
                            appendFacadePanel(wallCenter+glm::vec3(0,2.55f,0)+normal*(storefrontOffset+0.026f),normal,1.72f,0.42f,
                                              signColors[signVariant],0.0f);
                        }
                    }
                }
            } else if (type != TileType::Wall && type != TileType::Solid) {
                glm::vec4 col = getColorForTile(type);
                const bool raised = type == TileType::Sidewalk || type == TileType::Plaza || type == TileType::Floor;
                float y = raised ? 0.15f : type == TileType::Water ? -0.18f : 0.0f;
                auto* vertices = raised ? &sidewalkVertices : &parkVertices;
                auto* indices = raised ? &sidewalkIndices : &parkIndices;
                if (type == TileType::Road || type == TileType::Busway) { vertices = &groundVertices; indices = &groundIndices; }
                uint32_t base = static_cast<uint32_t>(vertices->size());
                vertices->push_back({{x0, y, z1}, {0.0f, 1.0f, 0.0f}, {0.0f, 1.0f}, col});
                vertices->push_back({{x1, y, z1}, {0.0f, 1.0f, 0.0f}, {1.0f, 1.0f}, col});
                vertices->push_back({{x1, y, z0}, {0.0f, 1.0f, 0.0f}, {1.0f, 0.0f}, col});
                vertices->push_back({{x0, y, z0}, {0.0f, 1.0f, 0.0f}, {0.0f, 0.0f}, col});
                indices->insert(indices->end(), {base,base+1,base+2,base+2,base+3,base});
            }
        }
    }

    if (!groundVertices.empty()) {
        m_GroundMesh = std::make_shared<Mesh>(groundVertices, groundIndices);
    }
    if (!sidewalkVertices.empty()) m_SidewalkMesh = std::make_shared<Mesh>(sidewalkVertices, sidewalkIndices);
    if (!parkVertices.empty()) m_NatureMesh = std::make_shared<Mesh>(parkVertices, parkIndices);
    const auto worldX = [&](float tile) { return (tile + 0.5f) * TILE_SIZE - halfWidth; };
    const auto worldZ = [&](float tile) { return (tile + 0.5f) * TILE_SIZE - halfHeight; };
    const auto addMarking = [&](float x, float z, float width, float depth, const glm::vec4& color) {
        const uint32_t base = static_cast<uint32_t>(markingVertices.size());
        markingVertices.push_back({{x-width*0.5f,0.025f,z+depth*0.5f},{0,1,0},{0,1},color});
        markingVertices.push_back({{x+width*0.5f,0.025f,z+depth*0.5f},{0,1,0},{1,1},color});
        markingVertices.push_back({{x+width*0.5f,0.025f,z-depth*0.5f},{0,1,0},{1,0},color});
        markingVertices.push_back({{x-width*0.5f,0.025f,z-depth*0.5f},{0,1,0},{0,0},color});
        markingIndices.insert(markingIndices.end(), {base,base+1,base+2,base+2,base+3,base});
    };
    // bandas de calles del original (assets/data/city-map.json)
    std::vector<std::pair<int, int>> carreras, crucesCarrera, calles;
    for (const Band& band : m_Data.carreras) { carreras.emplace_back(band.first, band.last); crucesCarrera.emplace_back(band.first, band.last); }
    for (const Band& band : m_Data.caracasLanes) carreras.emplace_back(band.first, band.last);
    if (!m_Data.caracasLanes.empty()) crucesCarrera.emplace_back(m_Data.caracasLanes.front().first, m_Data.caracasLanes.back().last);
    for (const Band& band : m_Data.calles) calles.emplace_back(band.first, band.last);
    const glm::vec4 yellow(0.94f,0.76f,0.20f,1.0f);
    const glm::vec4 white(0.94f,0.94f,0.90f,1.0f);
    const int cityTop = NORTH_ROWS + 1, cityBottom = NORTH_ROWS + 110;   // las calzadas del original terminan en su fila 110
    for (const auto& [z0,z1] : calles) {
        const float centerZ = (worldZ(NORTH_ROWS + z0) + worldZ(NORTH_ROWS + z1)) * 0.5f;
        for (float x=worldX(2); x<worldX(WIDTH-2); x+=6.0f) addMarking(x,centerZ,1.8f,0.12f,yellow);
    }
    for (const auto& [x0,x1] : carreras) {
        const float centerX = (worldX(x0) + worldX(x1)) * 0.5f;
        for (float z=worldZ(cityTop); z<worldZ(cityBottom); z+=6.0f) addMarking(centerX,z,0.12f,1.8f,yellow);
    }
    for (const auto& [za,zb] : calles) for (const auto& [xa,xb] : crucesCarrera) {
        const float zLow = worldZ(NORTH_ROWS + za), zHigh = worldZ(NORTH_ROWS + zb);
        for (float edgeZ : {zLow-3.0f, zHigh+3.0f})
            for (float x=worldX(xa)-1.0f; x<worldX(xb)+1.0f; x+=1.8f) addMarking(x,edgeZ,0.52f,3.6f,white);
        for (float edgeX : {worldX(xa)-3.0f, worldX(xb)+3.0f})
            for (float z=zLow-1.0f; z<zHigh+1.0f; z+=1.8f) addMarking(edgeX,z,3.6f,0.52f,white);
    }
    if (!markingVertices.empty()) m_MarkingMesh = std::make_shared<Mesh>(markingVertices, markingIndices);
    const auto appendFace = [&](const glm::vec3& center, const glm::vec3& halfSize, const glm::vec4& color,
                                const glm::vec3& normal, const std::array<glm::vec3, 4>& corners) {
        const uint32_t base = static_cast<uint32_t>(buildingVertices.size());
        for (size_t i = 0; i < corners.size(); ++i) {
            const glm::vec3 position = center + corners[i] * halfSize;
            const glm::vec2 uv = normal.y != 0.0f ? glm::vec2(position.x * 0.25f, position.z * 0.25f)
                : glm::vec2((normal.x != 0.0f ? position.z : position.x) * 0.8f, position.y * 0.8f);
            buildingVertices.push_back({position, normal, uv, color});
        }
        buildingIndices.insert(buildingIndices.end(), {base, base + 1, base + 2, base + 2, base + 3, base});
    };
    const auto appendBox = [&](const glm::vec3& center, const glm::vec3& size, const glm::vec4& color) {
        const glm::vec3 half = size * 0.5f;
        appendFace(center, half, color, {0, 0, 1}, {{{-1,-1,1},{1,-1,1},{1,1,1},{-1,1,1}}});
        appendFace(center, half, color, {0, 0,-1}, {{{1,-1,-1},{-1,-1,-1},{-1,1,-1},{1,1,-1}}});
        appendFace(center, half, color, {-1,0,0}, {{{-1,-1,-1},{-1,-1,1},{-1,1,1},{-1,1,-1}}});
        appendFace(center, half, color, {1,0,0}, {{{1,-1,1},{1,-1,-1},{1,1,-1},{1,1,1}}});
        appendFace(center, half, color, {0,1,0}, {{{-1,1,1},{1,1,1},{1,1,-1},{-1,1,-1}}});
        appendFace(center, half, color, {0,-1,0}, {{{-1,-1,-1},{1,-1,-1},{1,-1,1},{-1,-1,1}}});
    };
    m_Buildings.push_back({glm::vec3(75.0f, 8.0f, 125.0f), glm::vec3(12.0f, 16.0f, 12.0f),
                           glm::vec4(1.0f, 0.93f, 0.88f, 1.0f), 0, 5, -1});
    for (const auto& building : m_Buildings) {
        if (building.modelVariant >= 0) continue;
        if (building.urbanDesign >= 0) {
            const float width = building.size.x;
            const float depth = building.size.z;
            const float height = building.size.y;
            const bool steppedTower = building.urbanDesign == 3 && building.floors >= 8;
            const float lowerHeight = steppedTower ? height - 6.4f : height;
            appendBox({building.position.x, lowerHeight * 0.5f, building.position.z},
                      {width, lowerHeight, depth}, building.color);
            if (steppedTower) {
                appendBox({building.position.x, lowerHeight + 3.2f, building.position.z},
                          {width * 0.76f, 6.4f, depth * 0.76f},
                          glm::vec4(building.color.r * 0.92f, building.color.g * 0.94f,
                                    building.color.b * 0.96f, 1.0f));
            }

            const int firstTileX = static_cast<int>(std::floor(
                (building.position.x - width * 0.5f + ORIGIN_X) / TILE_SIZE));
            const int firstTileZ = static_cast<int>(std::floor(
                (building.position.z - depth * 0.5f + ORIGIN_Z) / TILE_SIZE));
            const int tilesX = static_cast<int>(std::round(width / TILE_SIZE));
            const int tilesZ = static_cast<int>(std::round(depth / TILE_SIZE));
            const int centerTileX = firstTileX + tilesX / 2;
            const int centerTileZ = firstTileZ + tilesZ / 2;
            const std::array<std::pair<TileType, glm::vec3>, 4> sides{{
                {GetTileAt(centerTileX, firstTileZ - 1), {0,0,-1}},
                {GetTileAt(centerTileX, firstTileZ + tilesZ), {0,0,1}},
                {GetTileAt(firstTileX - 1, centerTileZ), {-1,0,0}},
                {GetTileAt(firstTileX + tilesX, centerTileZ), {1,0,0}}
            }};
            const auto streetFacing = [](TileType type) {
                return type == TileType::Sidewalk || type == TileType::Road || type == TileType::Busway
                    || type == TileType::Plaza || type == TileType::Grass || type == TileType::Floor;
            };
            for (size_t sideIndex = 0; sideIndex < sides.size(); ++sideIndex) {
                const auto& [neighbor, normal] = sides[sideIndex];
                if (!streetFacing(neighbor)) continue;
                const bool alongX = normal.z != 0.0f;
                const float facadeWidth = alongX ? width : depth;
                glm::vec3 wallCenter = building.position + normal * ((alongX ? depth : width) * 0.5f + 0.018f);
                wallCenter.y = 0.0f;
                const float floorHeight = 3.2f;
                const int windowCount = std::max(1, static_cast<int>(std::floor(facadeWidth / 3.2f)));
                const float spacing = facadeWidth / static_cast<float>(windowCount);
                const bool bandedConcrete = building.urbanDesign == 1;
                for (int floor = 0; floor < building.floors; ++floor) {
                        const float baseY = static_cast<float>(floor) * floorHeight;
                        const bool groundFloor = floor == 0;
                        if (groundFloor) {
                            const float storefrontOffset = 0.035f;
                            appendFacadePanel(wallCenter + glm::vec3(0.0f, 1.35f, 0.0f) + normal * storefrontOffset,
                                              normal, std::min(facadeWidth * 0.72f, 4.2f), 2.25f,
                                              {0.13f, 0.20f, 0.24f, 1.0f}, 0.0f);
                            appendFacadePanel(wallCenter + glm::vec3(0.0f, 2.58f, 0.0f) + normal * (storefrontOffset + 0.025f),
                                              normal, std::min(facadeWidth * 0.78f, 4.8f), 0.38f,
                                              {0.25f, 0.29f, 0.30f, 1.0f}, 0.0f);
                        }
                        for (int window = 0; window < windowCount; ++window) {
                            const float shift = (static_cast<float>(window) + 0.5f) * spacing - facadeWidth * 0.5f;
                            const glm::vec3 paneCenter = wallCenter + glm::vec3(0.0f, baseY + 1.85f, 0.0f)
                                + normal * 0.025f
                                + (alongX ? glm::vec3(shift, 0.0f, 0.0f) : glm::vec3(0.0f, 0.0f, shift));
                            const bool brickBalcony = building.urbanDesign == 0;
                        const bool verticalFrame = building.urbanDesign == 2;
                        const bool glassCorner = building.urbanDesign == 4;
                        const glm::vec4 glassColor = glassCorner
                            ? glm::vec4(0.09f, 0.18f, 0.23f, 1.0f)
                            : glm::vec4(0.10f, 0.17f, 0.22f, 1.0f);
                        const float paneWidth = std::min(spacing * (glassCorner ? 0.88f : 0.68f), 2.2f);
                        appendFacadePanel(paneCenter, normal, paneWidth + 0.18f, 1.62f,
                                          {0.82f, 0.76f, 0.66f, 1.0f}, 0.0f);
                        appendFacadePanel(paneCenter + normal * 0.016f, normal, paneWidth, 1.43f,
                                          glassColor, 0.0f);
                        appendWindowLight(paneCenter + normal * 0.016f, normal, paneWidth * 0.92f, 1.32f);
                        if (brickBalcony) {
                            const float balconyY = baseY + 1.12f;
                            appendFacadePanel(paneCenter + glm::vec3(0.0f, balconyY - (baseY + 1.85f), 0.0f)
                                                  + normal * 0.11f,
                                              normal, std::min(spacing * 0.84f, 2.6f), 0.12f,
                                              {0.48f, 0.43f, 0.37f, 1.0f}, 0.0f);
                            appendFacadePanel(paneCenter + glm::vec3(0.0f, balconyY + 0.43f - (baseY + 1.85f), 0.0f)
                                                  + normal * 0.12f,
                                              normal, std::min(spacing * 0.78f, 2.4f), 0.07f,
                                              {0.72f, 0.70f, 0.65f, 1.0f}, 0.0f);
                        } else if (verticalFrame) {
                            for (float edge : {-0.5f, 0.5f}) {
                                appendFacadePanel(paneCenter + (alongX ? glm::vec3(edge * spacing, 0.0f, 0.0f)
                                                                        : glm::vec3(0.0f, 0.0f, edge * spacing))
                                                      + normal * 0.035f,
                                                  normal, 0.13f, 2.9f, {0.84f, 0.80f, 0.72f, 1.0f}, 0.0f);
                            }
                        }
                    }
                    if (bandedConcrete || floor > 0) {
                        appendFacadePanel(wallCenter + glm::vec3(0.0f, baseY + 0.08f, 0.0f) + normal * 0.045f,
                                          normal, facadeWidth - 0.12f, bandedConcrete ? 0.18f : 0.09f,
                                          bandedConcrete ? glm::vec4(0.79f, 0.79f, 0.76f, 1.0f)
                                                         : glm::vec4(0.54f, 0.54f, 0.52f, 1.0f),
                                          0.0f);
                    }
                }
                if (building.urbanDesign == 4) {
                    appendFacadePanel(wallCenter + glm::vec3(0.0f, height * 0.5f, 0.0f) + normal * 0.055f,
                                      normal, 0.18f, height - 0.4f, {0.78f, 0.82f, 0.82f, 1.0f}, 0.0f);
                }
            }
            continue;
        }
        appendBox(building.position, building.size, building.color);
    }

    // ---- Hitos urbanos del original: gasolinera, tienda D69 y pasarela de la Caracas ----
    {
        std::vector<Vertex> landmarkVertices;
        std::vector<uint32_t> landmarkIndices;
        // Caja con orientacion en Z (las diagonales de la pasarela); `size` es ancho x alto x fondo.
        std::vector<Vertex> lightVertices, glassVertices;
        std::vector<uint32_t> lightIndices, glassIndices;
        const auto boxTo = [&](std::vector<Vertex>& outVertices, std::vector<uint32_t>& outIndices, float alpha,
                               const glm::vec3& c, const glm::vec3& size, uint32_t rgb, float rotZ) {
            const glm::vec4 color(((rgb >> 16) & 0xFF) / 255.0f, ((rgb >> 8) & 0xFF) / 255.0f, (rgb & 0xFF) / 255.0f, alpha);
            const glm::mat3 R(glm::rotate(glm::mat4(1.0f), rotZ, glm::vec3(0, 0, 1)));
            const glm::vec3 h = size * 0.5f;
            struct Face { glm::vec3 n, t1, t2; };
            const std::array<Face, 6> faces{{
                {{1, 0, 0}, {0, 1, 0}, {0, 0, 1}}, {{-1, 0, 0}, {0, 0, 1}, {0, 1, 0}},
                {{0, 1, 0}, {0, 0, 1}, {1, 0, 0}}, {{0, -1, 0}, {1, 0, 0}, {0, 0, 1}},
                {{0, 0, 1}, {1, 0, 0}, {0, 1, 0}}, {{0, 0, -1}, {0, 1, 0}, {1, 0, 0}}}};
            for (const Face& f : faces) {
                const glm::vec3 n = R * f.n;
                const glm::vec3 a = R * (f.t1 * glm::dot(glm::abs(f.t1), h));
                const glm::vec3 b = R * (f.t2 * glm::dot(glm::abs(f.t2), h));
                const glm::vec3 center = c + R * (f.n * glm::dot(glm::abs(f.n), h));
                const uint32_t base = static_cast<uint32_t>(outVertices.size());
                outVertices.push_back({center - a - b, n, {0, 0}, color});
                outVertices.push_back({center + a - b, n, {1, 0}, color});
                outVertices.push_back({center + a + b, n, {1, 1}, color});
                outVertices.push_back({center - a + b, n, {0, 1}, color});
                outIndices.insert(outIndices.end(), {base, base + 1, base + 2, base + 2, base + 3, base});
            }
        };
        const auto box = [&](const glm::vec3& c, const glm::vec3& size, uint32_t rgb, float rotZ = 0.0f) {
            boxTo(landmarkVertices, landmarkIndices, 1.0f, c, size, rgb, rotZ);
        };
        const auto obstacle = [&](const glm::vec3& c, float w, float d, float margin = 0.1f) {
            m_Obstacles.push_back({{c.x, 0.0f, c.z}, {w * 0.5f + margin, 5.0f, d * 0.5f + margin}});
        };

        // ---- Gasolinera (GasStation.js), en las coordenadas del original: X 145-163, Z 89-117 ----
        {
            const auto g = [](float x, float y, float z) { return glm::vec3(x, y, z); };
            constexpr uint32_t red = 0xbc1726, white = 0xe7e5df, dark = 0x252c32, yellow = 0xe9b82a, glass = 0x467783;
            box(g(154, 5.05f, 100), {17.5f, 0.5f, 15}, red);               // marquesina alta con franja roja
            box(g(154, 4.76f, 100), {17, 0.08f, 14.5f}, white);
            for (float x : {147.0f, 161.0f})
                for (float z : {94.0f, 106.0f}) { box(g(x, 2.44f, z), {0.38f, 4.65f, 0.38f}, white); obstacle(g(x, 0, z), 0.4f, 0.4f); }
            for (float x : {149.0f, 159.0f}) {
                box(g(x, 0.2f, 100), {2.1f, 0.16f, 10.6f}, yellow);        // isla de surtidores
                for (float z : {97.0f, 103.0f}) {
                    box(g(x, 0.94f, z), {0.85f, 1.25f, 1.1f}, white);
                    box(g(x, 1.83f, z), {0.9f, 0.55f, 1.12f}, red);
                    box(g(x, 1.75f, z - 0.58f), {0.58f, 0.28f, 0.04f}, dark);
                    obstacle(g(x, 0, z), 0.85f, 1.1f);
                }
            }
            box(g(154, 1.82f, 114), {13, 3.4f, 4}, white);                 // tienda
            box(g(154, 3.65f, 114), {13.3f, 0.3f, 4.3f}, red);
            for (float x : {150.0f, 154.0f, 158.0f}) box(g(x, 1.72f, 111.95f), {2.9f, 1.9f, 0.06f}, glass);
            obstacle(g(154, 0, 114), 13, 4);
            box(g(146, 4.52f, 91), {0.36f, 8.8f, 0.36f}, dark);            // totem
            box(g(146, 7.6f, 91), {2, 3.2f, 0.3f}, red);
            obstacle(g(146, 0, 91), 0.6f, 0.6f);
            const glm::vec3 north(0, 0, -1);
            if (m_SignAtlas.GetTexture()) {
                appendSignQuad(g(154, 5.07f, 92.48f), north, 8.0f, 0.42f, m_SignAtlas.Landmark(0), 0.0f, 0.0f);
                appendSignQuad(g(154, 3.12f, 111.9f), north, 8.0f, 0.6f, m_SignAtlas.Landmark(1), 0.0f, 0.0f);
                appendSignQuad(g(146, 8.4f, 90.68f), north, 1.9f, 0.8f, m_SignAtlas.Landmark(2), 0.0f, 0.0f);
                appendSignQuad(g(146, 7.1f, 90.68f), north, 1.9f, 0.8f, m_SignAtlas.Landmark(3), 0.0f, 0.0f);
            }
            m_Landmarks.push_back({"Gasolinera", g(154, 0, 102)});
        }

        // ---- Tienda D69 (D69Store.js): contra el anden oriental, tiles X 22-26, Z 80-86 ----
        {
            const auto d = [](float x, float y, float z) { return glm::vec3(x, y, z); };
            constexpr uint32_t white = 0xeeeadf, red = 0xb50c32, frame = 0xb6bab8, glass = 0x29474c, roof = 0x777a77;
            box(d(48, 2.5f, 166), {10, 5, 14}, white);
            box(d(48, 4.4f, 166), {10.12f, 1.1f, 14.12f}, red);
            box(d(48, 5.02f, 166), {9.8f, 0.12f, 13.8f}, roof);
            for (float z : {159.3f, 172.7f}) box(d(53.06f, 1.925f, z), {0.16f, 3.85f, 0.6f}, red);
            for (float z : {161.8f, 166.0f, 170.0f}) {
                box(d(53.05f, 1.57f, z), {0.12f, 2.9f, 3.2f}, frame);
                box(d(53.13f, 1.57f, z), {0.04f, 2.65f, 2.95f}, glass);
                box(d(53.17f, 1.57f, z), {0.06f, 2.7f, 0.055f}, frame);
            }
            box(d(48, 1.57f, 158.96f), {5.7f, 2.9f, 0.1f}, frame);
            box(d(48, 1.57f, 158.89f), {5.45f, 2.65f, 0.04f}, glass);
            if (m_SignAtlas.GetTexture()) {
                appendSignQuad(d(53.14f, 4.4f, 162.0f), {1, 0, 0}, 3.4f, 0.95f, m_SignAtlas.Landmark(4), 0.0f, 0.0f);
                appendSignQuad(d(48, 4.4f, 158.84f), {0, 0, -1}, 3.4f, 0.95f, m_SignAtlas.Landmark(4), 0.0f, 0.0f);
            }
            m_Landmarks.push_back({"Tienda D69", d(48, 0, 166)});
        }

        // ---- Pasarela de la Caracas (AvenueLandmarks.js): torres de acceso en X 55 y 95, sobre la avenida en Z 8 ----
        {
            constexpr float z = 8.0f, x0 = 55.0f, x1 = 95.0f, clearance = 6.4f;
            constexpr uint32_t concrete = 0xa4a99d, steel = 0x315d5a, dark = 0x243439, glass = 0x84a5ad;
            for (float x : {x0, x1}) {
                box({x, 5.7f, z}, {1.4f, 11.4f, 4.6f}, concrete);
                box({x, 11.55f, z}, {1.8f, 0.3f, 5.0f}, steel);
                box({x, 1.2f, z - 2.34f}, {1.1f, 2.2f, 0.06f}, dark);
                for (float y : {4.0f, 7.4f, 9.5f}) box({x, y, z - 2.34f}, {1.3f, 1.25f, 0.06f}, glass);
                obstacle({x, 0, z}, 1.4f, 4.6f);
            }
            box({75.0f, clearance + 0.2f, z}, {x1 - x0, 0.4f, 3.5f}, concrete);
            for (float zz : {z - 1.7f, z + 1.7f}) {
                box({75.0f, 10.0f, zz}, {40.0f, 0.18f, 0.16f}, steel);
                box({75.0f, 7.0f, zz}, {42.0f, 0.18f, 0.16f}, steel);
                for (float x = x0; x < x1; x += 6.0f) {
                    box({x, 8.5f, zz}, {0.16f, 3.0f, 0.16f}, steel);
                    const int index = static_cast<int>(std::lround((x - x0) / 6.0f));
                    box({x + 3.0f, 8.5f, zz}, {std::hypot(6.0f, 3.0f), 0.13f, 0.13f}, steel,
                        std::atan2((index % 2 ? -1.0f : 1.0f) * 3.0f, 6.0f));
                }
            }
            m_Landmarks.push_back({"Pasarela", {75.0f, 0.0f, z}});
        }

        // ---- Estacion Portal del Centro (TransitTerminal.js): isla accesible entre los dos carriles, Z -58 a -2 ----
        {
            using namespace Station;
            constexpr uint32_t concrete = 0xb4b5aa, steel = 0x48575b, red = 0xb32c35, yellow = 0xddbd35, glassTint = 0xaccbd0;
            box({kCenterX, 0.47f, kCenterZ}, {2 * kHalfWidth, 0.9f, kPlatformLength}, concrete);
            // rampas peatonales de cada extremo (cuña con superficie y flancos)
            const auto ramp = [&](float zLow, float zHigh) {
                const glm::vec4 color(0.706f, 0.710f, 0.667f, 1.0f);
                const glm::vec3 a(kCenterX - kHalfWidth, 0.0f, zLow), b(kCenterX + kHalfWidth, 0.0f, zLow);
                const glm::vec3 c(kCenterX + kHalfWidth, kPlatformHeight, zHigh), d(kCenterX - kHalfWidth, kPlatformHeight, zHigh);
                const auto face = [&](glm::vec3 p0, glm::vec3 p1, glm::vec3 p2, glm::vec3 p3, const glm::vec3& outward) {
                    glm::vec3 n = glm::cross(p1 - p0, p2 - p0);
                    if (glm::dot(n, outward) < 0.0f) { std::swap(p1, p3); n = glm::cross(p1 - p0, p2 - p0); }
                    n = glm::normalize(n);
                    const uint32_t base = static_cast<uint32_t>(landmarkVertices.size());
                    landmarkVertices.push_back({p0, n, {0, 0}, color});
                    landmarkVertices.push_back({p1, n, {1, 0}, color});
                    landmarkVertices.push_back({p2, n, {1, 1}, color});
                    landmarkVertices.push_back({p3, n, {0, 1}, color});
                    landmarkIndices.insert(landmarkIndices.end(), {base, base + 1, base + 2, base + 2, base + 3, base});
                };
                face(a, b, c, d, {0, 1, 0});
                const glm::vec3 lowLeft(kCenterX - kHalfWidth, 0.0f, zHigh), lowRight(kCenterX + kHalfWidth, 0.0f, zHigh);
                face(a, d, lowLeft, lowLeft, {-1, 0, 0});
                face(b, c, lowRight, lowRight, {1, 0, 0});
            };
            ramp(kNorthEnd, kNorthEnd + kRampLength);
            ramp(kSouthEnd, kSouthEnd - kRampLength);
            // estructura esbelta: columnas, cubierta y franjas rojas
            for (float z : {-49.0f, -43.0f, -35.0f, -27.0f, -19.0f, -11.0f})
                for (float x : {73.12f, 76.88f}) { box({x, 2.67f, z}, {0.14f, 3.5f, 0.14f}, steel); obstacle({x, 0.0f, z}, 0.14f, 0.14f, 0.05f); }
            box({kCenterX, 4.5f, kCenterZ}, {4.8f, 0.16f, 41.0f}, steel);
            for (float x : {73.0f, 77.0f}) box({x, 4.3f, kCenterZ}, {0.12f, 0.28f, 41.0f}, red);
            // galerias de vidrio con dos puertas por lado
            for (const auto& [a, b] : std::array<std::pair<float, float>, 3>{{{-50.0f, -43.0f}, {-39.0f, -25.0f}, {-21.0f, -10.0f}}}) {
                for (float x : {73.02f, 76.98f}) {
                    boxTo(glassVertices, glassIndices, 0.30f, {x, 2.15f, (a + b) * 0.5f}, {0.06f, 2.1f, b - a}, glassTint, 0.0f);
                    box({x, 1.1f, (a + b) * 0.5f}, {0.08f, 0.3f, b - a}, steel);
                }
            }
            for (float z : {-46.0f, -30.0f, -14.0f}) {
                box({74.0f, 1.12f, z}, {0.5f, 0.4f, 2.0f}, steel);
                box({73.8f, 1.55f, z}, {0.08f, 0.55f, 2.0f}, steel);
            }
            for (float x : {73.2f, 76.8f}) box({x, 0.935f, kCenterZ}, {0.09f, 0.015f, 40.0f}, yellow);
            for (float z : {-41.0f, -23.0f}) for (float x : {72.9f, 77.1f}) box({x, 3.75f, z}, {0.04f, 0.6f, 3.0f}, red);
            if (m_SignAtlas.GetTexture()) {
                for (const glm::vec3& normal : {glm::vec3(0, 0, 1), glm::vec3(0, 0, -1)}) {
                    appendSignQuad({75.0f, 3.9f, -9.8f}, normal, 3.6f, 0.8f, m_SignAtlas.Landmark(5), 0.0f, 0.0f);
                    appendSignQuad({75.0f, 3.9f, -30.0f}, normal, 3.6f, 0.8f, m_SignAtlas.Landmark(6), 0.0f, 0.0f);
                }
            }
            m_Landmarks.push_back({"Estación Portal del Centro", {kCenterX, 0.0f, kCenterZ}});
        }

        // ---- Torre Colpatria y su anexo (Colpatria.js): X 81, Z 168 ----
        {
            constexpr float x = 81.0f, z = 168.0f, w = 24.0f, d = 26.0f, height = 112.0f;
            constexpr uint32_t stone = 0xc1beb0, grey = 0xa9aaa5, glass = 0x26353b, frame = 0x505b60;
            box({x, (height - 2.0f) * 0.5f, z}, {w, height - 2.0f, d}, glass);
            box({x, height - 1.0f, z}, {w - 1.5f, 2.0f, d - 1.5f}, stone);
            const std::array<uint32_t, 3> lightColors{0xe52a32, 0x134bff, 0xffcc32};
            const std::array<std::array<float, 2>, 3> bands{{{25.0f, 38.0f}, {58.0f, 28.0f}, {91.0f, 38.0f}}};
            for (float side : {-1.0f, 1.0f}) {
                for (int i = 0; i <= 8; ++i) {
                    const float fx = x - w * 0.5f + 0.4f + static_cast<float>(i) * (w - 0.8f) / 8.0f;
                    box({fx, 55.0f, z + side * d * 0.5f}, {0.72f, 110.0f, 0.48f}, stone);
                    for (size_t band = 0; band < bands.size(); ++band)
                        boxTo(lightVertices, lightIndices, 1.0f, {fx, bands[band][0], z + side * (d * 0.5f + 0.25f)}, {0.11f, bands[band][1], 0.04f}, lightColors[band], 0.0f);
                }
                for (int i = 0; i <= 9; ++i) {
                    const float fz = z - d * 0.5f + 0.4f + static_cast<float>(i) * (d - 0.8f) / 9.0f;
                    box({x + side * w * 0.5f, 55.0f, fz}, {0.48f, 110.0f, 0.72f}, stone);
                    for (size_t band = 0; band < bands.size(); ++band)
                        boxTo(lightVertices, lightIndices, 1.0f, {x + side * (w * 0.5f + 0.25f), bands[band][0], fz}, {0.04f, bands[band][1], 0.11f}, lightColors[band], 0.0f);
                }
                // travesanos entre pisos: dan escala al vidrio incluso desde la calle
                for (float y = 5.0f; y < 110.0f; y += 3.0f) {
                    box({x, y, z + side * (d * 0.5f + 0.03f)}, {w, 0.16f, 0.05f}, frame);
                    box({x + side * (w * 0.5f + 0.03f), y, z}, {0.05f, 0.16f, d}, frame);
                }
            }
            // acceso vidriado con marquesina fina sobre la entrada norte
            box({x, 4.3f, z - d * 0.5f - 0.3f}, {7.0f, 0.25f, 1.1f}, stone);
            for (float offset : {-2.0f, 0.0f, 2.0f}) box({x + offset, 1.9f, z - d * 0.5f - 0.08f}, {0.09f, 3.8f, 0.08f}, frame);
            // anexo gris de 22 m con planta comercial acristalada bajo columnas
            constexpr float ax = 98.0f, az = 168.0f, aw = 10.0f, ad = 18.0f, ah = 22.0f;
            box({ax, ah * 0.5f, az}, {aw, ah, ad}, glass);
            box({ax, 13.5f, az}, {aw + 0.1f, 17.0f, ad + 0.1f}, grey);
            box({ax, 22.0f, az}, {aw + 0.25f, 0.4f, ad + 0.25f}, stone);
            for (float fz : {160.0f, 164.0f, 168.0f, 172.0f, 176.0f}) {
                box({103.15f, 2.5f, fz}, {0.6f, 5.0f, 0.6f}, stone);
                box({103.08f, 13.4f, fz}, {0.06f, 16.5f, 0.08f}, frame);
            }
            for (float fx : {94.0f, 98.0f, 102.0f}) box({fx, 2.5f, 158.85f}, {0.6f, 5.0f, 0.6f}, stone);
            box({103.18f, 3.55f, az}, {0.15f, 0.3f, 18.4f}, stone);
            if (m_SignAtlas.GetTexture()) {
                appendSignQuad({81.0f, 4.8f, 154.91f}, {0, 0, -1}, 8.0f, 2.0f, m_SignAtlas.Landmark(7), 0.0f, 0.0f);
                appendSignQuad({103.16f, 6.5f, 173.0f}, {1, 0, 0}, 7.0f, 1.75f, m_SignAtlas.Landmark(8), 0.0f, 0.0f);
                appendSignQuad({103.19f, 3.9f, 165.0f}, {1, 0, 0}, 6.0f, 1.5f, m_SignAtlas.Landmark(9), 0.0f, 0.0f);
            }
            m_Landmarks.push_back({"Torre Colpatria", {x, 0.0f, z}});
        }
        if (!lightVertices.empty()) m_ColpatriaLightMesh = std::make_shared<Mesh>(lightVertices, lightIndices);
        if (!glassVertices.empty()) m_GlassMesh = std::make_shared<Mesh>(glassVertices, glassIndices);

        // ---- Viaducto elevado y puente del lago (Viaduct.hpp): tablero curvo de 14 m con barandas y pilares ----
        {
            const glm::vec4 asphalt(0.20f, 0.21f, 0.23f, 1.0f), concreteSide(0.62f, 0.62f, 0.60f, 1.0f),
                            underside(0.40f, 0.40f, 0.39f, 1.0f), railColor(0.80f, 0.80f, 0.78f, 1.0f),
                            marking(0.94f, 0.76f, 0.20f, 1.0f);
            // Cuadrilatero con el frente hacia `outward` (se invierte el orden si el sentido no coincide)
            const auto quad = [&](glm::vec3 a, glm::vec3 b, glm::vec3 c, glm::vec3 d, const glm::vec3& outward, const glm::vec4& color) {
                glm::vec3 n = glm::cross(b - a, c - a);
                if (glm::dot(n, outward) < 0.0f) { std::swap(b, d); n = glm::cross(b - a, c - a); }
                n = glm::normalize(n);
                const uint32_t base = static_cast<uint32_t>(landmarkVertices.size());
                landmarkVertices.push_back({a, n, {0, 0}, color});
                landmarkVertices.push_back({b, n, {1, 0}, color});
                landmarkVertices.push_back({c, n, {1, 1}, color});
                landmarkVertices.push_back({d, n, {0, 1}, color});
                landmarkIndices.insert(landmarkIndices.end(), {base, base + 1, base + 2, base + 2, base + 3, base});
            };
            // Viga de seccion rectangular entre dos puntos (la seccion es plana en X y Y)
            const auto beam = [&](const glm::vec3& p0, const glm::vec3& p1, float halfWidth, float halfHeight, const glm::vec4& color) {
                const auto corner = [&](const glm::vec3& p, float sx, float sy) { return p + glm::vec3(sx * halfWidth, sy * halfHeight, 0.0f); };
                quad(corner(p0, -1, 1), corner(p0, 1, 1), corner(p1, 1, 1), corner(p1, -1, 1), {0, 1, 0}, color);
                quad(corner(p0, -1, -1), corner(p0, 1, -1), corner(p1, 1, -1), corner(p1, -1, -1), {0, -1, 0}, color);
                quad(corner(p0, 1, -1), corner(p0, 1, 1), corner(p1, 1, 1), corner(p1, 1, -1), {1, 0, 0}, color);
                quad(corner(p0, -1, -1), corner(p0, -1, 1), corner(p1, -1, 1), corner(p1, -1, -1), {-1, 0, 0}, color);
            };
            using namespace Viaduct;
            // Normal suave de la superficie (sigue la pendiente y la curva del eje): sin facetas entre segmentos
            const auto deckNormal = [&](float zz) {
                const glm::vec2 lateral2 = BridgeNormal(zz);
                const float dc = (BridgeCenter(zz + 0.05f) - BridgeCenter(zz - 0.05f)) / 0.1f;
                const float slope = (Height(zz + 0.05f) - Height(zz - 0.05f)) / 0.1f;
                glm::vec3 up = glm::normalize(glm::cross(glm::vec3(dc, slope, 1.0f), glm::vec3(lateral2.x, 0.0f, lateral2.y)));
                return up.y < 0.0f ? -up : up;
            };
            const auto smoothTop = [&](glm::vec3 a, glm::vec3 b, glm::vec3 c, glm::vec3 d, const glm::vec3& n0, const glm::vec3& n1, const glm::vec4& color) {
                // a, b en el segmento de atras (borde izquierdo y derecho) y c, d en el de adelante
                std::array<glm::vec3, 4> position{a, b, d, c};
                std::array<glm::vec3, 4> normal{n0, n0, n1, n1};
                if (glm::dot(glm::cross(position[1] - position[0], position[2] - position[0]), n0) < 0.0f) { std::swap(position[1], position[3]); std::swap(normal[1], normal[3]); }
                const uint32_t first = static_cast<uint32_t>(landmarkVertices.size());
                const std::array<glm::vec2, 4> uv{{{0, 0}, {1, 0}, {1, 1}, {0, 1}}};
                for (size_t i = 0; i < 4; ++i) landmarkVertices.push_back({position[i], normal[i], uv[i], color});
                landmarkIndices.insert(landmarkIndices.end(), {first, first + 1, first + 2, first + 2, first + 3, first});
            };
            int step = 0;
            // segmentos de 0,5 m: el perfil en coseno de las rampas se ve continuo, sin cortes poligonales
            for (float z = kStartZ; z < kEndZ; z = std::min(std::floor(z * 2.0f) / 2.0f + 0.5f, kEndZ), ++step) {
                const float next = std::min(std::floor(z * 2.0f) / 2.0f + 0.5f, kEndZ);
                const float h0 = Height(z), h1 = Height(next);
                const glm::vec2 a2 = Edge(z, -1.0f), b2 = Edge(z, 1.0f), c2 = Edge(next, -1.0f), d2 = Edge(next, 1.0f);
                const glm::vec3 a(a2.x, h0, a2.y), b(b2.x, h0, b2.y), c(c2.x, h1, c2.y), d(d2.x, h1, d2.y);
                const glm::vec3 drop(0.0f, -kThickness, 0.0f);
                smoothTop(a, b, c, d, deckNormal(z), deckNormal(next), asphalt);
                quad(a + drop, b + drop, d + drop, c + drop, {0, -1, 0}, underside);
                quad(a + drop, c + drop, c, a, {-1, 0, 0}, concreteSide);
                quad(b + drop, d + drop, d, b, {1, 0, 0}, concreteSide);
                // baranda: pasamanos y barra intermedia por cada borde, con un poste cada 3 m
                for (float side : {-1.0f, 1.0f}) {
                    const glm::vec2 normal0 = BridgeNormal(z), normal1 = BridgeNormal(next);
                    const glm::vec2 e0 = Edge(z, side) - normal0 * side * 0.25f, e1 = Edge(next, side) - normal1 * side * 0.25f;
                    beam({e0.x, h0 + 1.05f, e0.y}, {e1.x, h1 + 1.05f, e1.y}, 0.06f, 0.05f, railColor);
                    beam({e0.x, h0 + 0.55f, e0.y}, {e1.x, h1 + 0.55f, e1.y}, 0.04f, 0.035f, railColor);
                    if (step % 6 == 0 && z > kStartZ + 1.5f) box({e0.x, h0 + 0.55f, e0.y}, {0.12f, 1.1f, 0.12f}, 0xc9c9c2);
                }
                // linea central discontinua
                if (step % 8 < 4) {
                    const glm::vec2 m0 = (a2 + b2) * 0.5f, m1 = (c2 + d2) * 0.5f;
                    quad({m0.x - 0.07f, h0 + 0.012f, m0.y}, {m0.x + 0.07f, h0 + 0.012f, m0.y}, {m1.x + 0.07f, h1 + 0.012f, m1.y},
                         {m1.x - 0.07f, h1 + 0.012f, m1.y}, {0, 1, 0}, marking);
                }
            }
            // Pilares fuera de las calzadas inferiores
            for (const glm::vec2& pillar : PillarPositions([&](float x, float z) { return GetTileAt(static_cast<int>(std::floor((x + ORIGIN_X) / TILE_SIZE)),
                                                                                                    static_cast<int>(std::floor((z + ORIGIN_Z) / TILE_SIZE))) == TileType::Road; })) {
                const float top = Height(pillar.y) - 0.7f;
                if (top < 1.0f) continue;
                box({pillar.x, top * 0.5f, pillar.y}, {1.3f, top, 1.3f}, 0x9a9d98);
                obstacle({pillar.x, 0, pillar.y}, 1.3f, 1.3f);
            }
        }

        // ---- Postes de nomenclatura vial (streetSign del original): uno por cada esquina de calle y carrera, y los
        //      de los parques y el lago. Poste de 2,8 m con dos placas cruzadas, legibles por ambas caras ----
        if (m_SignAtlas.GetTexture()) {
            const auto streetPost = [&](float px, float pz, const std::string& first, const std::string& second) {
                if (!IsWalkable(px, pz) || IsBlocked(px, pz, 0.2f)) return;   // solo sobre suelo libre
                box({px, 1.4f, pz}, {0.08f, 2.8f, 0.08f}, 0x666666);
                obstacle({px, 0.0f, pz}, 0.08f, 0.08f, 0.15f);
                const std::array<std::string, 2> lines{first, second};
                for (size_t line = 0; line < lines.size(); ++line) {
                    if (lines[line].empty()) continue;
                    const SignUV uv = m_SignAtlas.StreetName(lines[line]);
                    const float y = 2.65f - static_cast<float>(line) * 0.32f;
                    const glm::vec3 front = line % 2 == 0 ? glm::vec3(0, 0, 1) : glm::vec3(1, 0, 0);
                    appendSignQuad({px, y, pz}, front, 1.1f, 0.28f, uv, 0.0f, 0.0f);
                    appendSignQuad({px, y, pz}, -front, 1.1f, 0.28f, uv, 0.0f, 0.0f);
                }
            };
            std::vector<std::pair<Band, std::string>> avenues;
            for (size_t i = 0; i < m_Data.carreras.size(); ++i) avenues.emplace_back(m_Data.carreras[i], m_Data.carrerasNames[i]);
            avenues.emplace_back(Band{m_Data.caracasLanes.front().first, m_Data.caracasLanes.back().last}, "Av. Caracas");
            for (size_t s = 0; s < m_Data.calles.size(); ++s) {
                for (const auto& [avenue, avenueName] : avenues) {
                    // esquina noroeste del cruce, a una baldosa de la calzada
                    streetPost(static_cast<float>(avenue.first - 1) * TILE_SIZE, static_cast<float>(m_Data.calles[s].first - 1) * TILE_SIZE,
                               m_Data.callesNames[s], avenueName);
                }
            }
            for (const ParkSign& sign : m_Data.parkSigns) streetPost(sign.x, sign.z, sign.lines[0], sign.lines[1]);
        }

        // Parque del Lago: el radar lo marca en el centro del agua
        m_Landmarks.push_back({"Parque del Lago", {75.0f, 0.0f, 262.0f}});

        if (!landmarkVertices.empty()) m_LandmarkMesh = std::make_shared<Mesh>(landmarkVertices, landmarkIndices);
    }
    if (!buildingVertices.empty()) m_BuildingMesh = std::make_shared<Mesh>(buildingVertices, buildingIndices);
    if (!windowLightVertices.empty()) m_WindowLightMesh = std::make_shared<Mesh>(windowLightVertices, windowLightIndices);
    if (!detailVertices.empty()) m_FacadeDetailMesh = std::make_shared<Mesh>(detailVertices, detailIndices);
    if (!signVertices.empty()) m_SignMesh = std::make_shared<Mesh>(signVertices, signIndices);
}

void CityLayout::Render(Renderer& renderer, const glm::vec3& focusPosition) {
    if (m_GroundMesh) {
        m_AsphaltTexture->BindUnit(0);
        renderer.Submit(*m_GroundMesh, glm::mat4(1.0f), glm::vec4(1.0f), true);
    }
    if (m_SidewalkMesh) {
        m_SidewalkTexture->BindUnit(0);
        renderer.Submit(*m_SidewalkMesh, glm::mat4(1.0f), glm::vec4(1.0f), true);
    }
    if (m_NatureMesh) {
        renderer.Submit(*m_NatureMesh, glm::mat4(1.0f), glm::vec4(1.0f));
    }

    if (m_MarkingMesh) renderer.Submit(*m_MarkingMesh, glm::mat4(1.0f));
    if (m_LandmarkMesh) renderer.Submit(*m_LandmarkMesh, glm::mat4(1.0f));
    if (m_ColpatriaLightMesh) {
        // de dia las franjas de la torre son colores apagados; de noche brillan sin iluminacion
        const float dim = 0.55f;
        const glm::vec4 tint = m_NightGlow > 0.5f ? glm::vec4(1.0f) : glm::vec4(dim, dim, dim, 1.0f);
        renderer.SetUnlit(m_NightGlow > 0.5f);
        renderer.Submit(*m_ColpatriaLightMesh, glm::mat4(1.0f), tint);
        renderer.SetUnlit(false);
    }
    if (m_GlassMesh) renderer.Submit(*m_GlassMesh, glm::mat4(1.0f), glm::vec4(1.0f), false, false, nullptr, 2);
    if (m_BuildingMesh) {
        m_BrickTexture->BindUnit(0);
        renderer.Submit(*m_BuildingMesh, glm::mat4(1.0f), glm::vec4(1.0f), true);
    }
    if (m_FacadeDetailMesh) renderer.Submit(*m_FacadeDetailMesh, glm::mat4(1.0f));
    if (m_WindowLightMesh && m_NightGlow > 0.05f) {
        // apartamentos con la luz encendida: aparecen al oscurecer, junto con las farolas
        renderer.SetUnlit(true);
        renderer.Submit(*m_WindowLightMesh, glm::mat4(1.0f), glm::vec4(m_NightGlow, m_NightGlow, m_NightGlow, 1.0f));
        renderer.SetUnlit(false);
    }
    if (m_SignMesh && m_SignAtlas.GetTexture()) {
        m_SignAtlas.GetTexture()->BindUnit(0);
        renderer.Submit(*m_SignMesh, glm::mat4(1.0f), glm::vec4(1.0f), true, false, nullptr, 2); // mezcla alfa: grafitis con fondo transparente
    }
    for (const auto& building : m_Buildings) {
        if (building.modelVariant < 0) continue;
        const glm::vec2 offset(building.position.x - focusPosition.x,
                               building.position.z - focusPosition.z);
        if (glm::dot(offset, offset) > 85.0f * 85.0f) continue;
        const glm::vec3 boundsCenter = building.position;
        const float groundY = boundsCenter.y - building.size.y * 0.5f;
        const glm::vec3 targetFootprint(
            std::max(0.5f, building.size.x - 1.0f),
            building.size.y,
            std::max(0.5f, building.size.z - 1.0f));
        const auto fittedTransform = [&](const Model& model, const glm::vec3& position,
                                         const glm::vec3& targetSize) {
            const glm::vec3 extent = model.GetBoundsMaximum() - model.GetBoundsMinimum();
            if (glm::any(glm::lessThanEqual(extent, glm::vec3(0.0001f)))) return glm::mat4(1.0f);
            return glm::translate(glm::mat4(1.0f), position)
                * glm::scale(glm::mat4(1.0f), targetSize / extent)
                * glm::translate(glm::mat4(1.0f),
                    {-((model.GetBoundsMinimum().x + model.GetBoundsMaximum().x) * 0.5f),
                     -model.GetBoundsMinimum().y,
                     -((model.GetBoundsMinimum().z + model.GetBoundsMaximum().z) * 0.5f)});
        };
        if (building.modelVariant == 1) {
            const float bottomHeight = building.size.y * 0.25f;
            const float middleHeight = building.size.y * 0.5f;
            const float topHeight = building.size.y - bottomHeight - middleHeight;
            const std::array<float, 3> sectionHeights{{bottomHeight, middleHeight, topHeight}};
            float sectionY = groundY;
            for (size_t section = 0; section < m_ModularBuildingModels.size(); ++section) {
                const float height = sectionHeights[section];
                const glm::vec3 targetSize(targetFootprint.x, height, targetFootprint.z);
                m_ModularBuildingModels[section]->Draw(
                    renderer, fittedTransform(*m_ModularBuildingModels[section],
                                              {boundsCenter.x, sectionY, boundsCenter.z}, targetSize));
                sectionY += height;
            }
        } else {
            const auto& model = m_BuildingModels[building.modelVariant == 0 ? 0 : 1];
            if (!model) continue;
            model->Draw(renderer, fittedTransform(*model,
                                                   {boundsCenter.x, groundY, boundsCenter.z},
                                                   targetFootprint));
        }
    }
}

} // namespace Bazuko
