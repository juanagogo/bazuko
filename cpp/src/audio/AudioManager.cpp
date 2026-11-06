#define MINIAUDIO_IMPLEMENTATION
#include <miniaudio.h>
#include <opusfile.h>

#include "AudioManager.hpp"

#include "StreetVoices.hpp"
#include "SubstanceSynth.hpp"
#include "../world/Simulation.hpp"

#include <array>
#include <algorithm>
#include <map>
#include <chrono>
#include <cmath>
#include <cstdlib>
#include <ctime>
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
    // Los respaldos WAV y audios propios del port viven en cpp/assets/audio, fuera del build web.
    const std::array<std::filesystem::path, 9> candidates{
        std::filesystem::path(Paths::Find((std::filesystem::path("assets/audio") / filename).generic_string())),
        std::filesystem::path(Paths::Find((std::filesystem::path("cpp/assets/audio") / filename).generic_string())),
        std::filesystem::path(Paths::Find((std::filesystem::path("public/audio") / filename).generic_string())),
        std::filesystem::path("cpp/assets/audio") / filename,
        std::filesystem::path("../cpp/assets/audio") / filename,
        std::filesystem::path("assets/audio") / filename,
        std::filesystem::path("../assets/audio") / filename,
        std::filesystem::path("public/audio") / filename,
        std::filesystem::path("audio") / filename
    };
    for (const auto& path : candidates) {
        if (std::filesystem::exists(path)) return path.string();
    }
    return {};
}

} // namespace

namespace {

// Fuente de datos de miniaudio que pide muestras a la sintesis de la radio (se llama desde el hilo de audio)
struct RadioSource {
    ma_data_source_base base;
    RadioSynth* synth = nullptr;
    ma_uint32 sampleRate = 48000;
    std::vector<float> mono;
};

ma_result RadioRead(ma_data_source* source, void* out, ma_uint64 frameCount, ma_uint64* framesRead) {
    auto* radio = reinterpret_cast<RadioSource*>(source);
    auto* samples = static_cast<float*>(out);
    radio->mono.resize(static_cast<size_t>(frameCount));
    radio->synth->Render(radio->mono.data(), static_cast<size_t>(frameCount));
    for (ma_uint64 frame = 0; frame < frameCount; ++frame) {
        samples[frame * 2] = radio->mono[static_cast<size_t>(frame)];
        samples[frame * 2 + 1] = radio->mono[static_cast<size_t>(frame)];
    }
    if (framesRead) *framesRead = frameCount;
    return MA_SUCCESS;
}

ma_result RadioFormat(ma_data_source* source, ma_format* format, ma_uint32* channels, ma_uint32* sampleRate,
                      ma_channel* channelMap, size_t channelMapCap) {
    auto* radio = reinterpret_cast<RadioSource*>(source);
    *format = ma_format_f32;
    *channels = 2;
    *sampleRate = radio->sampleRate;
    if (channelMap) ma_channel_map_init_standard(ma_standard_channel_map_default, channelMap, channelMapCap, 2);
    return MA_SUCCESS;
}

ma_data_source_vtable g_radioVtable = {RadioRead, nullptr, RadioFormat, nullptr, nullptr, nullptr, 0};

// Fuente de datos de la capa sostenida de un efecto de consumo: pide muestras a SubstanceSustain (hilo de audio)
struct SustainSource {
    ma_data_source_base base;
    SubstanceSustain* synth = nullptr;
    ma_uint32 sampleRate = 48000;
    std::vector<float> mono;
};
ma_result SustainRead(ma_data_source* source, void* out, ma_uint64 frameCount, ma_uint64* framesRead) {
    auto* sustain = reinterpret_cast<SustainSource*>(source);
    auto* samples = static_cast<float*>(out);
    sustain->mono.resize(static_cast<size_t>(frameCount));
    sustain->synth->Render(sustain->mono.data(), static_cast<size_t>(frameCount));
    for (ma_uint64 frame = 0; frame < frameCount; ++frame) {
        samples[frame * 2] = sustain->mono[static_cast<size_t>(frame)];
        samples[frame * 2 + 1] = sustain->mono[static_cast<size_t>(frame)];
    }
    if (framesRead) *framesRead = frameCount;
    return MA_SUCCESS;
}
ma_result SustainFormat(ma_data_source* source, ma_format* format, ma_uint32* channels, ma_uint32* sampleRate, ma_channel* channelMap, size_t channelMapCap) {
    auto* sustain = reinterpret_cast<SustainSource*>(source);
    *format = ma_format_f32; *channels = 2; *sampleRate = sustain->sampleRate;
    if (channelMap) ma_channel_map_init_standard(ma_standard_channel_map_default, channelMap, channelMapCap, 2);
    return MA_SUCCESS;
}
ma_data_source_vtable g_sustainVtable = {SustainRead, nullptr, SustainFormat, nullptr, nullptr, nullptr, 0};

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

