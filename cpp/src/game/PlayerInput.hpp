#pragma once
// Lo que el jugador QUIERE hacer en un cuadro, sin teclas ni ventana: el cliente lo rellena desde el teclado y el raton (core/PlayerInputSampler.hpp)
// y, en multijugador, lo manda al servidor (net/Protocol.hpp usa una version cuantizada de estas mismas intenciones). La logica de juego lee esta
// estructura y no la entrada; asi el mismo codigo sirve para un jugador local, para uno remoto y para las pruebas.
// Los flancos ("Pressed") valen para ese cuadro. Las condiciones de contexto (pausa, creador abierto, caido...) las aplica quien consume cada intencion.
#include <array>
#include <cmath>
#include <glm/glm.hpp>

namespace Bazuko {

struct PlayerInput {
    // movimiento
    bool forward = false, back = false, left = false, right = false;   // W, S, A, D
    bool run = false;                                                   // shift
    bool crouch = false;                                                // control (mantenido)
    bool jumpPressed = false;                                           // espacio
    // acciones de pelea
    bool punchPressed = false;                                          // J
    bool kickPressed = false;                                           // K
    bool dodgePressed = false;                                          // G
    bool knifePressed = false;                                          // H
    bool clickPressed = false, clickDown = false, clickReleased = false; // boton izquierdo del raton
    // interaccion y economia
    bool interactPressed = false;                                       // E
    bool collectPressed = false;                                        // F
    bool sortPressed = false, sortHeld = false;                         // Q
    bool shopPressed = false;                                           // B o L
    bool poopPressed = false, throwPressed = false;                     // Z y X
    std::array<bool, 5> hotbarPressed{};                                // teclas 1 a 5
};

// Direccion deseada en el mundo (sin normalizar). En tercera persona es relativa a la camara (W avanza hacia donde mira); en las demas vistas
// es isometrica fija. Mismo orden de sumas que el codigo original de main().
inline glm::vec3 MoveDirection(const PlayerInput& input, bool thirdPerson, float cameraYaw) {
    glm::vec3 moveDir(0.0f);
    if (thirdPerson) {
        const glm::vec3 forward = glm::normalize(glm::vec3(std::sin(cameraYaw), 0.0f, std::cos(cameraYaw)));
        const glm::vec3 rightVector = glm::normalize(glm::vec3(std::cos(cameraYaw), 0.0f, -std::sin(cameraYaw)));
        if (input.forward) moveDir -= forward;
        if (input.back) moveDir += forward;
        if (input.left) moveDir -= rightVector;
        if (input.right) moveDir += rightVector;
    } else {
        if (input.forward) moveDir += glm::vec3(-1.0f, 0.0f, -1.0f);
        if (input.back) moveDir += glm::vec3( 1.0f, 0.0f,  1.0f);
        if (input.left) moveDir += glm::vec3(-1.0f, 0.0f,  1.0f);
        if (input.right) moveDir += glm::vec3( 1.0f, 0.0f, -1.0f);
    }
    return moveDir;
}

} // namespace Bazuko
