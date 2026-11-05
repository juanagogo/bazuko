#include "character/Character.h"

namespace bazuko {

Character::Character(std::shared_ptr<const CharacterBlueprint> blueprint)
    : bp_(std::move(blueprint)), animator_(*bp_->rig, bp_->clips) {
    palettes_.resize(bp_->parts.size());
    for (size_t i = 0; i < palettes_.size(); ++i) palettes_[i].assign(bp_->parts[i].jointNodes.size(), glm::mat4(1.0f));
    computePalettes();
}

void Character::computePalettes() {
    const Pose& pose = animator_.pose();
    for (size_t p = 0; p < bp_->parts.size(); ++p) {
        const MeshPart& part = bp_->parts[p];
        for (size_t j = 0; j < part.jointNodes.size(); ++j) palettes_[p][j] = pose.world(part.jointNodes[j]) * part.inverseBind[j];
    }
}

void Character::update(double dt, const Animator::Input& in) {
    animator_.update(dt, in);
    computePalettes();
}

void Character::collect(const glm::mat4& model, bool silhouette, std::vector<SkinnedDraw>& out) const {
    for (size_t p = 0; p < bp_->parts.size(); ++p) {
        const MeshPart& part = bp_->parts[p];
        SkinnedDraw d;
        d.mesh = part.gpuMesh;
        d.texture = part.gpuTexture;
        d.model = model;
        d.palette = palettes_[p].data();
        d.paletteCount = static_cast<int>(palettes_[p].size());
        d.tint = part.tint;
        d.alphaCutoff = part.alphaCutoff;
        d.blend = part.blend;
        d.doubleSided = part.doubleSided;
        d.polygonOffset = part.polygonOffset;
        d.castShadow = part.castShadow;
        d.silhouette = silhouette;
        out.push_back(d);
    }
}

}  // namespace bazuko
