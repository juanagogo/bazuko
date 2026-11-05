#include "core/FrameLoop.h"

#include <algorithm>

namespace bazuko {

double clampDt(double realSeconds) {
    return std::clamp(realSeconds, 0.0, kMaxDt);
}

}  // namespace bazuko
