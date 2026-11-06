#pragma once
// Frases de la calle (port de src/systems/StreetVoices.js): de vez en cuando alguien que anda cerca dice una frase suelta con su voz grabada.
// Solo logica, sin audio ni mundo: recibe quienes estan cerca y dice que hacer (empezar una frase, ajustar su volumen o cortarla).
// Reglas: se oye a menos de 18 m (volumen pleno hasta 5 m, con caida cuadratica), una sola frase a la vez, 25 s sin volver a oir a la misma persona,
// 50 s sin repetir la misma grabacion, 6 a 13 s entre frase y frase, y entre los 4 mas cercanos cualquiera puede hablar.
#include <algorithm>
#include <array>
#include <cstddef>
#include <cstdint>
#include <random>
#include <unordered_map>
#include <vector>

namespace Bazuko {

struct StreetVoiceClip {
    const char* key;
    const char* file;   // en public/audio
    const char* text;   // lo que muestra la burbuja
};

inline const std::array<StreetVoiceClip, 5>& StreetVoiceClips() {
    static const std::array<StreetVoiceClip, 5> clips{{
        {"carechimba", "calle_las_mejores_carechimba.mp3", "Las mejores, carechimba."},
        {"pirobito", "calle_pirobito.mp3", "Pirobito."},
        {"enano", "calle_enano_gonorrea.mp3", "Enano gonorrea."},
        {"medallo", "calle_medallo.mp3", "Medallo."},
        {"nacional", "calle_un3snacional.mp3", "Un 3 nacional."},
    }};
    return clips;
}

// Alguien de la calle que podria hablar: su identificador estable y a cuantos metros esta
struct StreetVoiceCandidate {
    uint32_t id = 0;
    float distance = 0.0f;
};

class StreetVoiceDirector {
public:
    static constexpr float kRange = 18.0f, kFull = 5.0f;   // m: pleno hasta kFull, mudo desde kRange
    static constexpr double kPersonCooldown = 25.0, kClipCooldown = 50.0;
    static constexpr double kGapMin = 6.0, kGapMax = 13.0, kRetry = 1.0;
    static constexpr size_t kPool = 4;

    struct Action {
        enum class Kind { None, Start, SetVolume, Stop } kind = Kind::None;
        uint32_t person = 0;
        size_t clip = 0;
        float volume = 0.0f;   // 0..1 (antes de la mezcla de «Voces»)
    };

    explicit StreetVoiceDirector(uint32_t seed = 12345u) : m_Random(seed) {}

    static float Gain(float distance) {   // mismo `distanceGain` del original
        const float t = std::clamp((kRange - distance) / (kRange - kFull), 0.0f, 1.0f);
        return t * t;
    }

    // Un cuadro. `playing`: la frase de la calle sigue sonando. `otherVoice`: suena otra voz (robo o conductor). `candidates`: la gente a la vista ya filtrada
    // por quien puede hablar (ni dormida, ni noqueada, ni con burbuja). `now` en segundos de juego.
    Action Update(double now, bool paused, bool playing, bool otherVoice, const std::vector<StreetVoiceCandidate>& candidates) {
        Action action;
        if (paused) { if (m_Speaking) { m_Speaking = false; action.kind = Action::Kind::Stop; } return action; }   // al pausar se calla
        if (m_Speaking) {
            if (!playing) { m_Speaking = false; }
            else {
                float distance = 1.0e9f;
                for (const StreetVoiceCandidate& c : candidates) if (c.id == m_Person) distance = c.distance;
                if (distance > kRange) { m_Speaking = false; action.kind = Action::Kind::Stop; return action; }   // quien hablaba se alejo
                action.kind = Action::Kind::SetVolume; action.person = m_Person; action.volume = Gain(distance);
                return action;
            }
        }
        if (now < m_NextAt || otherVoice) return action;
        std::vector<StreetVoiceCandidate> pool;
        for (const StreetVoiceCandidate& c : candidates) {
            if (c.distance > kRange) continue;
            const auto cooling = m_PersonUntil.find(c.id);
            if (cooling != m_PersonUntil.end() && cooling->second > now) continue;
            pool.push_back(c);
        }
        std::vector<size_t> clips;
        for (size_t i = 0; i < StreetVoiceClips().size(); ++i) {
            const auto cooling = m_ClipUntil.find(i);
            if (cooling == m_ClipUntil.end() || cooling->second <= now) clips.push_back(i);
        }
        if (pool.empty() || clips.empty()) return action;
        std::sort(pool.begin(), pool.end(), [](const StreetVoiceCandidate& a, const StreetVoiceCandidate& b) { return a.distance < b.distance; });
        const size_t limit = std::min(kPool, pool.size());
        const StreetVoiceCandidate& chosen = pool[m_Random() % limit];
        action.kind = Action::Kind::Start; action.person = chosen.id; action.clip = clips[m_Random() % clips.size()]; action.volume = Gain(chosen.distance);
        m_Pending = action;
        return action;
    }

    // El que llama avisa si la frase arranco de verdad (si el sonido no esta cargado, se reintenta en un segundo y no cuenta nada)
    void Started(double now) {
        m_Speaking = true; m_Person = m_Pending.person;
        m_PersonUntil[m_Pending.person] = now + kPersonCooldown;
        m_ClipUntil[m_Pending.clip] = now + kClipCooldown;
        m_NextAt = now + kGapMin + Uniform() * (kGapMax - kGapMin);
    }
    void Failed(double now) { m_NextAt = now + kRetry; }
    // Otra voz mas fuerte reclama el canal: se corta sin soltar los enfriamientos
    void Cancel() { m_Speaking = false; }
    void Clear() { m_Speaking = false; m_ClipUntil.clear(); m_PersonUntil.clear(); m_NextAt = 0.0; }
    bool Speaking() const { return m_Speaking; }

private:
    double Uniform() { return std::uniform_real_distribution<double>(0.0, 1.0)(m_Random); }
    std::mt19937 m_Random;
    std::unordered_map<uint32_t, double> m_PersonUntil;
    std::unordered_map<size_t, double> m_ClipUntil;
    double m_NextAt = 0.0;
    bool m_Speaking = false;
    uint32_t m_Person = 0;
    Action m_Pending;
};

} // namespace Bazuko
