#pragma once

#include <map>
#include <memory>
#include <string>
#include <vector>

#include "character/Animator.h"
#include "character/Catalog.h"
#include "character/Gltf.h"
#include "character/Retarget.h"
#include "core/MathTypes.h"

namespace bazuko {

// Destino de las mallas y texturas de personajes (en la app lo implementa el renderer; los tests, un doble).
class GpuSink {
public:
    virtual ~GpuSink() = default;
    virtual int uploadTexture(const Image& image) = 0;
    // 16 floats por vértice: posición, normal, uv, joints (4, como float) y pesos (4).
    virtual int uploadSkinnedMesh(const std::vector<float>& vertices, const std::vector<std::uint32_t>& indices) = 0;
};

enum class PartKind { Body, Hair, Beard, Clothes, Shoes, Other };

// Una pieza dibujable de un personaje.
struct MeshPart {
    std::string name;
    PartKind kind = PartKind::Other;
    int gpuMesh = -1, gpuTexture = -1;
    std::vector<int> jointNodes;           // por joint de la skin: nodo del esqueleto del cuerpo
    std::vector<glm::mat4> inverseBind;
    Rgb tint{1, 1, 1};
    float alphaCutoff = 0;
    bool blend = false;                    // cejas, pestañas, barba: mezcla alfa sin escribir profundidad
    bool doubleSided = false;
    bool polygonOffset = false;            // la ropa gana a la piel cuando quedan muy pegadas
    bool castShadow = true;
    size_t triangles = 0;
};

// Todo lo compartido por los personajes con las mismas piezas: esqueleto, animaciones y mallas.
struct CharacterBlueprint {
    std::shared_ptr<const Rig> rig;
    std::map<std::string, std::shared_ptr<const Clip>> clips;
    std::vector<MeshPart> parts;
    Look look;
    bool lod = false;
    std::string bodyId;
};

// Crea personajes realistas por piezas (RealisticCharacter.js): cuerpo MakeHuman con esqueleto Mixamo +
// pelo, barba, ropa y calzado atados al mismo esqueleto por nombre de hueso, con animaciones retargeteadas.
class CharacterLibrary {
public:
    // `maxTextureSize` reduce las texturas más grandes (memoria de vídeo); 0 = sin límite.
    CharacterLibrary(const Catalog& catalog, const LookData& look, std::string modelsDir, GpuSink& sink, int maxTextureSize = 1024);

    // `lod` pide las versiones livianas (cuerpo proxy y piezas simplificadas) si el catálogo las trae.
    std::shared_ptr<const CharacterBlueprint> build(const Look& look, bool lod);

    const Catalog& catalog() const { return catalog_; }
    // Estadísticas de caché (pruebas).
    size_t loadedModels() const { return models_.size(); }
    size_t uploadedMeshes() const { return meshIds_.size(); }

private:
    struct BodyAssets {
        std::shared_ptr<Rig> rig;
        std::map<std::string, std::shared_ptr<const Clip>> clips;
    };
    GltfModel& model(const std::string& relativePath, bool withImages = true);
    const BodyAssets& bodyAssets(const std::string& key, const std::string& bodyPath);
    int textureFor(const std::string& path, GltfModel& m, int image);

    const Catalog& catalog_;
    const LookData& look_;
    std::string dir_;
    GpuSink& sink_;
    int maxTexture_;
    std::map<std::string, std::unique_ptr<GltfModel>> models_;
    std::map<std::string, BodyAssets> bodies_;
    std::map<std::string, int> textureIds_, meshIds_;
    std::map<std::string, std::shared_ptr<const CharacterBlueprint>> blueprints_;
    std::unique_ptr<GltfModel> anims_;
    std::unique_ptr<Rig> animRig_;
};

}  // namespace bazuko
