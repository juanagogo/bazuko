#include "render/Gpu.h"

#include <algorithm>
#include <stdexcept>
#include <utility>

namespace bazuko {

namespace {

GLuint compile(GLenum type, const std::string& src) {
    const GLuint s = glCreateShader(type);
    const char* p = src.c_str();
    glShaderSource(s, 1, &p, nullptr);
    glCompileShader(s);
    GLint ok = 0;
    glGetShaderiv(s, GL_COMPILE_STATUS, &ok);
    if (!ok) {
        GLint len = 0;
        glGetShaderiv(s, GL_INFO_LOG_LENGTH, &len);
        std::vector<char> log(static_cast<size_t>(len) + 1);
        glGetShaderInfoLog(s, len, nullptr, log.data());
        glDeleteShader(s);
        throw std::runtime_error(std::string(type == GL_VERTEX_SHADER ? "vertex shader: " : "fragment shader: ") + log.data());
    }
    return s;
}

constexpr GLenum kTextureMaxAnisotropy = 0x84FE;      // GL_TEXTURE_MAX_ANISOTROPY (core en 4.6)
constexpr GLenum kMaxTextureMaxAnisotropy = 0x84FF;

}  // namespace

Shader::Shader(const std::string& vs, const std::string& fs) {
    const GLuint v = compile(GL_VERTEX_SHADER, vs), f = compile(GL_FRAGMENT_SHADER, fs);
    program_ = glCreateProgram();
    glAttachShader(program_, v);
    glAttachShader(program_, f);
    glLinkProgram(program_);
    glDeleteShader(v);
    glDeleteShader(f);
    GLint ok = 0;
    glGetProgramiv(program_, GL_LINK_STATUS, &ok);
    if (!ok) {
        GLint len = 0;
        glGetProgramiv(program_, GL_INFO_LOG_LENGTH, &len);
        std::vector<char> log(static_cast<size_t>(len) + 1);
        glGetProgramInfoLog(program_, len, nullptr, log.data());
        throw std::runtime_error(std::string("link: ") + log.data());
    }
}

Shader::~Shader() {
    if (program_) glDeleteProgram(program_);
}

GLint Shader::uniform(const char* name) const { return glGetUniformLocation(program_, name); }

GpuMesh::GpuMesh(const float* vertices, size_t floatCount, const unsigned* indices, size_t indexCount)
    : indexCount_(indexCount) {
    glGenVertexArrays(1, &vao_);
    glGenBuffers(1, &vbo_);
    glGenBuffers(1, &ibo_);
    glBindVertexArray(vao_);
    glBindBuffer(GL_ARRAY_BUFFER, vbo_);
    glBufferData(GL_ARRAY_BUFFER, static_cast<GLsizeiptr>(floatCount * sizeof(float)), vertices, GL_STATIC_DRAW);
    glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, ibo_);
    glBufferData(GL_ELEMENT_ARRAY_BUFFER, static_cast<GLsizeiptr>(indexCount * sizeof(unsigned)), indices, GL_STATIC_DRAW);
    const GLsizei stride = 12 * sizeof(float);
    // posición, normal, color, uv, id de casa
    const struct { GLint size; size_t offset; } attrs[5] = {{3, 0}, {3, 3}, {3, 6}, {2, 9}, {1, 11}};
    for (GLuint i = 0; i < 5; ++i) {
        glEnableVertexAttribArray(i);
        glVertexAttribPointer(i, attrs[i].size, GL_FLOAT, GL_FALSE, stride, reinterpret_cast<void*>(attrs[i].offset * sizeof(float)));
    }
    glBindVertexArray(0);
}

GpuMesh::GpuMesh(GpuMesh&& o) noexcept
    : vao_(std::exchange(o.vao_, 0)), vbo_(std::exchange(o.vbo_, 0)), ibo_(std::exchange(o.ibo_, 0)),
      indexCount_(o.indexCount_) {}

GpuMesh::~GpuMesh() {
    if (ibo_) glDeleteBuffers(1, &ibo_);
    if (vbo_) glDeleteBuffers(1, &vbo_);
    if (vao_) glDeleteVertexArrays(1, &vao_);
}

void GpuMesh::draw() const {
    glBindVertexArray(vao_);
    glDrawElements(GL_TRIANGLES, static_cast<GLsizei>(indexCount_), GL_UNSIGNED_INT, nullptr);
}

