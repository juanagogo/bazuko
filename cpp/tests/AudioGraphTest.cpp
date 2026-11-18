// El camino del audio del juego: todo suena por un grupo maestro y un filtro pasa-bajos (abierto salvo con el pegante); los sonidos de los efectos de consumo van directo
// a los parlantes. Se arma el mismo grafo de AudioManager con un motor sin dispositivo y se mide lo que sale: con el filtro abierto el audio pasa intacto, cerrado
// corta los agudos del juego pero no los de los efectos.
#define MINIAUDIO_IMPLEMENTATION
#include <miniaudio.h>

#include <cmath>
#include <cstdio>
#include <vector>

static int failures = 0;
#define CHECK(condition, message) do { if (!(condition)) { ++failures; std::printf("FALLO (%d): %s\n", __LINE__, message); } } while (0)

static constexpr ma_uint32 kRate = 48000;

static std::vector<float> Tone(float hz) {
    std::vector<float> samples(kRate);
    for (ma_uint32 i = 0; i < kRate; ++i) samples[i] = 0.5f * std::sin(6.2831853f * hz * static_cast<float>(i) / static_cast<float>(kRate));
    return samples;
}
static float Rms(ma_engine& engine, ma_uint32 frames = kRate / 2) {
    std::vector<float> out(static_cast<size_t>(frames) * 2);
    ma_uint64 read = 0;
    ma_engine_read_pcm_frames(&engine, out.data(), frames, &read);
    double sum = 0.0;
    for (float s : out) sum += static_cast<double>(s) * s;
    return static_cast<float>(std::sqrt(sum / static_cast<double>(out.size())));
}

struct Voice {
    std::vector<float> samples; ma_audio_buffer buffer{}; ma_sound sound{};
    bool Init(ma_engine& engine, float hz, ma_sound_group* group) {
        samples = Tone(hz);
        ma_audio_buffer_config config = ma_audio_buffer_config_init(ma_format_f32, 1, samples.size(), samples.data(), nullptr);
        config.sampleRate = kRate;
        if (ma_audio_buffer_init(&config, &buffer) != MA_SUCCESS) return false;
        if (ma_sound_init_from_data_source(&engine, reinterpret_cast<ma_data_source*>(&buffer), 0, group, &sound) != MA_SUCCESS) return false;
        ma_sound_set_looping(&sound, MA_TRUE);
        return true;
    }
    void Uninit() { ma_sound_uninit(&sound); ma_audio_buffer_uninit(&buffer); }
};

int main() {
    ma_engine_config config = ma_engine_config_init();
    config.noDevice = MA_TRUE; config.channels = 2; config.sampleRate = kRate;
    ma_engine engine;
    CHECK(ma_engine_init(&config, &engine) == MA_SUCCESS, "el motor se inicia sin dispositivo");

    // el mismo grafo de AudioManager::Impl
    ma_sound_group group; ma_lpf_node muffle;
    CHECK(ma_sound_group_init(&engine, 0, nullptr, &group) == MA_SUCCESS, "el grupo maestro se crea");
    ma_lpf_node_config filter = ma_lpf_node_config_init(ma_engine_get_channels(&engine), ma_engine_get_sample_rate(&engine), 20000.0f, 2);
    CHECK(ma_lpf_node_init(ma_engine_get_node_graph(&engine), &filter, nullptr, &muffle) == MA_SUCCESS, "el filtro se crea");
    CHECK(ma_node_attach_output_bus(&group, 0, &muffle, 0) == MA_SUCCESS && ma_node_attach_output_bus(&muffle, 0, ma_engine_get_endpoint(&engine), 0) == MA_SUCCESS, "grupo -> filtro -> parlantes");

    {   // un sonido del juego (por el grupo) frente al mismo sonido directo: con el filtro abierto suenan igual
        Voice viaGroup, direct;
        CHECK(viaGroup.Init(engine, 440.0f, &group) && direct.Init(engine, 440.0f, nullptr), "los sonidos se crean");
        ma_sound_start(&viaGroup.sound);
        const float throughGroup = Rms(engine);
        ma_sound_stop(&viaGroup.sound);
        ma_sound_start(&direct.sound);
        const float straight = Rms(engine);
        std::printf("440 Hz por el grupo: %.4f, directo: %.4f\n", throughGroup, straight);
        CHECK(throughGroup > 0.05f, "el audio del juego sale por el grupo y el filtro");
        CHECK(std::abs(throughGroup - straight) < 0.15f * straight, "con el filtro abierto el sonido llega casi igual que directo");
        viaGroup.Uninit(); direct.Uninit();
    }
    {   // el pegante cierra los agudos de todo menos de los efectos de consumo
        Voice highGame, highEffect, lowGame;
        CHECK(highGame.Init(engine, 5000.0f, &group) && highEffect.Init(engine, 5000.0f, nullptr) && lowGame.Init(engine, 440.0f, &group), "sonidos de prueba");
        ma_sound_start(&highGame.sound);
        const float openHigh = Rms(engine);
        ma_sound_stop(&highGame.sound);
        ma_lpf_node_config closed = ma_lpf_node_config_init(ma_engine_get_channels(&engine), ma_engine_get_sample_rate(&engine), 700.0f, 2);
        CHECK(ma_lpf_node_reinit(&closed.lpf, &muffle) == MA_SUCCESS, "el filtro se cierra a 700 Hz");
        Rms(engine, kRate / 10);   // deja que el filtro se asiente
        ma_sound_start(&highGame.sound);
        const float closedHigh = Rms(engine);
        ma_sound_stop(&highGame.sound);
        ma_sound_start(&lowGame.sound);
        const float closedLow = Rms(engine);
        ma_sound_stop(&lowGame.sound);
        ma_sound_start(&highEffect.sound);
        const float effectHigh = Rms(engine);
        std::printf("5000 Hz abierto %.4f, cerrado %.4f; 440 Hz cerrado %.4f; efecto directo cerrado %.4f\n", openHigh, closedHigh, closedLow, effectHigh);
        CHECK(closedHigh < 0.1f * openHigh, "cerrado, los agudos del juego casi desaparecen");
        CHECK(closedLow > 0.7f * openHigh, "y los graves siguen");
        CHECK(effectHigh > 0.8f * openHigh, "pero el pitido de un efecto de consumo, que va directo, no se ahoga");
        highGame.Uninit(); highEffect.Uninit(); lowGame.Uninit();
    }
    ma_lpf_node_uninit(&muffle, nullptr);
    ma_sound_group_uninit(&group);
    ma_engine_uninit(&engine);
    if (failures == 0) std::printf("Grafo de audio: todo correcto\n");
    return failures == 0 ? 0 : 1;
}
