#pragma once
// Radio transistor AM/FM: sintesis lo-fi bogotana de cada emisora, igual que RadioSystem.js del juego web
// (notas cada 180 ms, ruido estatico segun la senal y filtro pasa banda de altavoz pequeno).
// Los parametros son atomicos: la ventana los cambia y el hilo de audio llama a Render().
#include <atomic>
#include <cstddef>
#include <cstdint>
#include <random>
#include <string>
#include <vector>

namespace Bazuko {

enum class RadioProgram { None = 0, Recuerdos, Noticias, Deportes, Rock };

// Emisora de la sintesis a partir del id de assets/radio_stations.json (None si no tiene melodia).
RadioProgram RadioProgramFromId(const std::string& id);

class RadioSynth {
public:
    explicit RadioSynth(float sampleRate = 48000.0f, uint32_t seed = 1);

    void SetOn(bool on) { m_On.store(on); }
    void SetStation(RadioProgram station) { m_Station.store(static_cast<int>(station)); }
    void SetSignal(float signal) { m_Signal.store(signal); }   // 0 = solo estatica, 1 = sintonia perfecta
    void SetVolume(float volume) { m_Volume.store(volume); }   // volumen propio de la radio (0..1)
    bool IsOn() const { return m_On.load(); }
    float Volume() const { return m_Volume.load(); }

    // Genera `frames` muestras mono. Con la radio apagada escribe silencio.
    void Render(float* out, size_t frames);

private:
    enum class Wave { Sine, Triangle, Sawtooth };
    struct Voice {
        float frequency = 0.0f;
        float duration = 0.0f;      // s
        float gain = 0.0f;
        Wave wave = Wave::Sine;
        long delaySamples = 0;      // espera antes de sonar
        long age = 0;               // muestras sonadas
        float phase = 0.0f;
    };

    void PlayStep(int step);
    void Note(float frequency, float duration, float gain, Wave wave, float startSeconds);
    float NextVoiceSample();
    float Bandpass(float input);

    float m_SampleRate;
    std::atomic<bool> m_On{false};
    std::atomic<int> m_Station{0};
    std::atomic<float> m_Signal{1.0f};
    std::atomic<float> m_Volume{0.7f};
    std::vector<Voice> m_Voices;
    std::mt19937 m_Random;
    long m_StepCounter = 0;
    long m_StepLength;
    int m_Step = 0;
    float m_StaticLevel = 0.0f;
    // Biquad pasa banda (1450 Hz, Q 1,1)
    float m_B0 = 0, m_B2 = 0, m_A1 = 0, m_A2 = 0;
    float m_X1 = 0, m_X2 = 0, m_Y1 = 0, m_Y2 = 0;
};

} // namespace Bazuko
