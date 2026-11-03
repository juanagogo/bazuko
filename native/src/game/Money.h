#pragma once

#include <cmath>
#include <string>

namespace bazuko {

// Pesos colombianos: 12500 → "$ 12.500" (miles con punto, sin decimales).
inline std::string cop(double n) {
    const long long v = static_cast<long long>(std::floor(n + 0.5));
    std::string digits = std::to_string(v < 0 ? -v : v), out;
    for (size_t i = 0; i < digits.size(); ++i) {
        if (i > 0 && (digits.size() - i) % 3 == 0) out.push_back('.');
        out.push_back(digits[i]);
    }
    return std::string("$ ") + (v < 0 ? "-" : "") + out;
}

}  // namespace bazuko
