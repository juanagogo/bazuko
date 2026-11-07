#include "game/systems/DiseaseSystem.h"

#include <vector>

namespace bazuko {

void DiseaseSystem::restore(std::map<std::string, double> active) {
    active_.clear();
    for (auto& [id, left] : active)
        if (data_.disease(id)) active_[id] = left;
}

const DiseaseDef* DiseaseSystem::tryInfect(bool sorted, double resistanceMult, Rng& rng) {
    double chance = data_.c("DISEASE_BASE_CHANCE");
    if (sorted) chance *= data_.c("DISEASE_SORT_MULT");
    chance *= resistanceMult;
    if (rng.next() > chance) return nullptr;

    const DiseaseDef& def = data_.diseases[rng.below(static_cast<int>(data_.diseases.size()))];
    auto it = active_.find(def.id);
    if (it != active_.end()) {  // no se apila: solo reinicia el tiempo
        it->second = def.duration;
        return nullptr;
    }
    active_[def.id] = def.duration;
    if (bus_) bus_->emit(EvDisease{def.name, def.emoji});
    return &def;
}

void DiseaseSystem::update(double dt) {
    std::vector<std::string> cured;
    for (auto& [id, left] : active_) {
        left -= dt;
        if (left <= 0) cured.push_back(id);
    }
    for (const auto& id : cured) {
        active_.erase(id);
        if (bus_) bus_->emit(EvDiseaseCured{data_.disease(id)->name});
    }
}

DiseaseEffects DiseaseSystem::effects() const {
    DiseaseEffects fx;
    for (const auto& [id, left] : active_) {
        (void)left;
        const DiseaseDef* d = data_.disease(id);
        if (!d) continue;
        fx.healthDrain += d->healthDrain;
        fx.mentalDrain += d->mentalDrain;
    }
    return fx;
}

}  // namespace bazuko
