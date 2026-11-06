#pragma once
// Sonidos de los efectos de consumo (port de src/systems/SubstanceAudio.js): sintetizados como en el original con osciladores, ruido, filtros y envolventes.
// `onset` es lo que suena al consumir (un sonido corto, se prepara entero) y `sustain` acompana el efecto mientras dura (se genera en vivo, sin fin).
// Aqui solo esta la sintesis (sin miniaudio): AudioManager la reproduce, le pone el volumen del efecto y, con el pegante, cierra los agudos de todo lo demas.
#include <cstddef>
#include <cstdint>
#include <memory>
#include <random>
#include <string>
#include <vector>

namespace Bazuko {

constexpr float kSubstanceOnsetGap = 0.25f;      // s: consumir varias veces seguidas no apila el sonido
constexpr float kSubstanceOnsetLength = 2.5f;    // s: el sonido de consumir mas largo (inhalar hierba) dura 2,4 s
constexpr float kMuffleOpenHz = 20000.0f;        // sin filtro audible
constexpr float kMuffleClosedHz = 700.0f;        // la ciudad «bajo el agua» con el pegante al maximo

bool SubstanceHasSound(const std::string& id);
// Frecuencia de corte del filtro que cierra los agudos del juego con esta intensidad (0..1): 20000 * (700 / 20000) ^ intensidad
float SubstanceMuffleHz(float intensity);
// El sonido de consumir de `id`, en mono a `sampleRate` (vacio si no tiene)
std::vector<float> RenderSubstanceOnset(const std::string& id, float sampleRate, uint32_t seed);

// La capa que acompana el efecto: se pide por bloques desde el hilo de audio; la intensidad la pone quien la reproduce (volumen)
class SubstanceSustain {
public:
    SubstanceSustain(const std::string& id, float sampleRate, uint32_t seed);
    ~SubstanceSustain();
    void Render(float* out, size_t frames);
    bool Valid() const;
    bool WantsMuffle() const;   // el pegante cierra ademas los agudos del resto del juego

private:
    struct Impl;
    std::unique_ptr<Impl> m_Impl;
};

} // namespace Bazuko
