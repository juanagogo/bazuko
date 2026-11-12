#pragma once
#include "CharacterTypes.hpp"
#include "../renderer/Model.hpp"
#include "../renderer/Mesh.hpp"
#include "../renderer/Renderer.hpp"
#include <array>
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
              int animationClipOverride = -1, int blendClip = -1, float blendWeight = 0.0f,
              const std::vector<Model::BoneTurn>* turns = nullptr,   // turns: giros de huesos por codigo (brazada de nado)
              float blendTime = -1.0f);   // segundo del clip de mezcla (blendClip); < 0: la misma fase que el primero (caminar y correr). Los saltos mezclan clips de tiempos distintos
    // Clips de animacion por nombre (Jump, Kick, PunchJab, PunchCross, FightIdle, KnifeIdle, KnifeSlash, KnifeStab, CrouchWalk,
    // IdleRelaxed...), su duracion en segundos y la matriz de una mano en la pose indicada (para sostener objetos)
    int FindClip(const std::string& name) const { return m_Body ? m_Body->FindAnimationClip(name) : -1; }
    float ClipDuration(int clip) const { return m_Body ? m_Body->GetAnimationClipDuration(clip) : 0.0f; }
    // Mezcla caminar/correr para que la zancada coincida con `speed` (m/s): peso de correr (0..1) y ciclos por segundo.
    // Mezclar posturas no mezcla la zancada linealmente, por eso se mide (como locomotionBlend del juego web).
    struct LocomotionBlend { float run = 0.0f; float rate = 1.0f; bool valid = false; };
    LocomotionBlend ComputeLocomotion(float speed) const;
    int GetWalkClip() const { return m_WalkClip; }
    int GetRunClip() const { return m_RunClip; }
    // Andar cansado (jugador sin energia): clip, duracion y zancada medida; -1 / 0 si el banco no lo trae
    int GetTiredClip() const { return m_TiredStride > 0.05f ? m_TiredClip : -1; }
    float GetTiredDuration() const { return m_TiredDuration; }
    float GetTiredStride() const { return m_TiredStride; }
    float GetWalkDuration() const { return m_WalkDuration; }
    glm::mat4 HandMatrix(const glm::mat4& playerTransform, float animTime, int clip, bool rightHand) const {
        if (!m_Body) return playerTransform;
        return glm::scale(playerTransform, glm::vec3(1.08f)) * m_Body->GetNodeWorld(rightHand ? "RightHand" : "LeftHand", animTime, clip >= 0, clip);
    }
    // Matriz de un hueso (en el mundo) con la MISMA pose con que se dibuja el personaje (animacion elegida por la marcha, mezcla y giros de huesos): para
    // poner un cigarrillo en la mano o sacar el humo de la boca
    glm::mat4 PosedNode(const char* node, const glm::mat4& playerTransform, float animTime, bool moving, bool isRunning, int animationClipOverride,
                        int blendClip, float blendWeight, const std::vector<Model::BoneTurn>* turns, float blendTime = -1.0f) const {
        if (!m_Body) return playerTransform;
        const int defaultClip = moving ? (isRunning && m_RunClip >= 0 ? m_RunClip : m_WalkClip) : m_IdleClip;
        const int clip = animationClipOverride >= 0 ? animationClipOverride : defaultClip;
        return glm::scale(playerTransform, glm::vec3(1.08f)) * m_Body->GetNodeWorld(node, animTime, clip >= 0, clip, blendClip, blendWeight, turns, blendTime);
    }
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
    std::string m_LoadedHead;

    std::shared_ptr<Model> m_AnimLibrary;
    std::shared_ptr<Model> m_Body;
    std::shared_ptr<Model> m_Clothes;
    std::shared_ptr<Model> m_Shoes;
    std::shared_ptr<Model> m_Hair;
    std::shared_ptr<Model> m_Beard;
    std::shared_ptr<Model> m_Hat;   // boina o gorro de lana

    std::shared_ptr<Mesh> m_FallbackBody;
    std::shared_ptr<Mesh> m_FallbackHead;

    // Velocidad (m/s del mundo) a la que avanza el pie apoyado al reproducir un clip a su ritmo natural; 0 = no medible
    float MeasureStride(float runShare, int baseClip = -1, float baseDuration = 0.0f) const;
    std::array<float, 5> m_Strides{};   // zancada (m del mundo por ciclo) con 0, 25, 50, 75 y 100 % de correr
    float m_WalkDuration = 0.0f, m_RunDuration = 0.0f;
    int m_WalkClip = -1;
    int m_TiredClip = -1;
    float m_TiredDuration = 0.0f, m_TiredStride = 0.0f;
    int m_RunClip = -1;
    int m_IdleClip = -1;
    int m_SearchClip = -1;
    int m_CrouchClip = -1;
};

} // namespace Bazuko
