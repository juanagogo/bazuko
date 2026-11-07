#include "character/Rig.h"

#include <cmath>
#include <functional>

#include <glm/gtc/matrix_transform.hpp>

namespace bazuko {

Rig Rig::fromGltf(const GltfModel& model) {
    Rig rig;
    rig.nodes.resize(model.nodes.size());
    for (size_t i = 0; i < model.nodes.size(); ++i) {
        const GltfNode& g = model.nodes[i];
        RigNode& n = rig.nodes[i];
        n.name = g.name;
        n.parent = g.parent;
        n.children = g.children;
        n.translation = g.translation;
        n.rotation = g.rotation;
        n.scale = g.scale;
        n.isBone = g.isJoint;
        if (n.isBone) rig.bones[n.name] = static_cast<int>(i);
    }
    std::function<void(int)> visit = [&](int i) {
        rig.preorder.push_back(i);
        for (int c : rig.nodes[i].children) visit(c);
    };
    for (int r : model.roots) visit(r);
    return rig;
}

int Rig::boneIndex(const std::string& name) const {
    auto it = bones.find(name);
    return it == bones.end() ? -1 : it->second;
}

Pose::Pose(const Rig& rig) : rotation(rig.nodes.size()), rig_(&rig), world_(rig.nodes.size(), glm::mat4(1.0f)), worldRot_(rig.nodes.size()) {
    resetToRest();
    update();
}

void Pose::resetToRest() {
    for (size_t i = 0; i < rig_->nodes.size(); ++i) rotation[i] = rig_->nodes[i].rotation;
}

void Pose::update() {
    for (int i : rig_->preorder) {
        const RigNode& n = rig_->nodes[i];
        glm::mat4 local = glm::translate(glm::mat4(1.0f), n.translation) * glm::mat4_cast(rotation[i]) * glm::scale(glm::mat4(1.0f), n.scale);
        if (n.parent >= 0) {
            world_[i] = world_[n.parent] * local;
            worldRot_[i] = worldRot_[n.parent] * rotation[i];
        } else {
            world_[i] = local;
            worldRot_[i] = rotation[i];
        }
    }
}

glm::quat slerpShortest(glm::quat a, glm::quat b, float t) {
    float d = glm::dot(a, b);
    if (d < 0) { b = -b; d = -d; }
    if (d > 0.9995f) return glm::normalize(glm::quat(a.w + (b.w - a.w) * t, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t));
    const float theta = std::acos(std::min(1.0f, d));
    const float s = std::sin(theta);
    const float wa = std::sin((1 - t) * theta) / s, wb = std::sin(t * theta) / s;
    return glm::quat(wa * a.w + wb * b.w, wa * a.x + wb * b.x, wa * a.y + wb * b.y, wa * a.z + wb * b.z);
}

glm::quat rotationBetween(const glm::vec3& from, const glm::vec3& to) {
    float r = glm::dot(from, to) + 1;
    glm::vec3 axis;
    if (r < 1e-6f) {
        // vectores opuestos: cualquier eje perpendicular
        r = 0;
        if (std::abs(from.x) > std::abs(from.z)) axis = {-from.y, from.x, 0};
        else axis = {0, -from.z, from.y};
    } else {
        axis = glm::cross(from, to);
    }
    return glm::normalize(glm::quat(r, axis.x, axis.y, axis.z));  // w, x, y, z
}

}  // namespace bazuko
