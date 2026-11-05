#pragma once
// Interacciones entre jugadores y con el mundo (hito 4): el cliente PIDE (golpe) y el anfitrion DECIDE; al afectado le llega el resultado (Hit).
// Solo datos y bits. El anfitrion nunca confia en lo que dice el cliente: valida alcance, dano y frecuencia (ver NetSession).
#include "Protocol.hpp"

#include <algorithm>
#include <cmath>
#include <optional>

namespace Bazuko::Net {

inline constexpr float kMaxStrikeReach = 3.0f;      // m: ningun arma de mano llega mas lejos
inline constexpr float kMaxStrikeDamage = 63.0f;
inline constexpr float kMaxStrikeKnockback = 4.0f;
inline constexpr double kMinStrikeIntervalMs = 180.0;   // un jugador no puede golpear mas rapido que esto

// Un golpe del jugador: desde donde esta (el anfitrion usa su ultima posicion conocida, no la que diga el cliente) hacia donde mira
struct StrikeCommand {
    float yaw = 0.0f;
    uint8_t kind = 1;            // 1 jab/navaja, 2 cruzado, 3 patada (lo que usa Simulation::HitPedestrian)
    float damage = -1.0f;        // < 0: el dano por defecto del tipo de golpe
    float reach = 1.3f;
    float knockback = 1.0f;
};
// Un golpe recibido: tipo (1 cara, 2 pecho, 3 piernas) y direccion hacia quien golpeo (plano, unitaria)
struct HitEvent {
    uint8_t kind = 1;
    float fromX = 0.0f, fromZ = 1.0f;
};

inline void Write(BitWriter& w, const StrikeCommand& m) {
    w.U8(static_cast<uint32_t>(MessageType::Strike));
    const float tau = 6.2831853f;
    w.Quantized(m.yaw - tau * std::floor(m.yaw / tau), 0.0f, tau, 10);
    w.Bits(std::clamp<uint32_t>(m.kind, 1, 3), 2);
    w.Bool(m.damage >= 0.0f);
    w.Quantized(m.damage >= 0.0f ? std::min(m.damage, kMaxStrikeDamage) : 0.0f, 0.0f, kMaxStrikeDamage, 8);
    w.Quantized(std::clamp(m.reach, 0.0f, kMaxStrikeReach), 0.0f, kMaxStrikeReach, 6);
    w.Quantized(std::clamp(m.knockback, 0.0f, kMaxStrikeKnockback), 0.0f, kMaxStrikeKnockback, 6);
}
inline std::optional<StrikeCommand> ReadStrike(BitReader& r) {
    StrikeCommand m;
    m.yaw = r.Quantized(0.0f, 6.2831853f, 10);
    m.kind = static_cast<uint8_t>(r.Bits(2));
    const bool hasDamage = r.Bool();
    const float damage = r.Quantized(0.0f, kMaxStrikeDamage, 8);
    m.damage = hasDamage ? damage : -1.0f;
    m.reach = r.Quantized(0.0f, kMaxStrikeReach, 6);
    m.knockback = r.Quantized(0.0f, kMaxStrikeKnockback, 6);
    if (r.Failed() || m.kind < 1 || m.kind > 3) return std::nullopt;
    return m;
}

inline void Write(BitWriter& w, const HitEvent& m) {
    w.U8(static_cast<uint32_t>(MessageType::Hit));
    w.Bits(std::clamp<uint32_t>(m.kind, 1, 3), 2);
    w.Quantized(std::clamp(m.fromX, -1.0f, 1.0f), -1.0f, 1.0f, 10); w.Quantized(std::clamp(m.fromZ, -1.0f, 1.0f), -1.0f, 1.0f, 10);
}
inline std::optional<HitEvent> ReadHit(BitReader& r) {
    HitEvent m;
    m.kind = static_cast<uint8_t>(r.Bits(2));
    m.fromX = r.Quantized(-1.0f, 1.0f, 10); m.fromZ = r.Quantized(-1.0f, 1.0f, 10);
    if (r.Failed() || m.kind < 1 || m.kind > 3) return std::nullopt;
    const float length = std::hypot(m.fromX, m.fromZ);
    if (length < 0.05f) { m.fromX = 0.0f; m.fromZ = 1.0f; } else { m.fromX /= length; m.fromZ /= length; }
    return m;
}

} // namespace Bazuko::Net
