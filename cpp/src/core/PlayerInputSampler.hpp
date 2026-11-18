#pragma once
// Cliente: convierte el teclado y el raton (core/Input) en un PlayerInput del cuadro. Es lo unico que conoce las teclas del juego.
#include "Input.hpp"
#include "../game/PlayerInput.hpp"

#include <GLFW/glfw3.h>

#include <cstdlib>
#include <string>
#include <vector>

namespace Bazuko {

// Se llama una vez por cuadro, despues de sondear los eventos: los flancos de Input no cambian hasta el cuadro siguiente.
// Pruebas: BAZUKO_PRUEBA_PULSAR="E:4,Q:6,ESPACIO:5" pulsa esas teclas una vez, a los segundos indicados desde que abre el juego (sin teclado fisico)
inline void ApplyScriptedKeys(PlayerInput& in) {
    struct Scripted { std::string key; double at; bool fired; };
    static std::vector<Scripted> script = [] {
        std::vector<Scripted> parsed;
        if (const char* raw = std::getenv("BAZUKO_PRUEBA_PULSAR")) {
            std::string text = raw;
            size_t start = 0;
            while (start < text.size()) {
                size_t end = text.find(',', start);
                if (end == std::string::npos) end = text.size();
                const std::string entry = text.substr(start, end - start);
                const size_t colon = entry.find(':');
                if (colon != std::string::npos) parsed.push_back({entry.substr(0, colon), std::atof(entry.c_str() + colon + 1), false});
                start = end + 1;
            }
        }
        return parsed;
    }();
    for (Scripted& step : script) {
        if (step.fired || glfwGetTime() < step.at) continue;
        step.fired = true;
        if (step.key == "E") in.interactPressed = true;
        else if (step.key == "Q") { in.sortPressed = true; in.sortHeld = true; }
        else if (step.key == "ESPACIO") in.jumpPressed = true;
        else if (step.key == "F") in.collectPressed = true;
    }
}

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
    ApplyScriptedKeys(in);
    return in;
}

} // namespace Bazuko
