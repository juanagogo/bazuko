#include "audio/AudioEngine.h"

#define MA_NO_ENCODING
#define MA_NO_GENERATION
#define MINIAUDIO_IMPLEMENTATION
#include <miniaudio.h>

#include <cstdio>
#include <map>
#include <vector>

namespace bazuko {

namespace {

struct SoundDef {
    const char* name;
    float volume;
    bool loop;
    bool stream;
};

constexpr SoundDef kSounds[] = {
    {"pickup", 0.6f, false, false}, {"treasure", 0.9f, false, false}, {"sell", 0.8f, false, false},
    {"full", 0.5f, false, false},   {"empty", 0.4f, false, false},    {"steps", 0.5f, true, false},
    {"boost", 0.6f, true, false},   {"ambient", 0.25f, true, true},
};

}  // namespace

struct AudioEngine::Impl {
    ma_context context{};
    bool contextReady = false;
    ma_engine engine{};
    bool engineReady = false;
    std::map<std::string, std::unique_ptr<ma_sound>> sounds;
    bool steps = false, boost = false, ambient = false;
    double stepsRate = 1;

    ~Impl() {
        for (auto& [name, s] : sounds) ma_sound_uninit(s.get());
        sounds.clear();
        if (engineReady) ma_engine_uninit(&engine);
        if (contextReady) ma_context_uninit(&context);
    }

    ma_sound* find(const std::string& name) const {
        auto it = sounds.find(name);
        return it == sounds.end() ? nullptr : it->second.get();
    }
};

AudioEngine::AudioEngine(const AudioOptions& o) : impl_(std::make_unique<Impl>()) {
    Impl& d = *impl_;
    ma_engine_config cfg = ma_engine_config_init();
    if (o.nullBackend) {
        const ma_backend backends[] = {ma_backend_null};
        if (ma_context_init(backends, 1, nullptr, &d.context) != MA_SUCCESS) return;
        d.contextReady = true;
        cfg.pContext = &d.context;
    }
    if (ma_engine_init(&cfg, &d.engine) != MA_SUCCESS) {
        std::fprintf(stderr, "audio: sin dispositivo de salida, el juego seguirá en silencio\n");
        return;
    }
    d.engineReady = true;
    ma_engine_set_volume(&d.engine, static_cast<float>(o.masterVolume));
    for (const SoundDef& def : kSounds) {
        auto sound = std::make_unique<ma_sound>();
        const std::string path = o.dir + "/" + def.name + ".wav";
        const ma_uint32 flags = def.stream ? MA_SOUND_FLAG_STREAM : MA_SOUND_FLAG_DECODE;
        if (ma_sound_init_from_file(&d.engine, path.c_str(), flags, nullptr, nullptr, sound.get()) != MA_SUCCESS) continue;
        ma_sound_set_volume(sound.get(), def.volume);
        ma_sound_set_looping(sound.get(), def.loop ? MA_TRUE : MA_FALSE);
        d.sounds[def.name] = std::move(sound);
    }
}

AudioEngine::~AudioEngine() = default;

bool AudioEngine::enabled() const { return impl_->engineReady; }
int AudioEngine::loaded() const { return static_cast<int>(impl_->sounds.size()); }
bool AudioEngine::has(const std::string& name) const { return impl_->find(name) != nullptr; }
bool AudioEngine::playing(const std::string& name) const {
    ma_sound* s = impl_->find(name);
    return s && ma_sound_is_playing(s);
}

void AudioEngine::play(const std::string& name) {
    ma_sound* s = impl_->find(name);
    if (!s || ma_sound_is_playing(s)) return;
    ma_sound_seek_to_pcm_frame(s, 0);
    ma_sound_start(s);
}

void AudioEngine::stop(const std::string& name) {
    if (ma_sound* s = impl_->find(name)) ma_sound_stop(s);
}

void AudioEngine::updateSteps(bool moving, bool running) {
    Impl& d = *impl_;
    if (moving && !d.steps) {
        d.stepsRate = running ? 1.4 : 1.0;
        if (ma_sound* s = d.find("steps")) {
            ma_sound_set_pitch(s, static_cast<float>(d.stepsRate));
            ma_sound_seek_to_pcm_frame(s, 0);
            ma_sound_start(s);
        }
        d.steps = true;
    } else if (!moving && d.steps) {
        stop("steps");
        d.steps = false;
    }
}

void AudioEngine::updateBoost(bool active) {
    Impl& d = *impl_;
    if (active && !d.boost) {
        if (ma_sound* s = d.find("boost")) ma_sound_start(s);
        d.boost = true;
    } else if (!active && d.boost) {
        stop("boost");
        d.boost = false;
    }
}

void AudioEngine::startAmbient() {
    if (impl_->ambient) return;
    if (ma_sound* s = impl_->find("ambient")) ma_sound_start(s);
    impl_->ambient = true;
}

bool AudioEngine::stepsPlaying() const { return impl_->steps; }
double AudioEngine::stepsRate() const { return impl_->stepsRate; }
bool AudioEngine::ambientStarted() const { return impl_->ambient; }
void AudioEngine::setMasterVolume(double v) {
    if (impl_->engineReady) ma_engine_set_volume(&impl_->engine, static_cast<float>(v));
}

}  // namespace bazuko
