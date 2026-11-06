#include "Survival.hpp"

#include <algorithm>

namespace Bazuko {

// El orden y las formulas son los del bloque original de main(): no se "limpia" nada para que el resultado sea identico bit a bit.
SurvivalEvents StepSurvival(PlayerSession& s, const SurvivalInput& in, const std::function<float()>& roll) {
    SurvivalEvents events;
    auto& needs = s.needs;
    auto& diseases = s.diseases;
    float& warmTimer = s.warmTimer;
    float& playerWetness = s.playerWetness;
    float& coldCheckTimer = s.coldCheckTimer;
    const float dtClamped = in.dt;

    {   // calor: se gasta con el tiempo; junto al fogon encendido del cambuche se mantiene y la ropa mojada se seca mas rapido
        if (in.nearFire) { warmTimer = std::max(warmTimer, 60.0f); playerWetness = std::max(0.0f, playerWetness - dtClamped / 12.0f); }
        else warmTimer = std::max(0.0f, warmTimer - dtClamped);
        // «La Nevera» (StatsSystem.js): de noche y con lluvia, sin calor, el frio cala los huesos y gasta la energia
        s.playerFreezing = in.night && in.raining && warmTimer <= 0.0f;
        if (s.playerFreezing) needs[2] = std::max(0.0f, needs[2] - 0.35f * dtClamped);
    }
    const float hungerAndThirstDecay = in.hungerThirstDecayMult;
    needs[0] = std::max(0.0f, needs[0] - (100.0f / 7200.0f) * dtClamped * hungerAndThirstDecay);
    needs[1] = std::max(0.0f, needs[1] - (100.0f / 5400.0f) * dtClamped * hungerAndThirstDecay);
    needs[2] = std::max(0.0f, needs[2] - (100.0f / 5400.0f) * dtClamped - (in.running && in.speed > 0.0f ? 0.01f * dtClamped : 0.0f));
    needs[4] = std::max(0.0f, needs[4] - (100.0f / 21600.0f) * dtClamped);
    needs[6] = std::max(0.0f, needs[6] - (60.0f / 7200.0f) * dtClamped);
    // Lluvia: moja al jugador (empapado en ~45 s con lluvia fuerte), lo lava un poco y, si sigue mojado,
    // puede resfriarse; con el tiempo se seca
    {
        const float rain = in.rainIntensity;
        const bool wasSoaked = playerWetness >= 0.7f;
        if (in.waterDepth > 0.35f) playerWetness = std::min(1.0f, playerWetness + dtClamped * 0.8f);   // metido en el lago
        if (rain > 0.1f) {
            playerWetness = std::min(1.0f, playerWetness + dtClamped * rain / 45.0f);
            needs[4] = std::min(100.0f, needs[4] + 0.03f * rain * dtClamped);
        } else {
            playerWetness = std::max(0.0f, playerWetness - dtClamped / 120.0f);
        }
        if (!wasSoaked && playerWetness >= 0.7f) events.becameSoaked = true;
        if (playerWetness >= 0.6f) {
            coldCheckTimer += dtClamped;
            if (coldCheckTimer >= 20.0f) {
                coldCheckTimer = 0.0f;
                const float chance = 0.04f * (in.night ? 1.6f : 1.0f) * (warmTimer > 0.0f ? 0.2f : 1.0f) * in.diseaseResistTalent
                    * in.diseaseResistCharacter;
                const bool hasCold = std::any_of(diseases.begin(), diseases.end(), [](const DiseaseState& disease) { return disease.id == "gripe"; });
                if (!hasCold && roll() < chance) {
                    diseases.push_back({"gripe", 45.0f, 0.12f, 0.01f});
                    events.caughtCold = true;
                }
            }
        } else {
            coldCheckTimer = 0.0f;
        }
    }
    float healthDrain = 0.0f;
    float mentalDrain = 0.0f;
    for (auto disease = diseases.begin(); disease != diseases.end();) {
        healthDrain += disease->healthDrain;
        mentalDrain += disease->mentalDrain;
        disease->remaining -= dtClamped;
        if (disease->remaining <= 0.0f) disease = diseases.erase(disease); else ++disease;
    }
    float moodDecay = 100.0f / 10800.0f
        + (in.night ? 100.0f / 21600.0f : 0.0f) + mentalDrain;
    if (needs[0] < 30.0f) moodDecay *= 1.5f;
    if (needs[1] < 30.0f) moodDecay *= 1.5f;
    if (needs[2] < 30.0f) moodDecay *= 1.3f;
    if (s.playerFreezing) moodDecay *= 1.25f;
    if (warmTimer > 0.0f) moodDecay *= 0.8f;
    if (in.withdrawal > 0.0f) {
        moodDecay *= 1.5f;
        if (in.criticalWithdrawal) moodDecay *= 2.2f;
        else if (in.highWithdrawal) moodDecay *= 1.6f;
    }
    needs[5] = std::max(0.0f, needs[5] - moodDecay * dtClamped * in.mentalDecayMult);

    if (needs[0] <= 0.0f) healthDrain += 100.0f / 1800.0f;
    if (needs[1] <= 0.0f) healthDrain += 100.0f / 1200.0f;
    needs[3] = std::max(0.0f, needs[3] - healthDrain * dtClamped);
    ApplyHealthRegeneration(needs, in.withdrawal, healthDrain, dtClamped);

    // Actualizacion de Boost (Adrenalina)
    if (s.boostActive && dtClamped > 0.0f) {
        s.boostTimer = std::max(0.0f, s.boostTimer - dtClamped);
        needs[3] = std::max(0.0f, needs[3] - 3.0f * dtClamped);
        if (s.boostTimer <= 0.0f || needs[3] <= 5.0f) {
            s.boostActive = false;
            s.boostTimer = 0.0f;
            events.adrenalineEnded = true;
        }
    }
    return events;
}

} // namespace Bazuko
