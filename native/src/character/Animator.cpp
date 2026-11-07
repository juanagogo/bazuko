#include "character/Animator.h"

#include <algorithm>
#include <cmath>

namespace bazuko {

const std::vector<std::string>& characterClipNames() {
    static const std::vector<std::string> names = {"idle", "walk", "run", "buscar", "pedir", "comer", "dormir", "saludo"};
    return names;
}

Animator::Animator(const Rig& rig, std::map<std::string, std::shared_ptr<const Clip>> clips) : rig_(rig), pose_(rig) {
    for (const std::string& name : characterClipNames()) {
        auto it = clips.find(name);
        if (it == clips.end()) continue;
        order_.push_back(name);
        actions_[name] = {it->second, 0, name == "idle" ? 1.0 : 0.0, 1};
    }
}

double Animator::weight(const std::string& clip) const {
    auto it = actions_.find(clip);
    return it == actions_.end() ? 0 : it->second.weight;
}

double Animator::time(const std::string& clip) const {
    auto it = actions_.find(clip);
    return it == actions_.end() ? 0 : it->second.time;
}

void Animator::update(double dt, const Input& in) {
    // Destino: acción especial si existe el clip y está quieto; si no, idle / caminar / correr según la velocidad.
    std::string target = in.speed < 0.15 ? "idle" : (in.running && hasClip("run") ? "run" : "walk");
    if (!in.action.empty() && hasClip(in.action) && in.speed < 0.15) target = in.action;
    if (!hasClip(target)) target = "idle";

    const double k = std::min(1.0, dt * 8);
    for (const std::string& name : order_) {
        Action& a = actions_[name];
        a.weight += ((name == target ? 1.0 : 0.0) - a.weight) * k;
    }
    if (hasClip("walk")) actions_["walk"].timeScale = std::clamp(in.speed / 1.4, 0.6, 1.6);
    if (hasClip("run")) actions_["run"].timeScale = std::clamp(in.speed / 3.5, 0.7, 1.4);

    // El tiempo avanza en todos los clips aunque su peso sea 0 (como AnimationMixer).
    for (auto& [name, a] : actions_) {
        a.time += dt * a.timeScale;
        if (a.clip->duration > 0) a.time = std::fmod(a.time, a.clip->duration);
    }

    // Acumulación ponderada por hueso: slerp(acumulado, nuevo, w / (W + w)), como PropertyMixer.
    for (size_t node = 0; node < rig_.nodes.size(); ++node) {
        if (!rig_.nodes[node].isBone) continue;
        glm::quat acc(1, 0, 0, 0);
        double total = 0;
        for (const std::string& name : order_) {
            const Action& a = actions_.at(name);
            if (a.weight == 0 || !a.clip->animates(static_cast<int>(node))) continue;
            const glm::quat q = a.clip->sample(static_cast<int>(node), a.time);
            if (total == 0) {
                acc = q;
                total = a.weight;
            } else {
                total += a.weight;
                acc = slerpShortest(acc, q, static_cast<float>(a.weight / total));
            }
        }
        if (total == 0) acc = rig_.nodes[node].rotation;
        else if (total < 1) acc = slerpShortest(acc, rig_.nodes[node].rotation, static_cast<float>(1 - total));
        pose_.rotation[node] = glm::normalize(acc);
    }
    pose_.update();
}

}  // namespace bazuko
