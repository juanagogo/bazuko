// Los archivos de voz del juego, reproducidos con el mismo motor (sin dispositivo) y las mismas banderas que usa AudioManager: tienen que sonar.
#define MINIAUDIO_IMPLEMENTATION
#include <miniaudio.h>

#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

static int failures = 0;
#define CHECK(condition, message) do { if (!(condition)) { ++failures; std::printf("FALLO (%d): %s\n", __LINE__, message); } } while (0)

int main(int argc, char** argv) {
    const std::string folder = argc > 1 ? argv[1] : BAZUKO_AUDIO_DIR;
    ma_engine_config config = ma_engine_config_init();
    config.noDevice = MA_TRUE; config.channels = 2; config.sampleRate = 48000;
    ma_engine engine;
    if (ma_engine_init(&config, &engine) != MA_SUCCESS) { std::printf("sin motor\n"); return 2; }
    ma_sound_group group; ma_sound_group_init(&engine, 0, nullptr, &group);
    for (const char* name : {"roberto_n1.mp3", "roberto_robo_espejo_n1.mp3", "calle_las_mejores_carechimba.mp3", "calle_pirobito.mp3", "calle_enano_gonorrea.mp3", "calle_medallo.mp3", "calle_un3snacional.mp3"}) {
        ma_sound sound;
        const std::string path = folder + "/" + name;
        if (ma_sound_init_from_file(&engine, path.c_str(), MA_SOUND_FLAG_DECODE, &group, nullptr, &sound) != MA_SUCCESS) { CHECK(false, "no se pudo cargar"); std::printf("  %s\n", name); continue; }
        ma_format format; ma_uint32 channels = 0, rate = 0;
        ma_sound_get_data_format(&sound, &format, &channels, &rate, nullptr, 0);
        ma_uint64 length = 0; ma_sound_get_length_in_pcm_frames(&sound, &length);
        ma_sound_set_volume(&sound, 1.0f);
        ma_sound_seek_to_pcm_frame(&sound, 0);
        ma_sound_start(&sound);
        double sum = 0.0; ma_uint64 total = 0; float peak = 0.0f;
        for (int block = 0; block < 40; ++block) {   // los primeros ~0,8 s de lo que sale del motor
            std::vector<float> out(960 * 2);
            ma_uint64 read = 0;
            ma_engine_read_pcm_frames(&engine, out.data(), 960, &read);
            for (float s : out) { sum += static_cast<double>(s) * s; peak = peak > std::abs(s) ? peak : std::abs(s); }
            total += read * 2;
        }
        const float rms = static_cast<float>(std::sqrt(sum / static_cast<double>((total > 1 ? total : 1))));
        std::printf("%-36s canales %u, %u Hz, %.2f s, a la salida: rms %.4f pico %.3f\n", name, channels, rate, static_cast<double>(length) / (rate > 1 ? rate : 1), rms, peak);
        CHECK(rms > 0.002f, "suena a la salida del motor");
        ma_sound_stop(&sound);
        ma_sound_uninit(&sound);
    }
    ma_sound_group_uninit(&group);
    ma_engine_uninit(&engine);
    if (failures == 0) std::printf("Archivos de voz: todos suenan\n");
    return failures == 0 ? 0 : 1;
}
