#pragma once

#include <memory>
#include <glm/glm.hpp>
#include "RadioSynth.hpp"

namespace Bazuko {

class Simulation;

// Categorias de la mezcla (volumen propio de cada una, como en el juego web)
enum class MixCategory { Ambient = 0, Traffic, Voices, Effects };

enum class AudioCue {
    Pickup,
    Treasure,
    Sell,
    Full,
    Empty
};

class AudioManager {
public:
    AudioManager();
    ~AudioManager();

    AudioManager(const AudioManager&) = delete;
    AudioManager& operator=(const AudioManager&) = delete;

    bool IsReady() const;
    bool IsMuted() const;
    void SetMuted(bool muted);
    float GetVolume() const;
    void SetVolume(float volume);
    // El volumen del bucle de lluvia sigue su intensidad (0..1)
    void SetRaining(bool raining, float intensity = 1.0f);
    void Play(AudioCue cue);
    void PlayCarAlarm(float distance);
    void PlayTheftRemark(float distance);
    // Latido doble (dos golpes graves que caen de 65 a 28 Hz); `intensity` 0..1 sube el volumen
    void PlayHeartbeat(float intensity);
    // Radio transistor: sintesis en vivo (ver RadioSynth). `signal` 0..1; `volume` es el de la propia radio.
    void UpdateRadio(bool on, RadioProgram program, float signal, float volume);
    // Volumen 0..1 de cada categoria (ambiente, trafico, voces, efectos); se multiplica por el maestro
    float GetMix(MixCategory category) const;
    void SetMix(MixCategory category, float level);
    // surface: 0 anden/piso/plaza, 1 calzada, 2 tierra o pasto (los pasos suenan mas suaves y lentos sobre tierra y pasto).
    // Las pisadas suenan cada cierta distancia recorrida (`travelled`, metros en este cuadro; negativo = estimar con la velocidad nominal).
    void Update(bool moving, bool running, int surface = 0, bool raining = false, float travelled = -1.0f, float dt = 1.0f / 60.0f);
    void UpdateVehicleAudio(float dt, const glm::vec3& listenerPosition,
                            const Simulation& simulation, bool paused);

private:
    struct Impl;
    std::unique_ptr<Impl> m_Impl;
};

} // namespace Bazuko
