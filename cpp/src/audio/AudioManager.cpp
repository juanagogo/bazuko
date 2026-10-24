#define MINIAUDIO_IMPLEMENTATION
#include <miniaudio.h>
#include <opusfile.h>

#include "AudioManager.hpp"
#include "../world/Simulation.hpp"

#include <array>
#include <algorithm>
#include <cmath>
#include <filesystem>
#include "../core/Paths.hpp"
#include <glm/gtc/constants.hpp>
#include <iostream>
#include <random>
#include <string>
#include <vector>

namespace Bazuko {

namespace {

enum class SoundSlot : size_t {
    Pickup,
    Treasure,
    Sell,
    Full,
    Empty,
    Steps,
    Ambient,
    Rain,
    Count
};

std::string FindAudioPath(const char* filename) {
    const std::array<std::filesystem::path, 6> candidates{
        std::filesystem::path(Paths::Find((std::filesystem::path("public/audio") / filename).generic_string())),
        std::filesystem::path("public/audio") / filename,
        std::filesystem::path("../public/audio") / filename,
        std::filesystem::path("../../public/audio") / filename,
        std::filesystem::path("assets/audio") / filename,
        std::filesystem::path("audio") / filename
    };
    for (const auto& path : candidates) {
        if (std::filesystem::exists(path)) return path.string();
    }
    return {};
}

} // namespace

struct AudioManager::Impl {
    struct Sound {
        ma_sound value{};
        ma_audio_buffer buffer{};
        std::vector<float> samples;
        bool initialized = false;
        bool bufferInitialized = false;
        const std::vector<float>* sampleSource = nullptr;
    };

    struct VehicleChannel {
        Sound idle;
        Sound drive;
        float blockedFor = 0.0f;
        float hornCooldown = 0.0f;
        float patience = 0.0f;
        bool started = false;
    };

    static constexpr size_t MaxTrafficAudio = 8;
    static constexpr float VehicleHearingDistance = 55.0f;
    ma_engine engine{};
    bool ready = false;
    bool muted = false;
    float masterVolume = 0.7f;
    bool stepsPlaying = false;
    bool raining = false;
    std::array<Sound, static_cast<size_t>(SoundSlot::Count)> sounds{};
    std::array<std::vector<float>, 4> vehicleAudioSamples{};
    std::array<VehicleChannel, MaxTrafficAudio + 1> vehicleChannels{};
    std::array<Sound, 3> horns{};
    Sound carAlarm;
    std::array<Sound, 12> driverVoices{};
    std::array<Sound, 5> theftVoices{};
    std::mt19937 random{std::random_device{}()};