    static constexpr size_t MaxTrafficAudio = 6;             // como mucho seis motores a la vez
    static constexpr size_t BusChannels = 2;                 // una voz propia por bus
    static constexpr float VehicleHearingDistance = 40.0f;   // motores de carros hasta 40 m
    static constexpr float BusHearingDistance = 55.0f;       // el bus se oye hasta 55 m
    static constexpr float HornHearingDistance = 30.0f;      // claxon hasta 30 m
    static constexpr size_t MaxHorns = 2;                    // como mucho dos claxones a la vez
    static constexpr float VoiceDuck = 0.45f, DuckAttack = 10.0f, DuckRelease = 2.5f;   // mientras suena una frase, trafico y ambiente bajan
    static constexpr float StrideWalk = 1.15f, StrideRun = 1.9f;                          // metros entre pisadas
    std::array<float, 4> mix{{1.0f, 1.0f, 1.0f, 1.0f}};
    float duck = 1.0f;
    float rainIntensity = 0.0f;
    float stepDistance = 0.0f;
    int lastStep = -1;
    std::array<Sound, 7> stepSprites{};
    ma_engine engine{};
    bool ready = false;
    bool muted = false;
    float masterVolume = 0.7f;
    bool stepsPlaying = false;
    float Level(MixCategory category) const {
        const float base = mix[static_cast<size_t>(category)];
        return (category == MixCategory::Traffic || category == MixCategory::Ambient) ? base * duck : base;
    }
    bool AnyNonStreetVoicePlaying() const {
        for (const Sound& voice : driverVoices) if (voice.initialized && ma_sound_is_playing(&voice.value)) return true;
        for (const Sound& voice : theftVoices) if (voice.initialized && ma_sound_is_playing(&voice.value)) return true;
        return false;
    }
    bool StreetPlaying() const { return streetIndex >= 0 && streetVoices[static_cast<size_t>(streetIndex)].initialized && ma_sound_is_playing(&streetVoices[static_cast<size_t>(streetIndex)].value); }
    void StopStreet() {
        if (streetIndex >= 0 && streetVoices[static_cast<size_t>(streetIndex)].initialized) ma_sound_stop(&streetVoices[static_cast<size_t>(streetIndex)].value);
        streetIndex = -1;
    }
    bool AnyVoicePlaying() const { return AnyNonStreetVoicePlaying() || StreetPlaying(); }   // tambien las frases de la calle bajan el trafico y el ambiente
    int HornsPlaying() const {
        int count = 0;
        for (const Sound& horn : horns) if (horn.initialized && ma_sound_is_playing(&horn.value)) ++count;
        return count;
    }
    // Una sola voz a la vez: si ya suena otra frase, esta no entra
    bool PlayVoice(Sound& voice, float volume) {
        if (!voice.initialized) return false;
        StopStreet();   // un robo o un conductor hablan mas fuerte que la frase de la calle: la reclaman
        if (AnyVoicePlaying()) return false;
        ma_sound_set_volume(&voice.value, volume * Level(MixCategory::Voices));
        ma_sound_seek_to_pcm_frame(&voice.value, 0);
        ma_sound_start(&voice.value);
        return true;
    }
    bool raining = false;
    std::array<Sound, static_cast<size_t>(SoundSlot::Count)> sounds{};
    std::array<std::vector<float>, 4> vehicleAudioSamples{};
    std::array<VehicleChannel, MaxTrafficAudio + BusChannels> vehicleChannels{};
    std::array<Sound, 3> horns{};
    Sound carAlarm;
    std::array<Sound, 2> sirens{};   // dos patrullas con sirena a la vez como mucho (las mas cercanas)
    Sound sirenStop;
    Sound policeRadio;
    Sound heartbeat;
    std::unique_ptr<RadioSynth> radioSynth;
    RadioSource radioSource{};
    ma_sound radioSound{};
    bool radioReady = false;
    std::array<Sound, 12> driverVoices{};
    std::array<Sound, 5> theftVoices{};
    std::array<Sound, 5> streetVoices{};   // frases de la calle (StreetVoices.hpp)
    int streetIndex = -1;                  // cual suena ahora
    // Efectos de consumo: los sonidos de consumir (un pequeno conjunto reutilizable), la capa sostenida y el filtro de agudos de todo lo demas
    struct OnsetVoice { std::vector<float> samples; ma_audio_buffer buffer{}; ma_sound sound{}; bool initialized = false; std::string id; };
    std::array<OnsetVoice, 4> onsetVoices{};
    size_t nextOnset = 0;
    std::map<std::string, double> lastOnsetAt;
    std::unique_ptr<SubstanceSustain> sustain;
    SustainSource sustainSource{};
    ma_sound sustainSound{};
    bool sustainReady = false, sustainMuffle = false;
    ma_sound_group masterGroup{};
    ma_lpf_node muffleNode{};
    bool masterGroupReady = false, muffleReady = false;
    float muffleHz = kMuffleOpenHz;
    ma_sound_group* GroupPtr() { return masterGroupReady ? &masterGroup : nullptr; }   // todo suena por aqui menos los efectos de consumo
    void StopSustainSound() {
        if (!sustainReady) return;
        ma_sound_stop(&sustainSound);
        ma_sound_uninit(&sustainSound);
        ma_data_source_uninit(&sustainSource.base);
        sustain.reset(); sustainReady = false; sustainMuffle = false;
        SetMuffle(kMuffleOpenHz);
    }
    void SetMuffle(float hz) {
        if (!muffleReady || std::abs(hz - muffleHz) < 1.0f) return;
        muffleHz = hz;
        ma_lpf_node_config config = ma_lpf_node_config_init(ma_engine_get_channels(&engine), ma_engine_get_sample_rate(&engine), hz, 2);
        ma_lpf_node_reinit(&config.lpf, &muffleNode);
    }
    std::mt19937 random{std::random_device{}()};

