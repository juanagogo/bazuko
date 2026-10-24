#include "Buffer.hpp"
#include <utility>

namespace Bazuko {

// --- VertexBuffer (OpenGL 4.5 DSA) ---
VertexBuffer::VertexBuffer(const void* data, size_t size, GLenum usage)
    : m_Size(size) {
    glCreateBuffers(1, &m_ID);
    glNamedBufferData(m_ID, size, data, usage);
}

VertexBuffer::~VertexBuffer() {
    if (m_ID != 0) {
        glDeleteBuffers(1, &m_ID);
    }
}

VertexBuffer::VertexBuffer(VertexBuffer&& other) noexcept
    : m_ID(other.m_ID), m_Size(other.m_Size) {
    other.m_ID = 0;
    other.m_Size = 0;
}

VertexBuffer& VertexBuffer::operator=(VertexBuffer&& other) noexcept {
    if (this != &other) {
        if (m_ID != 0) glDeleteBuffers(1, &m_ID);
        m_ID = other.m_ID;
        m_Size = other.m_Size;
        other.m_ID = 0;
        other.m_Size = 0;
    }
    return *this;
}

void VertexBuffer::SetData(const void* data, size_t size, size_t offset) {
    glNamedBufferSubData(m_ID, offset, size, data);
}

// --- IndexBuffer (OpenGL 4.5 DSA) ---
IndexBuffer::IndexBuffer(const uint32_t* indices, uint32_t count)
    : m_Count(count) {
    glCreateBuffers(1, &m_ID);
    glNamedBufferData(m_ID, count * sizeof(uint32_t), indices, GL_STATIC_DRAW);
}

IndexBuffer::~IndexBuffer() {
    if (m_ID != 0) {
        glDeleteBuffers(1, &m_ID);
    }
}

IndexBuffer::IndexBuffer(IndexBuffer&& other) noexcept
    : m_ID(other.m_ID), m_Count(other.m_Count) {
    other.m_ID = 0;
    other.m_Count = 0;
}

IndexBuffer& IndexBuffer::operator=(IndexBuffer&& other) noexcept {
    if (this != &other) {
        if (m_ID != 0) glDeleteBuffers(1, &m_ID);
        m_ID = other.m_ID;
        m_Count = other.m_Count;
        other.m_ID = 0;
        other.m_Count = 0;
    }
    return *this;
}

// --- UniformBuffer (OpenGL 4.5 DSA) ---
UniformBuffer::UniformBuffer(size_t size, uint32_t binding)
    : m_Size(size), m_Binding(binding) {
    glCreateBuffers(1, &m_ID);
    glNamedBufferData(m_ID, size, nullptr, GL_DYNAMIC_DRAW);
    glBindBufferBase(GL_UNIFORM_BUFFER, m_Binding, m_ID);
}

UniformBuffer::~UniformBuffer() {
    if (m_ID != 0) {
        glDeleteBuffers(1, &m_ID);
    }
}

UniformBuffer::UniformBuffer(UniformBuffer&& other) noexcept
    : m_ID(other.m_ID), m_Size(other.m_Size), m_Binding(other.m_Binding) {
    other.m_ID = 0;
    other.m_Size = 0;
}

UniformBuffer& UniformBuffer::operator=(UniformBuffer&& other) noexcept {
    if (this != &other) {
        if (m_ID != 0) glDeleteBuffers(1, &m_ID);
        m_ID = other.m_ID;
        m_Size = other.m_Size;
        m_Binding = other.m_Binding;
        other.m_ID = 0;
        other.m_Size = 0;
    }
    return *this;
}

void UniformBuffer::SetData(const void* data, size_t size, size_t offset) {
    glNamedBufferSubData(m_ID, offset, size, data);
}

void UniformBuffer::BindBase(uint32_t binding) {
    m_Binding = binding;
    glBindBufferBase(GL_UNIFORM_BUFFER, m_Binding, m_ID);
}

} // namespace Bazuko
