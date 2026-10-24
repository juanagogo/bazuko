#include <opusfile.h>

#include <array>
#include <filesystem>
#include <iostream>
#include <string>
#include <vector>

int main() {
    const std::filesystem::path audioDirectory(BAZUKO_TEST_AUDIO_DIR);
    const std::vector<std::string> files{
        "bus_vehicle_drivin.opus",
        "car_horn_sound.opus",
        "car_horn_sound1.opus",
        "car_horn_sound_v3.opus",
        "car_idling_at_a_traf.opus",
        "car_idling_at_a_traf_bus.opus",
        "city_atmosphere_soun.opus",
        "small_vehicle_drivin.opus",
        "Sonido De Alarma De Auto.opus",
        "Sounds_of_a_steps.opus"
    };
    std::array<float, 16384> samples{};
    for (const auto& filename : files) {
        const auto path = audioDirectory / filename;
        int error = 0;
        OggOpusFile* stream = op_open_file(path.string().c_str(), &error);
        if (!stream) {
            std::cerr << "Could not open " << path.string() << " (Opus error " << error << ")\n";
            return 1;
        }
        ogg_int64_t decodedFrames = 0;
        for (;;) {
            const int frames = op_read_float_stereo(stream, samples.data(),
                                                    static_cast<int>(samples.size()));
            if (frames == 0) break;
            if (frames < 0) {
                std::cerr << "Could not decode " << path.string() << '\n';
                op_free(stream);
                return 1;
            }
            decodedFrames += frames;
        }
        op_free(stream);
        if (decodedFrames == 0) {
            std::cerr << "No audio frames decoded from " << path.string() << '\n';
            return 1;
        }
        std::cout << filename << ": " << decodedFrames << " frames\n";
    }
    return 0;
}