    Impl() {
        const ma_result result = ma_engine_init(nullptr, &engine);
        if (result != MA_SUCCESS) {
            std::cerr << "Audio: no se pudo inicializar el dispositivo: " << ma_result_description(result) << '\n';
            return;
        }
        ready = true;
        ma_engine_set_volume(&engine, masterVolume);
        {   // todo el juego pasa por un grupo y un filtro pasa-bajos (abierto salvo con el pegante); los sonidos de los efectos de consumo van directo a los parlantes
            if (ma_sound_group_init(&engine, 0, nullptr, &masterGroup) == MA_SUCCESS) {
                masterGroupReady = true;
                ma_lpf_node_config filter = ma_lpf_node_config_init(ma_engine_get_channels(&engine), ma_engine_get_sample_rate(&engine), kMuffleOpenHz, 2);
                if (ma_lpf_node_init(ma_engine_get_node_graph(&engine), &filter, nullptr, &muffleNode) == MA_SUCCESS
                    && ma_node_attach_output_bus(&masterGroup, 0, &muffleNode, 0) == MA_SUCCESS
                    && ma_node_attach_output_bus(&muffleNode, 0, ma_engine_get_endpoint(&engine), 0) == MA_SUCCESS) {
                    muffleReady = true;
                } else if (!muffleReady) {   // si el filtro no se pudo armar, el grupo vuelve a salir directo
                    ma_node_attach_output_bus(&masterGroup, 0, ma_engine_get_endpoint(&engine), 0);
                }
            }
        }
        {
            // La radio suena siempre (en silencio si esta apagada): evita latencia al encenderla
            const ma_uint32 engineRate = ma_engine_get_sample_rate(&engine);
            radioSynth = std::make_unique<RadioSynth>(static_cast<float>(engineRate));
            ma_data_source_config sourceConfig = ma_data_source_config_init();
            sourceConfig.vtable = &g_radioVtable;
            radioSource.synth = radioSynth.get();
            radioSource.sampleRate = engineRate;
            if (ma_data_source_init(&sourceConfig, &radioSource.base) == MA_SUCCESS
                && ma_sound_init_from_data_source(&engine, &radioSource.base, 0, GroupPtr(), &radioSound) == MA_SUCCESS) {
                ma_sound_start(&radioSound);
                radioReady = true;
            }
        }
        {
            // dos golpes sinusoidales con caida de frecuencia exponencial (como playHeartbeat del juego web)
            constexpr float rate = 48000.0f;
            const size_t frames = static_cast<size_t>(rate * 0.30f);
            heartbeat.samples.assign(frames * 2, 0.0f);
            const auto thump = [&](float offset, float volume) {
                const size_t start = static_cast<size_t>(offset * rate);
                const size_t length = static_cast<size_t>(0.13f * rate);
                float phase = 0.0f;
                for (size_t index = 0; index < length && start + index < frames; ++index) {
                    const float t = static_cast<float>(index) / rate;
                    const float frequency = 65.0f * std::pow(28.0f / 65.0f, t / 0.12f);
                    phase += 6.2831853f * frequency / rate;
                    const float envelope = volume * 0.45f * std::pow(0.001f, t / 0.12f);
                    const float value = std::sin(phase) * envelope;
                    heartbeat.samples[(start + index) * 2] += value;
                    heartbeat.samples[(start + index) * 2 + 1] += value;
                }
            };
            thump(0.0f, 1.0f);
            thump(0.14f, 0.7f);
            heartbeat.sampleSource = &heartbeat.samples;
            InitializeOpusBuffer(heartbeat, heartbeat.samples, false, false);
        }

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
            const ma_result loadResult = ma_sound_init_from_file(&engine, path.c_str(), MA_SOUND_FLAG_DECODE, GroupPtr(), nullptr, &sound.value);
            if (loadResult != MA_SUCCESS) {
                std::cerr << "Audio: no se pudo cargar " << path << ": " << ma_result_description(loadResult) << '\n';
                continue;
            }
            sound.initialized = true;
        }

