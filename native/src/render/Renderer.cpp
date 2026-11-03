#include "render/Renderer.h"

#include <algorithm>
#include <cmath>

#include <glm/gtc/matrix_transform.hpp>

#include "render/CameraMatrices.h"
#include "render/Frustum.h"

namespace bazuko {

namespace {

const char* kVertexSrc = R"(#version 450 core
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec3 aColor;
layout(location = 3) in vec2 aUv;
layout(location = 4) in float aHouse;

layout(std430, binding = 0) readonly buffer HouseFlags { uint flags[]; };

uniform mat4 uViewProj;
uniform mat4 uView;
uniform mat4 uModel;

out vec3 vNormal;
out vec3 vColor;
out vec2 vUv;
out vec3 vWorld;
out float vDepth;
flat out uint vSeparate;

void main() {
    vec4 world = uModel * vec4(aPos, 1.0);
    vWorld = world.xyz;
    vNormal = mat3(uModel) * aNormal;
    vColor = aColor;
    vUv = aUv;
    vDepth = -(uView * world).z;   // profundidad de vista, como la niebla de three.js
    int house = int(aHouse + 0.5);
    vSeparate = house > 0 ? flags[house] : 0u;  // la casa se dibuja por piezas: se descarta aquí
    gl_Position = uViewProj * world;
}
)";

// Iluminación difusa estilo three.js (hemisférica + direccional + ambiente) con ACES y niebla lineal.
const char* kFragmentSrc = R"(#version 450 core
in vec3 vNormal;
in vec3 vColor;
in vec2 vUv;
in vec3 vWorld;
in float vDepth;
flat in uint vSeparate;

uniform sampler2D uMap;
uniform sampler2D uEmissiveMap;
uniform int uHasMap;
uniform int uHasEmissive;
uniform vec3 uTint;
uniform float uEmissiveScale;
uniform int uUnlit;
uniform int uNoFog;
uniform float uAlpha;
uniform float uAlphaCutoff;
uniform int uToneMap;
uniform sampler2DShadow uShadowMap;
uniform mat4 uShadowMatrix;
uniform int uShadowOn;
uniform float uShadowBias;
uniform float uShadowTexel;
uniform vec3 uLightPos[2];
uniform vec3 uLightColor[2];  // color * intensidad
uniform vec2 uLightRange[2];  // distancia de corte, decaimiento
uniform vec3 uSunDir;        // hacia el sol
uniform vec3 uSunRadiance;   // color * intensidad
uniform vec3 uHemiSky;       // color * intensidad
uniform vec3 uHemiGround;
uniform vec3 uEnvAmbient;    // aproximación del IBL de RoomEnvironment
uniform vec3 uFogColor;      // sRGB, igual que el fondo
uniform float uFogNear;
uniform float uFogFar;
uniform float uExposure;

out vec4 outColor;

const float PI = 3.14159265359;

vec3 rrtAndOdtFit(vec3 v) {
    vec3 a = v * (v + 0.0245786) - 0.000090537;
    vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
    return a / b;
}

vec3 acesFilmic(vec3 color) {
    const mat3 inputMat = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
    const mat3 outputMat = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
    color *= uExposure / 0.6;
    color = inputMat * color;
    color = rrtAndOdtFit(color);
    color = outputMat * color;
    return clamp(color, 0.0, 1.0);
}

vec3 linearToSrgb(vec3 c) {
    return mix(pow(c, vec3(0.41666)) * 1.055 - 0.055, c * 12.92, vec3(lessThanEqual(c, vec3(0.0031308))));
}

// Sombra del sol: PCF 3x3 sobre comparación por hardware (cada muestra ya es bilineal).
float sunShadow(vec3 n) {
    if (uShadowOn == 0) return 1.0;
    vec4 sc = uShadowMatrix * vec4(vWorld + n * 0.05, 1.0);  // desplazamiento por la normal contra el acné
    vec3 p = sc.xyz / sc.w;
    if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0 || p.z > 1.0) return 1.0;
    float sum = 0.0;
    for (int x = -1; x <= 1; ++x)
        for (int y = -1; y <= 1; ++y)
            sum += texture(uShadowMap, vec3(p.xy + vec2(x, y) * uShadowTexel, p.z - uShadowBias));
    return sum / 9.0;
}

// Luz puntual de three.js: 1 / d^decay con corte suave al llegar a la distancia máxima.
vec3 pointLight(int i, vec3 n) {
    vec3 d = uLightPos[i] - vWorld;
    float dist = length(d);
    float falloff = 1.0 / max(pow(dist, uLightRange[i].y), 0.01);
    if (uLightRange[i].x > 0.0) {
        float r = dist / uLightRange[i].x;
        float q = clamp(1.0 - r * r * r * r, 0.0, 1.0);
        falloff *= q * q;
    }
    return uLightColor[i] * falloff * max(dot(n, d / max(dist, 1e-4)), 0.0);
}

