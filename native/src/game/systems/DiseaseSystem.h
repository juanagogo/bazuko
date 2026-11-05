#pragma once

#include <map>
#include <string>

#include "core/Rng.h"
#include "game/EventBus.h"
#include "game/data/GameData.h"

namespace bazuko {

struct DiseaseEffects {
    double healthDrain = 0, mentalDrain = 0;
    double speedMultiplier = 1, hungerDrainMultiplier = 1, energyDrainMultiplier = 1;
    double hygieneDrain = 0;
    bool canEat = true;
};

class DiseaseSystem {
public:
    DiseaseSystem(const GameData& data, EventBus* bus = nullptr) : data_(data), bus_(bus) {}

    bool hasAny() const { return !active_.empty(); }
    // id -> segundos restantes
    const std::map<std::string, double>& active() const { return active_; }
    void restore(std::map<std::string, double> active);

    // Al recoger basura: devuelve la enfermedad nueva, o nullptr (no pasó, o ya la tenía y solo se renueva).
    const DiseaseDef* tryInfect(bool sorted, double resistanceMult, Rng& rng);
    void cureAll() { active_.clear(); }
    void cure(const std::string& id) { active_.erase(id); }
    void update(double dt);
    DiseaseEffects effects() const;

private:
    const GameData& data_;
    EventBus* bus_;
    std::map<std::string, double> active_;
};

}  // namespace bazuko
