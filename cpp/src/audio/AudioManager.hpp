#pragma once

#include <memory>
#include <glm/glm.hpp>

namespace Bazuko {

class Simulation;

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
    void SetRaining(bool raining);
    void Play(AudioCue cue);
    void PlayCarAlarm(float distance);
    void PlayTheftRemark(float distance);
    void Update(bool moving, bool running);
    void UpdateVehicleAudio(float dt, const glm::vec3& listenerPosition,
                            const Simulation& simulation, bool paused);

private:
    struct Impl;
    std::unique_ptr<Impl> m_Impl;
};

} // namespace Bazuko