void main() {
    if (vSeparate != 0u) discard;
    vec4 base = vec4(vColor * uTint, 1.0);
    if (uHasMap != 0) base *= texture(uMap, vUv);
    if (base.a < uAlphaCutoff) discard;

    vec3 n = normalize(vNormal);
    if (!gl_FrontFacing) n = -n;
    vec3 lit;
    if (uUnlit != 0) {
        lit = base.rgb;
    } else {
        vec3 hemi = mix(uHemiGround, uHemiSky, 0.5 + 0.5 * n.y);
        vec3 sun = max(dot(n, uSunDir), 0.0) * uSunRadiance * sunShadow(n);
        vec3 points = pointLight(0, n) + pointLight(1, n);
        lit = base.rgb * (hemi + sun + uEnvAmbient + points) / PI;
    }
    if (uHasEmissive != 0) lit += texture(uEmissiveMap, vUv).rgb * uEmissiveScale;

    vec3 color = linearToSrgb(uToneMap != 0 ? acesFilmic(lit) : clamp(lit, 0.0, 1.0));
    if (uNoFog == 0) color = mix(color, uFogColor, smoothstep(uFogNear, uFogFar, vDepth));
    outColor = vec4(color, uAlpha * base.a);
}
)";

const char* kDepthVertexSrc = R"(#version 450 core
layout(location = 0) in vec3 aPos;
layout(location = 4) in float aHouse;
layout(std430, binding = 0) readonly buffer HouseFlags { uint flags[]; };
uniform mat4 uLightViewProj;
uniform mat4 uModel;
void main() {
    int house = int(aHouse + 0.5);
    // las casas dibujadas por piezas no proyectan desde el lote agrupado
    if (house > 0 && flags[house] != 0u) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    gl_Position = uLightViewProj * uModel * vec4(aPos, 1.0);
}
)";
const char* kDepthFragmentSrc = "#version 450 core\nvoid main() {}\n";

// Malla con esqueleto: mezcla las matrices de hueso (mundo · inverseBind) por vértice.
const char* kSkinnedVertexSrc = R"(#version 450 core
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aUv;
layout(location = 3) in vec4 aJoints;
layout(location = 4) in vec4 aWeights;

uniform mat4 uViewProj;
uniform mat4 uView;
uniform mat4 uModel;
uniform mat4 uBones[64];

out vec3 vNormal;
out vec3 vColor;
out vec2 vUv;
out vec3 vWorld;
out float vDepth;
flat out uint vSeparate;

void main() {
    mat4 skin = aWeights.x * uBones[int(aJoints.x + 0.5)] + aWeights.y * uBones[int(aJoints.y + 0.5)]
              + aWeights.z * uBones[int(aJoints.z + 0.5)] + aWeights.w * uBones[int(aJoints.w + 0.5)];
    vec4 world = uModel * (skin * vec4(aPos, 1.0));
    vWorld = world.xyz;
    vNormal = mat3(uModel) * (mat3(skin) * aNormal);
    vColor = vec3(1.0);
    vUv = aUv;
    vDepth = -(uView * world).z;
    vSeparate = 0u;
    gl_Position = uViewProj * world;
}
)";
const char* kSkinnedDepthVertexSrc = R"(#version 450 core
layout(location = 0) in vec3 aPos;
layout(location = 2) in vec2 aUv;
layout(location = 3) in vec4 aJoints;
layout(location = 4) in vec4 aWeights;
uniform mat4 uLightViewProj;
uniform mat4 uModel;
uniform mat4 uBones[64];
out vec2 vUv;
void main() {
    mat4 skin = aWeights.x * uBones[int(aJoints.x + 0.5)] + aWeights.y * uBones[int(aJoints.y + 0.5)]
              + aWeights.z * uBones[int(aJoints.z + 0.5)] + aWeights.w * uBones[int(aJoints.w + 0.5)];
    vUv = aUv;
    gl_Position = uLightViewProj * uModel * (skin * vec4(aPos, 1.0));
}
)";
// El pelo y las pestañas proyectan sombra solo donde su textura es opaca.
const char* kSkinnedDepthFragmentSrc = R"(#version 450 core
in vec2 vUv;
uniform sampler2D uMap;
uniform int uHasMap;
uniform float uAlphaCutoff;
void main() {
    if (uHasMap != 0 && texture(uMap, vUv).a < uAlphaCutoff) discard;
}
)";

// Triángulo que cubre la pantalla: amplía la escena renderizada a menor resolución.
const char* kBlitVertexSrc = R"(#version 450 core
out vec2 vUv;
void main() {
    vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
    vUv = p;
    gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
)";
const char* kBlitFragmentSrc = R"(#version 450 core
in vec2 vUv;
uniform sampler2D uTex;
out vec4 outColor;
void main() { outColor = vec4(texture(uTex, vUv).rgb, 1.0); }
)";

