#include "Simulation.hpp"
#include "Viaduct.hpp"
#include "Station.hpp"
#include <glm/gtc/matrix_transform.hpp>
#include <algorithm>
#include <array>
#include <cmath>
#include <filesystem>
#include "../character/CharacterAnimations.hpp"
#include "../core/Log.hpp"
#include "../core/Paths.hpp"
#include "../game/Harvest.hpp"
#include <limits>
#include <queue>
#include <unordered_map>

namespace Bazuko {

namespace {

constexpr size_t kRainDropCount = 350;   // gotas alrededor del jugador, como el original
constexpr float kDayLengthSeconds = 3600.0f;   // un dia de juego = una hora real, como el original

std::vector<glm::vec3> MakeTrafficCircuit(float left, float right, float top, float bottom) {
    constexpr float radius = 1.0f;
    constexpr float spacing = 0.45f;
    std::vector<glm::vec3> points;
    const auto appendLine = [&](const glm::vec3& start, const glm::vec3& end) {
        const float length = glm::distance(start, end);
        const int steps = std::max(1, static_cast<int>(std::ceil(length / spacing)));
        for (int step = points.empty() ? 0 : 1; step <= steps; ++step)
            points.push_back(glm::mix(start, end, static_cast<float>(step) / steps));
    };
    const auto appendArc = [&](float centerX, float centerZ, float startAngle) {
        const float arcLength = glm::half_pi<float>() * radius;
        const int steps = std::max(1, static_cast<int>(std::ceil(arcLength / spacing)));
        for (int step = points.empty() ? 0 : 1; step <= steps; ++step) {
            const float angle = startAngle + glm::half_pi<float>() * static_cast<float>(step) / steps;
            points.emplace_back(centerX + std::cos(angle) * radius, 0.0f,
                                centerZ + std::sin(angle) * radius);
        }
    };
    appendLine({left + radius, 0.0f, top}, {right - radius, 0.0f, top});
    appendArc(right - radius, top + radius, -glm::half_pi<float>());
    appendLine({right, 0.0f, top + radius}, {right, 0.0f, bottom - radius});
    appendArc(right - radius, bottom - radius, 0.0f);
    appendLine({right - radius, 0.0f, bottom}, {left + radius, 0.0f, bottom});
    appendArc(left + radius, bottom - radius, glm::half_pi<float>());
    appendLine({left, 0.0f, bottom - radius}, {left, 0.0f, top + radius});
    appendArc(left + radius, top + radius, glm::pi<float>());
    return points;
}

float GetCircuitLength(const std::vector<glm::vec3>& points) {
    float length = 0.0f;
    for (size_t index = 1; index < points.size(); ++index) length += glm::distance(points[index - 1], points[index]);
    return length + glm::distance(points.back(), points.front());
}

void SampleCircuit(const std::vector<glm::vec3>& points, const std::vector<float>& cumulative,
                   float routeLength, float distance, glm::vec3& position, glm::vec3& direction,
                   size_t& nextWaypoint) {
    float remaining = std::fmod(distance, routeLength);
    if (remaining < 0.0f) remaining += routeLength;
    const auto upper = std::upper_bound(cumulative.begin(), cumulative.end(), remaining);
    const size_t index = upper == cumulative.begin() ? 0 : static_cast<size_t>(upper - cumulative.begin() - 1);
    nextWaypoint = (index + 1) % points.size();
    direction = glm::normalize(points[nextWaypoint] - points[index]);
    position = points[index] + direction * (remaining - cumulative[index]);
}

bool OrientedBoxesOverlap(const glm::vec3& positionA, const glm::vec2& directionA,
                         float lengthA, float widthA, const glm::vec3& positionB,
                         const glm::vec2& directionB, float lengthB, float widthB) {
    const glm::vec2 forwardA = glm::normalize(directionA);
    const glm::vec2 forwardB = glm::normalize(directionB);
    const glm::vec2 sideA(-forwardA.y, forwardA.x);
    const glm::vec2 sideB(-forwardB.y, forwardB.x);
    const glm::vec2 offset(positionB.x - positionA.x, positionB.z - positionA.z);
    for (const glm::vec2& axis : {forwardA, sideA, forwardB, sideB}) {
        const float radiusA = lengthA * 0.5f * std::abs(glm::dot(axis, forwardA))
            + widthA * 0.5f * std::abs(glm::dot(axis, sideA));
        const float radiusB = lengthB * 0.5f * std::abs(glm::dot(axis, forwardB))
            + widthB * 0.5f * std::abs(glm::dot(axis, sideB));
        if (std::abs(glm::dot(offset, axis)) > radiusA + radiusB) return false;
    }
    return true;
}

bool PointInVehicleBox(const glm::vec3& point, const glm::vec3& center,
                       const glm::vec2& forward, float halfLength, float halfWidth,
                       float padding) {
    const glm::vec2 normalizedForward = glm::normalize(forward);
    const glm::vec2 side(-normalizedForward.y, normalizedForward.x);
    const glm::vec2 offset(point.x - center.x, point.z - center.z);
    return std::abs(glm::dot(offset, normalizedForward)) <= halfLength + padding
        && std::abs(glm::dot(offset, side)) <= halfWidth + padding;
}

bool PointAtVehicleFront(const glm::vec3& point, const glm::vec3& center,
                         const glm::vec2& forward, float halfLength, float halfWidth,
                         float playerRadius) {
    const glm::vec2 normalizedForward = glm::normalize(forward);
    const glm::vec2 side(-normalizedForward.y, normalizedForward.x);
    const glm::vec2 offset(point.x - center.x, point.z - center.z);
    const float along = glm::dot(offset, normalizedForward);
    const float across = std::abs(glm::dot(offset, side));
    return along >= halfLength - 0.65f - playerRadius
        && along <= halfLength + playerRadius
        && across <= halfWidth + playerRadius;
}

size_t GetSignalState(float time, size_t axis) {
    constexpr float cycle = 36.0f;
    const float phase = std::fmod(time - static_cast<float>(axis) * 18.0f + cycle, cycle);
    if (phase < 14.0f) return 0;
    if (phase < 17.0f) return 1;
    return 2;
}

bool IsVehicleBeforeSignal(const TrafficVehicle& vehicle, const glm::vec3& stopPosition,
                           const glm::vec2& forward, const glm::vec3& approachDirection,
                           float* distanceOut = nullptr) {
    const glm::vec2 toStop(stopPosition.x - vehicle.position.x, stopPosition.z - vehicle.position.z);
    const float along = glm::dot(toStop, forward);
    const float lateral = std::abs(forward.x * toStop.y - forward.y * toStop.x);
    if (along <= 0.0f || lateral > 2.6f) return false;
    if (glm::dot(approachDirection, glm::vec3(forward.x, 0.0f, forward.y)) <= 0.85f) return false;
    if (distanceOut) *distanceOut = along;
    return true;
}


glm::mat4 FitModelTransform(const Model& model, const glm::vec3& targetSize, float yaw, bool anchorAtPole = false) {
    const glm::vec3 sourceMin = model.GetBoundsMinimum();
    const glm::vec3 sourceMax = model.GetBoundsMaximum();
    const glm::mat4 rotation = glm::rotate(glm::mat4(1.0f), yaw, {0.0f, 1.0f, 0.0f});
    glm::vec3 orientedMin(std::numeric_limits<float>::max());
    glm::vec3 orientedMax(std::numeric_limits<float>::lowest());
    for (int corner = 0; corner < 8; ++corner) {
        const glm::vec3 point(
            (corner & 1) ? sourceMax.x : sourceMin.x,
            (corner & 2) ? sourceMax.y : sourceMin.y,
            (corner & 4) ? sourceMax.z : sourceMin.z);
        const glm::vec3 oriented = glm::vec3(rotation * glm::vec4(point, 1.0f));
        orientedMin = glm::min(orientedMin, oriented);
        orientedMax = glm::max(orientedMax, oriented);
    }
    const glm::vec3 extent = orientedMax - orientedMin;
    if (glm::any(glm::lessThanEqual(extent, glm::vec3(0.0001f)))) return glm::mat4(1.0f);
    glm::vec3 center = (orientedMin + orientedMax) * 0.5f;
    if (anchorAtPole) {
        const glm::vec3 anchor = glm::vec3(rotation * glm::vec4(model.GetGroundAnchor(), 1.0f));
        center.x = anchor.x;
        center.z = anchor.z;
    }
    return glm::scale(glm::mat4(1.0f), targetSize / extent)
        * glm::translate(glm::mat4(1.0f), {-center.x, -orientedMin.y, -center.z})
        * rotation;
}

std::shared_ptr<Mesh> MakeTrashBagMesh(size_t variant) {
    constexpr uint32_t segments = 12;
    const float phase = static_cast<float>(variant) * 0.73f;
    const float width = 0.88f + static_cast<float>(variant % 3) * 0.08f;
    const float height = 0.90f + static_cast<float>(variant % 4) * 0.06f;
    const std::array<std::pair<float, float>, 8> profile{{
        {0.025f, 0.12f}, {0.07f, 0.25f}, {0.18f, 0.34f}, {0.34f, 0.37f},
        {0.49f, 0.31f}, {0.59f, 0.20f}, {0.65f, 0.095f}, {0.74f, 0.07f}
    }};
    const glm::vec4 bagColor(0.12f + static_cast<float>(variant % 3) * 0.012f,
                             0.13f + static_cast<float>(variant % 2) * 0.012f,
                             0.14f + static_cast<float>(variant % 4) * 0.008f, 1.0f);
    std::vector<Vertex> vertices;
    std::vector<uint32_t> indices;
    vertices.reserve(profile.size() * (segments + 1) + segments + 4);
    indices.reserve((profile.size() + 1) * segments * 6);

    for (size_t ring = 0; ring < profile.size(); ++ring) {
        const float y = profile[ring].first * height;
        const float radius = profile[ring].second * width;
        for (uint32_t segment = 0; segment <= segments; ++segment) {
            const float angle = glm::two_pi<float>() * static_cast<float>(segment) / segments;
            const float crease = 1.0f + 0.055f * std::sin(angle * 3.0f + phase)
                                      + 0.025f * std::sin(angle * 5.0f - phase);
            const float radial = radius * crease;
            const glm::vec3 normal = glm::normalize(glm::vec3(std::cos(angle), 0.22f, std::sin(angle)));
            const float highlight = (segment % 4 == variant % 4) ? 0.10f : 0.0f;
            const glm::vec4 color = glm::min(bagColor + glm::vec4(highlight, highlight, highlight, 0.0f),
                                             glm::vec4(1.0f));
            vertices.push_back({{std::cos(angle) * radial, y, std::sin(angle) * radial * 0.88f},
                                normal, {static_cast<float>(segment) / segments,
                                         static_cast<float>(ring) / static_cast<float>(profile.size() - 1)}, color});
        }
    }

    const uint32_t ringSize = segments + 1;
    for (uint32_t ring = 0; ring + 1 < profile.size(); ++ring) {
        for (uint32_t segment = 0; segment < segments; ++segment) {
            const uint32_t lower = ring * ringSize + segment;
            const uint32_t upper = lower + ringSize;
            indices.insert(indices.end(), {lower, upper, upper + 1, lower, upper + 1, lower + 1});
        }
    }

    const uint32_t bottomCenter = static_cast<uint32_t>(vertices.size());
    vertices.push_back({{0.0f, profile.front().first * height, 0.0f}, {0.0f, -1.0f, 0.0f}, {0.5f, 0.5f}, bagColor});
    const uint32_t topCenter = static_cast<uint32_t>(vertices.size());
    vertices.push_back({{0.0f, profile.back().first * height, 0.0f}, {0.0f, 1.0f, 0.0f}, {0.5f, 0.5f}, bagColor});
    const uint32_t lastRing = static_cast<uint32_t>(profile.size() - 1) * ringSize;
    for (uint32_t segment = 0; segment < segments; ++segment) {
        const uint32_t next = (segment + 1) % segments;
        indices.insert(indices.end(), {bottomCenter, segment, next});
        indices.insert(indices.end(), {topCenter, lastRing + next, lastRing + segment});
    }

    const uint32_t knotBase = static_cast<uint32_t>(vertices.size());
    const float knotY = profile.back().first * height;
    for (uint32_t segment = 0; segment < segments; ++segment) {
        const float angle = glm::two_pi<float>() * static_cast<float>(segment) / segments;
        const float radius = 0.07f * (1.0f + 0.12f * std::sin(angle * 3.0f + phase));
        const glm::vec3 normal = glm::normalize(glm::vec3(std::cos(angle), 0.45f, std::sin(angle)));
        vertices.push_back({{std::cos(angle) * radius, knotY + 0.055f * height, std::sin(angle) * radius},
                            normal, {0.5f, 1.0f}, bagColor});
    }
    const uint32_t knotTip = static_cast<uint32_t>(vertices.size());
    vertices.push_back({{0.045f * std::sin(phase), knotY + 0.16f * height, 0.035f * std::cos(phase)},
                        {0.0f, 1.0f, 0.0f}, {0.5f, 1.0f}, bagColor});
    for (uint32_t segment = 0; segment < segments; ++segment) {
        const uint32_t next = (segment + 1) % segments;
        indices.insert(indices.end(), {knotBase + segment, knotTip, knotBase + next});
    }

    return std::make_shared<Mesh>(vertices, indices);
}

}

Simulation::Simulation(const CityLayout& city, uint32_t seed,
                       ModelLoadProgress modelLoadProgress)
    : m_City(city), m_Random(seed) {
    m_PedestrianBody = Mesh::CreateCube({0.34f, 1.05f, 0.25f}, {0.48f, 0.34f, 0.25f, 1.0f});
    m_PedestrianHead = Mesh::CreateCube({0.24f, 0.25f, 0.24f}, {0.62f, 0.46f, 0.34f, 1.0f});
    std::string modelsRoot;
    {
        std::string animationFile = Paths::Find("public/models/animaciones-actionforge.glb");
        if (!std::filesystem::exists(animationFile)) animationFile = Paths::Find("public/models/animaciones-prueba.glb");
        if (std::filesystem::exists(animationFile)) modelsRoot = std::filesystem::path(animationFile).parent_path().generic_string() + "/";
    }
    // Modelos fuente que solo usa el port nativo: viven en cpp/modelos para no publicarse con el juego web.
    const std::string sourceModelsRoot = Paths::Find("modelos") + "/";
    if (!modelsRoot.empty()) {
        const std::array<std::array<std::string, 4>, 12> outfits{{
            {{"hombre-joven", "chaqueta", "tenis-rotos", "corto"}},
            {{"hombre-joven", "buzo", "tenis", "crespo"}},
            {{"hombre-adulto", "buzo", "zapatos", "desordenado"}},
            {{"hombre-adulto", "camisa", "botas", "largo"}},
            {{"hombre-mayor", "saco", "botas", "rapado"}},
            {{"hombre-mayor", "overol", "tenis", "candado"}},
            {{"mujer-joven", "sudadera", "tenis", "largo"}},
            {{"mujer-joven", "blusa", "botas", "crespo"}},
            {{"mujer-adulta", "blusa", "tenis", "corto"}},
            {{"mujer-adulta", "sudadera", "botas", "melena"}},
            {{"mujer-mayor", "saco", "botas", "melena"}},
            {{"mujer-mayor", "sudadera", "tenis-rotos", "rapado"}}
        }};
        const std::array<std::string, 8> importedFiles{{
            "car1.opt.glb", "car2.opt.glb", "tm.opt.glb", "cambuche.opt.glb",
            "bolsa.opt.glb", "contenedor.opt.glb", "lamparas.opt.glb", "semaforo.opt.glb"
        }};
        const size_t totalModelLoads = 1 + outfits.size() * outfits.front().size() + importedFiles.size() + 9;
        size_t completedModelLoads = 0;
        const auto reportModelLoad = [&](const std::string& name = "") {
            if (modelLoadProgress) modelLoadProgress(++completedModelLoads, totalModelLoads, name);
        };

        std::string animationPath = modelsRoot + "animaciones-actionforge.glb";
        if (!std::filesystem::exists(animationPath)) animationPath = modelsRoot + "animaciones-prueba.glb";
        m_PedestrianAnimation = Model::LoadFromFile(animationPath);
        reportModelLoad("Animaciones de peatones (ActionForge)");

        std::unordered_map<std::string, std::shared_ptr<Model>> modelCache;
        for (const auto& outfit : outfits) {
            PedestrianAppearance appearance;
            for (size_t partIndex = 0; partIndex < outfit.size(); ++partIndex) {
                const std::string filename = partIndex == 0 ? "cuerpo.gltf" : outfit[partIndex] + ".gltf";
                const std::string path = modelsRoot + "personaje/" + outfit[0] + "/" + filename;
                auto found = modelCache.find(path);
                std::shared_ptr<Model> model;
                if (found != modelCache.end()) model = found->second;
                else {
                    model = Model::LoadFromFile(path);
                    if (model && m_PedestrianAnimation)
                        model->SetAnimationSource(*m_PedestrianAnimation, CharacterAnimationAliases());
                    if (model) modelCache.emplace(path, model);
                }
                appearance.parts.push_back(std::move(model));
                reportModelLoad();
            }
            if (!appearance.parts.empty() && appearance.parts.front()) {
                appearance.idleClip = appearance.parts.front()->FindAnimationClip("Idle");
                appearance.walkClip = appearance.parts.front()->FindAnimationClip("Walk");
                appearance.sitClip = appearance.idleClip;
                m_PedestrianAppearances.push_back(std::move(appearance));
            }
        }
        for (size_t index = 0; index < importedFiles.size(); ++index) {
            const std::string path = modelsRoot + importedFiles[index];
            std::shared_ptr<Model> model;
            if (std::filesystem::exists(path)) model = Model::LoadFromFile(path);
            else LogWarn("No se encontro el modelo nativo: {}", path);
            switch (index) {
                case 0:
                    m_CarModel = std::move(model);
                    if (m_CarModel) m_CarModelFit = FitModelTransform(*m_CarModel, {4.3f, 1.75f, 1.76f}, glm::pi<float>());
                    break;
                case 1:
                    m_TaxiModel = std::move(model);
                    if (m_TaxiModel) m_TaxiModelFit = FitModelTransform(*m_TaxiModel, {4.3f, 1.45f, 1.76f}, glm::pi<float>());
                    break;
                case 2:
                    m_BusModel = std::move(model);
                    if (m_BusModel) m_BusModelFit = FitModelTransform(*m_BusModel, {2.52f, 3.5f, 18.2f}, -glm::half_pi<float>());
                    break;
                case 3:
                    m_ShelterModel = std::move(model);
                    if (m_ShelterModel) m_ShelterModelFit = FitModelTransform(*m_ShelterModel, {3.91f, 2.1f, 2.875f}, 0.0f);
                    break;
                case 4:
                    m_TrashBagModel = std::move(model);
                    if (m_TrashBagModel) m_TrashBagModelFit = FitModelTransform(*m_TrashBagModel, {1.1f, 1.095f, 0.864f}, 0.0f);
                    break;
                case 5:
                    m_TrashContainerModel = std::move(model);
                    if (m_TrashContainerModel) m_TrashContainerModelFit = FitModelTransform(*m_TrashContainerModel, {1.56f, 1.4f, 1.12f}, 0.0f);
                    break;
                case 6:
                    m_StreetLampModel = std::move(model);
                    if (m_StreetLampModel) m_StreetLampModelFit = FitModelTransform(*m_StreetLampModel, {2.163f, 4.2f, 0.53f}, glm::half_pi<float>(), true);
                    break;
                case 7:
                    m_TrafficSignalModel = std::move(model);
                    if (m_TrafficSignalModel) m_TrafficSignalModelFit = FitModelTransform(*m_TrafficSignalModel, {1.66f, 4.3f, 0.893f}, 0.0f);
                    break;
                default: break;
            }
            reportModelLoad(importedFiles[index]);
        }
        m_TreeModel = Model::LoadFromFile(sourceModelsRoot + "Arbol 1/FBX format/conifer_macedonian_pine.fbx");
        if (m_TreeModel)
            m_TreeModelFit = FitModelTransform(*m_TreeModel, {2.8f, 5.4f, 2.8f}, 0.0f, true);
        reportModelLoad("Vegetación: Pino macedonio FBX");
        m_VendorChairModel = Model::LoadFromFile(
            sourceModelsRoot + "Silla plastica/plastic+chair.obj", "Chair_lv_1");
        if (m_VendorChairModel)
            m_VendorChairModelFit = FitModelTransform(*m_VendorChairModel, {0.54f, 0.74f, 0.52f}, 0.0f, true);
        reportModelLoad("Mobiliario: Silla plástica");
        m_GrassModel = Model::LoadFromFile(sourceModelsRoot + "pasto.fbx");
        if (m_GrassModel)
            m_GrassModelFit = FitModelTransform(*m_GrassModel, {1.9f, 0.52f, 1.9f}, 0.0f, true);
        reportModelLoad("Vegetación: Pasto FBX");
        // Piezas separadas del ave (hechas en Blender a partir del modelo): cuerpo, ala I interior/exterior, ala D interior/exterior
        const auto loadBirdParts = [&](size_t bird, const std::string& stem) {
            static const char* suffixes[kBirdPartCount] = {"_body", "_L_in", "_L_out", "_R_in", "_R_out"};
            bool complete = true;
            for (size_t part = 0; part < kBirdPartCount; ++part) {
                m_BirdParts[bird][part] = Model::LoadFromFile(sourceModelsRoot + stem + suffixes[part] + ".gltf");
                complete = complete && m_BirdParts[bird][part];
            }
            if (!complete) for (auto& part : m_BirdParts[bird]) part.reset();
        };
        m_BirdModels[0] = Model::LoadFromFile(sourceModelsRoot + "Ave 1/Woodpecker.gltf");
        if (m_BirdModels[0])
            m_BirdModelFits[0] = FitModelTransform(*m_BirdModels[0], {0.42f, 0.18f, 0.30f}, 0.0f, true);
        loadBirdParts(0, "Ave 1/Woodpecker");
        reportModelLoad("Fauna: Ave carpintero GLTF");
        m_BirdModels[1] = Model::LoadFromFile(sourceModelsRoot + "Ave 2/Seagull.gltf");
        if (m_BirdModels[1])
            m_BirdModelFits[1] = FitModelTransform(*m_BirdModels[1], {0.72f, 0.22f, 0.38f}, 0.0f, true);
        loadBirdParts(1, "Ave 2/Seagull");
        reportModelLoad("Fauna: Ave gaviota GLTF");
        m_RatModel = Model::LoadFromFile(sourceModelsRoot + "Rata/Rat.gltf");
        if (m_RatModel)
            m_RatModelFit = FitModelTransform(*m_RatModel, {0.20f, 0.14f, 0.54f}, 0.0f, true);
        reportModelLoad("Fauna: Rata urbana GLTF");
        m_PetModel = Model::LoadFromFile(sourceModelsRoot + "mascota.fbx");
        if (m_PetModel)
            m_PetModelFit = glm::translate(glm::mat4(1.0f), {0.0f, 0.08f, 0.0f})
                * FitModelTransform(*m_PetModel, {0.6175f, 0.507f, 0.8125f}, glm::pi<float>(), true);
        reportModelLoad("Compañero: Mascota canina (El Chato) FBX");
        m_VendorCartModel = Model::LoadFromFile(sourceModelsRoot + "comida rapida/food+cart.fbx");
        if (m_VendorCartModel)
            m_VendorCartModelFit = FitModelTransform(
                *m_VendorCartModel, {2.0f, 2.1f, 1.6f}, 0.0f, true);
        reportModelLoad("Puesto de comida rápida FBX");
        auto importedStreetLamp = Model::LoadFromFile(
            sourceModelsRoot + "luminaria/street+light.fbx", {}, "Plane.002", 620.0f);
        if (importedStreetLamp) {
            m_StreetLampModel = std::move(importedStreetLamp);
            m_StreetLampModelFit = FitModelTransform(
                *m_StreetLampModel, {2.163f, 4.2f, 0.53f}, 0.0f, true);
        }
        reportModelLoad("Luminaria urbana FBX");
    }
    m_CarBody = Mesh::CreateRoundedBox({4.3f, 0.78f, 1.76f}, 0.22f, 3);
    m_CarCabin = Mesh::CreateRoundedBox({2.25f, 0.62f, 1.62f}, 0.20f, 3, {0.035f, 0.045f, 0.06f, 1.0f});
    m_CarGlass = Mesh::CreateCube({0.08f, 0.48f, 1.52f}, {0.22f, 0.32f, 0.42f, 1.0f});
    m_CarRoof = Mesh::CreateRoundedBox({1.7f, 0.08f, 1.56f}, 0.04f, 2);
    m_CarWheel = Mesh::CreateCylinder(0.33f, 0.24f, 18, {0.067f, 0.067f, 0.067f, 1.0f});
    m_CarRim = Mesh::CreateCylinder(0.20f, 0.25f, 12, {0.54f, 0.56f, 0.59f, 1.0f});
    m_CarLamp = Mesh::CreateCube({0.07f, 0.16f, 0.34f}, {1.0f, 0.88f, 0.64f, 1.0f});
    m_BusBody = Mesh::CreateRoundedBox({2.5f, 2.8f, 9.0f}, 0.18f, 3, {0.70f, 0.15f, 0.12f, 1.0f});
    m_BusWindows = Mesh::CreateCube({0.05f, 0.95f, 8.0f}, {0.08f, 0.12f, 0.16f, 1.0f});
    m_BusWindshield = Mesh::CreateCube({2.25f, 1.0f, 0.05f}, {0.08f, 0.12f, 0.16f, 1.0f});
    m_BusJoint = Mesh::CreateCylinder(1.2f, 0.4f, 16, {0.10f, 0.10f, 0.10f, 1.0f});
    m_BusWheel = Mesh::CreateCylinder(0.5f, 0.3f, 14, {0.067f, 0.067f, 0.067f, 1.0f});
    m_BusRim = Mesh::CreateCylinder(0.22f, 0.32f, 12, {0.54f, 0.56f, 0.59f, 1.0f});
    m_BusPlatform = Mesh::CreateCube({2.6f, 0.9f, 16.0f}, {0.60f, 0.60f, 0.58f, 1.0f});
    m_BusStationGlass = Mesh::CreateCube({0.05f, 1.6f, 16.0f}, {0.66f, 0.78f, 0.84f, 1.0f});
    m_BusCanopy = Mesh::CreateCube({3.2f, 0.12f, 17.0f}, {0.75f, 0.22f, 0.18f, 1.0f});
    m_BusStationPost = Mesh::CreateCylinder(0.07f, 2.4f, 8, {0.68f, 0.68f, 0.67f, 1.0f});
    m_BusStationSign = Mesh::CreateCube({2.8f, 0.7f, 0.12f}, {0.70f, 0.12f, 0.10f, 1.0f});
    m_CarTaxiSign = Mesh::CreateCube({0.6f, 0.18f, 0.3f}, {1.0f, 0.92f, 0.69f, 1.0f});
    m_StreetLampPole = Mesh::CreateCube({0.10f, 3.2f, 0.10f}, {0.22f, 0.23f, 0.24f, 1.0f});
    m_StreetLampHead = Mesh::CreateCube({0.44f, 0.10f, 0.18f}, {0.88f, 0.76f, 0.48f, 1.0f});
    m_LampBulb = Mesh::CreateRoundedBox({0.32f, 0.32f, 0.32f}, 0.15f, 3, {1.0f, 1.0f, 1.0f, 1.0f});
    m_LampHalo = Mesh::CreateRoundedBox({2.2f, 2.2f, 2.2f}, 1.05f, 4, {1.0f, 1.0f, 1.0f, 1.0f});
    m_MissionMarker = Mesh::CreateCube({0.42f, 1.5f, 0.42f}, {0.92f, 0.64f, 0.12f, 1.0f});
    m_DogBody = Mesh::CreateRoundedBox({0.78f, 0.42f, 1.12f}, 0.12f, 3);
    m_DogHead = Mesh::CreateRoundedBox({0.48f, 0.42f, 0.48f}, 0.10f, 3);
    m_DogSnout = Mesh::CreateRoundedBox({0.31f, 0.20f, 0.30f}, 0.07f, 3, {0.69f, 0.43f, 0.27f, 1.0f});
    m_DogEar = Mesh::CreateRoundedBox({0.14f, 0.25f, 0.16f}, 0.04f, 2);
    m_DogLeg = Mesh::CreateRoundedBox({0.15f, 0.34f, 0.16f}, 0.04f, 2);
    m_DogCollar = Mesh::CreateCube({0.80f, 0.10f, 0.18f}, {0.78f, 0.12f, 0.12f, 1.0f});
    m_DogScarf = Mesh::CreateCube({0.40f, 0.14f, 0.12f}, {0.78f, 0.12f, 0.12f, 1.0f});
    m_DogBand = Mesh::CreateCube({0.36f, 0.06f, 0.10f}, {0.16f, 0.36f, 0.82f, 1.0f});
    m_DogCap = Mesh::CreateCube({0.24f, 0.08f, 0.22f}, {0.14f, 0.22f, 0.50f, 1.0f});
    m_DogVisor = Mesh::CreateCube({0.20f, 0.025f, 0.11f}, {0.95f, 0.78f, 0.10f, 1.0f});
    m_DogTail = Mesh::CreateCylinder(0.055f, 0.38f, 8);
    m_TreeTrunk = Mesh::CreateCylinder(0.17f, 1.6f, 8, {0.30f, 0.18f, 0.10f, 1.0f});
    m_TreeCanopy = Mesh::CreateRoundedBox({1.25f, 1.55f, 1.25f}, 0.45f, 3, {0.18f, 0.36f, 0.17f, 1.0f});
    m_PigeonBody = Mesh::CreateRoundedBox({0.24f, 0.16f, 0.38f}, 0.05f, 2, {0.48f, 0.50f, 0.52f, 1.0f});
    m_PigeonWing = Mesh::CreateRoundedBox({0.11f, 0.07f, 0.28f}, 0.025f, 2, {0.34f, 0.36f, 0.39f, 1.0f});
    m_RainDrop = Mesh::CreateCube({0.018f, 0.52f, 0.018f}, {0.56f, 0.72f, 0.92f, 0.44f});
    m_SignalPole = Mesh::CreateCube({0.10f, 3.2f, 0.10f}, {0.18f, 0.19f, 0.20f, 1.0f});
    m_SignalHead = Mesh::CreateCube({0.38f, 0.82f, 0.28f}, {0.10f, 0.11f, 0.12f, 1.0f});
    m_SignalLamp = Mesh::CreateCylinder(0.09f, 0.10f, 12);
    m_CarMirrorMesh = Mesh::CreateRoundedBox({0.12f, 0.13f, 0.20f}, 0.025f, 2, {0.08f, 0.08f, 0.08f, 1.0f});
    m_CarMirrorGlass = Mesh::CreateCube({0.02f, 0.09f, 0.13f}, {0.56f, 0.68f, 0.75f, 1.0f});
    m_PoopMesh = Mesh::CreateRoundedBox({0.28f, 0.16f, 0.28f}, 0.07f, 3, {0.29f, 0.14f, 0.055f, 1.0f});
    m_GroundPoopMesh = Mesh::CreateCylinder(0.23f, 0.08f, 8, {0.29f, 0.14f, 0.055f, 1.0f});
    m_VendorCounter = Mesh::CreateCube({1.15f, 0.72f, 0.68f}, {0.43f, 0.27f, 0.13f, 1.0f});
    m_VendorLeg = Mesh::CreateCube({0.07f, 0.43f, 0.07f}, {0.18f, 0.16f, 0.13f, 1.0f});
    m_VendorGoods = Mesh::CreateCube({0.13f, 0.11f, 0.12f}, {0.85f, 0.18f, 0.12f, 1.0f});
    m_VendorCanopy = Mesh::CreateRoundedBox({2.05f, 0.12f, 1.75f}, 0.04f, 2, {0.75f, 0.13f, 0.12f, 1.0f});
    m_VendorCanopyStripe = Mesh::CreateCube({0.26f, 0.14f, 1.68f}, {0.96f, 0.79f, 0.21f, 1.0f});
    m_VendorPole = Mesh::CreateCylinder(0.035f, 2.15f, 8, {0.30f, 0.30f, 0.29f, 1.0f});
    m_VendorGrill = Mesh::CreateCylinder(0.34f, 0.60f, 12, {0.16f, 0.16f, 0.15f, 1.0f});
    m_VendorCoal = Mesh::CreateCylinder(0.29f, 0.04f, 12, {0.85f, 0.24f, 0.045f, 1.0f});
    m_VendorFood = Mesh::CreateRoundedBox({0.13f, 0.09f, 0.12f}, 0.04f, 2, {0.56f, 0.27f, 0.09f, 1.0f});
    m_RecyclerBody = Mesh::CreateCube({1.5f, 1.2f, 1.0f}, {0.29f, 0.22f, 0.15f, 1.0f});
    m_RecyclerRoof = Mesh::CreateCube({2.0f, 0.15f, 1.3f}, {0.22f, 0.25f, 0.23f, 1.0f});
    m_RecyclerSign = Mesh::CreateCube({1.7f, 0.42f, 0.08f}, {0.12f, 0.42f, 0.24f, 1.0f});
    m_RecyclerSack = Mesh::CreateRoundedBox({0.55f, 0.72f, 0.52f}, 0.18f, 2, {0.74f, 0.71f, 0.61f, 1.0f});
    m_RecyclerScale = Mesh::CreateCube({0.55f, 0.08f, 0.55f}, {0.52f, 0.55f, 0.57f, 1.0f});
    m_DealerLantern = Mesh::CreateRoundedBox({0.24f, 0.24f, 0.24f}, 0.10f, 2, {0.62f, 0.22f, 0.83f, 1.0f});
    m_CambucheBaseMesh = Mesh::CreateCube({2.8f, 0.08f, 2.2f}, {0.66f, 0.52f, 0.35f, 1.0f});
    m_CambucheMarkerMesh = Mesh::CreateCube({0.8f, 0.04f, 0.6f}, {0.55f, 0.42f, 0.28f, 1.0f});
    m_CambucheFireMesh = Mesh::CreateCylinder(0.12f, 0.25f, 8, {1.0f, 0.52f, 0.12f, 1.0f});
    m_CambucheBedMesh = Mesh::CreateRoundedBox({0.95f, 0.18f, 1.9f}, 0.04f, 2, {0.62f, 0.60f, 0.52f, 1.0f});
    m_ShadowHeadMesh = Mesh::CreateRoundedBox({0.35f, 0.38f, 0.35f}, 0.12f, 2, {0.03f, 0.03f, 0.04f, 1.0f});
    m_ShadowEyeMesh = Mesh::CreateCube({0.06f, 0.04f, 0.06f}, {1.0f, 0.12f, 0.12f, 1.0f});
    m_ShadowTorsoMesh = Mesh::CreateRoundedBox({0.42f, 0.85f, 0.28f}, 0.08f, 2, {0.03f, 0.03f, 0.04f, 1.0f});
    m_ShadowLegMesh = Mesh::CreateCylinder(0.08f, 0.80f, 6, {0.03f, 0.03f, 0.04f, 1.0f});
    std::uniform_real_distribution<float> rainHorizontal(-13.0f, 13.0f);   // area de 26 x 26 m alrededor del jugador
    std::uniform_real_distribution<float> rainHeight(0.0f, 16.0f);
    for (size_t drop = 0; drop < kRainDropCount; ++drop) {
        m_RainOffsets.emplace_back(rainHorizontal(m_Random), rainHeight(m_Random), rainHorizontal(m_Random));
    }
    const auto& parkBounds = m_City.GetData().parks;   // x0, x1, z0, z1 en metros (Bogota.js)
    for (int z = 1; z < CityLayout::HEIGHT - 1; ++z) {
        for (int x = 1; x < CityLayout::WIDTH - 1; ++x) {
            if (m_City.GetTileAt(x, z) != TileType::Grass) continue;
            const glm::vec3 point((x + 0.5f) * CityLayout::TILE_SIZE - CityLayout::ORIGIN_X,
                                  0.0f,
                                  (z + 0.5f) * CityLayout::TILE_SIZE - CityLayout::ORIGIN_Z);
            m_GrassPositions.push_back(point);
            const bool treeTile = (x * 7 + z * 13) % 11 == 0;
            const bool treeHasRoom = std::all_of(m_TreePositions.begin(), m_TreePositions.end(),
                [&](const glm::vec3& tree) {
                    return glm::distance(glm::vec2(tree.x, tree.z), glm::vec2(point.x, point.z)) >= 6.0f;
                });
            if (treeTile && treeHasRoom) m_TreePositions.push_back(point);
            for (size_t parkIndex = 0; parkIndex < parkBounds.size() && parkIndex < m_ParkGrassPositions.size(); ++parkIndex) {
                const glm::vec4& bounds = parkBounds[parkIndex];
                if (point.x >= bounds.x && point.x <= bounds.y && point.z >= bounds.z && point.z <= bounds.w) {
                    m_ParkGrassPositions[parkIndex].push_back(point);
                    break;
                }
            }
        }
    }
    // Las aves se reparten por todo el mapa al final del constructor (BuildBirdSpots)
    for (int z = 1; z < CityLayout::HEIGHT - 1; ++z) {
        for (int x = 1; x < CityLayout::WIDTH - 1; ++x) {
            if (m_City.GetTileAt(x, z) != TileType::Sidewalk) continue;
            const bool besideRoad = m_City.GetTileAt(x - 1, z) == TileType::Road
                || m_City.GetTileAt(x + 1, z) == TileType::Road
                || m_City.GetTileAt(x, z - 1) == TileType::Road
                || m_City.GetTileAt(x, z + 1) == TileType::Road;
            if (!besideRoad) continue;
            m_RatWalkPoints.emplace_back((x + 0.5f) * CityLayout::TILE_SIZE - CityLayout::ORIGIN_X,
                                         0.15f,
                                         (z + 0.5f) * CityLayout::TILE_SIZE - CityLayout::ORIGIN_Z);
        }
    }
    std::vector<glm::vec3> selectedRatPoints;
    for (size_t attempt = 0; attempt < 80 && selectedRatPoints.size() < 6 && !m_RatWalkPoints.empty(); ++attempt) {
        std::uniform_int_distribution<size_t> choosePoint(0, m_RatWalkPoints.size() - 1);
        const glm::vec3 point = m_RatWalkPoints[choosePoint(m_Random)];
        const bool tooClose = std::any_of(selectedRatPoints.begin(), selectedRatPoints.end(),
            [&](const glm::vec3& rat) {
                return glm::distance(glm::vec2(rat.x, rat.z), glm::vec2(point.x, point.z)) < 20.0f;
            });
        if (tooClose) continue;
        selectedRatPoints.push_back(point);
        m_Rats.push_back({point, point, 0.0f, 0.0f, 0.0f, 0.5f + m_Unit(m_Random) * 1.5f, m_Unit(m_Random) * 10.0f, 0.0f, RatState::Idle, 0.0f});
    }
    for (size_t variant = 0; variant < 8; ++variant) {
        m_PickupMeshes.push_back(MakeTrashBagMesh(variant));
    }
    // Postes de luz: cuadrícula cada 14 tiles (28 m), mínimo 18 m entre postes
    for (int z = 2; z < CityLayout::HEIGHT - 2; z += 14) {
        for (int x = 2; x < CityLayout::WIDTH - 2; x += 14) {
            bool placed = false;
            for (int dz = 0; dz < 14 && !placed; ++dz) for (int dx = 0; dx < 14 && !placed; ++dx) {
                const int tx = x + dx, tz = z + dz;
                if (m_City.GetTileAt(tx, tz) != TileType::Sidewalk) continue;
                const bool adjacentToRoad = m_City.GetTileAt(tx + 1, tz) == TileType::Road || m_City.GetTileAt(tx - 1, tz) == TileType::Road ||
                    m_City.GetTileAt(tx, tz + 1) == TileType::Road || m_City.GetTileAt(tx, tz - 1) == TileType::Road;
                if (!adjacentToRoad) continue;
                const glm::vec3 candidate(
                    (tx + 0.5f) * CityLayout::TILE_SIZE - CityLayout::ORIGIN_X, 0.0f,
                    (tz + 0.5f) * CityLayout::TILE_SIZE - CityLayout::ORIGIN_Z);
                // Sin farolas bajo el tablero del viaducto ni pegadas a sus bordes
                if (Viaduct::Covers(candidate.x, candidate.z) || (Viaduct::Covers(candidate.x - 1.5f, candidate.z) || Viaduct::Covers(candidate.x + 1.5f, candidate.z))) continue;
                // Garantizar separación mínima real de 18 m entre postes
                const bool tooClose = std::any_of(m_StreetLamps.begin(), m_StreetLamps.end(),
                    [&](const StreetLamp& lamp) {
                        return glm::distance(glm::vec2(lamp.position.x, lamp.position.z),
                                             glm::vec2(candidate.x, candidate.z)) < 18.0f;
                    });
                if (tooClose) continue;
                glm::vec2 roadDirection(0.0f);
                if (m_City.GetTileAt(tx - 1, tz) == TileType::Road) roadDirection.x = -1.0f;
                else if (m_City.GetTileAt(tx + 1, tz) == TileType::Road) roadDirection.x = 1.0f;
                else if (m_City.GetTileAt(tx, tz - 1) == TileType::Road) roadDirection.y = -1.0f;
                else roadDirection.y = 1.0f;
                m_StreetLamps.push_back({candidate, std::atan2(-roadDirection.y, roadDirection.x)});
                placed = true;
            }
        }
    }
    // Contenedores de basura fijos (solo andén junto a calle, sin bloqueo)
    for (int z = 4; z < CityLayout::HEIGHT - 4 && m_Pickups.size() < 10; z += 18) {
        for (int x = 4; x < CityLayout::WIDTH - 4 && m_Pickups.size() < 10; x += 20) {
            bool placed = false;
            for (int dz = 0; dz < 18 && !placed; ++dz) {
                for (int dx = 0; dx < 20 && !placed; ++dx) {
                    const int tx = x + dx;
                    const int tz = z + dz;
                    if (m_City.GetTileAt(tx, tz) != TileType::Sidewalk) continue;
                    const bool adjacentToRoad =
                        m_City.GetTileAt(tx + 1, tz) == TileType::Road ||
                        m_City.GetTileAt(tx - 1, tz) == TileType::Road ||
                        m_City.GetTileAt(tx, tz + 1) == TileType::Road ||
                        m_City.GetTileAt(tx, tz - 1) == TileType::Road;
                    if (!adjacentToRoad) continue;
                    const glm::vec3 position((tx + 0.5f) * CityLayout::TILE_SIZE - CityLayout::ORIGIN_X,
                                             0.0f,
                                             (tz + 0.5f) * CityLayout::TILE_SIZE - CityLayout::ORIGIN_Z);
                    // Descartar si hay obstáculo o poste muy cerca
                    if (m_City.IsBlocked(position.x, position.z, 0.55f)) continue;
                    const bool tooCloseToLamp = std::any_of(m_StreetLamps.begin(), m_StreetLamps.end(),
                        [&](const StreetLamp& lamp) {
                            return glm::distance(glm::vec2(lamp.position.x, lamp.position.z),
                                                 glm::vec2(position.x, position.z)) < 1.8f;
                        });
                    if (tooCloseToLamp) continue;
                    const bool separated = std::all_of(m_Pickups.begin(), m_Pickups.end(),
                        [&](const PickupItem& pickup) {
                            return glm::distance(glm::vec2(pickup.position.x, pickup.position.z),
                                                 glm::vec2(position.x, position.z)) >= 12.0f;
                        });
                    if (!separated) continue;
                    const size_t itemIndex = static_cast<size_t>(m_Unit(m_Random) * 8.0f);
                    m_Pickups.push_back({itemIndex, position, true, true, 0.0f});
                    placed = true;
                }
            }
        }
    }
    // Precomputar puntos de andén válidos para aparición de basura dinámica
    // Solo andenes junto a calles, sin bloqueo ni postes cerca
    for (int z = 1; z < CityLayout::HEIGHT - 1; ++z) {
        for (int x = 1; x < CityLayout::WIDTH - 1; ++x) {
            if (m_City.GetTileAt(x, z) != TileType::Sidewalk) continue;
            const bool adjacentToRoad =
                m_City.GetTileAt(x + 1, z) == TileType::Road ||
                m_City.GetTileAt(x - 1, z) == TileType::Road ||
                m_City.GetTileAt(x, z + 1) == TileType::Road ||
                m_City.GetTileAt(x, z - 1) == TileType::Road;
            if (!adjacentToRoad) continue;
            const glm::vec3 pos(
                (x + 0.5f) * CityLayout::TILE_SIZE - CityLayout::ORIGIN_X,
                0.0f,
                (z + 0.5f) * CityLayout::TILE_SIZE - CityLayout::ORIGIN_Z);
            // Descartar si bloqueado por edificio, pared u objeto
            if (m_City.IsBlocked(pos.x, pos.z, 0.55f)) continue;
            // Descartar si es un tile de parque o hierba (solo andenes urbanos)
            const TileType northTile = m_City.GetTileAt(x, z - 1);
            const TileType southTile = m_City.GetTileAt(x, z + 1);
            const TileType westTile  = m_City.GetTileAt(x - 1, z);
            const TileType eastTile  = m_City.GetTileAt(x + 1, z);
            const bool nextToGrass = northTile == TileType::Grass || southTile == TileType::Grass
                                  || westTile  == TileType::Grass || eastTile  == TileType::Grass;
            if (nextToGrass) continue;
            // Descartar muy cerca de un poste
            const bool nearLamp = std::any_of(m_StreetLamps.begin(), m_StreetLamps.end(),
                [&](const StreetLamp& lamp) {
                    return glm::distance(glm::vec2(lamp.position.x, lamp.position.z),
                                         glm::vec2(pos.x, pos.z)) < 1.6f;
                });
            if (nearLamp) continue;
            m_ValidTrashSpots.push_back(pos);
        }
    }
    // Mezclar la lista para evitar patrones repetidos al spawnar
    std::shuffle(m_ValidTrashSpots.begin(), m_ValidTrashSpots.end(), m_Random);
    // Llenado inicial: colocar ~28 bolsas repartidas por la lista de spots válidos
    // Toma 1 de cada N spots para distribuirlas por toda la ciudad
    if (!m_ValidTrashSpots.empty()) {
        constexpr size_t TARGET_INITIAL = 28;
        const size_t step = std::max(size_t(1), m_ValidTrashSpots.size() / TARGET_INITIAL);
        size_t placed = 0;
        for (size_t i = 0; i < m_ValidTrashSpots.size() && placed < TARGET_INITIAL; i += step) {
            const glm::vec3& spot = m_ValidTrashSpots[i];
            const bool overlapping = std::any_of(m_Pickups.begin(), m_Pickups.end(),
                [&](const PickupItem& p) { return glm::distance(p.position, spot) < 3.0f; });
            if (overlapping) continue;
            const size_t variant = (placed * 13 + i * 7) % m_PickupMeshes.size(); // determinista
            m_Pickups.push_back({variant, spot, false, true, 0.0f});
            ++placed;
        }
        // Reserva renovable: cada bolsa inicial trae parte de los materiales de un cambuche completo
        std::vector<size_t> bagIndices;
        for (size_t index = 0; index < m_Pickups.size(); ++index)
            if (!m_Pickups[index].container) bagIndices.push_back(index);
        auto shelterLoot = DistributeShelterLoot(GameData::Get(), bagIndices.size(), m_Random);
        for (size_t slot = 0; slot < bagIndices.size(); ++slot) m_Pickups[bagIndices[slot]].guaranteedLoot = std::move(shelterLoot[slot]);
    }
    const auto worldTile = [](float tile, float origin) {
        return (tile + 0.5f) * CityLayout::TILE_SIZE - origin;
    };
    const auto laneX = [&](int first, int last, int side) {
        return worldTile((first + last) * 0.5f + side * (last - first + 1) * 0.25f, CityLayout::ORIGIN_X);
    };
    const auto laneZ = [&](int first, int last, int side) {
        return worldTile((first + last) * 0.5f + side * (last - first + 1) * 0.25f, CityLayout::ORIGIN_Z);
    };
    // Calles del original (assets/data/city-map.json): 4 carreras, los dos carriles de la Caracas y 4 calles
    const auto& carreras = m_City.GetData().carreras;
    const auto& caracas = m_City.GetData().caracasLanes;
    // Las bandas de las calles estan en filas del original: las 37 filas del norte (estacion) desplazan la cuadricula
    auto calles = m_City.GetData().calles;
    for (auto& band : calles) { band.first += CityLayout::NORTH_ROWS; band.last += CityLayout::NORTH_ROWS; }
    const float top = laneZ(calles[0].first, calles[0].last, 1);
    const float bottom = laneZ(calles[1].first, calles[1].last, -1);
    const float farBottom = laneZ(calles.back().first, calles.back().last, -1);
    const float upperMiddle = laneZ(calles[1].first, calles[1].last, 1);
    // El costado oriental ocupado por Colpatria deja de ser via de paso: los circuitos que pasan por la Caracas oriental
    // giran en la calle 8 (getTrafficRoutes del original).
    const float colpatriaTurn = laneZ(calles[2].first, calles[2].last, -1);
    const auto clampBottom = [&](float left, float right, float lowest) {
        const bool nearColpatria = (left >= 83.0f && left <= 93.0f) || (right >= 83.0f && right <= 93.0f);
        return nearColpatria && lowest > 155.0f ? colpatriaTurn : lowest;
    };
    const auto routeLeft = [&](const std::array<float, 4>& r) { return std::min(r[0], r[1]); };
    std::array<std::array<float, 4>, 6> routeBounds{{
        {{laneX(carreras[0].first, carreras[0].last, 1), laneX(caracas[0].first, caracas[0].last, -1), top, bottom}},
        {{laneX(caracas[1].first, caracas[1].last, 1), laneX(carreras[1].first, carreras[1].last, -1), top, bottom}},
        {{laneX(carreras[1].first, carreras[1].last, 1), laneX(carreras[2].first, carreras[2].last, -1), top, farBottom}},
        {{laneX(carreras[2].first, carreras[2].last, 1), laneX(carreras[3].first, carreras[3].last, -1), top, farBottom}},
        {{laneX(carreras[0].first, carreras[0].last, 1), laneX(caracas[0].first, caracas[0].last, -1), upperMiddle, farBottom}},
        {{laneX(caracas[1].first, caracas[1].last, 1), laneX(carreras[1].first, carreras[1].last, -1), upperMiddle, farBottom}}
    }};
    (void)routeLeft;
    for (auto& bounds : routeBounds) bounds[3] = clampBottom(bounds[0], bounds[1], bounds[3]);
    for (size_t routeIndex = 0; routeIndex < routeBounds.size(); ++routeIndex) {
        const float left = std::min(routeBounds[routeIndex][0], routeBounds[routeIndex][1]);
        const float right = std::max(routeBounds[routeIndex][0], routeBounds[routeIndex][1]);
        const float topEdge = std::min(routeBounds[routeIndex][2], routeBounds[routeIndex][3]);
        const float bottomEdge = std::max(routeBounds[routeIndex][2], routeBounds[routeIndex][3]);
        const bool hasCaracasApproach = routeIndex == 0 || routeIndex == 1 || routeIndex == 4 || routeIndex == 5;
        if (!hasCaracasApproach) continue;

        const std::array<std::pair<glm::vec3, glm::vec3>, 2> approaches = routeIndex == 0 || routeIndex == 4
            ? std::array<std::pair<glm::vec3, glm::vec3>, 2>{{
                {{right, 0.0f, topEdge}, {1.0f, 0.0f, 0.0f}},
                {{right, 0.0f, bottomEdge}, {0.0f, 0.0f, 1.0f}}
            }}
            : std::array<std::pair<glm::vec3, glm::vec3>, 2>{{
                {{left, 0.0f, topEdge}, {0.0f, 0.0f, -1.0f}},
                {{left, 0.0f, bottomEdge}, {-1.0f, 0.0f, 0.0f}}
            }};
        for (const auto& [intersection, direction] : approaches) {
            const size_t axis = std::abs(direction.x) > 0.5f ? 0 : 1;
            const glm::vec3 stopPosition = intersection - direction * 2.4f;
            glm::vec3 polePosition(0.0f);
            float bestDistanceSquared = 9.5f * 9.5f;
            const int centerTileX = static_cast<int>(std::floor(
                (intersection.x + CityLayout::ORIGIN_X) / CityLayout::TILE_SIZE));
            const int centerTileZ = static_cast<int>(std::floor(
                (intersection.z + CityLayout::ORIGIN_Z) / CityLayout::TILE_SIZE));
            for (int tileZ = centerTileZ - 6; tileZ <= centerTileZ + 6; ++tileZ) {
                for (int tileX = centerTileX - 6; tileX <= centerTileX + 6; ++tileX) {
                    const glm::vec3 candidate(
                        (tileX + 0.5f) * CityLayout::TILE_SIZE - CityLayout::ORIGIN_X,
                        0.0f,
                        (tileZ + 0.5f) * CityLayout::TILE_SIZE - CityLayout::ORIGIN_Z);
                    const glm::vec2 offset(candidate.x - intersection.x, candidate.z - intersection.z);
                    const float distanceSquared = glm::dot(offset, offset);
                    if (distanceSquared >= bestDistanceSquared
                        || !m_City.IsSidewalk(candidate.x, candidate.z)
                        || m_City.IsBlocked(candidate.x, candidate.z, 0.35f)) continue;
                    polePosition = candidate;
                    bestDistanceSquared = distanceSquared;
                }
            }
            if (bestDistanceSquared >= 9.5f * 9.5f) continue;
            const bool exists = std::any_of(m_TrafficSignals.begin(), m_TrafficSignals.end(),
                [&](const TrafficSignal& signal) {
                    return glm::distance(glm::vec2(signal.stopPosition.x, signal.stopPosition.z),
                                         glm::vec2(stopPosition.x, stopPosition.z)) < 0.75f
                        && glm::dot(signal.approachDirection, direction) > 0.95f;
                });
            if (!exists) {
                m_TrafficSignals.push_back({
                    stopPosition,
                    polePosition,
                    direction,
                    std::atan2(-direction.z, direction.x),
                    axis
                });
            }
        }
    }
    if (m_TrafficSignals.empty()) {
        LogWarn("No se encontraron aceras para ubicar semaforos en las intersecciones de las rutas.");
    } else {
        LogInfo("Semaforos de trafico preparados: {}", m_TrafficSignals.size());
    }
    // Dos buses (Bogota.js, getBusRoute): el del norte sale del extremo sur del puente del lago, sube por el viaducto
    // y para en la estacion Portal del Centro; el del sur parte de la estacion, cruza el viaducto y el puente, y relevan
    // en los extremos. Siguen la curva del rodeo de Colpatria.
    {
        const float southEnd = static_cast<float>(CityLayout::HEIGHT - CityLayout::NORTH_ROWS - 2) * CityLayout::TILE_SIZE - 9.1f;   // 308,9
        const float northEnd = Station::kTerminalNorthZ + 12.0f;                                                                        // -62
        const auto placeBus = [&](BusState& bus, float z) {
            bus.position = {Viaduct::BusPathX(z, bus.laneX), Viaduct::Height(z), z};
            bus.heading = Viaduct::BusHeading(z, bus.laneX, bus.direction);
            bus.previousPosition = bus.position;
        };
        BusState northbound;
        northbound.direction = -1.0f;
        northbound.laneX = Station::kNorthLaneX;
        northbound.startZ = southEnd;
        northbound.endZ = northEnd;
        northbound.stationZ = Station::kCenterZ;
        placeBus(northbound, southEnd);
        BusState southbound;
        southbound.direction = 1.0f;
        southbound.laneX = Station::kSouthLaneX;
        southbound.startZ = northEnd;
        southbound.endZ = southEnd;
        southbound.stationZ = Station::kCenterZ;
        placeBus(southbound, 40.0f);   // ya en marcha, para cruzarse con el otro
        southbound.servedStation = true;
        m_Buses = {northbound, southbound};
    }
    for (const auto& bounds : routeBounds) {
        const float left = std::min(bounds[0], bounds[1]);
        const float right = std::max(bounds[0], bounds[1]);
        const float routeTop = std::min(bounds[2], bounds[3]);
        const float routeBottom = std::max(bounds[2], bounds[3]);
        if (right - left <= 2.0f || routeBottom - routeTop <= 2.0f) continue;
        m_TrafficRoutes.push_back(MakeTrafficCircuit(left, right, routeTop, routeBottom));
    }
    for (size_t routeIndex = 0; routeIndex < m_TrafficRoutes.size(); ++routeIndex) {
        const auto& route = m_TrafficRoutes[routeIndex];
        const float routeLength = GetCircuitLength(route);
        const size_t count = std::min<size_t>(4, static_cast<size_t>(routeLength / 12.0f));
        for (size_t index = 0; index < count; ++index) {
            TrafficVehicle vehicle;
            vehicle.route = route;
            vehicle.routeIndex = routeIndex;
            vehicle.routeLength = routeLength;
            vehicle.routeCumulative.resize(route.size());
            for (size_t point = 1; point < route.size(); ++point)
                vehicle.routeCumulative[point] = vehicle.routeCumulative[point - 1] + glm::distance(route[point - 1], route[point]);
            const float distance = (static_cast<float>(index) + 0.4f) * routeLength / count;
            vehicle.distance = distance;
            vehicle.nextDistance = distance;
            SampleCircuit(vehicle.route, vehicle.routeCumulative, vehicle.routeLength, distance,
                          vehicle.position, vehicle.direction, vehicle.nextWaypoint);
            vehicle.previousPosition = vehicle.position;
            vehicle.horizontalLane = std::abs(vehicle.direction.x) > std::abs(vehicle.direction.z);
            vehicle.laneCoordinate = vehicle.horizontalLane ? vehicle.position.z : vehicle.position.x;
            vehicle.yaw = std::atan2(-vehicle.direction.z, vehicle.direction.x);
            vehicle.cruiseSpeed = 3.5f + m_Unit(m_Random) * 1.5f;
            vehicle.speed = 0.0f;
            vehicle.bus = false;
            vehicle.length = 4.3f;
            vehicle.width = 1.76f;
            const std::array<glm::vec3, 8> paints{{
                {0.91f, 0.91f, 0.90f}, {0.73f, 0.75f, 0.77f}, {0.11f, 0.12f, 0.13f}, {0.48f, 0.08f, 0.08f},
                {0.12f, 0.24f, 0.42f}, {0.30f, 0.35f, 0.23f}, {0.55f, 0.56f, 0.57f}, {0.82f, 0.79f, 0.70f}
            }};
            vehicle.taxi = m_Unit(m_Random) < 0.3f;
            vehicle.color = vehicle.taxi ? glm::vec3(0.949f, 0.765f, 0.0f)
                : paints[static_cast<size_t>(m_Unit(m_Random) * paints.size()) % paints.size()];
            m_Traffic.push_back(std::move(vehicle));
            m_CarCooldowns.push_back(0.0f);
        }
    }
    const std::array<glm::vec3, 8> parkedPaints{{
        {0.91f, 0.91f, 0.90f}, {0.73f, 0.75f, 0.77f}, {0.11f, 0.12f, 0.13f}, {0.48f, 0.08f, 0.08f},
        {0.12f, 0.24f, 0.42f}, {0.30f, 0.35f, 0.23f}, {0.55f, 0.56f, 0.57f}, {0.82f, 0.79f, 0.70f}
    }};
    for (int z = 2; z < CityLayout::HEIGHT - 2 && m_ParkedCars.size() < 8; ++z) {
        for (int x = 2; x < CityLayout::WIDTH - 2 && m_ParkedCars.size() < 8; ++x) {
            if (m_City.GetTileAt(x, z) != TileType::Road) continue;
            const bool alongX = m_City.GetTileAt(x, z - 1) == TileType::Sidewalk
                || m_City.GetTileAt(x, z + 1) == TileType::Sidewalk;
            const bool alongZ = m_City.GetTileAt(x - 1, z) == TileType::Sidewalk
                || m_City.GetTileAt(x + 1, z) == TileType::Sidewalk;
            if (!alongX && !alongZ) continue;
            TrafficVehicle parked;
            parked.position = {
                (x + 0.5f) * CityLayout::TILE_SIZE - CityLayout::ORIGIN_X,
                0.0f,
                (z + 0.5f) * CityLayout::TILE_SIZE - CityLayout::ORIGIN_Z
            };
            parked.previousPosition = parked.position;
            if (std::any_of(m_ParkedCars.begin(), m_ParkedCars.end(), [&](const TrafficVehicle& other) {
                    return glm::distance(glm::vec2(parked.position.x, parked.position.z),
                                         glm::vec2(other.position.x, other.position.z)) < 12.0f;
                })) continue;
            parked.direction = alongX ? glm::vec3(1.0f, 0.0f, 0.0f) : glm::vec3(0.0f, 0.0f, 1.0f);
            parked.yaw = std::atan2(-parked.direction.z, parked.direction.x);
            parked.length = 4.3f;
            parked.width = 1.76f;
            parked.parked = true;
            parked.speed = 0.0f;
            parked.taxi = m_Unit(m_Random) < 0.3f;
            parked.color = parked.taxi ? glm::vec3(0.949f, 0.765f, 0.0f)
                : parkedPaints[static_cast<size_t>(m_Unit(m_Random) * parkedPaints.size()) % parkedPaints.size()];
            m_ParkedCars.push_back(parked);
            m_ParkedCarCooldowns.push_back(0.0f);
        }
    }

    for (const CityLayout::VendorSite& site : m_City.GetData().vendors) {
        // puesto de Bogota.js (_vendor): el vendedor queda detras, a 0,9 m, mirando hacia donde mira el puesto
        const glm::vec3 facing(std::sin(site.rotation), 0.0f, std::cos(site.rotation));
        const glm::vec3 position(site.x, 0.15f, site.z);
        m_StreetVendors.push_back({position, position - facing * 0.9f, facing, site.name, site.kind == "fritanga",
                                   m_PedestrianAppearances.empty() ? 0 : m_StreetVendors.size() % m_PedestrianAppearances.size(),
                                   site.items});
    }

    const auto findMarketSidewalk = [&](const glm::vec3& target, float minDistance) {
        glm::vec3 nearest = target;
        float bestDistanceSquared = std::numeric_limits<float>::max();
        for (int z = 1; z < CityLayout::HEIGHT - 1; ++z) {
            for (int x = 1; x < CityLayout::WIDTH - 1; ++x) {
                if (m_City.GetTileAt(x, z) != TileType::Sidewalk) continue;
                const glm::vec3 candidate(
                    (x + 0.5f) * CityLayout::TILE_SIZE - CityLayout::ORIGIN_X,
                    0.15f,
                    (z + 0.5f) * CityLayout::TILE_SIZE - CityLayout::ORIGIN_Z);
                if (m_City.IsBlocked(candidate.x, candidate.z, 0.5f)) continue;
                const float distanceSquared = glm::dot(glm::vec2(candidate.x - target.x, candidate.z - target.z),
                                                       glm::vec2(candidate.x - target.x, candidate.z - target.z));
                if (distanceSquared < minDistance * minDistance) continue;
                if (distanceSquared < bestDistanceSquared) {
                    nearest = candidate;
                    bestDistanceSquared = distanceSquared;
                }
            }
        }
        if (bestDistanceSquared == std::numeric_limits<float>::max()) {
            LogWarn("No se encontro una acera libre para un punto comercial.");
        }
        return nearest;
    };
    // Puntos reservados de Bogota.js: la bodega de reciclaje (sell), la olla del Cartucho (dealer) y el vecino de la mision
    // junto a la recicladora
    (void)findMarketSidewalk;
    const CityLayout::CityData& cityData = m_City.GetData();
    m_RecyclerPosition = {cityData.sell.x, 0.15f, cityData.sell.y};
    m_MissionNpcPosition = {cityData.sell.x + 2.0f, 0.15f, cityData.sell.y};
    m_DealerPosition = {cityData.dealer.x, 0.15f, cityData.dealer.y};
    BuildBirdSpots();
}

bool Simulation::FindSidewalkPoint(glm::vec3& point, const glm::vec3& center, float radius) {
    for (int attempt = 0; attempt < 60; ++attempt) {
        const float angle = m_Unit(m_Random) * glm::two_pi<float>();
        const float distance = std::sqrt(m_Unit(m_Random)) * radius;
        glm::vec3 candidate = center + glm::vec3(std::cos(angle) * distance, 0.0f, std::sin(angle) * distance);
        if (m_City.IsSidewalk(candidate.x, candidate.z) && !m_City.IsBlocked(candidate.x, candidate.z, 0.25f)) {
            point = candidate;
            return true;
        }
    }
    return false;
}

bool Simulation::FindSidewalkPath(const glm::vec3& start, const glm::vec3& target, std::vector<glm::vec3>& path) const {
    const auto toTile = [](float coordinate, float origin) {
        return static_cast<int>(std::floor((coordinate + origin) / CityLayout::TILE_SIZE));
    };
    const int startX = toTile(start.x, CityLayout::ORIGIN_X);
    const int startZ = toTile(start.z, CityLayout::ORIGIN_Z);
    const int goalX = toTile(target.x, CityLayout::ORIGIN_X);
    const int goalZ = toTile(target.z, CityLayout::ORIGIN_Z);
    if (startX < 0 || startX >= CityLayout::WIDTH || startZ < 0 || startZ >= CityLayout::HEIGHT ||
        goalX < 0 || goalX >= CityLayout::WIDTH || goalZ < 0 || goalZ >= CityLayout::HEIGHT) return false;
    const auto traversable = [&](int x, int z) {
        const TileType tile = m_City.GetTileAt(x, z);
        return tile == TileType::Sidewalk || tile == TileType::Plaza || tile == TileType::Grass;
    };
    if (!traversable(startX, startZ) || !traversable(goalX, goalZ)) return false;
    const auto index = [](int x, int z) { return z * CityLayout::WIDTH + x; };
    std::vector<int> previous(CityLayout::WIDTH * CityLayout::HEIGHT, -1);
    std::queue<int> frontier;
    const int startIndex = index(startX, startZ);
    const int goalIndex = index(goalX, goalZ);
    previous[startIndex] = startIndex;
    frontier.push(startIndex);
    constexpr int offsets[4][2]{{1, 0}, {-1, 0}, {0, 1}, {0, -1}};
    while (!frontier.empty() && previous[goalIndex] < 0) {
        const int current = frontier.front();
        frontier.pop();
        const int x = current % CityLayout::WIDTH;
        const int z = current / CityLayout::WIDTH;
        for (const auto& offset : offsets) {
            const int nextX = x + offset[0];
            const int nextZ = z + offset[1];
            if (nextX < 0 || nextX >= CityLayout::WIDTH || nextZ < 0 || nextZ >= CityLayout::HEIGHT || !traversable(nextX, nextZ)) continue;
            const int next = index(nextX, nextZ);
            if (previous[next] >= 0) continue;
            previous[next] = current;
            frontier.push(next);
        }
    }
    if (previous[goalIndex] < 0 || goalIndex == startIndex) return false;
    std::vector<int> reversed;
    for (int current = goalIndex; current != startIndex; current = previous[current]) reversed.push_back(current);
    path.clear();
    path.reserve(reversed.size());
    for (auto it = reversed.rbegin(); it != reversed.rend(); ++it) {
        const int x = *it % CityLayout::WIDTH;
        const int z = *it / CityLayout::WIDTH;
        path.emplace_back((x + 0.5f) * CityLayout::TILE_SIZE - CityLayout::ORIGIN_X,
                          0.0f,
                          (z + 0.5f) * CityLayout::TILE_SIZE - CityLayout::ORIGIN_Z);
    }
    return !path.empty();
}

bool Simulation::CollectPickup(size_t index, PickupItem& pickup) {
    if (index >= m_Pickups.size() || !m_Pickups[index].available) return false;
    pickup = m_Pickups[index];
    if (pickup.container) {
        m_Pickups[index].available = false;
        m_Pickups[index].cooldownRemaining = 120.0f;
        m_Pickups[index].pendingLoot.clear();
        m_Pickups[index].pendingSorted = false;
    } else {
        m_Pickups.erase(m_Pickups.begin() + static_cast<std::ptrdiff_t>(index));
    }
    return true;
}

void Simulation::RecycleGuaranteedLoot(const std::vector<std::string>& loot) {
    if (!loot.empty()) m_RenewableLoot.push_back(loot);
}

void Simulation::RestorePickup(const PickupItem& pickup) {
    if (pickup.container) {
        const auto found = std::find_if(m_Pickups.begin(), m_Pickups.end(), [&](const PickupItem& current) {
            return current.container && glm::distance(current.position, pickup.position) < 0.01f;
        });
        if (found != m_Pickups.end()) {
            found->available = true;
            found->cooldownRemaining = 0.0f;
            found->pendingLoot = pickup.pendingLoot;
            found->pendingSorted = pickup.pendingSorted;
        }
        return;
    }
    m_Pickups.push_back(pickup);
}

size_t Simulation::GetNearbyCar(const glm::vec3& position, float radius) const {
    size_t nearest = m_Traffic.size();
    float nearestDistance = radius;
    for (size_t i = 0; i < m_Traffic.size(); ++i) {
        if (m_Traffic[i].bus || m_CarCooldowns[i] > 0.0f) continue;
        const float distance = glm::distance(glm::vec2(position.x, position.z), glm::vec2(m_Traffic[i].position.x, m_Traffic[i].position.z));
        if (distance < nearestDistance) { nearest = i; nearestDistance = distance; }
    }
    return nearest;
}

size_t Simulation::GetNearbyParkedCar(const glm::vec3& position, float radius) const {
    size_t nearest = m_ParkedCars.size();
    float nearestDistance = radius;
    for (size_t i = 0; i < m_ParkedCars.size(); ++i) {
        if (m_ParkedCarCooldowns[i] > 0.0f) continue;
        const float distance = glm::distance(glm::vec2(position.x, position.z),
                                             glm::vec2(m_ParkedCars[i].position.x, m_ParkedCars[i].position.z));
        if (distance < nearestDistance) {
            nearest = i;
            nearestDistance = distance;
        }
    }
    return nearest;
}

size_t Simulation::GetNearbyPedestrian(const glm::vec3& position, float radius) const {
    size_t nearest = m_Pedestrians.size();
    float nearestDistance = radius;
    for (size_t i = 0; i < m_Pedestrians.size(); ++i) {
        if (m_Pedestrians[i].robberyCooldown > 0.0f) continue;
        const float distance = glm::distance(glm::vec2(position.x, position.z),
                                             glm::vec2(m_Pedestrians[i].position.x, m_Pedestrians[i].position.z));
        if (distance < nearestDistance) {
            nearest = i;
            nearestDistance = distance;
        }
    }
    return nearest;
}

size_t Simulation::GetNearbyVendor(const glm::vec3& position, float radius) const {
    size_t nearest = m_StreetVendors.size();
    float nearestDistance = radius;
    for (size_t i = 0; i < m_StreetVendors.size(); ++i) {
        const auto& vendor = m_StreetVendors[i];
        const float distance = glm::distance(glm::vec2(position.x, position.z),
                                             glm::vec2(vendor.position.x, vendor.position.z));
        if (distance < nearestDistance) {
            nearest = i;
            nearestDistance = distance;
        }
    }
    return nearest;
}

bool Simulation::IsNearShop(const glm::vec3& position, float radius) const {
    const float halfWidth = CityLayout::ORIGIN_X;
    const float halfHeight = CityLayout::ORIGIN_Z;
    const int tileX = static_cast<int>(std::floor((position.x + halfWidth) / CityLayout::TILE_SIZE));
    const int tileZ = static_cast<int>(std::floor((position.z + halfHeight) / CityLayout::TILE_SIZE));
    const int tileRange = static_cast<int>(std::ceil(radius / CityLayout::TILE_SIZE)) + 1;
    const float radiusSquared = radius * radius;
    for (int z = std::max(0, tileZ - tileRange); z <= std::min(CityLayout::HEIGHT - 1, tileZ + tileRange); ++z) {
        for (int x = std::max(0, tileX - tileRange); x <= std::min(CityLayout::WIDTH - 1, tileX + tileRange); ++x) {
            if (m_City.GetTileAt(x, z) != TileType::Building) continue;
            const float wx = (x + 0.5f) * CityLayout::TILE_SIZE - halfWidth;
            const float wz = (z + 0.5f) * CityLayout::TILE_SIZE - halfHeight;
            const float dx = position.x - wx;
            const float dz = position.z - wz;
            if (dx * dx + dz * dz < radiusSquared) return true;
        }
    }
    return false;
}

bool Simulation::IsNearRecycler(const glm::vec3& position, float radius) const {
    return glm::distance(glm::vec2(position.x, position.z),
                         glm::vec2(m_RecyclerPosition.x, m_RecyclerPosition.z)) < radius;
}

bool Simulation::IsNearDealer(const glm::vec3& position, float radius) const {
    return glm::distance(glm::vec2(position.x, position.z),
                         glm::vec2(m_DealerPosition.x, m_DealerPosition.z)) < radius;
}

bool Simulation::IsNearMissionNpc(const glm::vec3& position, float radius) const {
    return glm::distance(glm::vec2(position.x, position.z), glm::vec2(m_MissionNpcPosition.x, m_MissionNpcPosition.z)) < radius;
}

bool Simulation::IsNearDog(const glm::vec3& position, float radius) const {
    return glm::distance(glm::vec2(position.x, position.z), glm::vec2(m_DogPosition.x, m_DogPosition.z)) < radius;
}

void Simulation::BefriendDog() {
    m_DogIsFriend = true;
}

bool Simulation::PetDog() {
    if (!m_DogIsFriend || m_DogPetCooldown > 0.0f) return false;
    m_DogPetCooldown = 20.0f;
    m_DogTime += 2.0f;
    return true;
}

void Simulation::SetDogState(bool isFriend, const glm::vec3& position, int coat) {
    m_DogIsFriend = isFriend;
    m_DogPosition = position;
    m_DogPosition.y = 0.0f;
    SetDogCoat(coat);
}

bool Simulation::StealCar(size_t index) {
    if (index >= m_Traffic.size() || m_Traffic[index].bus || m_CarCooldowns[index] > 0.0f) return false;
    m_CarCooldowns[index] = 40.0f;
    m_Traffic[index].mirrorsAvailable = false;
    return true;
}

bool Simulation::StealParkedCar(size_t index) {
    if (index >= m_ParkedCars.size() || m_ParkedCarCooldowns[index] > 0.0f) return false;
    m_ParkedCarCooldowns[index] = 40.0f;
    m_ParkedCars[index].mirrorsAvailable = false;
    return true;
}

RobberyOutcome Simulation::RobPedestrian(size_t index, bool direct, const glm::vec3& source) {
    RobberyOutcome outcome;
    if (index >= m_Pedestrians.size() || m_Pedestrians[index].robberyCooldown > 0.0f) return outcome;
    auto& pedestrian = m_Pedestrians[index];
    outcome.attempted = true;
    pedestrian.robberyCooldown = 30.0f;
    const float successChance = direct ? 1.0f : 0.75f;
    outcome.successful = m_Unit(m_Random) < successChance;
    outcome.caught = direct ? m_Unit(m_Random) < 0.55f : (!outcome.successful && m_Unit(m_Random) < 0.65f);
    if (outcome.successful) {
        const float minimum = direct ? 12000.0f : 3000.0f;
        const float maximum = direct ? 45000.0f : 18000.0f;
        outcome.money = minimum + m_Unit(m_Random) * (maximum - minimum);
    }
    if (outcome.caught) {
        pedestrian.fleeRemaining = 8.0f;
        pedestrian.fleeDirection = pedestrian.position - source;
        pedestrian.fleeDirection.y = 0.0f;
        if (glm::dot(pedestrian.fleeDirection, pedestrian.fleeDirection) < 0.001f) {
            const float angle = m_Unit(m_Random) * glm::two_pi<float>();
            pedestrian.fleeDirection = {std::cos(angle), 0.0f, std::sin(angle)};
        } else {
            pedestrian.fleeDirection = glm::normalize(pedestrian.fleeDirection);
        }
        pedestrian.route.clear();
        pedestrian.nextWaypoint = 0;
    }
    return outcome;
}

void Simulation::DropPoop(const glm::vec3& position) {
    m_GroundPoops.push_back({{position.x, 0.04f, position.z}, 45.0f});
}

bool Simulation::ThrowPoop(const glm::vec3& position, const glm::vec3& direction) {
    glm::vec3 horizontal(direction.x, 0.0f, direction.z);
    if (glm::dot(horizontal, horizontal) < 0.001f) return false;
    horizontal = glm::normalize(horizontal);
    m_PoopProjectiles.push_back({
        position + glm::vec3(0.0f, 1.25f, 0.0f) + horizontal * 0.45f,
        horizontal * 13.5f + glm::vec3(0.0f, 3.6f, 0.0f),
        5.0f
    });
    return true;
}

namespace {
// Bombilla de una farola: en el extremo del brazo, bajo la luminaria (1,7 m hacia la calle desde el poste)
glm::vec3 LampBulbPosition(const StreetLamp& lamp) {
    return lamp.position + glm::vec3(std::cos(lamp.yaw) * 1.7f, 3.92f, -std::sin(lamp.yaw) * 1.7f);
}
} // namespace

std::vector<glm::vec4> Simulation::GetNearestLampLights(const glm::vec3& focus, size_t maxCount, float maxDistance) const {
    std::vector<std::pair<float, glm::vec3>> candidates;
    for (const StreetLamp& lamp : m_StreetLamps) {
        const float distance = glm::distance(glm::vec2(lamp.position.x, lamp.position.z), glm::vec2(focus.x, focus.z));
        if (distance <= maxDistance) candidates.emplace_back(distance, LampBulbPosition(lamp));
    }
    const size_t count = std::min(maxCount, candidates.size());
    std::partial_sort(candidates.begin(), candidates.begin() + static_cast<std::ptrdiff_t>(count), candidates.end(),
                      [](const auto& a, const auto& b) { return a.first < b.first; });
    std::vector<glm::vec4> lights;
    lights.reserve(count);
    const float lastDistance = count > 0 ? candidates[count - 1].first : 1.0f;
    const bool full = count == maxCount && candidates.size() > count;   // si sobran farolas, la mas lejana entra y sale suave
    for (size_t index = 0; index < count; ++index) {
        const float fade = full ? 1.0f - AtmosphereSmoothstep(0.75f, 1.0f, candidates[index].first / std::max(lastDistance, 1.0f)) : 1.0f;
        lights.emplace_back(candidates[index].second, fade);
    }
    return lights;
}

void Simulation::Update(float dt, const glm::vec3& playerPosition) {
    m_Clock = std::fmod(m_Clock + dt / kDayLengthSeconds, 1.0f);
    m_DayProgress = m_Clock;
    m_WeatherRemaining -= dt;
    if (m_WeatherRemaining <= 0.0f) {
        // despejado -> llovizna (60 %) o neblina (40 %); desde cualquiera de las dos vuelve a despejar
        const Weather previous = m_Weather;
        if (previous == Weather::Clear) m_Weather = m_Unit(m_Random) < 0.6f ? Weather::Drizzle : Weather::Mist;
        else m_Weather = Weather::Clear;
        m_WeatherChange = m_Weather == Weather::Drizzle ? 1 : m_Weather == Weather::Mist ? 3 : previous == Weather::Drizzle ? 2 : 4;
        m_RainTarget = m_Weather == Weather::Drizzle ? 0.35f + 0.65f * m_Unit(m_Random) : 0.0f;
        m_MistTarget = m_Weather == Weather::Mist ? 0.5f + 0.5f * m_Unit(m_Random) : 0.0f;
        m_RainRetarget = 40.0f + m_Unit(m_Random) * 50.0f;
        m_WeatherRemaining = 150.0f + m_Unit(m_Random) * 150.0f;
    }
    // mientras llovizna, la intensidad cambia de ritmo cada 40-90 s
    if (m_Weather == Weather::Drizzle) {
        m_RainRetarget -= dt;
        if (m_RainRetarget <= 0.0f) {
            m_RainTarget = 0.3f + 0.7f * m_Unit(m_Random);
            m_RainRetarget = 40.0f + m_Unit(m_Random) * 50.0f;
        }
    }
    m_RainIntensity += std::clamp(m_RainTarget - m_RainIntensity, -0.08f * dt, 0.12f * dt);
    m_Mist += std::clamp(m_MistTarget - m_Mist, -0.02f * dt, 0.03f * dt);
    m_Wetness = IsRaining() ? std::min(1.0f, m_Wetness + dt * 0.25f * std::min(1.0f, m_RainIntensity * 2.0f))
                            : std::max(0.0f, m_Wetness - dt * 0.04f);
    if (IsRaining()) {
        for (auto& drop : m_RainOffsets) {
            drop.y -= 24.0f * dt;
            if (drop.y < 0.0f) {
                drop.y = 14.0f + m_Unit(m_Random) * 2.0f;
                drop.x = (m_Unit(m_Random) * 2.0f - 1.0f) * 13.0f;
                drop.z = (m_Unit(m_Random) * 2.0f - 1.0f) * 13.0f;
            }
        }
    }
    m_DogTime += dt;
    m_DogPetCooldown = std::max(0.0f, m_DogPetCooldown - dt);
    if (m_DogIsFriend) {
        const glm::vec2 offset(playerPosition.x - m_DogPosition.x, playerPosition.z - m_DogPosition.z);
        const float distance = glm::length(offset);
        if (distance > 2.4f) {
            const float move = std::min(3.2f * dt, distance - 2.4f);
            const glm::vec2 direction = offset / distance;
            const glm::vec3 nextPosition = m_DogPosition + glm::vec3(direction.x * move, 0.0f, direction.y * move);
            if (m_City.IsWalkable(nextPosition.x, nextPosition.z)) m_DogPosition = nextPosition;
            m_DogYaw = std::atan2(direction.x, direction.y);
        } else {
            m_DogYaw = std::atan2(offset.x, offset.y);
        }
    }
    UpdatePedestrians(dt, playerPosition);
    UpdatePigeons(dt, playerPosition);
    UpdateRats(dt, playerPosition);
    UpdatePoop(dt);
    UpdateTraffic(dt);
    UpdateBus(dt);
    for (size_t index = 0; index < m_ParkedCarCooldowns.size(); ++index) {
        m_ParkedCarCooldowns[index] = std::max(0.0f, m_ParkedCarCooldowns[index] - dt);
        if (m_ParkedCarCooldowns[index] <= 0.0f) m_ParkedCars[index].mirrorsAvailable = true;
    }
    m_Elapsed += dt;
    UpdatePickups(dt, playerPosition);
}

void Simulation::BuildBirdSpots() {
    // Alturas de posado (m sobre el suelo). Ajustalas si cambia el tamano de la farola o del semaforo.
    constexpr float kLampPerchHeight = 4.2f;
    constexpr float kSignalPerchHeight = 3.45f;

    std::vector<BirdSpot> spots;
    // Suelo: prados y andenes de toda la ciudad (1 de cada 4 baldosas de anden o plaza)
    for (const glm::vec3& grass : m_GrassPositions) spots.push_back({grass, BirdPerch::Ground});
    for (int z = 1; z < CityLayout::HEIGHT - 1; ++z) {
        for (int x = 1; x < CityLayout::WIDTH - 1; ++x) {
            const TileType tile = m_City.GetTileAt(x, z);
            if (tile != TileType::Sidewalk && tile != TileType::Plaza) continue;
            if ((x * 5 + z * 3) % 4 != 0) continue;
            const glm::vec3 point((static_cast<float>(x) + 0.5f) * CityLayout::TILE_SIZE - CityLayout::ORIGIN_X, 0.0f,
                                  (static_cast<float>(z) + 0.5f) * CityLayout::TILE_SIZE - CityLayout::ORIGIN_Z);
            if (!m_City.IsWalkable(point.x, point.z)) continue;
            spots.push_back({point, BirdPerch::Ground});
        }
    }
    // Ramas: cuatro puntos en la copa de cada arbol (copa entre 3.5 y 4.9 m)
    for (size_t tree = 0; tree < m_TreePositions.size(); ++tree) {
        for (size_t branch = 0; branch < 4; ++branch) {
            const float angle = (static_cast<float>(branch) + 0.37f * static_cast<float>(tree % 5)) * glm::half_pi<float>();
            const float radius = 0.45f + 0.15f * static_cast<float>((tree + branch) % 4);
            const float height = 3.5f + 0.35f * static_cast<float>((tree * 3 + branch) % 5);
            spots.push_back({m_TreePositions[tree] + glm::vec3(std::cos(angle) * radius, height, std::sin(angle) * radius),
                             BirdPerch::Tree});
        }
    }
    // Postes: farolas y semaforos
    for (const StreetLamp& lamp : m_StreetLamps)
        spots.push_back({lamp.position + glm::vec3(0.0f, kLampPerchHeight, 0.0f), BirdPerch::Pole});
    for (const TrafficSignal& signal : m_TrafficSignals)
        spots.push_back({signal.polePosition + glm::vec3(0.0f, kSignalPerchHeight, 0.0f), BirdPerch::Pole});

    m_Birds.SetSpots(std::move(spots), m_BirdModels.size());
}

void Simulation::UpdatePigeons(float dt, const glm::vec3& playerPosition) {
    m_BirdDisturbances.clear();
    for (const Pedestrian& pedestrian : m_Pedestrians)
        m_BirdDisturbances.emplace_back(pedestrian.position.x, pedestrian.position.z);
    m_Birds.Update(dt, playerPosition, m_BirdDisturbances);
}

void Simulation::UpdateRats(float dt, const glm::vec3& playerPosition) {
    if (dt <= 0.0f) return;

    for (Rat& rat : m_Rats) {
        rat.animTime += dt;

        // 1. Detectar amenazas cercanas (jugador o peatones)
        float threatDistance = glm::distance(glm::vec2(playerPosition.x, playerPosition.z),
                                             glm::vec2(rat.position.x, rat.position.z));
        glm::vec2 threatPos(playerPosition.x, playerPosition.z);

        for (const auto& pedestrian : m_Pedestrians) {
            const float pedDist = glm::distance(glm::vec2(pedestrian.position.x, pedestrian.position.z),
                                                glm::vec2(rat.position.x, rat.position.z));
            if (pedDist < threatDistance) {
                threatDistance = pedDist;
                threatPos = glm::vec2(pedestrian.position.x, pedestrian.position.z);
            }
        }

        // Si una persona está demasiado cerca (< 3.2m), la rata entra en pánico (Fleeing)
        if (threatDistance < 3.2f) {
            rat.state = RatState::Fleeing;
            rat.fleeRemaining = 2.0f + m_Unit(m_Random) * 1.2f;

            // Huir en dirección contraria a la amenaza con zigzag aleatorio
            glm::vec2 away = glm::vec2(rat.position.x, rat.position.z) - threatPos;
            if (glm::length(away) > 0.001f) {
                away = glm::normalize(away);
            } else {
                away = glm::vec2(1.0f, 0.0f);
            }
            const float zigzag = (m_Unit(m_Random) - 0.5f) * 0.9f;
            glm::vec2 fleeDir = glm::normalize(away + glm::vec2(-away.y, away.x) * zigzag);

            bool foundEscape = false;
            for (float dist = 6.5f; dist >= 2.5f; dist -= 1.0f) {
                glm::vec3 candidate = rat.position + glm::vec3(fleeDir.x * dist, 0.0f, fleeDir.y * dist);
                if (m_City.IsSidewalk(candidate.x, candidate.z) && !m_City.IsBlocked(candidate.x, candidate.z, 0.2f)) {
                    rat.target = candidate;
                    foundEscape = true;
                    break;
                }
            }
            if (!foundEscape) {
                glm::vec3 escPoint;
                if (FindSidewalkPoint(escPoint, rat.position, 5.0f)) {
                    rat.target = escPoint;
                }
            }
            rat.speed = 4.0f + m_Unit(m_Random) * 1.4f; // Huida veloz (4.0 - 5.4 m/s)
        }

        // 2. Máquina de estados
        if (rat.state == RatState::Fleeing) {
            rat.fleeRemaining -= dt;
            if (rat.fleeRemaining <= 0.0f && threatDistance > 4.8f) {
                // Escapó de la amenaza: parar a olfatear en alerta
                rat.state = RatState::Idle;
                rat.stateTimer = 0.8f + m_Unit(m_Random) * 1.0f;
                rat.speed = 0.0f;
            }
        } else if (rat.state == RatState::Idle) {
            rat.stateTimer -= dt;
            rat.speed = 0.0f;
            // Movimiento nervioso de olfateo
            rat.sniffOffset = std::sin(rat.animTime * 14.0f) * 0.30f;

            if (rat.stateTimer <= 0.0f) {
                // Comprobar si hay bolsas de basura o canecas cerca para husmear
                const PickupItem* nearbyTrash = nullptr;
                float closestTrashDist = 8.0f;
                for (const auto& pickup : m_Pickups) {
                    if (!pickup.available) continue;
                    float d = glm::distance(glm::vec2(pickup.position.x, pickup.position.z),
                                            glm::vec2(rat.position.x, rat.position.z));
                    if (d < closestTrashDist) {
                        closestTrashDist = d;
                        nearbyTrash = &pickup;
                    }
                }

                if (nearbyTrash && m_Unit(m_Random) < 0.45f) {
                    // Scurry hacia la basura
                    glm::vec3 trashTarget;
                    if (FindSidewalkPoint(trashTarget, nearbyTrash->position, 0.9f)) {
                        rat.target = trashTarget;
                        rat.state = RatState::Scurrying;
                        rat.speed = 2.4f + m_Unit(m_Random) * 1.0f;
                        rat.stateTimer = 2.5f;
                    }
                } else {
                    // Correr en ráfaga hacia otro punto del andén (en 2D libre, no una línea recta)
                    glm::vec3 newTarget;
                    if (FindSidewalkPoint(newTarget, rat.position, 5.5f)) {
                        rat.target = newTarget;
                        rat.state = RatState::Scurrying;
                        rat.speed = 2.2f + m_Unit(m_Random) * 1.2f;
                        rat.stateTimer = 1.8f + m_Unit(m_Random) * 1.2f;
                    } else {
                        rat.stateTimer = 0.4f;
                    }
                }
            }
        } else if (rat.state == RatState::Scavenging) {
            rat.stateTimer -= dt;
            rat.speed = 0.0f;
            // Husmeando basura: pequeños espasmos de cabeza
            rat.sniffOffset = std::sin(rat.animTime * 18.0f) * 0.20f;

            if (rat.stateTimer <= 0.0f) {
                rat.state = RatState::Idle;
                rat.stateTimer = 0.5f + m_Unit(m_Random) * 0.8f;
            }
        } else if (rat.state == RatState::Scurrying) {
            rat.stateTimer -= dt;

            float distToTarget = glm::distance(glm::vec2(rat.position.x, rat.position.z),
                                               glm::vec2(rat.target.x, rat.target.z));
            if (distToTarget < 0.25f || rat.stateTimer <= 0.0f) {
                // Verificar si llegó cerca de basura
                bool nearGarbage = false;
                for (const auto& pickup : m_Pickups) {
                    if (pickup.available && glm::distance(glm::vec2(pickup.position.x, pickup.position.z),
                                                          glm::vec2(rat.position.x, rat.position.z)) < 1.3f) {
                        nearGarbage = true;
                        break;
                    }
                }
                if (nearGarbage && m_Unit(m_Random) < 0.70f) {
                    rat.state = RatState::Scavenging;
                    rat.stateTimer = 2.0f + m_Unit(m_Random) * 2.5f;
                } else {
                    rat.state = RatState::Idle;
                    rat.stateTimer = 0.5f + m_Unit(m_Random) * 1.3f;
                }
                rat.speed = 0.0f;
            }
        }

        // 3. Movimiento y rotación
        if (rat.speed > 0.05f) {
            glm::vec2 toTarget(rat.target.x - rat.position.x, rat.target.z - rat.position.z);
            const float dist = glm::length(toTarget);
            if (dist > 0.01f) {
                glm::vec2 dir = toTarget / dist;

                // Suavizar giro hacia el objetivo
                const float desiredYaw = std::atan2(dir.x, dir.y);
                float angleDiff = desiredYaw - rat.yaw;
                while (angleDiff > glm::pi<float>()) angleDiff -= glm::two_pi<float>();
                while (angleDiff < -glm::pi<float>()) angleDiff += glm::two_pi<float>();
                rat.yaw += angleDiff * std::min(1.0f, 15.0f * dt);

                // Desplazamiento
                const float move = std::min(rat.speed * dt, dist);
                const glm::vec3 nextPos = rat.position + glm::vec3(dir.x * move, 0.0f, dir.y * move);

                if (m_City.IsSidewalk(nextPos.x, nextPos.z) && !m_City.IsBlocked(nextPos.x, nextPos.z, 0.15f)) {
                    rat.position = nextPos;
                } else {
                    // Detenerse ante bordes o muros y volver a Idle para reevaluar ruta
                    rat.state = RatState::Idle;
                    rat.stateTimer = 0.3f;
                    rat.speed = 0.0f;
                }
            }
        }
    }
}


void Simulation::UpdatePoop(float dt) {
    for (auto projectile = m_PoopProjectiles.begin(); projectile != m_PoopProjectiles.end();) {
        projectile->lifetime -= dt;
        if (projectile->lifetime <= 0.0f) {
            projectile = m_PoopProjectiles.erase(projectile);
            continue;
        }
        projectile->velocity.y -= 13.5f * dt;
        projectile->position += projectile->velocity * dt;
        bool hitPedestrian = false;
        for (auto& pedestrian : m_Pedestrians) {
            const glm::vec2 delta(pedestrian.position.x - projectile->position.x,
                                  pedestrian.position.z - projectile->position.z);
            if (glm::length(delta) >= 0.85f || std::abs(pedestrian.position.y + 0.9f - projectile->position.y) >= 1.1f) continue;
            pedestrian.splatRemaining = 12.0f;
            pedestrian.fleeRemaining = 8.0f;
            pedestrian.fleeDirection = pedestrian.position - projectile->position;
            pedestrian.fleeDirection.y = 0.0f;
            if (glm::dot(pedestrian.fleeDirection, pedestrian.fleeDirection) < 0.001f) {
                const float angle = m_Unit(m_Random) * glm::two_pi<float>();
                pedestrian.fleeDirection = {std::cos(angle), 0.0f, std::sin(angle)};
            } else {
                pedestrian.fleeDirection = glm::normalize(pedestrian.fleeDirection);
            }
            pedestrian.route.clear();
            pedestrian.nextWaypoint = 0;
            ++m_PoopHitCount;
            hitPedestrian = true;
            break;
        }
        if (hitPedestrian) {
            projectile = m_PoopProjectiles.erase(projectile);
        } else if (projectile->position.y <= 0.08f) {
            DropPoop(projectile->position);
            projectile = m_PoopProjectiles.erase(projectile);
        } else {
            ++projectile;
        }
    }
    for (auto mark = m_GroundPoops.begin(); mark != m_GroundPoops.end();) {
        mark->lifetime -= dt;
        if (mark->lifetime <= 0.0f) mark = m_GroundPoops.erase(mark);
        else ++mark;
    }
}

void Simulation::UpdatePickups(float dt, const glm::vec3& playerPosition) {
    // Reactivar contenedores vacíos después del enfriamiento
    for (auto& pickup : m_Pickups) {
        if (!pickup.container || pickup.available) continue;
        pickup.cooldownRemaining = std::max(0.0f, pickup.cooldownRemaining - dt);
        if (pickup.cooldownRemaining <= 0.0f) pickup.available = true;
    }
    m_PickupSpawnTimer -= dt;
    // Contar solo bolsas dinámicas (los contenedores fijos no cuentan)
    const size_t dynamicBags = std::count_if(m_Pickups.begin(), m_Pickups.end(),
        [](const PickupItem& p) { return !p.container; });
    if (dynamicBags >= 35 || m_PickupSpawnTimer > 0.0f || m_ValidTrashSpots.empty()) return;

    const glm::vec2 playerXZ(playerPosition.x, playerPosition.z);
    static size_t s_SpotCursor = 0;
    const size_t spotCount = m_ValidTrashSpots.size();
    // Limitar iteraciones por frame para no bloquear el hilo principal
    const size_t maxTries = std::min(spotCount, size_t(400));
    size_t tried = 0;
    while (tried < maxTries) {
        const glm::vec3& spot = m_ValidTrashSpots[s_SpotCursor % spotCount];
        ++s_SpotCursor;
        ++tried;
        const glm::vec2 toSpot(spot.x - playerXZ.x, spot.z - playerXZ.y);
        const float dist = glm::length(toSpot);
        // No aparece a menos de 12 m del jugador
        if (dist < 12.0f) continue;
        // No aparece justo delante del jugador si está muy cerca (8–25 m)
        if (dist < 25.0f) {
            const float dot = (dist > 0.01f)
                ? glm::dot(glm::normalize(toSpot), m_PlayerFacing)
                : 0.0f;
            if (dot > 0.65f) continue; // dentro del FOV frontal estrecho
        }
        // No solapar con otra bolsa existente
        const bool overlapping = std::any_of(m_Pickups.begin(), m_Pickups.end(),
            [&](const PickupItem& p) { return !p.container && glm::distance(p.position, spot) < 2.5f; });
        if (overlapping) continue;
        // Colocar bolsa
        const size_t variant = static_cast<size_t>(m_Unit(m_Random) * m_PickupMeshes.size()) % m_PickupMeshes.size();
        m_Pickups.push_back({variant, spot, false, true, 0.0f});
        if (!m_RenewableLoot.empty()) {
            m_Pickups.back().guaranteedLoot = std::move(m_RenewableLoot.front());
            m_RenewableLoot.erase(m_RenewableLoot.begin());
        }
        // Reaparición: 5–12 s (ciudad sucia pero no instantánea)
        m_PickupSpawnTimer = 5.0f + m_Unit(m_Random) * 7.0f;
        return;
    }
    // No se encontró spot adecuado; reintento en 3 s
    m_PickupSpawnTimer = 3.0f;
}

std::vector<PickupItem> Simulation::CollectPickups(const glm::vec3& position, float radius) {
    std::vector<PickupItem> collected;
    for (auto pickup = m_Pickups.begin(); pickup != m_Pickups.end();) {
        if (!pickup->available || glm::distance(pickup->position, position) > radius) {
            ++pickup;
            continue;
        }
        collected.push_back(*pickup);
        if (pickup->container) {
            pickup->available = false;
            pickup->cooldownRemaining = 120.0f;
            ++pickup;
        } else {
            pickup = m_Pickups.erase(pickup);
        }
    }
    return collected;
}

void Simulation::UpdatePedestrians(float dt, const glm::vec3& playerPosition) {
    m_PedestrianSpawnTimer -= dt;
    const size_t populationLimit = IsNight() ? 9 : 22;
    if (m_Pedestrians.size() < populationLimit && m_PedestrianSpawnTimer <= 0.0f) {
        glm::vec3 spawn(0.0f);
        bool foundSpawn = false;
        for (int attempt = 0; attempt < 60 && !foundSpawn; ++attempt) {
            const float angle = m_Unit(m_Random) * glm::two_pi<float>();
            const float distance = 58.0f + m_Unit(m_Random) * 12.0f;
            const glm::vec3 candidate = playerPosition
                + glm::vec3(std::cos(angle) * distance, 0.0f, std::sin(angle) * distance);
            if (!m_City.IsSidewalk(candidate.x, candidate.z)
                || m_City.IsBlocked(candidate.x, candidate.z, 0.25f)) continue;
            spawn = candidate;
            foundSpawn = true;
        }
        if (foundSpawn) {
            Pedestrian pedestrian;
            pedestrian.position = spawn;
            glm::vec3 destination;
            if (FindSidewalkPoint(destination, spawn, 48.0f) && FindSidewalkPath(spawn, destination, pedestrian.route)) {
                pedestrian.target = pedestrian.route.front();
                pedestrian.nextWaypoint = 1;
            } else {
                pedestrian.target = spawn;
            }
            pedestrian.speed = 0.75f + m_Unit(m_Random) * 0.7f;
            pedestrian.scale = 0.94f + m_Unit(m_Random) * 0.16f;
            pedestrian.animationOffset = m_Unit(m_Random) * 2.0f;
            if (!m_PedestrianAppearances.empty()) {
                std::uniform_int_distribution<size_t> appearanceDistribution(0, m_PedestrianAppearances.size() - 1);
                pedestrian.appearance = appearanceDistribution(m_Random);
            }
            pedestrian.color = {0.22f + m_Unit(m_Random) * 0.55f, 0.18f + m_Unit(m_Random) * 0.48f, 0.15f + m_Unit(m_Random) * 0.42f};
            m_Pedestrians.push_back(pedestrian);
        }
        m_PedestrianSpawnTimer = 0.6f;
    }

    for (auto& pedestrian : m_Pedestrians) {
        pedestrian.robberyCooldown = std::max(0.0f, pedestrian.robberyCooldown - dt);
        pedestrian.fleeRemaining = std::max(0.0f, pedestrian.fleeRemaining - dt);
        pedestrian.splatRemaining = std::max(0.0f, pedestrian.splatRemaining - dt);
        pedestrian.moving = false;
        pedestrian.animationTime += dt;
        if (pedestrian.fleeRemaining > 0.0f) {
            const glm::vec3 direction = glm::normalize(pedestrian.fleeDirection);
            const glm::vec3 next = pedestrian.position + direction * (pedestrian.speed * 2.4f * dt);
            if (m_City.IsSidewalk(next.x, next.z) && !m_City.IsBlocked(next.x, next.z, 0.18f)) {
                pedestrian.position = next;
                pedestrian.yaw = std::atan2(direction.x, direction.z);
                pedestrian.moving = true;
            } else {
                pedestrian.fleeDirection = {-pedestrian.fleeDirection.z, 0.0f, pedestrian.fleeDirection.x};
            }
            continue;
        }
        glm::vec3 direction = pedestrian.target - pedestrian.position;
        direction.y = 0.0f;
        float distance = glm::length(direction);
        if (distance < 0.45f) {
            if (pedestrian.nextWaypoint < pedestrian.route.size()) {
                pedestrian.target = pedestrian.route[pedestrian.nextWaypoint++];
            } else {
                glm::vec3 destination;
                pedestrian.route.clear();
                pedestrian.nextWaypoint = 0;
                if (FindSidewalkPoint(destination, pedestrian.position, 48.0f) && FindSidewalkPath(pedestrian.position, destination, pedestrian.route)) {
                    pedestrian.target = pedestrian.route.front();
                    pedestrian.nextWaypoint = 1;
                } else pedestrian.target = pedestrian.position;
            }
            direction = pedestrian.target - pedestrian.position;
            direction.y = 0.0f;
            distance = glm::length(direction);
            if (distance < 0.001f) continue;
        }
        direction /= distance;
        const glm::vec3 next = pedestrian.position + direction * (pedestrian.speed * dt);
        if (m_City.IsSidewalk(next.x, next.z) && !m_City.IsBlocked(next.x, next.z, 0.18f)) {
            pedestrian.position = next;
            pedestrian.yaw = std::atan2(direction.x, direction.z);
            pedestrian.moving = true;
        } else {
            pedestrian.route.clear();
            pedestrian.nextWaypoint = 0;
            glm::vec3 destination;
            if (FindSidewalkPoint(destination, pedestrian.position, 32.0f) && FindSidewalkPath(pedestrian.position, destination, pedestrian.route)) {
                pedestrian.target = pedestrian.route.front();
                pedestrian.nextWaypoint = 1;
            } else pedestrian.target = pedestrian.position;
        }
    }
    std::erase_if(m_Pedestrians, [&](const Pedestrian& pedestrian) { return glm::distance(pedestrian.position, playerPosition) > 96.0f; });
}

void Simulation::UpdateTraffic(float dt) {
    if (dt <= 0.0f) return;
    for (auto& vehicle : m_Traffic) vehicle.previousPosition = vehicle.position;
    constexpr float braking = 5.0f;
    constexpr float acceleration = 1.8f;
    constexpr float gap = 1.8f;
    constexpr float probeStep = 0.5f;
    constexpr float kStallBeforeForcing = 3.0f;   // s detenido sin semaforo ni peaton antes de forzar el paso
    constexpr float kForceDuration = 4.0f;        // s que se mantiene el paso forzado (evita avanzar a tirones)
    constexpr float kConflictHorizon = 3.0f;      // s hacia adelante en que se predice el recorrido de otro carro
    // Orden total y estable entre carros (semaforo y luego indice): sin ciclos, asi que en cualquier grupo
    // que se bloquea mutuamente siempre hay uno con derecho de paso que puede avanzar.
    const auto hasPriority = [&](size_t first, size_t second) {
        // Dos carros por el mismo carril y en la misma direccion: el que va adelante tiene la prioridad
        // (el de atras lo sigue); si no, al fundirse dos rutas cada uno esperaria al otro.
        {
            const TrafficVehicle& a = m_Traffic[first];
            const TrafficVehicle& b = m_Traffic[second];
            const glm::vec2 direction(a.direction.x, a.direction.z);
            const glm::vec2 otherDirection(b.direction.x, b.direction.z);
            if (glm::dot(direction, otherDirection) >= 0.6f) {
                const glm::vec2 offset(b.position.x - a.position.x, b.position.z - a.position.z);
                const float along = glm::dot(offset, direction);
                const float lateral = std::abs(direction.x * offset.y - direction.y * offset.x);
                if (lateral <= (a.width + b.width) * 0.5f + 0.3f && std::abs(along) > 0.05f) return along < 0.0f;
            }
        }
        const auto signalPriority = [&](const TrafficVehicle& vehicle) {
            const glm::vec2 direction(vehicle.direction.x, vehicle.direction.z);
            const size_t axis = std::abs(direction.x) >= std::abs(direction.y) ? 0 : 1;
            const size_t state = GetSignalState(m_Elapsed, axis);
            return state == 0 ? 2 : state == 1 ? 1 : 0;
        };
        const int firstPriority = signalPriority(m_Traffic[first]);
        const int secondPriority = signalPriority(m_Traffic[second]);
        if (firstPriority != secondPriority) return firstPriority > secondPriority;
        return first < second;
    };
    float remaining = std::min(dt, 0.5f);
    while (remaining > 1e-8f) {
        const float stepTime = std::min(remaining, 0.05f);
        for (auto& vehicle : m_Traffic) {
            float clearance = std::numeric_limits<float>::infinity();
            bool stoppedForPerson = false;
            const float routeLength = vehicle.routeLength;
            for (const auto& other : m_Traffic) {
                if (&vehicle == &other || vehicle.routeIndex != other.routeIndex) continue;
                const float routeGap = std::fmod(other.distance - vehicle.distance + routeLength, routeLength);
                clearance = std::min(clearance, std::max(0.0f, routeGap - (vehicle.length + other.length) * 0.5f - gap));
            }
            // Varias rutas comparten tramos de calle: un carro de otra ruta que va por el mismo carril, por delante y en
            // la misma direccion, tambien es el carro de adelante (si no, se solapan y se quedan esperando).
            {
                const glm::vec2 own(vehicle.direction.x, vehicle.direction.z);
                for (const auto& other : m_Traffic) {
                    if (&vehicle == &other || vehicle.routeIndex == other.routeIndex) continue;
                    const glm::vec2 otherDirection(other.direction.x, other.direction.z);
                    if (glm::dot(own, otherDirection) < 0.6f) continue;
                    const glm::vec2 offset(other.position.x - vehicle.position.x, other.position.z - vehicle.position.z);
                    const float along = glm::dot(offset, own);
                    const float lateral = std::abs(own.x * offset.y - own.y * offset.x);
                    if (lateral > (vehicle.width + other.width) * 0.5f + 0.3f || along > 60.0f) continue;
                    const bool ahead = along > 0.05f
                        || (std::abs(along) <= 0.05f && &vehicle - m_Traffic.data() > &other - m_Traffic.data());
                    if (!ahead) continue;
                    clearance = std::min(clearance, std::max(0.0f, along - (vehicle.length + other.length) * 0.5f - gap));
                }
            }
            const float lookAhead = std::max(5.0f, vehicle.speed * vehicle.speed / (2.0f * braking) + vehicle.speed * 0.2f + 2.0f);
            const float radius = lookAhead + std::hypot(vehicle.length * 0.5f + 0.8f, vehicle.width * 0.5f + 0.55f);
            const glm::vec2 carPosition(vehicle.position.x, vehicle.position.z);
            const glm::vec2 forward(vehicle.direction.x, vehicle.direction.z);
            const size_t vehicleAxis = std::abs(forward.x) >= std::abs(forward.y) ? 0 : 1;
            float signalDistance = std::numeric_limits<float>::infinity();
            if (GetSignalState(m_Elapsed, vehicleAxis) != 0) {
                for (const auto& signal : m_TrafficSignals) {
                    if (signal.phaseGroup != vehicleAxis) continue;
                    float candidateDistance = 0.0f;
                    if (!IsVehicleBeforeSignal(vehicle, signal.stopPosition, forward,
                                               signal.approachDirection, &candidateDistance)) {
                        continue;
                    }
                    signalDistance = std::min(signalDistance, candidateDistance);
                }
                if (std::isfinite(signalDistance)) {
                    clearance = std::min(clearance, std::max(0.0f, signalDistance - vehicle.length * 0.5f - 1.0f));
                }
            }
            const size_t vehicleIndex = static_cast<size_t>(&vehicle - m_Traffic.data());
            vehicle.waitingAtSignal = std::isfinite(signalDistance) && signalDistance < lookAhead + vehicle.length;
            // Atascado de verdad (no es semaforo ni peaton): quien tiene derecho de paso atraviesa a los que lo
            // bloquean en vez de esperar para siempre; el cruce dura un instante y se despeja.
            if (vehicle.stalledTime > kStallBeforeForcing) vehicle.forcingRemaining = kForceDuration;
            const bool forceThrough = vehicle.forcingRemaining > 0.0f;
            // Posicion futura de otro carro (por su propia ruta) dentro de `time` segundos
            const auto futureBox = [&](const TrafficVehicle& other, float time, glm::vec3& position, glm::vec2& direction) {
                glm::vec3 futureDirection;
                size_t futureWaypoint = 0;
                SampleCircuit(other.route, other.routeCumulative, other.routeLength, other.distance + other.speed * time,
                              position, futureDirection, futureWaypoint);
                direction = {futureDirection.x, futureDirection.z};
            };
            // Mi cuerpo ya esta en el camino que recorrera `other` en los proximos segundos: debo terminar de
            // cruzar, no ceder (si cediera, ambos quedarian esperandose).
            const auto alreadyInPathOf = [&](const TrafficVehicle& other) {
                for (float time = 0.0f; time <= kConflictHorizon; time += 0.5f) {
                    glm::vec3 position;
                    glm::vec2 direction;
                    futureBox(other, time, position, direction);
                    if (OrientedBoxesOverlap(vehicle.position, forward, vehicle.length, vehicle.width,
                                             position, direction, other.length, other.width)) return true;
                }
                return false;
            };
            // Un carro que cruza y ya tiene el cuerpo en el corredor del bus termina de cruzar: si frenara
            // por el bus, ambos quedarian esperandose. El bus frena para el (UpdateBus) y los demas ceden.
            bool committedInBusLane = false;
            if (std::abs(forward.y) < 0.7f) {
                for (const BusState& bus : m_Buses) {
                    if (bus.Elevated()) continue;
                    const float busLookAhead = std::max(5.0f, bus.speed * bus.speed / 8.0f + bus.speed * 0.2f + 2.0f);
                    for (float busAhead = 0.0f; busAhead <= busLookAhead && !committedInBusLane; busAhead += probeStep) {
                        const float aheadZ = bus.position.z + bus.direction * busAhead;
                        committedInBusLane = OrientedBoxesOverlap({Viaduct::BusPathX(aheadZ, bus.laneX), bus.position.y, aheadZ},
                                                                  bus.heading, 18.2f, 2.52f, vehicle.position, forward,
                                                                  vehicle.length, vehicle.width);
                    }
                    if (committedInBusLane) break;
                }
            }
            for (float ahead = 0.0f; ahead <= std::min(lookAhead, clearance); ahead += probeStep) {
                glm::vec3 probePosition, probeDirection;
                size_t probeWaypoint = 0;
                SampleCircuit(vehicle.route, vehicle.routeCumulative, routeLength, vehicle.distance + ahead,
                              probePosition, probeDirection, probeWaypoint);
                const glm::vec2 probeForward(probeDirection.x, probeDirection.z);
                bool blockedByVehicle = false;
                for (size_t otherIndex = 0; otherIndex < m_Traffic.size(); ++otherIndex) {
                    const auto& other = m_Traffic[otherIndex];
                    if (otherIndex == vehicleIndex || (other.routeIndex == vehicle.routeIndex)
                        || (otherIndex > vehicleIndex && other.speed > 0.1f)) continue;
                    const bool alreadyOverlapping = OrientedBoxesOverlap(
                        vehicle.position, forward, vehicle.length, vehicle.width,
                        other.position, {other.direction.x, other.direction.z},
                        other.length, other.width);
                    const bool outranks = hasPriority(vehicleIndex, otherIndex);
                    if (other.yieldingForTraffic && outranks) continue;
                    if (alreadyOverlapping && other.speed <= 0.1f && outranks) continue;
                    if (forceThrough && outranks) continue;
                    if (OrientedBoxesOverlap(probePosition, probeForward, vehicle.length, vehicle.width,
                                             other.position, {other.direction.x, other.direction.z},
                                             other.length, other.width)) {
                        // Ya estoy atravesado en su camino: despejo el cruce; el otro frena porque ve mi cuerpo
                        if (alreadyInPathOf(other)) continue;
                        clearance = std::min(clearance, std::max(0.0f, ahead - probeStep));
                        blockedByVehicle = true;
                        break;
                    }
                    // Cede con tiempo al que tiene prioridad y llegaria al mismo punto: se detiene antes de
                    // entrar al cruce en vez de quedar atravesado cuando el otro llegue.
                    if (!outranks && other.speed > 0.5f) {
                        glm::vec3 futurePosition;
                        glm::vec2 futureDirection;
                        futureBox(other, ahead / std::max(vehicle.speed, 2.0f), futurePosition, futureDirection);
                        if (OrientedBoxesOverlap(probePosition, probeForward, vehicle.length + 0.6f, vehicle.width + 0.4f,
                                                 futurePosition, futureDirection, other.length, other.width)
                            && !alreadyInPathOf(other)) {
                            clearance = std::min(clearance, std::max(0.0f, ahead - probeStep));
                            blockedByVehicle = true;
                            break;
                        }
                    }
                }
                if (blockedByVehicle) break;
                for (const auto& parked : m_ParkedCars) {
                    if (OrientedBoxesOverlap(probePosition, probeForward, vehicle.length, vehicle.width,
                                             parked.position, {parked.direction.x, parked.direction.z},
                                             parked.length, parked.width)) {
                        clearance = std::min(clearance, std::max(0.0f, ahead - probeStep));
                        blockedByVehicle = true;
                        break;
                    }
                }
                if (blockedByVehicle) break;
                if (!committedInBusLane
                    && std::any_of(m_Buses.begin(), m_Buses.end(), [&](const BusState& bus) {
                        return !bus.Elevated() && OrientedBoxesOverlap(probePosition, probeForward, vehicle.length, vehicle.width,
                                                                       bus.position, bus.heading, 18.2f, 2.52f);
                    })) {
                    clearance = std::min(clearance, std::max(0.0f, ahead - probeStep));
                    break;
                }
            }
            const auto personInCarAt = [&](const glm::vec3& actorPosition, const glm::vec3& probePosition, const glm::vec3& probeDirection) {
                const glm::vec2 delta(actorPosition.x - probePosition.x, actorPosition.z - probePosition.z);
                const glm::vec2 forward(probeDirection.x, probeDirection.z);
                const float along = glm::dot(delta, forward);
                const float sideways = glm::dot(delta, glm::vec2(-forward.y, forward.x));
                return std::abs(along) < vehicle.length * 0.5f + 0.8f
                    && std::abs(sideways) < vehicle.width * 0.5f + 0.55f;
            };
            for (float ahead = 0.0f; ahead <= std::min(lookAhead, clearance); ahead += probeStep) {
                glm::vec3 probePosition, probeDirection;
                size_t probeWaypoint = 0;
                SampleCircuit(vehicle.route, vehicle.routeCumulative, routeLength, vehicle.distance + ahead,
                              probePosition, probeDirection, probeWaypoint);
                bool stoppedForPedestrian = false;
                for (const auto& pedestrian : m_Pedestrians) {
                    const glm::vec2 offset(pedestrian.position.x - carPosition.x, pedestrian.position.z - carPosition.y);
                    if (glm::dot(offset, offset) > radius * radius) continue;
                    if (personInCarAt(pedestrian.position, probePosition, probeDirection)) {
                        clearance = std::max(0.0f, ahead - probeStep);
                        stoppedForPedestrian = true;
                        stoppedForPerson = true;
                        break;
                    }
                }
                if (stoppedForPedestrian) break;
            }
            vehicle.blockedForPerson = stoppedForPerson;
            const float desiredSpeed = std::min(vehicle.cruiseSpeed, std::sqrt(2.0f * braking * clearance));
            const float rate = desiredSpeed < vehicle.speed ? braking : acceleration;
            const float speed = std::clamp(desiredSpeed, vehicle.speed - rate * stepTime, vehicle.speed + rate * stepTime);
            const float travel = std::min(std::max(0.0f, speed * stepTime), clearance);
            vehicle.nextDistance = std::fmod(vehicle.distance + travel, routeLength);
            vehicle.nextSpeed = travel / stepTime;
        }
        for (auto& vehicle : m_Traffic) vehicle.yieldingForTraffic = false;
        for (size_t first = 0; first < m_Traffic.size(); ++first) {
            auto& a = m_Traffic[first];
            glm::vec3 predictedA, directionA;
            size_t waypointA = 0;
            SampleCircuit(a.route, a.routeCumulative, a.routeLength, a.nextDistance,
                          predictedA, directionA, waypointA);
            for (size_t second = first + 1; second < m_Traffic.size(); ++second) {
                auto& b = m_Traffic[second];
                glm::vec3 predictedB, directionB;
                size_t waypointB = 0;
                SampleCircuit(b.route, b.routeCumulative, b.routeLength, b.nextDistance,
                              predictedB, directionB, waypointB);
                if (!OrientedBoxesOverlap(predictedA, {directionA.x, directionA.z}, a.length, a.width,
                                          predictedB, {directionB.x, directionB.z}, b.length, b.width)) continue;
                const size_t aIndex = first;
                const size_t bIndex = second;
                if (hasPriority(aIndex, bIndex)) {
                    b.nextDistance = b.distance;
                    b.nextSpeed = 0.0f;
                    b.yieldingForTraffic = true;
                } else {
                    a.nextDistance = a.distance;
                    a.nextSpeed = 0.0f;
                    a.yieldingForTraffic = true;
                }
            }
        }
        for (auto& vehicle : m_Traffic) {
            vehicle.distance = vehicle.nextDistance;
            vehicle.speed = vehicle.nextSpeed;
            vehicle.forcingRemaining = std::max(0.0f, vehicle.forcingRemaining - stepTime);
            const bool legitimateStop = vehicle.waitingAtSignal || vehicle.blockedForPerson;
            vehicle.stalledTime = (vehicle.speed < 0.1f && !legitimateStop) ? vehicle.stalledTime + stepTime : 0.0f;
            vehicle.wheelRotation -= vehicle.speed * stepTime / 0.33f;
            SampleCircuit(vehicle.route, vehicle.routeCumulative, vehicle.routeLength, vehicle.distance,
                          vehicle.position, vehicle.direction, vehicle.nextWaypoint);
            vehicle.horizontalLane = std::abs(vehicle.direction.x) > std::abs(vehicle.direction.z);
            vehicle.laneCoordinate = vehicle.horizontalLane ? vehicle.position.z : vehicle.position.x;
            vehicle.yaw = std::atan2(-vehicle.direction.z, vehicle.direction.x);
        }
        // Ultimo recurso: dos carros que llevan segundos detenidos y atravesados (el paso forzado los dejo uno dentro
        // del otro y ninguno puede avanzar) se separan: el que lleva mas tiempo parado avanza por su ruta.
        constexpr float kOverlapStall = 6.0f;
        for (size_t first = 0; first < m_Traffic.size(); ++first) {
            for (size_t second = first + 1; second < m_Traffic.size(); ++second) {
                TrafficVehicle& a = m_Traffic[first];
                TrafficVehicle& b = m_Traffic[second];
                if (a.speed >= 0.1f || b.speed >= 0.1f || a.stalledTime < kOverlapStall || b.stalledTime < kOverlapStall) continue;
                if (glm::distance(a.position, b.position) >= 2.4f) continue;
                TrafficVehicle& mover = a.stalledTime >= b.stalledTime ? a : b;
                mover.distance = std::fmod(mover.distance + 0.5f, mover.routeLength);
                mover.nextDistance = mover.distance;
                SampleCircuit(mover.route, mover.routeCumulative, mover.routeLength, mover.distance,
                              mover.position, mover.direction, mover.nextWaypoint);
                mover.horizontalLane = std::abs(mover.direction.x) > std::abs(mover.direction.z);
                mover.laneCoordinate = mover.horizontalLane ? mover.position.z : mover.position.x;
                mover.yaw = std::atan2(-mover.direction.z, mover.direction.x);
            }
        }
        remaining -= stepTime;
    }
    for (size_t index = 0; index < m_CarCooldowns.size(); ++index) {
        m_CarCooldowns[index] = std::max(0.0f, m_CarCooldowns[index] - dt);
        if (m_CarCooldowns[index] <= 0.0f) m_Traffic[index].mirrorsAvailable = true;
    }
}

void Simulation::UpdateBus(float dt) {
    constexpr float acceleration = 1.1f;
    constexpr float braking = 4.0f;
    for (BusState& bus : m_Buses) {
        bus.previousPosition = bus.position;
        float remaining = std::min(std::max(dt, 0.0f), 0.5f);
        while (remaining > 1e-8f) {
            const float step = std::min(remaining, 0.05f);
            remaining -= step;
            if (bus.dwellRemaining > 0.0f) {
                bus.dwellRemaining = std::max(0.0f, bus.dwellRemaining - step);
                continue;
            }
            // distancia que le queda hasta el extremo (y hasta la estacion, si aun no la sirvio) en su sentido
            float clearance = bus.direction * (bus.endZ - bus.position.z);
            if (!bus.servedStation) clearance = std::min(clearance, bus.direction * (bus.stationZ - bus.position.z));
            const float lookAhead = std::max(5.0f, bus.speed * bus.speed / (2.0f * braking) + bus.speed * 0.2f + 2.0f);
            for (float ahead = 0.0f; ahead <= std::min(lookAhead, clearance); ahead += 0.5f) {
                const float probeZ = bus.position.z + bus.direction * ahead;
                const glm::vec3 probe(Viaduct::BusPathX(probeZ, bus.laneX), bus.position.y, probeZ);
                if (Viaduct::Height(probe.z) > Viaduct::kElevated && Viaduct::Height(bus.position.z) > Viaduct::kElevated) break;
                bool blockedByVehicle = false;
                const auto checkVehicle = [&](const TrafficVehicle& vehicle) {
                    return OrientedBoxesOverlap(probe, bus.heading, 18.2f, 2.52f,
                                                vehicle.position, {vehicle.direction.x, vehicle.direction.z},
                                                vehicle.length, vehicle.width);
                };
                for (const auto& vehicle : m_Traffic) {
                    if (!checkVehicle(vehicle)) continue;
                    blockedByVehicle = true;
                    break;
                }
                if (!blockedByVehicle) {
                    for (const auto& vehicle : m_ParkedCars) {
                        if (!checkVehicle(vehicle)) continue;
                        blockedByVehicle = true;
                        break;
                    }
                }
                if (blockedByVehicle) {
                    clearance = std::min(clearance, std::max(0.0f, ahead - 0.5f));
                    break;
                }
            }
            const bool busOverStreet = Viaduct::Height(bus.position.z) > Viaduct::kElevated
                && Viaduct::Height(bus.position.z + bus.direction * 9.1f) > Viaduct::kElevated;
            const auto actorClearance = [&](const glm::vec3& actor) {
                if (busOverStreet) return std::numeric_limits<float>::infinity();
                const glm::vec2 fromBus(actor.x - bus.position.x, actor.z - bus.position.z);
                const float sideways = fromBus.x * -bus.heading.y + fromBus.y * bus.heading.x;
                if (std::abs(sideways) > 2.52f * 0.5f + 0.55f) return std::numeric_limits<float>::infinity();
                const float aheadOfBus = glm::dot(fromBus, bus.heading);   // >0: delante del bus
                if (aheadOfBus < -(18.2f * 0.5f + 0.55f)) return std::numeric_limits<float>::infinity();
                return std::max(0.0f, aheadOfBus - 18.2f * 0.5f - 0.8f);
            };
            for (const auto& pedestrian : m_Pedestrians) clearance = std::min(clearance, actorClearance(pedestrian.position));
            const float desiredSpeed = std::min(5.0f, std::sqrt(2.0f * braking * std::max(0.0f, clearance)));
            const float rate = desiredSpeed < bus.speed ? braking : acceleration;
            bus.speed = std::clamp(desiredSpeed, bus.speed - rate * step, bus.speed + rate * step);
            const float travel = std::min(bus.speed * step, std::max(0.0f, clearance));
            bus.position.z += bus.direction * travel;
            bus.position.x = Viaduct::BusPathX(bus.position.z, bus.laneX);
            bus.position.y = Viaduct::Height(bus.position.z);
            bus.heading = Viaduct::BusHeading(bus.position.z, bus.laneX, bus.direction);
            bus.speed = travel / step;
            bus.wheelRotation += travel / 0.5f;
            if (!bus.servedStation && bus.direction * (bus.stationZ - bus.position.z) <= 1e-8f) {
                bus.position.z = bus.stationZ;
                bus.servedStation = true;
                bus.speed = 0.0f;
                bus.dwellRemaining = 4.0f;
            }
            if (bus.direction * (bus.endZ - bus.position.z) <= 1e-8f) {
                bus.position.z = bus.startZ;
                bus.position.x = Viaduct::BusPathX(bus.startZ, bus.laneX);
                bus.position.y = Viaduct::Height(bus.startZ);
                bus.heading = Viaduct::BusHeading(bus.startZ, bus.laneX, bus.direction);
                bus.servedStation = false;
                bus.speed = 0.0f;
            }
        }
    }
}

bool Simulation::IsBlocked(const glm::vec3& position, float radius) const {
    // Quien esta sobre el tablero (y > 1) solo choca con el bus elevado; en la calle, los carros y el bus a nivel
    const bool onDeck = position.y > 1.0f;
    const auto collidesWithVehicle = [&](const TrafficVehicle& vehicle) {
        return PointInVehicleBox(position, vehicle.position,
                                 {vehicle.direction.x, vehicle.direction.z},
                                 vehicle.length * 0.5f, vehicle.width * 0.5f, radius);
    };
    if (!onDeck) {
        for (const auto& vehicle : m_Traffic) {
            if (collidesWithVehicle(vehicle)) return true;
        }
        for (const auto& vehicle : m_ParkedCars) {
            if (collidesWithVehicle(vehicle)) return true;
        }
    }
    for (const BusState& bus : m_Buses) {
        if (std::abs(position.y - bus.position.y) < 2.5f
            && PointInVehicleBox(position, bus.position, bus.heading, 9.1f, 1.26f, radius)) {
            return true;
        }
    }
    return false;
}

bool Simulation::GetVehicleImpact(const glm::vec3& position, float& speed, glm::vec3& direction) const {
    const bool onDeck = position.y > 1.0f;
    for (const auto& vehicle : m_Traffic) {
        if (onDeck) break;   // los carros circulan por la calle inferior
        if (vehicle.speed < 1.5f) continue;
        const glm::vec2 forward = glm::normalize(glm::vec2(vehicle.direction.x, vehicle.direction.z));
        bool frontContact = PointAtVehicleFront(position, vehicle.position, forward,
                                                vehicle.length * 0.5f, vehicle.width * 0.5f, 0.4f);
        for (int sample = 0; !frontContact && sample <= 8; ++sample) {
            const float fraction = static_cast<float>(sample) / 8.0f;
            const glm::vec3 sweptPosition = glm::mix(vehicle.previousPosition, vehicle.position, fraction);
            frontContact = PointAtVehicleFront(position, sweptPosition, forward,
                                               vehicle.length * 0.5f, vehicle.width * 0.5f, 0.4f);
        }
        if (frontContact) {
            speed = vehicle.speed;
            direction = glm::vec3(forward.x, 0.0f, forward.y);
            return true;
        }
    }
    for (const BusState& bus : m_Buses) {
        if (bus.speed < 1.5f || std::abs(position.y - bus.position.y) >= 2.5f) continue;
        bool frontContact = PointAtVehicleFront(position, bus.position, bus.heading,
                                                9.1f, 1.26f, 0.4f);
        for (int sample = 0; !frontContact && sample <= 8; ++sample) {
            const float fraction = static_cast<float>(sample) / 8.0f;
            const glm::vec3 sweptPosition = glm::mix(bus.previousPosition, bus.position, fraction);
            frontContact = PointAtVehicleFront(position, sweptPosition, bus.heading,
                                               9.1f, 1.26f, 0.4f);
        }
        if (frontContact) {
            speed = bus.speed;
            direction = {bus.heading.x, 0.0f, bus.heading.y};
            return true;
        }
    }
    return false;
}

void Simulation::Render(Renderer& renderer, float time, const glm::vec3& focusPosition) const {
    const float distToCambuche = glm::distance(glm::vec2(focusPosition.x, focusPosition.z),
                                               glm::vec2(m_CambuchePosition.x, m_CambuchePosition.z));
    if (distToCambuche < 80.0f) {
        glm::mat4 cambucheRoot = glm::translate(glm::mat4(1.0f), m_CambuchePosition);
        cambucheRoot = glm::rotate(cambucheRoot, glm::pi<float>() * 0.08f, {0.0f, 1.0f, 0.0f});

        // Si tiene techo y base, se renderiza el refugio completo importado
        if (m_CambucheState.base && m_CambucheState.techo && m_ShelterModel) {
            m_ShelterModel->Draw(renderer, cambucheRoot * m_ShelterModelFit);
        } else if (m_CambucheState.base) {
            // Solo base: se dibuja la tarima de cartones/madera
            if (m_CambucheBaseMesh) {
                glm::mat4 baseMat = glm::translate(cambucheRoot, {0.0f, 0.04f, 0.0f});
                renderer.Submit(*m_CambucheBaseMesh, baseMat);
            }
            if (m_CambucheState.cama && m_CambucheBedMesh) {
                glm::mat4 bedMat = glm::translate(cambucheRoot, {-0.4f, 0.14f, 0.0f});
                renderer.Submit(*m_CambucheBedMesh, bedMat);
            }
        } else {
            // Sin armar: cartones esparcidos que marcan el sitio
            if (m_CambucheMarkerMesh) {
                for (int i = 0; i < 4; ++i) {
                    float ox = (i % 2 == 0 ? -0.4f : 0.4f) + 0.1f * i;
                    float oz = (i < 2 ? -0.3f : 0.3f);
                    glm::mat4 markerMat = glm::translate(cambucheRoot, {ox, 0.02f + i * 0.005f, oz});
                    markerMat = glm::rotate(markerMat, 0.3f * i, {0.0f, 1.0f, 0.0f});
                    renderer.Submit(*m_CambucheMarkerMesh, markerMat, glm::vec4(0.55f, 0.42f, 0.28f, 0.85f));
                }
            }
        }

        // Fogón de latas con fuego encendido
        if (m_CambucheState.fogon && m_CambucheFireMesh) {
            glm::mat4 fogonMat = glm::translate(cambucheRoot, {1.0f, 0.12f, 1.2f});
            renderer.Submit(*m_CambucheFireMesh, fogonMat, glm::vec4(1.0f, 0.48f, 0.10f, 1.0f));
        }

        // Vela encendida
        if (m_CambucheState.vela && m_CambucheFireMesh) {
            glm::mat4 velaMat = glm::translate(cambucheRoot, {0.6f, 0.08f, -0.9f});
            velaMat = glm::scale(velaMat, {0.25f, 0.5f, 0.25f});
            renderer.Submit(*m_CambucheFireMesh, velaMat, glm::vec4(1.0f, 0.85f, 0.40f, 1.0f));
        }
    }
    for (const auto& lamp : m_StreetLamps) {
        glm::mat4 lampRoot = glm::translate(glm::mat4(1.0f), lamp.position);
        lampRoot = glm::rotate(lampRoot, lamp.yaw, {0.0f, 1.0f, 0.0f});
        if (m_StreetLampModel) {
            m_StreetLampModel->Draw(renderer, lampRoot * m_StreetLampModelFit);
        } else {
            renderer.Submit(*m_StreetLampPole, glm::translate(lampRoot, {0.0f, 1.6f, 0.0f}));
            renderer.Submit(*m_StreetLampHead, glm::translate(lampRoot, {0.18f, 3.18f, 0.0f}), glm::vec4(1.0f, 0.89f, 0.65f, 1.0f));
        }
    }
    // Farolas encendidas: la bombilla y su halo se dibujan en todas las que estan a la vista, aunque su luz sobre el
    // suelo solo llegue a las mas cercanas
    if (m_LampGlow > 0.05f) {
        const float glowRange = 190.0f;
        renderer.SetUnlit(true);
        for (const auto& lamp : m_StreetLamps) {
            const float distance = glm::distance(glm::vec2(lamp.position.x, lamp.position.z), glm::vec2(focusPosition.x, focusPosition.z));
            if (distance > glowRange) continue;
            const glm::mat4 bulb = glm::translate(glm::mat4(1.0f), LampBulbPosition(lamp));
            renderer.Submit(*m_LampBulb, bulb, glm::vec4(1.0f, 0.9f, 0.62f, 1.0f));
            // el halo es pequeno de cerca (para que no se vea como un bloque) y crece con la distancia
            const float haloScale = 0.3f + 0.9f * AtmosphereSmoothstep(6.0f, 70.0f, distance);
            renderer.Submit(*m_LampHalo, glm::scale(bulb, glm::vec3(haloScale)), glm::vec4(1.0f, 0.78f, 0.45f, 0.16f * m_LampGlow), false, false, nullptr, 2);
        }
        renderer.SetUnlit(false);
    }
    for (size_t index = 0; index < m_GrassPositions.size(); ++index) {
        const auto& position = m_GrassPositions[index];
        if (glm::distance(glm::vec2(focusPosition.x, focusPosition.z),
                          glm::vec2(position.x, position.z)) > 32.0f) continue;
        const float yaw = static_cast<float>((index * 37) % 360) * glm::pi<float>() / 180.0f;
        const glm::mat4 grass = glm::translate(glm::mat4(1.0f), position)
            * glm::rotate(glm::mat4(1.0f), yaw, {0.0f, 1.0f, 0.0f});
        if (m_GrassModel)
            m_GrassModel->Draw(renderer, grass * m_GrassModelFit,
                               glm::vec4(0.35f, 0.58f, 0.25f, 1.0f));
    }
    for (const auto& position : m_TreePositions) {
        if (glm::distance(glm::vec2(focusPosition.x, focusPosition.z),
                          glm::vec2(position.x, position.z)) > 60.0f) continue;
        if (m_TreeModel) {
            m_TreeModel->Draw(renderer, glm::translate(glm::mat4(1.0f), position) * m_TreeModelFit);
            continue;
        }
        renderer.Submit(*m_TreeTrunk, glm::translate(glm::mat4(1.0f), position + glm::vec3(0.0f, 0.8f, 0.0f)));
        renderer.Submit(*m_TreeCanopy, glm::translate(glm::mat4(1.0f), position + glm::vec3(0.0f, 2.0f, 0.0f)));
    }
    for (const auto& signal : m_TrafficSignals) {
        if (glm::distance(glm::vec2(focusPosition.x, focusPosition.z),
                          glm::vec2(signal.polePosition.x, signal.polePosition.z)) > 80.0f) continue;
        const glm::mat4 poleRoot = glm::translate(glm::mat4(1.0f), signal.polePosition)
            * glm::rotate(glm::mat4(1.0f), signal.yaw, {0.0f, 1.0f, 0.0f});
        if (m_TrafficSignalModel) {
            m_TrafficSignalModel->Draw(renderer, poleRoot * m_TrafficSignalModelFit);
        } else {
            glm::mat4 post = glm::translate(poleRoot, {0.0f, 1.6f, 0.0f});
            renderer.Submit(*m_SignalPole, post);
            renderer.Submit(*m_SignalHead, glm::translate(poleRoot, {0.0f, 2.9f, 0.0f}));
        }
        const size_t state = GetSignalState(m_Elapsed, signal.phaseGroup);
        const glm::vec4 redColor = state == 2 ? glm::vec4(1.0f, 0.06f, 0.035f, 1.0f) : glm::vec4(0.28f, 0.035f, 0.025f, 1.0f);
        const glm::vec4 amberColor = state == 1 ? glm::vec4(1.0f, 0.55f, 0.04f, 1.0f) : glm::vec4(0.27f, 0.12f, 0.02f, 1.0f);
        const glm::vec4 greenColor = state == 0 ? glm::vec4(0.08f, 1.0f, 0.20f, 1.0f) : glm::vec4(0.025f, 0.25f, 0.055f, 1.0f);
        const auto drawLens = [&](float y, const glm::vec4& color) {
            glm::mat4 lens = glm::translate(poleRoot, {-0.22f, y, 0.0f});
            lens = glm::rotate(lens, glm::half_pi<float>(), {0.0f, 0.0f, 1.0f});
            renderer.Submit(*m_SignalLamp, lens, color);
        };
        if (m_TrafficSignalModel) {
            drawLens(3.85f, redColor);
            drawLens(3.52f, amberColor);
            drawLens(3.19f, greenColor);
        } else {
            drawLens(3.08f, redColor);
            drawLens(2.90f, amberColor);
            drawLens(2.72f, greenColor);
        }
    }
    for (const Bird& pigeon : m_Birds.Birds()) {
        if (glm::distance(glm::vec2(focusPosition.x, focusPosition.z),
                          glm::vec2(pigeon.position.x, pigeon.position.z)) > 70.0f) continue;
        const bool flying = pigeon.IsFlying();
        glm::mat4 bird = glm::translate(glm::mat4(1.0f), pigeon.position);
        bird = glm::rotate(bird, pigeon.yaw, {0.0f, 1.0f, 0.0f});
        if (flying) {
            bird = glm::rotate(bird, pigeon.pitch, {1.0f, 0.0f, 0.0f});
            bird = glm::rotate(bird, std::sin(time * pigeon.flapRate * 0.5f + pigeon.phase) * 0.12f, {0.0f, 0.0f, 1.0f});
        }
        if (flying && m_BirdModels[pigeon.modelIndex]) {
            const glm::mat4 fit = bird * m_BirdModelFits[pigeon.modelIndex];
            const auto& parts = m_BirdParts[pigeon.modelIndex];
            if (!parts[0]) {
                m_BirdModels[pigeon.modelIndex]->Draw(renderer, fit);
                continue;
            }
            // Pivotes en el espacio del modelo (glTF, Y arriba, el frente hacia -Z; las alas se abren sobre X): hombro en el
            // borde del cuerpo y muneca a media envergadura. Medidos en Blender al separar las piezas.
            struct WingRig { float shoulderX, shoulderY, elbowX, elbowY; };
            static const WingRig rigs[2] = {{0.045f, 0.0631f, 0.105f, 0.0660f}, {0.10f, 0.1807f, 0.38f, 0.1782f}};
            const WingRig& rig = rigs[pigeon.modelIndex];
            // Ciclo real de aleteo: la bajada es la fase de potencia y la subida recoge el ala doblando la muneca; la punta va
            // retrasada respecto al hombro. Despegando y aterrizando bate con toda la amplitud; en crucero alterna rafagas de
            // aleteo con planeo (alas extendidas con un leve diedro).
            const float progress = pigeon.flightDuration > 0.001f ? 1.0f - pigeon.flightRemaining / pigeon.flightDuration : 0.0f;
            const float cycle = time * pigeon.flapRate * 0.85f + pigeon.phase;
            const float glideWave = std::sin(progress * 6.2831853f * (1.5f + std::fmod(pigeon.phase, 1.0f)) + pigeon.phase * 3.0f);
            const bool cruising = pigeon.flightDuration > 2.2f && progress > 0.22f && progress < 0.78f;
            const float glide = cruising ? glm::smoothstep(0.35f, 0.75f, glideWave) : 0.0f;
            const float amplitude = glm::mix(1.0f, 0.12f, glide);
            const float phaseSin = std::sin(cycle), phaseCos = std::cos(cycle);
            const float shoulder = 0.62f * amplitude * phaseSin + 0.10f + 0.12f * glide;
            const float wrist = (phaseCos > 0.0f ? -0.85f : -0.30f) * phaseCos * amplitude + 0.05f - 0.04f * glide;
            const float bob = 0.012f * amplitude * (-phaseSin);   // el cuerpo sube con la bajada de las alas
            const glm::mat4 body = fit * glm::translate(glm::mat4(1.0f), {0.0f, bob, 0.0f});
            parts[0]->Draw(renderer, body);
            for (int sideIndex = 0; sideIndex < 2; ++sideIndex) {
                const float side = sideIndex == 0 ? -1.0f : 1.0f;   // izquierda -X, derecha +X
                const glm::vec3 shoulderPivot(side * rig.shoulderX, rig.shoulderY, 0.0f);
                const glm::vec3 elbowPivot(side * rig.elbowX, rig.elbowY, 0.0f);
                glm::mat4 inner = body * glm::translate(glm::mat4(1.0f), shoulderPivot)
                    * glm::rotate(glm::mat4(1.0f), side * shoulder, {0.0f, 0.0f, 1.0f})
                    * glm::translate(glm::mat4(1.0f), -shoulderPivot);
                glm::mat4 outer = inner * glm::translate(glm::mat4(1.0f), elbowPivot)
                    * glm::rotate(glm::mat4(1.0f), side * wrist, {0.0f, 0.0f, 1.0f})
                    * glm::translate(glm::mat4(1.0f), -elbowPivot);
                parts[1 + sideIndex * 2]->Draw(renderer, inner);
                parts[2 + sideIndex * 2]->Draw(renderer, outer);
            }
            continue;
        }
        if (!flying && pigeon.perch == BirdPerch::Ground) {
            // picotea el suelo
            const float peck = std::pow(std::max(0.0f, std::sin(pigeon.phase * 2.3f)), 6.0f) * 0.55f;
            bird = glm::rotate(bird, peck, {1.0f, 0.0f, 0.0f});
        }
        renderer.Submit(*m_PigeonBody, glm::translate(bird, {0.0f, 0.18f, 0.0f}));
        const float wingLift = flying ? std::sin(time * pigeon.flapRate + pigeon.phase) * 0.35f : 0.0f;
        for (float side : {-1.0f, 1.0f}) {
            glm::mat4 wing = glm::translate(bird, {side * 0.14f, 0.24f, 0.0f});
            wing = glm::rotate(wing, side * wingLift, {0.0f, 0.0f, 1.0f});
            renderer.Submit(*m_PigeonWing, wing);
        }
    }
    if (m_RatModel) {
        for (const Rat& rat : m_Rats) {
            if (glm::distance(glm::vec2(focusPosition.x, focusPosition.z),
                              glm::vec2(rat.position.x, rat.position.z)) > 38.0f) continue;
            // Wiggle lateral al corretear y cabeceo al olfatear
            const float wiggle = (rat.speed > 0.4f)
                ? std::sin(rat.animTime * 22.0f) * 0.12f
                : rat.sniffOffset;
            const float bob = (rat.speed > 0.4f)
                ? std::abs(std::sin(rat.animTime * 22.0f)) * 0.015f
                : std::abs(std::sin(rat.animTime * 7.0f)) * 0.005f;

            const glm::mat4 ratTransform = glm::translate(glm::mat4(1.0f), rat.position + glm::vec3(0.0f, bob, 0.0f))
                * glm::rotate(glm::mat4(1.0f), rat.yaw + wiggle, {0.0f, 1.0f, 0.0f})
                * m_RatModelFit;
            m_RatModel->Draw(renderer, ratTransform);
        }
    }
    if (IsRaining()) {
        const size_t visibleDrops = static_cast<size_t>(std::ceil(static_cast<float>(m_ReducedWeather ? kRainDropCount / 3 : m_RainOffsets.size()) * m_RainIntensity));
        for (size_t index = 0; index < visibleDrops; ++index) {
            const glm::vec3 position = focusPosition + m_RainOffsets[index];
            const glm::mat4 drop = glm::translate(glm::mat4(1.0f), position);
            renderer.Submit(*m_RainDrop, drop, glm::vec4(0.75f, 0.88f, 1.0f, 0.44f), false, false, nullptr, 2);
        }
    }
    glm::mat4 missionNpc = glm::translate(glm::mat4(1.0f), m_MissionNpcPosition);
    missionNpc = glm::scale(missionNpc, glm::vec3(1.08f));
    if (!m_PedestrianAppearances.empty()) {
        const auto& appearance = m_PedestrianAppearances.front();
        for (const auto& model : appearance.parts)
            if (model) model->Draw(renderer, missionNpc, glm::vec4(1.0f), time, appearance.idleClip >= 0, appearance.idleClip);
    }
    if (!m_MissionStarted && !m_MissionComplete) {
        glm::mat4 marker = glm::translate(glm::mat4(1.0f), m_MissionNpcPosition + glm::vec3(0.0f, 2.0f + std::sin(time * 2.0f) * 0.12f, 0.0f));
        renderer.Submit(*m_MissionMarker, marker);
    }
    if (glm::distance(glm::vec2(focusPosition.x, focusPosition.z),
                      glm::vec2(m_RecyclerPosition.x, m_RecyclerPosition.z)) < 65.0f) {
        const glm::mat4 recycler = glm::translate(glm::mat4(1.0f), m_RecyclerPosition);
        renderer.Submit(*m_RecyclerBody, glm::translate(recycler, {0.0f, 0.6f, 0.0f}));
        renderer.Submit(*m_RecyclerRoof, glm::translate(recycler, {0.0f, 1.55f, 0.0f}));
        renderer.Submit(*m_RecyclerSign, glm::translate(recycler, {0.0f, 2.02f, 0.52f}));
        renderer.Submit(*m_RecyclerScale, glm::translate(recycler, {1.15f, 0.08f, 0.45f}));
        for (int sack = 0; sack < 3; ++sack) {
            const float x = -1.0f + static_cast<float>(sack) * 0.32f;
            renderer.Submit(*m_RecyclerSack, glm::translate(recycler, {x, 0.4f, 0.76f - static_cast<float>(sack % 2) * 0.45f}),
                            sack == 1 ? glm::vec4(0.18f, 0.36f, 0.65f, 1.0f)
                                      : glm::vec4(0.74f, 0.71f, 0.61f, 1.0f));
        }
    }
    if (glm::distance(glm::vec2(focusPosition.x, focusPosition.z),
                      glm::vec2(m_DealerPosition.x, m_DealerPosition.z)) < 65.0f) {
        glm::mat4 dealer = glm::translate(glm::mat4(1.0f), m_DealerPosition);
        renderer.Submit(*m_VendorCounter, glm::translate(dealer, {0.0f, 0.68f, 0.0f}));
        renderer.Submit(*m_VendorGoods, glm::translate(dealer, {-0.22f, 1.10f, 0.0f}),
                        {0.60f, 0.20f, 0.78f, 1.0f});
        renderer.Submit(*m_VendorGoods, glm::translate(dealer, {0.18f, 1.10f, 0.0f}),
                        {0.92f, 0.92f, 0.86f, 1.0f});
        renderer.Submit(*m_DealerLantern, glm::translate(dealer, {0.68f, 1.35f, 0.0f}));
        if (!m_PedestrianAppearances.empty()) {
            const auto& appearance = m_PedestrianAppearances.back();
            glm::mat4 character = glm::translate(dealer, {0.0f, 0.0f, -1.05f});
            character = glm::rotate(character, glm::pi<float>(), {0.0f, 1.0f, 0.0f});
            character = glm::scale(character, glm::vec3(1.0f));
            for (const auto& part : appearance.parts) {
                if (part) part->Draw(renderer, character, glm::vec4(0.82f, 0.72f, 0.88f, 1.0f),
                                     time, appearance.idleClip >= 0, appearance.idleClip);
            }
        }
    }
    if (glm::distance(glm::vec2(focusPosition.x, focusPosition.z),
                      glm::vec2(m_DogPosition.x, m_DogPosition.z)) < 70.0f) {
        const std::array<glm::vec4, 4> coats{{
            {0.59f, 0.32f, 0.15f, 1.0f}, {0.36f, 0.20f, 0.12f, 1.0f},
            {0.43f, 0.45f, 0.46f, 1.0f}, {0.13f, 0.12f, 0.12f, 1.0f}
        }};
        const glm::vec4 coat = coats[static_cast<size_t>(std::clamp(m_DogCoat, 0, 3))];
        glm::mat4 dog = glm::translate(glm::mat4(1.0f), m_DogPosition);
        dog = glm::rotate(dog, m_DogYaw, {0.0f, 1.0f, 0.0f});
        dog = glm::scale(dog, glm::vec3(m_DogSize));
        if (m_PetModel) {
            m_PetModel->Draw(renderer, dog * m_PetModelFit, coat);
            const float bounce = m_DogIsFriend ? std::abs(std::sin(m_DogTime * 8.0f)) * 0.012f : 0.0f;
            if (m_DogAccessory == 1) renderer.Submit(*m_DogScarf, glm::translate(dog, {0.0f, 0.37f + bounce, 0.20f}));
            else if (m_DogAccessory == 3) renderer.Submit(*m_DogBand, glm::translate(dog, {0.0f, 0.35f + bounce, 0.21f}));
            else if (m_DogAccessory == 2) {
                renderer.Submit(*m_DogCap, glm::translate(dog, {0.0f, 0.57f + bounce, 0.34f}));
                renderer.Submit(*m_DogVisor, glm::translate(dog, {0.0f, 0.545f + bounce, 0.48f}));
            }
        } else {
        const float bounce = m_DogIsFriend ? std::abs(std::sin(m_DogTime * 8.0f)) * 0.025f : 0.0f;
        renderer.Submit(*m_DogBody, glm::translate(dog, {0.0f, 0.39f + bounce, 0.0f}), coat);
        renderer.Submit(*m_DogHead, glm::translate(dog, {0.0f, 0.55f + bounce, 0.48f}), coat);
        renderer.Submit(*m_DogSnout, glm::translate(dog, {0.0f, 0.46f + bounce, 0.78f}));
        renderer.Submit(*m_DogCollar, glm::translate(dog, {0.0f, 0.44f + bounce, 0.26f}));
        for (float x : {-0.26f, 0.26f}) {
            for (float z : {-0.34f, 0.34f}) {
                glm::mat4 leg = glm::translate(dog, {x, 0.17f + bounce, z});
                renderer.Submit(*m_DogLeg, leg, coat);
            }
            glm::mat4 ear = glm::translate(dog, {x * 0.72f, 0.77f + bounce, 0.43f});
            renderer.Submit(*m_DogEar, ear, coat * glm::vec4(0.52f, 0.52f, 0.52f, 1.0f));
        }
        glm::mat4 tail = glm::translate(dog, {0.0f, 0.57f + bounce, -0.55f});
        tail = glm::rotate(tail, std::sin(m_DogTime * (m_DogIsFriend ? 14.0f : 6.0f)) * 0.35f, {0.0f, 0.0f, 1.0f});
        tail = glm::rotate(tail, glm::half_pi<float>(), {1.0f, 0.0f, 0.0f});
        renderer.Submit(*m_DogTail, tail, coat);
        }
    }
    for (const auto& mark : m_GroundPoops) {
        if (glm::distance(glm::vec2(focusPosition.x, focusPosition.z),
                          glm::vec2(mark.position.x, mark.position.z)) > 45.0f) continue;
        renderer.Submit(*m_GroundPoopMesh,
                        glm::translate(glm::mat4(1.0f), mark.position));
    }
    for (const auto& projectile : m_PoopProjectiles) {
        if (glm::distance(glm::vec2(focusPosition.x, focusPosition.z),
                          glm::vec2(projectile.position.x, projectile.position.z)) > 45.0f) continue;
        glm::mat4 model = glm::translate(glm::mat4(1.0f), projectile.position);
        model = glm::rotate(model, time * 7.5f, {1.0f, 0.0f, 0.0f});
        model = glm::rotate(model, time * 5.0f, {0.0f, 0.0f, 1.0f});
        renderer.Submit(*m_PoopMesh, model);
    }
    for (const auto& pickup : m_Pickups) {
        if (!pickup.available && !pickup.container) continue;
        const float bob = pickup.container ? 0.0f : 0.025f + std::sin(time * 2.0f + pickup.position.x) * 0.015f;
        glm::mat4 model = glm::translate(glm::mat4(1.0f), pickup.position + glm::vec3(0.0f, bob, 0.0f));
        const float yaw = std::sin(pickup.position.x * 13.7f + pickup.position.z * 7.3f) * glm::pi<float>();
        model = glm::rotate(model, yaw, {0.0f, 1.0f, 0.0f});
        const std::shared_ptr<Model>& imported = pickup.container ? m_TrashContainerModel : m_TrashBagModel;
        const glm::mat4& fit = pickup.container ? m_TrashContainerModelFit : m_TrashBagModelFit;
        if (imported) imported->Draw(renderer, model * fit);
        else renderer.Submit(*m_PickupMeshes[pickup.itemIndex % m_PickupMeshes.size()], model);
    }
    const auto drawCar = [&](const TrafficVehicle& vehicle) {
        glm::mat4 model = glm::translate(glm::mat4(1.0f), vehicle.position);
        model = glm::rotate(model, vehicle.yaw, {0.0f, 1.0f, 0.0f});
        const std::shared_ptr<Model>& imported = vehicle.taxi ? m_TaxiModel : m_CarModel;
        const glm::mat4& fit = vehicle.taxi ? m_TaxiModelFit : m_CarModelFit;
        if (imported) {
            imported->Draw(renderer, model * fit);
        } else {
            glm::mat4 body = glm::translate(model, {0.0f, 0.62f, 0.0f});
            renderer.Submit(*m_CarBody, body, glm::vec4(vehicle.color, 1.0f));
            glm::mat4 cabin = glm::translate(model, {-0.25f, 1.25f, 0.0f});
            renderer.Submit(*m_CarCabin, cabin);
            glm::mat4 windshield = glm::translate(model, {0.80f, 1.25f, 0.0f});
            renderer.Submit(*m_CarGlass, windshield);
            glm::mat4 roof = glm::translate(model, {-0.3f, 1.58f, 0.0f});
            renderer.Submit(*m_CarRoof, roof, glm::vec4(vehicle.color, 1.0f));
            if (vehicle.taxi) {
                glm::mat4 taxiSign = glm::translate(model, {-0.3f, 1.72f, 0.0f});
                renderer.Submit(*m_CarTaxiSign, taxiSign);
            }
            for (float x : {-1.35f, 1.35f}) for (float z : {-0.76f, 0.76f}) {
                glm::mat4 wheel = glm::translate(model, {x, 0.33f, z});
                wheel = glm::rotate(wheel, vehicle.wheelRotation, {0.0f, 0.0f, 1.0f});
                renderer.Submit(*m_CarWheel, wheel);
                renderer.Submit(*m_CarRim, wheel);
            }
            for (float z : {-0.58f, 0.58f}) {
                glm::mat4 lamp = glm::translate(model, {2.12f, 0.66f, z});
                renderer.Submit(*m_CarLamp, lamp);
            }
        }
        if (vehicle.mirrorsAvailable) {
            for (float side : {-1.0f, 1.0f}) {
                renderer.Submit(*m_CarMirrorMesh, glm::translate(model, {0.82f, 1.02f, side * 0.98f}));
                glm::mat4 glass = glm::translate(model, {0.75f, 1.02f, side * 0.98f});
                renderer.Submit(*m_CarMirrorGlass, glass);
            }
        }
    };
    for (const auto& vehicle : m_Traffic) drawCar(vehicle);
    for (const auto& vehicle : m_ParkedCars) drawCar(vehicle);
    for (const BusState& bus : m_Buses) {
    const float busOpacity = std::clamp(std::min(bus.direction * (bus.position.z - bus.startZ) / 6.0f,
                                                  bus.direction * (bus.endZ - bus.position.z) / 6.0f), 0.0f, 1.0f);
    if (busOpacity > 0.0f) {
        const int alphaMode = busOpacity < 1.0f ? 2 : 0;
        const glm::vec4 busRed(0.70f, 0.15f, 0.12f, busOpacity);
        const glm::vec4 busWindow(0.08f, 0.12f, 0.16f, busOpacity);
        glm::mat4 busRoot = glm::translate(glm::mat4(1.0f), bus.position);
        busRoot = glm::rotate(busRoot, std::atan2(-bus.heading.x, -bus.heading.y), glm::vec3(0.0f, 1.0f, 0.0f));
        // el frente (-Z local) sube cuando la cota crece en el sentido de la marcha
        busRoot = glm::rotate(busRoot, std::atan(bus.direction * Viaduct::Slope(bus.position.z)), glm::vec3(1.0f, 0.0f, 0.0f));
        if (m_BusModel) {
            m_BusModel->Draw(renderer, busRoot * m_BusModelFit,
                             glm::vec4(1.0f, 1.0f, 1.0f, busOpacity), 0.0f, false, 0,
                             busOpacity < 1.0f ? 2 : 0);
        } else {
        for (float segmentZ : {-4.6f, 4.6f}) {
            renderer.Submit(*m_BusBody, glm::translate(busRoot, {0.0f, 1.75f, segmentZ}), busRed, false, false, nullptr, alphaMode);
            for (float side : {-1.0f, 1.0f}) {
                renderer.Submit(*m_BusWindows, glm::translate(busRoot, {side * 1.26f, 2.3f, segmentZ}), busWindow, false, false, nullptr, alphaMode);
            }
            for (float wheelZ : {segmentZ - 3.0f, segmentZ + 3.0f}) {
                for (float side : {-1.15f, 1.15f}) {
                    glm::mat4 wheel = glm::translate(busRoot, {side, 0.5f, wheelZ});
                    wheel = glm::rotate(wheel, glm::half_pi<float>(), {0.0f, 1.0f, 0.0f});
                    wheel = glm::rotate(wheel, bus.wheelRotation, {0.0f, 0.0f, 1.0f});
                    renderer.Submit(*m_BusWheel, wheel, glm::vec4(1.0f, 1.0f, 1.0f, busOpacity), false, false, nullptr, alphaMode);
                    renderer.Submit(*m_BusRim, wheel, glm::vec4(1.0f, 1.0f, 1.0f, busOpacity), false, false, nullptr, alphaMode);
                }
            }
        }
        renderer.Submit(*m_BusJoint, glm::translate(busRoot, {0.0f, 1.8f, 0.0f}), glm::vec4(1.0f, 1.0f, 1.0f, busOpacity), false, false, nullptr, alphaMode);
        glm::mat4 windshield = glm::translate(busRoot, {0.0f, 2.0f, -9.1f});
        renderer.Submit(*m_BusWindshield, windshield, busWindow, false, false, nullptr, alphaMode);
        }
    }
    }
    for (size_t index = 0; index < m_StreetVendors.size(); ++index) {
        const StreetVendor& vendor = m_StreetVendors[index];
        const glm::vec2 offset(vendor.position.x - focusPosition.x, vendor.position.z - focusPosition.z);
        if (glm::dot(offset, offset) > 65.0f * 65.0f) continue;
        const float yaw = std::atan2(vendor.facing.x, vendor.facing.z);
        glm::mat4 stall = glm::translate(glm::mat4(1.0f), vendor.position)
            * glm::rotate(glm::mat4(1.0f), yaw, {0.0f, 1.0f, 0.0f});
        if (m_VendorCartModel) {
            m_VendorCartModel->Draw(renderer, stall * m_VendorCartModelFit);
        } else {
            renderer.Submit(*m_VendorCounter, glm::translate(stall, {0.0f, 0.68f, 0.0f}));
            for (float x : {-0.48f, 0.48f}) for (float z : {-0.25f, 0.25f})
                renderer.Submit(*m_VendorLeg, glm::translate(stall, {x, 0.36f, z}));
            renderer.Submit(*m_VendorPole, glm::translate(stall, {-0.48f, 1.2f, -0.28f}));
            renderer.Submit(*m_VendorPole, glm::translate(stall, {0.48f, 1.2f, -0.28f}));
            const glm::vec4 canopyColor = vendor.fritanga
                ? glm::vec4(0.16f, 0.44f, 0.22f, 1.0f)
                : glm::vec4(0.76f, 0.13f, 0.12f, 1.0f);
            renderer.Submit(*m_VendorCanopy, glm::translate(stall, {-0.48f, 2.25f, -0.28f}), canopyColor);
            for (float x : {-0.95f, -0.48f, 0.0f}) {
                const glm::vec4 stripeColor = vendor.fritanga
                    ? glm::vec4(0.90f, 0.89f, 0.77f, 1.0f)
                    : glm::vec4(0.95f, 0.76f, 0.18f, 1.0f);
                renderer.Submit(*m_VendorCanopyStripe,
                                glm::translate(stall, {x, 2.26f, -0.28f}), stripeColor);
            }
        }
        if (m_VendorChairModel) {
            const glm::mat4 chair = glm::translate(glm::mat4(1.0f), vendor.serverPosition)
                * glm::rotate(glm::mat4(1.0f), yaw, {0.0f, 1.0f, 0.0f})
                * m_VendorChairModelFit;
            m_VendorChairModel->Draw(renderer, chair);
        }
        if (vendor.fritanga && !m_VendorCartModel) {
            const glm::mat4 grill = glm::translate(stall, {0.78f, 0.48f, 0.0f});
            renderer.Submit(*m_VendorGrill, grill);
            renderer.Submit(*m_VendorCoal, glm::translate(stall, {0.78f, 0.81f, 0.0f}));
            for (int food = 0; food < 5; ++food) {
                const float x = -0.42f + static_cast<float>(food) * 0.20f;
                renderer.Submit(*m_VendorFood, glm::translate(stall, {x, 1.09f, 0.0f}),
                                food % 2 == 0 ? glm::vec4(0.65f, 0.30f, 0.09f, 1.0f)
                                              : glm::vec4(0.87f, 0.62f, 0.20f, 1.0f));
            }
        } else if (!m_VendorCartModel) {
            for (int item = 0; item < 10; ++item) {
                const float x = -0.48f + static_cast<float>(item % 5) * 0.23f;
                const float z = item < 5 ? -0.20f : 0.16f;
                const std::array<glm::vec4, 5> colors{{
                    {0.84f, 0.15f, 0.12f, 1.0f}, {0.97f, 0.75f, 0.12f, 1.0f},
                    {0.18f, 0.56f, 0.28f, 1.0f}, {0.14f, 0.38f, 0.74f, 1.0f},
                    {0.91f, 0.88f, 0.79f, 1.0f}
                }};
                renderer.Submit(*m_VendorGoods, glm::translate(stall, {x, 1.10f, z}),
                                colors[static_cast<size_t>(item) % colors.size()]);
            }
        }
        glm::mat4 server = glm::translate(glm::mat4(1.0f), vendor.serverPosition);
        server = glm::rotate(server, yaw, {0.0f, 1.0f, 0.0f});
        server = glm::scale(server, glm::vec3(0.95f));
        server = glm::translate(server, {0.0f, -0.48f, 0.0f});
        if (vendor.appearance < m_PedestrianAppearances.size()) {
            const auto& appearance = m_PedestrianAppearances[vendor.appearance];
            for (const auto& part : appearance.parts) {
                if (part) part->Draw(renderer, server, glm::vec4(1.0f),
                                     time + static_cast<float>(index) * 1.37f,
                                     appearance.sitClip >= 0, appearance.sitClip, -1, true);
            }
        } else {
            renderer.Submit(*m_PedestrianBody, glm::translate(server, {0.0f, 0.62f, 0.0f}));
            renderer.Submit(*m_PedestrianHead, glm::translate(server, {0.0f, 1.30f, 0.0f}));
        }
    }
    for (const auto& pedestrian : m_Pedestrians) {
        const glm::vec2 offset(pedestrian.position.x - focusPosition.x, pedestrian.position.z - focusPosition.z);
        if (glm::dot(offset, offset) > 56.0f * 56.0f) continue;
        glm::mat4 character = glm::translate(glm::mat4(1.0f), pedestrian.position);
        character = glm::rotate(character, pedestrian.yaw, {0.0f, 1.0f, 0.0f});
        character = glm::scale(character, glm::vec3(pedestrian.scale));
        if (pedestrian.appearance >= m_PedestrianAppearances.size()) continue;
        const auto& appearance = m_PedestrianAppearances[pedestrian.appearance];
        const int clip = pedestrian.moving ? appearance.walkClip : appearance.idleClip;
        for (size_t partIndex = 0; partIndex < appearance.parts.size(); ++partIndex) {
            const auto& model = appearance.parts[partIndex];
            if (!model) continue;
            glm::vec4 tint(1.0f);
            if (partIndex == 1) tint = glm::vec4(pedestrian.color, 1.0f);
            if (partIndex == 2) tint = glm::vec4(0.68f,0.65f,0.61f,1.0f);
            if (partIndex == 3) tint = glm::vec4(0.66f,0.58f,0.47f,1.0f);
            if (pedestrian.splatRemaining > 0.0f) tint *= glm::vec4(0.42f, 0.32f, 0.20f, 1.0f);
            model->Draw(renderer, character, tint, pedestrian.animationTime + pedestrian.animationOffset, clip >= 0, clip);
        }
    }

    // Sombras espectrales (Gente Sombra de la psicosis)
    for (const auto& sp : m_ShadowPeople) {
        if (sp.opacity <= 0.02f) continue;
        glm::mat4 root = glm::translate(glm::mat4(1.0f), sp.position);
        root = glm::rotate(root, sp.yaw, {0.0f, 1.0f, 0.0f});

        const glm::vec4 bodyColor(0.02f, 0.02f, 0.03f, sp.opacity);
        const glm::vec4 eyeColor(1.0f, 0.12f, 0.12f, sp.opacity);

        if (m_ShadowHeadMesh) {
            glm::mat4 headMat = glm::translate(root, {0.0f, 1.55f, 0.0f});
            renderer.Submit(*m_ShadowHeadMesh, headMat, bodyColor, false, false, nullptr, 2);
        }
        if (m_ShadowEyeMesh) {
            glm::mat4 eyeL = glm::translate(root, {-0.07f, 1.58f, 0.16f});
            glm::mat4 eyeR = glm::translate(root, { 0.07f, 1.58f, 0.16f});
            renderer.Submit(*m_ShadowEyeMesh, eyeL, eyeColor, false, false, nullptr, 2);
            renderer.Submit(*m_ShadowEyeMesh, eyeR, eyeColor, false, false, nullptr, 2);
        }
        if (m_ShadowTorsoMesh) {
            glm::mat4 torsoMat = glm::translate(root, {0.0f, 1.05f, 0.0f});
            renderer.Submit(*m_ShadowTorsoMesh, torsoMat, bodyColor, false, false, nullptr, 2);
        }
        if (m_ShadowLegMesh) {
            glm::mat4 legL = glm::translate(root, {-0.12f, 0.42f, 0.0f});
            legL = glm::rotate(legL, -glm::half_pi<float>(), {1.0f, 0.0f, 0.0f});
            glm::mat4 legR = glm::translate(root, { 0.12f, 0.42f, 0.0f});
            legR = glm::rotate(legR, -glm::half_pi<float>(), {1.0f, 0.0f, 0.0f});
            renderer.Submit(*m_ShadowLegMesh, legL, bodyColor, false, false, nullptr, 2);
            renderer.Submit(*m_ShadowLegMesh, legR, bodyColor, false, false, nullptr, 2);
        }
    }
    (void)time;
}

bool Simulation::BuildCambuchePiece(const std::string& pieceId) {
    if (pieceId.empty()) return false;
    if (pieceId != "base" && !m_CambucheState.base) return false;
    if (m_CambucheState.IsBuilt(pieceId)) return false;
    m_CambucheState.SetBuilt(pieceId, true);
    return true;
}

void Simulation::UpdatePsychosis(float dt, const glm::vec3& playerPosition, float severity) {
    if (severity <= 0.0f) {
        if (!m_ShadowPeople.empty()) {
            for (auto it = m_ShadowPeople.begin(); it != m_ShadowPeople.end();) {
                it->dissolving = true;
                it->opacity -= dt * 3.0f;
                if (it->opacity <= 0.02f) it = m_ShadowPeople.erase(it);
                else ++it;
            }
        }
        return;
    }

    // Spawn shadow people (máximo 3)
    if (m_ShadowPeople.size() < 3) {
        std::uniform_real_distribution<float> spawnChance(0.0f, 1.0f);
        if (spawnChance(m_Random) < 0.035f * (dt > 0.0f ? dt / 0.016f : 1.0f)) {
            std::uniform_real_distribution<float> angleDist(0.0f, glm::two_pi<float>());
            std::uniform_real_distribution<float> distDist(14.0f, 22.0f);
            const float angle = angleDist(m_Random);
            const float dist = distDist(m_Random);
            glm::vec3 spawnPos = playerPosition + glm::vec3(std::cos(angle) * dist, 0.0f, std::sin(angle) * dist);
            spawnPos.y = 0.0f;
            m_ShadowPeople.push_back({spawnPos, 0.0f, 18.0f + std::uniform_real_distribution<float>(0.0f, 10.0f)(m_Random), false, 0.78f});
        }
    }

    // Actualizar sombras existentes
    for (auto it = m_ShadowPeople.begin(); it != m_ShadowPeople.end();) {
        it->lifetime -= dt;
        const float distToPlayer = glm::distance(glm::vec2(it->position.x, it->position.z),
                                                 glm::vec2(playerPosition.x, playerPosition.z));
        // Mirar hacia el jugador
        it->yaw = std::atan2(playerPosition.x - it->position.x, playerPosition.z - it->position.z);

        if (distToPlayer < 5.5f || it->lifetime <= 0.0f) {
            it->dissolving = true;
        }

        if (it->dissolving) {
            it->position.y += dt * 0.45f;
            it->opacity -= dt * 2.2f;
        }

        if (it->opacity <= 0.02f) {
            it = m_ShadowPeople.erase(it);
        } else {
            ++it;
        }
    }
}

} // namespace Bazuko
