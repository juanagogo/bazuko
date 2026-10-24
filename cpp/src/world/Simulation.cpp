#include "Simulation.hpp"
#include <glm/gtc/matrix_transform.hpp>
#include <algorithm>
#include <array>
#include <cmath>
#include <filesystem>
#include "../character/CharacterAnimations.hpp"
#include "../core/Log.hpp"
#include "../core/Paths.hpp"
#include <limits>
#include <queue>
#include <unordered_map>

namespace Bazuko {

namespace {

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
                       std::function<void(size_t, size_t)> modelLoadProgress)
    : m_City(city), m_Random(seed) {
    m_PedestrianBody = Mesh::CreateCube({0.34f, 1.05f, 0.25f}, {0.48f, 0.34f, 0.25f, 1.0f});
    m_PedestrianHead = Mesh::CreateCube({0.24f, 0.25f, 0.24f}, {0.62f, 0.46f, 0.34f, 1.0f});
    std::string modelsRoot;
    {
        std::string animationFile = Paths::Find("public/models/animaciones-actionforge.glb");
        if (!std::filesystem::exists(animationFile)) animationFile = Paths::Find("public/models/animaciones-prueba.glb");
        if (std::filesystem::exists(animationFile)) modelsRoot = std::filesystem::path(animationFile).parent_path().generic_string() + "/";
    }
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
        const size_t totalModelLoads = 1 + outfits.size() * outfits.front().size() + importedFiles.size();
        size_t completedModelLoads = 0;
        const auto reportModelLoad = [&]() {
            if (modelLoadProgress) modelLoadProgress(++completedModelLoads, totalModelLoads);
        };

        std::string animationPath = modelsRoot + "animaciones-actionforge.glb";
        if (!std::filesystem::exists(animationPath)) animationPath = modelsRoot + "animaciones-prueba.glb";
        m_PedestrianAnimation = Model::LoadFromFile(animationPath);
        reportModelLoad();

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
            reportModelLoad();
        }
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
    m_MissionMarker = Mesh::CreateCube({0.42f, 1.5f, 0.42f}, {0.92f, 0.64f, 0.12f, 1.0f});
    m_DogBody = Mesh::CreateRoundedBox({0.78f, 0.42f, 1.12f}, 0.12f, 3);
    m_DogHead = Mesh::CreateRoundedBox({0.48f, 0.42f, 0.48f}, 0.10f, 3);
    m_DogSnout = Mesh::CreateRoundedBox({0.31f, 0.20f, 0.30f}, 0.07f, 3, {0.69f, 0.43f, 0.27f, 1.0f});
    m_DogEar = Mesh::CreateRoundedBox({0.14f, 0.25f, 0.16f}, 0.04f, 2);
    m_DogLeg = Mesh::CreateRoundedBox({0.15f, 0.34f, 0.16f}, 0.04f, 2);
    m_DogCollar = Mesh::CreateCube({0.80f, 0.10f, 0.18f}, {0.78f, 0.12f, 0.12f, 1.0f});
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
    std::uniform_real_distribution<float> rainHorizontal(-13.0f, 13.0f);
    std::uniform_real_distribution<float> rainHeight(0.0f, 16.0f);
    for (size_t drop = 0; drop < 48; ++drop) {
        m_RainOffsets.emplace_back(rainHorizontal(m_Random), rainHeight(m_Random), rainHorizontal(m_Random));
    }
    const std::array<std::array<int, 4>, 3> parkBounds{{
        {{26, 33, 24, 35}},
        {{44, 50, 24, 35}},
        {{70, 81, 46, 57}}
    }};
    for (int z = 1; z < CityLayout::HEIGHT - 1; ++z) {
        for (int x = 1; x < CityLayout::WIDTH - 1; ++x) {
            if (m_City.GetTileAt(x, z) != TileType::Grass) continue;
            const glm::vec3 point((x + 0.5f) * CityLayout::TILE_SIZE - CityLayout::WIDTH,
                                  0.0f,
                                  (z + 0.5f) * CityLayout::TILE_SIZE - CityLayout::HEIGHT);
            m_GrassPositions.push_back(point);
            if ((x * 7 + z * 13) % 11 == 0) m_TreePositions.push_back(point);
            for (size_t parkIndex = 0; parkIndex < parkBounds.size(); ++parkIndex) {
                const auto& bounds = parkBounds[parkIndex];
                if (x >= bounds[0] && x <= bounds[1] && z >= bounds[2] && z <= bounds[3]) {
                    m_ParkGrassPositions[parkIndex].push_back(point);
                    break;
                }
            }
        }
    }
    for (size_t parkIndex = 0; parkIndex < m_ParkGrassPositions.size(); ++parkIndex) {
        const auto& grass = m_ParkGrassPositions[parkIndex];
        for (size_t pigeonIndex = 0; pigeonIndex < 10 && !grass.empty(); ++pigeonIndex) {
            const size_t grassIndex = pigeonIndex * grass.size() / 10;
            const glm::vec3 point = grass[grassIndex];
            const float offset = static_cast<float>(pigeonIndex % 4) * 0.07f;
            m_Pigeons.push_back({point + glm::vec3(offset, 0.0f, -offset), point, 0.0f,
                                 static_cast<float>(parkIndex * 10 + pigeonIndex) * 0.83f, parkIndex});
        }
    }
    for (size_t variant = 0; variant < 8; ++variant) {
        m_PickupMeshes.push_back(MakeTrashBagMesh(variant));
    }
    for (int z = 2; z < CityLayout::HEIGHT - 2; z += 7) {
        for (int x = 2; x < CityLayout::WIDTH - 2; x += 7) {
            bool placed = false;
            for (int dz = 0; dz < 7 && !placed; ++dz) for (int dx = 0; dx < 7 && !placed; ++dx) {
                const int tx = x + dx, tz = z + dz;
                if (m_City.GetTileAt(tx, tz) != TileType::Sidewalk) continue;
                const bool adjacentToRoad = m_City.GetTileAt(tx + 1, tz) == TileType::Road || m_City.GetTileAt(tx - 1, tz) == TileType::Road ||
                    m_City.GetTileAt(tx, tz + 1) == TileType::Road || m_City.GetTileAt(tx, tz - 1) == TileType::Road;
                if (!adjacentToRoad) continue;
                m_StreetLamps.emplace_back((tx + 0.5f) * CityLayout::TILE_SIZE - CityLayout::WIDTH, 0.0f,
                    (tz + 0.5f) * CityLayout::TILE_SIZE - CityLayout::HEIGHT);
                placed = true;
            }
        }
    }
    for (int z = 4; z < CityLayout::HEIGHT - 4 && m_Pickups.size() < 12; z += 9) {
        for (int x = 4; x < CityLayout::WIDTH - 4 && m_Pickups.size() < 12; x += 11) {
            bool placed = false;
            for (int dz = 0; dz < 9 && !placed; ++dz) {
                for (int dx = 0; dx < 11 && !placed; ++dx) {
                    const int tx = x + dx;
                    const int tz = z + dz;
                    if (m_City.GetTileAt(tx, tz) != TileType::Sidewalk) continue;
                    const bool adjacentToRoad =
                        m_City.GetTileAt(tx + 1, tz) == TileType::Road ||
                        m_City.GetTileAt(tx - 1, tz) == TileType::Road ||
                        m_City.GetTileAt(tx, tz + 1) == TileType::Road ||
                        m_City.GetTileAt(tx, tz - 1) == TileType::Road;
                    if (!adjacentToRoad) continue;
                    const glm::vec3 position((tx + 0.5f) * CityLayout::TILE_SIZE - CityLayout::WIDTH,
                                             0.0f,
                                             (tz + 0.5f) * CityLayout::TILE_SIZE - CityLayout::HEIGHT);
                    const bool separated = std::all_of(m_Pickups.begin(), m_Pickups.end(),
                        [&](const PickupItem& pickup) {
                            return glm::distance(glm::vec2(pickup.position.x, pickup.position.z),
                                                 glm::vec2(position.x, position.z)) >= 5.0f;
                        });
                    if (!separated) continue;
                    const size_t itemIndex = static_cast<size_t>(m_Unit(m_Random) * 8.0f);
                    m_Pickups.push_back({itemIndex, position, true, true, 0.0f});
                    placed = true;
                }
            }
        }
    }
    const auto worldTile = [](float tile, int count) {
        return (tile + 0.5f) * CityLayout::TILE_SIZE - count * CityLayout::TILE_SIZE * 0.5f;
    };
    const auto laneX = [&](int first, int last, int side) {
        return worldTile((first + last) * 0.5f + side * (last - first + 1) * 0.25f, CityLayout::WIDTH);
    };
    const auto laneZ = [&](int first, int last, int side) {
        return worldTile((first + last) * 0.5f + side * (last - first + 1) * 0.25f, CityLayout::HEIGHT);
    };
    const std::array<std::pair<int, int>, 4> carreras{{
        {18, 23}, {36, 41}, {84, 89}, {106, 111}
    }};
    const std::array<std::pair<int, int>, 2> caracas{{{53, 56}, {63, 66}}};
    const std::array<std::pair<int, int>, 5> calles{{
        {16, 21}, {38, 43}, {60, 65}, {72, 77}, {94, 99}
    }};
    const float top = laneZ(calles[0].first, calles[0].second, 1);
    const float bottom = laneZ(calles[1].first, calles[1].second, -1);
    const float farBottom = laneZ(calles.back().first, calles.back().second, -1);
    const float upperMiddle = laneZ(calles[1].first, calles[1].second, 1);
    const std::array<std::array<float, 4>, 6> routeBounds{{
        {{laneX(carreras[0].first, carreras[0].second, 1), laneX(caracas[0].first, caracas[0].second, -1), top, bottom}},
        {{laneX(caracas[1].first, caracas[1].second, 1), laneX(carreras[1].first, carreras[1].second, -1), top, bottom}},
        {{laneX(carreras[1].first, carreras[1].second, 1), laneX(carreras[2].first, carreras[2].second, -1), top, farBottom}},
        {{laneX(carreras[2].first, carreras[2].second, 1), laneX(carreras[3].first, carreras[3].second, -1), top, farBottom}},
        {{laneX(carreras[0].first, carreras[0].second, 1), laneX(caracas[0].first, caracas[0].second, -1), upperMiddle, farBottom}},
        {{laneX(caracas[1].first, caracas[1].second, 1), laneX(carreras[1].first, carreras[1].second, -1), upperMiddle, farBottom}}
    }};
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
                (intersection.x + CityLayout::WIDTH * CityLayout::TILE_SIZE * 0.5f) / CityLayout::TILE_SIZE));
            const int centerTileZ = static_cast<int>(std::floor(
                (intersection.z + CityLayout::HEIGHT * CityLayout::TILE_SIZE * 0.5f) / CityLayout::TILE_SIZE));
            for (int tileZ = centerTileZ - 6; tileZ <= centerTileZ + 6; ++tileZ) {
                for (int tileX = centerTileX - 6; tileX <= centerTileX + 6; ++tileX) {
                    const glm::vec3 candidate(
                        (tileX + 0.5f) * CityLayout::TILE_SIZE - CityLayout::WIDTH * CityLayout::TILE_SIZE * 0.5f,
                        0.0f,
                        (tileZ + 0.5f) * CityLayout::TILE_SIZE - CityLayout::HEIGHT * CityLayout::TILE_SIZE * 0.5f);
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
    m_BusStationX = worldTile((57.0f + 62.0f) * 0.5f, CityLayout::WIDTH);
    m_BusPosition = {m_BusStationX + 3.5f, 0.02f,
                     worldTile(static_cast<float>(CityLayout::HEIGHT - 2), CityLayout::HEIGHT) - 9.1f};
    m_BusPreviousPosition = m_BusPosition;
    m_BusStartZ = m_BusPosition.z;
    m_BusEndZ = worldTile(1.0f, CityLayout::HEIGHT) + 9.1f;
    m_BusStationZ = worldTile(21.5f, CityLayout::HEIGHT);
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
                (x + 0.5f) * CityLayout::TILE_SIZE - CityLayout::WIDTH,
                0.0f,
                (z + 0.5f) * CityLayout::TILE_SIZE - CityLayout::HEIGHT
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

    struct VendorSite {
        int tileX;
        int tileZ;
        bool fritanga;
        const char* name;
    };
    constexpr std::array<VendorSite, 6> vendorSites{{
        {30, 14, false, "Chaza de don Efraín"},
        {48, 22, true, "Fritanga La Mona"},
        {76, 36, false, "Dulces y minutos"},
        {96, 58, false, "Chaza de la Carrera 8"},
        {30, 92, true, "Fritanga del Sur"},
        {76, 80, false, "Chaza de la avenida"}
    }};
    for (const VendorSite& site : vendorSites) {
        float bestDistanceSquared = std::numeric_limits<float>::max();
        StreetVendor selected;
        bool found = false;
        for (int z = std::max(2, site.tileZ - 5); z <= std::min(CityLayout::HEIGHT - 3, site.tileZ + 5); ++z) {
            for (int x = std::max(2, site.tileX - 5); x <= std::min(CityLayout::WIDTH - 3, site.tileX + 5); ++x) {
                if (m_City.GetTileAt(x, z) != TileType::Sidewalk) continue;
                glm::vec3 facing(0.0f);
                if (m_City.GetTileAt(x + 1, z) == TileType::Road) facing.x = 1.0f;
                else if (m_City.GetTileAt(x - 1, z) == TileType::Road) facing.x = -1.0f;
                else if (m_City.GetTileAt(x, z + 1) == TileType::Road) facing.z = 1.0f;
                else if (m_City.GetTileAt(x, z - 1) == TileType::Road) facing.z = -1.0f;
                if (glm::dot(facing, facing) < 0.5f) continue;
                const glm::vec3 position(
                    (x + 0.5f) * CityLayout::TILE_SIZE - CityLayout::WIDTH,
                    0.15f,
                    (z + 0.5f) * CityLayout::TILE_SIZE - CityLayout::HEIGHT);
                if (m_City.IsBlocked(position.x, position.z, 0.55f)) continue;
                const bool tooClose = std::any_of(m_StreetVendors.begin(), m_StreetVendors.end(),
                    [&](const StreetVendor& vendor) {
                        return glm::distance(glm::vec2(position.x, position.z),
                                             glm::vec2(vendor.position.x, vendor.position.z)) < 14.0f;
                    });
                if (tooClose) continue;
                const float dx = static_cast<float>(x - site.tileX);
                const float dz = static_cast<float>(z - site.tileZ);
                const float distanceSquared = dx * dx + dz * dz;
                if (distanceSquared >= bestDistanceSquared) continue;
                const glm::vec3 serverPosition = position - facing * 1.05f;
                selected = {position, serverPosition, facing, site.name, site.fritanga,
                            m_PedestrianAppearances.empty() ? 0 : m_StreetVendors.size() % m_PedestrianAppearances.size()};
                bestDistanceSquared = distanceSquared;
                found = true;
            }
        }
        if (found) m_StreetVendors.push_back(std::move(selected));
        else LogWarn("No se encontro una acera libre para el vendedor: {}", site.name);
    }

    const auto findMarketSidewalk = [&](const glm::vec3& target, float minDistance) {
        glm::vec3 nearest = target;
        float bestDistanceSquared = std::numeric_limits<float>::max();
        for (int z = 1; z < CityLayout::HEIGHT - 1; ++z) {
            for (int x = 1; x < CityLayout::WIDTH - 1; ++x) {
                if (m_City.GetTileAt(x, z) != TileType::Sidewalk) continue;
                const glm::vec3 candidate(
                    (x + 0.5f) * CityLayout::TILE_SIZE - CityLayout::WIDTH,
                    0.15f,
                    (z + 0.5f) * CityLayout::TILE_SIZE - CityLayout::HEIGHT);
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
    m_RecyclerPosition = findMarketSidewalk({-5.0f, 0.15f, 0.0f}, 0.0f);
    m_MissionNpcPosition = findMarketSidewalk(m_RecyclerPosition + glm::vec3(2.0f, 0.0f, 0.0f), 1.0f);
    m_DealerPosition = findMarketSidewalk({-45.0f, 0.15f, -20.0f}, 0.0f);
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
    const auto toTile = [](float coordinate, int count) {
        return static_cast<int>(std::floor((coordinate + count * CityLayout::TILE_SIZE * 0.5f) / CityLayout::TILE_SIZE));
    };
    const int startX = toTile(start.x, CityLayout::WIDTH);
    const int startZ = toTile(start.z, CityLayout::HEIGHT);
    const int goalX = toTile(target.x, CityLayout::WIDTH);
    const int goalZ = toTile(target.z, CityLayout::HEIGHT);
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
        path.emplace_back((x + 0.5f) * CityLayout::TILE_SIZE - CityLayout::WIDTH * CityLayout::TILE_SIZE * 0.5f,
                          0.0f,
                          (z + 0.5f) * CityLayout::TILE_SIZE - CityLayout::HEIGHT * CityLayout::TILE_SIZE * 0.5f);
    }
    return !path.empty();
}

bool Simulation::CollectPickup(size_t index, PickupItem& pickup) {
    if (index >= m_Pickups.size() || !m_Pickups[index].available) return false;
    pickup = m_Pickups[index];
    if (pickup.container) {
        m_Pickups[index].available = false;
        m_Pickups[index].cooldownRemaining = 120.0f;
    } else {
        m_Pickups.erase(m_Pickups.begin() + static_cast<std::ptrdiff_t>(index));
    }
    return true;
}

void Simulation::RestorePickup(const PickupItem& pickup) {
    if (pickup.container) {
        const auto found = std::find_if(m_Pickups.begin(), m_Pickups.end(), [&](const PickupItem& current) {
            return current.container && glm::distance(current.position, pickup.position) < 0.01f;
        });
        if (found != m_Pickups.end()) {
            found->available = true;
            found->cooldownRemaining = 0.0f;
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
    const float halfWidth = CityLayout::WIDTH * CityLayout::TILE_SIZE * 0.5f;
    const float halfHeight = CityLayout::HEIGHT * CityLayout::TILE_SIZE * 0.5f;
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

void Simulation::Update(float dt, const glm::vec3& playerPosition) {
    m_Clock = std::fmod(m_Clock + dt / 600.0f, 1.0f);
    m_DayProgress = m_Clock;
    m_WeatherRemaining -= dt;
    if (m_WeatherRemaining <= 0.0f) {
        m_IsRaining = !m_IsRaining;
        m_WeatherRemaining = 150.0f + m_Unit(m_Random) * 150.0f;
    }
    if (m_IsRaining) {
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

void Simulation::UpdatePigeons(float dt, const glm::vec3& playerPosition) {
    for (auto& pigeon : m_Pigeons) {
        pigeon.phase += dt;
        if (pigeon.flightRemaining <= 0.0f) {
            const bool playerNear = glm::distance(glm::vec2(playerPosition.x, playerPosition.z),
                                                  glm::vec2(pigeon.position.x, pigeon.position.z)) < 3.5f;
            const bool pedestrianNear = std::any_of(m_Pedestrians.begin(), m_Pedestrians.end(),
                [&](const Pedestrian& pedestrian) {
                    return glm::distance(glm::vec2(pedestrian.position.x, pedestrian.position.z),
                                         glm::vec2(pigeon.position.x, pigeon.position.z)) < 3.5f;
                });
            if (!playerNear && !pedestrianNear) continue;
            const auto& parkGrass = m_ParkGrassPositions[pigeon.parkIndex];
            if (parkGrass.empty()) continue;
            std::uniform_int_distribution<size_t> landing(0, parkGrass.size() - 1);
            pigeon.target = parkGrass[landing(m_Random)];
            pigeon.target.y = 1.4f;
            pigeon.flightRemaining = 2.0f;
        }
        const glm::vec3 delta = pigeon.target - pigeon.position;
        const float distance = glm::length(delta);
        if (distance > 0.01f) pigeon.position += delta * std::min(1.0f, 4.0f * dt / distance);
        pigeon.flightRemaining = std::max(0.0f, pigeon.flightRemaining - dt);
        if (pigeon.flightRemaining <= 0.0f) {
            pigeon.position = pigeon.target;
            pigeon.position.y = 0.0f;
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
    for (auto& pickup : m_Pickups) {
        if (!pickup.container || pickup.available) continue;
        pickup.cooldownRemaining = std::max(0.0f, pickup.cooldownRemaining - dt);
        if (pickup.cooldownRemaining <= 0.0f) pickup.available = true;
    }
    m_PickupSpawnTimer -= dt;
    if (m_Pickups.size() >= 32 || m_PickupSpawnTimer > 0.0f) return;
    for (int attempt = 0; attempt < 30; ++attempt) {
        const float angle = m_Unit(m_Random) * glm::two_pi<float>();
        const float distance = 4.0f + m_Unit(m_Random) * 24.0f;
        glm::vec3 point = playerPosition + glm::vec3(std::cos(angle) * distance, 0.0f, std::sin(angle) * distance);
        if (!m_City.IsWalkable(point.x, point.z) || m_City.IsRoad(point.x, point.z)) continue;
        bool overlapping = false;
        for (const auto& pickup : m_Pickups) if (glm::distance(pickup.position, point) < 2.0f) overlapping = true;
        if (overlapping) continue;
        m_Pickups.push_back({static_cast<size_t>(m_Unit(m_Random) * m_PickupMeshes.size()) % m_PickupMeshes.size(), point});
        m_PickupSpawnTimer = 1.8f;
        return;
    }
    m_PickupSpawnTimer = 0.5f;
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
        glm::vec3 spawn;
        if (FindSidewalkPoint(spawn, playerPosition, 48.0f)) {
            Pedestrian pedestrian;
            pedestrian.position = spawn;
            glm::vec3 destination;
            if (FindSidewalkPoint(destination, spawn, 22.0f) && FindSidewalkPath(spawn, destination, pedestrian.route)) {
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
                if (FindSidewalkPoint(destination, pedestrian.position, 24.0f) && FindSidewalkPath(pedestrian.position, destination, pedestrian.route)) {
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
            if (FindSidewalkPoint(destination, pedestrian.position, 12.0f) && FindSidewalkPath(pedestrian.position, destination, pedestrian.route)) {
                pedestrian.target = pedestrian.route.front();
                pedestrian.nextWaypoint = 1;
            } else pedestrian.target = pedestrian.position;
        }
    }
    std::erase_if(m_Pedestrians, [&](const Pedestrian& pedestrian) { return glm::distance(pedestrian.position, playerPosition) > 72.0f; });
}

void Simulation::UpdateTraffic(float dt) {
    if (dt <= 0.0f) return;
    for (auto& vehicle : m_Traffic) vehicle.previousPosition = vehicle.position;
    constexpr float braking = 5.0f;
    constexpr float acceleration = 1.8f;
    constexpr float gap = 1.8f;
    constexpr float probeStep = 0.5f;
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
                    if (OrientedBoxesOverlap(probePosition, probeForward, vehicle.length, vehicle.width,
                                             other.position, {other.direction.x, other.direction.z},
                                             other.length, other.width)) {
                        clearance = std::min(clearance, std::max(0.0f, ahead - probeStep));
                        blockedByVehicle = true;
                        break;
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
                if (OrientedBoxesOverlap(probePosition, probeForward, vehicle.length, vehicle.width,
                                         m_BusPosition, {0.0f, -1.0f}, 18.2f, 2.52f)) {
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
                const bool aMoving = a.nextSpeed > 0.05f;
                const bool bMoving = b.nextSpeed > 0.05f;
                if (aMoving && !bMoving) {
                    a.nextDistance = a.distance;
                    a.nextSpeed = 0.0f;
                } else if (bMoving && !aMoving) {
                    b.nextDistance = b.distance;
                    b.nextSpeed = 0.0f;
                } else {
                    b.nextDistance = b.distance;
                    b.nextSpeed = 0.0f;
                }
            }
        }
        for (auto& vehicle : m_Traffic) {
            vehicle.distance = vehicle.nextDistance;
            vehicle.speed = vehicle.nextSpeed;
            vehicle.wheelRotation -= vehicle.speed * stepTime / 0.33f;
            SampleCircuit(vehicle.route, vehicle.routeCumulative, vehicle.routeLength, vehicle.distance,
                          vehicle.position, vehicle.direction, vehicle.nextWaypoint);
            vehicle.horizontalLane = std::abs(vehicle.direction.x) > std::abs(vehicle.direction.z);
            vehicle.laneCoordinate = vehicle.horizontalLane ? vehicle.position.z : vehicle.position.x;
            vehicle.yaw = std::atan2(-vehicle.direction.z, vehicle.direction.x);
        }
        remaining -= stepTime;
    }
    for (size_t index = 0; index < m_CarCooldowns.size(); ++index) {
        m_CarCooldowns[index] = std::max(0.0f, m_CarCooldowns[index] - dt);
        if (m_CarCooldowns[index] <= 0.0f) m_Traffic[index].mirrorsAvailable = true;
    }
}

void Simulation::UpdateBus(float dt) {
    m_BusPreviousPosition = m_BusPosition;
    constexpr float acceleration = 1.1f;
    constexpr float braking = 4.0f;
    float remaining = std::min(std::max(dt, 0.0f), 0.5f);
    while (remaining > 1e-8f) {
        const float step = std::min(remaining, 0.05f);
        remaining -= step;
        if (m_BusDwellRemaining > 0.0f) {
            m_BusDwellRemaining = std::max(0.0f, m_BusDwellRemaining - step);
            continue;
        }
        float clearance = m_BusPosition.z - m_BusEndZ;
        if (!m_BusServedStation) clearance = std::min(clearance, m_BusPosition.z - m_BusStationZ);
        const float lookAhead = std::max(5.0f, m_BusSpeed * m_BusSpeed / (2.0f * braking) + m_BusSpeed * 0.2f + 2.0f);
        for (float ahead = 0.0f; ahead <= std::min(lookAhead, clearance); ahead += 0.5f) {
            const glm::vec3 probe = m_BusPosition + glm::vec3(0.0f, 0.0f, -ahead);
            bool blockedByVehicle = false;
            const auto checkVehicle = [&](const TrafficVehicle& vehicle) {
                return OrientedBoxesOverlap(probe, {0.0f, -1.0f}, 18.2f, 2.52f,
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
        const auto actorClearance = [&](const glm::vec3& actor) {
            if (std::abs(actor.x - m_BusPosition.x) > 2.52f * 0.5f + 0.55f) return std::numeric_limits<float>::infinity();
            if (actor.z > m_BusPosition.z + 18.2f * 0.5f + 0.55f) return std::numeric_limits<float>::infinity();
            return std::max(0.0f, m_BusPosition.z - actor.z - 18.2f * 0.5f - 0.8f);
        };
        for (const auto& pedestrian : m_Pedestrians) clearance = std::min(clearance, actorClearance(pedestrian.position));
        const float desiredSpeed = std::min(5.0f, std::sqrt(2.0f * braking * std::max(0.0f, clearance)));
        const float rate = desiredSpeed < m_BusSpeed ? braking : acceleration;
        m_BusSpeed = std::clamp(desiredSpeed, m_BusSpeed - rate * step, m_BusSpeed + rate * step);
        const float travel = std::min(m_BusSpeed * step, std::max(0.0f, clearance));
        m_BusPosition.z -= travel;
        m_BusSpeed = travel / step;
        m_BusWheelRotation += travel / 0.5f;
        if (!m_BusServedStation && m_BusPosition.z <= m_BusStationZ + 1e-8f) {
            m_BusPosition.z = m_BusStationZ;
            m_BusServedStation = true;
            m_BusSpeed = 0.0f;
            m_BusDwellRemaining = 4.0f;
        }
        if (m_BusPosition.z <= m_BusEndZ + 1e-8f) {
            m_BusPosition.z = m_BusStartZ;
            m_BusServedStation = false;
            m_BusSpeed = 0.0f;
        }
    }
}

bool Simulation::IsBlocked(const glm::vec3& position, float radius) const {
    const auto collidesWithVehicle = [&](const TrafficVehicle& vehicle) {
        return PointInVehicleBox(position, vehicle.position,
                                 {vehicle.direction.x, vehicle.direction.z},
                                 vehicle.length * 0.5f, vehicle.width * 0.5f, radius);
    };
    for (const auto& vehicle : m_Traffic) {
        if (collidesWithVehicle(vehicle)) return true;
    }
    for (const auto& vehicle : m_ParkedCars) {
        if (collidesWithVehicle(vehicle)) return true;
    }
    if (PointInVehicleBox(position, m_BusPosition, {0.0f, -1.0f},
                          9.1f, 1.26f, radius)) {
        return true;
    }
    return false;
}

bool Simulation::GetVehicleImpact(const glm::vec3& position, float& speed, glm::vec3& direction) const {
    for (const auto& vehicle : m_Traffic) {
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
    if (m_BusSpeed >= 1.5f) {
        bool frontContact = PointAtVehicleFront(position, m_BusPosition, {0.0f, -1.0f},
                                                9.1f, 1.26f, 0.4f);
        for (int sample = 0; !frontContact && sample <= 8; ++sample) {
            const float fraction = static_cast<float>(sample) / 8.0f;
            const glm::vec3 sweptPosition = glm::mix(m_BusPreviousPosition, m_BusPosition, fraction);
            frontContact = PointAtVehicleFront(position, sweptPosition, {0.0f, -1.0f},
                                               9.1f, 1.26f, 0.4f);
        }
        if (frontContact) {
            speed = m_BusSpeed;
            direction = {0.0f, 0.0f, -1.0f};
            return true;
        }
    }
    return false;
}

void Simulation::Render(Renderer& renderer, float time, const glm::vec3& focusPosition) const {
    const glm::mat4 stationRoot = glm::translate(glm::mat4(1.0f), {m_BusStationX, 0.0f, m_BusStationZ});
    renderer.Submit(*m_BusPlatform, glm::translate(stationRoot, {0.0f, 0.45f, 0.0f}));
    renderer.Submit(*m_BusCanopy, glm::translate(stationRoot, {0.0f, 3.3f, 0.0f}));
    renderer.Submit(*m_BusStationGlass, glm::translate(stationRoot, {-1.25f, 1.7f, 0.0f}), {0.66f, 0.78f, 0.84f, 0.35f}, false, false, nullptr, 2);
    renderer.Submit(*m_BusStationGlass, glm::translate(stationRoot, {1.25f, 1.7f, 0.0f}), {0.66f, 0.78f, 0.84f, 0.35f}, false, false, nullptr, 2);
    renderer.Submit(*m_BusStationSign, glm::translate(stationRoot, {0.0f, 3.8f, 7.0f}));
    for (float z = -8.0f; z <= 8.0f; z += 4.0f) {
        for (float x : {-1.2f, 1.2f}) {
            glm::mat4 post = glm::translate(stationRoot, {x, 2.1f, z});
            post = glm::rotate(post, -glm::half_pi<float>(), {1.0f, 0.0f, 0.0f});
            renderer.Submit(*m_BusStationPost, post);
        }
    }
    if (m_ShelterModel &&
        glm::distance(glm::vec2(focusPosition.x, focusPosition.z), glm::vec2(112.98f, 94.64f)) < 80.0f) {
        glm::mat4 shelter = glm::translate(glm::mat4(1.0f), {112.98f, 0.0f, 94.64f});
        shelter = glm::rotate(shelter, glm::pi<float>() * 0.08f, {0.0f, 1.0f, 0.0f});
        m_ShelterModel->Draw(renderer, shelter * m_ShelterModelFit);
    }
    for (const auto& position : m_StreetLamps) {
        if (m_StreetLampModel) {
            m_StreetLampModel->Draw(renderer, glm::translate(glm::mat4(1.0f), position) * m_StreetLampModelFit);
            continue;
        }
        glm::mat4 pole = glm::translate(glm::mat4(1.0f), position + glm::vec3(0.0f, 1.6f, 0.0f));
        renderer.Submit(*m_StreetLampPole, pole);
        glm::mat4 head = glm::translate(glm::mat4(1.0f), position + glm::vec3(0.18f, 3.18f, 0.0f));
        renderer.Submit(*m_StreetLampHead, head, glm::vec4(1.0f, 0.89f, 0.65f, 1.0f));
    }
    for (const auto& position : m_TreePositions) {
        if (glm::distance(glm::vec2(focusPosition.x, focusPosition.z),
                          glm::vec2(position.x, position.z)) > 80.0f) continue;
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
    for (const auto& pigeon : m_Pigeons) {
        if (glm::distance(glm::vec2(focusPosition.x, focusPosition.z),
                          glm::vec2(pigeon.position.x, pigeon.position.z)) > 45.0f) continue;
        glm::mat4 bird = glm::translate(glm::mat4(1.0f), pigeon.position);
        renderer.Submit(*m_PigeonBody, glm::translate(bird, {0.0f, 0.18f, 0.0f}));
        const float wingLift = pigeon.flightRemaining > 0.0f ? std::sin(time * 18.0f + pigeon.phase) * 0.20f : 0.0f;
        for (float side : {-1.0f, 1.0f}) {
            glm::mat4 wing = glm::translate(bird, {side * 0.14f, 0.24f, 0.0f});
            wing = glm::rotate(wing, side * wingLift, {0.0f, 0.0f, 1.0f});
            renderer.Submit(*m_PigeonWing, wing);
        }
    }
    if (m_IsRaining) {
        for (const auto& offset : m_RainOffsets) {
            const glm::vec3 position = focusPosition + offset;
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
    const float busOpacity = std::clamp(std::min((m_BusStartZ - m_BusPosition.z) / 6.0f,
                                                  (m_BusPosition.z - m_BusEndZ) / 6.0f), 0.0f, 1.0f);
    if (busOpacity > 0.0f) {
        const int alphaMode = busOpacity < 1.0f ? 2 : 0;
        const glm::vec4 busRed(0.70f, 0.15f, 0.12f, busOpacity);
        const glm::vec4 busWindow(0.08f, 0.12f, 0.16f, busOpacity);
        glm::mat4 busRoot = glm::translate(glm::mat4(1.0f), m_BusPosition);
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
                    wheel = glm::rotate(wheel, m_BusWheelRotation, {0.0f, 0.0f, 1.0f});
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
    for (size_t index = 0; index < m_StreetVendors.size(); ++index) {
        const StreetVendor& vendor = m_StreetVendors[index];
        const glm::vec2 offset(vendor.position.x - focusPosition.x, vendor.position.z - focusPosition.z);
        if (glm::dot(offset, offset) > 65.0f * 65.0f) continue;
        const float yaw = std::atan2(vendor.facing.x, vendor.facing.z);
        glm::mat4 stall = glm::translate(glm::mat4(1.0f), vendor.position)
            * glm::rotate(glm::mat4(1.0f), yaw, {0.0f, 1.0f, 0.0f});
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
        if (vendor.fritanga) {
            const glm::mat4 grill = glm::translate(stall, {0.78f, 0.48f, 0.0f});
            renderer.Submit(*m_VendorGrill, grill);
            renderer.Submit(*m_VendorCoal, glm::translate(stall, {0.78f, 0.81f, 0.0f}));
            for (int food = 0; food < 5; ++food) {
                const float x = -0.42f + static_cast<float>(food) * 0.20f;
                renderer.Submit(*m_VendorFood, glm::translate(stall, {x, 1.09f, 0.0f}),
                                food % 2 == 0 ? glm::vec4(0.65f, 0.30f, 0.09f, 1.0f)
                                              : glm::vec4(0.87f, 0.62f, 0.20f, 1.0f));
            }
        } else {
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
        if (vendor.appearance < m_PedestrianAppearances.size()) {
            const auto& appearance = m_PedestrianAppearances[vendor.appearance];
            for (const auto& part : appearance.parts) {
                if (part) part->Draw(renderer, server, glm::vec4(1.0f),
                                     time + static_cast<float>(index) * 1.37f,
                                     appearance.idleClip >= 0, appearance.idleClip);
            }
        } else {
            renderer.Submit(*m_PedestrianBody, glm::translate(server, {0.0f, 0.62f, 0.0f}));
            renderer.Submit(*m_PedestrianHead, glm::translate(server, {0.0f, 1.30f, 0.0f}));
        }
    }
    size_t visiblePedestrians = 0;
    for (const auto& pedestrian : m_Pedestrians) {
        const glm::vec2 offset(pedestrian.position.x - focusPosition.x, pedestrian.position.z - focusPosition.z);
        if (glm::dot(offset, offset) > 42.0f * 42.0f || visiblePedestrians >= 12) continue;
        ++visiblePedestrians;
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
    (void)time;
}

} // namespace Bazuko
