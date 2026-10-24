#pragma once
#include <chrono>

namespace Bazuko {

class Clock {
public:
    Clock() {
        Reset();
    }

    void Reset() {
        m_Start = std::chrono::high_resolution_clock::now();
        m_LastFrame = m_Start;
    }

    float Tick() {
        auto now = std::chrono::high_resolution_clock::now();
        std::chrono::duration<float> delta = now - m_LastFrame;
        m_LastFrame = now;
        return delta.count();
    }

    float GetElapsedTime() const {
        auto now = std::chrono::high_resolution_clock::now();
        std::chrono::duration<float> elapsed = now - m_Start;
        return elapsed.count();
    }

private:
    std::chrono::time_point<std::chrono::high_resolution_clock> m_Start;
    std::chrono::time_point<std::chrono::high_resolution_clock> m_LastFrame;
};

} // namespace Bazuko