// Irradiancia que aporta el entorno (RoomEnvironment) con environmentIntensity = 1.
constexpr float kEnvIrradiance = 1.5f;
constexpr float kExposure = 1.05f;

glm::vec3 V3f(const Vec3& p) { return {static_cast<float>(p.x), static_cast<float>(p.y), static_cast<float>(p.z)}; }

glm::vec3 v3(const Rgb& c, double scale = 1) {
    return {static_cast<float>(c.r * scale), static_cast<float>(c.g * scale), static_cast<float>(c.b * scale)};
}

}  // namespace

Renderer::Renderer() {
    shader_ = std::make_unique<Shader>(kVertexSrc, kFragmentSrc);
    depthShader_ = std::make_unique<Shader>(kDepthVertexSrc, kDepthFragmentSrc);
    blitShader_ = std::make_unique<Shader>(kBlitVertexSrc, kBlitFragmentSrc);
    skinnedShader_ = std::make_unique<Shader>(kSkinnedVertexSrc, kFragmentSrc);
    skinnedDepthShader_ = std::make_unique<Shader>(kSkinnedDepthVertexSrc, kSkinnedDepthFragmentSrc);
    cur_ = shader_.get();
    glGenVertexArrays(1, &emptyVao_);
    shadowMap_ = std::make_unique<DepthTarget>(kShadowMapSize);

    MeshBuilder cube;
    cube.box({-0.5f, -0.5f, -0.5f}, {0.5f, 0.5f, 0.5f}, {1, 1, 1}, true);
    unitBox_ = std::make_unique<GpuMesh>(cube.vertices().data(), cube.vertices().size(), cube.indices().data(), cube.indices().size());

    // Halo: cuadrado horizontal de 2x2 m con un degradado radial (alfa = (1 - r)^2 * 70/255).
    MeshBuilder quad;
    quad.quad({-1, 0, -1}, {-1, 0, 1}, {1, 0, 1}, {1, 0, -1}, {0, 1, 0}, {1, 1, 1}, {0, 0}, {0, 1}, {1, 1}, {1, 0});
    haloQuad_ = std::make_unique<GpuMesh>(quad.vertices().data(), quad.vertices().size(), quad.indices().data(), quad.indices().size());
    Image halo;
    halo.width = halo.height = 32;
    halo.srgb = false;
    halo.repeat = false;
    halo.rgba.resize(32 * 32 * 4);
    for (int y = 0; y < 32; ++y)
        for (int x = 0; x < 32; ++x) {
            const double r = std::hypot((x + 0.5) / 32 * 2 - 1, (y + 0.5) / 32 * 2 - 1);
            const size_t i = (static_cast<size_t>(y) * 32 + x) * 4;
            halo.rgba[i] = halo.rgba[i + 1] = halo.rgba[i + 2] = 255;
            halo.rgba[i + 3] = static_cast<std::uint8_t>(std::lround(std::pow(std::max(0.0, 1 - r), 2) * 70));
        }
    haloTexture_ = std::make_unique<GpuTexture>(halo);

    glEnable(GL_DEPTH_TEST);
    glEnable(GL_CULL_FACE);
    glCullFace(GL_BACK);
    houseFlags_.upload(std::vector<std::uint8_t>(1, 0));
}

Renderer::~Renderer() {
    if (emptyVao_) glDeleteVertexArrays(1, &emptyVao_);
}

int Renderer::uploadTexture(const Image& image) {
    charTextures_.emplace_back(image);
    return static_cast<int>(charTextures_.size()) - 1;
}

int Renderer::uploadSkinnedMesh(const std::vector<float>& vertices, const std::vector<std::uint32_t>& indices) {
    skinMeshes_.emplace_back(vertices, indices);
    return static_cast<int>(skinMeshes_.size()) - 1;
}

void Renderer::uploadWorld(const VisualWorld& world) {
    textures_.clear();
    for (const Image& img : world.textures) textures_.emplace_back(img);
    materials_ = world.materials;
    auto upload = [](const std::vector<CpuBatch>& in, std::vector<GpuBatch>& out) {
        out.clear();
        for (const CpuBatch& b : in) {
            if (b.mesh.empty()) continue;
            out.push_back({GpuMesh(b.mesh.vertices().data(), b.mesh.vertices().size(), b.mesh.indices().data(), b.mesh.indices().size()),
                           b.bounds, b.material});
        }
    };
    upload(world.statics, statics_);
    upload(world.closed, closed_);
    houses_.clear();
    houses_.resize(world.houses.size());
    for (size_t h = 0; h < world.houses.size(); ++h) {
        for (int p = 0; p < 5; ++p) {
            const HousePart& part = p < 4 ? world.houses[h].walls[p] : world.houses[h].roof;
            for (const auto& [mat, mesh] : part.draws)
                houses_[h].parts[p].emplace_back(mat, GpuMesh(mesh.vertices().data(), mesh.vertices().size(), mesh.indices().data(), mesh.indices().size()));
        }
    }
    houseFlags_.upload(std::vector<std::uint8_t>(world.houses.size() + 1, 0));
}