    Impl() {
        const ma_result result = ma_engine_init(nullptr, &engine);
        if (result != MA_SUCCESS) {
            std::cerr << "Audio: no se pudo inicializar el dispositivo: " << ma_result_description(result) << '\n';
            return;
        }
        ready = true;
        ma_engine_set_volume(&engine, masterVolume);

        const std::array<std::pair<SoundSlot, const char*>, static_cast<size_t>(SoundSlot::Count)> files{{
            {SoundSlot::Pickup, "pickup.wav"},
            {SoundSlot::Treasure, "treasure.wav"},
            {SoundSlot::Sell, "sell.wav"},
            {SoundSlot::Full, "full.wav"},
            {SoundSlot::Empty, "empty.wav"},
            {SoundSlot::Steps, "steps.wav"},
            {SoundSlot::Ambient, "ambient.wav"},
            {SoundSlot::Rain, "rain_sound_01.mp3"}
        }};
        for (const auto& [slot, filename] : files) {
            const std::string path = FindAudioPath(filename);
            if (path.empty()) {
                std::cerr << "Audio: no se encontro public/audio/" << filename << '\n';
                continue;
            }
            Sound& sound = sounds[static_cast<size_t>(slot)];
            const ma_result loadResult = ma_sound_init_from_file(&engine, path.c_str(), MA_SOUND_FLAG_DECODE, nullptr, nullptr, &sound.value);
            if (loadResult != MA_SUCCESS) {
                std::cerr << "Audio: no se pudo cargar " << path << ": " << ma_result_description(loadResult) << '\n';
                continue;
            }
            sound.initialized = true;
        }

        ReplaceWithOpusSound(SoundSlot::Steps, "Sounds_of_a_steps.opus", true);
        ReplaceWithOpusSound(SoundSlot::Ambient, "city_atmosphere_soun.opus", true);

        const std::array<float, static_cast<size_t>(SoundSlot::Count)> volumes{0.6f, 0.9f, 0.8f, 0.5f, 0.4f, 0.5f, 0.25f, 0.45f};
        for (size_t index = 0; index < sounds.size(); ++index) {
            if (sounds[index].initialized) ma_sound_set_volume(&sounds[index].value, volumes[index]);
        }

        Sound& steps = sounds[static_cast<size_t>(SoundSlot::Steps)];
        if (steps.initialized) ma_sound_set_looping(&steps.value, MA_TRUE);
        Sound& ambient = sounds[static_cast<size_t>(SoundSlot::Ambient)];
        if (ambient.initialized) {
            ma_sound_set_looping(&ambient.value, MA_TRUE);
            ma_sound_set_volume(&ambient.value, 0.25f);
            ma_sound_start(&ambient.value);
        }
        Sound& rain = sounds[static_cast<size_t>(SoundSlot::Rain)];
        if (rain.initialized) ma_sound_set_looping(&rain.value, MA_TRUE);

        const std::array<const char*, 3> hornFiles{{
            "car_horn_sound1.opus", "car_horn_sound.opus", "car_horn_sound_v3.opus"
        }};
        const std::array<int, 3> hornStartMs{{900, 1000, 200}};
        const std::array<int, 3> hornDurationMs{{550, 600, 650}};
        for (size_t i = 0; i < horns.size(); ++i) {
            if (!LoadOpusSound(horns[i], hornFiles[i], false, hornStartMs[i], hornDurationMs[i])) {
                InitializeGeneratedSound(horns[i], 480.0f + static_cast<float>(i) * 50.0f, false, false);
            }
        }
        LoadOpusSound(carAlarm, "Sonido De Alarma De Auto.opus", false);
        const std::array<const char*, 12> driverFiles{{
            "valentina_n1.mp3", "valentina_n3.mp3", "valentina_n4.mp3", "valentina_n5.mp3",
            "valentina_n6.mp3", "valentina_n7.mp3", "roberto_n1.mp3", "roberto_n2.mp3",
            "roberto_n3.mp3", "roberto_n4.mp3", "roberto_n5.mp3", "roberto_n6.mp3"
        }};
        for (size_t i = 0; i < driverFiles.size(); ++i) LoadOptionalSound(driverVoices[i], driverFiles[i]);
        for (size_t i = 0; i < theftVoices.size(); ++i) {
            const std::string filename = "roberto_robo_espejo_n" + std::to_string(i + 1) + ".mp3";
            LoadOptionalSound(theftVoices[i], filename.c_str());
        }
        for (size_t i = 0; i < vehicleChannels.size(); ++i) {
            const bool bus = i == MaxTrafficAudio;
            const char* idleFile = bus ? "car_idling_at_a_traf_bus.opus" : "car_idling_at_a_traf.opus";
            const char* driveFile = bus ? "bus_vehicle_drivin.opus" : "small_vehicle_drivin.opus";
            const size_t idleCache = bus ? 2 : 0;
            const size_t driveCache = bus ? 3 : 1;
            if (!LoadOpusSound(vehicleChannels[i].idle, idleFile, true, 0, 0,
                               &vehicleAudioSamples[idleCache])) {
                InitializeGeneratedSound(vehicleChannels[i].idle, bus ? 39.0f : 48.0f, true, true);
            }
            if (!LoadOpusSound(vehicleChannels[i].drive, driveFile, true, 0, 0,
                               &vehicleAudioSamples[driveCache])) {
                InitializeGeneratedSound(vehicleChannels[i].drive, bus ? 57.0f : 68.0f, true, true);
            }
            std::uniform_real_distribution<float> patienceRange(0.7f, 1.5f);
            vehicleChannels[i].patience = patienceRange(random);
        }
    }

