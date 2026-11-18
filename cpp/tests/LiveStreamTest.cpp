// La senal en vivo por su camino real (hilo, decodificador MP3, buffer): un MP3 local entra como `file:` y debe salir como audio mono con energia.
// Con una direccion como argumento prueba esa emisora de verdad (necesita red): bazuko_livestream_test https://...
#define MINIAUDIO_IMPLEMENTATION
#define MA_NO_DEVICE_IO
#define MA_NO_ENGINE
#define MA_NO_GENERATION
#include <miniaudio.h>
#include "audio/LiveStream.hpp"
#include <chrono>
#include <cmath>
#include <cstdio>
#include <string>
#include <thread>
#include <vector>
using namespace Bazuko;
static int failures = 0;
#define CHECK(c, m) do { if (!(c)) { std::printf("FALLO (%d): %s\n", __LINE__, m); ++failures; } } while (0)

static double Listen(LiveStream& stream, double seconds, size_t& frames, double timeoutSeconds) {
    const auto start = std::chrono::steady_clock::now();
    std::vector<float> block(480);
    double energy = 0.0; frames = 0;
    const size_t want = static_cast<size_t>(seconds * 48000.0);
    while (frames < want && std::chrono::duration<double>(std::chrono::steady_clock::now() - start).count() < timeoutSeconds) {
        const size_t got = stream.Read(block.data(), block.size());
        for (size_t i = 0; i < got; ++i) energy += static_cast<double>(block[i]) * block[i];
        frames += got;
        if (got == 0) std::this_thread::sleep_for(std::chrono::milliseconds(5)); else std::this_thread::sleep_for(std::chrono::milliseconds(2));
    }
    return frames ? std::sqrt(energy / static_cast<double>(frames)) : 0.0;
}

int main(int argc, char** argv) {
    LiveStream stream(48000);
    if (argc > 1) {   // emisora real
        stream.Start(argv[1]);
        size_t frames = 0;
        const double rms = Listen(stream, 6.0, frames, 20.0);
        std::printf("%s: estado %d, %zu muestras, rms %.4f, error '%s'\n", argv[1], static_cast<int>(stream.GetState()), frames, rms, stream.Error().c_str());
        return frames > 48000 && rms > 0.002 ? 0 : 1;
    }
    stream.Start(std::string("file:") + BAZUKO_AUDIO_DIR + "/calle_un3snacional.mp3");
    CHECK(stream.GetState() == LiveStream::State::Connecting || stream.GetState() == LiveStream::State::Playing, "arranca conectando");
    size_t frames = 0;
    const double rms = Listen(stream, 1.5, frames, 10.0);
    std::printf("estado %d error '%s' muestras %zu\n", static_cast<int>(stream.GetState()), stream.Error().c_str(), frames);
    CHECK(stream.GetState() == LiveStream::State::Playing, "pasa a sonar con el colchon de medio segundo");
    CHECK(frames >= 48000, "salen al menos un segundo de muestras");
    CHECK(rms > 0.002, "el audio tiene energia (no es silencio)");
    stream.Start(std::string("file:") + BAZUKO_AUDIO_DIR + "/no_existe.mp3");
    for (int i = 0; i < 200 && stream.GetState() == LiveStream::State::Connecting; ++i) std::this_thread::sleep_for(std::chrono::milliseconds(10));
    CHECK(stream.GetState() == LiveStream::State::Failed && !stream.Error().empty(), "un origen que no existe queda en Failed con su motivo");
    stream.Stop();
    CHECK(stream.GetState() == LiveStream::State::Idle, "al parar queda en reposo");
    if (failures == 0) std::printf("Senal en vivo: todo correcto (%zu muestras, rms %.3f)\n", frames, rms);
    return failures == 0 ? 0 : 1;
}
