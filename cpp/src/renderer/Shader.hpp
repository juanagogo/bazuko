#pragma once
#include <string>
#include <string_view>
#include <unordered_map>
#include <array>
#include <cstring>
#include <glm/glm.hpp>
#include <glad/gl.h>

namespace Bazuko {

class Shader {
public:
    Shader(const std::string& vertexPath, const std::string& fragmentPath);
    ~Shader();

    Shader(const Shader&) = delete;
    Shader& operator=(const Shader&) = delete;
    Shader(Shader&& other) noexcept;
    Shader& operator=(Shader&& other) noexcept;

    void Bind() const;
    void Unbind() const;

    GLuint GetID() const { return m_ProgramID; }

    // Uniform helpers (OpenGL 4.5 DSA glProgramUniform* - works even without binding!)
    void SetInt(std::string_view name, int value);
    void SetFloat(std::string_view name, float value);
    void SetVec2(std::string_view name, const glm::vec2& value);
    void SetVec3(std::string_view name, const glm::vec3& value);
    void SetVec4(std::string_view name, const glm::vec4& value);
    void SetMat4(std::string_view name, const glm::mat4& value);

private:
    static std::string ReadFile(const std::string& filepath);
    static GLuint CompileShader(GLenum type, const std::string& source, const std::string& debugName);
    // Busqueda sin crear std::string y con el ultimo valor enviado: los uniformes que no cambian entre dibujos no tocan el driver
    struct UniformSlot { GLint location = -1; std::array<float, 16> value{}; bool valid = false; };
    struct NameHash {
        using is_transparent = void;
        size_t operator()(std::string_view text) const { return std::hash<std::string_view>{}(text); }
        size_t operator()(const std::string& text) const { return std::hash<std::string_view>{}(text); }
    };
    UniformSlot& Slot(std::string_view name);
    std::unordered_map<std::string, UniformSlot, NameHash, std::equal_to<>> m_Slots;

    GLuint m_ProgramID = 0;
    std::unordered_map<std::string, GLint> m_UniformLocationCache;
};

} // namespace Bazuko
