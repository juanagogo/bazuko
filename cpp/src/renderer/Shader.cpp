#include "Shader.hpp"
#include "../core/Log.hpp"
#include <fstream>
#include <sstream>
#include <vector>
#include <utility>

namespace Bazuko {

Shader::Shader(const std::string& vertexPath, const std::string& fragmentPath) {
    std::string vertSrc = ReadFile(vertexPath);
    std::string fragSrc = ReadFile(fragmentPath);

    GLuint vertID = CompileShader(GL_VERTEX_SHADER, vertSrc, vertexPath);
    GLuint fragID = CompileShader(GL_FRAGMENT_SHADER, fragSrc, fragmentPath);

    m_ProgramID = glCreateProgram();
    glAttachShader(m_ProgramID, vertID);
    glAttachShader(m_ProgramID, fragID);
    glLinkProgram(m_ProgramID);

    GLint linked = 0;
    glGetProgramiv(m_ProgramID, GL_LINK_STATUS, &linked);
    if (!linked) {
        GLint logLen = 0;
        glGetProgramiv(m_ProgramID, GL_INFO_LOG_LENGTH, &logLen);
        std::vector<char> log(logLen);
        glGetProgramInfoLog(m_ProgramID, logLen, nullptr, log.data());
        LogError("Error al linkear programa de shader: {}", log.data());
    }

    glDetachShader(m_ProgramID, vertID);
    glDetachShader(m_ProgramID, fragID);
    glDeleteShader(vertID);
    glDeleteShader(fragID);
}

Shader::~Shader() {
    if (m_ProgramID != 0) {
        glDeleteProgram(m_ProgramID);
    }
}

Shader::Shader(Shader&& other) noexcept
    : m_ProgramID(other.m_ProgramID), m_UniformLocationCache(std::move(other.m_UniformLocationCache)) {
    other.m_ProgramID = 0;
}

Shader& Shader::operator=(Shader&& other) noexcept {
    if (this != &other) {
        if (m_ProgramID != 0) glDeleteProgram(m_ProgramID);
        m_ProgramID = other.m_ProgramID;
        m_UniformLocationCache = std::move(other.m_UniformLocationCache);
        other.m_ProgramID = 0;
    }
    return *this;
}

void Shader::Bind() const {
    glUseProgram(m_ProgramID);
}

void Shader::Unbind() const {
    glUseProgram(0);
}

std::string Shader::ReadFile(const std::string& filepath) {
    std::ifstream file(filepath);
    if (!file.is_open()) {
        LogError("No se pudo abrir el archivo de shader: {}", filepath);
        return "";
    }
    std::stringstream buffer;
    buffer << file.rdbuf();
    return buffer.str();
}

GLuint Shader::CompileShader(GLenum type, const std::string& source, const std::string& debugName) {
    GLuint id = glCreateShader(type);
    const char* src = source.c_str();
    glShaderSource(id, 1, &src, nullptr);
    glCompileShader(id);

    GLint compiled = 0;
    glGetShaderiv(id, GL_COMPILE_STATUS, &compiled);
    if (!compiled) {
        GLint logLen = 0;
        glGetShaderiv(id, GL_INFO_LOG_LENGTH, &logLen);
        std::vector<char> log(logLen);
        glGetShaderInfoLog(id, logLen, nullptr, log.data());
        LogError("Error de compilacion en shader [{}]:\n{}", debugName, log.data());
    }
    return id;
}

Shader::UniformSlot& Shader::Slot(std::string_view name) {
    auto it = m_Slots.find(name);
    if (it != m_Slots.end()) return it->second;
    UniformSlot slot;
    slot.location = glGetUniformLocation(m_ProgramID, std::string(name).c_str());
    return m_Slots.emplace(std::string(name), slot).first->second;
}

void Shader::SetInt(std::string_view name, int value) {
    UniformSlot& slot = Slot(name);
    if (slot.location == -1) return;
    const float key = static_cast<float>(value);
    if (slot.valid && slot.value[0] == key) return;
    slot.value[0] = key; slot.valid = true;
    glProgramUniform1i(m_ProgramID, slot.location, value);
}

void Shader::SetFloat(std::string_view name, float value) {
    UniformSlot& slot = Slot(name);
    if (slot.location == -1) return;
    if (slot.valid && slot.value[0] == value) return;
    slot.value[0] = value; slot.valid = true;
    glProgramUniform1f(m_ProgramID, slot.location, value);
}

void Shader::SetVec2(std::string_view name, const glm::vec2& value) {
    UniformSlot& slot = Slot(name);
    if (slot.location == -1) return;
    if (slot.valid && slot.value[0] == value.x && slot.value[1] == value.y) return;
    slot.value[0] = value.x; slot.value[1] = value.y; slot.valid = true;
    glProgramUniform2f(m_ProgramID, slot.location, value.x, value.y);
}

void Shader::SetVec3(std::string_view name, const glm::vec3& value) {
    UniformSlot& slot = Slot(name);
    if (slot.location == -1) return;
    if (slot.valid && std::memcmp(slot.value.data(), &value[0], sizeof(float) * 3) == 0) return;
    std::memcpy(slot.value.data(), &value[0], sizeof(float) * 3); slot.valid = true;
    glProgramUniform3f(m_ProgramID, slot.location, value.x, value.y, value.z);
}

void Shader::SetVec4(std::string_view name, const glm::vec4& value) {
    UniformSlot& slot = Slot(name);
    if (slot.location == -1) return;
    if (slot.valid && std::memcmp(slot.value.data(), &value[0], sizeof(float) * 4) == 0) return;
    std::memcpy(slot.value.data(), &value[0], sizeof(float) * 4); slot.valid = true;
    glProgramUniform4f(m_ProgramID, slot.location, value.x, value.y, value.z, value.w);
}

void Shader::SetMat4(std::string_view name, const glm::mat4& value) {
    UniformSlot& slot = Slot(name);
    if (slot.location == -1) return;
    if (slot.valid && std::memcmp(slot.value.data(), &value[0][0], sizeof(float) * 16) == 0) return;
    std::memcpy(slot.value.data(), &value[0][0], sizeof(float) * 16); slot.valid = true;
    glProgramUniformMatrix4fv(m_ProgramID, slot.location, 1, GL_FALSE, &value[0][0]);
}

} // namespace Bazuko