void Renderer::resize(int width, int height) {
    width_ = std::max(1, width);
    height_ = std::max(1, height);
}

void Renderer::bindMaterial(const MaterialDef& m, bool night, float alpha) {
    const bool hasMap = m.map >= 0 && m.map < static_cast<int>(textures_.size());
    const bool hasEmissive = m.emissive >= 0 && m.emissive < static_cast<int>(textures_.size());
    if (hasMap) textures_[m.map].bind(0);
    if (hasEmissive) textures_[m.emissive].bind(1);
    cur_->set("uHasMap", hasMap ? 1 : 0);
    cur_->set("uHasEmissive", hasEmissive ? 1 : 0);
    cur_->set("uTint", v3(m.tint));
    cur_->set("uEmissiveScale", (m.nightEmissive && !night) ? 0.0f : m.emissiveIntensity);
    cur_->set("uUnlit", m.unlit ? 1 : 0);
    cur_->set("uNoFog", m.noFog ? 1 : 0);
    cur_->set("uToneMap", 1);
    cur_->set("uAlpha", alpha);
    cur_->set("uAlphaCutoff", 0.0f);
    if (m.doubleSided == cullEnabled_) {
        cullEnabled_ = !m.doubleSided;
        if (cullEnabled_) glEnable(GL_CULL_FACE); else glDisable(GL_CULL_FACE);
    }
    if (m.polygonOffset) {
        glEnable(GL_POLYGON_OFFSET_FILL);
        glPolygonOffset(-2.0f, -2.0f);
    } else {
        glDisable(GL_POLYGON_OFFSET_FILL);
    }
}

void Renderer::drawBatches(const std::vector<GpuBatch>& list, const Frustum* frustum, bool night, RenderStats& stats) {
    for (const GpuBatch& b : list) {
        if (frustum && !frustum->intersects(b.bounds)) {
            ++stats.batchesCulled;
            continue;
        }
        bindMaterial(materials_[b.material], night, 1.0f);
        b.mesh.draw();
        ++stats.drawCalls;
        ++stats.batchesVisible;
        stats.triangles += b.mesh.triangles();
    }
}

// Mapa de sombras del sol: solo lo que proyecta sombra y cae dentro de la caja de la luz.
void Renderer::renderShadowPass(const FrameInput& f, const ShadowFrame& shadow, RenderStats& stats) {
    shadowMap_->bind();
    glClear(GL_DEPTH_BUFFER_BIT);
    glEnable(GL_DEPTH_TEST);
    glDepthMask(GL_TRUE);
    glDisable(GL_BLEND);
    glDisable(GL_CULL_FACE);  // paredes finas: se dibujan las dos caras
    glEnable(GL_POLYGON_OFFSET_FILL);
    glPolygonOffset(2.0f, 4.0f);
    depthShader_->use();
    depthShader_->set("uLightViewProj", shadow.viewProj);
    depthShader_->set("uModel", glm::mat4(1.0f));
    houseFlags_.bind(0);
    const Frustum box = Frustum::fromViewProjection(shadow.viewProj);

    auto drawList = [&](const std::vector<GpuBatch>& list) {
        for (const GpuBatch& b : list) {
            if (!materials_[b.material].castShadow || !box.intersects(b.bounds)) continue;
            b.mesh.draw();
            ++stats.shadowDrawCalls;
            stats.triangles += b.mesh.triangles();
        }
    };
    drawList(statics_);
    drawList(closed_);
    for (const PartDraw& p : f.parts) {
        if (p.opacity <= 0) continue;
        for (const auto& [mat, mesh] : houses_[p.house - 1].parts[p.part]) {
            if (!materials_[mat].castShadow) continue;
            mesh.draw();
            ++stats.shadowDrawCalls;
            stats.triangles += mesh.triangles();
        }
    }
    for (const DynBox& b : f.boxes) {
        glm::mat4 m = glm::translate(glm::mat4(1.0f), b.entityPos);
        m = glm::rotate(m, b.entityRotY, glm::vec3(0, 1, 0));
        m = glm::translate(m, b.localCenter);
        m = glm::scale(m, b.size);
        depthShader_->set("uModel", m);
        unitBox_->draw();
        ++stats.shadowDrawCalls;
        stats.triangles += unitBox_->triangles();
    }
    for (const MeshDraw& d : f.meshes) {
        if (!d.castShadow || d.alpha < 0.99f || d.mesh < 0 || d.mesh >= static_cast<int>(dynMeshes_.size())) continue;
        depthShader_->set("uModel", d.model);
        dynMeshes_[d.mesh].draw();
        ++stats.shadowDrawCalls;
        stats.triangles += dynMeshes_[d.mesh].triangles();
    }
    if (!f.skinned.empty()) {
        skinnedDepthShader_->use();
        skinnedDepthShader_->set("uLightViewProj", shadow.viewProj);
        skinnedDepthShader_->set("uMap", 0);
        for (const SkinnedDraw& d : f.skinned) {
            if (!d.castShadow || d.blend) continue;
            const bool hasMap = d.texture >= 0 && d.texture < static_cast<int>(charTextures_.size());
            if (hasMap) charTextures_[d.texture].bind(0);
            skinnedDepthShader_->set("uModel", d.model);
            skinnedDepthShader_->set("uHasMap", hasMap && d.alphaCutoff > 0 ? 1 : 0);
            skinnedDepthShader_->set("uAlphaCutoff", d.alphaCutoff);
            skinnedDepthShader_->setMat4Array("uBones", d.palette, std::min(d.paletteCount, kMaxBones));
            skinMeshes_[d.mesh].draw();
            ++stats.shadowDrawCalls;
            stats.triangles += skinMeshes_[d.mesh].triangles();
        }
    }
    glDisable(GL_POLYGON_OFFSET_FILL);
    stats.drawCalls += stats.shadowDrawCalls;
    cullEnabled_ = false;  // el estado de culling lo restablece bindMaterial
}

