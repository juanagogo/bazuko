#pragma once

#include "game/EventBus.h"
#include "game/data/GameData.h"
#include "game/systems/DiseaseSystem.h"
#include "game/systems/TalentSystem.h"

namespace bazuko {

// Necesidades del jugador (0-100, 100 = satisfecha).
class StatsSystem {
public:
    StatsSystem(const GameData& data, EventBus* bus = nullptr) : data_(data), bus_(bus) {}
    void attach(DiseaseSystem* diseases, TalentSystem* talents) { diseases_ = diseases; talents_ = talents; }

    double hambre = 100, sed = 100, energia = 100, salud = 100, higiene = 100, animo = 100, vicio = 80;
    double dinero = 0, xp = 0;
    int level = 1;

    bool inWithdrawal() const { return vicio < data_.statThresholds.at("vicioAbstinencia"); }
    void update(double dt, bool isNight);
    void addXP(double amount);

    double getSpeedMultiplier() const;
    // Higiene baja aumenta el riesgo de enfermarse (+50 %).
    double getDiseaseChanceMultiplier() const;
    // 0 = color normal, 1 = gris total (ánimo bajo).
    double getDesaturation() const;
    bool isRejectedByNPCs() const { return higiene < data_.statThresholds.at("higieneRechazo"); }

    // Accede a una necesidad por nombre ("hambre", "sed", "energia", "salud", "higiene", "animo", "vicio").
    double* need(const std::string& name);

private:
    const GameData& data_;
    EventBus* bus_;
    DiseaseSystem* diseases_ = nullptr;
    TalentSystem* talents_ = nullptr;
};

}  // namespace bazuko