        ReplaceWithOpusSound(SoundSlot::Steps, "Sounds_of_a_steps.opus", true);
        {   // pisadas sueltas de Sounds_of_a_steps.opus (inicio y duracion en ms), como en el juego web
            const std::array<int, 7> starts{{215, 605, 995, 1385, 1785, 2185, 2575}};
            const std::array<int, 7> lengths{{300, 300, 300, 300, 300, 300, 280}};
            for (size_t i = 0; i < stepSprites.size(); ++i) LoadOpusSound(stepSprites[i], "Sounds_of_a_steps.opus", false, starts[i], lengths[i]);
        }
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
        for (Sound& siren : sirens) {
            LoadOptionalSound(siren, "sirena_policia.mp3");
            if (siren.initialized) ma_sound_set_looping(&siren.value, MA_TRUE);
        }
        LoadOptionalSound(sirenStop, "sirena_stop_policia.mp3");
        LoadOptionalSound(policeRadio, "radio_policia.mp3");
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
        for (size_t i = 0; i < streetVoices.size(); ++i) LoadOptionalSound(streetVoices[i], StreetVoiceClips()[i].file);
        if (std::getenv("BAZUKO_LOG_AUDIO")) {   // diagnostico: formato y nivel de cada frase de la calle (si el archivo estuviera mudo o mal decodificado)
            for (size_t i = 0; i < streetVoices.size(); ++i) {
                if (!streetVoices[i].initialized) { std::cerr << "Audio: frase de la calle " << i << " NO cargada\n"; continue; }
                ma_format format; ma_uint32 channels = 0, rate = 0;
                ma_sound_get_data_format(&streetVoices[i].value, &format, &channels, &rate, nullptr, 0);
                ma_uint64 length = 0; ma_sound_get_length_in_pcm_frames(&streetVoices[i].value, &length);
                std::vector<float> samples(static_cast<size_t>(std::min<ma_uint64>(length, 480000)) * std::max<ma_uint32>(channels, 1));
                ma_uint64 read = 0;
                if (format == ma_format_f32) ma_data_source_read_pcm_frames(ma_sound_get_data_source(&streetVoices[i].value), samples.data(), samples.size() / std::max<ma_uint32>(channels, 1), &read);
                float peak = 0.0f; for (float s : samples) peak = std::max(peak, std::abs(s));
                ma_sound_seek_to_pcm_frame(&streetVoices[i].value, 0);
                std::cerr << "Audio: frase " << i << " formato " << format << " canales " << channels << " " << rate << " Hz, " << length << " cuadros, leidos " << read << ", pico " << peak << '\n';
            }
        }
        for (size_t i = 0; i < vehicleChannels.size(); ++i) {
            const bool bus = i >= MaxTrafficAudio;
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
                                                          GroupPtr(), nullptr, &sound.value);
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
                                                0, GroupPtr(), &sound.value);
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
                                                0, GroupPtr(), &sound.value);
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
        if (HornsPlaying() >= static_cast<int>(MaxHorns)) return;
        volume *= Level(MixCategory::Traffic);
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
            for (Sound& sound : stepSprites) {
                if (sound.initialized) ma_sound_uninit(&sound.value);
                if (sound.bufferInitialized) ma_audio_buffer_uninit(&sound.buffer);
            }
            for (Sound& sound : horns) {
                if (sound.initialized) ma_sound_uninit(&sound.value);
                if (sound.bufferInitialized) ma_audio_buffer_uninit(&sound.buffer);
            }
            if (radioReady) {
                ma_sound_uninit(&radioSound);
                ma_data_source_uninit(&radioSource.base);
            }
            for (Sound& siren : sirens) if (siren.initialized) ma_sound_uninit(&siren.value);
            if (sirenStop.initialized) ma_sound_uninit(&sirenStop.value);
            if (policeRadio.initialized) ma_sound_uninit(&policeRadio.value);
            if (heartbeat.initialized) ma_sound_uninit(&heartbeat.value);
            if (heartbeat.bufferInitialized) ma_audio_buffer_uninit(&heartbeat.buffer);
            if (carAlarm.initialized) ma_sound_uninit(&carAlarm.value);
            if (carAlarm.bufferInitialized) ma_audio_buffer_uninit(&carAlarm.buffer);
            for (Sound& sound : driverVoices) if (sound.initialized) ma_sound_uninit(&sound.value);
            for (Sound& sound : theftVoices) if (sound.initialized) ma_sound_uninit(&sound.value);
            for (Sound& sound : streetVoices) if (sound.initialized) ma_sound_uninit(&sound.value);
            StopSustainSound();
            for (OnsetVoice& voice : onsetVoices) if (voice.initialized) { ma_sound_uninit(&voice.sound); ma_audio_buffer_uninit(&voice.buffer); }
            if (muffleReady) ma_lpf_node_uninit(&muffleNode, nullptr);
            if (masterGroupReady) ma_sound_group_uninit(&masterGroup);
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