GpuSkinnedMesh::GpuSkinnedMesh(const std::vector<float>& vertices, const std::vector<std::uint32_t>& indices) : indexCount_(indices.size()) {
    glGenVertexArrays(1, &vao_);
    glGenBuffers(1, &vbo_);
    glGenBuffers(1, &ibo_);
    glBindVertexArray(vao_);
    glBindBuffer(GL_ARRAY_BUFFER, vbo_);
    glBufferData(GL_ARRAY_BUFFER, static_cast<GLsizeiptr>(vertices.size() * sizeof(float)), vertices.data(), GL_STATIC_DRAW);
    glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, ibo_);
    glBufferData(GL_ELEMENT_ARRAY_BUFFER, static_cast<GLsizeiptr>(indices.size() * sizeof(std::uint32_t)), indices.data(), GL_STATIC_DRAW);
    const GLsizei stride = 16 * sizeof(float);
    // posición, normal, uv, joints, pesos
    const struct { GLint size; size_t offset; } attrs[5] = {{3, 0}, {3, 3}, {2, 6}, {4, 8}, {4, 12}};
    for (GLuint i = 0; i < 5; ++i) {
        glEnableVertexAttribArray(i);
        glVertexAttribPointer(i, attrs[i].size, GL_FLOAT, GL_FALSE, stride, reinterpret_cast<void*>(attrs[i].offset * sizeof(float)));
    }
    glBindVertexArray(0);
}

GpuSkinnedMesh::GpuSkinnedMesh(GpuSkinnedMesh&& o) noexcept
    : vao_(std::exchange(o.vao_, 0)), vbo_(std::exchange(o.vbo_, 0)), ibo_(std::exchange(o.ibo_, 0)), indexCount_(o.indexCount_) {}

GpuSkinnedMesh::~GpuSkinnedMesh() {
    if (ibo_) glDeleteBuffers(1, &ibo_);
    if (vbo_) glDeleteBuffers(1, &vbo_);
    if (vao_) glDeleteVertexArrays(1, &vao_);
}

void GpuSkinnedMesh::draw() const {
    glBindVertexArray(vao_);
    glDrawElements(GL_TRIANGLES, static_cast<GLsizei>(indexCount_), GL_UNSIGNED_INT, nullptr);
}

GpuTexture::GpuTexture(const Image& img) {
    // La fila 0 de la imagen es el borde superior; GL espera v = 0 abajo, así que se invierten las filas.
    std::vector<std::uint8_t> flipped(img.rgba.size());
    const size_t row = static_cast<size_t>(img.width) * 4;
    for (int y = 0; y < img.height; ++y) std::copy_n(img.rgba.data() + (img.height - 1 - y) * row, row, flipped.data() + y * row);

    glGenTextures(1, &id_);
    glBindTexture(GL_TEXTURE_2D, id_);
    glPixelStorei(GL_UNPACK_ALIGNMENT, 1);
    glTexImage2D(GL_TEXTURE_2D, 0, img.srgb ? GL_SRGB8_ALPHA8 : GL_RGBA8, img.width, img.height, 0, GL_RGBA, GL_UNSIGNED_BYTE,
                 flipped.data());
    glGenerateMipmap(GL_TEXTURE_2D);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR_MIPMAP_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
    const GLint wrap = img.repeat ? GL_REPEAT : GL_CLAMP_TO_EDGE;
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, wrap);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, wrap);
    GLfloat maxAniso = 0;
    glGetFloatv(kMaxTextureMaxAnisotropy, &maxAniso);
    if (glGetError() == GL_NO_ERROR && maxAniso > 1) glTexParameterf(GL_TEXTURE_2D, kTextureMaxAnisotropy, std::min(8.0f, maxAniso));
}

GpuTexture::GpuTexture(GpuTexture&& o) noexcept : id_(std::exchange(o.id_, 0)) {}

GpuTexture::~GpuTexture() {
    if (id_) glDeleteTextures(1, &id_);
}

void GpuTexture::bind(GLuint unit) const {
    glActiveTexture(GL_TEXTURE0 + unit);
    glBindTexture(GL_TEXTURE_2D, id_);
}

GpuUintBuffer::~GpuUintBuffer() {
    if (id_) glDeleteBuffers(1, &id_);
}

void GpuUintBuffer::upload(const std::vector<std::uint8_t>& values) {
    std::vector<GLuint> data(values.begin(), values.end());
    if (!id_) glGenBuffers(1, &id_);
    glBindBuffer(GL_SHADER_STORAGE_BUFFER, id_);
    if (data.size() > capacity_) {
        glBufferData(GL_SHADER_STORAGE_BUFFER, static_cast<GLsizeiptr>(data.size() * sizeof(GLuint)), data.data(), GL_DYNAMIC_DRAW);
        capacity_ = data.size();
    } else {
        glBufferSubData(GL_SHADER_STORAGE_BUFFER, 0, static_cast<GLsizeiptr>(data.size() * sizeof(GLuint)), data.data());
    }
}

