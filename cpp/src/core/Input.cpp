#include "Input.hpp"
#include <GLFW/glfw3.h>
#include <cstring>
#include <cmath>
#include <vector>

namespace Bazuko {

void Input::Init(GLFWwindow* window) {
    s_Window = window;
    std::memset(s_Keys, 0, sizeof(s_Keys));
    std::memset(s_PrevKeys, 0, sizeof(s_PrevKeys));
    std::memset(s_MouseButtons, 0, sizeof(s_MouseButtons));
    std::memset(s_PrevMouseButtons, 0, sizeof(s_PrevMouseButtons));
    s_FirstMouseMove = true;
    s_MouseDelta = {0.0f, 0.0f};
    s_ScrollDelta = 0.0f;

    // Cursor transparente 1x1 (fallback universal para cualquier compositor)
    unsigned char px[4] = {0, 0, 0, 0};
    GLFWimage img{1, 1, px};
    s_BlankCursor = glfwCreateCursor(&img, 0, 0);

    double x, y;
    glfwGetCursorPos(window, &x, &y);
    s_MousePos   = {static_cast<float>(x), static_cast<float>(y)};
    s_PrevMousePos = s_MousePos;

    glfwSetKeyCallback        (window, KeyCallback);
    glfwSetMouseButtonCallback(window, MouseButtonCallback);
    glfwSetCursorPosCallback  (window, CursorPosCallback);
    glfwSetScrollCallback     (window, ScrollCallback);

    SetCursorLocked(true);
}

void Input::Shutdown() {
    if (s_BlankCursor) { glfwDestroyCursor(s_BlankCursor); s_BlankCursor = nullptr; }
}

void Input::BeginFrame() {
    std::memcpy(s_PrevKeys,         s_Keys,        sizeof(s_Keys));
    std::memcpy(s_PrevMouseButtons, s_MouseButtons, sizeof(s_MouseButtons));
    std::memset(s_KeyPressedEdge, 0, sizeof(s_KeyPressedEdge));
    std::memset(s_KeyReleasedEdge, 0, sizeof(s_KeyReleasedEdge));
    std::memset(s_MousePressedEdge, 0, sizeof(s_MousePressedEdge));
    std::memset(s_MouseReleasedEdge, 0, sizeof(s_MouseReleasedEdge));
    s_MouseDelta  = {0.0f, 0.0f};
    s_ScrollDelta = 0.0f;
}

void Input::PostPoll() {
    if (!s_Window) return;
    double x, y;
    glfwGetCursorPos(s_Window, &x, &y);
    glm::vec2 cur = {static_cast<float>(x), static_cast<float>(y)};
    if (s_FirstMouseMove) { s_PrevMousePos = cur; s_FirstMouseMove = false; }
    // El delta del callback tiene prioridad; usar polling como respaldo
    if (std::abs(s_MouseDelta.x) < 0.0001f && std::abs(s_MouseDelta.y) < 0.0001f)
        s_MouseDelta = cur - s_PrevMousePos;
    s_PrevMousePos = cur;
    s_MousePos     = cur;
}

bool Input::IsKeyDown      (int key)    { return key>=0&&key<512  ? s_Keys[key]                         : false; }
bool Input::IsKeyPressed   (int key)    { return key>=0&&key<512  ? s_KeyPressedEdge[key]               : false; }
bool Input::IsKeyReleased  (int key)    { return key>=0&&key<512  ? s_KeyReleasedEdge[key]              : false; }
bool Input::IsMouseButtonDown    (int b){ return b>=0&&b<16       ? s_MouseButtons[b]                   : false; }
bool Input::IsMouseButtonPressed (int b){ return b>=0&&b<16       ? s_MousePressedEdge[b]               : false; }
bool Input::IsMouseButtonReleased(int b){ return b>=0&&b<16       ? s_MouseReleasedEdge[b]              : false; }

void Input::SetCursorLocked(bool locked) {
    s_CursorLocked = locked;
    if (!s_Window) return;

    if (locked) {
        // GLFW_CURSOR_DISABLED confina+oculta en Windows y X11 nativo.
        // En WSLg falla (bug conocido), pero en Windows nativo funciona perfectamente.
        glfwSetInputMode(s_Window, GLFW_CURSOR, GLFW_CURSOR_DISABLED);
        // Doble seguro: cursor transparente sobre la ventana
        if (s_BlankCursor) glfwSetCursor(s_Window, s_BlankCursor);
    } else {
        glfwSetCursor(s_Window, nullptr);
        glfwSetInputMode(s_Window, GLFW_CURSOR, GLFW_CURSOR_NORMAL);
    }

    double x, y;
    glfwGetCursorPos(s_Window, &x, &y);
    s_PrevMousePos = {static_cast<float>(x), static_cast<float>(y)};
    s_MousePos     = s_PrevMousePos;
    s_MouseDelta   = {0.0f, 0.0f};
    s_FirstMouseMove = true;
}

void Input::ToggleCursorLock() { SetCursorLocked(!s_CursorLocked); }

void Input::KeyCallback(GLFWwindow*, int key, int, int action, int) {
    if (key>=0&&key<512) { if(action==GLFW_PRESS) { s_Keys[key]=true; s_KeyPressedEdge[key]=true; } else if(action==GLFW_RELEASE) { s_Keys[key]=false; s_KeyReleasedEdge[key]=true; } }
}
void Input::MouseButtonCallback(GLFWwindow*, int btn, int action, int) {
    if (btn>=0&&btn<16) { if(action==GLFW_PRESS) { s_MouseButtons[btn]=true; s_MousePressedEdge[btn]=true; } else if(action==GLFW_RELEASE) { s_MouseButtons[btn]=false; s_MouseReleasedEdge[btn]=true; } }
}
void Input::CursorPosCallback(GLFWwindow*, double xpos, double ypos) {
    glm::vec2 cur = {static_cast<float>(xpos), static_cast<float>(ypos)};
    if (s_FirstMouseMove) { s_PrevMousePos = cur; s_FirstMouseMove = false; }
    s_MouseDelta  += cur - s_PrevMousePos;
    s_PrevMousePos = cur;
    s_MousePos     = cur;
}
void Input::ScrollCallback(GLFWwindow*, double, double yoffset) {
    s_ScrollDelta += static_cast<float>(yoffset);
}

} // namespace Bazuko
