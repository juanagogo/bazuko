#include "core/FrameMetrics.h"

#include <algorithm>

namespace bazuko {

void FrameMetrics::reset() {
    hasPrevious_ = false;
    previous_ = 0;
    frames_ = 0;
    elapsed_ = 0;
    current_ = min_ = max_ = average_ = 0;
    frameMs_ = 0;
}

bool FrameMetrics::sample(double nowMs, bool active) {
    if (!active) {
        hasPrevious_ = false;
        return false;
    }
    const bool had = hasPrevious_;
    const double previous = previous_;
    previous_ = nowMs;
    hasPrevious_ = true;
    if (!had || nowMs <= previous) return false;

    frameMs_ = nowMs - previous;
    current_ = 1000.0 / frameMs_;
    ++frames_;
    elapsed_ += frameMs_;
    min_ = frames_ == 1 ? current_ : std::min(min_, current_);
    max_ = std::max(max_, current_);
    average_ = static_cast<double>(frames_) * 1000.0 / elapsed_;
    return true;
}

}  // namespace bazuko