void Renderer::drawBoxes(const FrameInput& f, bool onlySilhouette, RenderStats& stats) {
    for (const DynBox& b : f.boxes) {
        if (onlySilhouette && !b.silhouette) continue;
        glm::mat4 m = glm::translate(glm::mat4(1.0f), b.entityPos);
        m = glm::rotate(m, b.entityRotY, glm::vec3(0, 1, 0));
        m = glm::translate(m, b.localCenter);
        m = glm::scale(m, b.size);
        shader_->set("uModel", m);
        shader_->set("uTint", v3(b.color));
        unitBox_->draw();
        ++stats.drawCalls;
        stats.triangles += unitBox_->triangles();
    }
}

int Renderer::uploadMesh(const MeshBuilder& mesh) {
    dynMeshes_.emplace_back(mesh.vertices().data(), mesh.vertices().size(), mesh.indices().data(), mesh.indices().size());
    return static_cast<int>(dynMeshes_.size()) - 1;
}

void Renderer::drawMeshes(const FrameInput& f, bool blended, RenderStats& stats) {
    for (const MeshDraw& d : f.meshes) {
        if (d.mesh < 0 || d.mesh >= static_cast<int>(dynMeshes_.size()) || (d.alpha < 1.0f) != blended || d.alpha <= 0) continue;
        MaterialDef m;
        m.unlit = d.unlit;
        m.doubleSided = d.doubleSided;
        m.tint = d.tint;
        bindMaterial(m, f.night, d.alpha);
        shader_->set("uModel", d.model);
        if (d.noDepthTest) glDisable(GL_DEPTH_TEST);
        dynMeshes_[d.mesh].draw();
        if (d.noDepthTest) glEnable(GL_DEPTH_TEST);
        ++stats.drawCalls;
        stats.triangles += dynMeshes_[d.mesh].triangles();
    }
    shader_->set("uModel", glm::mat4(1.0f));
}

