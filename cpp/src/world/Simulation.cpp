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
#include <fstream>
#include <nlohmann/json.hpp>
#include <unordered_map>

namespace Bazuko {

namespace {

constexpr size_t kRainDropCount = 350;   // gotas alrededor del jugador, como el original
constexpr float kBusLength = 22.0f;       // largo del bus biarticulado (colisiones, frenado y modelo)
constexpr float kBusHalfLength = kBusLength * 0.5f;
constexpr float kBusWidth = 2.72f;
constexpr float kDayLengthSeconds = 3600.0f;   // un dia de juego = una hora real, como el original

// Radio de las esquinas de un circuito: 3,5 m (el giro de un carro con direccion de 35 grados) o menos si la manzana es pequena
float CircuitRadius(float left, float right, float top, float bottom) {
    return std::min({6.0f, 0.45f * (right - left), 0.45f * (bottom - top)});
}

std::vector<glm::vec3> MakeTrafficCircuit(float left, float right, float top, float bottom) {
    const float radius = CircuitRadius(left, right, top, bottom);
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

// Tinte de cada pieza de un peaton segun su rol (ropa, calzado, pelo, sombrero): el mismo dentro y fuera del vehiculo
glm::vec4 PedestrianPartTint(const PedestrianAppearance& appearance, size_t partIndex, const glm::vec3& color, float animationOffset) {
    const char role = partIndex < appearance.roles.size() ? appearance.roles[partIndex] : 'X';
    const float hairShade = 0.55f + 0.5f * std::fmod(animationOffset * 3.7f, 1.0f);
    if (role == 'C') return glm::vec4(color, 1.0f);
    if (role == 'S') return glm::vec4(0.68f, 0.65f, 0.61f, 1.0f);
    if (role == 'H' || role == 'D') return glm::vec4(0.66f * hairShade, 0.58f * hairShade, 0.47f * hairShade, 1.0f);
    if (role == 'T') return glm::vec4(color * 0.8f + glm::vec3(0.08f), 1.0f);
    return glm::vec4(1.0f);
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

VehicleParts Simulation::LoadVehicleParts(const std::string& modelsRoot, const std::string& stem) const {
    VehicleParts parts;
    const std::string folder = modelsRoot + "vehiculos/";
    std::ifstream file(folder + stem + ".json");
    if (!file) return parts;
    nlohmann::json info;
    try { file >> info; } catch (...) { return parts; }
    const auto resolve = [&](const std::string& name) {
        return std::filesystem::exists(folder + name + ".glb") ? folder + name + ".glb" : folder + name + ".gltf";
    };
    parts.body = Model::LoadFromFile(resolve(stem + "_body"));
    glm::vec3 frontSum(0.0f), rearSum(0.0f);
    int frontCount = 0, rearCount = 0;
    for (const auto& entry : info.value("wheels", nlohmann::json::array())) {
        VehicleParts::Wheel wheel;
        wheel.model = Model::LoadFromFile(resolve(stem + "_" + entry.value("part", std::string())));
        const auto& center = entry["center"];
        wheel.center = {center[0].get<float>(), center[1].get<float>(), center[2].get<float>()};
        wheel.front = entry.value("front", false);
        wheel.radius = entry.value("radius", 0.1f);
        (wheel.front ? frontSum : rearSum) += wheel.center;
        (wheel.front ? frontCount : rearCount) += 1;
        if (wheel.model) parts.wheels.push_back(std::move(wheel));
    }
    if (frontCount > 0 && rearCount > 0) {
        glm::vec3 forward = frontSum / static_cast<float>(frontCount) - rearSum / static_cast<float>(rearCount);
        forward.y = 0.0f;
        if (glm::length(forward) > 1.0e-4f) parts.forward = glm::normalize(forward);
        parts.rollAxis = glm::cross(glm::vec3(0.0f, 1.0f, 0.0f), parts.forward);
    }
        if (info.contains("door")) {
            const auto& door = info["door"];
            parts.door = Model::LoadFromFile(resolve(stem + "_door"));
            parts.doorHinge = {door["hinge"][0].get<float>(), door["hinge"][1].get<float>(), door["hinge"][2].get<float>()};
        }
        if (info.contains("driver")) {
            const auto& driver = info["driver"];
            parts.driver.valid = true;
            parts.driver.suffix = driver.value("profile", std::string());
            if (driver.contains("seat")) parts.driver.seat = {driver["seat"][0].get<float>(), driver["seat"][1].get<float>()};
            if (driver.contains("stance")) parts.driver.stance = {driver["stance"][0].get<float>(), driver["stance"][1].get<float>()};
            parts.driver.hipsZ = driver.value("hipsZ", 0.0f);
            parts.driver.roofZ = driver.value("roofZ", 0.0f);
        }
    if (info.contains("targetLength") && info.contains("min") && info.contains("max")) {
        // escala uniforme: el largo del modelo (eje Z) pasa a `targetLength` metros; se gira para que el frente quede en +X
        const auto& lo = info["min"]; const auto& hi = info["max"];
        const glm::vec3 low(lo[0].get<float>(), lo[1].get<float>(), lo[2].get<float>());
        const glm::vec3 high(hi[0].get<float>(), hi[1].get<float>(), hi[2].get<float>());
        const float scale = info["targetLength"].get<float>() / std::max(0.01f, high.z - low.z);
        const float centerX = (low.x + high.x) * 0.5f, centerZ = (low.z + high.z) * 0.5f;
        parts.fit = glm::scale(glm::mat4(1.0f), glm::vec3(scale))
            * glm::translate(glm::mat4(1.0f), {-centerZ, -low.y, centerX})
            * glm::rotate(glm::mat4(1.0f), glm::half_pi<float>(), {0.0f, 1.0f, 0.0f});
        parts.scale = scale;
        parts.length = info["targetLength"].get<float>();
        if (frontCount > 0 && rearCount > 0)
            parts.wheelbase = glm::length(frontSum / static_cast<float>(frontCount) - rearSum / static_cast<float>(rearCount)) * scale;
        parts.width = (high.x - low.x) * scale;
        parts.ownFit = true;
        for (const auto& seat : info.value("seats", nlohmann::json::array())) {
            const auto& pos = seat["pos"];
            parts.seats.push_back({{pos[0].get<float>(), pos[1].get<float>(), pos[2].get<float>()}, seat.value("yaw", 0.0f), seat.value("driver", false)});
        }
    }
    for (const ModelPart& part : parts.body ? parts.body->GetParts() : std::vector<ModelPart>{}) if (part.paint) parts.hasPaint = true;
    if (!parts.valid()) return VehicleParts{};
    return parts;
}

namespace {
// Modelos de Sketchfab sin permiso de redistribucion (Pitbull de El Chato, Raptor, Renault 6, Model X y el Transmilenio articulado; ver
// docs/creditos-modelos.md): el port no los carga. Quien tenga copias con licencia puede colocarlas en public/models/ y activarlas con
// BAZUKO_MODELOS_RESTRINGIDOS=1; sin esa variable el juego usa los modelos de respaldo.
bool RestrictedModelsEnabled() {
    static const bool enabled = [] {
        const char* value = std::getenv("BAZUKO_MODELOS_RESTRINGIDOS");
        return value != nullptr && value[0] == '1';
    }();
    return enabled;
}
} // namespace

void Simulation::LoadArticulatedBus(const std::string& modelsRoot) {
    // El Transmilenio biarticulado es un modelo restringido (ver docs/creditos-modelos.md): solo con BAZUKO_MODELOS_RESTRINGIDOS=1.
    // Por defecto se usa el bus del juego base dividido en dos secciones con fuelle y seis ruedas (bus-articulado/).
    if (RestrictedModelsEnabled() && LoadArticulatedBusFrom(modelsRoot + "transmilenio/", "tm.json")) return;
    LoadArticulatedBusFrom(modelsRoot + "bus-articulado/", "bus.json");
}

bool Simulation::LoadArticulatedBusFrom(const std::string& folder, const char* specFile) {
    std::ifstream file(folder + specFile);
    if (!file) return false;
    nlohmann::json info;
    try { file >> info; } catch (...) { return false; }
    ArticulatedBus bus;
    const auto& sections = info["sections"];
    const size_t sectionCount = sections.size();
    if (sectionCount < 2 || info["pivots"].size() + 1 != sectionCount) return false;
    for (size_t index = 0; index < sectionCount; ++index) bus.sections.push_back(Model::LoadFromFile(folder + sections[index].value("file", std::string())));
    bus.bellows.resize(sectionCount - 1);
    for (size_t index = 0; index + 1 < sectionCount && index < info.value("accordions", nlohmann::json::array()).size(); ++index)
        bus.bellows[index] = Model::LoadFromFile(folder + info["accordions"][index].value("file", std::string()));
    // el frente es +Z en el modelo: la primera seccion llega al extremo mayor y la ultima al menor
    const float frontEnd = std::max(sections[0]["max"][2].get<float>(), sections[0]["min"][2].get<float>());
    const float rearEnd = std::min(sections[sectionCount - 1]["min"][2].get<float>(), sections[sectionCount - 1]["max"][2].get<float>());
    std::vector<float> boundaries{frontEnd};
    for (const auto& pivot : info["pivots"]) { bus.pivotZ.push_back(pivot[2].get<float>()); boundaries.push_back(bus.pivotZ.back()); }
    boundaries.push_back(rearEnd);
    for (size_t index = 0; index < sectionCount; ++index) bus.reference.push_back((boundaries[index] + boundaries[index + 1]) * 0.5f);
    bus.centerZ = (frontEnd + rearEnd) * 0.5f;
    bus.scale = kBusLength / (frontEnd - rearEnd);
    bus.groundY = std::numeric_limits<float>::max();
    for (const auto& entry : info["wheels"]) {
        ArticulatedBus::Wheel wheel;
        wheel.model = Model::LoadFromFile(folder + entry.value("file", std::string()));
        const auto& center = entry["center"];
        wheel.center = {center[0].get<float>(), center[1].get<float>(), center[2].get<float>()};
        wheel.radius = entry.value("radius", 0.4f);
        wheel.axle = entry.value("axle", 0);
        wheel.front = entry.value("front", false);
        wheel.section = entry.value("section", -1);
        bus.groundY = std::min(bus.groundY, wheel.center.y - wheel.radius);
        if (wheel.model) bus.wheels.push_back(std::move(wheel));
    }
    if (info.contains("sign")) {
        const auto& sign = info["sign"];
        bus.signTexture = Texture::LoadCached(folder + sign.value("file", std::string()), false);
        bus.signColumns = std::max(1.0f, sign.value("columns", 1.0f));
        const float window = sign.value("window", 64.0f) / bus.signColumns;
        std::vector<Vertex> vertices;
        std::vector<uint32_t> indices;
        const auto& points = sign["points"];
        const size_t count = points.size();
        for (size_t i = 0; i < count; ++i) {
            const auto& p = points[i];
            const float u = window * static_cast<float>(i) / static_cast<float>(count - 1);
            for (int row = 0; row < 2; ++row) {   // 0: borde inferior, 1: borde superior (la fila 0 de la imagen es la de arriba)
                Vertex vertex;
                vertex.position = {p[row * 3].get<float>(), p[row * 3 + 1].get<float>(), p[row * 3 + 2].get<float>()};
                vertex.normal = {0.0f, 0.0f, 1.0f};
                vertex.uv = {u, row == 0 ? 1.0f : 0.0f};
                vertices.push_back(vertex);
            }
            if (i > 0) {
                const uint32_t a = static_cast<uint32_t>(2 * (i - 1));
                indices.insert(indices.end(), {a, a + 2, a + 3, a, a + 3, a + 1});
            }
        }
        if (vertices.size() >= 4 && bus.signTexture) bus.signMesh = std::make_shared<Mesh>(vertices, indices);
    }
    if (info.contains("driver")) {
        const auto& driver = info["driver"]["pos"];
        bus.driver = {{driver[0].get<float>(), driver[1].get<float>(), driver[2].get<float>()}, info["driver"].value("yaw", 0.0f)};
        bus.hasDriver = true;
    }
    for (const auto& entry : info.value("standing", nlohmann::json::array())) {
        const auto& pos = entry["pos"];
        bus.standing.push_back({{pos[0].get<float>(), pos[1].get<float>(), pos[2].get<float>()}, entry.value("yaw", 0.0f)});
    }
    if (!bus.valid()) {
        LogWarn("No se pudo cargar el bus articulado de {}", folder);
        return false;
    }
    m_ArticulatedBus = std::move(bus);
    LogInfo("Bus articulado: {} secciones, {} ruedas ({})", sectionCount, m_ArticulatedBus.wheels.size(), folder);
    return true;
}

void Simulation::DrawArticulatedBus(Renderer& renderer, const BusState& bus, size_t busIndex, float opacity, float time, const glm::vec3& focus) const {
    const ArticulatedBus& model = m_ArticulatedBus;
    const int alphaMode = opacity < 1.0f ? 2 : -1;   // -1: cada pieza usa su propio modo (el vidrio es translucido)
    const glm::vec4 tint(1.0f, 1.0f, 1.0f, opacity);
    std::vector<glm::mat4> placement(model.sections.size());
    float frontYaw = 0.0f;
    for (size_t index = 0; index < model.sections.size(); ++index) {
        // cada seccion se ancla al eje del carril a la distancia que le corresponde desde el centro del bus (+ hacia el frente)
        const float ahead = (model.reference[index] - model.centerZ) * model.scale;
        const float z = bus.position.z + bus.direction * ahead;
        const glm::vec3 position(Viaduct::BusPathX(z, bus.laneX), Viaduct::Height(z), z);
        const glm::vec2 heading = Viaduct::BusHeading(z, bus.laneX, bus.direction);
        const float yaw = std::atan2(-heading.x, -heading.y);
        if (index == 0) frontYaw = yaw;
        glm::mat4 root = glm::translate(glm::mat4(1.0f), position);
        root = glm::rotate(root, yaw, glm::vec3(0.0f, 1.0f, 0.0f));
        root = glm::rotate(root, std::atan(bus.direction * Viaduct::Slope(z)), glm::vec3(1.0f, 0.0f, 0.0f));
        root = glm::scale(root, glm::vec3(model.scale));
        root = glm::rotate(root, glm::pi<float>(), glm::vec3(0.0f, 1.0f, 0.0f));   // el frente del modelo es +Z; el del bus, -Z
        placement[index] = glm::translate(root, glm::vec3(0.0f, -model.groundY, -model.reference[index]));
        if (index > 0) {
            // las secciones se unen por la articulacion: el extremo de esta coincide con el de la anterior
            const glm::vec4 joint(0.0f, 0.0f, model.pivotZ[index - 1], 1.0f);
            const glm::vec3 gap = glm::vec3(placement[index - 1] * joint) - glm::vec3(placement[index] * joint);
            placement[index] = glm::translate(glm::mat4(1.0f), gap) * placement[index];
        }
        model.sections[index]->Draw(renderer, placement[index], tint, 0.0f, false, 0, alphaMode);
    }
    // Fuelles: acordeon flexible. Se deforma entre las dos secciones por mezcla de huesos: el extremo delantero sigue a la seccion
    // de delante, el trasero a la de atras y el centro gira la mitad; asi se estira por fuera de la curva, se comprime por dentro
    // y acompana la pendiente sin cortes.
    for (size_t index = 0; index + 1 < model.sections.size(); ++index) {
        if (!model.bellows[index]) continue;
        const glm::mat4& front = placement[index];
        const glm::mat4& rear = placement[index + 1];
        const glm::vec3 pivot(0.0f, 0.0f, model.pivotZ[index]);
        const glm::vec3 pivotWorld = glm::vec3(front * glm::vec4(pivot, 1.0f));
        const glm::quat frontRotation = glm::quat_cast(glm::mat3(front) * (1.0f / model.scale));
        const glm::quat rearRotation = glm::quat_cast(glm::mat3(rear) * (1.0f / model.scale));
        glm::mat4 middle = glm::translate(glm::mat4(1.0f), pivotWorld) * glm::mat4_cast(glm::slerp(frontRotation, rearRotation, 0.5f));
        middle = glm::scale(middle, glm::vec3(model.scale));
        middle = glm::translate(middle, -pivot);
        const std::vector<glm::mat4> skin{front, middle, rear};
        for (const ModelPart& part : model.bellows[index]->GetParts()) {
            if (part.texture) part.texture->BindUnit(0);
            renderer.Submit(*part.mesh, glm::mat4(1.0f), tint * part.baseColor, static_cast<bool>(part.texture), part.doubleSided, &skin,
                            alphaMode >= 0 ? alphaMode : part.alphaMode, part.alphaCutoff, part.specularTexture.get());
        }
    }
    // letrero LED: el texto corre de derecha a izquierda; cada bus va en un punto distinto de la tira
    if (model.signMesh && model.signTexture) {
        const float offset = std::fmod(time * 14.0f / model.signColumns + static_cast<float>(busIndex) * 0.37f, 1.0f);   // 14 columnas por segundo
        model.signTexture->BindUnit(0);
        renderer.SetUnlit(true);
        renderer.SetUvOffset({offset, 0.0f});
        renderer.Submit(*model.signMesh, placement[0], tint, true, true, nullptr, opacity < 1.0f ? 2 : 0);
        renderer.SetUvOffset({0.0f, 0.0f});
        renderer.SetUnlit(false);
    }
    // direccion: el primer eje vira hacia donde va el eje del carril unos metros mas adelante
    const float lookZ = bus.position.z + bus.direction * ((model.reference[0] - model.centerZ) * model.scale + 5.0f);
    const glm::vec2 lookHeading = Viaduct::BusHeading(lookZ, bus.laneX, bus.direction);
    const float steer = std::clamp(std::remainder(std::atan2(-lookHeading.x, -lookHeading.y) - frontYaw, glm::two_pi<float>()) * 2.0f, -0.5f, 0.5f);
    for (const ArticulatedBus::Wheel& wheel : model.wheels) {
        const size_t section = wheel.section >= 0 ? static_cast<size_t>(wheel.section) : (wheel.axle <= 1 ? 0 : (wheel.axle == 2 ? 1 : 2));
        const float roll = bus.wheelRotation * 0.5f / (wheel.radius * model.scale);   // wheelRotation avanza distancia / 0,5 m
        glm::mat4 motion = glm::translate(placement[section], wheel.center);
        if (wheel.front) motion = glm::rotate(motion, steer, glm::vec3(0.0f, 1.0f, 0.0f));
        motion = glm::rotate(motion, roll, glm::vec3(1.0f, 0.0f, 0.0f));
        motion = glm::translate(motion, -wheel.center);
        wheel.model->Draw(renderer, motion, tint, 0.0f, false, 0, alphaMode);
    }
    // Ocupantes: solo si el bus esta cerca de la camara (cada uno es un personaje animado completo)
    if (opacity < 1.0f || m_PedestrianAppearances.empty()) return;
    if (glm::distance(glm::vec2(bus.position.x, bus.position.z), glm::vec2(focus.x, focus.z)) > 38.0f) return;
    const auto drawOccupant = [&](const ArticulatedBus::Occupant& occupant, size_t slot, bool seated) {
        const uint32_t hash = static_cast<uint32_t>((slot + 1) * 2654435761u) ^ static_cast<uint32_t>((busIndex + 3) * 40503u);
        const PedestrianAppearance& appearance = m_PedestrianAppearances[(hash >> 7) % m_PedestrianAppearances.size()];
        size_t section = model.pivotZ.size();   // por defecto la ultima; la primera articulacion que queda por detras decide la seccion
        for (size_t k = 0; k < model.pivotZ.size(); ++k) if (occupant.position.z > model.pivotZ[k]) { section = k; break; }
        glm::mat4 person = glm::translate(placement[section], occupant.position);
        person = glm::scale(person, glm::vec3(1.0f / model.scale));      // personajes en metros
        person = glm::rotate(person, occupant.yaw, glm::vec3(0.0f, 1.0f, 0.0f));
        person = glm::scale(person, glm::vec3(0.95f));
        if (seated) person = glm::translate(person, glm::vec3(0.0f, -0.93f, 0.0f));   // cadera a la altura del asiento
        const float phase = static_cast<float>(hash & 255u) * 0.0371f;
        const int clip = seated ? appearance.sitClip : (((hash >> 3) & 1u) && appearance.relaxedClip >= 0 ? appearance.relaxedClip : appearance.idleClip);
        for (const auto& part : appearance.parts) {
            if (part) part->Draw(renderer, person, glm::vec4(1.0f), time + phase, clip >= 0, clip, -1, seated);
        }
    };
    if (model.hasDriver) drawOccupant(model.driver, 0, true);
    for (size_t slot = 0; slot < model.standing.size(); ++slot) {
        const uint32_t fill = static_cast<uint32_t>((slot + 1) * 2246822519u) ^ static_cast<uint32_t>((busIndex + 7) * 3266489917u);
        if ((fill >> 9) % 100u < 55u) drawOccupant(model.standing[slot], slot + 1, false);
    }
}

// Pose fisica del carro: modelo de bicicleta con el eje trasero como referencia. La ruta (centro del carro) marca el punto que se
// persigue unos metros adelante; el rumbo y la posicion dibujados salen de integrar el modelo, asi las llantas traseras no
// derrapan y la direccion gira con suavidad al entrar y salir de las esquinas.
static void StepVehicleKinematics(TrafficVehicle& vehicle, float dt) {
    if (vehicle.parked || vehicle.route.empty() || vehicle.routeLength < 1.0f) return;
    BicycleParams params;
    params.wheelbase = std::max(1.2f, vehicle.wheelbase);
    if (vehicle.emergency == 3) params.maxSteer = 0.5f;   // la moto
    const glm::vec2 reference(vehicle.position.x, vehicle.position.z);
    const glm::vec2 referenceDirection(vehicle.direction.x, vehicle.direction.z);
    // salto de la ruta (cambio de circuito, reaparicion): se vuelve a colocar sobre la ruta
    if (!vehicle.bike.ready || glm::distance(vehicle.bike.Center(params), reference) > 2.5f) {
        ResetBicycle(vehicle.bike, params, reference, referenceDirection);
        return;
    }
    const float lookahead = std::clamp(1.0f + 0.55f * vehicle.speed, 1.8f, 4.5f);
    glm::vec3 targetPosition, targetDirection;
    size_t waypoint = vehicle.nextWaypoint;
    SampleCircuit(vehicle.route, vehicle.routeCumulative, vehicle.routeLength, vehicle.distance + lookahead,
                  targetPosition, targetDirection, waypoint);
    const glm::vec2 target(targetPosition.x, targetPosition.z);
    // curvatura de la ruta unos decimos de segundo adelante (el yaw responde al instante a la direccion: basta el retardo del volante)
    float routeCurvature = 0.0f;
    {
        const float preview = 0.35f + 0.12f * vehicle.speed;
        glm::vec3 pa, da, pb, db;
        size_t w = vehicle.nextWaypoint;
        SampleCircuit(vehicle.route, vehicle.routeCumulative, vehicle.routeLength, vehicle.distance + preview - 0.3f, pa, da, w);
        SampleCircuit(vehicle.route, vehicle.routeCumulative, vehicle.routeLength, vehicle.distance + preview + 0.3f, pb, db, w);
        routeCurvature = std::remainder(std::atan2(db.z, db.x) - std::atan2(da.z, da.x), 6.2831853f) / 0.6f;
    }
    (void)target;
    const glm::vec2 center = vehicle.bike.Center(params);
    const glm::vec2 forwardNow = vehicle.bike.Forward();
    // la ruta va un poco adelante o atras segun el carro corte o abra la esquina: la velocidad se ajusta para no acumular desfase
    const float alongTrack = (reference.x - center.x) * forwardNow.x + (reference.y - center.y) * forwardNow.y;
    const float bikeSpeed = vehicle.speed <= 0.01f ? 0.0f : std::clamp(vehicle.speed + 1.5f * alongTrack, 0.4f * vehicle.speed, 1.6f * vehicle.speed + 0.3f);
    StepBicycle(vehicle.bike, params, bikeSpeed, TrackingSteer(vehicle.bike, params, reference, referenceDirection, routeCurvature, vehicle.speed), dt);
    // corrige la deriva lenta hacia la ruta (sin cambiar el rumbo): el centro nunca queda a mas de ~0,4 m
    const glm::vec2 offset = reference - vehicle.bike.Center(params);
    const float error = glm::length(offset);
    if (error > 5.0f) vehicle.bike.rear += offset * ((error - 5.0f) / error);
}

Simulation::Simulation(const CityLayout& city, uint32_t seed,
                       ModelLoadProgress modelLoadProgress)
    : m_City(city), m_Random(seed) {
    m_PedestrianBody = Mesh::CreateCube({0.34f, 1.05f, 0.25f}, {0.48f, 0.34f, 0.25f, 1.0f});
    m_BloodMesh = Mesh::CreateCylinder(1.0f, 1.0f, 20, {0.26f, 0.01f, 0.015f, 1.0f});   // charco de sangre de los peatones muertos
    m_PedestrianHead = Mesh::CreateCube({0.24f, 0.25f, 0.24f}, {0.62f, 0.46f, 0.34f, 1.0f});
    std::string modelsRoot;
    {
        std::string animationFile = Paths::Find("public/models/animaciones-cpp.glb");
        if (!std::filesystem::exists(animationFile)) animationFile = Paths::Find("public/models/animaciones-actionforge.glb");
        if (!std::filesystem::exists(animationFile)) animationFile = Paths::Find("public/models/animaciones-prueba.glb");
        if (std::filesystem::exists(animationFile)) modelsRoot = std::filesystem::path(animationFile).parent_path().generic_string() + "/";
    }
    if (!modelsRoot.empty()) {
        std::vector<std::vector<std::string>> outfits{
            {"hombre-joven", "chaqueta", "tenis-rotos", "corto"},
            {"hombre-joven", "buzo", "tenis", "crespo"},
            {"hombre-adulto", "buzo", "zapatos", "desordenado"},
            {"hombre-adulto", "camisa", "botas", "largo"},
            {"hombre-mayor", "saco", "botas", "rapado"},
            {"hombre-mayor", "overol", "tenis", "candado"},
            {"mujer-joven", "sudadera", "tenis", "largo"},
            {"mujer-joven", "blusa", "botas", "crespo"},
            {"mujer-adulta", "blusa", "tenis", "corto"},
            {"mujer-adulta", "sudadera", "botas", "melena"},
            {"mujer-mayor", "saco", "botas", "melena"},
            {"mujer-mayor", "sudadera", "tenis-rotos", "rapado"}
        };
        // Variedad de peatones (randomStreetLook del original): cada uno combina ropa, calzado, pelo, barba y sombrero del catalogo del
        // personaje segun su sexo y edad. Los doce primeros conjuntos se conservan (los usan la mision, el dealer y los vendedores);
        // 12 combinaciones normales y 8 gastadas para El Cartucho (ropa rota, tenis rotos, barba descuidada, gorro de lana) se generan
        // con una semilla fija y solo se cargan los archivos que existan.
        const size_t baseOutfitCount = outfits.size();
        std::vector<bool> wornOutfit(baseOutfitCount, false);
        {
            std::mt19937 outfitRandom(20261027u);
            const std::array<const char*, 6> bodies{"hombre-joven", "hombre-adulto", "hombre-mayor", "mujer-joven", "mujer-adulta", "mujer-mayor"};
            const auto pick = [&](const std::vector<std::string>& options) { return options[outfitRandom() % options.size()]; };
            const auto available = [&](const std::string& body, std::vector<std::string> names) {
                std::vector<std::string> found;
                for (const std::string& name : names)
                    if (std::filesystem::exists(modelsRoot + "personaje/" + body + "/" + name + ".gltf")) found.push_back(name);
                return found;
            };
            for (int index = 0; index < 20; ++index) {
                const bool worn = index >= 12;
                const std::string body = bodies[outfitRandom() % bodies.size()];
                const bool man = body.starts_with("hombre");
                std::vector<std::string> clothes = available(body, man
                    ? std::vector<std::string>{"chaqueta", "rayas", "camisa", "buzo", "camiseta", "overol", "saco"}
                    : std::vector<std::string>{"blusa", "short", "sudadera", "saco"});
                std::vector<std::string> shoes = available(body, {"tenis", "zapatos", "botas"});
                std::vector<std::string> hair = available(body, {"rapado", "corto", "desordenado", "crespo", "largo", "cola", "melena"});
                if (worn) {
                    const auto old = available(body, {"rota"});
                    if (!old.empty()) clothes = old;
                    shoes = available(body, {"tenis-rotos", "botas"});
                }
                if (clothes.empty() || shoes.empty() || hair.empty()) continue;
                std::vector<std::string> outfit{body, pick(clothes), pick(shoes), pick(hair)};
                outfit.push_back("");
                if (man) {
                    const auto beards = available(body, worn ? std::vector<std::string>{"descuidada", "larga", "bigote"} : std::vector<std::string>{"bigote", "candado", "descuidada"});
                    if (!beards.empty() && (worn || outfitRandom() % 100 < 45)) outfit.back() = "D:" + pick(beards);
                }
                const auto hats = available(body, worn ? std::vector<std::string>{"gorro-lana", "boina"} : std::vector<std::string>{"boina", "gorro-lana"});
                if (!hats.empty() && outfitRandom() % 100 < (worn ? 60 : 30)) outfit.push_back("T:" + pick(hats));
                outfits.push_back(std::move(outfit));
                wornOutfit.push_back(worn);
            }
        }
        const std::array<std::string, 8> importedFiles{{
            "vehiculo1.opt.glb", "vehiculo2.opt.glb", "tm.opt.glb", "cambuche.opt.glb",
            "bolsa.opt.glb", "contenedor.opt.glb", "lamparas.opt.glb", "semaforo.opt.glb"
        }};
        const size_t totalModelLoads = 1 + outfits.size() * 5 + importedFiles.size() + 12;
        size_t completedModelLoads = 0;
        const auto reportModelLoad = [&](const std::string& name = "") {
            if (modelLoadProgress) modelLoadProgress(++completedModelLoads, totalModelLoads, name);
        };

        std::string animationPath = modelsRoot + "animaciones-cpp.glb";
        if (!std::filesystem::exists(animationPath)) animationPath = modelsRoot + "animaciones-actionforge.glb";
        if (!std::filesystem::exists(animationPath)) animationPath = modelsRoot + "animaciones-prueba.glb";
        m_PedestrianAnimation = Model::LoadFromFile(animationPath);
        reportModelLoad("Animaciones de peatones (ActionForge)");

        std::unordered_map<std::string, std::shared_ptr<Model>> modelCache;
        for (const auto& outfit : outfits) {
            PedestrianAppearance appearance;
            appearance.worn = wornOutfit[static_cast<size_t>(&outfit - outfits.data())];
            for (size_t partIndex = 0; partIndex < outfit.size(); ++partIndex) {
                std::string partName = outfit[partIndex];
                char role = partIndex == 0 ? 'B' : partIndex == 1 ? 'C' : partIndex == 2 ? 'S' : partIndex == 3 ? 'H' : 'X';
                if (partName.size() > 2 && partName[1] == ':') { role = partName[0]; partName = partName.substr(2); }
                if (partName.empty()) continue;
                appearance.roles.push_back(role);
                const std::string filename = partIndex == 0 ? "cuerpo.gltf" : partName + ".gltf";
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
                if (model && (role == 'C' || role == 'S')) model->SetPushOut(0.008f);   // la ropa y el calzado no dejan pasar la piel
                appearance.parts.push_back(std::move(model));
                reportModelLoad();
            }
            if (!appearance.parts.empty() && appearance.parts.front()) {
                appearance.idleClip = appearance.parts.front()->FindAnimationClip("Idle");
                appearance.walkClip = appearance.parts.front()->FindAnimationClip("Walk");
                appearance.sitClip = appearance.idleClip;
                appearance.runClip = appearance.parts.front()->FindAnimationClip("Run");
                appearance.relaxedClip = appearance.parts.front()->FindAnimationClip("IdleRelaxed");
                appearance.hitFaceClip = appearance.parts.front()->FindAnimationClip("HitFace");
                appearance.hitChestClip = appearance.parts.front()->FindAnimationClip("HitChest");
                appearance.hitLegsClip = appearance.parts.front()->FindAnimationClip("HitLegs");
                appearance.fallClip = appearance.parts.front()->FindAnimationClip("FallBack");
                appearance.lyingClip = appearance.parts.front()->FindAnimationClip("LyingLoop");
                appearance.getUpClip = appearance.parts.front()->FindAnimationClip("GetUp");
                appearance.jabClip = appearance.parts.front()->FindAnimationClip("PunchJab");
                appearance.crossClip = appearance.parts.front()->FindAnimationClip("PunchCross");
                m_PedestrianAppearances.push_back(std::move(appearance));
            }
        }
        {   // vehiculos de emergencia (Blender: reducidos a ~24 mil triangulos y textura de 1024 px). El frente local del juego es +X.
            struct EmergencySpec { const char* file; glm::vec3 size; float yaw; };
            const std::array<EmergencySpec, 3> specs{{
                {"ambulancia.opt.glb", {5.5f, 2.5f, 2.4f}, glm::half_pi<float>()},
                {"vehiculo_policia.opt.glb", {4.4f, 1.9f, 2.1f}, 0.0f},
                {"moto_policia.opt.glb", {2.1f, 1.3f, 0.74f}, -glm::half_pi<float>()}}};
            for (size_t index = 0; index < specs.size(); ++index) {
                const std::string path = modelsRoot + specs[index].file;
                if (std::filesystem::exists(path)) m_EmergencyModels[index] = Model::LoadFromFile(path);
                else LogWarn("No se encontro el vehiculo de emergencia: {}", path);
                if (m_EmergencyModels[index]) m_EmergencyFits[index] = FitModelTransform(*m_EmergencyModels[index], specs[index].size, specs[index].yaw);
                reportModelLoad(specs[index].file);
            }
        }
        LoadArticulatedBus(modelsRoot);
        m_VehicleParts[0] = LoadVehicleParts(modelsRoot, "vehiculo1");
        m_VehicleParts[1] = LoadVehicleParts(modelsRoot, "vehiculo2");
        m_VehicleParts[2] = LoadVehicleParts(modelsRoot, "ambulancia");
        m_VehicleParts[3] = LoadVehicleParts(modelsRoot, "vehiculo_policia");
        m_VehicleParts[4] = LoadVehicleParts(modelsRoot, "moto_policia");
        static const std::array<const char*, kCabinVariants> kCabinModels{{"raptor", "renault6", "jetta", "mercedes", "modelx", "crafter", "hilux"}};
        for (size_t variant = 0; variant < kCabinVariants; ++variant) {
            const std::string name = kCabinModels[variant];
            const bool restricted = name == "raptor" || name == "renault6" || name == "modelx";   // sin permiso de redistribucion
            if (restricted && !RestrictedModelsEnabled()) continue;                                // la variante queda sin modelo y no se sortea
            m_VehicleParts[5 + variant] = LoadVehicleParts(modelsRoot, kCabinModels[variant]);
        }
        if (!RestrictedModelsEnabled())
            LogInfo("Modelos sin permiso de redistribucion excluidos (Pitbull, Raptor, Renault 6, Model X, Transmilenio articulado); BAZUKO_MODELOS_RESTRINGIDOS=1 los activa si tienes copias con licencia.");
        for (size_t index = 0; index < importedFiles.size(); ++index) {
            const std::string path = modelsRoot + importedFiles[index];
            std::shared_ptr<Model> model;
            if (std::filesystem::exists(path)) model = Model::LoadFromFile(path);
            else LogWarn("No se encontro el modelo nativo: {}", path);
            switch (index) {
                case 0:
                    m_CarModel = std::move(model);
                    if (m_CarModel) m_CarModelFit = FitModelTransform(*m_CarModel, {4.5f, 2.0f, 2.19f}, glm::half_pi<float>());
                    break;
                case 1:
                    m_TaxiModel = std::move(model);
                    if (m_TaxiModel) m_TaxiModelFit = FitModelTransform(*m_TaxiModel, {4.5f, 1.58f, 2.02f}, glm::half_pi<float>());
                    break;
                case 2:
                    m_BusModel = std::move(model);
                    if (m_BusModel) m_BusModelFit = FitModelTransform(*m_BusModel, {kBusWidth, 3.5f, kBusLength}, -glm::half_pi<float>());
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
        m_TreeModel = Model::LoadFromFile(modelsRoot + "Arbol 1/FBX format/conifer_macedonian_pine.fbx");
        if (m_TreeModel)
            m_TreeModelFit = FitModelTransform(*m_TreeModel, {2.8f, 5.4f, 2.8f}, 0.0f, true);
        reportModelLoad("Vegetación: Pino macedonio FBX");
        m_VendorChairModel = Model::LoadFromFile(
            modelsRoot + "Silla plastica/plastic+chair.obj", "Chair_lv_1");
        if (m_VendorChairModel)
            m_VendorChairModelFit = FitModelTransform(*m_VendorChairModel, {0.54f, 0.74f, 0.52f}, 0.0f, true);
        reportModelLoad("Mobiliario: Silla plástica");
        m_GrassModel = Model::LoadFromFile(modelsRoot + "pasto.fbx");
        if (m_GrassModel)
            m_GrassModelFit = FitModelTransform(*m_GrassModel, {1.9f, 0.52f, 1.9f}, 0.0f, true);
        reportModelLoad("Vegetación: Pasto FBX");
        // Piezas separadas del ave (hechas en Blender a partir del modelo): cuerpo, ala I interior/exterior, ala D interior/exterior
        const auto loadBirdParts = [&](size_t bird, const std::string& stem) {
            static const char* suffixes[kBirdPartCount] = {"_body", "_head", "_legL", "_legR", "_L_in", "_L_out", "_R_in", "_R_out"};
            bool complete = true;
            for (size_t part = 0; part < kBirdPartCount; ++part) {
                m_BirdParts[bird][part] = Model::LoadFromFile(modelsRoot + stem + suffixes[part] + ".gltf");
                complete = complete && m_BirdParts[bird][part];
            }
            if (!complete) for (auto& part : m_BirdParts[bird]) part.reset();
        };
        m_BirdModels[0] = Model::LoadFromFile(modelsRoot + "Ave 1/Woodpecker.gltf");
        if (m_BirdModels[0])
            m_BirdModelFits[0] = FitModelTransform(*m_BirdModels[0], {0.42f, 0.18f, 0.30f}, 0.0f, true);
        loadBirdParts(0, "Ave 1/Woodpecker");
        reportModelLoad("Fauna: Ave carpintero GLTF");
        m_BirdModels[1] = Model::LoadFromFile(modelsRoot + "Ave 2/Seagull.gltf");
        if (m_BirdModels[1])
            m_BirdModelFits[1] = FitModelTransform(*m_BirdModels[1], {0.72f, 0.22f, 0.38f}, 0.0f, true);
        loadBirdParts(1, "Ave 2/Seagull");
        reportModelLoad("Fauna: Ave gaviota GLTF");
        m_RatModel = Model::LoadFromFile(modelsRoot + "Rata/Rat.gltf");
        if (m_RatModel)
            m_RatModelFit = FitModelTransform(*m_RatModel, {0.20f, 0.14f, 0.54f}, 0.0f, true);
        reportModelLoad("Fauna: Rata urbana GLTF");
        m_PetModel = Model::LoadFromFile(modelsRoot + "mascota.fbx");
        if (m_PetModel)
            m_PetModelFit = glm::translate(glm::mat4(1.0f), {0.0f, 0.08f, 0.0f})
                * FitModelTransform(*m_PetModel, {0.6175f, 0.507f, 0.8125f}, glm::pi<float>(), true);
        reportModelLoad("Compañero: Mascota canina (El Chato) FBX");
        m_DogModel = Model::LoadFromFile(modelsRoot + "perro.glb");
        reportModelLoad("Compañero: El Chato (perro.glb)");
        // El Labrador (kenchoo, CC BY 4.0) con animaciones propias es el perro por defecto; el Pitbull de El Chato no tiene permiso de
        // redistribucion y solo se usa con BAZUKO_MODELOS_RESTRINGIDOS=1; si no hay ninguno, perro.glb animado por codigo.
        nlohmann::json labradorInfo;
        bool labrador = false;
        if (std::ifstream infoFile(modelsRoot + "labrador.json"); infoFile) {
            try { infoFile >> labradorInfo; labrador = true; } catch (...) { labrador = false; }
        }
        const char* dogFile = labrador ? "labrador.glb" : (RestrictedModelsEnabled() ? "chato.glb" : nullptr);
        if (dogFile) {
            m_ChatoModel = Model::LoadFromFile(modelsRoot + dogFile);
            m_ChatoLibrary = Model::LoadFromFile(modelsRoot + dogFile);
        }
        if (labrador) {
            m_DogRig.tail = {"Tail2", "Tail3", "Tail4", "Tail5"};
            m_DogRig.neck = "Neck3";
            m_DogRig.head = "Head";
            m_DogRig.heightBone = "Body";
            m_DogRig.tailAxis = 2;
            m_DogRig.liftSit = m_DogRig.liftLie = m_DogRig.liftSleep = 0.0f;   // las posturas ya salen apoyadas en el suelo desde Blender
            m_DogRig.liftOther = 0.004f;
        }
        if (m_ChatoModel && m_ChatoLibrary) {
            m_ChatoModel->SetAnimationSource(*m_ChatoLibrary);
            m_ChatoModel->SetHeightBone(m_DogRig.heightBone);   // al sentarse o echarse el cuerpo baja: la traslacion de la raiz/pelvis lo anima
            DogClips& c = m_DogClips;
            const auto find = [&](const char* name) { return m_ChatoModel->FindAnimationClip(name); };
            c.idle = find("Idle"); c.idleLook = find("IdleLook"); c.idleSniff = find("IdleSniff"); c.idleAlert = find("IdleAlert");
            c.walk = find("Walk"); c.trot = find("Trot"); c.run = find("Run"); c.turnLeft = find("TurnLeft"); c.turnRight = find("TurnRight");
            c.sitStart = find("SitStart"); c.sit = find("Sit"); c.sitEnd = find("SitEnd");
            c.lieStart = find("LieStart"); c.lie = find("Lie"); c.lieEnd = find("LieEnd");
            c.sleepStart = find("SleepStart"); c.sleep = find("Sleep"); c.sleepEnd = find("SleepEnd");
            c.bowStart = find("BowStart"); c.bow = find("Bow"); c.bowEnd = find("BowEnd"); c.jump = find("Jump");
            if (c.idle < 0 || c.walk < 0) { m_ChatoModel.reset(); m_ChatoLibrary.reset(); }
            else {
                // Las patas de estas animaciones dan pasos cortos: a su ritmo natural el pie apoyado avanza solo la mitad de lo que un perro
                // de este tamano camina, trota o galopa. Se reproducen mas rapido (hasta 2,4x) para acercar la zancada a la velocidad real.
                std::array<float, 3> measured{MeasureDogGait(c.walk), MeasureDogGait(c.trot), MeasureDogGait(c.run)};
                if (labrador && labradorInfo.contains("speeds")) {   // medidas en Blender sobre el pie trasero apoyado de cada ciclo
                    const auto& speeds = labradorInfo["speeds"];
                    measured = {speeds.value("walk", 0.4f), speeds.value("trot", 1.0f), speeds.value("run", 1.5f)};
                }
                m_DogGaitSpeed = {measured[0] * 2.0f, measured[1] * 2.0f, measured[2] * 2.0f};
                LogInfo("El Chato: marcha natural {:.2f} / {:.2f} / {:.2f} m/s (caminar, trotar, correr)", m_DogGaitSpeed[0], m_DogGaitSpeed[1], m_DogGaitSpeed[2]);
            }
        }
        reportModelLoad("Compañero: El Chato animado");
        m_VendorCartModel = Model::LoadFromFile(modelsRoot + "comida rapida/food+cart.fbx");
        if (m_VendorCartModel)
            m_VendorCartModelFit = FitModelTransform(
                *m_VendorCartModel, {2.0f, 2.1f, 1.6f}, 0.0f, true);
        reportModelLoad("Puesto de comida rápida FBX");
        auto importedStreetLamp = Model::LoadFromFile(
            modelsRoot + "luminaria/street+light.fbx", {}, "Plane.002", 620.0f);
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
    {   // anillo plano (RingGeometry 1,9-2,1 del original) y un resplandor mas ancho que se desvanece hacia afuera
        const auto annulus = [](float inner, float outer, const glm::vec4& innerColor, const glm::vec4& outerColor) {
            constexpr int kSegments = 48;
            std::vector<Vertex> vertices;
            std::vector<uint32_t> indices;
            for (int i = 0; i < kSegments; ++i) {
                const float angle = glm::two_pi<float>() * static_cast<float>(i) / static_cast<float>(kSegments);
                const float c = std::cos(angle), s = std::sin(angle);
                vertices.push_back({{c * inner, 0.0f, s * inner}, {0.0f, 1.0f, 0.0f}, {0.0f, 0.0f}, innerColor});
                vertices.push_back({{c * outer, 0.0f, s * outer}, {0.0f, 1.0f, 0.0f}, {1.0f, 0.0f}, outerColor});
            }
            for (int i = 0; i < kSegments; ++i) {
                const uint32_t a = static_cast<uint32_t>(i * 2), b = static_cast<uint32_t>(((i + 1) % kSegments) * 2);
                indices.insert(indices.end(), {a, a + 1, b + 1, a, b + 1, b});
            }
            return std::make_shared<Mesh>(vertices, indices);
        };
        const glm::vec4 orange(1.0f, 0.62f, 0.06f, 1.0f);
        m_CambucheRingMesh = annulus(1.9f, 2.1f, orange, orange);
        m_CambucheGlowMesh = annulus(1.25f, 3.1f, glm::vec4(1.0f, 0.55f, 0.05f, 0.55f), glm::vec4(1.0f, 0.55f, 0.05f, 0.0f));
    }
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
    // Los circuitos salen de las bandas del mapa (cualquier numero de carreras y calles): una manzana por cada par de
    // avenidas contiguas (sin la troncal de la Caracas, que es el carril del bus). Las que tocan la Caracas se parten en
    // dos circuitos (calles 1-2 y 2-ultima); las demas recorren de la primera calle a la ultima.
    std::vector<std::array<float, 4>> routeBounds;
    std::vector<int> caracasSide;   // 0 no toca la Caracas; +1 la tiene a la derecha (oriente del circuito); -1 a la izquierda
    if (calles.size() >= 2 && !carreras.empty() && caracas.size() >= 2) {
        const float top = laneZ(calles[0].first, calles[0].last, 1);
        const float bottom = laneZ(calles[1].first, calles[1].last, -1);
        const float farBottom = laneZ(calles.back().first, calles.back().last, -1);
        const float upperMiddle = laneZ(calles[1].first, calles[1].last, 1);
        // El costado oriental ocupado por Colpatria deja de ser via de paso: los circuitos que pasan por la Caracas oriental
        // giran en la calle 8 (getTrafficRoutes del original).
        const float colpatriaTurn = laneZ(calles[std::min<size_t>(2, calles.size() - 1)].first, calles[std::min<size_t>(2, calles.size() - 1)].last, -1);
        struct Avenue { CityLayout::Band band; int caracas; };   // caracas: -1 no, 0 carril occidental, 1 carril oriental
        std::vector<Avenue> avenues;
        for (const auto& band : carreras) avenues.push_back({band, -1});
        avenues.push_back({caracas[0], 0});
        avenues.push_back({caracas[1], 1});
        std::sort(avenues.begin(), avenues.end(), [](const Avenue& a, const Avenue& b) { return a.band.first < b.band.first; });
        const auto addRoute = [&](float left, float right, float routeTop, float routeBottom, int side) {
            routeBounds.push_back({left, right, routeTop, routeBottom});
            caracasSide.push_back(side);
        };
        for (size_t i = 0; i + 1 < avenues.size(); ++i) {
            const Avenue& a = avenues[i];
            const Avenue& b = avenues[i + 1];
            if (a.caracas == 0 && b.caracas == 1) continue;   // entre los dos carriles de la Caracas va el busway
            const float left = laneX(a.band.first, a.band.last, 1);
            const float right = laneX(b.band.first, b.band.last, -1);
            const int side = b.caracas == 0 ? 1 : a.caracas == 1 ? -1 : 0;
            if (side == 0) {
                addRoute(left, right, top, farBottom, 0);
            } else {
                const float lower = side < 0 ? std::min(farBottom, colpatriaTurn) : farBottom;
                addRoute(left, right, top, bottom, side);
                addRoute(left, right, upperMiddle, side < 0 && lower < farBottom ? lower : farBottom, side);
            }
        }
    } else {
        LogWarn("El mapa no tiene las bandas de carreras, calles y Caracas necesarias para generar circuitos de trafico.");
    }
    for (size_t routeIndex = 0; routeIndex < routeBounds.size(); ++routeIndex) {
        const float left = std::min(routeBounds[routeIndex][0], routeBounds[routeIndex][1]);
        const float right = std::max(routeBounds[routeIndex][0], routeBounds[routeIndex][1]);
        const float topEdge = std::min(routeBounds[routeIndex][2], routeBounds[routeIndex][3]);
        const float bottomEdge = std::max(routeBounds[routeIndex][2], routeBounds[routeIndex][3]);
        if (caracasSide[routeIndex] == 0) continue;   // solo las manzanas que tocan la Caracas llevan semaforo

        const std::array<std::pair<glm::vec3, glm::vec3>, 2> approaches = caracasSide[routeIndex] > 0
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
        const float southEnd = static_cast<float>(CityLayout::HEIGHT - CityLayout::NORTH_ROWS - 2) * CityLayout::TILE_SIZE - kBusHalfLength;   // 308,9
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
    {   // acumulados de cada circuito y conexiones entre manzanas contiguas
        std::vector<std::array<float, 4>> boxes;   // left, right, top, bottom de cada circuito creado
        for (const auto& bounds : routeBounds) {
            const float left = std::min(bounds[0], bounds[1]), right = std::max(bounds[0], bounds[1]);
            const float top = std::min(bounds[2], bounds[3]), bottom = std::max(bounds[2], bounds[3]);
            if (right - left <= 2.0f || bottom - top <= 2.0f) continue;
            boxes.push_back({left, right, top, bottom});
        }
        m_RouteCumulative.resize(m_TrafficRoutes.size());
        for (size_t index = 0; index < m_TrafficRoutes.size(); ++index) {
            const auto& route = m_TrafficRoutes[index];
            m_RouteCumulative[index].assign(route.size(), 0.0f);
            for (size_t point = 1; point < route.size(); ++point)
                m_RouteCumulative[index][point] = m_RouteCumulative[index][point - 1] + glm::distance(route[point - 1], route[point]);
        }
        const auto distanceOnRoute = [&](size_t routeIndex, const glm::vec3& point, float& found) {
            const auto& route = m_TrafficRoutes[routeIndex];
            for (size_t i = 0; i < route.size(); ++i) {
                const glm::vec3 a = route[i], b = route[(i + 1) % route.size()];
                const glm::vec3 ab = b - a;
                const float lengthSquared = glm::dot(ab, ab);
                if (lengthSquared < 1.0e-8f) continue;
                const float t = glm::dot(point - a, ab) / lengthSquared;
                if (t < 0.0f || t > 1.0f) continue;
                if (glm::distance(point, a + ab * t) < 0.06f) { found = m_RouteCumulative[routeIndex][i] + std::sqrt(lengthSquared) * t; return true; }
            }
            return false;
        };
        // bordes rectos de cada circuito (esquinas de `CircuitRadius`): inicio, fin y sentido de la marcha
        struct Edge { glm::vec3 start, end, direction; };
        const auto edgesOf = [](const std::array<float, 4>& box) {
            const float l = box[0], r = box[1], t = box[2], b = box[3], k = CircuitRadius(l, r, t, b);
            return std::array<Edge, 4>{{{{l + k, 0, t}, {r - k, 0, t}, {1, 0, 0}}, {{r, 0, t + k}, {r, 0, b - k}, {0, 0, 1}},
                                       {{r - k, 0, b}, {l + k, 0, b}, {-1, 0, 0}}, {{l, 0, b - k}, {l, 0, t + k}, {0, 0, -1}}}};
        };
        m_RouteBranches.assign(m_TrafficRoutes.size(), {});
        constexpr float kMaxGap = 14.0f;   // no se cruza la troncal: el carril exclusivo del bus queda libre
        for (size_t a = 0; a < boxes.size() && a < m_TrafficRoutes.size(); ++a) {
            for (size_t b = 0; b < boxes.size() && b < m_TrafficRoutes.size(); ++b) {
                if (a == b) continue;
                for (const Edge& ea : edgesOf(boxes[a])) {
                    for (const Edge& eb : edgesOf(boxes[b])) {
                        if (glm::dot(ea.direction, eb.direction) < 0.99f) continue;
                        const glm::vec3 across = glm::vec3(ea.direction.z, 0.0f, -ea.direction.x);
                        if (std::abs(glm::dot(eb.start - ea.end, across)) > 0.05f) continue;   // misma linea
                        const float gap = glm::dot(eb.start - ea.end, ea.direction);
                        float fromDistance = 0.0f, toDistance = 0.0f;
                        if (gap > 0.5f && gap <= kMaxGap) {
                            // tramo recto entre el fin de una manzana y el inicio de la siguiente
                            if (!distanceOnRoute(a, ea.end, fromDistance) || !distanceOnRoute(b, eb.start, toDistance)) continue;
                            m_RouteBranches[a].push_back({fromDistance, b, toDistance, gap, ea.end, eb.start});
                        } else if (gap <= 0.5f && gap >= -80.0f) {
                            // los dos circuitos comparten el carril: se pasa al otro donde empieza su borde
                            const glm::vec3 joinPoint = eb.start;
                            if (glm::dot(joinPoint - ea.start, ea.direction) < 0.5f || glm::dot(ea.end - joinPoint, ea.direction) < 2.0f) continue;
                            if (!distanceOnRoute(a, joinPoint, fromDistance) || !distanceOnRoute(b, joinPoint, toDistance)) continue;
                            m_RouteBranches[a].push_back({fromDistance, b, toDistance, 0.0f, joinPoint, joinPoint});
                        }
                    }
                }
            }
        }
        size_t branchCount = 0;
        for (const auto& list : m_RouteBranches) branchCount += list.size();
        LogInfo("Circuitos de trafico: {}; conexiones entre manzanas: {}", m_TrafficRoutes.size(), branchCount);
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
            // tres de los carros del tráfico son de emergencia: ambulancia, patrulla y moto de policia
            if (m_Traffic.size() == 5 || m_Traffic.size() == 11 || m_Traffic.size() == 17) {
                const int kind = m_Traffic.size() == 5 ? 1 : m_Traffic.size() == 11 ? 2 : 3;
                if (m_EmergencyModels[static_cast<size_t>(kind - 1)]) {
                    vehicle.emergency = kind;
                    vehicle.taxi = false;
                    vehicle.mirrorsAvailable = false;
                    vehicle.length = kind == 1 ? 5.5f : kind == 2 ? 4.4f : 2.1f;
                    vehicle.width = kind == 1 ? 2.4f : kind == 2 ? 2.1f : 0.9f;
                    vehicle.cruiseSpeed = 3.0f + m_Unit(m_Random) * 1.0f;
                }
            }
            AssignVehicleModel(vehicle);
            vehicle.driver.appearance = static_cast<size_t>(m_Unit(m_Random) * 1000.0f);
            vehicle.driver.color = {0.22f + m_Unit(m_Random) * 0.55f, 0.18f + m_Unit(m_Random) * 0.48f, 0.15f + m_Unit(m_Random) * 0.42f};
            vehicle.driver.shade = m_Unit(m_Random) * 2.0f;
            if (vehicle.variant > 0 && vehicle.emergency == 0 && (m_Unit(m_Random) < 0.35f || std::getenv("BAZUKO_FORCE_PASSENGER"))) {
                vehicle.driver.hasPassenger = true;   // acompanante en el asiento delantero
                vehicle.driver.passengerAppearance = static_cast<size_t>(m_Unit(m_Random) * 1000.0f);
                vehicle.driver.passengerColor = {0.22f + m_Unit(m_Random) * 0.55f, 0.18f + m_Unit(m_Random) * 0.48f, 0.15f + m_Unit(m_Random) * 0.42f};
                vehicle.driver.passengerShade = m_Unit(m_Random) * 2.0f;
            }
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
            AssignVehicleModel(parked);
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
    BuildPropColliders();
    BuildBirdSpots();
}

void Simulation::BuildPropColliders() {
    m_PropColliders.clear();
    const auto circle = [&](float x, float z, float radius) { m_PropColliders.push_back({{x, z}, {radius, radius}, 1.0f, 0.0f, false}); };
    const auto box = [&](float x, float z, float halfWidth, float halfDepth, float yaw) {
        m_PropColliders.push_back({{x, z}, {halfWidth, halfDepth}, std::cos(yaw), std::sin(yaw), true});
    };
    for (const glm::vec3& tree : m_TreePositions) circle(tree.x, tree.z, 0.22f);                 // el tronco; la copa queda por encima de la cabeza
    for (const StreetLamp& lamp : m_StreetLamps) circle(lamp.position.x, lamp.position.z, 0.16f);
    for (const TrafficSignal& signal : m_TrafficSignals) circle(signal.polePosition.x, signal.polePosition.z, 0.16f);
    for (const StreetVendor& vendor : m_StreetVendors) {
        const float yaw = std::atan2(vendor.facing.x, vendor.facing.z);   // el mostrador mira hacia `facing`; el vendedor queda detras
        box(vendor.position.x, vendor.position.z, 0.62f, 0.40f, yaw);
    }
    box(m_RecyclerPosition.x, m_RecyclerPosition.z, 0.80f, 0.55f, 0.0f);
}

bool Simulation::HitsProp(float x, float z, float radius) const {
    for (const PropCollider& prop : m_PropColliders) {
        const float dx = x - prop.center.x, dz = z - prop.center.y;
        const float reach = std::max(prop.half.x, prop.half.y) + radius;
        if (std::abs(dx) > reach || std::abs(dz) > reach) continue;
        if (!prop.box) {
            const float r = prop.half.x + radius;
            if (dx * dx + dz * dz < r * r) return true;
            continue;
        }
        // al espacio local de la caja (la rotacion en Y es la de glm: x' = x*c + z*s, z' = -x*s + z*c)
        const float lx = dx * prop.cosYaw - dz * prop.sinYaw;
        const float lz = dx * prop.sinYaw + dz * prop.cosYaw;
        const float cx = std::clamp(lx, -prop.half.x, prop.half.x), cz = std::clamp(lz, -prop.half.y, prop.half.y);
        const float ex = lx - cx, ez = lz - cz;
        if (ex * ex + ez * ez < radius * radius) return true;
    }
    return false;
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
    m_DogHappy = 1.0f;   // mueve la cola mas rapido y da un salto
    m_DogHop = 0.0f;
    return true;
}

void Simulation::BeginPet(const glm::vec3& playerPosition, float playerYaw) {
    if (!m_DogIsFriend) return;
    m_DogPetting = true;
    m_DogPetStage = 1;
    m_DogPetPlayer = playerPosition;
    m_DogPetAnchor = playerPosition + glm::vec3(std::sin(playerYaw), 0.0f, std::cos(playerYaw)) * 0.78f;
    m_DogPetAnchor.y = 0.0f;
    m_DogQueue.clear();
}

void Simulation::EndPet() {
    if (!m_DogPetting) return;
    // celebra: se pone de pie, hace la reverencia de juego (cola y cuerpo contentos) y, casi siempre, da un salto
    m_DogPetStage = 4;
    m_DogQueue.clear();
    m_DogQueueLoop = 0.0f;
    if (m_ChatoModel) {
        m_DogQueue.push_back({m_DogClips.bowStart, 0.0f});
        m_DogQueue.push_back({m_DogClips.bow, 2.2f});
        m_DogQueue.push_back({m_DogClips.bowEnd, 0.0f});
        if (m_Unit(m_Random) < 0.7f) m_DogQueue.push_back({m_DogClips.jump, 0.0f});
    } else {
        m_DogPetting = false;
    }
    m_DogHappy = 1.0f;
}

void Simulation::DogPlay(int clip, bool loop, float rate) {
    if (clip < 0) return;
    if (clip == m_DogClip && loop == m_DogClipLoop) { m_DogRate = rate; return; }
    m_DogPrevClip = m_DogClip;
    m_DogPrevTime = m_DogClipTime;
    m_DogFade = m_DogPrevClip >= 0 ? 1.0f : 0.0f;   // fundido de 0,25 s entre clips
    m_DogClip = clip;
    m_DogClipTime = 0.0f;
    m_DogClipLoop = loop;
    m_DogRate = rate;
}

// Velocidad (m/s) a la que avanza la garra trasera apoyada en un ciclo del clip: la marcha del perro se escala con ella para no resbalar
float Simulation::MeasureDogGait(int clip) const {
    if (!m_ChatoModel || clip < 0) return 0.0f;
    const float duration = m_ChatoModel->GetAnimationClipDuration(clip);
    if (duration < 0.1f) return 0.0f;
    constexpr int kSamples = 60;
    std::array<std::array<glm::vec3, 2>, kSamples + 1> feet;
    for (int i = 0; i <= kSamples; ++i) {
        const float time = duration * static_cast<float>(i) / static_cast<float>(kSamples);
        feet[static_cast<size_t>(i)][0] = glm::vec3(m_ChatoModel->GetNodeWorld("claws_b.L_040", time, true, clip)[3]);
        feet[static_cast<size_t>(i)][1] = glm::vec3(m_ChatoModel->GetNodeWorld("claws_b.R_046", time, true, clip)[3]);
    }
    float floorY[2] = {1.0e9f, 1.0e9f};
    for (const auto& pair : feet) for (size_t f = 0; f < 2; ++f) floorY[f] = std::min(floorY[f], pair[f].y);
    std::vector<float> strides;
    for (int i = 1; i <= kSamples; ++i) {
        for (size_t f = 0; f < 2; ++f) {
            const glm::vec3& p = feet[static_cast<size_t>(i)][f];
            const glm::vec3& q = feet[static_cast<size_t>(i - 1)][f];
            if (std::max(p.y, q.y) < floorY[f] + 0.02f) strides.push_back(std::abs(q.z - p.z) * static_cast<float>(kSamples));
        }
    }
    if (strides.empty()) return 0.0f;
    std::sort(strides.begin(), strides.end());
    return strides[strides.size() / 2] / duration;   // m/s del modelo a ritmo natural
}

void Simulation::UpdateDogAnimation(float dt, float targetSpeed) {
    const DogClips& c = m_DogClips;
    const auto duration = [&](int clip) { return m_ChatoModel->GetAnimationClipDuration(clip); };
    // avance del clip actual y del que se funde
    m_DogClipTime += dt * m_DogRate;
    bool finished = false;
    const float length = duration(m_DogClip);
    if (length > 0.0f && m_DogClipTime >= length) {
        if (m_DogClipLoop) m_DogClipTime = std::fmod(m_DogClipTime, length);
        else { m_DogClipTime = length - 0.001f; finished = true; }
    }
    m_DogPrevTime += dt;
    m_DogFade = std::max(0.0f, m_DogFade - dt / 0.25f);
    if (m_DogBusy && finished) m_DogBusy = false;

    const auto rank = [](DogPosture p) { return static_cast<int>(p); };
    // un paso entre posturas contiguas (Dormido - Echado - De pie - Sentado): devuelve el clip de la transicion
    const auto stepTo = [&](DogPosture target) {
        const int from = rank(m_DogPosture), to = rank(target);
        if (from == to) return;
        const int dir = to > from ? 1 : -1;
        int clip = -1;
        DogPosture next = static_cast<DogPosture>(from + dir);
        if (from == rank(DogPosture::Stand) && dir > 0) clip = c.sitStart;
        else if (from == rank(DogPosture::Sit)) clip = c.sitEnd;
        else if (from == rank(DogPosture::Stand) && dir < 0) clip = c.lieStart;
        else if (from == rank(DogPosture::Lie) && dir > 0) clip = c.lieEnd;
        else if (from == rank(DogPosture::Lie) && dir < 0) clip = c.sleepStart;
        else if (from == rank(DogPosture::Sleep)) clip = c.sleepEnd;
        if (clip < 0) { m_DogPosture = target; return; }
        m_DogPosture = next;
        m_DogBusy = true;
        DogPlay(clip, false);
    };

    if (m_DogBusy) return;   // termina la transicion o el clip en curso

    // cola de clips (celebracion tras la caricia)
    if (!m_DogQueue.empty() || m_DogQueueLoop > 0.0f) {
        if (m_DogPosture != DogPosture::Stand) { stepTo(DogPosture::Stand); return; }
        if (m_DogQueueLoop > 0.0f) {
            m_DogQueueLoop -= dt;
            if (m_DogQueueLoop > 0.0f) return;   // sigue en el bucle
            m_DogQueueLoop = 0.0f;
        }
        if (!m_DogQueue.empty()) {
            const auto [clip, loopSeconds] = m_DogQueue.front();
            m_DogQueue.erase(m_DogQueue.begin());
            if (loopSeconds > 0.0f) { DogPlay(clip, true); m_DogQueueLoop = loopSeconds; }
            else { DogPlay(clip, false); m_DogBusy = true; }
            return;
        }
    }
    if (m_DogPetting && m_DogPetStage == 4 && m_DogQueue.empty() && m_DogQueueLoop <= 0.0f) {
        m_DogPetting = false;   // termino la celebracion
        m_DogPetStage = 0;
        m_DogStill = 0.0f;
    }

    // postura deseada: sentado si el jugador se queda quieto un rato, echado si sigue sin moverse y dormido de noche
    DogPosture desired = DogPosture::Stand;
    if (m_DogPetting && m_DogPetStage >= 2 && m_DogPetStage <= 3) desired = DogPosture::Sit;
    else if (m_DogPetting) desired = DogPosture::Stand;
    else if (targetSpeed > 0.15f || m_DogSpeed > 0.3f) desired = DogPosture::Stand;
    else if (m_DogStill > 45.0f && IsNight()) desired = DogPosture::Sleep;
    else if (m_DogStill > 14.0f) desired = DogPosture::Lie;
    else if (m_DogStill > 2.5f) desired = DogPosture::Sit;
    if (m_DogPosture != desired) { stepTo(desired); return; }
    if (m_DogPetting && m_DogPetStage == 2) {   // ya sentado: espera la mano del jugador
        const float diff = std::atan2(std::sin(m_DogYawTarget - m_DogYaw), std::cos(m_DogYawTarget - m_DogYaw));
        if (std::abs(diff) < 0.25f) m_DogPetStage = 3;
    }

    switch (m_DogPosture) {
        case DogPosture::Sit: DogPlay(c.sit, true); break;
        case DogPosture::Lie: DogPlay(c.lie, true); break;
        case DogPosture::Sleep: DogPlay(c.sleep, true); break;
        case DogPosture::Stand: {
            if (m_DogSpeed > 0.25f) {
                // caminar, trotar o correr: el ritmo sigue la velocidad real del perro
                const bool wasRun = m_DogClip == c.run, wasTrot = m_DogClip == c.trot;
                const float walkMax = wasTrot ? 1.9f : 2.1f, trotMax = wasRun ? 4.4f : 4.8f;
                const int clip = m_DogSpeed < walkMax ? c.walk : m_DogSpeed < trotMax ? c.trot : c.run;
                const float natural = m_DogGaitSpeed[clip == c.walk ? 0 : clip == c.trot ? 1 : 2];
                const float rate = natural > 0.1f ? std::clamp(m_DogSpeed / (natural * m_DogSize), 0.6f, 2.4f) : 1.0f;
                DogPlay(clip, true, rate);
                break;
            }
            // quieto de pie: gira en el sitio si hace falta y, si no, alterna sus gestos (mirar, olfatear, alerta)
            const float diff = std::atan2(std::sin(m_DogYawTarget - m_DogYaw), std::cos(m_DogYawTarget - m_DogYaw));
            if (std::abs(diff) > 0.7f && c.turnLeft >= 0) {
                DogPlay(diff > 0.0f ? c.turnLeft : c.turnRight, true);
                break;
            }
            m_DogIdleTimer -= dt;
            const bool idleNow = m_DogClip == c.idle || m_DogClip == c.idleLook || m_DogClip == c.idleSniff || m_DogClip == c.idleAlert;
            if (!idleNow || m_DogIdleTimer <= 0.0f || finished) {
                const float roll = m_Unit(m_Random);
                const int clip = roll < 0.45f ? c.idle : roll < 0.70f ? c.idleLook : roll < 0.88f ? c.idleSniff : c.idleAlert;
                DogPlay(clip, true);
                m_DogIdleTimer = 4.0f + m_Unit(m_Random) * 5.0f;
            }
            break;
        }
    }
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
    ProvokeDriver(index);
    return true;
}

bool Simulation::StealParkedCar(size_t index) {
    if (index >= m_ParkedCars.size() || m_ParkedCarCooldowns[index] > 0.0f) return false;
    m_ParkedCarCooldowns[index] = 40.0f;
    m_ParkedCars[index].mirrorsAvailable = false;
    return true;
}

namespace {
const std::array<const char*, 8> kGreetings{
    "Dios lo bendiga, vecino.", "Pilas por la 19 que está caliente.", "¿Tiene una monedita que le sobre?", "Mucho juicio, mi rey.",
    "Tome 500 para un pan, mijo.", "Qué frío tan berraco hace hoy.", "Pilas con los carros en la Caracas.", "Buenas tardes, vecino."};
const std::array<const char*, 4> kDirtyPhrases{
    "¡Uff, aléjese que huele a caño!", "Vaya al caño a pegarse una lavada.", "¡Paso, paso, no se me pegue!", "¡Gas, qué tufo!"};
const std::array<const char*, 5> kPunchedPhrases{
    "¡Uy qué le pasa, ñero loco!", "¡Ayúdenme, me están atracando!", "¡Policía, policía!", "¡Socio, no me pegue!", "¡Qué boleta, bájese de la nube!"};
const std::array<const char*, 4> kCaughtPhrases{
    "¡Ladrón, devuélvame eso!", "¡Mano quieta, ñero!", "¡Me estaba robando!", "¡Aquí no, aquí no!"};
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
        // se da cuenta: se vuelve contra el jugador, le pega una vez y luego huye
        pedestrian.bubbleText = kCaughtPhrases[static_cast<size_t>(m_Unit(m_Random) * 3.99f)];
        pedestrian.bubbleRemaining = 3.5f;
        pedestrian.aggressive = true;
        pedestrian.fleeAfterPunch = true;
        pedestrian.aggressionRemaining = 6.0f;
        pedestrian.punchTime = -1.0f;
        pedestrian.punchCooldown = 0.0f;
        pedestrian.fleeRemaining = 0.0f;
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
    const float nextClock = m_Clock + dt / kDayLengthSeconds;
    if (nextClock >= 1.0f) ++m_Day;                       // pasa la medianoche: empieza otro dia (y a veces otra temporada)
    m_Clock = std::fmod(nextClock, 1.0f);
    m_DayProgress = m_Clock;
    // Clima: cada 3-6 min elige el siguiente estado con los pesos de la temporada; nubes, lluvia, viento y niebla se mezclan despacio
    const Climate::Season& season = Climate::SeasonForDay(m_Day);
    m_WeatherRemaining -= dt;
    if (m_WeatherRemaining <= 0.0f) {
        m_WeatherType = Climate::PickNext(m_WeatherType, season, m_DayProgress * 24.0f, m_Random);
        m_WeatherToast = Climate::Info(m_WeatherType).toast;
        m_WeatherRemaining = 180.0f + m_Unit(m_Random) * 200.0f;
    }
    {
        const Climate::WeatherInfo& target = Climate::Info(m_WeatherType);
        const float k = 1.0f - std::exp(-dt / 14.0f);
        m_CloudCover += (target.cloud - m_CloudCover) * k;
        // la lluvia arranca cuando las nubes ya cerraron el cielo; al escampar baja primero
        const float rainTarget = m_CloudCover >= target.cloud - 0.08f ? target.rain : std::min(target.rain, m_RainIntensity);
        m_RainIntensity += (rainTarget - m_RainIntensity) * std::min(1.0f, k * 1.4f);
        if (std::abs(rainTarget - m_RainIntensity) < 0.002f) m_RainIntensity = rainTarget;
        m_Wind += (target.wind * season.windMul - m_Wind) * k;
        m_FogMultiplier += (target.fog - m_FogMultiplier) * k;
        m_LightningChance += (target.lightning - m_LightningChance) * k;
        const float mistTarget = m_WeatherType == Climate::Weather::Fog ? 1.0f : 0.0f;
        m_Mist += std::clamp(mistTarget - m_Mist, -0.02f * dt, 0.03f * dt);
        // relampagos: dos destellos seguidos; la frecuencia crece con la probabilidad de rayos del estado
        if (m_FlashTime >= 0.0f) {
            m_FlashTime += dt;
            m_LightningFlash = std::max(0.0f, 1.0f - m_FlashTime / 0.12f) + (m_FlashTime > 0.18f ? std::max(0.0f, 0.7f - (m_FlashTime - 0.18f) / 0.25f) : 0.0f);
            if (m_FlashTime > 0.5f) { m_FlashTime = -1.0f; m_LightningFlash = 0.0f; }
        }
        if (m_LightningChance >= 0.05f) {
            m_NextLightning -= dt * m_LightningChance;
            if (m_NextLightning <= 0.0f) { m_NextLightning = 5.0f + m_Unit(m_Random) * 11.0f; m_FlashTime = 0.0f; }
        }
    }
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
    float dogTargetSpeed = 0.0f;
    glm::vec2 dogHeading(0.0f);
    bool dogHasHeading = false;
    if (m_DogPetting) {
        // la caricia manda a El Chato a sentarse de frente al jugador, a un paso de distancia
        const glm::vec2 toAnchor(m_DogPetAnchor.x - m_DogPosition.x, m_DogPetAnchor.z - m_DogPosition.z);
        const float anchorDistance = glm::length(toAnchor);
        if (m_DogPetStage == 1) {
            if (anchorDistance > 0.12f) {
                dogHeading = toAnchor / anchorDistance;
                dogHasHeading = true;
                dogTargetSpeed = std::min(2.6f, 0.8f + anchorDistance * 1.6f);
            } else {
                m_DogPetStage = 2;
            }
        }
        if (m_DogPetStage >= 2 && m_DogPetStage <= 3) {
            const glm::vec2 toPlayer(m_DogPetPlayer.x - m_DogPosition.x, m_DogPetPlayer.z - m_DogPosition.z);
            if (glm::length(toPlayer) > 0.01f) m_DogYawTarget = std::atan2(toPlayer.x, toPlayer.y);
        }
    } else if (m_DogIsFriend) {
        // Sigue al jugador: se detiene a 2,2 m, trota si se queda atras y galopa si lo pierde de vista; a mas de 45 m lo alcanza
        const glm::vec2 offset(playerPosition.x - m_DogPosition.x, playerPosition.z - m_DogPosition.z);
        const float distance = glm::length(offset);
        constexpr float kStopDistance = 1.7f, kCatchUpDistance = 45.0f;   // se queda dentro del alcance de E (2,0 m) para poder acariciarlo a la primera
        if (distance > kCatchUpDistance) {
            const glm::vec2 behind = glm::vec2(playerPosition.x, playerPosition.z) - (distance > 0.01f ? offset / distance : glm::vec2(0.0f, 1.0f)) * 3.0f;
            if (m_City.IsWalkable(behind.x, behind.y) && !IsBlocked({behind.x, 0.0f, behind.y}, 0.3f)) m_DogPosition = {behind.x, 0.0f, behind.y};
        } else if (distance > kStopDistance) {
            dogTargetSpeed = distance > 12.0f ? 6.0f : distance > 5.0f ? 3.6f : 1.6f + (distance - kStopDistance) * 0.7f;
            dogHeading = offset / distance;
            dogHasHeading = true;
        } else {
            m_DogYawTarget = std::atan2(offset.x, offset.y);   // quieto: mira al jugador
        }
    }
    if (m_ChatoModel && (m_DogBusy || m_DogPosture != DogPosture::Stand)) dogTargetSpeed = 0.0f;   // sentado, echado o en plena transicion no camina
    if (dogHasHeading && dogTargetSpeed > 0.0f) {
        const glm::vec3 nextPosition = m_DogPosition + glm::vec3(dogHeading.x, 0.0f, dogHeading.y) * (m_DogSpeed * dt);
        if (m_City.IsWalkable(nextPosition.x, nextPosition.z) && !IsBlocked(nextPosition, 0.25f)) m_DogPosition = nextPosition;
        else dogTargetSpeed = 0.0f;
        m_DogYawTarget = std::atan2(dogHeading.x, dogHeading.y);
    }
    m_DogPosition.y = m_City.GetGroundHeight(m_DogPosition.x, m_DogPosition.z);   // siempre apoyado en el suelo, tambien sobre la isla de la estacion
    m_DogSpeed += (dogTargetSpeed - m_DogSpeed) * (1.0f - std::exp(-6.0f * dt));
    if (dogTargetSpeed == 0.0f && m_DogSpeed < 0.05f) m_DogSpeed = 0.0f;
    {   // giro suave del cuerpo: rapido al caminar, mas despacio en el sitio
        float diff = m_DogYawTarget - m_DogYaw;
        diff = std::atan2(std::sin(diff), std::cos(diff));
        const float rate = (m_DogSpeed > 0.3f ? 7.0f : 2.4f) * dt;
        m_DogYaw += std::clamp(diff, -rate, rate);
    }
    m_DogStill = m_DogSpeed < 0.1f ? m_DogStill + dt : 0.0f;
    m_DogHappy = std::max(0.0f, m_DogHappy - dt / 6.0f);
    if (m_DogHop >= 0.0f) { m_DogHop += dt * 2.4f; if (m_DogHop > 1.0f) m_DogHop = -1.0f; }
    if (m_ChatoModel) {
        UpdateDogAnimation(dt, dogTargetSpeed);
    } else {
        // respaldo con perro.glb (sin clips): posturas y marcha por codigo
        const bool resting = m_DogStill > 14.0f;
        const bool sitting = !resting && m_DogStill > 2.5f;
        const auto approach = [&](float current, float target, float rate) { return current + (target - current) * (1.0f - std::exp(-rate * dt)); };
        m_DogLie = approach(m_DogLie, resting ? 1.0f : 0.0f, 3.0f);
        m_DogSit = approach(m_DogSit, sitting ? 1.0f : 0.0f, 4.0f);
        m_DogSniff = approach(m_DogSniff, (m_DogSpeed < 0.3f && std::sin(m_DogTime * 0.7f) > 0.6f) ? 1.0f : 0.0f, 3.0f) * (1.0f - m_DogLie);
        const float swing = m_DogSpeed < 2.4f ? 0.32f : m_DogSpeed < 5.2f ? 0.45f : 0.62f;
        m_DogPhase = std::fmod(m_DogPhase + (m_DogSpeed / (0.4f * swing)) * dt / 6.2831853f, 1.0f);
    }
    UpdatePedestrians(dt, playerPosition);
    UpdatePigeons(dt, playerPosition);
    UpdateRats(dt, playerPosition);
    UpdatePoop(dt);
    UpdateTraffic(dt);
    UpdateDrivers(dt, playerPosition);
    UpdateBus(dt);
    for (size_t index = 0; index < m_ParkedCarCooldowns.size(); ++index) {
        m_ParkedCarCooldowns[index] = std::max(0.0f, m_ParkedCarCooldowns[index] - dt);
        if (m_ParkedCarCooldowns[index] <= 0.0f) m_ParkedCars[index].mirrorsAvailable = true;
    }
    m_Elapsed += dt;
    UpdatePickups(dt, playerPosition);
}

// Pose del perro (port de Dog._animate del juego web): gira los huesos de perro.glb segun la marcha y las posturas
std::vector<Model::BoneTurn> Simulation::BuildDogPose() const {
    std::vector<Model::BoneTurn> turns;
    const auto turn = [&](const char* name, float x = 0.0f, float y = 0.0f, float z = 0.0f) {
        turns.push_back({name, {x, y, z}, {0.0f, 0.0f, 0.0f}});
    };
    const float speed = m_DogSpeed;
    struct Gait { float speed; std::array<float, 4> offsets; float swing; };
    static const std::array<Gait, 3> gaits{{{0.0f, {0.25f, 0.75f, 0.0f, 0.5f}, 0.32f}, {2.4f, {0.0f, 0.5f, 0.5f, 0.0f}, 0.45f}, {5.2f, {0.0f, 0.12f, 0.55f, 0.67f}, 0.62f}}};
    size_t gaitIndex = 0;
    while (gaitIndex < gaits.size() - 2 && speed > gaits[gaitIndex + 1].speed) ++gaitIndex;
    const Gait& a = gaits[gaitIndex];
    const Gait& b = gaits[gaitIndex + 1];
    const float blendT = AtmosphereSmoothstep(a.speed + (b.speed - a.speed) * 0.6f, b.speed, speed);
    std::array<float, 4> offsets{};
    for (size_t k = 0; k < 4; ++k) offsets[k] = glm::mix(a.offsets[k], b.offsets[k], blendT);
    const float swingAmount = glm::mix(a.swing, b.swing, blendT);
    const float move = std::clamp(speed / 0.4f, 0.0f, 1.0f) * (1.0f - m_DogLie) * (1.0f - m_DogSit);
    const float sit = m_DogSit, lie = m_DogLie;
    const float tau = 6.2831853f;
    struct Leg { const char* upper; const char* lower; const char* foot; char side; bool front; };
    static const std::array<Leg, 4> legs{{{"brazo", "antebrazo", "mano", 'L', true}, {"brazo", "antebrazo", "mano", 'R', true},
                                         {"muslo", "pierna", "pie", 'L', false}, {"muslo", "pierna", "pie", 'R', false}}};
    for (size_t i = 0; i < legs.size(); ++i) {
        const Leg& leg = legs[i];
        const float t = (m_DogPhase + offsets[i]) * tau;
        const float swing = std::sin(t) * swingAmount * move;
        const float lift = std::max(0.0f, -std::cos(t)) * move;
        const std::string upper = std::string(leg.upper) + "_" + leg.side, lower = std::string(leg.lower) + "_" + leg.side, foot = std::string(leg.foot) + "_" + leg.side;
        if (leg.front) {
            turn(upper.c_str(), swing + sit * 0.55f - lie * 1.25f);
            turn(lower.c_str(), lift * 0.9f - sit * 0.15f + lie * 0.15f);
            turn(foot.c_str(), lift * 0.5f + lie * 0.9f);
        } else {
            turn(upper.c_str(), swing - sit * 0.75f - lie * 1.1f);
            turn(lower.c_str(), -lift * 0.7f + sit * 1.9f + lie * 2.1f);
            turn(foot.c_str(), lift * 0.6f - sit * 1.2f - lie * 1.1f);
        }
    }
    const float gallop = AtmosphereSmoothstep(4.4f, 6.0f, speed);
    const float bounce = std::abs(std::sin(m_DogPhase * tau)) * move;
    const float hop = m_DogHop >= 0.0f ? std::sin(m_DogHop * 3.14159265f) * 0.16f : 0.0f;
    const float breath = std::sin(m_DogTime * 3.2f) * 0.006f;
    turns.push_back({"raiz", {0.0f, 0.0f, 0.0f}, {0.0f, -0.012f * bounce - sit * 0.3f - lie * 0.29f + hop, -sit * 0.04f}});
    turn("pelvis", -sit * 0.55f + std::sin(m_DogPhase * tau) * 0.09f * gallop);
    turn("pecho", breath * 4.0f - std::sin(m_DogPhase * tau) * 0.08f * gallop);
    const float nod = std::sin(m_DogPhase * tau * 2.0f) * 0.05f * move;
    turn("cuello", sit * 0.5f + m_DogSniff * 0.75f + lie * 0.2f + nod, 0.0f);
    turn("cabeza", m_DogSniff * 0.35f, 0.0f, std::sin(m_DogTime * 1.3f) * 0.06f * (1.0f - move) * (1.0f - lie));
    const float flop = std::sin(m_DogPhase * tau * 2.0f + 0.8f) * 0.25f * move;
    turn("oreja_L", flop, 0.0f, -flop * 0.3f);
    turn("oreja_R", flop, 0.0f, flop * 0.3f);
    const float mood = m_DogIsFriend ? 0.45f + m_DogHappy * 0.55f : 0.2f;
    const float rate = m_DogIsFriend ? 9.0f + m_DogHappy * 9.0f : 4.0f;
    turn("cola_1", -0.25f * (1.0f - lie) + lie * 0.35f, std::sin(m_DogTime * rate) * mood * 0.6f * (1.0f - lie * 0.8f) + lie * 0.35f);
    turn("cola_2", 0.15f * lie, std::sin(m_DogTime * rate - 0.6f) * mood * 0.7f * (1.0f - lie * 0.8f) + lie * 0.35f);
    turn("cola_3", 0.0f, std::sin(m_DogTime * rate - 1.2f) * mood * 0.8f * (1.0f - lie * 0.8f) + lie * 0.3f);
    return turns;
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

std::vector<Simulation::PedestrianBubble> Simulation::GetPedestrianBubbles(const glm::vec3& focus) const {
    std::vector<PedestrianBubble> bubbles;
    for (const Pedestrian& pedestrian : m_Pedestrians) {
        if (pedestrian.dead || pedestrian.bubbleRemaining <= 0.0f || pedestrian.bubbleText.empty()) continue;
        if (glm::distance(glm::vec2(pedestrian.position.x, pedestrian.position.z), glm::vec2(focus.x, focus.z)) > 14.0f) continue;
        const float lying = pedestrian.reaction == 4 && pedestrian.reactionTime > 0.6f && pedestrian.reactionTime < 1.9f ? -1.1f : 0.0f;
        bubbles.push_back({pedestrian.position + glm::vec3(0.0f, 2.05f * pedestrian.scale + lying, 0.0f), pedestrian.bubbleText,
                           std::clamp(pedestrian.bubbleRemaining / 0.5f, 0.0f, 1.0f)});
    }
    return bubbles;
}

bool Simulation::HitPedestrian(const glm::vec3& from, const glm::vec2& forward, float reach, int kind) {
    const glm::vec2 origin(from.x, from.z);
    const glm::vec2 direction = glm::length(forward) > 0.001f ? glm::normalize(forward) : glm::vec2(0.0f, 1.0f);
    Pedestrian* target = nullptr;
    float best = reach;
    for (auto& pedestrian : m_Pedestrians) {
        if (pedestrian.reaction > 0) continue;
        const glm::vec2 offset = glm::vec2(pedestrian.position.x, pedestrian.position.z) - origin;
        const float distance = glm::length(offset);
        // delante del jugador: dentro de un cono de unos 70 grados
        if (distance > best || (distance > 0.05f && glm::dot(offset / distance, direction) < 0.55f)) continue;
        best = distance;
        target = &pedestrian;
    }
    if (!target) return false;
    target->bubbleText = kPunchedPhrases[static_cast<size_t>(m_Unit(m_Random) * 4.99f)];
    target->bubbleRemaining = 4.0f;
    target->health -= kind >= 3 ? 22.0f : kind == 2 ? 14.0f : 10.0f;   // patada, cruzado o navaja, jab
    if (target->health <= 0.0f) {
        // muere: cae, queda tendido en un charco de sangre y no se levanta
        target->dead = true;
        target->robberyCooldown = 1.0e9f;
        target->bubbleRemaining = 0.0f;
        kind = 3;
    }
    target->reaction = kind >= 3 ? 4 : std::max(1, kind);
    target->reactionTime = 0.0f;
    target->punchTime = -1.0f;
    target->aggressive = false;
    target->yaw = std::atan2(-direction.x, -direction.y);   // mira hacia quien lo golpeo
    const glm::vec3 pushed = target->position + glm::vec3(direction.x, 0.0f, direction.y) * (kind >= 3 ? 0.45f : 0.2f);
    if (m_City.IsWalkable(pushed.x, pushed.z) && !m_City.IsBlocked(pushed.x, pushed.z, 0.18f)) target->position = pushed;
    return true;
}

bool Simulation::ConsumePlayerHit(int& kind, glm::vec3& fromDirection) {
    if (m_PlayerHits.empty()) return false;
    kind = m_PlayerHits.front().kind;
    fromDirection = m_PlayerHits.front().from;
    m_PlayerHits.erase(m_PlayerHits.begin());
    return true;
}

// Los carros comunes (circulando o estacionados) solo usan modelos cuya puerta del conductor es una pieza que se abre y cierra;
// los taxis, ademas, uno que se pueda pintar de amarillo. Las ambulancias, patrullas y motos de policia conservan su modelo.
void Simulation::AssignVehicleModel(TrafficVehicle& vehicle) {
    if (vehicle.emergency != 0) return;
    std::vector<int> available;
    for (size_t variant = 0; variant < kCabinVariants; ++variant) {
        const VehicleParts& parts = m_VehicleParts[5 + variant];
        if (!parts.valid() || !parts.ownFit || !parts.door) continue;
        if (vehicle.taxi && !parts.hasPaint) continue;
        available.push_back(static_cast<int>(variant) + 1);
    }
    if (const char* forcedEnv = std::getenv("BAZUKO_FORCE_VARIANT")) {   // solo pruebas: todos usan ese modelo
        const int forced = std::atoi(forcedEnv);
        if (forced > 0 && forced <= static_cast<int>(kCabinVariants) && m_VehicleParts[4 + static_cast<size_t>(forced)].valid()) available = {forced};
    }
    if (available.empty()) return;
    vehicle.variant = available[static_cast<size_t>(m_Unit(m_Random) * static_cast<float>(available.size())) % available.size()];
    const VehicleParts& chosen = m_VehicleParts[4 + static_cast<size_t>(vehicle.variant)];
    vehicle.length = chosen.length;
    vehicle.width = std::max(1.7f, chosen.width);
    if (chosen.wheelbase > 1.0f) vehicle.wheelbase = chosen.wheelbase;
}

void Simulation::VehiclePose(const TrafficVehicle& vehicle, glm::vec3& position, float& yaw) const {
    position = vehicle.position;
    yaw = vehicle.yaw;
    if (vehicle.bike.ready) {
        BicycleParams params;
        params.wheelbase = std::max(1.2f, vehicle.wheelbase);
        const glm::vec2 center = vehicle.bike.Center(params);
        position = {center.x, vehicle.position.y, center.y};
        yaw = vehicle.bike.Yaw();
    }
}

glm::vec3 Simulation::VehicleLocalToWorld(const glm::vec3& position, float yaw, const glm::vec2& carFrame) const {
    // marco del carro (frente +X, lado del conductor +Y) -> marco local del dibujo (frente +X, lado del conductor -Z) -> mundo
    const float x = carFrame.x, z = -carFrame.y;
    const float c = std::cos(yaw), s = std::sin(yaw);
    return position + glm::vec3(x * c + z * s, 0.0f, -x * s + z * c);
}

DriverProfile Simulation::ProfileFor(const TrafficVehicle& vehicle) const {
    DriverProfile profile;
    profile.valid = true;
    if (vehicle.emergency == 3) {
        profile.seat = {-0.15f, 0.0f};
        profile.stance = {-0.10f, 1.08f};
        return profile;
    }
    if (vehicle.variant > 0) {
        const VehicleParts& parts = m_VehicleParts[4 + static_cast<size_t>(vehicle.variant)];
        if (parts.driver.valid) return parts.driver;
    }
    return profile;
}

bool Simulation::ProvokeDriver(size_t index) {
    if (index >= m_Traffic.size() || m_PedestrianAppearances.empty()) return false;
    TrafficVehicle& vehicle = m_Traffic[index];
    DriverInfo& driver = vehicle.driver;
    if (vehicle.bus || vehicle.parked || driver.state != DriverState::Seated || driver.cooldown > 0.0f) return false;
    driver.cooldown = 25.0f;
    if (m_Unit(m_Random) < 0.5f) {
        driver.boost = 7.0f;   // acelera para huir
    } else {
        vehicle.holdStop = true;   // frena, se baja y va por el jugador
        driver.state = DriverState::Braking;
        driver.timer = 0.0f;
    }
    return true;
}

bool Simulation::HitVehicle(const glm::vec3& from, const glm::vec2& forward, float reach) {
    const glm::vec2 direction = glm::length(forward) > 0.001f ? glm::normalize(forward) : glm::vec2(0.0f, 1.0f);
    const glm::vec3 point = from + glm::vec3(direction.x, 0.0f, direction.y) * reach;
    for (size_t index = 0; index < m_Traffic.size(); ++index) {
        const TrafficVehicle& vehicle = m_Traffic[index];
        if (vehicle.bus || vehicle.parked || std::abs(from.y - vehicle.position.y) > 2.0f) continue;
        if (!PointInVehicleBox(point, vehicle.position, glm::vec2(vehicle.direction.x, vehicle.direction.z), vehicle.length * 0.5f, vehicle.width * 0.5f, 0.35f)) continue;
        if (ProvokeDriver(index)) return true;
    }
    return false;
}

void Simulation::OnDriverDeath(size_t index) {
    TrafficVehicle& vehicle = m_Traffic[index];
    DriverInfo& driver = vehicle.driver;
    vehicle.holdStop = true;   // el vehiculo se queda quieto en la carretera
    if (driver.hasPassenger && vehicle.emergency != 3) {
        // el acompanante se pasa al asiento del conductor y maneja: toma su identidad y su ropa
        driver.appearance = driver.passengerAppearance;
        driver.color = driver.passengerColor;
        driver.shade = driver.passengerShade;
        driver.hasPassenger = false;
        driver.state = DriverState::Swapping;
    } else {
        driver.state = DriverState::Abandoned;
    }
    driver.timer = 0.0f;
}

void Simulation::RespawnAbandoned(TrafficVehicle& vehicle) {
    if (m_TrafficRoutes.empty()) return;
    const glm::vec2 player(m_LastPlayerPosition.x, m_LastPlayerPosition.z);
    for (int attempt = 0; attempt < 40; ++attempt) {
        const size_t routeIndex = static_cast<size_t>(m_Unit(m_Random) * static_cast<float>(m_TrafficRoutes.size())) % m_TrafficRoutes.size();
        const std::vector<float>& cumulative = m_RouteCumulative[routeIndex];
        const float length = GetCircuitLength(m_TrafficRoutes[routeIndex]);
        const float distance = m_Unit(m_Random) * length;
        glm::vec3 position, direction;
        size_t waypoint = 0;
        SampleCircuit(m_TrafficRoutes[routeIndex], cumulative, length, distance, position, direction, waypoint);
        if (glm::distance(glm::vec2(position.x, position.z), player) < 70.0f) continue;
        bool free = true;
        for (const TrafficVehicle& other : m_Traffic) {
            if (&other != &vehicle && glm::distance(other.position, position) < 9.0f) { free = false; break; }
        }
        if (!free) continue;
        vehicle.route = m_TrafficRoutes[routeIndex];
        vehicle.routeCumulative = cumulative;
        vehicle.routeLength = length;
        vehicle.routeIndex = routeIndex;
        vehicle.connectorRoute = -1;
        vehicle.distance = vehicle.nextDistance = distance;
        vehicle.speed = vehicle.nextSpeed = 0.0f;
        vehicle.position = vehicle.previousPosition = position;
        vehicle.direction = direction;
        vehicle.nextWaypoint = waypoint;
        vehicle.yaw = std::atan2(-direction.z, direction.x);
        vehicle.bike.ready = false;
        vehicle.holdStop = false;
        vehicle.stalledTime = 0.0f;
        DriverInfo& driver = vehicle.driver;
        driver = DriverInfo{};
        driver.appearance = static_cast<size_t>(m_Unit(m_Random) * 1000.0f);
        driver.color = {0.22f + m_Unit(m_Random) * 0.55f, 0.18f + m_Unit(m_Random) * 0.48f, 0.15f + m_Unit(m_Random) * 0.42f};
        driver.shade = m_Unit(m_Random) * 2.0f;
        if (vehicle.variant > 0 && vehicle.emergency == 0 && m_Unit(m_Random) < 0.35f) {
            driver.hasPassenger = true;
            driver.passengerAppearance = static_cast<size_t>(m_Unit(m_Random) * 1000.0f);
            driver.passengerColor = {0.22f + m_Unit(m_Random) * 0.55f, 0.18f + m_Unit(m_Random) * 0.48f, 0.15f + m_Unit(m_Random) * 0.42f};
            driver.passengerShade = m_Unit(m_Random) * 2.0f;
        }
        return;
    }
}

void Simulation::UpdateDrivers(float dt, const glm::vec3& playerPosition) {
    m_LastPlayerPosition = playerPosition;
    {   // pruebas: BAZUKO_PROVOKE_AT=<s> provoca al conductor mas cercano (BAZUKO_PROVOKE_CAR=<indice> elige uno; BAZUKO_PROVOKE_MODE=flee|fight)
        static float debugClock = 0.0f;
        static bool debugDone = false;
        debugClock += dt;
        const char* at = std::getenv("BAZUKO_PROVOKE_AT");
        if (at && !debugDone && debugClock >= static_cast<float>(std::atof(at))) {
            debugDone = true;
            size_t best = m_Traffic.size();
            if (const char* car = std::getenv("BAZUKO_PROVOKE_CAR")) best = static_cast<size_t>(std::atoi(car));
            else {
                float bestDistance = 1.0e9f;
                for (size_t i = 0; i < m_Traffic.size(); ++i) {
                    const float d = glm::distance(glm::vec2(m_Traffic[i].position.x, m_Traffic[i].position.z), glm::vec2(playerPosition.x, playerPosition.z));
                    if (!m_Traffic[i].bus && d < bestDistance) { bestDistance = d; best = i; }
                }
            }
            if (best < m_Traffic.size()) {
                LogInfo("PRUEBA conductor {} (emergencia {}) en ({:.1f}, {:.1f})", best, m_Traffic[best].emergency, m_Traffic[best].position.x, m_Traffic[best].position.z);
                const char* mode = std::getenv("BAZUKO_PROVOKE_MODE");
                if (mode && std::string(mode) == "flee") m_Traffic[best].driver.boost = 7.0f;
                else { m_Traffic[best].holdStop = true; m_Traffic[best].driver.state = DriverState::Braking; m_Traffic[best].driver.timer = 0.0f; }
            }
        }
    }
    constexpr float kCarClip = 3.0f;    // CarEnter y CarExit: 72 fotogramas a 24 fps
    constexpr float kBoardSpeed = 1.6f; // subir y bajar del vehiculo se reproduce a 1,6x: el clip original se sentia lento
    for (size_t index = 0; index < m_Traffic.size(); ++index) {
        TrafficVehicle& vehicle = m_Traffic[index];
        DriverInfo& driver = vehicle.driver;
        driver.cooldown = std::max(0.0f, driver.cooldown - dt);
        if (vehicle.bus || vehicle.parked) continue;
        const bool moto = vehicle.emergency == 3;
        const float enterLength = moto ? 2.0f : 4.5f;           // BikeMount 48 f / CarEnter 108 f
        const float exitLength = moto ? 2.5f : 5.75f;           // BikeDismount 60 f / CarExit 138 f
        const float playerDistance = glm::distance(glm::vec2(vehicle.position.x, vehicle.position.z), glm::vec2(playerPosition.x, playerPosition.z));
        glm::vec3 pose;
        float yaw = 0.0f;
        VehiclePose(vehicle, pose, yaw);
        const DriverProfile profile = ProfileFor(vehicle);
        const glm::vec3 stanceWorld = VehicleLocalToWorld(pose, yaw, profile.stance);
        switch (driver.state) {
            case DriverState::Seated:
                break;
            case DriverState::Braking:
                driver.timer += dt;
                if (vehicle.speed < 0.25f) { driver.state = DriverState::Exiting; driver.timer = 0.0f; }
                else if (driver.timer > 8.0f) { vehicle.holdStop = false; driver.boost = 6.0f; driver.state = DriverState::Seated; }
                break;
            case DriverState::Exiting:
                driver.timer += dt * kBoardSpeed;
                if (driver.timer >= exitLength) {
                    // el conductor sale a la calle: es un peaton agresivo que va por el jugador
                    Pedestrian pedestrian;
                    pedestrian.position = stanceWorld;
                    pedestrian.position.y = m_City.GetGroundHeight(stanceWorld.x, stanceWorld.z);
                    pedestrian.target = pedestrian.position;
                    pedestrian.yaw = moto ? yaw : yaw + glm::pi<float>();   // al terminar CarExit mira hacia la calle
                    pedestrian.speed = 1.2f;
                    pedestrian.scale = 1.0f;
                    pedestrian.appearance = driver.appearance % m_PedestrianAppearances.size();
                    pedestrian.color = driver.color;               // la misma ropa que llevaba al volante
                    pedestrian.animationOffset = driver.shade;
                    pedestrian.aggressive = true;
                    pedestrian.aggressionRemaining = 18.0f;
                    pedestrian.punchCooldown = 0.6f;
                    pedestrian.vehicleIndex = static_cast<int>(index);
                    size_t slot = m_Pedestrians.size();
                    for (size_t i = 0; i < m_Pedestrians.size(); ++i) if (m_Pedestrians[i].departed) { slot = i; break; }
                    if (slot == m_Pedestrians.size()) m_Pedestrians.push_back(pedestrian); else m_Pedestrians[slot] = pedestrian;
                    driver.pedestrianIndex = slot;
                    driver.state = DriverState::OnFoot;
                    driver.timer = 0.0f;
                }
                break;
            case DriverState::OnFoot: {
                driver.timer += dt;
                Pedestrian& pedestrian = m_Pedestrians[driver.pedestrianIndex];
                if (const char* killAfter = std::getenv("BAZUKO_KILL_DRIVER_AFTER")) {   // solo pruebas: lo mata tras N segundos a pie
                    if (driver.timer > static_cast<float>(std::atof(killAfter))) { pedestrian.health = 0.0f; pedestrian.dead = true; pedestrian.reaction = 4; pedestrian.reactionTime = 0.0f; }
                }
                if (pedestrian.dead) { OnDriverDeath(index); break; }
                if (pedestrian.vehicleIndex != static_cast<int>(index)) { OnDriverDeath(index); break; }
                const bool scared = pedestrian.fleeRemaining > 0.0f;
                const bool fighting = pedestrian.aggressive || pedestrian.punchTime >= 0.0f || pedestrian.reaction > 0 || scared;
                driver.idle = fighting ? 0.0f : driver.idle + dt;
                if (playerDistance > 14.0f || driver.timer > 35.0f || scared || driver.idle > 1.5f) {
                    pedestrian.aggressive = false;
                    pedestrian.punchTime = -1.0f;
                    pedestrian.fleeRemaining = 0.0f;
                    pedestrian.returning = true;
                    pedestrian.returnTarget = stanceWorld;
                    driver.state = DriverState::Returning;
                    driver.timer = 0.0f;
                } else if (!pedestrian.aggressive && pedestrian.reaction == 0) {
                    pedestrian.aggressive = true;
                    pedestrian.aggressionRemaining = 18.0f;
                }
                break;
            }
            case DriverState::Returning: {
                driver.timer += dt;
                Pedestrian& pedestrian = m_Pedestrians[driver.pedestrianIndex];
                pedestrian.returnTarget = stanceWorld;
                const float toVehicle = glm::distance(glm::vec2(pedestrian.position.x, pedestrian.position.z), glm::vec2(stanceWorld.x, stanceWorld.z));
                if (pedestrian.dead) { OnDriverDeath(index); break; }
                // vuelve caminando: solo sube cuando llega; si tarda mucho y el jugador ya no lo ve, se sube sin teletransportarse a la vista
                if (toVehicle < 0.5f || (driver.timer > 60.0f && playerDistance > 70.0f)) {
                    pedestrian.departed = true;            // vuelve a subir: la animacion de entrada la dibuja el vehiculo
                    pedestrian.returning = false;
                    pedestrian.position = {0.0f, -1000.0f, 0.0f};
                    driver.state = DriverState::Entering;
                    driver.timer = 0.0f;
                }
                break;
            }
            case DriverState::Entering:
                driver.timer += dt * kBoardSpeed;
                if (driver.timer >= enterLength) {
                    driver.state = DriverState::Seated;
                    driver.timer = 0.0f;
                    vehicle.holdStop = false;
                    driver.cooldown = 25.0f;
                }
                break;
            case DriverState::Swapping:
                driver.timer += dt;
                vehicle.holdStop = true;
                if (driver.timer >= 2.5f) {   // CarSwap: 60 fotogramas
                    driver.state = DriverState::Seated;
                    driver.timer = 0.0f;
                    vehicle.holdStop = false;
                    driver.cooldown = 25.0f;
                }
                break;
            case DriverState::Abandoned:
                vehicle.holdStop = true;      // queda quieto en la carretera hasta que el jugador no lo vea
                driver.timer = playerDistance > 70.0f ? driver.timer + dt : 0.0f;
                if (driver.timer > 4.0f) RespawnAbandoned(vehicle);
                break;
        }
    }
}

void Simulation::UpdatePedestrians(float dt, const glm::vec3& playerPosition) {
    m_PedestrianSpawnTimer -= dt;
    const size_t populationLimit = IsNight() ? 9 : 22;
    const size_t alivePedestrians = static_cast<size_t>(std::count_if(m_Pedestrians.begin(), m_Pedestrians.end(), [](const Pedestrian& p) { return !p.dead && !p.departed; }));
    if (alivePedestrians < populationLimit && m_PedestrianSpawnTimer <= 0.0f) {
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
            spawn.y = m_City.GetGroundHeight(spawn.x, spawn.z);   // a pie de calle: el jugador puede estar sobre el viaducto
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
                // en El Cartucho (ruinas y tierra a la vista) se ve gente de ropa gastada; en el resto, la gente comun
                int ruinTiles = 0;
                const int tileX = static_cast<int>((spawn.x + CityLayout::ORIGIN_X) / CityLayout::TILE_SIZE);
                const int tileZ = static_cast<int>((spawn.z + CityLayout::ORIGIN_Z) / CityLayout::TILE_SIZE);
                for (int dz = -4; dz <= 4; ++dz)
                    for (int dx = -4; dx <= 4; ++dx) {
                        const TileType near = m_City.GetTileAt(tileX + dx, tileZ + dz);
                        if (near == TileType::Ruin || near == TileType::Dirt) ++ruinTiles;
                    }
                const bool cartucho = ruinTiles > 12;
                std::vector<size_t> pool;
                for (size_t index = 0; index < m_PedestrianAppearances.size(); ++index)
                    if (m_PedestrianAppearances[index].worn == (cartucho && m_Unit(m_Random) < 0.75f)) pool.push_back(index);
                if (pool.empty()) for (size_t index = 0; index < m_PedestrianAppearances.size(); ++index) pool.push_back(index);
                pedestrian.appearance = pool[static_cast<size_t>(m_Unit(m_Random) * static_cast<float>(pool.size() - 1) + 0.5f)];
            }
            pedestrian.color = {0.22f + m_Unit(m_Random) * 0.55f, 0.18f + m_Unit(m_Random) * 0.48f, 0.15f + m_Unit(m_Random) * 0.42f};
            m_Pedestrians.push_back(pedestrian);
        }
        m_PedestrianSpawnTimer = 0.6f;
    }

    // Avanza `distance` metros en `direction`; si un vehiculo estorba, lo rodea girando el rumbo (hasta ~70 grados a cada lado).
    // Quien ya esta dentro de la caja de un vehiculo (por ejemplo, porque este avanzo sobre el) puede salir de ella.
    const auto moveAround = [&](Pedestrian& walker, const glm::vec3& direction, float distance, bool sidewalkOnly) {
        const bool inside = IsBlocked(walker.position, 0.32f);
        for (const float turn : {0.0f, 0.6f, -0.6f, 1.2f, -1.2f}) {
            const float c = std::cos(turn), s = std::sin(turn);
            const glm::vec3 heading(direction.x * c - direction.z * s, 0.0f, direction.x * s + direction.z * c);
            const glm::vec3 next = walker.position + heading * distance;
            const bool terrain = sidewalkOnly ? m_City.IsSidewalk(next.x, next.z) : m_City.IsWalkable(next.x, next.z);
            if (!terrain || m_City.IsBlocked(next.x, next.z, 0.18f)) continue;
            if (!inside && IsBlocked(next, 0.32f)) continue;
            walker.position = next;
            walker.yaw = std::atan2(heading.x, heading.z);
            walker.moving = true;
            return true;
        }
        return false;
    };
    for (auto& pedestrian : m_Pedestrians) {
        if (pedestrian.departed) continue;
        pedestrian.position.y = m_City.GetGroundHeight(pedestrian.position.x, pedestrian.position.z);   // siempre pisan el suelo
        pedestrian.robberyCooldown = std::max(0.0f, pedestrian.robberyCooldown - dt);
        pedestrian.fleeRemaining = std::max(0.0f, pedestrian.fleeRemaining - dt);
        pedestrian.splatRemaining = std::max(0.0f, pedestrian.splatRemaining - dt);
        pedestrian.punchCooldown = std::max(0.0f, pedestrian.punchCooldown - dt);
        pedestrian.bubbleRemaining = std::max(0.0f, pedestrian.bubbleRemaining - dt);
        pedestrian.bubbleCooldown = std::max(0.0f, pedestrian.bubbleCooldown - dt);
        if (pedestrian.bubbleCooldown <= 0.0f && pedestrian.reaction == 0 && !pedestrian.aggressive
            && glm::distance(glm::vec2(pedestrian.position.x, pedestrian.position.z), glm::vec2(playerPosition.x, playerPosition.z)) < 2.8f) {
            // al pasar cerca del jugador saluda (una de cada dos veces); si esta sucio, se queja del olor
            pedestrian.bubbleCooldown = 14.0f;
            if (m_Unit(m_Random) < 0.5f) {
                pedestrian.bubbleText = m_PlayerHygiene < 30.0f ? kDirtyPhrases[static_cast<size_t>(m_Unit(m_Random) * 3.99f)]
                                                                : kGreetings[static_cast<size_t>(m_Unit(m_Random) * 7.99f)];
                pedestrian.bubbleRemaining = 3.5f;
            }
        }
        pedestrian.moving = false;
        pedestrian.animationTime += dt;
        if (pedestrian.dead) {
            pedestrian.reactionTime = std::min(pedestrian.reactionTime + dt, 4.0f);   // tendido: se queda en el suelo
            pedestrian.bubbleRemaining = 0.0f;
            continue;
        }
        if (pedestrian.reaction > 0) {
            // golpeado: se queda en su reaccion (la animacion marca la duracion); luego se enoja o huye
            pedestrian.reactionTime += dt;
            const float reactionLength = pedestrian.reaction == 1 ? 0.667f : pedestrian.reaction == 2 ? 0.75f : pedestrian.reaction == 3 ? 0.833f : 3.233f;
            if (pedestrian.reactionTime >= reactionLength) {
                pedestrian.reaction = 0;
                pedestrian.reactionTime = 0.0f;
                if (m_Unit(m_Random) < 0.5f) {
                    pedestrian.aggressive = true;
                    pedestrian.aggressionRemaining = 14.0f;
                } else {
                    pedestrian.fleeRemaining = 6.0f;
                    glm::vec3 away = pedestrian.position - playerPosition;
                    away.y = 0.0f;
                    pedestrian.fleeDirection = glm::length(away) > 0.01f ? glm::normalize(away) : glm::vec3(1.0f, 0.0f, 0.0f);
                }
            }
            continue;
        }
        if (pedestrian.vehicleIndex >= 0 && pedestrian.returning) {
            // el conductor vuelve caminando a la puerta de su vehiculo
            glm::vec3 toDoor = pedestrian.returnTarget - pedestrian.position;
            toDoor.y = 0.0f;
            const float doorDistance = glm::length(toDoor);
            if (doorDistance > 0.3f) {
                const glm::vec3 heading = toDoor / doorDistance;
                if (!moveAround(pedestrian, heading, std::min(doorDistance, 2.2f * dt), false)) pedestrian.yaw = std::atan2(heading.x, heading.z);
            }
            continue;
        }
        if (pedestrian.aggressive) {
            pedestrian.aggressionRemaining -= dt;
            glm::vec3 toPlayer = playerPosition - pedestrian.position;
            toPlayer.y = 0.0f;
            const float playerDistance = glm::length(toPlayer);
            const auto startFleeing = [&]() {
                pedestrian.aggressive = false;
                pedestrian.fleeAfterPunch = false;
                pedestrian.punchTime = -1.0f;
                pedestrian.fleeRemaining = 8.0f;
                glm::vec3 away = pedestrian.position - playerPosition;
                away.y = 0.0f;
                pedestrian.fleeDirection = glm::length(away) > 0.01f ? glm::normalize(away) : glm::vec3(1.0f, 0.0f, 0.0f);
                pedestrian.route.clear();
                pedestrian.nextWaypoint = 0;
            };
            if (pedestrian.aggressionRemaining <= 0.0f || playerDistance > 30.0f) {
                if (pedestrian.fleeAfterPunch) startFleeing();
                else { pedestrian.aggressive = false; pedestrian.punchTime = -1.0f; }
                continue;
            }
            const glm::vec3 toward = playerDistance > 0.01f ? toPlayer / playerDistance : glm::vec3(0.0f, 0.0f, 1.0f);
            if (pedestrian.punchTime >= 0.0f) {
                // lanza el puno: acierta hacia la mitad del movimiento si el jugador sigue al alcance
                pedestrian.punchTime += dt;
                pedestrian.yaw = std::atan2(toward.x, toward.z);
                if (!pedestrian.punchLanded && pedestrian.punchTime >= (pedestrian.punchCross ? 0.30f : 0.22f)) {
                    pedestrian.punchLanded = true;
                    if (playerDistance < 1.6f) {
                        const float roll = pedestrian.fleeAfterPunch ? 0.2f + 0.4f * m_Unit(m_Random) : m_Unit(m_Random);
                        m_PlayerHits.push_back({roll < 0.4f ? 1 : roll < 0.8f ? 2 : 3, -toward});
                    }
                }
                if (pedestrian.punchTime >= (pedestrian.punchCross ? 0.75f : 0.583f)) {
                    pedestrian.punchTime = -1.0f;
                    pedestrian.punchCooldown = 1.4f + m_Unit(m_Random) * 0.8f;
                    if (pedestrian.fleeAfterPunch) startFleeing();
                }
            } else if (playerDistance > 1.1f) {
                if (!moveAround(pedestrian, toward, (pedestrian.fleeAfterPunch ? 3.4f : 2.2f) * dt, false)) pedestrian.yaw = std::atan2(toward.x, toward.z);
            } else if (pedestrian.punchCooldown <= 0.0f) {
                pedestrian.punchTime = 0.0f;
                pedestrian.punchLanded = false;
                pedestrian.punchCross = !pedestrian.punchCross;
            } else {
                pedestrian.yaw = std::atan2(toward.x, toward.z);
            }
            continue;
        }
        if (pedestrian.fleeRemaining > 0.0f) {
            const glm::vec3 direction = glm::normalize(pedestrian.fleeDirection);
            if (!moveAround(pedestrian, direction, pedestrian.speed * 2.4f * dt, true)) {
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
        if (m_City.IsSidewalk(next.x, next.z) && !m_City.IsBlocked(next.x, next.z, 0.18f) && !IsBlocked(next, 0.2f)) {
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
    // los muertos se quedan donde cayeron mientras el jugador los tenga a la vista (los peatones se dibujan hasta 56 m)
    std::erase_if(m_Pedestrians, [&](const Pedestrian& pedestrian) { return glm::distance(pedestrian.position, playerPosition) > (pedestrian.dead ? 62.0f : 96.0f); });
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
                                                                  bus.heading, kBusLength, kBusWidth, vehicle.position, forward,
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
                                                                       bus.position, bus.heading, kBusLength, kBusWidth);
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
            // esquina por delante: se baja la velocidad para tomarla con la aceleracion lateral que permite la direccion
            float cornerLimit = std::numeric_limits<float>::max();
            {
                glm::vec3 nearPosition, nearDirection, farPosition, farDirection;
                size_t cornerWaypoint = vehicle.nextWaypoint;
                SampleCircuit(vehicle.route, vehicle.routeCumulative, routeLength, vehicle.distance + 0.5f, nearPosition, nearDirection, cornerWaypoint);
                SampleCircuit(vehicle.route, vehicle.routeCumulative, routeLength, vehicle.distance + 7.0f, farPosition, farDirection, cornerWaypoint);
                if (glm::dot(glm::vec2(nearDirection.x, nearDirection.z), glm::vec2(farDirection.x, farDirection.z)) < 0.94f) cornerLimit = 3.0f;
            }
            const bool fleeing = vehicle.driver.boost > 0.0f;
            float desiredSpeed = std::min({vehicle.cruiseSpeed * (fleeing ? 2.4f : 1.0f), std::sqrt(2.0f * braking * clearance), fleeing ? 5.0f : cornerLimit});
            if (vehicle.holdStop) desiredSpeed = 0.0f;
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
            const float previousDistance = vehicle.distance;
            vehicle.distance = vehicle.nextDistance;
            vehicle.speed = vehicle.nextSpeed;
            // Recorrido por todo el mapa: al llegar a una conexion el carro puede seguir derecho a la manzana contigua
            if (vehicle.connectorRoute >= 0) {
                if (vehicle.distance >= vehicle.connectorLength) {
                    const size_t target = static_cast<size_t>(vehicle.connectorRoute);
                    const float overshoot = vehicle.distance - vehicle.connectorLength;
                    vehicle.route = m_TrafficRoutes[target];
                    vehicle.routeCumulative = m_RouteCumulative[target];
                    vehicle.routeLength = GetCircuitLength(vehicle.route);
                    vehicle.routeIndex = target;
                    vehicle.distance = vehicle.nextDistance = vehicle.connectorTargetDistance + overshoot;
                    vehicle.connectorRoute = -1;
                }
            } else if (vehicle.routeIndex < m_RouteBranches.size() && vehicle.routeLength > 1.0f) {
                const float length = vehicle.routeLength;
                const float from = std::fmod(previousDistance, length), to = std::fmod(vehicle.distance, length);
                for (const RouteBranch& branch : m_RouteBranches[vehicle.routeIndex]) {
                    const bool crossed = from <= to ? (branch.distance > from && branch.distance <= to)
                                                    : (branch.distance > from || branch.distance <= to);
                    if (!crossed || m_Unit(m_Random) > 0.5f) continue;
                    // solo se cambia de circuito si el punto de entrada esta libre (nadie llegando por detras ni pasando por delante)
                    {
                        const float targetLength = static_cast<float>(GetCircuitLength(m_TrafficRoutes[branch.target]));
                        bool occupied = false;
                        for (const auto& other : m_Traffic) {
                            if (&other == &vehicle) continue;
                            if (other.connectorRoute == static_cast<int>(branch.target)) { occupied = true; break; }
                            if (other.routeIndex != branch.target) continue;
                            const float relative = std::fmod(other.distance - branch.targetDistance + 2.0f * targetLength, targetLength);
                            if (relative < 10.0f || relative > targetLength - 22.0f) { occupied = true; break; }
                        }
                        if (occupied) continue;
                    }
                    const float overshoot = std::fmod(vehicle.distance - branch.distance + length, length);
                    if (branch.connectorLength <= 0.01f) {
                        vehicle.route = m_TrafficRoutes[branch.target];
                        vehicle.routeCumulative = m_RouteCumulative[branch.target];
                        vehicle.routeLength = GetCircuitLength(vehicle.route);
                        vehicle.routeIndex = branch.target;
                        vehicle.distance = vehicle.nextDistance = branch.targetDistance + overshoot;
                    } else {
                        // tramo recto entre las dos manzanas: dos puntos y, al terminarlo, se pasa al circuito destino
                        vehicle.route = {branch.from, branch.to};
                        vehicle.routeCumulative = {0.0f, branch.connectorLength};
                        vehicle.routeLength = branch.connectorLength * 2.0f;
                        vehicle.routeIndex = 1000 + branch.target;   // mientras cruza no comparte "carro de adelante" con ningun circuito: se evalua por geometria
                        vehicle.connectorRoute = static_cast<int>(branch.target);
                        vehicle.connectorLength = branch.connectorLength;
                        vehicle.connectorTargetDistance = branch.targetDistance;
                        vehicle.distance = vehicle.nextDistance = overshoot;
                    }
                    break;
                }
            }
            vehicle.forcingRemaining = std::max(0.0f, vehicle.forcingRemaining - stepTime);
            vehicle.driver.boost = std::max(0.0f, vehicle.driver.boost - stepTime);
            const bool legitimateStop = vehicle.waitingAtSignal || vehicle.blockedForPerson || vehicle.holdStop;
            vehicle.stalledTime = (vehicle.speed < 0.1f && !legitimateStop) ? vehicle.stalledTime + stepTime : 0.0f;
            vehicle.wheelRotation -= vehicle.speed * stepTime / 0.33f;
            SampleCircuit(vehicle.route, vehicle.routeCumulative, vehicle.routeLength, vehicle.distance,
                          vehicle.position, vehicle.direction, vehicle.nextWaypoint);
            vehicle.horizontalLane = std::abs(vehicle.direction.x) > std::abs(vehicle.direction.z);
            vehicle.laneCoordinate = vehicle.horizontalLane ? vehicle.position.z : vehicle.position.x;
            vehicle.yaw = std::atan2(-vehicle.direction.z, vehicle.direction.x);
            StepVehicleKinematics(vehicle, stepTime);
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
                    return OrientedBoxesOverlap(probe, bus.heading, kBusLength, kBusWidth,
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
                && Viaduct::Height(bus.position.z + bus.direction * kBusHalfLength) > Viaduct::kElevated;
            const auto actorClearance = [&](const glm::vec3& actor) {
                if (busOverStreet) return std::numeric_limits<float>::infinity();
                const glm::vec2 fromBus(actor.x - bus.position.x, actor.z - bus.position.z);
                const float sideways = fromBus.x * -bus.heading.y + fromBus.y * bus.heading.x;
                if (std::abs(sideways) > kBusWidth * 0.5f + 0.55f) return std::numeric_limits<float>::infinity();
                const float aheadOfBus = glm::dot(fromBus, bus.heading);   // >0: delante del bus
                if (aheadOfBus < -(kBusHalfLength + 0.55f)) return std::numeric_limits<float>::infinity();
                return std::max(0.0f, aheadOfBus - kBusHalfLength - 0.8f);
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
        if (HitsProp(position.x, position.z, radius)) return true;
        for (const auto& vehicle : m_Traffic) {
            if (collidesWithVehicle(vehicle)) return true;
        }
        for (const auto& vehicle : m_ParkedCars) {
            if (collidesWithVehicle(vehicle)) return true;
        }
    }
    for (const BusState& bus : m_Buses) {
        if (std::abs(position.y - bus.position.y) < 2.5f
            && PointInVehicleBox(position, bus.position, bus.heading, kBusHalfLength, kBusWidth * 0.5f, radius)) {
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
                                                kBusHalfLength, kBusWidth * 0.5f, 0.4f);
        for (int sample = 0; !frontContact && sample <= 8; ++sample) {
            const float fraction = static_cast<float>(sample) / 8.0f;
            const glm::vec3 sweptPosition = glm::mix(bus.previousPosition, bus.position, fraction);
            frontContact = PointAtVehicleFront(position, sweptPosition, bus.heading,
                                               kBusHalfLength, kBusWidth * 0.5f, 0.4f);
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

        // Anillo naranja que brilla y palpita para llamar la atencion sobre el sitio del cambuche
        if (m_CambucheRingMesh && m_CambucheGlowMesh) {
            const float pulse = 0.5f + 0.5f * std::sin(time * 2.4f);
            const glm::mat4 ringMat = glm::translate(glm::mat4(1.0f), m_CambuchePosition + glm::vec3(0.0f, m_City.GetGroundHeight(m_CambuchePosition.x, m_CambuchePosition.z) + 0.05f, 0.0f));
            renderer.SetUnlit(true);
            renderer.Submit(*m_CambucheGlowMesh, glm::scale(ringMat, glm::vec3(1.0f + 0.08f * pulse)), glm::vec4(1.0f, 1.0f, 1.0f, 0.35f + 0.45f * pulse), false, true, nullptr, 2);
            renderer.Submit(*m_CambucheRingMesh, ringMat, glm::vec4(1.0f, 1.0f, 1.0f, 0.55f + 0.4f * pulse), false, true, nullptr, 2);
            renderer.SetUnlit(false);
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
    // el viento (Climate) mece los arboles: brisa suave siempre y mas amplitud con vientos fuertes
    const float treeSway = m_ReducedWeather ? 0.0f : 0.04f + 0.22f * m_Wind;
    for (const auto& position : m_TreePositions) {
        if (glm::distance(glm::vec2(focusPosition.x, focusPosition.z),
                          glm::vec2(position.x, position.z)) > 60.0f) continue;
        if (m_TreeModel) {
            renderer.SetSway(treeSway);
            m_TreeModel->Draw(renderer, glm::translate(glm::mat4(1.0f), position) * m_TreeModelFit);
            renderer.SetSway(0.0f);
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
        if (m_BirdModels[pigeon.modelIndex] && m_BirdParts[pigeon.modelIndex][0]) {
            const glm::mat4 fit = bird * m_BirdModelFits[pigeon.modelIndex];
            const auto& parts = m_BirdParts[pigeon.modelIndex];
            // Articulaciones en el espacio del modelo (glTF: Y arriba, el frente hacia +Z, las alas sobre X), medidas en Blender
            // al separar las piezas: hombro y codo de cada ala, cadera de cada pata y base del cuello.
            struct Rig { glm::vec3 shoulder, elbow, hip, neck; float stride; float peck; };
            static const Rig rigs[2] = {
                {{0.045f, 0.0631f, 0.0f}, {0.105f, 0.0660f, 0.0f}, {0.015f, 0.018f, 0.007f}, {0.0f, 0.05f, 0.045f}, 0.50f, 0.9f},
                {{0.10f, 0.1807f, 0.04f}, {0.38f, 0.1782f, 0.04f}, {0.045f, 0.0870f, 0.03f}, {0.0f, 0.1870f, 0.16f}, 0.45f, 0.8f}};
            const Rig& rig = rigs[pigeon.modelIndex];
            const auto pivot = [](const glm::mat4& base, const glm::vec3& at, const glm::mat4& motion) {
                return base * glm::translate(glm::mat4(1.0f), at) * motion * glm::translate(glm::mat4(1.0f), -at);
            };
            // Cuanto estan plegadas las alas: posada, siempre; al despegar se abren y al aterrizar se recogen
            const float elapsed = pigeon.flightDuration - pigeon.flightRemaining;
            float fold = 1.0f;
            if (flying) {
                const float opening = 1.0f - glm::smoothstep(0.0f, 0.30f, elapsed);
                const float closing = glm::smoothstep(pigeon.flightDuration - 0.40f, pigeon.flightDuration - 0.05f, elapsed);
                fold = std::max(opening, closing);
            }
            glm::mat4 body = fit;
            float shoulderAngle = 0.0f, wristAngle = 0.0f;
            float legSwing[2] = {0.0f, 0.0f}, legLift[2] = {0.0f, 0.0f};
            float headYaw = 0.0f, headPitch = 0.0f, headThrust = 0.0f;
            if (flying) {
                // Ciclo real de aleteo: la bajada es la fase de potencia y la subida recoge el ala doblando la muneca; la punta
                // va retrasada respecto al hombro. Despegando y aterrizando bate con toda la amplitud; en crucero alterna
                // rachas de aleteo con planeo (alas extendidas con un leve diedro).
                const float progress = pigeon.flightDuration > 0.001f ? elapsed / pigeon.flightDuration : 0.0f;
                const float cycle = time * pigeon.flapRate * 0.85f + pigeon.phase;
                const float glideWave = std::sin(progress * 6.2831853f * (1.5f + std::fmod(pigeon.phase, 1.0f)) + pigeon.phase * 3.0f);
                const bool cruising = pigeon.flightDuration > 2.2f && progress > 0.22f && progress < 0.78f;
                const float glide = cruising ? glm::smoothstep(0.35f, 0.75f, glideWave) : 0.0f;
                const float amplitude = glm::mix(1.0f, 0.12f, glide);
                const float phaseSin = std::sin(cycle), phaseCos = std::cos(cycle);
                shoulderAngle = (0.62f * amplitude * phaseSin + 0.10f + 0.12f * glide) * (1.0f - fold);
                wristAngle = ((phaseCos > 0.0f ? -0.85f : -0.30f) * phaseCos * amplitude + 0.05f - 0.04f * glide) * (1.0f - fold);
                body = body * glm::translate(glm::mat4(1.0f), {0.0f, 0.012f * amplitude * (-phaseSin), 0.0f});
                // patas recogidas hacia atras en vuelo y cuello estirado
                legSwing[0] = legSwing[1] = 1.05f * (1.0f - fold);
                headPitch = -0.08f;
            } else {
                // Posada: vigila girando la cabeza con pausas; en el suelo picotea y, al andar, avanza las patas alternadas
                headYaw = pigeon.lookYaw;
                headPitch = 0.12f * std::sin(pigeon.phase * 0.9f) + (pigeon.perch == BirdPerch::Ground ? 0.0f : 0.05f);
                if (pigeon.peckTimer > 0.0f) {
                    const float peckPhase = 1.0f - pigeon.peckTimer / 0.9f;
                    headPitch += rig.peck * std::pow(std::abs(std::sin(6.2831853f * peckPhase)), 0.8f);
                    headYaw *= 0.2f;
                }
                if (pigeon.walkSpeed > 0.05f) {
                    for (int leg = 0; leg < 2; ++leg) {
                        const float legPhase = pigeon.walkCycle + (leg == 0 ? 0.0f : 3.14159265f);
                        legSwing[leg] = rig.stride * std::sin(legPhase);
                        legLift[leg] = 0.012f * std::max(0.0f, std::cos(legPhase));
                    }
                    headThrust = 0.012f * std::sin(pigeon.walkCycle);   // cabeceo hacia delante y atras al caminar
                    body = body * glm::translate(glm::mat4(1.0f), {0.0f, 0.004f * std::abs(std::sin(pigeon.walkCycle)), 0.0f});
                }
            }
            parts[0]->Draw(renderer, body);
            // cabeza y cuello: giro de vigilancia, picoteo y cabeceo de marcha desde la base del cuello
            parts[1]->Draw(renderer, pivot(body, rig.neck,
                glm::translate(glm::mat4(1.0f), {0.0f, 0.0f, headThrust})
                * glm::rotate(glm::mat4(1.0f), headYaw, {0.0f, 1.0f, 0.0f})
                * glm::rotate(glm::mat4(1.0f), headPitch, {1.0f, 0.0f, 0.0f})));
            for (int sideIndex = 0; sideIndex < 2; ++sideIndex) {
                const float side = sideIndex == 0 ? -1.0f : 1.0f;   // izquierda -X, derecha +X
                const glm::vec3 hip(side * rig.hip.x, rig.hip.y, rig.hip.z);
                parts[2 + sideIndex]->Draw(renderer, pivot(body, hip,
                    glm::translate(glm::mat4(1.0f), {0.0f, legLift[sideIndex], 0.0f})
                    * glm::rotate(glm::mat4(1.0f), legSwing[sideIndex], {1.0f, 0.0f, 0.0f})));
                const glm::vec3 shoulder(side * rig.shoulder.x, rig.shoulder.y, rig.shoulder.z);
                const glm::vec3 elbow(side * rig.elbow.x, rig.elbow.y, rig.elbow.z);
                // ala extendida y batiendo (rotacion sobre el eje del cuerpo) ...
                const glm::mat4 flap = glm::rotate(glm::mat4(1.0f), side * shoulderAngle, {0.0f, 0.0f, 1.0f});
                const glm::mat4 flapWrist = glm::rotate(glm::mat4(1.0f), side * wristAngle, {0.0f, 0.0f, 1.0f});
                // ... o recogida: gira hacia atras sobre el hombro, se apoya de canto sobre el costado y se estrecha, y la parte
                // exterior se dobla sobre la interior en el codo
                const glm::mat4 folded = glm::rotate(glm::mat4(1.0f), side * 1.50f * fold, {0.0f, 1.0f, 0.0f})
                    * glm::rotate(glm::mat4(1.0f), 1.35f * fold, {1.0f, 0.0f, 0.0f})
                    * glm::scale(glm::mat4(1.0f), {1.0f, 1.0f, glm::mix(1.0f, 0.38f, fold)});
                const glm::mat4 inner = pivot(body, shoulder, folded * flap);
                const glm::mat4 outer = pivot(inner, elbow, glm::translate(glm::mat4(1.0f), {0.0f, 0.004f * fold, 0.0f})
                    * glm::rotate(glm::mat4(1.0f), side * 3.05f * fold, {0.0f, 1.0f, 0.0f}) * flapWrist);
                parts[4 + sideIndex * 2]->Draw(renderer, inner);
                parts[5 + sideIndex * 2]->Draw(renderer, outer);
            }
            continue;
        }
        if (flying && m_BirdModels[pigeon.modelIndex]) {
            m_BirdModels[pigeon.modelIndex]->Draw(renderer, bird * m_BirdModelFits[pigeon.modelIndex]);
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
            {0.659f, 0.396f, 0.180f, 1.0f}, {0.361f, 0.227f, 0.133f, 1.0f},   // canela y chocolate
            {0.490f, 0.471f, 0.447f, 1.0f}, {0.180f, 0.161f, 0.145f, 1.0f}    // gris y negro
        }};
        const glm::vec4 coat = coats[static_cast<size_t>(std::clamp(m_DogCoat, 0, 3))];
        glm::mat4 dog = glm::translate(glm::mat4(1.0f), m_DogPosition);
        dog = glm::rotate(dog, m_DogYaw, {0.0f, 1.0f, 0.0f});
        dog = glm::scale(dog, glm::vec3(m_DogSize));
        if (m_ChatoModel) {
            // cola: se mueve mas rapido y amplio si esta contento; dormido no se mueve
            std::vector<Model::BoneTurn> tail;
            {
                const float asleep = m_DogPosture == DogPosture::Sleep ? 0.0f : m_DogPosture == DogPosture::Lie ? 0.5f : 1.0f;
                const float mood = (m_DogIsFriend ? 0.30f + m_DogHappy * 0.70f : 0.10f) * asleep;
                const float rate = m_DogIsFriend ? 6.0f + m_DogHappy * 7.0f : 3.0f;
                for (int k = 0; k < 4; ++k) {
                    glm::vec3 turn(0.0f);
                    turn[m_DogRig.tailAxis] = std::sin(m_DogTime * rate - 0.55f * static_cast<float>(k)) * mood * (k == 0 ? 0.30f : 0.26f);
                    tail.push_back({m_DogRig.tail[static_cast<size_t>(k)], turn, {0.0f, 0.0f, 0.0f}});
                }
            }
            const float fade = m_DogFade * m_DogFade * (3.0f - 2.0f * m_DogFade);
            // sin la textura tenida el pelaje es el natural del modelo; los otros colores lo tiñen
            const glm::vec4 chatoCoat = m_DogCoat == 0 ? glm::vec4(1.0f) : glm::min(coat * 1.9f, glm::vec4(1.0f));
            // en estas posturas la malla queda 1,6-2,1 cm bajo el suelo (medido sobre los clips): se sube lo justo para que apoye sin flotar
            const auto groundLift = [&](int clip) {
                if (clip == m_DogClips.sit || clip == m_DogClips.sitStart || clip == m_DogClips.sitEnd) return m_DogRig.liftSit;
                if (clip == m_DogClips.lie || clip == m_DogClips.lieStart || clip == m_DogClips.lieEnd) return m_DogRig.liftLie;
                if (clip == m_DogClips.sleep || clip == m_DogClips.sleepStart || clip == m_DogClips.sleepEnd) return m_DogRig.liftSleep;
                return m_DogRig.liftOther;
            };
            const float lift = glm::mix(groundLift(m_DogClip), m_DogPrevClip >= 0 ? groundLift(m_DogPrevClip) : groundLift(m_DogClip), fade);
            dog = glm::translate(dog, glm::vec3(0.0f, lift, 0.0f));
            m_ChatoModel->Draw(renderer, dog, glm::vec4(1.0f), m_DogClipTime, true, m_DogClip, -1, false, chatoCoat, m_DogPrevClip, fade, &tail, m_DogPrevTime);
            const auto bone = [&](const char* name) {
                return dog * m_ChatoModel->GetNodeWorld(name, m_DogClipTime, true, m_DogClip, m_DogPrevClip, fade, &tail, m_DogPrevTime);
            };
            const glm::vec3 neck = glm::vec3(bone(m_DogRig.neck)[3]);
            const glm::vec3 head = glm::vec3(bone(m_DogRig.head)[3]);
            const glm::mat4 facing = glm::rotate(glm::translate(glm::mat4(1.0f), glm::vec3(0.0f)), m_DogYaw, {0.0f, 1.0f, 0.0f});
            const auto at = [&](const glm::vec3& position, const glm::vec3& offset) { return glm::translate(glm::mat4(1.0f), position) * facing * glm::translate(glm::mat4(1.0f), offset * m_DogSize); };
            if (m_DogAccessory == 1) renderer.Submit(*m_DogScarf, at(neck, {0.0f, 0.0f, 0.0f}));
            else if (m_DogAccessory == 3) renderer.Submit(*m_DogBand, at(neck, {0.0f, 0.0f, 0.0f}));
            else if (m_DogAccessory == 2) {
                renderer.Submit(*m_DogCap, at(head, {0.0f, 0.07f, 0.0f}));
                renderer.Submit(*m_DogVisor, at(head, {0.0f, 0.045f, 0.12f}));
            }
        } else if (m_DogModel) {
            const std::vector<Model::BoneTurn> pose = BuildDogPose();
            m_DogModel->Draw(renderer, dog, glm::vec4(1.0f), 0.0f, false, 0, -1, false, coat, -1, 0.0f, &pose);
            // accesorios: siguen al cuello y la cabeza en la pose actual (sentado, echado, olfateando)
            const glm::mat4 neck = dog * m_DogModel->GetNodeWorld("cuello", 0.0f, false, 0, -1, 0.0f, &pose);
            const glm::mat4 head = dog * m_DogModel->GetNodeWorld("cabeza", 0.0f, false, 0, -1, 0.0f, &pose);
            if (m_DogAccessory == 1) renderer.Submit(*m_DogScarf, glm::translate(neck, {0.0f, 0.0f, 0.06f}));
            else if (m_DogAccessory == 3) renderer.Submit(*m_DogBand, glm::translate(neck, {0.0f, 0.0f, 0.06f}));
            else if (m_DogAccessory == 2) {
                renderer.Submit(*m_DogCap, glm::translate(head, {0.0f, 0.13f, 0.02f}));
                renderer.Submit(*m_DogVisor, glm::translate(head, {0.0f, 0.10f, 0.15f}));
            }
        } else if (m_PetModel) {
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
        // los carros a mas de 140 m quedan tras la niebla: no se dibujan (ahorra decenas de dibujos con sus ruedas y ocupantes)
        if (glm::distance(glm::vec2(vehicle.position.x, vehicle.position.z), glm::vec2(focusPosition.x, focusPosition.z)) > 140.0f) return;
        // Pose visual: en las esquinas el carro no gira de golpe. Se promedia la ruta un poco antes y un poco despues (corta la
        // esquina en una curva) y la direccion sale de esos dos puntos; las ruedas delanteras se orientan hacia donde va la ruta.
        glm::vec3 visualPosition = vehicle.position;
        float visualYaw = vehicle.yaw, steer = 0.0f;
        if (!vehicle.parked && vehicle.bike.ready) {
            // pose del modelo de bicicleta: el rumbo y la posicion salen de integrar la direccion; las delanteras viran con su angulo real
            BicycleParams bikeParams;
            bikeParams.wheelbase = std::max(1.2f, vehicle.wheelbase);
            const glm::vec2 center = vehicle.bike.Center(bikeParams);
            visualPosition = {center.x, vehicle.position.y, center.y};
            visualYaw = vehicle.bike.Yaw();
            steer = -vehicle.bike.steer;   // el angulo del modelo crece con el rumbo (antihorario); las llantas se giran con el yaw
        } else if (!vehicle.parked && vehicle.routeLength > 1.0f && !vehicle.route.empty()) {
            glm::vec3 behind, ahead, near, lookahead, directionTemp;
            size_t waypoint = 0;
            const float span = 1.9f, look = 3.2f;
            SampleCircuit(vehicle.route, vehicle.routeCumulative, vehicle.routeLength, vehicle.distance - span, behind, directionTemp, waypoint);
            SampleCircuit(vehicle.route, vehicle.routeCumulative, vehicle.routeLength, vehicle.distance + span, ahead, directionTemp, waypoint);
            SampleCircuit(vehicle.route, vehicle.routeCumulative, vehicle.routeLength, vehicle.distance, near, directionTemp, waypoint);
            SampleCircuit(vehicle.route, vehicle.routeCumulative, vehicle.routeLength, vehicle.distance + look, lookahead, directionTemp, waypoint);
            const glm::vec3 chord = ahead - behind;
            if (glm::dot(chord, chord) > 1.0e-4f) {
                visualYaw = std::atan2(-chord.z, chord.x);
                visualPosition = (behind + ahead) * 0.5f;
                visualPosition.y = vehicle.position.y;
                const glm::vec3 turn = lookahead - near;
                if (glm::dot(turn, turn) > 1.0e-4f) {
                    float difference = std::atan2(-turn.z, turn.x) - visualYaw;
                    difference = std::remainder(difference, glm::two_pi<float>());
                    steer = std::clamp(difference * 0.9f, -0.55f, 0.55f);
                }
            }
        }
        glm::mat4 model = glm::translate(glm::mat4(1.0f), visualPosition);
        model = glm::rotate(model, visualYaw, {0.0f, 1.0f, 0.0f});
        const size_t emergencySlot = vehicle.emergency > 0 ? static_cast<size_t>(vehicle.emergency - 1) : 0;
        const std::shared_ptr<Model>& imported = vehicle.emergency > 0 ? m_EmergencyModels[emergencySlot] : vehicle.taxi ? m_TaxiModel : m_CarModel;
        const glm::mat4& fit = vehicle.emergency > 0 ? m_EmergencyFits[emergencySlot] : vehicle.taxi ? m_TaxiModelFit : m_CarModelFit;
        const size_t partsSlot = vehicle.emergency > 0 ? static_cast<size_t>(1 + vehicle.emergency) : vehicle.taxi ? 1 : 0;
        const VehicleParts& parts = m_VehicleParts[partsSlot];
        const VehicleParts& cabinParts = m_VehicleParts[vehicle.variant > 0 ? 4 + static_cast<size_t>(vehicle.variant) : 0];
        if (vehicle.variant > 0 && vehicle.emergency == 0 && cabinParts.valid() && cabinParts.ownFit) {
            // modelo con cabina: vidrio translucido y ocupantes sentados
            const glm::mat4 carFit = model * cabinParts.fit;
            // la pintura de cada carro es una de ocho (la misma que ya tenian los modelos anteriores); las texturas propias no se tiñen
            static const std::array<glm::vec3, 8> bodyPaints{{
                {1.00f, 1.00f, 1.00f}, {0.80f, 0.82f, 0.86f}, {0.32f, 0.34f, 0.40f}, {0.95f, 0.22f, 0.18f},
                {0.28f, 0.45f, 1.00f}, {0.30f, 0.80f, 0.42f}, {1.00f, 0.60f, 0.20f}, {0.95f, 0.86f, 0.68f}}};
            static const std::array<glm::vec3, 8> assignedPaints{{
                {0.91f, 0.91f, 0.90f}, {0.73f, 0.75f, 0.77f}, {0.11f, 0.12f, 0.13f}, {0.48f, 0.08f, 0.08f},
                {0.12f, 0.24f, 0.42f}, {0.30f, 0.35f, 0.23f}, {0.55f, 0.56f, 0.57f}, {0.82f, 0.79f, 0.70f}}};
            size_t paintPick = 0;
            float paintBest = 1.0e9f;
            for (size_t index = 0; index < assignedPaints.size(); ++index) {
                const float distance = glm::distance(assignedPaints[index], vehicle.color);
                if (distance < paintBest) { paintBest = distance; paintPick = index; }
            }
            const glm::vec4 paintTint = vehicle.taxi ? glm::vec4(1.0f, 0.82f, 0.18f, 1.0f) : glm::vec4(bodyPaints[paintPick], 1.0f);
            cabinParts.body->Draw(renderer, carFit, glm::vec4(1.0f), 0.0f, false, 0, -1, false, paintTint);
            if (cabinParts.door) {
                // la puerta se abre y cierra encadenada con la animacion del conductor (los mismos fotogramas que usan sus manos)
                float doorAngle = 0.0f;
                const float frame = vehicle.driver.timer * 24.0f;
                constexpr float kOpen = 62.0f;   // misma apertura y fotogramas que car_clips.py (door_angle_enter / door_angle_exit)
                if (vehicle.driver.state == DriverState::Entering) {
                    doorAngle = frame < 12.0f ? 0.0f : frame < 22.0f ? 28.0f * (frame - 12.0f) / 10.0f
                              : frame < 34.0f ? 28.0f + (kOpen - 28.0f) * (frame - 22.0f) / 12.0f : frame < 92.0f ? kOpen
                              : frame < 108.0f ? kOpen * (1.0f - (frame - 92.0f) / 16.0f) : 0.0f;
                } else if (vehicle.driver.state == DriverState::Exiting) {
                    doorAngle = frame < 4.0f ? 0.0f : frame < 16.0f ? kOpen * (frame - 4.0f) / 12.0f : frame < 104.0f ? kOpen
                              : frame < 109.0f ? kOpen - 12.0f * (frame - 104.0f) / 5.0f
                              : frame < 130.0f ? (kOpen - 12.0f) * (1.0f - (frame - 109.0f) / 21.0f) : 0.0f;
                }
                glm::mat4 doorModel = glm::translate(carFit, cabinParts.doorHinge);
                doorModel = glm::rotate(doorModel, -glm::radians(doorAngle), glm::vec3(0.0f, 1.0f, 0.0f));   // el borde trasero sale hacia el lado del conductor (+X del modelo)
                doorModel = glm::translate(doorModel, -cabinParts.doorHinge);
                cabinParts.door->Draw(renderer, doorModel, glm::vec4(1.0f), 0.0f, false, 0, -1, false, paintTint);
            }
            const float roll = -vehicle.wheelRotation * 0.33f / (cabinParts.wheels.front().radius * cabinParts.scale);
            for (const VehicleParts::Wheel& wheel : cabinParts.wheels) {
                glm::mat4 motion = glm::translate(glm::mat4(1.0f), wheel.center);
                if (wheel.front) motion = glm::rotate(motion, steer, glm::vec3(0.0f, 1.0f, 0.0f));
                motion = glm::rotate(motion, roll, cabinParts.rollAxis);
                motion = glm::translate(motion, -wheel.center);
                wheel.model->Draw(renderer, carFit * motion);
            }
            if (!vehicle.parked && !m_PedestrianAppearances.empty()
                && glm::distance(glm::vec2(vehicle.position.x, vehicle.position.z), glm::vec2(focusPosition.x, focusPosition.z)) < 30.0f) {
                const size_t carIndex = static_cast<size_t>(&vehicle - m_Traffic.data());
                for (size_t seatIndex = 0; seatIndex < cabinParts.seats.size(); ++seatIndex) {
                    const VehicleParts::Seat& seat = cabinParts.seats[seatIndex];
                    const uint32_t hash = static_cast<uint32_t>((seatIndex + 1) * 2654435761u) ^ static_cast<uint32_t>((carIndex + 11) * 40503u);
                    if (seat.driver) continue;                                                  // el conductor lo dibuja su animacion
                    const bool frontPassenger = seatIndex == 1;
                    if (vehicle.driver.state == DriverState::Abandoned || vehicle.driver.state == DriverState::Swapping) continue;   // se bajaron o ya manejan
                    if (frontPassenger) { if (!vehicle.driver.hasPassenger) continue; }
                    else if ((hash >> 11) % 100u >= 40u) continue;                            // pasajeros traseros: reparto fijo
                    const size_t appearanceIndex = frontPassenger ? vehicle.driver.passengerAppearance % m_PedestrianAppearances.size() : (hash >> 5) % m_PedestrianAppearances.size();
                    const PedestrianAppearance& appearance = m_PedestrianAppearances[appearanceIndex];
                    const glm::vec3 clothes = frontPassenger ? vehicle.driver.passengerColor : glm::vec3(0.45f, 0.40f, 0.35f);
                    const float shadeOffset = frontPassenger ? vehicle.driver.passengerShade : static_cast<float>(hash & 255u) * 0.0371f;
                    glm::mat4 person = glm::translate(carFit, seat.position);
                    person = glm::scale(person, glm::vec3(1.0f / cabinParts.scale));
                    person = glm::rotate(person, seat.yaw, glm::vec3(0.0f, 1.0f, 0.0f));
                    person = glm::scale(person, glm::vec3(0.95f));
                    person = glm::translate(person, glm::vec3(0.0f, -0.93f, 0.0f));
                    for (size_t partIndex = 0; partIndex < appearance.parts.size(); ++partIndex) {
                        const auto& part = appearance.parts[partIndex];
                        if (part) part->Draw(renderer, person, PedestrianPartTint(appearance, partIndex, clothes, shadeOffset), time + shadeOffset,
                                             appearance.sitClip >= 0, appearance.sitClip, -1, true);
                    }
                }
            }
        } else if (imported && parts.valid()) {
            // carroceria fija y ruedas articuladas: giran al rodar y las delanteras tambien viran
            glm::mat4 bodyModel = model;
            if (vehicle.emergency == 3) bodyModel = glm::rotate(bodyModel, -steer * std::min(1.0f, vehicle.speed / 3.0f) * 0.45f, {1.0f, 0.0f, 0.0f});   // la moto se inclina al girar
            // los taxis son de color amarillo: el modelo es plateado y se tiñe
            // Pintura: el modelo es plateado y se tiñe. Los taxis van de amarillo y los carros comunes toman uno de ocho colores segun
            // su pintura (la misma para cada carro, parqueado o en circulacion); los vehiculos de emergencia conservan su textura.
            glm::vec4 paint(1.0f);
            if (vehicle.taxi) {
                paint = {1.0f, 0.82f, 0.18f, 1.0f};
            } else if (vehicle.emergency == 0) {
                static const std::array<glm::vec3, 8> bodyColors{{
                    {1.00f, 1.00f, 1.00f},   // blanco
                    {0.80f, 0.82f, 0.86f},   // plata
                    {0.32f, 0.34f, 0.40f},   // grafito
                    {0.95f, 0.22f, 0.18f},   // rojo
                    {0.28f, 0.45f, 1.00f},   // azul
                    {0.30f, 0.80f, 0.42f},   // verde
                    {1.00f, 0.60f, 0.20f},   // naranja
                    {0.95f, 0.86f, 0.68f}}}; // arena
                // la pintura asignada al carro (una de ocho) elige su color: se busca la mas cercana de la lista original
                static const std::array<glm::vec3, 8> assigned{{
                    {0.91f, 0.91f, 0.90f}, {0.73f, 0.75f, 0.77f}, {0.11f, 0.12f, 0.13f}, {0.48f, 0.08f, 0.08f},
                    {0.12f, 0.24f, 0.42f}, {0.30f, 0.35f, 0.23f}, {0.55f, 0.56f, 0.57f}, {0.82f, 0.79f, 0.70f}}};
                size_t pick = 0;
                float best = 1.0e9f;
                for (size_t index = 0; index < assigned.size(); ++index) {
                    const float distance = glm::distance(assigned[index], vehicle.color);
                    if (distance < best) { best = distance; pick = index; }
                }
                static const std::array<size_t, 8> colorOf{{0, 1, 2, 3, 4, 5, 6, 7}};
                pick = colorOf[pick];
                paint = glm::vec4(bodyColors[pick], 1.0f);
            }
            parts.body->Draw(renderer, bodyModel * fit, paint);
            const float scale = glm::length(glm::vec3(fit * glm::vec4(parts.forward, 0.0f)));
            const float roll = scale > 1.0e-4f ? -vehicle.wheelRotation * 0.33f / (parts.wheels.front().radius * scale) : 0.0f;
            for (const VehicleParts::Wheel& wheel : parts.wheels) {
                glm::mat4 motion = glm::translate(glm::mat4(1.0f), wheel.center);
                if (wheel.front) motion = glm::rotate(motion, steer, glm::vec3(0.0f, 1.0f, 0.0f));
                motion = glm::rotate(motion, roll, parts.rollAxis);
                motion = glm::translate(motion, -wheel.center);
                wheel.model->Draw(renderer, bodyModel * fit * motion);
            }
        } else if (imported) {
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
        if (vehicle.mirrorsAvailable && vehicle.emergency == 0) {
            for (float side : {-1.0f, 1.0f}) {
                renderer.Submit(*m_CarMirrorMesh, glm::translate(model, {0.82f, 1.02f, side * 0.98f}));
                glm::mat4 glass = glm::translate(model, {0.75f, 1.02f, side * 0.98f});
                renderer.Submit(*m_CarMirrorGlass, glass);
            }
        }
        // Conductor o motociclista: sentado manejando, o con la animacion de bajarse y subirse ajustada a este vehiculo
        if (!vehicle.parked && !m_PedestrianAppearances.empty() && vehicle.driver.state != DriverState::OnFoot
            && vehicle.driver.state != DriverState::Returning && vehicle.driver.state != DriverState::Abandoned
            && glm::distance(glm::vec2(vehicle.position.x, vehicle.position.z), glm::vec2(focusPosition.x, focusPosition.z)) < 40.0f) {
            const PedestrianAppearance& appearance = m_PedestrianAppearances[vehicle.driver.appearance % m_PedestrianAppearances.size()];
            const bool moto = vehicle.emergency == 3;
            const DriverProfile profile = ProfileFor(vehicle);
            const std::string suffix = profile.suffix.empty() ? std::string() : "_" + profile.suffix;
            std::string clipName;
            float clipTime = 0.0f;
            glm::vec2 anchor = profile.seat;
            float anchorYaw = glm::half_pi<float>();       // sentado mira al frente del vehiculo
            switch (vehicle.driver.state) {
                case DriverState::Exiting:
                    clipName = (moto ? "BikeDismount" : "CarExit") + suffix;
                    clipTime = vehicle.driver.timer; anchor = profile.stance; anchorYaw = 0.0f;
                    break;
                case DriverState::Swapping:
                    clipName = "CarSwap" + suffix;
                    clipTime = vehicle.driver.timer;
                    break;
                case DriverState::Entering:
                    clipName = (moto ? "BikeMount" : "CarEnter") + suffix;
                    clipTime = vehicle.driver.timer; anchor = profile.stance; anchorYaw = 0.0f;
                    break;
                default:
                    clipName = (moto ? "BikeRide" : "CarDrive") + suffix;
                    clipTime = time + static_cast<float>(vehicle.driver.appearance % 97) * 0.13f;
                    break;
            }
            glm::mat4 person = model * glm::translate(glm::mat4(1.0f), glm::vec3(anchor.x, 0.0f, -anchor.y));
            person = glm::rotate(person, anchorYaw, glm::vec3(0.0f, 1.0f, 0.0f));
            // la cabeza no puede sobresalir del techo: si el techo es bajo, el ocupante se hunde un poco en el asiento y se encoge lo justo
            if (!moto && profile.roofZ > 0.0f && profile.hipsZ > 0.0f) {
                constexpr float kHeadAboveHips = 0.75f, kHeadroom = 0.06f, kMaxSink = 0.05f;
                const float need = profile.hipsZ + kHeadAboveHips - (profile.roofZ - kHeadroom);
                if (need > 0.0f) {
                    const float sink = std::min(need, kMaxSink);
                    const float fit = std::clamp(1.0f - (need - sink) / kHeadAboveHips, 0.82f, 1.0f);
                    float weight = 1.0f;   // al bajar o subir se recupera el tamano normal para no dar un salto
                    if (vehicle.driver.state == DriverState::Exiting) weight = 1.0f - glm::smoothstep(0.0f, 1.2f, vehicle.driver.timer);
                    else if (vehicle.driver.state == DriverState::Entering) weight = glm::smoothstep(3.2f, 4.4f, vehicle.driver.timer);
                    const float s = 1.0f + (fit - 1.0f) * weight;
                    person = glm::translate(person, glm::vec3(0.0f, -sink * weight, 0.0f));
                    person = glm::translate(person, glm::vec3(0.0f, profile.hipsZ, 0.0f));
                    person = glm::scale(person, glm::vec3(s));
                    person = glm::translate(person, glm::vec3(0.0f, -profile.hipsZ, 0.0f));
                }
            }
            for (size_t partIndex = 0; partIndex < appearance.parts.size(); ++partIndex) {
                const auto& part = appearance.parts[partIndex];
                if (!part) continue;
                int clip = part->FindAnimationClip(clipName);
                if (clip < 0 && !suffix.empty()) clip = part->FindAnimationClip(clipName.substr(0, clipName.size() - suffix.size()));   // sin perfil propio: clip de referencia
                if (clip < 0) continue;
                part->Draw(renderer, person, PedestrianPartTint(appearance, partIndex, vehicle.driver.color, vehicle.driver.shade), clipTime, true, clip, -1, false);
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
        if (m_ArticulatedBus.valid()) {
            DrawArticulatedBus(renderer, bus, static_cast<size_t>(&bus - m_Buses.data()), busOpacity, time, focusPosition);
        } else if (m_BusModel) {
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
        // los peatones asustados corren y los que esperan alternan dos reposos (mas natural)
        const bool relaxedIdle = appearance.relaxedClip >= 0 && std::fmod(pedestrian.animationOffset * 7.31f, 1.0f) < 0.5f;
        int clip = pedestrian.moving ? (pedestrian.fleeRemaining > 0.0f && appearance.runClip >= 0 ? appearance.runClip : appearance.walkClip)
                                     : (relaxedIdle ? appearance.relaxedClip : appearance.idleClip);
        float clipTime = pedestrian.animationTime + pedestrian.animationOffset;
        if (pedestrian.reaction > 0) {
            // golpes en la cara, el pecho o las piernas; la patada los derriba (caida, tendido y levantarse)
            clipTime = pedestrian.reactionTime;
            if (pedestrian.reaction == 1) clip = appearance.hitFaceClip;
            else if (pedestrian.reaction == 2) clip = appearance.hitChestClip;
            else if (pedestrian.reaction == 3) clip = appearance.hitLegsClip;
            else if (pedestrian.dead && pedestrian.reactionTime >= 0.833f) { clip = appearance.lyingClip; clipTime = pedestrian.reactionTime - 0.833f; }
            else if (pedestrian.reactionTime < 0.833f) clip = appearance.fallClip;
            else if (pedestrian.reactionTime < 1.733f) { clip = appearance.lyingClip; clipTime = pedestrian.reactionTime - 0.833f; }
            else { clip = appearance.getUpClip; clipTime = pedestrian.reactionTime - 1.733f; }
        } else if (pedestrian.punchTime >= 0.0f) {
            clip = pedestrian.punchCross ? appearance.crossClip : appearance.jabClip;
            clipTime = pedestrian.punchTime;
        } else if (pedestrian.aggressive && pedestrian.moving && appearance.runClip >= 0) {
            clip = appearance.runClip;
        }
        if (pedestrian.dead && pedestrian.reactionTime > 0.8f && m_BloodMesh) {
            // el charco crece desde que cae y se queda mientras el cuerpo siga a la vista
            const float grow = std::clamp((pedestrian.reactionTime - 0.8f) / 3.2f, 0.0f, 1.0f);
            const float radius = 0.95f * grow * grow * (3.0f - 2.0f * grow);
            glm::mat4 puddle = glm::translate(glm::mat4(1.0f), glm::vec3(pedestrian.position.x, m_City.IsSidewalk(pedestrian.position.x, pedestrian.position.z) ? 0.165f : 0.035f, pedestrian.position.z));
            puddle = glm::rotate(puddle, pedestrian.yaw, {0.0f, 1.0f, 0.0f});
            puddle = glm::rotate(puddle, glm::half_pi<float>(), {1.0f, 0.0f, 0.0f});   // el cilindro se extiende sobre Z: se tumba para que quede plano
            puddle = glm::scale(puddle, glm::vec3(radius * 1.15f, radius * 0.85f, 0.012f));
            renderer.Submit(*m_BloodMesh, puddle);
        }
        for (size_t partIndex = 0; partIndex < appearance.parts.size(); ++partIndex) {
            const auto& model = appearance.parts[partIndex];
            if (!model) continue;
            glm::vec4 tint = PedestrianPartTint(appearance, partIndex, pedestrian.color, pedestrian.animationOffset);
            if (pedestrian.splatRemaining > 0.0f) tint *= glm::vec4(0.42f, 0.32f, 0.20f, 1.0f);
            model->Draw(renderer, character, tint, clipTime, clip >= 0, clip);
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
