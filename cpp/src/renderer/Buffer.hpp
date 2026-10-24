#pragma once
#include <cstdint>
#include <cstddef>
#include <glad/gl.h>

namespace Bazuko {

class VertexBuffer {
public:
    VertexBuffer(const void* data, size_t size, GLenum usage = GL_STATIC_DRAW);
    ~VertexBuffer();

    VertexBuffer(const VertexBuffer&) = delete;
    VertexBuffer& operator=(const VertexBuffer&) = delete;
    VertexBuffer(VertexBuffer&& other) noexcept;
    VertexBuffer& operator=(VertexBuffer&& other) noexcept;

    void SetData(const void* data, size_t size, size_t offset = 0);
    GLuint GetID() const { return m_ID; }
    size_t GetSize() const { return m_Size; }

private:
    GLuint m_ID = 0;
    size_t m_Size = 0;
};

class IndexBuffer {
public:
    IndexBuffer(const uint32_t* indices, uint32_t count);
    ~IndexBuffer();

    IndexBuffer(const IndexBuffer&) = delete;
    IndexBuffer& operator=(const IndexBuffer&) = delete;
    IndexBuffer(IndexBuffer&& other) noexcept;
    IndexBuffer& operator=(IndexBuffer&& other) noexcept;

    GLuint GetID() const { return m_ID; }
    uint32_t GetCount() const { return m_Count; }

private:
    GLuint m_ID = 0;
    uint32_t m_Count = 0;
};

class UniformBuffer {
public:
    UniformBuffer(size_t size, uint32_t binding);
    ~UniformBuffer();

    UniformBuffer(const UniformBuffer&) = delete;
    UniformBuffer& operator=(const UniformBuffer&) = delete;
    UniformBuffer(UniformBuffer&& other) noexcept;
    UniformBuffer& operator=(UniformBuffer&& other) noexcept;

    void SetData(const void* data, size_t size, size_t offset = 0);
    void BindBase(uint32_t binding);

    GLuint GetID() const { return m_ID; }

private:
    GLuint m_ID = 0;
    size_t m_Size = 0;
    uint32_t m_Binding = 0;
};

} // namespace Bazuko
