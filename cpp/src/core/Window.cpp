#include "Window.hpp"
#include "../renderer/GL.hpp"
#include "../core/Log.hpp"
#include <GLFW/glfw3.h>
#include <stdexcept>

namespace Bazuko {

Window::Window(const WindowConfig& config)
    : m_Width(config.width), m_Height(config.height),
      m_WindowedWidth(config.width), m_WindowedHeight(config.height) {

    if (!glfwInit()) {
        throw std::runtime_error("Fallo al inicializar GLFW");
    }

    // Configurar OpenGL 4.5 Core Profile
    glfwWindowHint(GLFW_CONTEXT_VERSION_MAJOR, 4);
    glfwWindowHint(GLFW_CONTEXT_VERSION_MINOR, 5);
    glfwWindowHint(GLFW_OPENGL_PROFILE, GLFW_OPENGL_CORE_PROFILE);
    glfwWindowHint(GLFW_OPENGL_FORWARD_COMPAT, GLFW_TRUE);
    glfwWindowHint(GLFW_SAMPLES, 0);

    // Habilitar expresamente que la ventana sea redimensionable y tenga decoraciones completas (maximizar, minimizar, cerrar)
    glfwWindowHint(GLFW_RESIZABLE, config.resizable ? GLFW_TRUE : GLFW_FALSE);
    glfwWindowHint(GLFW_DECORATED, GLFW_TRUE);

    m_Window = glfwCreateWindow(m_Width, m_Height, config.title.c_str(), nullptr, nullptr);
    if (!m_Window) {
        glfwTerminate();
        throw std::runtime_error("Fallo al crear la ventana GLFW para OpenGL 4.5 Core");
    }

    // Permitir redimensionar sin límite superior (pero con mínimo de 640x480)
    glfwSetWindowSizeLimits(m_Window, 640, 480, GLFW_DONT_CARE, GLFW_DONT_CARE);

    glfwMakeContextCurrent(m_Window);
    glfwSwapInterval(config.vsync ? 1 : 0);

    // Cargar funciones de OpenGL 4.5 con GLAD2
    int version = gladLoadGL(glfwGetProcAddress);
    if (version == 0) {
        glfwDestroyWindow(m_Window);
        glfwTerminate();
        throw std::runtime_error("Fallo al inicializar GLAD para OpenGL 4.5");
    }

    LogInfo("OpenGL Context inicializado exitosamente: {}.{}", 
            GLAD_VERSION_MAJOR(version), GLAD_VERSION_MINOR(version));
    LogInfo("GPU: {}", reinterpret_cast<const char*>(glGetString(GL_RENDERER)));

    EnableOpenGLDebug();

    glfwSetWindowUserPointer(m_Window, this);
    glfwSetFramebufferSizeCallback(m_Window, FramebufferSizeCallback);

    // Guardar posición inicial de ventana
    glfwGetWindowPos(m_Window, &m_WindowedX, &m_WindowedY);
}

Window::~Window() {
    if (m_Window) {
        glfwDestroyWindow(m_Window);
    }
    glfwTerminate();
}

bool Window::ShouldClose() const {
    return glfwWindowShouldClose(m_Window);
}

void Window::PollEvents() {
    glfwPollEvents();
}

void Window::SwapBuffers() {
    glfwSwapBuffers(m_Window);
}

void Window::Maximize() {
    if (m_Window) {
        glfwMaximizeWindow(m_Window);
    }
}

void Window::ToggleFullscreen() {
    if (!m_Window) return;

    if (!m_IsFullscreen) {
        // Guardar dimensiones y posición previas
        glfwGetWindowPos(m_Window, &m_WindowedX, &m_WindowedY);
        glfwGetWindowSize(m_Window, &m_WindowedWidth, &m_WindowedHeight);

        GLFWmonitor* monitor = glfwGetPrimaryMonitor();
        const GLFWvidmode* mode = glfwGetVideoMode(monitor);
        if (monitor && mode) {
            glfwSetWindowMonitor(m_Window, monitor, 0, 0, mode->width, mode->height, mode->refreshRate);
            m_IsFullscreen = true;
            LogInfo("Modo pantalla completa activado: {}x{}", mode->width, mode->height);
        }
    } else {
        // Restaurar modo ventana
        glfwSetWindowMonitor(m_Window, nullptr, m_WindowedX, m_WindowedY, m_WindowedWidth, m_WindowedHeight, 0);
        m_IsFullscreen = false;
        LogInfo("Modo ventana restaurado: {}x{}", m_WindowedWidth, m_WindowedHeight);
    }
}

void Window::FramebufferSizeCallback(GLFWwindow* window, int width, int height) {
    auto* self = static_cast<Window*>(glfwGetWindowUserPointer(window));
    if (self && width > 0 && height > 0) {
        self->m_Width = width;
        self->m_Height = height;
        glViewport(0, 0, width, height);
        if (self->m_ResizeCallback) {
            self->m_ResizeCallback(width, height);
        }
    }
}

} // namespace Bazuko
