#pragma once

#include <memory>
#include <string>

namespace bazuko {

struct AudioOptions {
    std::string dir;             // carpeta con pickup.wav, treasure.wav, sell.wav, full.wav, empty.wav, steps.wav, boost.wav, ambient.wav
    bool nullBackend = false;    // sin dispositivo real (pruebas y entornos sin audio)
    double masterVolume = 0.7;
};

// Efectos y ambiente (AudioSystem.js sobre miniaudio). El audio es opcional: sin dispositivo, o con archivos
// ausentes o ilegibles, todas las operaciones son inofensivas y el juego sigue en silencio.
class AudioEngine {
public:
    explicit AudioEngine(const AudioOptions& options);
    ~AudioEngine();
    AudioEngine(const AudioEngine&) = delete;
    AudioEngine& operator=(const AudioEngine&) = delete;

    bool enabled() const;           // hay dispositivo de salida
    int loaded() const;             // sonidos cargados
    bool has(const std::string& name) const;
    bool playing(const std::string& name) const;

    // Efecto corto: si ya suena no se reinicia (como Howl en el juego web).
    void play(const std::string& name);
    void stop(const std::string& name);
    // Pasos en bucle: a 1,4× al correr, 1× al caminar; se detienen al parar.
    void updateSteps(bool moving, bool running);
    void updateBoost(bool active);
    void startAmbient();

    bool stepsPlaying() const;
    double stepsRate() const;
    bool ambientStarted() const;
    void setMasterVolume(double v);

private:
    struct Impl;
    std::unique_ptr<Impl> impl_;
};

}  // namespace bazuko
