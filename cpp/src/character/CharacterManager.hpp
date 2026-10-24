#pragma once
#include "CharacterTypes.hpp"
#include "../renderer/Model.hpp"
#include "../renderer/Mesh.hpp"
#include "../renderer/Renderer.hpp"
#include <functional>
#include <memory>
#include <string>

namespace Bazuko {

using ModelLoadProgress = std::function<void(size_t, size_t)>;

class CharacterManager {
public:
    CharacterManager();
    ~CharacterManager() = default;

    void Init(const ModelLoadProgress& modelLoadProgress = {});
    bool ApplyLook(const CharacterLook& look, bool forceReload = false,
                   const ModelLoadProgress& modelLoadProgress = {});
    const CharacterLook& GetLook() const { return m_Look; }

    void Draw(Renderer& renderer, const glm::mat4& playerTransform, float animTime, bool moving, bool isRunning,
              int animationClipOverride = -1);
    int GetKnockdownAnimationClip(bool recovering) const {
        if (recovering && m_CrouchClip >= 0) return m_CrouchClip;
        if (m_SearchClip >= 0) return m_SearchClip;
        return m_IdleClip;
    }

    // Efectos de rol / origen
    const OriginOption& GetOriginInfo() const;
    int GetExtraLoot() const;
    float GetDiseaseResistance() const;
    float GetBegMultiplier() const;
    float GetSellMultiplier() const;

    // Persistencia
    void Serialize(nlohmann::json& state) const;
    bool Deserialize(const nlohmann::json& state, const ModelLoadProgress& modelLoadProgress = {});

private:
    void ReloadModels(const ModelLoadProgress& modelLoadProgress = {});

    CharacterLook m_Look;
    std::string m_LoadedBodyKey; // "<sexo>-<edad>"
    std::string m_LoadedClothes;
    std::string m_LoadedShoes;
    std::string m_LoadedHair;
    std::string m_LoadedBeard;

    std::shared_ptr<Model> m_AnimLibrary;
    std::shared_ptr<Model> m_Body;
    std::shared_ptr<Model> m_Clothes;
    std::shared_ptr<Model> m_Shoes;
    std::shared_ptr<Model> m_Hair;
    std::shared_ptr<Model> m_Beard;

    std::shared_ptr<Mesh> m_FallbackBody;
    std::shared_ptr<Mesh> m_FallbackHead;

    int m_WalkClip = -1;
    int m_RunClip = -1;
    int m_IdleClip = -1;
    int m_SearchClip = -1;
    int m_CrouchClip = -1;
};

} // namespace Bazuko
