// Supervivencia: prueba DIFERENCIAL. `Reference` es una copia literal del bloque que vivia en main() antes de extraerlo a game/Survival;
// `StepSurvival` debe dar exactamente el mismo estado, bit a bit, en cientos de miles de pasos con entradas aleatorias y la misma secuencia
// de azar. Ademas comprueba algunos comportamientos conocidos (frio, gripe, adrenalina, abstinencia).
#include "game/Survival.hpp"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <random>

using namespace Bazuko;

static int failures = 0;
#define CHECK(condition, message) do { \
    if (!(condition)) { ++failures; std::printf("FALLO (%d): %s\n", __LINE__, message); } \
} while (0)

namespace {

struct RefState {
    std::array<float, 7> needs{};
    std::vector<DiseaseState> diseases;
    float warmTimer = 0.0f, playerWetness = 0.0f, coldCheckTimer = 0.0f, boostTimer = 0.0f;
    bool playerFreezing = false, boostActive = false;
};

// ---- copia literal del codigo anterior de main() (con las variables y llamadas a la UI sustituidas por la entrada y los eventos) ----
SurvivalEvents Reference(RefState& s, const SurvivalInput& in, std::mt19937& lootRandom) {
    SurvivalEvents events;
    auto& needs = s.needs;
    auto& diseases = s.diseases;
    auto& warmTimer = s.warmTimer;
    auto& playerWetness = s.playerWetness;
    auto& coldCheckTimer = s.coldCheckTimer;
    auto& playerFreezing = s.playerFreezing;
    const float dtClamped = in.dt;
    const float playerWaterDepth = in.waterDepth;
    const bool isRunning = in.running;
    const float currentSpeed = in.speed;
    const float withdrawal = in.withdrawal;
    const bool highWithdrawal = in.highWithdrawal, criticalWithdrawal = in.criticalWithdrawal;
    {
        const bool nearFire = in.nearFire;
        if (nearFire) { warmTimer = std::max(warmTimer, 60.0f); playerWetness = std::max(0.0f, playerWetness - dtClamped / 12.0f); }
        else warmTimer = std::max(0.0f, warmTimer - dtClamped);
        playerFreezing = in.night && in.raining && warmTimer <= 0.0f;
        if (playerFreezing) needs[2] = std::max(0.0f, needs[2] - 0.35f * dtClamped);
    }
    const float hungerAndThirstDecay = in.hungerThirstDecayMult;
    needs[0] = std::max(0.0f, needs[0] - (100.0f / 7200.0f) * dtClamped * hungerAndThirstDecay);
    needs[1] = std::max(0.0f, needs[1] - (100.0f / 5400.0f) * dtClamped * hungerAndThirstDecay);
    needs[2] = std::max(0.0f, needs[2] - (100.0f / 5400.0f) * dtClamped - (isRunning && currentSpeed > 0.0f ? 0.01f * dtClamped : 0.0f));
    needs[4] = std::max(0.0f, needs[4] - (100.0f / 21600.0f) * dtClamped);
    needs[6] = std::max(0.0f, needs[6] - (60.0f / 7200.0f) * dtClamped);
    {
        const float rain = in.rainIntensity;
        const bool wasSoaked = playerWetness >= 0.7f;
        if (playerWaterDepth > 0.35f) playerWetness = std::min(1.0f, playerWetness + dtClamped * 0.8f);
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
                if (!hasCold && std::uniform_real_distribution<float>(0.0f, 1.0f)(lootRandom) < chance) {
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
    if (playerFreezing) moodDecay *= 1.25f;
    if (warmTimer > 0.0f) moodDecay *= 0.8f;
    if (withdrawal > 0.0f) {
        moodDecay *= 1.5f;
        if (criticalWithdrawal) moodDecay *= 2.2f;
        else if (highWithdrawal) moodDecay *= 1.6f;
    }
    needs[5] = std::max(0.0f, needs[5] - moodDecay * dtClamped * in.mentalDecayMult);
    if (needs[0] <= 0.0f) healthDrain += 100.0f / 1800.0f;
    if (needs[1] <= 0.0f) healthDrain += 100.0f / 1200.0f;
    needs[3] = std::max(0.0f, needs[3] - healthDrain * dtClamped);
    ApplyHealthRegeneration(needs, withdrawal, healthDrain, dtClamped);
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

bool SameBits(float a, float b) { return std::memcmp(&a, &b, sizeof(float)) == 0; }

bool Same(const RefState& r, const PlayerSession& s) {
    for (size_t i = 0; i < r.needs.size(); ++i) if (!SameBits(r.needs[i], s.needs[i])) return false;
    if (r.diseases.size() != s.diseases.size()) return false;
    for (size_t i = 0; i < r.diseases.size(); ++i) {
        const auto& a = r.diseases[i]; const auto& b = s.diseases[i];
        if (a.id != b.id || !SameBits(a.remaining, b.remaining) || !SameBits(a.healthDrain, b.healthDrain) || !SameBits(a.mentalDrain, b.mentalDrain)) return false;
    }
    return SameBits(r.warmTimer, s.warmTimer) && SameBits(r.playerWetness, s.playerWetness) && SameBits(r.coldCheckTimer, s.coldCheckTimer)
        && SameBits(r.boostTimer, s.boostTimer) && r.playerFreezing == s.playerFreezing && r.boostActive == s.boostActive;
}

SurvivalInput Fresh() { return SurvivalInput{}; }

} // namespace

int main() {
    // 1) diferencial: entradas aleatorias, mismo azar, cientos de miles de pasos
    {
        std::mt19937 inputs(2026);
        std::uniform_real_distribution<float> unit(0.0f, 1.0f);
        long steps = 0, soaked = 0, colds = 0, boosts = 0, freezing = 0;
        for (int run = 0; run < 400; ++run) {
            PlayerSession session;
            RefState ref;
            session.needs = ref.needs = {80.0f + 20.0f * unit(inputs), 70.0f + 30.0f * unit(inputs), 60.0f + 40.0f * unit(inputs), 100.0f, 90.0f, 70.0f + 30.0f * unit(inputs), 80.0f};
            session.warmTimer = ref.warmTimer = unit(inputs) < 0.3f ? 120.0f * unit(inputs) : 0.0f;
            std::mt19937 lootA(run + 1), lootB(run + 1);
            bool night = unit(inputs) < 0.5f, raining = unit(inputs) < 0.5f;
            float rain = raining ? 0.2f + 0.8f * unit(inputs) : 0.0f;
            for (int step = 0; step < 1500; ++step) {
                SurvivalInput in;
                in.dt = unit(inputs) < 0.05f ? 0.0f : 0.005f + 0.2f * unit(inputs) * unit(inputs);   // incluye cuadros largos y de cero segundos
                if (step % 300 == 0) { night = unit(inputs) < 0.5f; raining = unit(inputs) < 0.5f; rain = raining ? 0.05f + 0.95f * unit(inputs) : 0.0f; }
                in.night = night; in.raining = raining; in.rainIntensity = rain;
                in.nearFire = unit(inputs) < 0.08f;
                in.waterDepth = unit(inputs) < 0.05f ? 1.5f * unit(inputs) : 0.0f;
                in.running = unit(inputs) < 0.4f; in.speed = unit(inputs) < 0.7f ? 5.0f * unit(inputs) : 0.0f;
                in.hungerThirstDecayMult = unit(inputs) < 0.5f ? 1.0f : 0.6f + 0.4f * unit(inputs);
                in.diseaseResistTalent = unit(inputs) < 0.5f ? 1.0f : 0.5f + 0.5f * unit(inputs);
                in.diseaseResistCharacter = unit(inputs) < 0.5f ? 1.0f : 0.7f + 0.3f * unit(inputs);
                in.mentalDecayMult = unit(inputs) < 0.5f ? 1.0f : 0.7f + 0.3f * unit(inputs);
                const float lowNeed = session.needs[6];
                in.withdrawal = lowNeed < 20.0f ? (20.0f - lowNeed) * 5.0f : 0.0f;
                in.highWithdrawal = in.withdrawal >= 50.0f; in.criticalWithdrawal = in.withdrawal >= 80.0f;
                if (unit(inputs) < 0.002f) { session.boostActive = ref.boostActive = true; session.boostTimer = ref.boostTimer = 8.0f; }
                if (unit(inputs) < 0.004f) session.needs[0] = ref.needs[0] = 0.0f;
                if (unit(inputs) < 0.004f) session.needs[1] = ref.needs[1] = 0.0f;
                if (unit(inputs) < 0.003f) { session.needs[6] = ref.needs[6] = 5.0f; }
                const SurvivalEvents mine = StepSurvival(session, in, [&]() { return std::uniform_real_distribution<float>(0.0f, 1.0f)(lootA); });
                const SurvivalEvents old = Reference(ref, in, lootB);
                ++steps;
                if (!Same(ref, session) || mine.becameSoaked != old.becameSoaked || mine.caughtCold != old.caughtCold || mine.adrenalineEnded != old.adrenalineEnded) {
                    std::printf("DIVERGE en la corrida %d, paso %d\n", run, step);
                    ++failures;
                    run = 400; break;
                }
                soaked += mine.becameSoaked; colds += mine.caughtCold; boosts += mine.adrenalineEnded; freezing += session.playerFreezing;
            }
        }
        std::printf("Diferencial: %ld pasos identicos (empapados %ld, resfriados %ld, adrenalinas %ld, pasos con frio %ld)\n", steps, soaked, colds, boosts, freezing);
        CHECK(steps == 400L * 1500L, "no se completaron todos los pasos");
        CHECK(soaked > 20 && colds >= 3 && boosts > 20 && freezing > 300, "la prueba no cubrio todos los casos (empapado, gripe, adrenalina, frio)");
    }

    // 2) comportamientos conocidos
    {
        PlayerSession s;
        s.needs = {100.0f, 100.0f, 100.0f, 100.0f, 100.0f, 100.0f, 100.0f};
        SurvivalInput in = Fresh(); in.dt = 60.0f;
        StepSurvival(s, in, [] { return 1.0f; });
        CHECK(std::fabs(s.needs[0] - (100.0f - 100.0f / 7200.0f * 60.0f)) < 1e-4f, "el hambre baja 100 en 2 horas");
        CHECK(std::fabs(s.needs[1] - (100.0f - 100.0f / 5400.0f * 60.0f)) < 1e-4f, "la sed baja 100 en 90 minutos");
    }
    {
        PlayerSession s;
        s.needs = {100.0f, 100.0f, 100.0f, 100.0f, 100.0f, 100.0f, 100.0f};
        SurvivalInput in = Fresh(); in.dt = 1.0f; in.night = true; in.raining = true; in.rainIntensity = 1.0f;
        StepSurvival(s, in, [] { return 1.0f; });
        CHECK(s.playerFreezing, "de noche y con lluvia, sin calor, se congela");
        s.warmTimer = 30.0f;
        StepSurvival(s, in, [] { return 1.0f; });
        CHECK(!s.playerFreezing, "con calor no se congela");
    }
    {
        PlayerSession s;   // empapado de forma sostenida: acaba cogiendo gripe si el dado sale bajo
        s.needs = {100.0f, 100.0f, 100.0f, 100.0f, 100.0f, 100.0f, 100.0f};
        s.playerWetness = 1.0f;
        SurvivalInput in = Fresh(); in.dt = 21.0f; in.raining = true; in.rainIntensity = 1.0f;
        bool caught = false;
        SurvivalEvents e = StepSurvival(s, in, [&] { return 0.0f; });
        caught = e.caughtCold;
        CHECK(caught && s.diseases.size() == 1 && s.diseases[0].id == "gripe", "con el dado en 0 se resfria");
        bool rolledAgain = false;
        StepSurvival(s, in, [&] { rolledAgain = true; return 0.0f; });
        CHECK(!rolledAgain && s.diseases.size() == 1, "con la gripe ya puesta no se vuelve a tirar el dado (ni se duplica)");
    }
    if (failures == 0) std::printf("Supervivencia: todo correcto\n");
    return failures == 0 ? 0 : 1;
}
