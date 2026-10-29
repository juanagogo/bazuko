#pragma once
#include <string>
#include <vector>
#include <memory>
#include <limits>
#include <unordered_map>
#include <glm/gtc/quaternion.hpp>
#include <glm/glm.hpp>
#include "Mesh.hpp"
#include "Texture.hpp"
#include "Renderer.hpp"

namespace Bazuko {

struct ModelPart {
    std::shared_ptr<Mesh> mesh;
    std::shared_ptr<Texture> texture;
    std::shared_ptr<Texture> specularTexture;
    glm::vec4 baseColor = glm::vec4(1.0f);
    glm::mat4 transform{1.0f};
    int alphaMode = 0;
    float alphaCutoff = 0.5f;
    bool doubleSided = false;
    bool paint = false;   // material "Paint": la pintura del carro, que se tiñe con `paintTint` al dibujar
    std::vector<size_t> jointNodes;
    std::vector<glm::mat4> inverseBindMatrices;
};

class Model {
public:
    Model() = default;
    ~Model() = default;

    static std::shared_ptr<Model> LoadFromFile(const std::string& filepath,
                                               const std::string& meshNameFilter = {},
                                               const std::string& excludedMeshName = {},
                                               float maximumWorldX = std::numeric_limits<float>::infinity());
    void SetAnimationSource(const Model& source,
                            const std::unordered_map<std::string, std::string>& clipAliases = {});
    int FindAnimationClip(const std::string& name) const;

    // Giro procedural de un hueso (el perro se anima moviendo sus huesos por codigo): `angles` son radianes sobre los ejes del
    // modelo (x lateral, y vertical, z hacia delante) aplicados en ese orden sobre la pose de reposo; `offset` desplaza el hueso
    struct BoneTurn { std::string name; glm::vec3 angles{0.0f}; glm::vec3 offset{0.0f}; };
    void Draw(Renderer& renderer, const glm::mat4& transform, const glm::vec4& tint = glm::vec4(1.0f),
              float animationTime = 0.0f, bool animate = false, int animationClip = 0,
              int alphaModeOverride = -1, bool seatedPose = false, const glm::vec4& paintTint = glm::vec4(1.0f),
              int blendClip = -1, float blendWeight = 0.0f,   // blendClip: segundo clip (misma fase) mezclado con peso blendWeight
              const std::vector<BoneTurn>* turns = nullptr) const;

    // Matriz mundial (en el espacio del modelo) de un hueso en una pose de la animacion: para colocar objetos en la mano
    glm::mat4 GetNodeWorld(const std::string& nameSuffix, float animationTime, bool animate, int animationClip,
                           int blendClip = -1, float blendWeight = 0.0f, const std::vector<BoneTurn>* turns = nullptr) const;
    float GetAnimationClipDuration(int clip) const;
    const std::vector<ModelPart>& GetParts() const { return m_Parts; }
    size_t GetAnimationClipCount() const { return m_AnimationClips.size(); }
    const glm::vec3& GetBoundsMinimum() const { return m_BoundsMinimum; }
    const glm::vec3& GetBoundsMaximum() const { return m_BoundsMaximum; }
    const glm::vec3& GetGroundAnchor() const { return m_GroundAnchor; }
    // Ropa y calzado: se dibujan separados `meters` de la piel (ver Renderer::SetPushOut)
    void SetPushOut(float meters) { m_PushOut = meters; }
    float GetPushOut() const { return m_PushOut; }

private:
    static std::shared_ptr<Model> LoadWithAssimp(const std::string& filepath,
                                                 const std::string& meshNameFilter,
                                                 const std::string& excludedMeshName,
                                                 float maximumWorldX);

    std::vector<glm::mat4> EvaluatePose(float animationTime, bool animate, int animationClip, bool seatedPose,
                                        int blendClip = -1, float blendWeight = 0.0f, const std::vector<BoneTurn>* turns = nullptr) const;
    float m_PushOut = 0.0f;
    float m_HipsScale = 1.0f;   // altura de la cadera de este cuerpo respecto al esqueleto de las animaciones

    std::vector<ModelPart> m_Parts;
    glm::vec3 m_BoundsMinimum{0.0f};
    glm::vec3 m_BoundsMaximum{0.0f};
    glm::vec3 m_GroundAnchor{0.0f};
    struct AnimationChannel { size_t nodeIndex = 0; size_t samplerIndex = 0; int path = 0; size_t sourceNodeIndex = 0; glm::vec3 sourceRestTranslation{0.0f}; glm::quat sourceRestRotation{1.0f, 0.0f, 0.0f, 0.0f}; glm::vec3 sourceRestScale{1.0f}; };
    struct AnimationSampler { std::vector<float> times; std::vector<glm::vec4> values; int interpolation = 0; size_t components = 0; };
    struct AnimationClip { std::string name; std::vector<size_t> channels; float duration = 0.0f; };
    struct AnimationNode {
        glm::vec3 translation{0.0f};
        glm::quat rotation{1.0f, 0.0f, 0.0f, 0.0f};
        glm::vec3 scale{1.0f};
        int parent = -1;
        std::string name;
    };
    std::vector<AnimationNode> m_Nodes;
    std::vector<AnimationNode> m_AnimationSourceNodes;
    std::vector<int> m_SourceToTargetNode;
    std::vector<glm::quat> m_SourceRestWorldRotations;
    std::vector<glm::quat> m_TargetRestWorldRotations;
    glm::quat m_AnimationOrientationCorrection{1.0f, 0.0f, 0.0f, 0.0f};
    std::vector<AnimationChannel> m_AnimationChannels;
    std::vector<AnimationSampler> m_AnimationSamplers;
    std::vector<AnimationClip> m_AnimationClips;
    std::vector<std::vector<size_t>> m_PartNodes;
};

} // namespace Bazuko
