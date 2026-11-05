#pragma once

#include <cstdint>
#include <string>
#include <vector>

#include <glm/glm.hpp>
#include <glm/gtc/quaternion.hpp>

#include "render/Image.h"

namespace bazuko {

struct GltfNode {
    std::string name;
    int parent = -1;
    std::vector<int> children;
    glm::vec3 translation{0};
    glm::quat rotation{1, 0, 0, 0};
    glm::vec3 scale{1};
    int mesh = -1, skin = -1;
    bool isJoint = false;  // aparece en alguna `skin`
};

struct GltfPrimitive {
    std::vector<float> positions, normals, uvs;       // 3, 3 y 2 floats por vértice
    std::vector<std::uint16_t> joints;                // 4 por vértice (índices de la skin)
    std::vector<float> weights;                       // 4 por vértice
    std::vector<float> vertexIds;                     // atributo propio `_VID`: índice del vértice original
    std::vector<std::uint32_t> indices;
    int material = -1;
    size_t vertexCount() const { return positions.size() / 3; }
};

struct GltfMesh {
    std::string name;
    std::vector<GltfPrimitive> primitives;
};

struct GltfMaterial {
    std::string name;
    int baseColorImage = -1;  // índice en GltfModel::images (también con EXT_texture_webp)
    glm::vec4 baseColor{1};
    bool doubleSided = false;
    enum class Alpha { Opaque, Mask, Blend } alpha = Alpha::Opaque;
    float alphaCutoff = 0.5f;
};

struct GltfSkin {
    std::vector<int> joints;               // índices de nodo
    std::vector<glm::mat4> inverseBind;    // una por joint
};

struct GltfChannel {
    int node = -1;
    enum class Path { Translation, Rotation, Scale } path = Path::Rotation;
    bool step = false;                     // interpolación STEP (si no, lineal / slerp)
    std::vector<float> times;
    std::vector<float> values;             // 3 o 4 floats por clave
};

struct GltfAnimation {
    std::string name;
    double duration = 0;
    std::vector<GltfChannel> channels;
};

struct GltfModel {
    std::vector<GltfNode> nodes;
    std::vector<int> roots;                // nodos raíz de la escena
    std::vector<GltfMesh> meshes;
    std::vector<GltfMaterial> materials;
    std::vector<GltfSkin> skins;
    std::vector<Image> images;             // decodificadas (vacías si loadImages = false)
    std::vector<GltfAnimation> animations;

    int findNode(const std::string& name) const;
};

struct GltfLoadOptions {
    bool loadImages = true;
};

// Carga un .gltf/.glb (con .bin y texturas externas, incluida EXT_texture_webp). Lanza std::runtime_error.
GltfModel loadGltf(const std::string& path, const GltfLoadOptions& options = {});

}  // namespace bazuko
