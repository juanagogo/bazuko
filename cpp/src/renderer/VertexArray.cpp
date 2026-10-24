#include "VertexArray.hpp"
#include <utility>

namespace Bazuko {

VertexArray::VertexArray() {
    glCreateVertexArrays(1, &m_ID);
}

VertexArray::~VertexArray() {
    if (m_ID != 0) {
        glDeleteVertexArrays(1, &m_ID);
    }
}

VertexArray::VertexArray(VertexArray&& other) noexcept
    : m_ID(other.m_ID) {
    other.m_ID = 0;
}

VertexArray& VertexArray::operator=(VertexArray&& other) noexcept {
    if (this != &other) {
        if (m_ID != 0) glDeleteVertexArrays(1, &m_ID);
        m_ID = other.m_ID;
        other.m_ID = 0;
    }
    return *this;
}

void VertexArray::Bind() const {
    glBindVertexArray(m_ID);
}

void VertexArray::Unbind() const {
    glBindVertexArray(0);
}

void VertexArray::SetVertexBuffer(const VertexBuffer& vbo, GLuint bindingIndex, GLuint stride, GLintptr offset) {
    glVertexArrayVertexBuffer(m_ID, bindingIndex, vbo.GetID(), offset, stride);
}

void VertexArray::SetIndexBuffer(const IndexBuffer& ebo) {
    glVertexArrayElementBuffer(m_ID, ebo.GetID());
}

void VertexArray::AddAttribute(GLuint bindingIndex, const VertexAttribute& attr) {
    glEnableVertexArrayAttrib(m_ID, attr.location);
    glVertexArrayAttribFormat(m_ID, attr.location, attr.size, attr.type, attr.normalized, attr.relativeOffset);
    glVertexArrayAttribBinding(m_ID, attr.location, bindingIndex);
}

} // namespace Bazuko
