#include "SubstanceSynth.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <functional>

namespace Bazuko {

namespace {
constexpr float kTau = 6.28318530718f;

float Fract(float x) { return x - std::floor(x); }
// formas de onda de -1 a 1 con la fase en vueltas (0..1)
float Sine(float p) { return std::sin(kTau * p); }
float Triangle(float p) { return 4.0f * std::abs(p - std::floor(p + 0.75f) + 0.25f) - 1.0f; }
float Sawtooth(float p) { return 2.0f * (p - std::floor(p + 0.5f)); }

// Oscilador con fase propia, frecuencia en Hz y desafinacion en cents (como `detune` de Web Audio)
struct Osc {
    float (*shape)(float) = Sine;
    float phase = 0.0f;
    float Next(float hz, float detuneCents, float sampleRate) {
        const float value = shape(phase);
        phase = Fract(phase + hz * std::exp2(detuneCents / 1200.0f) / sampleRate);
        return value;
    }
};

// Filtro de dos polos (RBJ), como BiquadFilterNode: en pasa-bajos y pasa-altos la Q va en dB; en pasa-banda es lineal (ganancia 0 dB en el pico)
struct Biquad {
    enum class Type { LowPass, HighPass, BandPass } type = Type::LowPass;
    float b0 = 1, b1 = 0, b2 = 0, a1 = 0, a2 = 0, x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    void Set(Type kind, float hz, float q, float sampleRate) {
        type = kind;
        const float w0 = kTau * std::min(hz, sampleRate * 0.45f) / sampleRate;
        const float cs = std::cos(w0), sn = std::sin(w0);
        const float quality = kind == Type::BandPass ? std::max(q, 1.0e-3f) : std::pow(10.0f, q / 20.0f);
        const float alpha = sn / (2.0f * quality);
        float nb0, nb1, nb2;
        if (kind == Type::LowPass) { nb0 = (1 - cs) * 0.5f; nb1 = 1 - cs; nb2 = nb0; }
        else if (kind == Type::HighPass) { nb0 = (1 + cs) * 0.5f; nb1 = -(1 + cs); nb2 = nb0; }
        else { nb0 = alpha; nb1 = 0.0f; nb2 = -alpha; }
        const float a0 = 1 + alpha;
        b0 = nb0 / a0; b1 = nb1 / a0; b2 = nb2 / a0; a1 = -2 * cs / a0; a2 = (1 - alpha) / a0;
    }
    float Process(float x) {
        const float y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
        x2 = x1; x1 = x; y2 = y1; y1 = y;
        return y;
    }
};

// Automatizacion de un parametro como AudioParam: valor fijo en un instante o rampa exponencial hasta un valor en otro
class Param {
public:
    explicit Param(float initial) : m_Initial(initial) {}
    Param& SetAt(float time, float value) { m_Events.push_back({time, value, false}); return *this; }
    Param& ExpTo(float time, float value) { m_Events.push_back({time, value, true}); return *this; }
    float At(float time) const {
        float prevTime = 0.0f, prevValue = m_Initial;
        for (const Event& e : m_Events) {
            if (e.ramp) {
                if (time < e.time) {
                    if (prevValue <= 0.0f || e.value <= 0.0f || e.time <= prevTime) return prevValue;
                    return prevValue * std::pow(e.value / prevValue, std::max(0.0f, (time - prevTime) / (e.time - prevTime)));
                }
            } else if (time < e.time) {
                return prevValue;
            }
            prevTime = e.time; prevValue = e.value;
        }
        return prevValue;
    }
private:
    struct Event { float time, value; bool ramp; };
    float m_Initial;
    std::vector<Event> m_Events;
};

// `env(peak, attack, hold, release)` del original: sube (exponencial) hasta el pico, se sostiene y baja
Param Envelope(float peak, float attack, float hold, float release) {
    Param g(0.0001f);
    g.SetAt(0.0f, 0.0001f).ExpTo(attack, peak).SetAt(attack + hold, peak).ExpTo(attack + hold + release, 0.0001f);
    return g;
}

float Noise(std::mt19937& rng) { return std::uniform_real_distribution<float>(-1.0f, 1.0f)(rng); }

using Mono = std::vector<float>;

// ---- los sonidos de consumir (SOUNDS[id].onset) ----
Mono Pastilla(float sr, std::mt19937&) {
    Mono out(static_cast<size_t>(sr * kSubstanceOnsetLength), 0.0f);
    // un trago: seno que cae de 140 a 60 Hz en 0,12 s, con su envolvente
    Osc gulp; const Param gulpFreq = Param(140.0f).SetAt(0.0f, 140.0f).ExpTo(0.12f, 60.0f); const Param gulpEnv = Envelope(0.25f, 0.01f, 0.02f, 0.12f);
    // y un brillo que sube: dos triangulos (400 y 600 Hz, el segundo 7 cents arriba) que suben dos octavas en 1,4 s
    struct Rise { Osc osc; float base, cents; Param freq, env; };
    std::vector<Rise> rises;
    for (const auto& [f, cents] : {std::pair<float, float>{400.0f, 0.0f}, {600.0f, 7.0f}})
        rises.push_back({Osc{Triangle}, f, cents, Param(f).SetAt(0.0f, f).ExpTo(1.4f, f * 4.0f), Envelope(0.06f, 0.3f, 0.6f, 0.8f)});
    for (size_t i = 0; i < out.size(); ++i) {
        const float t = static_cast<float>(i) / sr;
        float v = gulp.Next(gulpFreq.At(t), 0.0f, sr) * gulpEnv.At(t);
        for (Rise& r : rises) v += r.osc.Next(r.freq.At(t), r.cents, sr) * r.env.At(t);
        out[i] = v;
    }
    return out;
}

Mono Pegante(float sr, std::mt19937& rng) {   // inhalacion dentro de la bolsa: ruido por un pasa-banda que sube de 400 a 1500 Hz
    Mono out(static_cast<size_t>(sr * kSubstanceOnsetLength), 0.0f);
    Biquad bp; const Param freq = Param(400.0f).SetAt(0.0f, 400.0f).ExpTo(1.1f, 1500.0f); const Param env = Envelope(0.25f, 0.9f, 0.1f, 0.3f);
    for (size_t i = 0; i < out.size(); ++i) {
        const float t = static_cast<float>(i) / sr;
        if (i % 16 == 0) bp.Set(Biquad::Type::BandPass, freq.At(t), 1.5f, sr);
        out[i] = bp.Process(Noise(rng)) * env.At(t);
    }
    return out;
}

// chispas del encendedor: ruido agudo con un golpe de volumen que cae en 40 ms (hierba) o 25 ms (basuco)
void AddSparks(Mono& out, float sr, std::mt19937& rng, const std::vector<float>& at, float level, float length) {
    for (const float start : at) {
        Biquad hp; hp.Set(Biquad::Type::HighPass, length > 0.03f ? 3000.0f : 2500.0f, 1.0f, sr);
        const Param gain = Param(0.0f).SetAt(start, level).ExpTo(start + length, 0.0001f);
        const size_t first = static_cast<size_t>(start * sr), last = std::min(out.size(), static_cast<size_t>((start + length + 0.2f) * sr));
        for (size_t i = first; i < last; ++i) out[i] += hp.Process(Noise(rng)) * gain.At(static_cast<float>(i) / sr);
    }
}
void AddInhale(Mono& out, float sr, std::mt19937& rng, float from, float fromHz, float toHz, float toTime, float q, const Param& gain) {
    Biquad bp; const Param freq = Param(fromHz).SetAt(from, fromHz).ExpTo(toTime, toHz);
    for (size_t i = 0; i < out.size(); ++i) {
        const float t = static_cast<float>(i) / sr;
        if (i % 16 == 0) bp.Set(Biquad::Type::BandPass, freq.At(t), q, sr);
        out[i] += bp.Process(Noise(rng)) * gain.At(t);
    }
}

Mono Hierba(float sr, std::mt19937& rng) {   // chispazo de encendedor e inhalacion larga
    Mono out(static_cast<size_t>(sr * kSubstanceOnsetLength), 0.0f);
    AddSparks(out, sr, rng, {0.0f, 0.18f}, 0.3f, 0.04f);
    AddInhale(out, sr, rng, 0.4f, 300.0f, 900.0f, 2.2f, 1.2f, Param(0.0f).SetAt(0.4f, 0.0001f).ExpTo(1.6f, 0.2f).ExpTo(2.4f, 0.0001f));
    return out;
}

Mono Basuco(float sr, std::mt19937& rng) {   // chispazo, crujido de la pipa y una aspirada corta y fuerte
    Mono out(static_cast<size_t>(sr * kSubstanceOnsetLength), 0.0f);
    std::vector<float> sparks;
    for (int k = 0; k < 7; ++k) sparks.push_back(0.05f + static_cast<float>(k) * 0.11f + std::uniform_real_distribution<float>(0.0f, 0.05f)(rng));
    AddSparks(out, sr, rng, sparks, 0.22f, 0.025f);
    AddInhale(out, sr, rng, 0.2f, 500.0f, 1400.0f, 1.6f, 1.4f, Param(0.0f).SetAt(0.2f, 0.0001f).ExpTo(1.2f, 0.25f).ExpTo(1.8f, 0.0001f));
    return out;
}
}

bool SubstanceHasSound(const std::string& id) { return id == "pastilla" || id == "pegante" || id == "hierba" || id == "basuco"; }
float SubstanceMuffleHz(float intensity) { return kMuffleOpenHz * std::pow(kMuffleClosedHz / kMuffleOpenHz, std::clamp(intensity, 0.0f, 1.0f)); }

std::vector<float> RenderSubstanceOnset(const std::string& id, float sampleRate, uint32_t seed) {
    std::mt19937 rng(seed);
    if (id == "pastilla") return Pastilla(sampleRate, rng);
    if (id == "pegante") return Pegante(sampleRate, rng);
    if (id == "hierba") return Hierba(sampleRate, rng);
    if (id == "basuco") return Basuco(sampleRate, rng);
    return {};
}

// ---- las capas sostenidas (SOUNDS[id].sustain), generadas muestra a muestra ----
struct SubstanceSustain::Impl {
    std::function<float()> next;
    bool muffle = false;
};

SubstanceSustain::SubstanceSustain(const std::string& id, float sampleRate, uint32_t seed) : m_Impl(std::make_unique<Impl>()) {
    struct Clock { float t = 0.0f; float dt = 0.0f; void Tick() { t += dt; } };
    auto clock = std::make_shared<Clock>(); clock->dt = 1.0f / sampleRate;
    const float sr = sampleRate;
    auto rng = std::make_shared<std::mt19937>(seed);
    const auto lfo = [](float t, float hz) { return std::sin(kTau * hz * t); };
    if (id == "pastilla") {   // acorde brillante que ondula al ritmo de la camara: cuatro triangulos por un pasa-bajos cuyo corte se mece
        struct Voice { Osc osc; float hz, lfoHz; };
        auto voices = std::make_shared<std::vector<Voice>>();
        for (const float f : {220.0f, 277.18f, 329.63f, 440.0f}) voices->push_back({Osc{Triangle}, f, 0.2f + std::uniform_real_distribution<float>(0.0f, 0.2f)(*rng)});
        auto lp = std::make_shared<Biquad>(); auto count = std::make_shared<int>(0);
        m_Impl->next = [=]() {
            clock->Tick();
            if ((*count)++ % 16 == 0) lp->Set(Biquad::Type::LowPass, 2200.0f + 900.0f * lfo(clock->t, 0.25f), 2.0f, sr);
            float sum = 0.0f;
            for (Voice& v : *voices) sum += v.osc.Next(v.hz, 9.0f * lfo(clock->t, v.lfoHz), sr) * 0.05f;
            return lp->Process(sum);
        };
    } else if (id == "pegante") {   // zumbido grave que se mece (dos tonos cercanos baten) y pitido de oidos tapados
        auto saws = std::make_shared<std::array<Osc, 2>>(); (*saws)[0].shape = Sawtooth; (*saws)[1].shape = Sawtooth;
        auto ring = std::make_shared<Osc>(); auto lp = std::make_shared<Biquad>(); lp->Set(Biquad::Type::LowPass, 320.0f, 1.0f, sr);
        m_Impl->next = [=]() {
            clock->Tick();
            const float detune = 30.0f * lfo(clock->t, 0.32f);
            const float low = lp->Process(((*saws)[0].Next(55.0f, detune, sr) + (*saws)[1].Next(55.8f, detune, sr)) * 0.09f);
            return low + ring->Next(6200.0f, 0.0f, sr) * (0.012f + 0.006f * lfo(clock->t, 0.5f));
        };
        m_Impl->muffle = true;
    } else if (id == "hierba") {   // fondo calido, grave y lento: tres tonos con un temblor lento por un pasa-bajos
        auto a = std::make_shared<Osc>(), b = std::make_shared<Osc>(), c = std::make_shared<Osc>(); c->shape = Triangle;
        auto lp = std::make_shared<Biquad>(); lp->Set(Biquad::Type::LowPass, 600.0f, 0.7f, sr);
        m_Impl->next = [=]() {
            clock->Tick();
            const float tremolo = 1.0f + 0.35f * lfo(clock->t, 0.12f);
            return lp->Process(tremolo * (a->Next(110.0f, 0.0f, sr) * 0.09f + b->Next(165.0f, 0.0f, sr) * 0.06f + c->Next(220.0f, 0.0f, sr) * 0.03f));
        };
    } else if (id == "basuco") {   // pitido agudo de oidos y un pulso grave acelerado, como el corazon
        auto ring = std::make_shared<Osc>(), pulse = std::make_shared<Osc>(); auto lp = std::make_shared<Biquad>(); lp->Set(Biquad::Type::LowPass, 180.0f, 1.0f, sr);
        m_Impl->next = [=]() {
            clock->Tick();
            return ring->Next(7400.0f, 0.0f, sr) * (0.01f + 0.005f * lfo(clock->t, 0.4f)) + lp->Process(pulse->Next(52.0f, 0.0f, sr) * 0.12f * lfo(clock->t, 2.1f));
        };
    }
}

SubstanceSustain::~SubstanceSustain() = default;
bool SubstanceSustain::Valid() const { return static_cast<bool>(m_Impl->next); }
bool SubstanceSustain::WantsMuffle() const { return m_Impl->muffle; }
void SubstanceSustain::Render(float* out, size_t frames) {
    for (size_t i = 0; i < frames; ++i) out[i] = m_Impl->next ? m_Impl->next() : 0.0f;
}

} // namespace Bazuko
