#pragma once

namespace bazuko {

// Mide intervalos reales de frame, nunca el dt limitado de la simulación.
class FrameMetrics {
public:
    FrameMetrics() { reset(); }

    void reset();
    // `nowMs` en milisegundos. Devuelve true si se registró una muestra.
    bool sample(double nowMs, bool active = true);

    double current() const { return current_; }
    double min() const { return min_; }
    double max() const { return max_; }
    double average() const { return average_; }
    double frameMs() const { return frameMs_; }

private:
    bool hasPrevious_ = false;
    double previous_ = 0;
    long frames_ = 0;
    double elapsed_ = 0;
    double current_ = 0, min_ = 0, max_ = 0, average_ = 0;
    double frameMs_ = 0;
};

}  // namespace bazuko
