#include "core/Input.h"

#include <cstddef>

namespace bazuko {

void Input::setKey(Key k, bool down) {
    const auto i = static_cast<size_t>(k);
    if (down && !down_[i]) pressed_[i] = true;
    down_[i] = down;
}

bool Input::consumePress(Key k) {
    const auto i = static_cast<size_t>(k);
    const bool was = pressed_[i];
    pressed_[i] = false;
    return was;
}

void Input::releaseAll() {
    down_.fill(false);
    pressed_.fill(false);
}

Input::Axis Input::axis() const {
    return {(isDown(Key::D) ? 1 : 0) - (isDown(Key::A) ? 1 : 0), (isDown(Key::S) ? 1 : 0) - (isDown(Key::W) ? 1 : 0)};
}

}  // namespace bazuko