    void LoadOptionalSound(Sound& sound, const char* filename) {
        const std::string path = FindAudioPath(filename);
        if (path.empty()) {
            std::cerr << "Audio: no se encontro public/audio/" << filename << '\n';
            return;
        }
        const ma_result result = ma_sound_init_from_file(&engine, path.c_str(), MA_SOUND_FLAG_DECODE,
                                                          nullptr, nullptr, &sound.value);
        if (result != MA_SUCCESS) {
            std::cerr << "Audio: no se pudo cargar " << path << ": " << ma_result_description(result) << '\n';
            return;
        }
        sound.initialized = true;
    }

    bool LoadOpusSound(Sound& sound, const char* filename, bool loop,
                       int startMilliseconds = 0, int durationMilliseconds = 0,
                       std::vector<float>* sharedSamples = nullptr) {
        if (sharedSamples && !sharedSamples->empty()) {
            sound.sampleSource = sharedSamples;
            return InitializeOpusBuffer(sound, *sharedSamples, loop, true);
        }
        const std::string path = FindAudioPath(filename);
        if (path.empty()) {
            std::cerr << "Audio: no se encontro public/audio/" << filename << '\n';
            return false;
        }
        int error = 0;
        OggOpusFile* opus = op_open_file(path.c_str(), &error);
        if (!opus) {
            std::cerr << "Audio: no se pudo decodificar " << path << " (Opus error "
                      << error << ")\n";
            return false;
        }
        constexpr ogg_int64_t sampleRate = 48000;
        constexpr ogg_int64_t maximumFrames = sampleRate * 60 * 3;
        const ogg_int64_t startFrame = static_cast<ogg_int64_t>(startMilliseconds) * sampleRate / 1000;
        const ogg_int64_t desiredFrames = durationMilliseconds > 0
            ? static_cast<ogg_int64_t>(durationMilliseconds) * sampleRate / 1000
            : maximumFrames;
        if (startFrame > 0 && op_pcm_seek(opus, startFrame) != 0) {
            std::cerr << "Audio: no se pudo buscar el segmento Opus en " << path << '\n';
            op_free(opus);
            return false;
        }

        std::vector<float> decoded;
        std::array<float, 16384> chunk{};
        ogg_int64_t decodedFrames = 0;
        bool decodeFailed = false;
        while (decodedFrames < desiredFrames) {
            const int frames = op_read_float_stereo(opus, chunk.data(), static_cast<int>(chunk.size()));
            if (frames == 0) break;
            if (frames < 0) {
                decodeFailed = true;
                break;
            }
            const ogg_int64_t available = std::min<ogg_int64_t>(frames, desiredFrames - decodedFrames);
            decoded.insert(decoded.end(), chunk.begin(), chunk.begin() + static_cast<std::ptrdiff_t>(available * 2));
            decodedFrames += available;
        }
        op_free(opus);
        if (decodeFailed || decoded.empty()) {
            std::cerr << "Audio: el archivo Opus esta incompleto o no contiene audio: " << path << '\n';
            return false;
        }

        std::vector<float>* sampleOwner = sharedSamples ? sharedSamples : &sound.samples;
        *sampleOwner = std::move(decoded);
        sound.sampleSource = sampleOwner;
        return InitializeOpusBuffer(sound, *sampleOwner, loop, false);
    }

