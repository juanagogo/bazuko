#pragma once
#include <memory>
#include <vector>
#include <glad/gl.h>
#include "Buffer.hpp"

namespace Bazuko {

struct VertexAttribute {
    GLuint location;
    GLint size;
    GLenum type;
    GLboolean normalized;
    GLuint relativeOffset;
};

class VertexArray {
public:
    VertexArray();
    ~VertexArray();

    VertexArray(const VertexArray&) = delete;
    VertexArray& operator=(const VertexArray&) = delete;
    VertexArray(VertexArray&& other) noexcept;
    VertexArray& operator=(VertexArray&& other) noexcept;

    void Bind() const;
    void Unbind() const;

    void SetVertexBuffer(const VertexBuffer& vbo, GLuint bindingIndex, GLuint stride, GLintptr offset = 0);
    void SetIndexBuffer(const IndexBuffer& ebo);
    void AddAttribute(GLuint bindingIndex, const VertexAttribute& attr);

    GLuint GetID() const { return m_ID; }

private:
    GLuint m_ID = 0;
};

} // namespace Bazuko
