#pragma once

#include <array>
#include <cstddef>

namespace bazuko {

enum class Key {
    W, A, S, D, ShiftLeft, ShiftRight, ArrowUp, ArrowDown, ArrowLeft, ArrowRight,
    E, Q, F, V, B, L, T, C, P, M, F3, Escape, Space,
    Count
};

// Estado del teclado. `consumePress` devuelve true una sola vez por pulsación.
class Input {
public:
    void setKey(Key k, bool down);
    bool isDown(Key k) const { return down_[static_cast<size_t>(k)]; }
    bool consumePress(Key k);
    void endFrame() { pressed_.fill(false); }  // al FINAL de cada frame
    void releaseAll();                         // al perder el foco

    struct Axis { int x, z; };
    Axis axis() const;  // x = D−A, z = S−W
    bool isRunning() const { return isDown(Key::ShiftLeft) || isDown(Key::ShiftRight); }

private:
    std::array<bool, static_cast<size_t>(Key::Count)> down_{}, pressed_{};
};

}  // namespace bazuko
