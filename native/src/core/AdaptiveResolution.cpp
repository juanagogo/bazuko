#include "core/AdaptiveResolution.h"

#include <algorithm>
#include <cmath>

namespace bazuko {

AdaptiveResolution::AdaptiveResolution(double deviceRatio) {
    max_ = std::min(deviceRatio > 0 ? deviceRatio : 1.0, 1.5);
    min_ = std::min(max_, 0.75);
    ratio_ = max_;
    resetWindow();
}

void AdaptiveResolution::resetWindow() {
    elapsed_ = 0;
    frames_ = 0;
    fastWindows_ = 0;
}

bool AdaptiveResolution::sample(double frameMs) {
    if (!std::isfinite(frameMs) || frameMs <= 0) return false;
    elapsed_ += frameMs;
    ++frames_;
    if (elapsed_ < 3000) return false;
    const double fps = frames_ * 1000.0 / elapsed_;
    elapsed_ = 0;
    frames_ = 0;
    const double before = ratio_;
    if (fps < 45) {
        ratio_ = std::max(min_, ratio_ - 0.15);
        fastWindows_ = 0;
    } else if (fps > 57) {
        if (++fastWindows_ >= 4) {
            ratio_ = std::min(max_, ratio_ + 0.15);
            fastWindows_ = 0;
        }
    } else {
        fastWindows_ = 0;
    }
    return ratio_ != before;
}

}  // namespace bazuko
