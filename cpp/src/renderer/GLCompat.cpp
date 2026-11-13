#include "GLCompat.hpp"
#include "../core/Log.hpp"

#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <unordered_map>

namespace Bazuko::GLCompat {

namespace {

bool g_Legacy = false;

// ---------- Utilidades: enlazar un objeto para editarlo y devolver el enlace que habia ----------

std::unordered_map<GLuint, GLenum> g_TextureTargets;   // las texturas de glCreateTextures; las de glGenTextures se dan por 2D

GLenum TargetOf(GLuint texture) {
    const auto it = g_TextureTargets.find(texture);
    return it == g_TextureTargets.end() ? GL_TEXTURE_2D : it->second;
}

GLenum BindingQuery(GLenum target) {
    switch (target) {
        case GL_TEXTURE_CUBE_MAP: return GL_TEXTURE_BINDING_CUBE_MAP;
        case GL_TEXTURE_2D_ARRAY: return GL_TEXTURE_BINDING_2D_ARRAY;
        case GL_TEXTURE_3D: return GL_TEXTURE_BINDING_3D;
        case GL_TEXTURE_BUFFER: return GL_TEXTURE_BINDING_BUFFER;
        case GL_TEXTURE_2D_MULTISAMPLE: return GL_TEXTURE_BINDING_2D_MULTISAMPLE;
        default: return GL_TEXTURE_BINDING_2D;
    }
}

struct TextureScope {
    GLenum target;
    GLint previous = 0;
    explicit TextureScope(GLuint texture) : target(TargetOf(texture)) {
        glGetIntegerv(BindingQuery(target), &previous);
        glBindTexture(target, texture);
    }
    ~TextureScope() { glBindTexture(target, static_cast<GLuint>(previous)); }
};

struct FramebufferScope {
    GLenum target, query;
    GLint previous = 0;
    FramebufferScope(GLenum bindTarget, GLuint framebuffer)
        : target(bindTarget), query(bindTarget == GL_READ_FRAMEBUFFER ? GL_READ_FRAMEBUFFER_BINDING : GL_DRAW_FRAMEBUFFER_BINDING) {
        glGetIntegerv(query, &previous);
        glBindFramebuffer(target, framebuffer);
    }
    ~FramebufferScope() { glBindFramebuffer(target, static_cast<GLuint>(previous)); }
};

struct VertexArrayScope {
    GLint previousVao = 0, previousArray = 0;
    explicit VertexArrayScope(GLuint vao) {
        glGetIntegerv(GL_VERTEX_ARRAY_BINDING, &previousVao);
        glGetIntegerv(GL_ARRAY_BUFFER_BINDING, &previousArray);
        glBindVertexArray(vao);
    }
    ~VertexArrayScope() {
        glBindVertexArray(static_cast<GLuint>(previousVao));
        glBindBuffer(GL_ARRAY_BUFFER, static_cast<GLuint>(previousArray));
    }
};

// Formato y tipo de subida que acepta glTexImage2D para cada formato interno (solo reserva memoria: los datos van en null).
void UploadFormat(GLenum internalFormat, GLenum& format, GLenum& type) {
    switch (internalFormat) {
        case GL_DEPTH_COMPONENT16: case GL_DEPTH_COMPONENT24: case GL_DEPTH_COMPONENT32:
            format = GL_DEPTH_COMPONENT; type = GL_UNSIGNED_INT; return;
        case GL_DEPTH_COMPONENT32F: format = GL_DEPTH_COMPONENT; type = GL_FLOAT; return;
        case GL_DEPTH24_STENCIL8: format = GL_DEPTH_STENCIL; type = GL_UNSIGNED_INT_24_8; return;
        case GL_R8: format = GL_RED; type = GL_UNSIGNED_BYTE; return;
        case GL_RG8: format = GL_RG; type = GL_UNSIGNED_BYTE; return;
        case GL_RGB8: format = GL_RGB; type = GL_UNSIGNED_BYTE; return;
        case GL_R16F: case GL_R32F: format = GL_RED; type = GL_FLOAT; return;
        case GL_RG16F: case GL_RG32F: format = GL_RG; type = GL_FLOAT; return;
        case GL_R11F_G11F_B10F: case GL_RGB16F: case GL_RGB32F: format = GL_RGB; type = GL_FLOAT; return;
        case GL_RGBA16F: case GL_RGBA32F: format = GL_RGBA; type = GL_FLOAT; return;
        case GL_R32UI: format = GL_RED_INTEGER; type = GL_UNSIGNED_INT; return;
        case GL_RG32UI: format = GL_RG_INTEGER; type = GL_UNSIGNED_INT; return;
        default: format = GL_RGBA; type = GL_UNSIGNED_BYTE; return;
    }
}

int Components(GLenum format) {
    switch (format) {
        case GL_RED: case GL_RED_INTEGER: case GL_DEPTH_COMPONENT: return 1;
        case GL_RG: case GL_RG_INTEGER: return 2;
        case GL_RGB: case GL_BGR: return 3;
        default: return 4;
    }
}

// ---------- Buffers ----------

void GLAPIENTRY CreateBuffers(GLsizei n, GLuint* buffers) {
    glGenBuffers(n, buffers);
    // GL_COPY_WRITE_BUFFER no lo usa nadie mas: enlazar alli crea el objeto sin tocar el VAO ni el buffer de vertices actual
    for (GLsizei i = 0; i < n; ++i) glBindBuffer(GL_COPY_WRITE_BUFFER, buffers[i]);
    glBindBuffer(GL_COPY_WRITE_BUFFER, 0);
}

void GLAPIENTRY NamedBufferData(GLuint buffer, GLsizeiptr size, const void* data, GLenum usage) {
    glBindBuffer(GL_COPY_WRITE_BUFFER, buffer);
    glBufferData(GL_COPY_WRITE_BUFFER, size, data, usage);
    glBindBuffer(GL_COPY_WRITE_BUFFER, 0);
}

void GLAPIENTRY NamedBufferSubData(GLuint buffer, GLintptr offset, GLsizeiptr size, const void* data) {
    glBindBuffer(GL_COPY_WRITE_BUFFER, buffer);
    glBufferSubData(GL_COPY_WRITE_BUFFER, offset, size, data);
    glBindBuffer(GL_COPY_WRITE_BUFFER, 0);
}

// ---------- Vertex arrays: 4.1 no separa formato y buffer, asi que se guardan ambos y se arma glVertexAttribPointer cuando estan los dos ----------

struct AttribState { bool formatSet = false; GLint size = 4; GLenum type = GL_FLOAT; GLboolean normalized = GL_FALSE; GLuint relativeOffset = 0; GLuint binding = 0; };
struct BindingState { GLuint buffer = 0; GLintptr offset = 0; GLsizei stride = 0; };
struct VaoState { AttribState attribs[16]; BindingState bindings[16]; };
std::unordered_map<GLuint, VaoState> g_Vaos;

// Con el VAO ya enlazado: arma el puntero del atributo si ya se conocen su formato y su buffer.
void ApplyAttrib(VaoState& state, GLuint index) {
    const AttribState& a = state.attribs[index];
    if (!a.formatSet || a.binding >= 16) return;
    const BindingState& b = state.bindings[a.binding];
    if (b.buffer == 0) return;
    glBindBuffer(GL_ARRAY_BUFFER, b.buffer);
    glVertexAttribPointer(index, a.size, a.type, a.normalized, b.stride,
                          reinterpret_cast<const void*>(static_cast<uintptr_t>(b.offset + a.relativeOffset)));
}

void GLAPIENTRY CreateVertexArrays(GLsizei n, GLuint* arrays) {
    glGenVertexArrays(n, arrays);
    for (GLsizei i = 0; i < n; ++i) g_Vaos[arrays[i]] = VaoState{};
}

void GLAPIENTRY EnableVertexArrayAttrib(GLuint vao, GLuint index) {
    VertexArrayScope scope(vao);
    glEnableVertexAttribArray(index);
}

void GLAPIENTRY VertexArrayAttribFormat(GLuint vao, GLuint index, GLint size, GLenum type, GLboolean normalized, GLuint relativeOffset) {
    if (index >= 16) return;
    VaoState& state = g_Vaos[vao];
    AttribState& a = state.attribs[index];
    a.formatSet = true; a.size = size; a.type = type; a.normalized = normalized; a.relativeOffset = relativeOffset;
    VertexArrayScope scope(vao);
    ApplyAttrib(state, index);
}

void GLAPIENTRY VertexArrayAttribBinding(GLuint vao, GLuint index, GLuint binding) {
    if (index >= 16) return;
    VaoState& state = g_Vaos[vao];
    state.attribs[index].binding = binding;
    VertexArrayScope scope(vao);
    ApplyAttrib(state, index);
}

void GLAPIENTRY VertexArrayVertexBuffer(GLuint vao, GLuint binding, GLuint buffer, GLintptr offset, GLsizei stride) {
    if (binding >= 16) return;
    VaoState& state = g_Vaos[vao];
    state.bindings[binding] = BindingState{buffer, offset, stride};
    VertexArrayScope scope(vao);
    for (GLuint index = 0; index < 16; ++index)
        if (state.attribs[index].binding == binding) ApplyAttrib(state, index);
}

void GLAPIENTRY VertexArrayElementBuffer(GLuint vao, GLuint buffer) {
    VertexArrayScope scope(vao);
    glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, buffer);   // el enlace de indices es parte del VAO
}

// ---------- Texturas ----------

void GLAPIENTRY CreateTextures(GLenum target, GLsizei n, GLuint* textures) {
    glGenTextures(n, textures);
    for (GLsizei i = 0; i < n; ++i) {
        g_TextureTargets[textures[i]] = target;
        TextureScope scope(textures[i]);   // el primer enlace fija el tipo de la textura
    }
}

void GLAPIENTRY TextureStorage2D(GLuint texture, GLsizei levels, GLenum internalFormat, GLsizei width, GLsizei height) {
    TextureScope scope(texture);
    GLenum format = GL_RGBA, type = GL_UNSIGNED_BYTE;
    UploadFormat(internalFormat, format, type);
    const bool cube = scope.target == GL_TEXTURE_CUBE_MAP;
    for (GLsizei level = 0; level < levels; ++level) {
        const GLsizei w = width > 1 ? width >> level : 1, h = height > 1 ? height >> level : 1;
        if (cube) {
            for (GLenum face = 0; face < 6; ++face)
                glTexImage2D(GL_TEXTURE_CUBE_MAP_POSITIVE_X + face, level, static_cast<GLint>(internalFormat), w > 0 ? w : 1, h > 0 ? h : 1, 0, format, type, nullptr);
        } else {
            glTexImage2D(scope.target, level, static_cast<GLint>(internalFormat), w > 0 ? w : 1, h > 0 ? h : 1, 0, format, type, nullptr);
        }
    }
    // Como en el almacenamiento inmutable: la textura queda completa con exactamente esos niveles
    glTexParameteri(scope.target, GL_TEXTURE_BASE_LEVEL, 0);
    glTexParameteri(scope.target, GL_TEXTURE_MAX_LEVEL, levels - 1);
}

void GLAPIENTRY TextureSubImage2D(GLuint texture, GLint level, GLint x, GLint y, GLsizei width, GLsizei height, GLenum format, GLenum type, const void* pixels) {
    TextureScope scope(texture);
    glTexSubImage2D(scope.target, level, x, y, width, height, format, type, pixels);
}

void GLAPIENTRY GenerateTextureMipmap(GLuint texture) {
    TextureScope scope(texture);
    glGenerateMipmap(scope.target);
}

void GLAPIENTRY TextureParameteri(GLuint texture, GLenum name, GLint value) {
    TextureScope scope(texture);
    glTexParameteri(scope.target, name, value);
}

void GLAPIENTRY TextureParameterf(GLuint texture, GLenum name, GLfloat value) {
    TextureScope scope(texture);
    glTexParameterf(scope.target, name, value);
}

void GLAPIENTRY TextureParameterfv(GLuint texture, GLenum name, const GLfloat* value) {
    TextureScope scope(texture);
    glTexParameterfv(scope.target, name, value);
}

void GLAPIENTRY BindTextureUnit(GLuint unit, GLuint texture) {
    glActiveTexture(GL_TEXTURE0 + unit);
    glBindTexture(TargetOf(texture), texture);
}

GLuint g_ScratchFramebuffer = 0;

// glClearTexImage (4.4): se pega la textura a un framebuffer propio y se limpia, sin tijera ni mascara de color, como la llamada original.
void GLAPIENTRY ClearTexImage(GLuint texture, GLint level, GLenum format, GLenum type, const void* data) {
    float value[4] = {0.0f, 0.0f, 0.0f, 0.0f};
    if (data) {
        value[3] = 1.0f;
        const int count = Components(format);
        for (int i = 0; i < count; ++i) {
            if (type == GL_FLOAT) value[i] = static_cast<const float*>(data)[i];
            else if (type == GL_UNSIGNED_BYTE) value[i] = static_cast<const unsigned char*>(data)[i] / 255.0f;
        }
    }
    if (!g_ScratchFramebuffer) glGenFramebuffers(1, &g_ScratchFramebuffer);
    FramebufferScope scope(GL_DRAW_FRAMEBUFFER, g_ScratchFramebuffer);
    glFramebufferTexture(GL_DRAW_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, texture, level);
    const GLboolean scissor = glIsEnabled(GL_SCISSOR_TEST);
    GLboolean mask[4] = {GL_TRUE, GL_TRUE, GL_TRUE, GL_TRUE};
    glGetBooleanv(GL_COLOR_WRITEMASK, mask);
    glDisable(GL_SCISSOR_TEST);
    glColorMask(GL_TRUE, GL_TRUE, GL_TRUE, GL_TRUE);
    glClearBufferfv(GL_COLOR, 0, value);
    glColorMask(mask[0], mask[1], mask[2], mask[3]);
    if (scissor) glEnable(GL_SCISSOR_TEST);
    glFramebufferTexture(GL_DRAW_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, 0, 0);
}

// ---------- Framebuffers y renderbuffers ----------

void GLAPIENTRY CreateFramebuffers(GLsizei n, GLuint* framebuffers) { glGenFramebuffers(n, framebuffers); }

void GLAPIENTRY NamedFramebufferTexture(GLuint framebuffer, GLenum attachment, GLuint texture, GLint level) {
    FramebufferScope scope(GL_DRAW_FRAMEBUFFER, framebuffer);
    glFramebufferTexture(GL_DRAW_FRAMEBUFFER, attachment, texture, level);
}

void GLAPIENTRY NamedFramebufferRenderbuffer(GLuint framebuffer, GLenum attachment, GLenum target, GLuint renderbuffer) {
    FramebufferScope scope(GL_DRAW_FRAMEBUFFER, framebuffer);
    glFramebufferRenderbuffer(GL_DRAW_FRAMEBUFFER, attachment, target, renderbuffer);
}

void GLAPIENTRY NamedFramebufferDrawBuffer(GLuint framebuffer, GLenum buffer) {
    FramebufferScope scope(GL_DRAW_FRAMEBUFFER, framebuffer);
    glDrawBuffer(buffer);
}

void GLAPIENTRY NamedFramebufferDrawBuffers(GLuint framebuffer, GLsizei n, const GLenum* buffers) {
    FramebufferScope scope(GL_DRAW_FRAMEBUFFER, framebuffer);
    glDrawBuffers(n, buffers);
}

void GLAPIENTRY NamedFramebufferReadBuffer(GLuint framebuffer, GLenum source) {
    FramebufferScope scope(GL_READ_FRAMEBUFFER, framebuffer);
    glReadBuffer(source);
}

void GLAPIENTRY BlitNamedFramebuffer(GLuint readFramebuffer, GLuint drawFramebuffer, GLint srcX0, GLint srcY0, GLint srcX1, GLint srcY1,
                                     GLint dstX0, GLint dstY0, GLint dstX1, GLint dstY1, GLbitfield mask, GLenum filter) {
    FramebufferScope read(GL_READ_FRAMEBUFFER, readFramebuffer);
    FramebufferScope draw(GL_DRAW_FRAMEBUFFER, drawFramebuffer);
    glBlitFramebuffer(srcX0, srcY0, srcX1, srcY1, dstX0, dstY0, dstX1, dstY1, mask, filter);
}

void GLAPIENTRY ClearNamedFramebufferfv(GLuint framebuffer, GLenum buffer, GLint drawBuffer, const GLfloat* value) {
    FramebufferScope scope(GL_DRAW_FRAMEBUFFER, framebuffer);
    glClearBufferfv(buffer, drawBuffer, value);
}

void GLAPIENTRY CreateRenderbuffers(GLsizei n, GLuint* renderbuffers) { glGenRenderbuffers(n, renderbuffers); }

void GLAPIENTRY NamedRenderbufferStorageMultisample(GLuint renderbuffer, GLsizei samples, GLenum internalFormat, GLsizei width, GLsizei height) {
    GLint previous = 0;
    glGetIntegerv(GL_RENDERBUFFER_BINDING, &previous);
    glBindRenderbuffer(GL_RENDERBUFFER, renderbuffer);
    glRenderbufferStorageMultisample(GL_RENDERBUFFER, samples, internalFormat, width, height);
    glBindRenderbuffer(GL_RENDERBUFFER, static_cast<GLuint>(previous));
}

} // namespace