void AudioManager::SetRaining(bool raining, float intensity) {
    if (!m_Impl || !m_Impl->ready) return;
    auto& sound = m_Impl->sounds[static_cast<size_t>(SoundSlot::Rain)];
    m_Impl->rainIntensity = std::clamp(intensity, 0.0f, 1.0f);
    if (raining && sound.initialized) ma_sound_set_volume(&sound.value, 0.45f * (0.25f + 0.75f * m_Impl->rainIntensity) * m_Impl->Level(MixCategory::Ambient));
    if (m_Impl->raining == raining) return;
    m_Impl->raining = raining;
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
    static const std::array<float, 5> baseVolumes{0.6f, 0.9f, 0.8f, 0.5f, 0.4f};   // pickup, treasure, sell, full, empty
    ma_sound_set_volume(&sound.value, baseVolumes[static_cast<size_t>(slot) < baseVolumes.size() ? static_cast<size_t>(slot) : 0] * m_Impl->Level(MixCategory::Effects));
    ma_sound_stop(&sound.value);
    ma_sound_seek_to_pcm_frame(&sound.value, 0);
    ma_sound_start(&sound.value);
}

float AudioManager::GetMix(MixCategory category) const { return m_Impl ? m_Impl->mix[static_cast<size_t>(category)] : 1.0f; }

void AudioManager::SetMix(MixCategory category, float level) {
    if (!m_Impl) return;
    m_Impl->mix[static_cast<size_t>(category)] = std::clamp(level, 0.0f, 1.0f);
    if (m_Impl->ready && category == MixCategory::Ambient) {   // el ambiente cambia de inmediato; el resto se aplica al sonar
        auto& ambient = m_Impl->sounds[static_cast<size_t>(SoundSlot::Ambient)];
        if (ambient.initialized) ma_sound_set_volume(&ambient.value, 0.25f * m_Impl->Level(MixCategory::Ambient));
    }
}

void AudioManager::UpdateRadio(bool on, RadioProgram program, float signal, float volume) {
    if (!m_Impl || !m_Impl->ready || !m_Impl->radioReady) return;
    m_Impl->radioSynth->SetOn(on);
    m_Impl->radioSynth->SetStation(program);
    m_Impl->radioSynth->SetSignal(signal);
    m_Impl->radioSynth->SetVolume(volume);
}

void AudioManager::PlayHeartbeat(float intensity) {
    if (!m_Impl || !m_Impl->ready || m_Impl->muted || !m_Impl->heartbeat.initialized) return;
    ma_sound_set_volume(&m_Impl->heartbeat.value, std::clamp(0.4f + 0.6f * intensity, 0.0f, 1.0f) * m_Impl->Level(MixCategory::Effects));
    ma_sound_stop(&m_Impl->heartbeat.value);
    ma_sound_seek_to_pcm_frame(&m_Impl->heartbeat.value, 0);
    ma_sound_start(&m_Impl->heartbeat.value);
}

void AudioManager::PlayTheftRemark(float distance) {
    if (!m_Impl || !m_Impl->ready || m_Impl->muted) return;
    std::uniform_int_distribution<size_t> choose(0, m_Impl->theftVoices.size() - 1);
    for (size_t attempt = 0; attempt < m_Impl->theftVoices.size(); ++attempt) {
        auto& sound = m_Impl->theftVoices[choose(m_Impl->random)];
        if (!sound.initialized) continue;
        m_Impl->PlayVoice(sound, 0.75f * std::clamp((12.0f - distance) / 10.0f, 0.0f, 1.0f));   // solo suena una voz a la vez
        return;
    }
}

void AudioManager::PlaySubstanceOnset(const std::string& id) {
    if (!m_Impl || !m_Impl->ready || m_Impl->muted || !SubstanceHasSound(id)) return;
    using Clock = std::chrono::steady_clock;
    const double now = std::chrono::duration<double>(Clock::now().time_since_epoch()).count();
    const auto last = m_Impl->lastOnsetAt.find(id);
    if (last != m_Impl->lastOnsetAt.end() && now - last->second < kSubstanceOnsetGap) return;   // consumir varias veces seguidas no apila el sonido
    m_Impl->lastOnsetAt[id] = now;
    Impl::OnsetVoice& voice = m_Impl->onsetVoices[m_Impl->nextOnset];
    m_Impl->nextOnset = (m_Impl->nextOnset + 1) % m_Impl->onsetVoices.size();
    if (voice.initialized) { ma_sound_uninit(&voice.sound); ma_audio_buffer_uninit(&voice.buffer); voice.initialized = false; }
    const ma_uint32 rate = ma_engine_get_sample_rate(&m_Impl->engine);
    voice.samples = RenderSubstanceOnset(id, static_cast<float>(rate), static_cast<uint32_t>(now * 1000.0));
    if (voice.samples.empty()) return;
    ma_audio_buffer_config config = ma_audio_buffer_config_init(ma_format_f32, 1, voice.samples.size(), voice.samples.data(), nullptr);
    config.sampleRate = rate;
    if (ma_audio_buffer_init(&config, &voice.buffer) != MA_SUCCESS) return;
    if (ma_sound_init_from_data_source(&m_Impl->engine, reinterpret_cast<ma_data_source*>(&voice.buffer), 0, nullptr, &voice.sound) != MA_SUCCESS) { ma_audio_buffer_uninit(&voice.buffer); return; }
    voice.initialized = true; voice.id = id;
    ma_sound_set_volume(&voice.sound, m_Impl->Level(MixCategory::Effects));
    ma_sound_start(&voice.sound);
}

