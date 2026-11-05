#pragma once

#include <set>
#include <string>

#include "game/EventBus.h"
#include "game/data/GameData.h"

namespace bazuko {

class TalentSystem {
public:
    TalentSystem(const GameData& data, EventBus* bus = nullptr) : data_(data), bus_(bus) {}

    int points() const { return points_; }
    void addPoints(int n) { points_ += n; }
    bool has(const std::string& id) const { return unlocked_.count(id) > 0; }
    bool canUnlock(const std::string& id) const;
    bool unlock(const std::string& id);

    // Valor acumulado de un efecto: las claves con "Mult" multiplican, el resto suma.
    double getEffect(const std::string& key, double base = 1.0) const;

    const std::set<std::string>& unlocked() const { return unlocked_; }
    void restore(int points, std::set<std::string> unlocked);

private:
    const GameData& data_;
    EventBus* bus_;
    int points_ = 0;
    std::set<std::string> unlocked_;
};

}  // namespace bazuko