void Install() {
    const char* forced = std::getenv("BAZUKO_GL41");
    g_Legacy = !GLAD_GL_VERSION_4_5 || (forced && std::strcmp(forced, "0") != 0);
    if (!g_Legacy) return;

    glad_glCreateBuffers = &CreateBuffers;
    glad_glNamedBufferData = &NamedBufferData;
    glad_glNamedBufferSubData = &NamedBufferSubData;

    glad_glCreateVertexArrays = &CreateVertexArrays;
    glad_glEnableVertexArrayAttrib = &EnableVertexArrayAttrib;
    glad_glVertexArrayAttribFormat = &VertexArrayAttribFormat;
    glad_glVertexArrayAttribBinding = &VertexArrayAttribBinding;
    glad_glVertexArrayVertexBuffer = &VertexArrayVertexBuffer;
    glad_glVertexArrayElementBuffer = &VertexArrayElementBuffer;

    glad_glCreateTextures = &CreateTextures;
    glad_glTextureStorage2D = &TextureStorage2D;
    glad_glTextureSubImage2D = &TextureSubImage2D;
    glad_glGenerateTextureMipmap = &GenerateTextureMipmap;
    glad_glTextureParameteri = &TextureParameteri;
    glad_glTextureParameterf = &TextureParameterf;
    glad_glTextureParameterfv = &TextureParameterfv;
    glad_glBindTextureUnit = &BindTextureUnit;
    glad_glClearTexImage = &ClearTexImage;

    glad_glCreateFramebuffers = &CreateFramebuffers;
    glad_glNamedFramebufferTexture = &NamedFramebufferTexture;
    glad_glNamedFramebufferRenderbuffer = &NamedFramebufferRenderbuffer;
    glad_glNamedFramebufferDrawBuffer = &NamedFramebufferDrawBuffer;
    glad_glNamedFramebufferDrawBuffers = &NamedFramebufferDrawBuffers;
    glad_glNamedFramebufferReadBuffer = &NamedFramebufferReadBuffer;
    glad_glBlitNamedFramebuffer = &BlitNamedFramebuffer;
    glad_glClearNamedFramebufferfv = &ClearNamedFramebufferfv;
    glad_glCreateRenderbuffers = &CreateRenderbuffers;
    glad_glNamedRenderbufferStorageMultisample = &NamedRenderbufferStorageMultisample;

    LogInfo("OpenGL: modo 4.1 (sin DSA ni SSBO){}", GLAD_GL_VERSION_4_5 ? ", forzado con BAZUKO_GL41" : "");
}

bool Legacy() { return g_Legacy; }

const char* GlslVersion() { return g_Legacy ? "#version 410" : "#version 450"; }

} // namespace Bazuko::GLCompat