void AudioManager::StartSubstanceSustain(const std::string& id) {
    if (!m_Impl || !m_Impl->ready || !SubstanceHasSound(id)) return;
    m_Impl->StopSustainSound();
    const ma_uint32 rate = ma_engine_get_sample_rate(&m_Impl->engine);
    m_Impl->sustain = std::make_unique<SubstanceSustain>(id, static_cast<float>(rate), static_cast<uint32_t>(std::random_device{}()));
    if (!m_Impl->sustain->Valid()) { m_Impl->sustain.reset(); return; }
    ma_data_source_config sourceConfig = ma_data_source_config_init();
    sourceConfig.vtable = &g_sustainVtable;
    m_Impl->sustainSource.synth = m_Impl->sustain.get();
    m_Impl->sustainSource.sampleRate = rate;
    if (ma_data_source_init(&sourceConfig, &m_Impl->sustainSource.base) != MA_SUCCESS) { m_Impl->sustain.reset(); return; }
    if (ma_sound_init_from_data_source(&m_Impl->engine, &m_Impl->sustainSource.base, 0, nullptr, &m_Impl->sustainSound) != MA_SUCCESS) {   // sin grupo: el filtro de agudos no la ahoga
        ma_data_source_uninit(&m_Impl->sustainSource.base); m_Impl->sustain.reset(); return;
    }
    ma_sound_set_volume(&m_Impl->sustainSound, 0.0f);
    ma_sound_start(&m_Impl->sustainSound);
    m_Impl->sustainReady = true;
    m_Impl->sustainMuffle = m_Impl->sustain->WantsMuffle();
}

void AudioManager::StopSubstanceSustain() { if (m_Impl) m_Impl->StopSustainSound(); }

void AudioManager::UpdateSubstance(float intensity, bool paused) {
    if (!m_Impl || !m_Impl->ready || !m_Impl->sustainReady) return;
    const float volume = (paused || m_Impl->muted) ? 0.0f : intensity * m_Impl->Level(MixCategory::Effects);
    ma_sound_set_volume(&m_Impl->sustainSound, volume);
    m_Impl->SetMuffle(m_Impl->sustainMuffle ? SubstanceMuffleHz(intensity) : kMuffleOpenHz);
}

float AudioManager::PlayStreetVoice(size_t clip, float distanceVolume) {
    if (!m_Impl || !m_Impl->ready || m_Impl->muted || clip >= m_Impl->streetVoices.size()) return 0.0f;
    Impl::Sound& voice = m_Impl->streetVoices[clip];
    if (!voice.initialized || m_Impl->AnyVoicePlaying()) return 0.0f;
    ma_sound_set_volume(&voice.value, distanceVolume * m_Impl->Level(MixCategory::Voices));
    ma_sound_seek_to_pcm_frame(&voice.value, 0);
    ma_sound_start(&voice.value);
    m_Impl->streetIndex = static_cast<int>(clip);
    if (std::getenv("BAZUKO_LOG_AUDIO")) std::cerr << "Audio: frase " << clip << " sonando=" << ma_sound_is_playing(&voice.value) << " volumen " << ma_sound_get_volume(&voice.value) << " (distancia " << distanceVolume << ", mezcla " << m_Impl->Level(MixCategory::Voices) << ", general " << ma_engine_get_volume(&m_Impl->engine) << ")\n";
    float seconds = 0.0f;
    ma_sound_get_length_in_seconds(&voice.value, &seconds);
    return std::max(seconds, 0.1f);
}

void AudioManager::SetStreetVoiceVolume(float distanceVolume) {
    if (!m_Impl || m_Impl->streetIndex < 0) return;
    ma_sound_set_volume(&m_Impl->streetVoices[static_cast<size_t>(m_Impl->streetIndex)].value, distanceVolume * m_Impl->Level(MixCategory::Voices));
}

void AudioManager::StopStreetVoice() { if (m_Impl) m_Impl->StopStreet(); }
bool AudioManager::StreetVoicePlaying() const { return m_Impl && m_Impl->StreetPlaying(); }
bool AudioManager::OtherVoicePlaying() const { return m_Impl && m_Impl->AnyNonStreetVoicePlaying(); }

