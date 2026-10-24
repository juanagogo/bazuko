#pragma once
#include <string>
#include <functional>

struct GLFWwindow;
struct GLFWmonitor;

namespace Bazuko {

struct WindowConfig {
    std::string title = "Bazuko - Bogota 3D (OpenGL 4.5)";
    int width = 1280;
    int height = 720;
    bool vsync = false;
    bool resizable = true;
};

class Window {
public:
    Window(const WindowConfig& config = WindowConfig());
    ~Window();

    bool ShouldClose() const;
    void PollEvents();
    void SwapBuffers();

    int GetWidth() const { return m_Width; }
    int GetHeight() const { return m_Height; }
    float GetAspectRatio() const { return static_cast<float>(m_Width) / static_cast<float>(m_Height > 0 ? m_Height : 1); }
    GLFWwindow* GetNativeWindow() const { return m_Window; }

    void SetResizeCallback(std::function<void(int, int)> callback) { m_ResizeCallback = callback; }

    void Maximize();
    void ToggleFullscreen();
    bool IsFullscreen() const { return m_IsFullscreen; }

private:
    static void FramebufferSizeCallback(GLFWwindow* window, int width, int height);

    GLFWwindow* m_Window = nullptr;
    int m_Width = 1280;
    int m_Height = 720;
    int m_WindowedX = 100;
    int m_WindowedY = 100;
    int m_WindowedWidth = 1280;
    int m_WindowedHeight = 720;
    bool m_IsFullscreen = false;
    std::function<void(int, int)> m_ResizeCallback;
};

} // namespace Bazuko