    bool InitializeOpusBuffer(Sound& sound, const std::vector<float>& samples, bool loop,
                              bool sharedSamples) {
        constexpr ma_uint32 sampleRate = 48000;
        if (samples.empty() || samples.size() % 2 != 0) return false;
        ma_audio_buffer_config config = ma_audio_buffer_config_init(ma_format_f32, 2,
                                                                      samples.size() / 2,
                                                                      samples.data(), nullptr);
        config.sampleRate = static_cast<ma_uint32>(sampleRate);
        ma_result result = ma_audio_buffer_init(&config, &sound.buffer);
        if (result != MA_SUCCESS) {
            std::cerr << "Audio: no se pudo crear un buffer Opus: "
                      << ma_result_description(result) << '\n';
            return false;
        }
        sound.bufferInitialized = true;
        result = ma_sound_init_from_data_source(&engine, reinterpret_cast<ma_data_source*>(&sound.buffer),
                                                0, nullptr, &sound.value);
        if (result != MA_SUCCESS) {
            std::cerr << "Audio: no se pudo iniciar un buffer Opus: " << ma_result_description(result) << '\n';
            ma_audio_buffer_uninit(&sound.buffer);
            sound.bufferInitialized = false;
            if (!sharedSamples) {
                sound.samples.clear();
                sound.sampleSource = nullptr;
            }
            return false;
        }
        sound.initialized = true;
        if (loop) ma_sound_set_looping(&sound.value, MA_TRUE);
        return true;
    }

    void ReplaceWithOpusSound(SoundSlot slot, const char* filename, bool loop) {
        Sound& sound = sounds[static_cast<size_t>(slot)];
        if (sound.initialized) {
            ma_sound_uninit(&sound.value);
            sound.initialized = false;
        }
        if (!LoadOpusSound(sound, filename, loop)) {
            const char* fallback = slot == SoundSlot::Steps ? "steps.wav" : "ambient.wav";
            LoadOptionalSound(sound, fallback);
            if (sound.initialized && loop) ma_sound_set_looping(&sound.value, MA_TRUE);
        }
    }

    void InitializeGeneratedSound(Sound& sound, float frequency, bool loop, bool engineTone) {
        constexpr ma_uint32 sampleRate = 44100;
        const size_t frameCount = loop ? sampleRate * 2 : sampleRate * 3 / 5;
        sound.samples.resize(frameCount);
        for (size_t i = 0; i < frameCount; ++i) {
            const float time = static_cast<float>(i) / sampleRate;
            float value = 0.0f;
            if (engineTone) {
                const float fundamental = std::sin(glm::two_pi<float>() * frequency * time);
                value = (fundamental + 0.38f * std::sin(glm::two_pi<float>() * frequency * 2.01f * time)
                    + 0.19f * std::sin(glm::two_pi<float>() * frequency * 3.03f * time)
                    + 0.08f * std::sin(glm::two_pi<float>() * frequency * 5.0f * time)) * 0.18f;
            } else {
                const float fadeIn = std::min(1.0f, time * 45.0f);
                const float fadeOut = std::min(1.0f, (0.6f - time) * 24.0f);
                const float pulse = std::fmod(time, 0.24f) < 0.14f ? 1.0f : 0.0f;
                value = (std::sin(glm::two_pi<float>() * frequency * time)
                    + 0.35f * std::sin(glm::two_pi<float>() * (frequency * 1.26f) * time))
                    * std::max(0.0f, std::min(fadeIn, fadeOut)) * pulse * 0.48f;
            }
            sound.samples[i] = value;
        }
        ma_audio_buffer_config config = ma_audio_buffer_config_init(ma_format_f32, 1, frameCount,
                                                                      sound.samples.data(), nullptr);
        config.sampleRate = sampleRate;
        ma_result result = ma_audio_buffer_init(&config, &sound.buffer);
        if (result != MA_SUCCESS) {
            std::cerr << "Audio: no se pudo preparar un sonido vehicular: " << ma_result_description(result) << '\n';
            sound.samples.clear();
            return;
        }
        sound.bufferInitialized = true;
        result = ma_sound_init_from_data_source(&engine, reinterpret_cast<ma_data_source*>(&sound.buffer),
                                                0, nullptr, &sound.value);
        if (result != MA_SUCCESS) {
            std::cerr << "Audio: no se pudo iniciar un sonido vehicular: " << ma_result_description(result) << '\n';
            ma_audio_buffer_uninit(&sound.buffer);
            sound.bufferInitialized = false;
            sound.samples.clear();
            return;
        }
        sound.initialized = true;
        if (loop) ma_sound_set_looping(&sound.value, MA_TRUE);
    }