void AudioManager::PlayCarAlarm(float distance) {
    if (!m_Impl || !m_Impl->ready || m_Impl->muted || !m_Impl->carAlarm.initialized) return;
    ma_sound_stop(&m_Impl->carAlarm.value);
    ma_sound_seek_to_pcm_frame(&m_Impl->carAlarm.value, 0);
    ma_sound_set_volume(&m_Impl->carAlarm.value,
                        0.6f * std::clamp((41.0f - distance) / 36.0f, 0.0f, 1.0f) * m_Impl->Level(MixCategory::Traffic));
    ma_sound_start(&m_Impl->carAlarm.value);
}

void AudioManager::UpdatePolice(const glm::vec3& listenerPosition, const std::vector<glm::vec3>& sirenPositions,
                                const std::vector<PoliceSound>& events, bool paused) {
    if (!m_Impl || !m_Impl->ready) return;
    // Volumen segun la distancia: cae con el cuadrado hasta cero en el alcance de cada sonido (la sirena se oye lejos; la radio de un policia, solo cerca)
    constexpr float kSirenRange = 110.0f, kStopRange = 90.0f, kRadioRange = 28.0f;
    const auto reach = [](float distance, float range) {
        const float t = std::clamp(1.0f - distance / range, 0.0f, 1.0f);
        return t * t;
    };
    static const bool logAudio = std::getenv("BAZUKO_LOG_AUDIO") != nullptr;
    std::vector<float> distances;
    for (const glm::vec3& position : sirenPositions) distances.push_back(glm::distance(listenerPosition, position));
    std::sort(distances.begin(), distances.end());
    for (size_t i = 0; i < m_Impl->sirens.size(); ++i) {
        auto& siren = m_Impl->sirens[i];
        if (!siren.initialized) continue;
        const float volume = (!paused && !m_Impl->muted && i < distances.size()) ? 0.8f * reach(distances[i], kSirenRange) * m_Impl->Level(MixCategory::Traffic) : 0.0f;
        if (volume <= 0.0005f) {
            if (ma_sound_is_playing(&siren.value)) ma_sound_stop(&siren.value);
            continue;
        }
        ma_sound_set_volume(&siren.value, volume);
        if (!ma_sound_is_playing(&siren.value)) {
            ma_sound_seek_to_pcm_frame(&siren.value, 0);
            ma_sound_start(&siren.value);
        }
        if (logAudio) {
            static float lastLog = -1.0f;
            const float now = static_cast<float>(std::clock()) / CLOCKS_PER_SEC;
            if (now - lastLog > 2.0f) { lastLog = now; std::cerr << "Audio: sirena " << i << " a " << distances[i] << " m, volumen " << volume << '\n'; }
        }
    }
    if (paused || m_Impl->muted) return;
    for (const PoliceSound& event : events) {
        const float distance = glm::distance(listenerPosition, event.position);
        const bool stop = event.kind == PoliceSound::Kind::Stop;
        auto& sound = stop ? m_Impl->sirenStop : m_Impl->policeRadio;
        const float volume = stop ? 0.8f * reach(distance, kStopRange) * m_Impl->Level(MixCategory::Traffic)
                                  : 0.6f * reach(distance, kRadioRange) * m_Impl->Level(MixCategory::Effects);
        if (logAudio) std::cerr << "Audio: " << (stop ? "parada de sirena" : "radio policia") << " a " << distance << " m, volumen " << volume << '\n';
        if (!sound.initialized || volume <= 0.0005f) continue;
        ma_sound_stop(&sound.value);
        ma_sound_seek_to_pcm_frame(&sound.value, 0);
        ma_sound_set_volume(&sound.value, volume);
        ma_sound_start(&sound.value);
    }
}

