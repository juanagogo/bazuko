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

GLint Shader::GetUniformLocation(std::string_view name) {
    std::string key(name);
    auto it = m_UniformLocationCache.find(key);
    if (it != m_UniformLocationCache.end()) return it->second;

    GLint location = glGetUniformLocation(m_ProgramID, key.c_str());
    m_UniformLocationCache[key] = location;
    return location;
}

void Shader::SetInt(std::string_view name, int value) {
    GLint loc = GetUniformLocation(name);
    if (loc != -1) glProgramUniform1i(m_ProgramID, loc, value);
}

void Shader::SetFloat(std::string_view name, float value) {
    GLint loc = GetUniformLocation(name);
    if (loc != -1) glProgramUniform1f(m_ProgramID, loc, value);
}

void Shader::SetVec2(std::string_view name, const glm::vec2& value) {
    GLint loc = GetUniformLocation(name);
    if (loc != -1) glProgramUniform2f(m_ProgramID, loc, value.x, value.y);
}

void Shader::SetVec3(std::string_view name, const glm::vec3& value) {
    GLint loc = GetUniformLocation(name);
    if (loc != -1) glProgramUniform3f(m_ProgramID, loc, value.x, value.y, value.z);
}

void Shader::SetVec4(std::string_view name, const glm::vec4& value) {
    GLint loc = GetUniformLocation(name);
    if (loc != -1) glProgramUniform4f(m_ProgramID, loc, value.x, value.y, value.z, value.w);
}

void Shader::SetMat4(std::string_view name, const glm::mat4& value) {
    GLint loc = GetUniformLocation(name);
    if (loc != -1) glProgramUniformMatrix4fv(m_ProgramID, loc, 1, GL_FALSE, &value[0][0]);
}

} // namespace Bazuko
