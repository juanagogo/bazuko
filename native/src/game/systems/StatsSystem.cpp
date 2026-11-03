#include "game/systems/StatsSystem.h"

#include <algorithm>
#include <cmath>

namespace bazuko {

double* StatsSystem::need(const std::string& name) {
    if (name == "hambre") return &hambre;
    if (name == "sed") return &sed;
    if (name == "energia") return &energia;
    if (name == "salud") return &salud;
    if (name == "higiene") return &higiene;
    if (name == "animo") return &animo;
    if (name == "vicio") return &vicio;
    return nullptr;
}

void StatsSystem::update(double dt, bool isNight) {
    const DiseaseEffects fx = diseases_ ? diseases_->effects() : DiseaseEffects{};
    const double decayMult = talents_ ? talents_->getEffect("decayMult", 1) : 1;
    const auto& decay = data_.decay;
    const auto& wd = data_.withdrawal;

    // Decaimiento base. El talento decayMult solo afecta hambre y sed (así lo describe el talento).
    hambre = std::max(0.0, hambre - decay.hambre * fx.hungerDrainMultiplier * dt * decayMult);
    sed = std::max(0.0, sed - decay.sed * dt * decayMult);
    energia = std::max(0.0, energia - decay.energia * fx.energyDrainMultiplier * dt);
    higiene = std::max(0.0, higiene - (decay.higiene + fx.hygieneDrain) * dt);

    const bool wasWithdrawal = inWithdrawal();
    vicio = std::max(0.0, vicio - decay.vicio * dt);
    if (inWithdrawal() != wasWithdrawal && bus_) bus_->emit(EvWithdrawal{inWithdrawal()});

    // Ánimo: un único cálculo con noche, enfermedades, necesidades críticas y talentos.
    const double mentalDecayMult = talents_ ? talents_->getEffect("mentalDecayMult", 1) : 1;
    double animoDecay = decay.animo + (isNight ? data_.c("MENTAL_DECAY_NIGHT") : 0) + fx.mentalDrain;
    if (hambre < 30) animoDecay *= 1.5;
    if (sed < 30) animoDecay *= 1.5;
    if (energia < 30) animoDecay *= 1.3;
    if (inWithdrawal()) animoDecay *= wd.at("animoMult");
    animo = std::max(0.0, animo - animoDecay * mentalDecayMult * dt);

    // Daño por necesidades agotadas y enfermedades.
    double damage = 0;
    if (hambre == 0) damage += data_.survivalDamage.hambre;
    if (sed == 0) damage += data_.survivalDamage.sed;
    if (inWithdrawal()) damage += wd.at("saludPorSeg");
    damage += fx.healthDrain;
    if (damage > 0) salud = std::max(0.0, salud - damage * dt);

    // Regeneración natural.
    if (hambre > 50 && sed > 50 && energia > 50 && higiene > 40 && animo > 40 && !inWithdrawal() &&
        salud < 100 && fx.healthDrain == 0) {
        salud = std::min(100.0, salud + 0.5 * dt);
    }

    // Subir de nivel.
    const double perLevel = data_.c("XP_PER_LEVEL");
    while (xp >= perLevel * level) {
        xp -= perLevel * level;
        ++level;
        if (talents_) talents_->addPoints(1);
        if (bus_) bus_->emit(EvLevelUp{level});
    }
}

void StatsSystem::addXP(double amount) {
    const double mult = talents_ ? talents_->getEffect("xpMult", 1) : 1;
    xp += std::floor(amount * mult + 0.5);  // Math.round de JS: mitades hacia arriba
}

double StatsSystem::getSpeedMultiplier() const {
    double mult = diseases_ ? diseases_->effects().speedMultiplier : 1.0;
    if (animo < data_.statThresholds.at("animoVelocidad")) mult *= 0.8;
    if (animo == 0) mult *= 0.7;
    if (energia == 0) mult *= 0.5;
    if (inWithdrawal()) mult *= data_.withdrawal.at("velocidad");
    return mult;
}

double StatsSystem::getDiseaseChanceMultiplier() const {
    return higiene < data_.statThresholds.at("higieneEnfermedad") ? 1.5 : 1.0;
}

double StatsSystem::getDesaturation() const {
    const double vision = data_.statThresholds.at("animoVision");
    if (animo >= vision) return 0;
    return std::min(1.0, 1.0 - animo / vision);
}

}  // namespace bazuko
