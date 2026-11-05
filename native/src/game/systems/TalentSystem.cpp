#include "game/systems/TalentSystem.h"

namespace bazuko {

bool TalentSystem::canUnlock(const std::string& id) const {
    const Talent* t = data_.talent(id);
    if (!t || has(id) || points_ < t->cost) return false;
    for (const auto& req : t->prereqs)
        if (!has(req)) return false;
    return true;
}

bool TalentSystem::unlock(const std::string& id) {
    if (!canUnlock(id)) return false;
    const Talent* t = data_.talent(id);
    points_ -= t->cost;
    unlocked_.insert(id);
    if (bus_) bus_->emit(EvTalentUnlock{t->name});
    return true;
}

double TalentSystem::getEffect(const std::string& key, double base) const {
    const bool multiplicative = key.find("Mult") != std::string::npos;
    double value = base;
    for (const auto& id : unlocked_) {
        const Talent* t = data_.talent(id);
        if (!t) continue;
        auto it = t->effects.find(key);
        if (it == t->effects.end()) continue;
        if (multiplicative) value *= it->second;
        else value += it->second;
    }
    return value;
}

void TalentSystem::restore(int points, std::set<std::string> unlocked) {
    points_ = points;
    unlocked_.clear();
    for (auto& id : unlocked)
        if (data_.talent(id)) unlocked_.insert(std::move(id));
}

}  // namespace bazuko