void AudioManager::UpdateVehicleAudio(float dt, const glm::vec3& listenerPosition,
                                      const Simulation& simulation, bool paused) {
    if (!m_Impl || !m_Impl->ready) return;
    {   // mientras suena una frase, trafico y ambiente bajan para que se entienda (baja rapido, sube despacio)
        const float duckTarget = m_Impl->AnyVoicePlaying() ? Impl::VoiceDuck : 1.0f;
        const float rate = duckTarget < m_Impl->duck ? Impl::DuckAttack : Impl::DuckRelease;
        m_Impl->duck += (duckTarget - m_Impl->duck) * (1.0f - std::exp(-std::max(dt, 1.0f / 60.0f) * rate));
        auto& ambient = m_Impl->sounds[static_cast<size_t>(SoundSlot::Ambient)];
        if (ambient.initialized) ma_sound_set_volume(&ambient.value, 0.25f * m_Impl->Level(MixCategory::Ambient));
    }
    if (paused) {
        m_Impl->StopVehicleSounds();
        for (auto& horn : m_Impl->horns) if (horn.initialized) ma_sound_stop(&horn.value);
        if (m_Impl->carAlarm.initialized) ma_sound_stop(&m_Impl->carAlarm.value);
        for (auto& voice : m_Impl->driverVoices) if (voice.initialized) ma_sound_stop(&voice.value);
        for (auto& voice : m_Impl->theftVoices) if (voice.initialized) ma_sound_stop(&voice.value);
        m_Impl->StopStreet();
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
    const auto& buses = simulation.GetBuses();
    for (size_t busIndex = 0; busIndex < buses.size() && busIndex < Impl::BusChannels; ++busIndex) {
        const float busDistance = glm::distance(listenerPosition, buses[busIndex].position);
        if (busDistance < Impl::BusHearingDistance) {
            sources.push_back({Impl::MaxTrafficAudio + busIndex, buses[busIndex].position, buses[busIndex].speed, true, false,
                               busDistance});
        }
    }
    std::array<bool, Impl::MaxTrafficAudio + Impl::BusChannels> audible{};
    for (const auto& source : sources) {
        const float hearing = source.bus ? Impl::BusHearingDistance : Impl::VehicleHearingDistance;
        if (source.distance >= hearing) continue;
        audible[source.channel] = true;
        auto& channel = m_Impl->vehicleChannels[source.channel];
        if (!channel.idle.initialized || !channel.drive.initialized) continue;
        if (!channel.started) {
            ma_sound_start(&channel.idle.value);
            ma_sound_start(&channel.drive.value);
            channel.started = true;
        }
        const float attenuation = std::pow(std::clamp(1.0f - source.distance / hearing, 0.0f, 1.0f), 1.4f) * m_Impl->Level(MixCategory::Traffic);
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
            const float hornReach = std::clamp(1.0f - source.distance / Impl::HornHearingDistance, 0.0f, 1.0f);
            if (hornReach > 0.0f) m_Impl->PlayHorn(hornReach * 0.48f);   // claxon hasta 30 m, como mucho dos a la vez
            if (source.distance < 8.0f) {
                std::uniform_int_distribution<size_t> choose(0, m_Impl->driverVoices.size() - 1);
                for (size_t attempt = 0; attempt < m_Impl->driverVoices.size(); ++attempt) {
                    auto& voice = m_Impl->driverVoices[choose(m_Impl->random)];
                    if (!voice.initialized) continue;
                    m_Impl->PlayVoice(voice, 0.7f * std::clamp((8.0f - source.distance) / 6.0f, 0.0f, 1.0f));   // solo una voz a la vez
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

void AudioManager::Update(bool moving, bool running, int surface, bool raining, float travelled, float dt) {
    if (!m_Impl || !m_Impl->ready) return;
    // Pisadas sueltas cada cierta distancia recorrida (la animacion escalada por velocidad mantiene el ritmo de los pies);
    // al arrancar, la primera llega pronto en lugar de esperar un paso completo
    const float stride = running ? Impl::StrideRun : Impl::StrideWalk;
    if (!moving) {
        m_Impl->stepDistance = stride * 0.6f;
        m_Impl->stepsPlaying = false;
        return;
    }
    m_Impl->stepsPlaying = true;
    m_Impl->stepDistance += travelled >= 0.0f ? travelled : (running ? 6.0f : 3.0f) * dt;
    if (m_Impl->stepDistance < stride) return;
    m_Impl->stepDistance = std::fmod(m_Impl->stepDistance, stride);
    if (m_Impl->muted) return;
    // sin repetir la misma pisada dos veces seguidas; tierra y pasto mas suaves y lentos, calzada y anden un poco mas fuertes
    std::uniform_int_distribution<int> pick(0, static_cast<int>(m_Impl->stepSprites.size()) - 2);
    int index = pick(m_Impl->random);
    if (index >= m_Impl->lastStep) ++index;
    m_Impl->lastStep = index;
    Impl::Sound& step = m_Impl->stepSprites[static_cast<size_t>(index)];
    if (!step.initialized) return;
    const float surfaceVolume = surface == 2 ? 0.30f : surface == 1 ? 0.46f : 0.50f;
    const float surfaceRate = surface == 2 ? 0.88f : 1.0f;
    std::uniform_real_distribution<float> jitter(0.0f, 1.0f);
    ma_sound_set_volume(&step.value, std::clamp(surfaceVolume * (running ? 1.12f : 1.0f) * (0.85f + jitter(m_Impl->random) * 0.15f) * 1.3f, 0.0f, 1.0f) * m_Impl->Level(MixCategory::Effects));
    ma_sound_set_pitch(&step.value, surfaceRate * (0.98f + jitter(m_Impl->random) * 0.04f) * (raining ? 1.02f : 1.0f));
    ma_sound_stop(&step.value);
    ma_sound_seek_to_pcm_frame(&step.value, 0);
    ma_sound_start(&step.value);
}

} // namespace Bazuko
