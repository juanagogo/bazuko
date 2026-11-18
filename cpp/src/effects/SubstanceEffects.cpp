#include "SubstanceEffects.hpp"

#include <algorithm>
#include <array>
#include <cmath>

namespace Bazuko {

const std::string SubstanceEffects::kNone;

namespace {
constexpr float kTau = 6.2831853f;
float Clamp01(float v) { return std::min(1.0f, std::max(0.0f, v)); }

// Las recetas de src/data/substanceEffects.js: `seconds`, camara {fov, roll, hz}, estela {keep, opacity, sway, breathe} y paranoia {seconds, severity}
const std::array<SubstanceRecipe, 4> kRecipes{{
    {"pastilla", 45.0f, 4.0f, 0.02f, 0.25f, 0.82f, 0.5f, 0.0f, 0.025f, 0.0f, 0.0f},
    {"pegante", 35.0f, 6.0f, 0.07f, 0.32f, 0.9f, 0.6f, 14.0f, 0.01f, 0.0f, 0.0f},
    {"hierba", 60.0f, 3.0f, 0.008f, 0.12f, 0.7f, 0.3f, 0.0f, 0.008f, 0.0f, 0.0f},
    {"basuco", 40.0f, 5.0f, 0.015f, 0.45f, 0.6f, 0.35f, 6.0f, 0.012f, 50.0f, 0.8f},
}};

// filtro y capa de cada receta (`filter(i, t)` y `overlay(i, t)` del original)
void Visual(const std::string& id, float i, float t, SubstanceLook& look) {
    if (id == "pastilla") {   // euforia de colores: el tono oscila despacio y la imagen «respira»
        look.hueDegrees = 160.0f * i * std::sin(t * 0.35f); look.saturate = 1.0f + 1.3f * i; look.contrast = 1.0f + 0.12f * i;
        look.overlay = 1; look.overlayOpacity = 0.32f * i; look.overlayAngleDegrees = std::fmod(t * 25.0f, 360.0f);
    } else if (id == "pegante") {   // mareo: borroso, verdoso, bordes oscuros y vision doble que se balancea
        look.blurPx = 1.6f * i; look.sepia = 0.35f * i; look.hueDegrees = 55.0f * i; look.saturate = 1.0f - 0.25f * i; look.brightness = 1.0f - 0.08f * i;
        look.overlay = 2; look.overlayOpacity = 0.7f * i;
    } else if (id == "hierba") {   // calido y lento: tonos dorados, brillo suave al centro
        look.sepia = 0.4f * i; look.saturate = 1.0f + 0.35f * i; look.brightness = 1.0f + 0.06f * i; look.contrast = 1.0f - 0.06f * i;
        look.overlay = 3; look.overlayOpacity = 0.8f * i;
    } else if (id == "basuco") {   // subidon paranoico: frio, duro, vision de tunel con un pulso rojizo lento en los bordes
        look.contrast = 1.0f + 0.35f * i; look.saturate = 1.0f - 0.45f * i; look.brightness = 1.0f - 0.1f * i; look.hueDegrees = -12.0f * i;
        look.overlay = 4; look.overlayOpacity = 0.85f * i; look.overlayStop = 30.0f - 6.0f * std::sin(t * 2.6f);
    }
}
}

const SubstanceRecipe* FindSubstanceRecipe(const std::string& id) {
    for (const SubstanceRecipe& recipe : kRecipes) if (id == recipe.id) return &recipe;
    return nullptr;
}

void SubstanceEffects::Advance(double now) const {
    if (!m_HasFade || now - m_Fade.start < kEffectCutFade) return;
    m_HasFade = false;
    m_Sound.push_back({SoundEvent::Kind::StopSustain, ""});
    const std::string next = m_Queued;
    m_Queued.clear();
    if (!next.empty()) const_cast<SubstanceEffects*>(this)->Start(next);
}

void SubstanceEffects::Start(const std::string& id) {
    m_Effect = Running{id, FindSubstanceRecipe(id), 0.0f, 0.0f, 0.0f};
    m_HasEffect = true;
    m_Sound.push_back({SoundEvent::Kind::StartSustain, id});
}

void SubstanceEffects::FadeOut(double now) {
    if (!m_HasEffect) return;
    m_Fade = Fading{m_Effect.id, m_Effect.recipe, m_Effect.intensity, now, m_Effect.phase};
    m_HasFade = true; m_HasEffect = false;
}

SubstanceEffects::Consumed SubstanceEffects::Consume(const std::string& id, double now) {
    Consumed out;
    const SubstanceRecipe* recipe = FindSubstanceRecipe(id);
    if (!recipe) return out;
    out.known = true; out.paranoiaSeconds = recipe->paranoiaSeconds; out.paranoiaSeverity = recipe->paranoiaSeverity;
    Advance(now);
    m_Sound.push_back({SoundEvent::Kind::Onset, id});
    if (m_HasEffect && m_Effect.id == id) {
        m_Effect.elapsed = 0.0f;   // misma sustancia: renueva la duracion sin bajar la intensidad
    } else if (m_HasEffect || m_HasFade) {
        FadeOut(now);
        m_Queued = id;
    } else {
        Start(id);
    }
    return out;
}

void SubstanceEffects::Update(float dt) {
    if (!m_HasEffect) return;
    m_Effect.elapsed += dt;
    m_Effect.phase += dt;
    if (m_Effect.elapsed >= m_Effect.recipe->seconds) {
        m_HasEffect = false;
        m_Sound.push_back({SoundEvent::Kind::StopSustain, ""});
        return;
    }
    m_Effect.intensity = std::min(m_Effect.intensity + dt / kEffectFadeIn, Clamp01((m_Effect.recipe->seconds - m_Effect.elapsed) / kEffectFadeOut));
}

void SubstanceEffects::End(double now) {
    Advance(now);
    m_Queued.clear();
    FadeOut(now);
}

bool SubstanceEffects::Active(double now) const { Advance(now); return m_HasEffect || m_HasFade; }
const std::string& SubstanceEffects::CurrentId(double now) const { Advance(now); return m_HasFade ? m_Fade.id : m_HasEffect ? m_Effect.id : kNone; }

float SubstanceEffects::Intensity(double now) const {
    Advance(now);
    if (m_HasFade) return m_Fade.from * Clamp01(1.0f - static_cast<float>(now - m_Fade.start) / kEffectCutFade);
    return m_HasEffect ? m_Effect.intensity : 0.0f;
}

SubstanceEffects::Frame SubstanceEffects::BeforeRender(double now, bool lowQuality) const {
    Frame frame;
    Advance(now);
    const SubstanceRecipe* recipe = nullptr; std::string id; float t = 0.0f;
    if (m_HasFade) { recipe = m_Fade.recipe; id = m_Fade.id; t = m_Fade.t + static_cast<float>(now - m_Fade.start); }
    else if (m_HasEffect) { recipe = m_Effect.recipe; id = m_Effect.id; t = m_Effect.phase; }
    const float i = Intensity(now);
    if (!recipe || i <= 0.0f) return frame;
    frame.intensity = i;
    SubstanceLook& look = frame.look;
    look.active = true;
    Visual(id, i, t, look);
    if (lowQuality) look.blurPx = 0.0f;   // en calidad baja se omite el desenfoque, el mas costoso
    const float w = kTau * recipe->cameraHz * t;
    look.trail = !lowQuality;
    look.trailKeep = recipe->trailKeep;
    look.trailOpacity = lowQuality ? 0.0f : recipe->trailOpacity * i * m_Calm;
    look.trailShiftPx = recipe->trailSway * i * m_Calm * std::sin(w * 0.6f);
    look.trailScale = 1.0f + recipe->trailBreathe * i * m_Calm * (1.0f + std::sin(w));
    frame.cameraFovDegrees = recipe->cameraFov * i * m_Calm * std::sin(w);
    frame.cameraRollRadians = recipe->cameraRoll * i * m_Calm * std::sin(w * 0.8f + 1.0f);
    return frame;
}

} // namespace Bazuko