void Renderer::drawScene(const FrameInput& f, const ShadowFrame* shadow, int width, int height, RenderStats& stats) {
    glViewport(0, 0, width, height);
    glDepthMask(GL_TRUE);
    glDepthFunc(GL_LESS);
    glDisable(GL_BLEND);
    glDisable(GL_POLYGON_OFFSET_FILL);
    const Rgb bg = toSrgb(f.lighting.background);
    glClearColor(static_cast<float>(bg.r), static_cast<float>(bg.g), static_cast<float>(bg.b), 1);
    glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);

    const CameraMatrices cm = cameraMatrices(*f.camera, f.aspect);
    const glm::mat4 view = cm.view, proj = cm.proj;
    const Frustum frustum = Frustum::fromViewProjection(proj * view);

    const Lighting& l = f.lighting;
    const Vec3 sun = sunDirection();
    // Luces puntuales reales (siempre las mismas plazas; las vacías con intensidad 0).
    glm::vec3 lightPos[LocalLights::kPoolSize], lightColor[LocalLights::kPoolSize];
    glm::vec2 lightRange[LocalLights::kPoolSize];
    for (int i = 0; i < LocalLights::kPoolSize; ++i) {
        const PooledLight* p = f.lights ? &f.lights[i] : nullptr;
        lightPos[i] = p ? V3f(p->position) : glm::vec3(0);
        lightColor[i] = p ? v3(p->color, p->intensity) : glm::vec3(0);
        lightRange[i] = p ? glm::vec2(static_cast<float>(p->distance), static_cast<float>(p->decay)) : glm::vec2(0, 2);
    }
    // Uniformes comunes del cuadro; se aplican a los programas de geometría estática y con esqueleto.
    auto applyFrame = [&](Shader& sh) {
        sh.use();
        sh.set("uViewProj", proj * view);
        sh.set("uView", view);
        sh.set("uSunDir", glm::vec3(static_cast<float>(sun.x), static_cast<float>(sun.y), static_cast<float>(sun.z)));
        sh.set("uSunRadiance", v3(l.sunColor, l.sunIntensity));
        sh.set("uHemiSky", v3(l.hemiSky, l.hemiIntensity));
        sh.set("uHemiGround", v3(l.hemiGround, l.hemiIntensity));
        sh.set("uEnvAmbient", glm::vec3(static_cast<float>(l.envIntensity) * kEnvIrradiance));
        sh.set("uFogColor", v3(toSrgb(l.background)));
        sh.set("uFogNear", static_cast<float>(l.fogNear));
        sh.set("uFogFar", static_cast<float>(l.fogFar));
        sh.set("uExposure", kExposure);
        sh.set("uMap", 0);
        sh.set("uEmissiveMap", 1);
        sh.set("uShadowMap", 2);
        sh.set("uModel", glm::mat4(1.0f));
        sh.set("uShadowOn", shadow ? 1 : 0);
        if (shadow) {
            sh.set("uShadowMatrix", shadow->texMatrix);
            sh.set("uShadowBias", static_cast<float>(kShadowBias));
            sh.set("uShadowTexel", 1.0f / static_cast<float>(kShadowMapSize));
        }
        sh.setArray("uLightPos", lightPos, LocalLights::kPoolSize);
        sh.setArray("uLightColor", lightColor, LocalLights::kPoolSize);
        sh.setArray("uLightRange", lightRange, LocalLights::kPoolSize);
    };
    if (shadow) shadowMap_->bindTexture(2);
    applyFrame(*skinnedShader_);
    applyFrame(*shader_);
    cur_ = shader_.get();

    // Casas dibujadas por piezas: sus vértices del lote agrupado se descartan en el shader.
    if (f.houseSeparate) houseFlags_.upload(*f.houseSeparate);
    houseFlags_.bind(0);

    cullEnabled_ = true;
    glEnable(GL_CULL_FACE);
    const Frustum* fr = f.cullStatics ? &frustum : nullptr;
    drawBatches(statics_, fr, f.night, stats);
    drawBatches(closed_, fr, f.night, stats);

    // Piezas sueltas opacas (casas con alguna pared atenuada).
    auto drawPart = [&](const PartDraw& p, float alpha) {
        for (const auto& [mat, mesh] : houses_[p.house - 1].parts[p.part]) {
            bindMaterial(materials_[mat], f.night, alpha);
            mesh.draw();
            ++stats.drawCalls;
            stats.triangles += mesh.triangles();
        }
    };
    for (const PartDraw& p : f.parts)
        if (p.opacity >= 1.0f) drawPart(p, 1.0f);

    // Cajas dinámicas.
    MaterialDef plain;
    bindMaterial(plain, f.night, 1.0f);
    drawBoxes(f, false, stats);
    drawMeshes(f, false, stats);
    shader_->set("uModel", glm::mat4(1.0f));

    // Personajes opacos y con recorte alfa (pelo).
    drawSkinned(f, SkinPass::Opaque, stats);

    // Halos decorativos de luz: aditivos, sin escribir profundidad ni tonemapping.
    if (f.halos && !f.halos->empty()) {
        MaterialDef halo;
        halo.unlit = true;
        bindMaterial(halo, f.night, 1.0f);
        haloTexture_->bind(0);
        shader_->set("uHasMap", 1);
        shader_->set("uToneMap", 0);
        glEnable(GL_BLEND);
        glBlendFunc(GL_SRC_ALPHA, GL_ONE);
        glDepthMask(GL_FALSE);
        glEnable(GL_POLYGON_OFFSET_FILL);
        glPolygonOffset(-1.0f, -1.0f);
        glDisable(GL_CULL_FACE);
        cullEnabled_ = false;
        for (const Halo& h : *f.halos) {
            glm::mat4 m = glm::translate(glm::mat4(1.0f), V3f(h.position));
            m = glm::scale(m, glm::vec3(static_cast<float>(h.radius), 1.0f, static_cast<float>(h.radius)));
            shader_->set("uModel", m);
            shader_->set("uTint", v3(h.color));
            haloQuad_->draw();
            ++stats.drawCalls;
            ++stats.halos;
            stats.triangles += haloQuad_->triangles();
        }
        glDepthMask(GL_TRUE);
        glDisable(GL_BLEND);
        glDisable(GL_POLYGON_OFFSET_FILL);
        shader_->set("uToneMap", 1);
        shader_->set("uModel", glm::mat4(1.0f));
    }

    // Piezas atenuadas: mezcla alfa sin escribir profundidad.
    glEnable(GL_BLEND);
    glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
    glDepthMask(GL_FALSE);
    for (const PartDraw& p : f.parts)
        if (p.opacity < 1.0f && p.opacity > 0) drawPart(p, p.opacity);
    glDepthMask(GL_TRUE);
    glDisable(GL_BLEND);

    // Mallas dinámicas con transparencia (aura, anillos, bus que se desvanece).
    glEnable(GL_BLEND);
    glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
    glDepthMask(GL_FALSE);
    drawMeshes(f, true, stats);
    glDepthMask(GL_TRUE);
    glDisable(GL_BLEND);

    // Partes de personajes con mezcla alfa (cejas, pestañas, barba): sin escribir profundidad.
    glEnable(GL_BLEND);
    glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
    glDepthMask(GL_FALSE);
    drawSkinned(f, SkinPass::Blend, stats);
    glDepthMask(GL_TRUE);
    glDisable(GL_BLEND);

    // Silueta del jugador: un perfil cian donde algo lo tapa. La primera pasada pinta solo donde el jugador
    // queda detrás de otra superficie (profundidad GREATER); la segunda repinta el jugador visible y borra
    // la falsa silueta entre sus propias partes (cuerpo y ropa).
    bool anySilhouette = false;
    for (const DynBox& b : f.boxes) anySilhouette |= b.silhouette;
    for (const SkinnedDraw& d : f.skinned) anySilhouette |= d.silhouette;
    if (anySilhouette) {
        MaterialDef flat;
        flat.unlit = true;
        flat.noFog = true;
        bindMaterial(flat, f.night, 0.65f);
        shader_->set("uToneMap", 0);
        glEnable(GL_CULL_FACE);
        cullEnabled_ = true;
        glEnable(GL_POLYGON_OFFSET_FILL);
        glPolygonOffset(-1.0f, -1.0f);
        glEnable(GL_BLEND);
        glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
        glDepthFunc(GL_GREATER);
        glDepthMask(GL_FALSE);
        const FrameInput* in = &f;
        for (const DynBox& b : in->boxes) {
            if (!b.silhouette) continue;
            glm::mat4 m = glm::translate(glm::mat4(1.0f), b.entityPos);
            m = glm::rotate(m, b.entityRotY, glm::vec3(0, 1, 0));
            m = glm::translate(m, b.localCenter);
            m = glm::scale(m, b.size);
            shader_->set("uModel", m);
            shader_->set("uTint", v3(rgbFromHex(0x73e5ef)));
            unitBox_->draw();
            ++stats.drawCalls;
            stats.triangles += unitBox_->triangles();
        }
        drawSkinned(f, SkinPass::SilhouetteFlat, stats);
        glDisable(GL_BLEND);
        glDisable(GL_POLYGON_OFFSET_FILL);
        glDepthFunc(GL_LEQUAL);
        glDepthMask(GL_TRUE);
        bindMaterial(plain, f.night, 1.0f);
        drawBoxes(f, true, stats);
        drawSkinned(f, SkinPass::SilhouetteRepaint, stats);
        glDepthFunc(GL_LESS);
        shader_->set("uModel", glm::mat4(1.0f));
    }
}