    void StopVehicleSounds() {
        for (auto& channel : vehicleChannels) {
            if (channel.started) {
                ma_sound_stop(&channel.idle.value);
                ma_sound_stop(&channel.drive.value);
                channel.started = false;
            }
            channel.blockedFor = 0.0f;
        }
    }

    void PlayHorn(float volume) {
        std::uniform_int_distribution<size_t> choose(0, horns.size() - 1);
        for (size_t attempt = 0; attempt < horns.size(); ++attempt) {
            Sound& sound = horns[choose(random)];
            if (!sound.initialized) continue;
            ma_sound_stop(&sound.value);
            ma_sound_seek_to_pcm_frame(&sound.value, 0);
            ma_sound_set_volume(&sound.value, volume);
            ma_sound_start(&sound.value);
            return;
        }
    }

    ~Impl() {
        if (ready) {
            for (Sound& sound : sounds) {
                if (sound.initialized) ma_sound_uninit(&sound.value);
                if (sound.bufferInitialized) ma_audio_buffer_uninit(&sound.buffer);
            }
            for (auto& channel : vehicleChannels) {
                if (channel.idle.initialized) ma_sound_uninit(&channel.idle.value);
                if (channel.drive.initialized) ma_sound_uninit(&channel.drive.value);
                if (channel.idle.bufferInitialized) ma_audio_buffer_uninit(&channel.idle.buffer);
                if (channel.drive.bufferInitialized) ma_audio_buffer_uninit(&channel.drive.buffer);
            }
            for (Sound& sound : horns) {
                if (sound.initialized) ma_sound_uninit(&sound.value);
                if (sound.bufferInitialized) ma_audio_buffer_uninit(&sound.buffer);
            }
            if (carAlarm.initialized) ma_sound_uninit(&carAlarm.value);
            if (carAlarm.bufferInitialized) ma_audio_buffer_uninit(&carAlarm.buffer);
            for (Sound& sound : driverVoices) if (sound.initialized) ma_sound_uninit(&sound.value);
            for (Sound& sound : theftVoices) if (sound.initialized) ma_sound_uninit(&sound.value);
            ma_engine_uninit(&engine);
        }
    }
};

AudioManager::AudioManager() : m_Impl(std::make_unique<Impl>()) {}
AudioManager::~AudioManager() = default;

bool AudioManager::IsReady() const { return m_Impl && m_Impl->ready; }
bool AudioManager::IsMuted() const { return !m_Impl || m_Impl->muted; }
float AudioManager::GetVolume() const { return m_Impl ? m_Impl->masterVolume : 0.0f; }

void AudioManager::SetVolume(float volume) {
    if (!m_Impl || !m_Impl->ready) return;
    m_Impl->masterVolume = std::clamp(volume, 0.0f, 1.0f);
    ma_engine_set_volume(&m_Impl->engine, m_Impl->muted ? 0.0f : m_Impl->masterVolume);
}

void AudioManager::SetMuted(bool muted) {
    if (!m_Impl || !m_Impl->ready) return;
    m_Impl->muted = muted;
    ma_engine_set_volume(&m_Impl->engine, muted ? 0.0f : m_Impl->masterVolume);
}

void AudioManager::SetRaining(bool raining) {
    if (!m_Impl || !m_Impl->ready || m_Impl->raining == raining) return;
    m_Impl->raining = raining;
    auto& sound = m_Impl->sounds[static_cast<size_t>(SoundSlot::Rain)];
    if (!sound.initialized) return;
    if (raining) {
        ma_sound_start(&sound.value);
    } else {
        ma_sound_stop(&sound.value);
    }
}

void AudioManager::Play(AudioCue cue) {
    if (!m_Impl || !m_Impl->ready || m_Impl->muted) return;
    SoundSlot slot = SoundSlot::Pickup;
    switch (cue) {
        case AudioCue::Pickup: slot = SoundSlot::Pickup; break;
        case AudioCue::Treasure: slot = SoundSlot::Treasure; break;
        case AudioCue::Sell: slot = SoundSlot::Sell; break;
        case AudioCue::Full: slot = SoundSlot::Full; break;
        case AudioCue::Empty: slot = SoundSlot::Empty; break;
    }
    auto& sound = m_Impl->sounds[static_cast<size_t>(slot)];
    if (!sound.initialized) return;
    ma_sound_stop(&sound.value);
    ma_sound_seek_to_pcm_frame(&sound.value, 0);
    ma_sound_start(&sound.value);
}

void AudioManager::PlayTheftRemark(float distance) {
    if (!m_Impl || !m_Impl->ready || m_Impl->muted) return;
    std::uniform_int_distribution<size_t> choose(0, m_Impl->theftVoices.size() - 1);
    for (size_t attempt = 0; attempt < m_Impl->theftVoices.size(); ++attempt) {
        auto& sound = m_Impl->theftVoices[choose(m_Impl->random)];
        if (!sound.initialized) continue;
        ma_sound_set_volume(&sound.value, 0.7f * std::clamp(1.0f - distance / 12.0f, 0.0f, 1.0f));
        ma_sound_stop(&sound.value);
        ma_sound_seek_to_pcm_frame(&sound.value, 0);
        ma_sound_start(&sound.value);
        return;
    }
}

void AudioManager::PlayCarAlarm(float distance) {
    if (!m_Impl || !m_Impl->ready || m_Impl->muted || !m_Impl->carAlarm.initialized) return;
    ma_sound_stop(&m_Impl->carAlarm.value);
    ma_sound_seek_to_pcm_frame(&m_Impl->carAlarm.value, 0);
    ma_sound_set_volume(&m_Impl->carAlarm.value,
                        0.6f * std::clamp(1.0f - distance / 41.0f, 0.0f, 1.0f));
    ma_sound_start(&m_Impl->carAlarm.value);
}

void AudioManager::UpdateVehicleAudio(float dt, const glm::vec3& listenerPosition,
                                      const Simulation& simulation, bool paused) {
    if (!m_Impl || !m_Impl->ready) return;
    if (paused) {
        m_Impl->StopVehicleSounds();
        for (auto& horn : m_Impl->horns) if (horn.initialized) ma_sound_stop(&horn.value);
        if (m_Impl->carAlarm.initialized) ma_sound_stop(&m_Impl->carAlarm.value);
        for (auto& voice : m_Impl->driverVoices) if (voice.initialized) ma_sound_stop(&voice.value);
        for (auto& voice : m_Impl->theftVoices) if (voice.initialized) ma_sound_stop(&voice.value);
        return;
    }

    struct Source {
        size_t channel = 0;
        glm::vec3 position{0.0f};
        float speed = 0.0f;
        bool bus = false;
        bool blockedForPerson = false;
        float distance = 0.0f;
    };
    std::vector<Source> sources;
    const auto& traffic = simulation.GetTrafficVehicles();
    sources.reserve(traffic.size() + 1);
    for (size_t i = 0; i < traffic.size(); ++i) {
        sources.push_back({0, traffic[i].position, traffic[i].speed, false, traffic[i].blockedForPerson,
                           glm::distance(listenerPosition, traffic[i].position)});
    }
    std::sort(sources.begin(), sources.end(), [](const Source& left, const Source& right) {
        return left.distance < right.distance;
    });
    if (sources.size() > Impl::MaxTrafficAudio) sources.resize(Impl::MaxTrafficAudio);
    for (size_t i = 0; i < sources.size(); ++i) sources[i].channel = i;
    const float busDistance = glm::distance(listenerPosition, simulation.GetBusPosition());
    if (busDistance < Impl::VehicleHearingDistance) {
        sources.push_back({Impl::MaxTrafficAudio, simulation.GetBusPosition(), simulation.GetBusSpeed(), true, false,
                           busDistance});
    }
    std::array<bool, Impl::MaxTrafficAudio + 1> audible{};
    for (const auto& source : sources) {
        if (source.distance >= Impl::VehicleHearingDistance) continue;
        audible[source.channel] = true;
        auto& channel = m_Impl->vehicleChannels[source.channel];
        if (!channel.idle.initialized || !channel.drive.initialized) continue;
        if (!channel.started) {
            ma_sound_start(&channel.idle.value);
            ma_sound_start(&channel.drive.value);
            channel.started = true;
        }
        const float attenuation = std::pow(std::clamp(1.0f - source.distance / Impl::VehicleHearingDistance, 0.0f, 1.0f), 1.4f);
        const float mix = std::clamp(source.speed / 2.5f, 0.0f, 1.0f);
        const float idleGain = source.bus ? 0.38f : 0.34f;
        const float driveGain = source.bus ? 0.42f : 0.40f;
        ma_sound_set_volume(&channel.idle.value, attenuation * (1.0f - mix) * idleGain);
        ma_sound_set_volume(&channel.drive.value, attenuation * mix * driveGain);
        ma_sound_set_pitch(&channel.idle.value, source.bus ? 0.96f : 1.0f);
        ma_sound_set_pitch(&channel.drive.value, 0.88f + std::min(source.speed, 5.0f) * 0.06f);
        channel.hornCooldown = std::max(0.0f, channel.hornCooldown - dt);
        channel.blockedFor = source.blockedForPerson ? channel.blockedFor + dt : 0.0f;
        if (!source.bus && source.blockedForPerson && channel.blockedFor >= channel.patience
            && channel.hornCooldown <= 0.0f) {
            m_Impl->PlayHorn(attenuation * 0.48f);
            if (source.distance < 8.0f) {
                std::uniform_int_distribution<size_t> choose(0, m_Impl->driverVoices.size() - 1);
                for (size_t attempt = 0; attempt < m_Impl->driverVoices.size(); ++attempt) {
                    auto& voice = m_Impl->driverVoices[choose(m_Impl->random)];
                    if (!voice.initialized) continue;
                    ma_sound_set_volume(&voice.value, 0.7f * std::clamp((8.0f - source.distance) / 6.0f, 0.0f, 1.0f));
                    ma_sound_stop(&voice.value);
                    ma_sound_seek_to_pcm_frame(&voice.value, 0);
                    ma_sound_start(&voice.value);
                    break;
                }
            }
            std::uniform_real_distribution<float> cooldown(6.0f, 11.0f);
            channel.hornCooldown = cooldown(m_Impl->random);
        }
    }
    for (size_t i = 0; i < m_Impl->vehicleChannels.size(); ++i) {
        auto& channel = m_Impl->vehicleChannels[i];
        if (!audible[i] && channel.started) {
            ma_sound_stop(&channel.idle.value);
            ma_sound_stop(&channel.drive.value);
            channel.started = false;
            channel.blockedFor = 0.0f;
        }
    }
}

void AudioManager::Update(bool moving, bool running) {
    if (!m_Impl || !m_Impl->ready) return;
    auto& steps = m_Impl->sounds[static_cast<size_t>(SoundSlot::Steps)];
    if (!steps.initialized) return;
    if (moving && !m_Impl->stepsPlaying) {
        ma_sound_set_pitch(&steps.value, running ? 1.4f : 1.0f);
        ma_sound_start(&steps.value);
        m_Impl->stepsPlaying = true;
    } else if (!moving && m_Impl->stepsPlaying) {
        ma_sound_stop(&steps.value);
        m_Impl->stepsPlaying = false;
    }
    if (moving && m_Impl->stepsPlaying) ma_sound_set_pitch(&steps.value, running ? 1.4f : 1.0f);
}

} // namespace Bazuko
