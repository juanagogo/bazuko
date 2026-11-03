#include <doctest/doctest.h>

#include <cmath>
#include <cstdint>
#include <filesystem>
#include <fstream>

#include "audio/AudioEngine.h"

using namespace bazuko;
namespace fs = std::filesystem;

namespace {

void writeWav(const fs::path& path, int seconds = 1) {
    const int rate = 8000, samples = rate * seconds;
    std::ofstream f(path, std::ios::binary);
    auto u32 = [&](std::uint32_t v) { f.write(reinterpret_cast<const char*>(&v), 4); };
    auto u16 = [&](std::uint16_t v) { f.write(reinterpret_cast<const char*>(&v), 2); };
    f.write("RIFF", 4); u32(36 + samples * 2); f.write("WAVEfmt ", 8);
    u32(16); u16(1); u16(1); u32(rate); u32(rate * 2); u16(2); u16(16);
    f.write("data", 4); u32(samples * 2);
    for (int i = 0; i < samples; ++i) u16(static_cast<std::uint16_t>(static_cast<std::int16_t>(2000 * std::sin(i * 0.1))));
}

struct SoundDir {
    fs::path dir = fs::temp_directory_path() / "bazuko_audio_test";
    SoundDir() {
        fs::remove_all(dir);
        fs::create_directories(dir);
        for (const char* n : {"pickup", "steps", "ambient"}) writeWav(dir / (std::string(n) + ".wav"), 2);
        std::ofstream(dir / "full.wav") << "version https://git-lfs.github.com/spec/v1\n";  // puntero LFS: no es audio
    }
    ~SoundDir() { fs::remove_all(dir); }
};

}  // namespace

TEST_CASE("el audio carga lo que existe e ignora los archivos ausentes o corruptos") {
    SoundDir sd;
    AudioEngine audio({sd.dir.string(), true});
    REQUIRE(audio.enabled());
    CHECK(audio.loaded() == 3);
    CHECK(audio.has("pickup"));
    CHECK(audio.has("steps"));
    CHECK(audio.has("ambient"));
    CHECK_FALSE(audio.has("full"));      // puntero LFS
    CHECK_FALSE(audio.has("boost"));     // no existe
    CHECK_FALSE(audio.has("inventado"));
}

TEST_CASE("un efecto no se reinicia mientras suena y se puede detener") {
    SoundDir sd;
    AudioEngine audio({sd.dir.string(), true});
    audio.play("pickup");
    CHECK(audio.playing("pickup"));
    audio.play("pickup");  // ya suena: se ignora
    CHECK(audio.playing("pickup"));
    audio.stop("pickup");
    CHECK_FALSE(audio.playing("pickup"));
    audio.play("full");      // sin archivo: no pasa nada
    audio.play("inventado");
    audio.stop("inventado");
    CHECK_FALSE(audio.playing("full"));
}

TEST_CASE("los pasos arrancan con el movimiento, a 1,4x al correr, y paran al detenerse") {
    SoundDir sd;
    AudioEngine audio({sd.dir.string(), true});
    audio.updateSteps(false, false);
    CHECK_FALSE(audio.stepsPlaying());
    audio.updateSteps(true, true);
    CHECK(audio.stepsPlaying());
    CHECK(audio.stepsRate() == doctest::Approx(1.4));
    CHECK(audio.playing("steps"));
    audio.updateSteps(true, false);  // ya suenan: cambiar de caminar a correr no los reinicia
    CHECK(audio.stepsRate() == doctest::Approx(1.4));
    audio.updateSteps(false, false);
    CHECK_FALSE(audio.stepsPlaying());
    CHECK_FALSE(audio.playing("steps"));
    audio.updateSteps(true, false);
    CHECK(audio.stepsRate() == doctest::Approx(1.0));
}

TEST_CASE("el ambiente se inicia una sola vez y el boost sin archivo no falla") {
    SoundDir sd;
    AudioEngine audio({sd.dir.string(), true});
    CHECK_FALSE(audio.ambientStarted());
    audio.startAmbient();
    CHECK(audio.ambientStarted());
    CHECK(audio.playing("ambient"));
    audio.startAmbient();
    audio.updateBoost(true);   // boost.wav no existe en el juego web: silencio
    audio.updateBoost(false);
    audio.setMasterVolume(0.3);
}

TEST_CASE("con una carpeta inexistente el audio queda vacío pero funcional") {
    AudioEngine audio({"/no/existe", true});
    CHECK(audio.loaded() == 0);
    audio.play("pickup");
    audio.updateSteps(true, true);
    audio.startAmbient();
    CHECK(audio.stepsPlaying());  // el estado se lleva igual
}
