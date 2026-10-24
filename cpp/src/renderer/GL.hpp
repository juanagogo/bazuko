#pragma once
#include <glad/gl.h>
#include "../core/Log.hpp"

namespace Bazuko {

inline void GLAPIENTRY OpenGLDebugCallback(
    GLenum source,
    GLenum type,
    GLuint id,
    GLenum severity,
    GLsizei /*length*/,
    const GLchar* message,
    const void* /*userParam*/
) {
    if (severity == GL_DEBUG_SEVERITY_NOTIFICATION) return;

    const char* srcStr = "Other";
    switch (source) {
        case GL_DEBUG_SOURCE_API: srcStr = "API"; break;
        case GL_DEBUG_SOURCE_WINDOW_SYSTEM: srcStr = "WindowSystem"; break;
        case GL_DEBUG_SOURCE_SHADER_COMPILER: srcStr = "ShaderCompiler"; break;
        case GL_DEBUG_SOURCE_THIRD_PARTY: srcStr = "ThirdParty"; break;
        case GL_DEBUG_SOURCE_APPLICATION: srcStr = "Application"; break;
    }

    if (severity == GL_DEBUG_SEVERITY_HIGH) {
        LogError("[OpenGL HIGH] Src: {}, ID: {}: {}", srcStr, id, message);
    } else if (severity == GL_DEBUG_SEVERITY_MEDIUM) {
        LogWarn("[OpenGL MED] Src: {}, ID: {}: {}", srcStr, id, message);
    } else {
        LogDebug("[OpenGL LOW] Src: {}, ID: {}: {}", srcStr, id, message);
    }
}

inline void EnableOpenGLDebug() {
    GLint flags = 0;
    glGetIntegerv(GL_CONTEXT_FLAGS, &flags);
    if (flags & GL_CONTEXT_FLAG_DEBUG_BIT) {
        glEnable(GL_DEBUG_OUTPUT);
        glEnable(GL_DEBUG_OUTPUT_SYNCHRONOUS);
        glDebugMessageCallback(OpenGLDebugCallback, nullptr);
        glDebugMessageControl(GL_DONT_CARE, GL_DONT_CARE, GL_DONT_CARE, 0, nullptr, GL_TRUE);
        LogInfo("OpenGL 4.5 Debug Output habilitado");
    }
}

} // namespace Bazuko
