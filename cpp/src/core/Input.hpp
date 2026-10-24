#pragma once
#include <glm/glm.hpp>

struct GLFWwindow;
struct GLFWcursor;

namespace Bazuko {

class Input {
public:
    static void Init(GLFWwindow* window);
    static void BeginFrame();
    static void PostPoll();
    static void Shutdown();

    static bool IsKeyDown(int key);
    static bool IsKeyPressed(int key);
    static bool IsKeyReleased(int key);

    static bool IsMouseButtonDown(int button);
    static bool IsMouseButtonPressed(int button);
    static bool IsMouseButtonReleased(int button);

    static glm::vec2 GetMousePos() { return s_MousePos; }
    static glm::vec2 GetMouseDelta() { return s_MouseDelta; }
    static float GetScrollDelta() { return s_ScrollDelta; }

    static void SetCursorLocked(bool locked);
    static bool IsCursorLocked() { return s_CursorLocked; }
    static void ToggleCursorLock();

private:
    static void KeyCallback(GLFWwindow* window, int key, int scancode, int action, int mods);
    static void MouseButtonCallback(GLFWwindow* window, int button, int action, int mods);
    static void CursorPosCallback(GLFWwindow* window, double xpos, double ypos);
    static void ScrollCallback(GLFWwindow* window, double xoffset, double yoffset);

    static inline GLFWwindow* s_Window = nullptr;
    static inline GLFWcursor* s_BlankCursor = nullptr;
    static inline bool s_Keys[512] = {false};
    static inline bool s_PrevKeys[512] = {false};
    static inline bool s_MouseButtons[16] = {false};
    // Flancos registrados en los callbacks: un toque más corto que un fotograma tampoco se pierde.
    static inline bool s_KeyPressedEdge[512] = {false};
    static inline bool s_KeyReleasedEdge[512] = {false};
    static inline bool s_MousePressedEdge[16] = {false};
    static inline bool s_MouseReleasedEdge[16] = {false};
    static inline bool s_PrevMouseButtons[16] = {false};

    static inline glm::vec2 s_MousePos = {0.0f, 0.0f};
    static inline glm::vec2 s_PrevMousePos = {0.0f, 0.0f};
    static inline glm::vec2 s_MouseDelta = {0.0f, 0.0f};
    static inline float s_ScrollDelta = 0.0f;
    static inline bool s_CursorLocked = true;
    static inline bool s_FirstMouseMove = true;
};

} // namespace Bazuko