void GpuUintBuffer::bind(GLuint binding) const { glBindBufferBase(GL_SHADER_STORAGE_BUFFER, binding, id_); }

DepthTarget::DepthTarget(int size) : size_(size) {
    glGenTextures(1, &tex_);
    glBindTexture(GL_TEXTURE_2D, tex_);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_DEPTH_COMPONENT24, size, size, 0, GL_DEPTH_COMPONENT, GL_FLOAT, nullptr);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_BORDER);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_BORDER);
    const GLfloat border[4] = {1, 1, 1, 1};  // fuera del mapa: sin sombra
    glTexParameterfv(GL_TEXTURE_2D, GL_TEXTURE_BORDER_COLOR, border);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_COMPARE_MODE, GL_COMPARE_REF_TO_TEXTURE);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_COMPARE_FUNC, GL_LEQUAL);
    glGenFramebuffers(1, &fbo_);
    glBindFramebuffer(GL_FRAMEBUFFER, fbo_);
    glFramebufferTexture2D(GL_FRAMEBUFFER, GL_DEPTH_ATTACHMENT, GL_TEXTURE_2D, tex_, 0);
    glDrawBuffer(GL_NONE);
    glReadBuffer(GL_NONE);
    if (glCheckFramebufferStatus(GL_FRAMEBUFFER) != GL_FRAMEBUFFER_COMPLETE) throw std::runtime_error("framebuffer de sombras incompleto");
    glBindFramebuffer(GL_FRAMEBUFFER, 0);
}

DepthTarget::~DepthTarget() {
    if (fbo_) glDeleteFramebuffers(1, &fbo_);
    if (tex_) glDeleteTextures(1, &tex_);
}

void DepthTarget::bind() const {
    glBindFramebuffer(GL_FRAMEBUFFER, fbo_);
    glViewport(0, 0, size_, size_);
}

void DepthTarget::bindTexture(GLuint unit) const {
    glActiveTexture(GL_TEXTURE0 + unit);
    glBindTexture(GL_TEXTURE_2D, tex_);
}

ColorTarget::ColorTarget(int width, int height, int samples, bool asTexture) : w_(width), h_(height) {
    glGenFramebuffers(1, &fbo_);
    glBindFramebuffer(GL_FRAMEBUFFER, fbo_);
    if (asTexture && samples <= 1) {
        glGenTextures(1, &colorTex_);
        glBindTexture(GL_TEXTURE_2D, colorTex_);
        glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, width, height, 0, GL_RGBA, GL_UNSIGNED_BYTE, nullptr);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
        glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, colorTex_, 0);
    } else {
        glGenRenderbuffers(1, &color_);
        glBindRenderbuffer(GL_RENDERBUFFER, color_);
        if (samples > 1) glRenderbufferStorageMultisample(GL_RENDERBUFFER, samples, GL_RGBA8, width, height);
        else glRenderbufferStorage(GL_RENDERBUFFER, GL_RGBA8, width, height);
        glFramebufferRenderbuffer(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_RENDERBUFFER, color_);
    }
    glGenRenderbuffers(1, &depth_);
    glBindRenderbuffer(GL_RENDERBUFFER, depth_);
    if (samples > 1) glRenderbufferStorageMultisample(GL_RENDERBUFFER, samples, GL_DEPTH_COMPONENT24, width, height);
    else glRenderbufferStorage(GL_RENDERBUFFER, GL_DEPTH_COMPONENT24, width, height);
    glFramebufferRenderbuffer(GL_FRAMEBUFFER, GL_DEPTH_ATTACHMENT, GL_RENDERBUFFER, depth_);
    if (glCheckFramebufferStatus(GL_FRAMEBUFFER) != GL_FRAMEBUFFER_COMPLETE) throw std::runtime_error("framebuffer de color incompleto");
    glBindFramebuffer(GL_FRAMEBUFFER, 0);
}

ColorTarget::~ColorTarget() {
    if (fbo_) glDeleteFramebuffers(1, &fbo_);
    if (color_) glDeleteRenderbuffers(1, &color_);
    if (colorTex_) glDeleteTextures(1, &colorTex_);
    if (depth_) glDeleteRenderbuffers(1, &depth_);
}

}  // namespace bazuko