void Renderer::drawSkinned(const FrameInput& f, SkinPass pass, RenderStats& stats) {
    if (f.skinned.empty()) return;
    cur_ = skinnedShader_.get();
    skinnedShader_->use();
    const bool flat = pass == SkinPass::SilhouetteFlat;
    const bool silhouette = flat || pass == SkinPass::SilhouetteRepaint;
    for (const SkinnedDraw& d : f.skinned) {
        if (pass == SkinPass::Opaque && d.blend) continue;
        if (pass == SkinPass::Blend && !d.blend) continue;
        if (silhouette && !d.silhouette) continue;
        if (pass == SkinPass::SilhouetteRepaint && d.blend) continue;  // las partes con alfa ya se mezclaron antes
        const bool hasMap = d.texture >= 0 && d.texture < static_cast<int>(charTextures_.size());
        if (hasMap) charTextures_[d.texture].bind(0);
        cur_->set("uModel", d.model);
        cur_->set("uHasMap", hasMap ? 1 : 0);
        cur_->set("uHasEmissive", 0);
        cur_->set("uEmissiveScale", 0.0f);
        cur_->set("uAlphaCutoff", d.alphaCutoff);
        cur_->set("uUnlit", (flat || d.unlit) ? 1 : 0);
        cur_->set("uToneMap", flat ? 0 : 1);
        cur_->set("uNoFog", flat ? 1 : 0);
        cur_->set("uAlpha", flat ? 0.65f : 1.0f);
        cur_->set("uTint", flat ? v3(rgbFromHex(0x73e5ef)) : v3(d.tint));
        if (d.doubleSided == cullEnabled_) {
            cullEnabled_ = !d.doubleSided;
            if (cullEnabled_) glEnable(GL_CULL_FACE); else glDisable(GL_CULL_FACE);
        }
        if (!flat) {
            if (d.polygonOffset) { glEnable(GL_POLYGON_OFFSET_FILL); glPolygonOffset(-1.0f, -2.0f); }
            else glDisable(GL_POLYGON_OFFSET_FILL);
        }
        cur_->setMat4Array("uBones", d.palette, std::min(d.paletteCount, kMaxBones));
        skinMeshes_[d.mesh].draw();
        ++stats.drawCalls;
        stats.triangles += skinMeshes_[d.mesh].triangles();
    }
    if (!flat) glDisable(GL_POLYGON_OFFSET_FILL);
    cur_ = shader_.get();
    shader_->use();
}

