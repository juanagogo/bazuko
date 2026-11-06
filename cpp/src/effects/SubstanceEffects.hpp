#pragma once
// Efectos de consumo (port de src/systems/SubstanceEffects.js y src/data/substanceEffects.js): lo que se ve al consumir pegante, pastilla, hierba o basuco.
// La duracion avanza con la simulacion; los desvanecidos de cortes y reemplazos, con el tiempo real, porque la escena se sigue dibujando en pausa y un corte
// instantaneo se veria. Ninguna oscilacion de color o brillo supera ~0,5 Hz: nada de destellos. Sin dibujo: devuelve el `SubstanceLook` del cuadro.
#include "../renderer/SubstanceLook.hpp"

#include <string>
#include <vector>

namespace Bazuko {

constexpr float kEffectFadeIn = 3.0f;    // s de subida de un efecto nuevo
constexpr float kEffectFadeOut = 6.0f;   // s de bajada al final de su duracion
constexpr float kEffectCutFade = 1.0f;   // s reales de desvanecido en cortes y reemplazos

struct SubstanceRecipe {
    const char* id;
    float seconds;
    // camara: fov (grados), giro (rad) y frecuencia (Hz)
    float cameraFov, cameraRoll, cameraHz;
    // estela
    float trailKeep, trailOpacity, trailSway, trailBreathe;
    // paranoia (basuco): segundos y severidad de las alucinaciones; 0 = ninguna
    float paranoiaSeconds, paranoiaSeverity;
};
const SubstanceRecipe* FindSubstanceRecipe(const std::string& id);

class SubstanceEffects {
public:
    // Lo que el cuadro dibuja: el filtro, la capa y la estela, y lo que se mueve la camara (se suma a lo de la psicosis)
    struct Frame {
        SubstanceLook look;
        float cameraFovDegrees = 0.0f;
        float cameraRollRadians = 0.0f;
        float intensity = 0.0f;
    };
    // Consumo reciente: avisa a la psicosis si la sustancia da paranoia (basuco)
    struct Consumed { bool known = false; float paranoiaSeconds = 0.0f, paranoiaSeverity = 0.0f; };

    // `calm`: 1, o 0,2 con movimiento reducido (baja camara y estela al 20 %)
    explicit SubstanceEffects(float calm = 1.0f) : m_Calm(calm) {}

    // Lo que el sonido tiene que hacer (SubstanceAudio): el sonido de consumir, y arrancar o soltar la capa sostenida del efecto
    struct SoundEvent { enum class Kind { Onset, StartSustain, StopSustain } kind; std::string id; };
    std::vector<SoundEvent> ConsumeSoundEvents() const { std::vector<SoundEvent> out; out.swap(m_Sound); return out; }

    Consumed Consume(const std::string& id, double nowSeconds);   // false (known) si no tiene efecto (p. ej. tintico)
    void Update(float dt);                                        // solo en cuadros sin pausa
    void End(double nowSeconds);                                  // corte forzado (dormir, morir, recuperarse): se desvanece, nunca de golpe
    Frame BeforeRender(double nowSeconds, bool lowQuality) const;
    bool Active(double nowSeconds) const;
    float Intensity(double nowSeconds) const;
    const std::string& CurrentId(double nowSeconds) const;

private:
    struct Running { std::string id; const SubstanceRecipe* recipe = nullptr; float elapsed = 0.0f, phase = 0.0f, intensity = 0.0f; };
    struct Fading { std::string id; const SubstanceRecipe* recipe = nullptr; float from = 0.0f; double start = 0.0; float t = 0.0f; };
    void Advance(double nowSeconds) const;
    void Start(const std::string& id);
    void FadeOut(double nowSeconds);

    float m_Calm;
    mutable bool m_HasEffect = false, m_HasFade = false;
    mutable Running m_Effect;
    mutable Fading m_Fade;
    mutable std::string m_Queued;
    mutable std::vector<SoundEvent> m_Sound;
    static const std::string kNone;
};

} // namespace Bazuko
