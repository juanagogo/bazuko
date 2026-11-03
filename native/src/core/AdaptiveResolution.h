#pragma once

namespace bazuko {

// Resolución interna dinámica con ventanas largas e histéresis, para no cambiar por un tirón aislado
// (AdaptiveResolution.js). `ratio` multiplica el tamaño de la ventana en píxeles.
class AdaptiveResolution {
public:
    explicit AdaptiveResolution(double deviceRatio = 1);

    double ratio() const { return ratio_; }
    double minRatio() const { return min_; }
    double maxRatio() const { return max_; }

    void resetWindow();
    // Acumula el tiempo de un cuadro (ms). true si la resolución cambió.
    bool sample(double frameMs);

private:
    double max_, min_, ratio_;
    double elapsed_ = 0;
    int frames_ = 0, fastWindows_ = 0;
};

}  // namespace bazuko
