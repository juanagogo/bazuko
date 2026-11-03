#pragma once

#include <cstddef>
#include <variant>
#include <string>
#include <vector>

#include "core/Rng.h"
#include "game/EventBus.h"
#include "game/data/GameData.h"

namespace testutil {

inline const bazuko::GameData& data() {
    static const bazuko::GameData d = bazuko::GameData::load(std::string(BAZUKO_DATA_DIR) + "/game_data.json");
    return d;
}

// Devuelve una secuencia fija y repite el último valor al agotarse.
class SeqRng : public bazuko::Rng {
public:
    explicit SeqRng(std::vector<double> v) : v_(std::move(v)) {}
    double next() override { return i_ < v_.size() ? v_[i_++] : v_.back(); }

private:
    std::vector<double> v_;
    std::size_t i_ = 0;
};

// Siempre el mismo valor.
class ConstRng : public bazuko::Rng {
public:
    explicit ConstRng(double v) : v_(v) {}
    double next() override { return v_; }

private:
    double v_;
};

template <class T>
const T* first(const std::vector<bazuko::GameEvent>& events) {
    for (const auto& e : events)
        if (auto* p = std::get_if<T>(&e)) return p;
    return nullptr;
}

}  // namespace testutil
