#include "character/Retarget.h"

#include <algorithm>
#include <cmath>

namespace bazuko {

namespace {

bool endsWith(const std::string& s, const std::string& suffix) {
    return s.size() >= suffix.size() && s.compare(s.size() - suffix.size(), suffix.size(), suffix) == 0;
}

// Giro en Y que lleva el "frente" del origen al del destino (comparando cadera izquierda → derecha).
glm::quat facingRotationOf(const Rig& src, const Pose& sp, const Rig& tgt, const Pose& tp) {
    auto side = [&](const Rig& rig, const Pose& pose) {
        int l = -1, r = -1;
        for (const auto& [name, idx] : rig.bones) {
            if (endsWith(name, "LeftUpLeg")) l = idx;
            if (endsWith(name, "RightUpLeg")) r = idx;
        }
        glm::vec3 v = pose.worldPosition(l) - pose.worldPosition(r);
        v.y = 0;
        return glm::normalize(v);
    };
    return rotationBetween(side(src, sp), side(tgt, tp));
}

}  // namespace

glm::quat sampleChannelRotation(const GltfAnimation& anim, int node, double t, const glm::quat& fallback) {
    for (const GltfChannel& ch : anim.channels) {
        if (ch.node != node || ch.path != GltfChannel::Path::Rotation || ch.times.empty()) continue;
        auto key = [&](size_t i) { return glm::quat(ch.values[i * 4 + 3], ch.values[i * 4], ch.values[i * 4 + 1], ch.values[i * 4 + 2]); };
        const float ft = static_cast<float>(t);  // los tiempos son float: se compara con la misma precisión
        if (ft <= ch.times.front()) return key(0);
        if (ft >= ch.times.back()) return key(ch.times.size() - 1);
        const size_t hi = static_cast<size_t>(std::upper_bound(ch.times.begin(), ch.times.end(), ft) - ch.times.begin());
        const size_t lo = hi - 1;
        if (ch.step) return key(lo);
        const float k = (ft - ch.times[lo]) / (ch.times[hi] - ch.times[lo]);
        return slerpShortest(key(lo), key(hi), k);
    }
    return fallback;
}

glm::quat Clip::sample(int node, double t) const {
    const auto& frames = rotation[node];
    if (frames.size() == 1 || duration <= 0) return frames.front();
    t = std::fmod(t, duration);
    if (t < 0) t += duration;
    const size_t hi = static_cast<size_t>(std::upper_bound(times.begin(), times.end(), static_cast<float>(t)) - times.begin());
    if (hi == 0) return frames.front();
    if (hi >= times.size()) return frames.back();
    const size_t lo = hi - 1;
    const float k = (static_cast<float>(t) - times[lo]) / (times[hi] - times[lo]);
    return slerpShortest(frames[lo], frames[hi], k);
}

Retargeter::Retargeter(const Rig& source, Rig& target) : src_(source), tgt_(target) {
    Pose sp(src_), tp(tgt_);
    facing_ = facingRotationOf(src_, sp, tgt_, tp);
    facingInv_ = glm::inverse(facing_);

    for (int i : tgt_.preorder)
        if (tgt_.nodes[i].isBone) order_.push_back(i);

    // Rota los huesos del destino para que cada uno apunte a su hijo igual que en el origen (T-pose).
    for (int bone : order_) {
        const int s = src_.boneIndex(tgt_.nodes[bone].name);
        if (s < 0) continue;
        int child = -1;
        for (int c : tgt_.nodes[bone].children) {
            if (tgt_.nodes[c].isBone && src_.boneIndex(tgt_.nodes[c].name) >= 0) { child = c; break; }
        }
        if (child < 0) continue;
        tp.update();
        const glm::vec3 a = glm::normalize(tp.worldPosition(child) - tp.worldPosition(bone));
        const int sChild = src_.boneIndex(tgt_.nodes[child].name);
        const glm::vec3 d = sp.worldPosition(sChild) - sp.worldPosition(s);
        const glm::vec3 b = glm::normalize(facing_ * d);
        if (glm::dot(a, a) < 1e-8f || glm::dot(b, b) < 1e-8f) continue;
        const glm::quat r = rotationBetween(a, b);
        const glm::quat w = tp.worldRotation(bone);
        const int parent = tgt_.nodes[bone].parent;
        const glm::quat pw = parent >= 0 ? tp.worldRotation(parent) : glm::quat(1, 0, 0, 0);
        tp.rotation[bone] = glm::inverse(pw) * (r * w);
        tgt_.nodes[bone].rotation = tp.rotation[bone];
    }
    tp.update();

    restSrc_.resize(src_.nodes.size());
    for (size_t i = 0; i < src_.nodes.size(); ++i) restSrc_[i] = sp.worldRotation(static_cast<int>(i));
    restTgt_.resize(tgt_.nodes.size());
    restLocal_.resize(tgt_.nodes.size());
    rootParentWorld_.assign(tgt_.nodes.size(), glm::quat(1, 0, 0, 0));
    for (size_t i = 0; i < tgt_.nodes.size(); ++i) {
        restTgt_[i] = tp.worldRotation(static_cast<int>(i));
        restLocal_[i] = tp.rotation[i];
        const int parent = tgt_.nodes[i].parent;
        if (parent >= 0 && !tgt_.nodes[parent].isBone) rootParentWorld_[i] = tp.worldRotation(parent);
    }
}

Clip Retargeter::retarget(const GltfAnimation& anim, double fps) const {
    const int frames = std::max(2, static_cast<int>(std::lround(anim.duration * fps)) + 1);
    Clip clip;
    clip.name = anim.name;
    clip.duration = anim.duration;
    clip.times.resize(frames);
    clip.rotation.assign(tgt_.nodes.size(), {});
    for (int b : order_) clip.rotation[b].resize(frames);

    Pose sp(src_);
    std::vector<glm::quat> world(tgt_.nodes.size());
    for (int f = 0; f < frames; ++f) {
        const double t = std::min(anim.duration, f / fps);
        clip.times[f] = static_cast<float>(t);
        for (size_t i = 0; i < src_.nodes.size(); ++i) sp.rotation[i] = sampleChannelRotation(anim, static_cast<int>(i), t, src_.nodes[i].rotation);
        sp.update();

        for (int b : order_) {
            const int parent = tgt_.nodes[b].parent;
            const glm::quat parentW = parent >= 0 && tgt_.nodes[parent].isBone ? world[parent] : rootParentWorld_[b];
            const int s = src_.boneIndex(tgt_.nodes[b].name);
            glm::quat w;
            if (s >= 0) {
                const glm::quat delta = sp.worldRotation(s) * glm::inverse(restSrc_[s]);
                w = facing_ * delta * facingInv_ * restTgt_[b];
            } else {
                w = parentW * restLocal_[b];
            }
            world[b] = w;
            clip.rotation[b][f] = glm::normalize(glm::inverse(parentW) * w);
        }
    }
    return clip;
}

}  // namespace bazuko
