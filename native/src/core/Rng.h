#pragma once

#include <cstdint>
#include <random>

namespace bazuko {

// Fuente de azar inyectable: el juego usa Mt19937Rng y los tests una secuencia fija.
class Rng {
public:
    virtual ~Rng() = default;
    virtual double next() = 0;  // [0, 1)
    int below(int n) { return static_cast<int>(next() * n); }
};

class Mt19937Rng : public Rng {
public:
    explicit Mt19937Rng(std::uint64_t seed = std::random_device{}()) : gen_(seed) {}
    double next() override { return dist_(gen_); }

private:
    std::mt19937_64 gen_;
    std::uniform_real_distribution<double> dist_{0.0, 1.0};
};

}  // namespace bazuko
