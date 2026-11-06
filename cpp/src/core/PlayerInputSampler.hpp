#pragma once
// Cliente: convierte el teclado y el raton (core/Input) en un PlayerInput del cuadro. Es lo unico que conoce las teclas del juego.
#include "Input.hpp"
#include "../game/PlayerInput.hpp"

#include <GLFW/glfw3.h>

namespace Bazuko {

// Se llama una vez por cuadro, despues de sondear los eventos: los flancos de Input no cambian hasta el cuadro siguiente.
inline PlayerInput SamplePlayerInput() {
    PlayerInput in;
    in.forward = Input::IsKeyDown(GLFW_KEY_W);
    in.back = Input::IsKeyDown(GLFW_KEY_S);
    in.left = Input::IsKeyDown(GLFW_KEY_A);
    in.right = Input::IsKeyDown(GLFW_KEY_D);
    in.run = Input::IsKeyDown(GLFW_KEY_LEFT_SHIFT) || Input::IsKeyDown(GLFW_KEY_RIGHT_SHIFT);
    in.crouch = Input::IsKeyDown(GLFW_KEY_LEFT_CONTROL);
    in.jumpPressed = Input::IsKeyPressed(GLFW_KEY_SPACE);
    in.punchPressed = Input::IsKeyPressed(GLFW_KEY_J);
    in.kickPressed = Input::IsKeyPressed(GLFW_KEY_K);
    in.dodgePressed = Input::IsKeyPressed(GLFW_KEY_G);
    in.knifePressed = Input::IsKeyPressed(GLFW_KEY_H);
    in.clickPressed = Input::IsMouseButtonPressed(GLFW_MOUSE_BUTTON_LEFT);
    in.clickDown = Input::IsMouseButtonDown(GLFW_MOUSE_BUTTON_LEFT);
    in.clickReleased = Input::IsMouseButtonReleased(GLFW_MOUSE_BUTTON_LEFT);
    in.interactPressed = Input::IsKeyPressed(GLFW_KEY_E);
    in.collectPressed = Input::IsKeyPressed(GLFW_KEY_F);
    in.sortPressed = Input::IsKeyPressed(GLFW_KEY_Q);
    in.sortHeld = Input::IsKeyDown(GLFW_KEY_Q);
    in.shopPressed = Input::IsKeyPressed(GLFW_KEY_B) || Input::IsKeyPressed(GLFW_KEY_L);
    in.poopPressed = Input::IsKeyPressed(GLFW_KEY_Z);
    in.throwPressed = Input::IsKeyPressed(GLFW_KEY_X);
    for (size_t slot = 0; slot < in.hotbarPressed.size(); ++slot) in.hotbarPressed[slot] = Input::IsKeyPressed(GLFW_KEY_1 + static_cast<int>(slot));
    return in;
}

} // namespace Bazuko
