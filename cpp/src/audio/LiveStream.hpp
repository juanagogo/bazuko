#pragma once
// Emisoras colombianas en vivo (port de la parte `kind: 'stream'` de src/systems/RadioSystem.js): baja la senal oficial por HTTP(S) en un hilo propio,
// la decodifica (MP3) al ritmo del motor y la deja en un buffer que el hilo de audio vacia. Una sola senal a la vez.
// Solo MP3: las emisoras AAC y las de HLS (Radio Nacional, Radionica...) no se sintonizan (el estado queda en Failed y el dial vuelve a la estatica).
// `file:<ruta>` lee un MP3 local por el mismo camino (pruebas sin red).
#include <cstddef>
#include <cstdint>
#include <memory>
#include <string>

namespace Bazuko {

class LiveStream {
public:
    enum class State { Idle, Connecting, Playing, Failed };

    explicit LiveStream(uint32_t outputRate);
    ~LiveStream();
    LiveStream(const LiveStream&) = delete;
    LiveStream& operator=(const LiveStream&) = delete;

    void Start(const std::string& url);   // corta la anterior y arranca esta (sin bloquear)
    void Stop();
    State GetState() const;
    std::string Error() const;           // por que fallo (para el log)
    size_t BufferedFrames() const;       // muestras decodificadas que el audio aun no ha tomado
    double SecondsSinceStart() const;    // para el plazo de 15 s del original
    // Hilo de audio: copia hasta `frames` muestras mono ya decodificadas y devuelve cuantas hubo (el resto no se toca).
    size_t Read(float* mono, size_t frames);

private:
    struct Impl;
    std::unique_ptr<Impl> m_Impl;
};

} // namespace Bazuko
