#pragma once

#include <map>
#include <string>
#include <vector>

#include <glm/glm.hpp>
#include <glm/gtc/quaternion.hpp>

#include "character/Gltf.h"

namespace bazuko {

struct RigNode {
    std::string name;
    int parent = -1;
    std::vector<int> children;
    glm::vec3 translation{0};
    glm::quat rotation{1, 0, 0, 0};  // reposo (el retarget la modifica en el destino)
    glm::vec3 scale{1};
    bool isBone = false;
};

// Jerarquía de nodos de un modelo (huesos y nodos de apoyo como la raíz de la escena).
class Rig {
public:
    static Rig fromGltf(const GltfModel& model);

    std::vector<RigNode> nodes;
    std::vector<int> preorder;                 // recorrido en profundidad, padres antes que hijos
    std::map<std::string, int> bones;          // nombre -> nodo, solo huesos
    int boneIndex(const std::string& name) const;  // -1 si no existe
};

// Una pose: rotación local por nodo (traslación y escala se toman del reposo) y sus matrices de mundo.
class Pose {
public:
    explicit Pose(const Rig& rig);
    const Rig& rig() const { return *rig_; }

    std::vector<glm::quat> rotation;  // local, por nodo
    void resetToRest();
    void update();                    // recalcula mundo a partir de `rotation`

    const glm::mat4& world(int node) const { return world_[node]; }
    const glm::quat& worldRotation(int node) const { return worldRot_[node]; }
    glm::vec3 worldPosition(int node) const { return glm::vec3(world_[node][3]); }

private:
    const Rig* rig_;
    std::vector<glm::mat4> world_;
    std::vector<glm::quat> worldRot_;
};

// Interpolación esférica por el camino más corto.
glm::quat slerpShortest(glm::quat a, glm::quat b, float t);
// Rotación mínima que lleva el vector unitario `from` a `to` (Quaternion.setFromUnitVectors de three.js).
glm::quat rotationBetween(const glm::vec3& from, const glm::vec3& to);

}  // namespace bazuko