void Renderer::ensureScaledTargets(int w, int h) {
    if (sceneTarget_ && sceneTarget_->width() == w && sceneTarget_->height() == h) return;
    sceneTarget_ = std::make_unique<ColorTarget>(w, h, 4);
    resolveTarget_ = std::make_unique<ColorTarget>(w, h, 1, true);
}

RenderStats Renderer::render(const FrameInput& f) {
    RenderStats stats;

    // El sol proyecta sombra solo si aporta luz apreciable (de noche casi no se ven).
    ShadowFrame shadow{};
    const bool shadowOn = f.lighting.sunIntensity >= 0.12;
    if (shadowOn) {
        shadow = computeShadowFrame(f.shadowTarget, sunDirection());
        stats.shadowPass = true;
        renderShadowPass(f, shadow, stats);
    }

    const bool scaled = scale_ < 0.999;
    int w = width_, h = height_;
    if (scaled) {
        w = std::max(1, static_cast<int>(std::lround(width_ * scale_)));
        h = std::max(1, static_cast<int>(std::lround(height_ * scale_)));
        ensureScaledTargets(w, h);
        sceneTarget_->bind();
    } else {
        glBindFramebuffer(GL_FRAMEBUFFER, 0);
    }
    drawScene(f, shadowOn ? &shadow : nullptr, w, h, stats);

    if (scaled) {
        // Resolver el multimuestreo a una textura y ampliarla a la ventana con un triángulo de pantalla completa
        // (un blit con escalado hacia el framebuffer multimuestreado de la ventana no está permitido).
        glBindFramebuffer(GL_READ_FRAMEBUFFER, sceneTarget_->fbo());
        glBindFramebuffer(GL_DRAW_FRAMEBUFFER, resolveTarget_->fbo());
        glBlitFramebuffer(0, 0, w, h, 0, 0, w, h, GL_COLOR_BUFFER_BIT, GL_NEAREST);
        glBindFramebuffer(GL_FRAMEBUFFER, 0);
        glViewport(0, 0, width_, height_);
        glDisable(GL_DEPTH_TEST);
        glDisable(GL_CULL_FACE);
        glDisable(GL_BLEND);
        blitShader_->use();
        blitShader_->set("uTex", 0);
        glActiveTexture(GL_TEXTURE0);
        glBindTexture(GL_TEXTURE_2D, resolveTarget_->colorTexture());
        glBindVertexArray(emptyVao_);
        glDrawArrays(GL_TRIANGLES, 0, 3);
        glEnable(GL_DEPTH_TEST);
        cullEnabled_ = false;
    }
    return stats;
}

std::vector<unsigned char> Renderer::readPixels(int& width, int& height) const {
    width = width_;
    height = height_;
    std::vector<unsigned char> px(static_cast<size_t>(width) * height * 4), flipped(px.size());
    glBindFramebuffer(GL_READ_FRAMEBUFFER, 0);
    glPixelStorei(GL_PACK_ALIGNMENT, 1);
    glReadPixels(0, 0, width, height, GL_RGBA, GL_UNSIGNED_BYTE, px.data());
    const size_t row = static_cast<size_t>(width) * 4;
    for (int y = 0; y < height; ++y) std::copy_n(px.data() + (height - 1 - y) * row, row, flipped.data() + y * row);
    return flipped;
}

}  // namespace bazuko
