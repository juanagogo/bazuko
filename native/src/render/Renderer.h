#pragma once

#include <cstdint>
#include <memory>
#include <vector>

#include <glm/glm.hpp>

#include "character/CharacterLibrary.h"
#include "game/CameraRig.h"
#include "game/Lighting.h"
#include "render/Gpu.h"
#include "render/LocalLights.h"
#include "render/MeshBuilder.h"
#include "render/Shadow.h"
#include "render/SkinnedDraw.h"
#include "render/VisualWorld.h"

namespace bazuko {

// Caja dinámica (jugador, carros, peatones...) definida en el espacio local de una entidad.
struct DynBox {
    glm::vec3 entityPos;
    float entityRotY;
    glm::vec3 localCenter;  // centro de la caja respecto a la entidad
    glm::vec3 size;
    Rgb color;
    bool silhouette = false;  // el jugador: se perfila en cian cuando algo lo tapa
};

// Pieza de una casa que se dibuja suelta (alguna de sus partes está atenuada).
struct PartDraw {
    unsigned house;  // id de casa (1..N)
    int part;        // 0..3 paredes altas, 4 techo
    float opacity;
};

// Malla dinámica subida con Renderer::uploadMesh (bolsas, carros, tienda, bus...). El color de cada
// vértice se multiplica por `tint`.
struct MeshDraw {
    int mesh = -1;
    glm::mat4 model{1.0f};
    Rgb tint{1, 1, 1};
    float alpha = 1;  // < 1: se mezcla sin escribir profundidad
    bool unlit = false;
    bool castShadow = true;
    bool doubleSided = false;
    bool noDepthTest = false;  // anillos y marcadores que siempre se ven
};

struct FrameInput {
    const CameraRig* camera = nullptr;
    double aspect = 16.0 / 9;
    Lighting lighting{};
    bool night = false;
    bool cullStatics = true;
    std::vector<DynBox> boxes;
    std::vector<MeshDraw> meshes;
    // Por id de casa (índice 0 = ninguna): 1 si sus partes altas se dibujan por separado.
    const std::vector<std::uint8_t>* houseSeparate = nullptr;
    std::vector<PartDraw> parts;
    std::vector<SkinnedDraw> skinned;  // personajes
    // Luces puntuales reales (LocalLights::kPoolSize) y halos decorativos.
    const PooledLight* lights = nullptr;
    const std::vector<Halo>* halos = nullptr;
    Vec3 shadowTarget{};  // el sol y su caja de sombras siguen a este punto (el jugador)
};

struct RenderStats {
    int drawCalls = 0;
    size_t triangles = 0;
    int batchesVisible = 0, batchesCulled = 0;
    int shadowDrawCalls = 0;  // incluidos en drawCalls
    bool shadowPass = false;
    int halos = 0;
};

enum class SkinPass { Opaque, Blend, SilhouetteFlat, SilhouetteRepaint };

class Renderer : public GpuSink {
public:
    Renderer();
    ~Renderer();

    // GpuSink: texturas y mallas con esqueleto de los personajes.
    int uploadTexture(const Image& image) override;
    int uploadSkinnedMesh(const std::vector<float>& vertices, const std::vector<std::uint32_t>& indices) override;

    // Sube una malla suelta y devuelve su índice para MeshDraw::mesh.
    int uploadMesh(const MeshBuilder& mesh);

    // Sube texturas, materiales y mallas del distrito a la GPU.
    void uploadWorld(const VisualWorld& world);
    void resize(int width, int height);
    // Fracción del tamaño de la ventana a la que se dibuja la escena (resolución adaptativa); 1 = nativa.
    void setRenderScale(double scale) { scale_ = scale; }
    double renderScale() const { return scale_; }
    RenderStats render(const FrameInput& frame);
    // Lee el framebuffer (RGBA, de arriba a abajo).
    std::vector<unsigned char> readPixels(int& width, int& height) const;

private:
    struct GpuBatch {
        GpuMesh mesh;
        Aabb bounds;
        int material;
    };
    struct GpuHouse {
        std::vector<std::pair<int, GpuMesh>> parts[5];
    };
    void bindMaterial(const MaterialDef& m, bool night, float alpha);
    void drawBatches(const std::vector<GpuBatch>& list, const class Frustum* frustum, bool night, RenderStats& stats);
    void renderShadowPass(const FrameInput& f, const ShadowFrame& shadow, RenderStats& stats);
    void drawScene(const FrameInput& f, const ShadowFrame* shadow, int width, int height, RenderStats& stats);
    void drawBoxes(const FrameInput& f, bool onlySilhouette, RenderStats& stats);
    void drawMeshes(const FrameInput& f, bool blended, RenderStats& stats);
    void ensureScaledTargets(int w, int h);
    void drawSkinned(const FrameInput& f, SkinPass pass, RenderStats& stats);

    std::unique_ptr<Shader> shader_, depthShader_, blitShader_, skinnedShader_, skinnedDepthShader_;
    Shader* cur_ = nullptr;  // programa de la pasada actual (bindMaterial)
    std::vector<GpuSkinnedMesh> skinMeshes_;
    std::vector<GpuMesh> dynMeshes_;
    std::vector<GpuTexture> charTextures_;
    GLuint emptyVao_ = 0;
    std::unique_ptr<GpuMesh> unitBox_, haloQuad_;
    std::unique_ptr<GpuTexture> haloTexture_;
    std::unique_ptr<DepthTarget> shadowMap_;
    std::unique_ptr<ColorTarget> sceneTarget_, resolveTarget_;
    double scale_ = 1;
    std::vector<GpuTexture> textures_;
    std::vector<MaterialDef> materials_;
    std::vector<GpuBatch> statics_, closed_;
    std::vector<GpuHouse> houses_;
    GpuUintBuffer houseFlags_;
    int width_ = 1, height_ = 1;
    bool cullEnabled_ = true;
};

}  // namespace bazuko
