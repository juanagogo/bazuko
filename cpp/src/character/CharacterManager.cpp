#include "CharacterManager.hpp"
#include "CharacterAnimations.hpp"
#include "../core/Paths.hpp"
#include "../core/Log.hpp"
#include <filesystem>
#include <glm/gtc/matrix_transform.hpp>

namespace Bazuko {

namespace {

std::string GetModelFolder(const CharacterLook& look) {
    if (look.sexo == "mujer" && look.edad == "adulto") return "mujer-adulta";
    return look.sexo + "-" + look.edad;
}

} // namespace

CharacterManager::CharacterManager() {
    NormalizeLook(m_Look);
    m_FallbackBody = Mesh::CreateCube(glm::vec3(0.6f, 1.2f, 0.4f), glm::vec4(0.20f, 0.45f, 0.65f, 1.0f));
    m_FallbackHead = Mesh::CreateCube(glm::vec3(0.4f, 0.4f, 0.4f), glm::vec4(0.85f, 0.70f, 0.55f, 1.0f));
}

void CharacterManager::Init(const ModelLoadProgress& modelLoadProgress) {
    std::string animPath = Paths::Find("public/models/animaciones-actionforge.glb");
    if (!std::filesystem::exists(animPath)) {
        animPath = Paths::Find("public/models/animaciones-prueba.glb");
    }
    const size_t partLoadCount = 3 + (m_Look.pelo != "calvo" ? 1 : 0)
        + (m_Look.sexo == "hombre" && m_Look.barba != "ninguna" ? 1 : 0);
    const size_t totalModelLoads = partLoadCount + (animPath.empty() ? 0 : 1);
    size_t completedModelLoads = 0;
    if (!animPath.empty()) {
        m_AnimLibrary = Model::LoadFromFile(animPath);
        if (modelLoadProgress) modelLoadProgress(++completedModelLoads, totalModelLoads);
    }
    ReloadModels([&](size_t completedParts, size_t) {
        if (modelLoadProgress) modelLoadProgress(completedModelLoads + completedParts, totalModelLoads);
    });
}

bool CharacterManager::ApplyLook(const CharacterLook& look, bool forceReload,
                                 const ModelLoadProgress& modelLoadProgress) {
    CharacterLook normalized = look;
    NormalizeLook(normalized);

    const std::string newBodyKey = normalized.sexo + "-" + normalized.edad;
    const bool bodyChanged = (newBodyKey != m_LoadedBodyKey);
    const bool clothesChanged = (normalized.ropa != m_LoadedClothes);
    const bool shoesChanged = (normalized.calzado != m_LoadedShoes);
    const bool hairChanged = (normalized.pelo != m_LoadedHair);
    const bool beardChanged = (normalized.barba != m_LoadedBeard);

    m_Look = normalized;

    if (forceReload || bodyChanged || clothesChanged || shoesChanged || hairChanged || beardChanged) {
        ReloadModels(modelLoadProgress);
        return true;
    }
    return false;
}

void CharacterManager::ReloadModels(const ModelLoadProgress& modelLoadProgress) {
    const std::string bodyKey = m_Look.sexo + "-" + m_Look.edad;
    const std::string basePath = "public/models/personaje/" + GetModelFolder(m_Look) + "/";
    const size_t totalModelLoads = 3 + (m_Look.pelo != "calvo" ? 1 : 0)
        + (m_Look.sexo == "hombre" && m_Look.barba != "ninguna" ? 1 : 0);
    size_t completedModelLoads = 0;
    const auto reportModelLoad = [&]() {
        if (modelLoadProgress) modelLoadProgress(++completedModelLoads, totalModelLoads);
    };

    // 1. Cuerpo
    const std::string cuerpoPath = Paths::Find(basePath + "cuerpo.gltf");
    m_Body = Model::LoadFromFile(cuerpoPath);
    reportModelLoad();
    m_LoadedBodyKey = bodyKey;

    // 2. Ropa
    const std::string ropaPath = Paths::Find(basePath + m_Look.ropa + ".gltf");
    m_Clothes = Model::LoadFromFile(ropaPath);
    reportModelLoad();
    m_LoadedClothes = m_Look.ropa;

    // 3. Calzado
    const std::string shoesPath = Paths::Find(basePath + m_Look.calzado + ".gltf");
    m_Shoes = Model::LoadFromFile(shoesPath);
    reportModelLoad();
    m_LoadedShoes = m_Look.calzado;

    // 4. Pelo (si no es calvo)
    if (m_Look.pelo != "calvo") {
        const std::string hairPath = Paths::Find(basePath + m_Look.pelo + ".gltf");
        m_Hair = Model::LoadFromFile(hairPath);
        reportModelLoad();
    } else {
        m_Hair.reset();
    }
    m_LoadedHair = m_Look.pelo;

    // 5. Barba (solo si es hombre y no es ninguna)
    if (m_Look.sexo == "hombre" && m_Look.barba != "ninguna") {
        const std::string beardPath = Paths::Find(basePath + m_Look.barba + ".gltf");
        m_Beard = Model::LoadFromFile(beardPath);
        reportModelLoad();
    } else {
        m_Beard.reset();
    }
    m_LoadedBeard = m_Look.barba;

    // Conectar animaciones del esqueleto
    if (m_AnimLibrary) {
        for (const auto& part : {m_Body, m_Clothes, m_Shoes, m_Hair, m_Beard}) {
            if (part) part->SetAnimationSource(*m_AnimLibrary, CharacterAnimationAliases());
        }
    }

    if (m_Body) {
        m_WalkClip = m_Body->FindAnimationClip("Walk");
        m_RunClip = m_Body->FindAnimationClip("Run");
        m_IdleClip = m_Body->FindAnimationClip("Idle");
        m_SearchClip = m_Body->FindAnimationClip("Search");
        m_CrouchClip = m_Body->FindAnimationClip("Crouch");
    } else {
        m_WalkClip = -1;
        m_RunClip = -1;
        m_IdleClip = -1;
        m_SearchClip = -1;
        m_CrouchClip = -1;
    }

    LogInfo("Personaje cargado: [{}] Origen: {} ({}-{}) Ropa: {} Pelo: {} Barba: {}",
            m_Look.nombre, m_Look.origen, m_Look.sexo, m_Look.edad,
            m_Look.ropa, m_Look.pelo, m_Look.barba);
}

void CharacterManager::Draw(Renderer& renderer, const glm::mat4& playerTransform, float animTime,
                            bool moving, bool isRunning, int animationClipOverride) {
    if (m_Body) {
        glm::mat4 mScale = glm::scale(playerTransform, glm::vec3(1.08f));
        const int defaultClip = moving ? (isRunning && m_RunClip >= 0 ? m_RunClip : m_WalkClip) : m_IdleClip;
        const int clip = animationClipOverride >= 0 ? animationClipOverride : defaultClip;
        const bool animate = (clip >= 0);

        const glm::vec4 skinTint = SkinPalettes[m_Look.pielIdx];
        const glm::vec4 clothesTint = ClothingPalettes[m_Look.ropaColorIdx];
        const glm::vec4 shoesTint = ShoePalettes[m_Look.calzadoColorIdx];
        const glm::vec4 hairTint = HairPalettes[m_Look.peloColorIdx];

        m_Body->Draw(renderer, mScale, skinTint, animTime, animate, clip);
        if (m_Clothes) m_Clothes->Draw(renderer, mScale, clothesTint, animTime, animate, clip);
        if (m_Shoes)   m_Shoes->Draw(renderer, mScale, shoesTint, animTime, animate, clip);
        if (m_Hair)    m_Hair->Draw(renderer, mScale, hairTint, animTime, animate, clip);
        if (m_Beard)   m_Beard->Draw(renderer, mScale, hairTint, animTime, animate, clip);
    } else {
        // Fallback procedural
        glm::mat4 bodyModel = glm::translate(playerTransform, glm::vec3(0.0f, 0.6f, 0.0f));
        renderer.Submit(*m_FallbackBody, bodyModel);

        glm::mat4 headModel = glm::translate(playerTransform, glm::vec3(0.0f, 1.4f, 0.0f));
        renderer.Submit(*m_FallbackHead, headModel);
    }
}

const OriginOption& CharacterManager::GetOriginInfo() const {
    for (const auto& o : Origins) {
        if (o.id == m_Look.origen) return o;
    }
    return Origins[0];
}

int CharacterManager::GetExtraLoot() const {
    return GetOriginInfo().extraLoot;
}

float CharacterManager::GetDiseaseResistance() const {
    return GetOriginInfo().diseaseResist;
}

float CharacterManager::GetBegMultiplier() const {
    return GetOriginInfo().begMult;
}

float CharacterManager::GetSellMultiplier() const {
    return GetOriginInfo().sellMult;
}

void CharacterManager::Serialize(nlohmann::json& state) const {
    state["character"] = m_Look;
}

bool CharacterManager::Deserialize(const nlohmann::json& state, const ModelLoadProgress& modelLoadProgress) {
    if (state.contains("character") && state["character"].is_object()) {
        try {
            CharacterLook loaded = state["character"].get<CharacterLook>();
            ApplyLook(loaded, true, modelLoadProgress);
            return true;
        } catch (const std::exception& e) {
            LogWarn("Error leyendo personaje de guardado: {}", e.what());
        }
    }
    return false;
}

} // namespace Bazuko
