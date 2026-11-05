#pragma once
// Instantanea del mundo compartido (hito 3): reloj, carros, buses y peatones cerca de un jugador. Solo datos y bits: no depende de Simulation.
// El anfitrion simula el mundo y manda esto; los demas jugadores NO simulan trafico ni peatones, solo lo aplican y lo dibujan.
#include "Protocol.hpp"

#include <algorithm>
#include <cmath>
#include <optional>
#include <vector>

namespace Bazuko::Net {

inline constexpr size_t kMaxWorldVehicles = 40;      // los mas cercanos al jugador
inline constexpr size_t kMaxWorldPedestrians = 48;
inline constexpr size_t kMaxWorldBuses = 4;

struct WorldVehicle {
    uint16_t index = 0;          // posicion en la lista de trafico (la misma semilla da la misma lista)
    float x = 0.0f, y = 0.0f, z = 0.0f;   // centro del carro
    float heading = 0.0f;        // rumbo del modelo de bicicleta (rad)
    float steer = 0.0f;
    float speed = 0.0f;
    uint8_t variant = 0, emergency = 0;
    bool parked = false;
};
struct WorldPedestrian {
    uint32_t id = 0;             // identificador estable (los indices cambian al compactar la lista)
    float x = 0.0f, y = 0.0f, z = 0.0f;
    float yaw = 0.0f, speed = 0.0f;
    uint8_t appearance = 0;
    uint8_t reaction = 0;        // 0..4 (ver Pedestrian::reaction)
    bool moving = false, dead = false, police = false;
};
struct WorldBus {
    float x = 0.0f, y = 0.0f, z = 0.0f;
    float headingX = 0.0f, headingZ = -1.0f;
    float speed = 0.0f, wheelRotation = 0.0f;
    bool servedStation = false;
};
struct WorldSnapshot {
    uint32_t tick = 0;
    uint32_t day = 1;
    float clock = 0.0f;          // 0..1
    float elapsed = 0.0f;        // reloj de los semaforos (s)
    uint8_t weather = 0;
    float weatherRemaining = 0.0f;
    uint16_t vehicleCount = 0;   // cuantos carros hay en total: si no coincide con el del invitado, la semilla o los modelos son otros
    std::vector<WorldVehicle> vehicles;
    std::vector<WorldPedestrian> pedestrians;
    std::vector<WorldBus> buses;
};

namespace detail {
inline float WrapAngle(float a) { const float tau = 6.2831853f; return a - tau * std::floor(a / tau); }
}

inline void Write(BitWriter& w, const WorldSnapshot& s) {
    w.U8(static_cast<uint32_t>(MessageType::World));
    w.U32(s.tick); w.U16(s.day > 65535u ? 65535u : s.day);
    w.Quantized(s.clock, 0.0f, 1.0f, 20);
    w.U32(static_cast<uint32_t>(std::fmod(std::max(0.0f, s.elapsed), 4194304.0f) * 1000.0f));   // milisegundos, vuelve a 0 cada ~70 min (los ciclos del semaforo son cortos)
    w.U8(s.weather); w.Quantized(s.weatherRemaining, 0.0f, 600.0f, 10);
    w.U16(s.vehicleCount);
    w.U8(static_cast<uint32_t>(s.buses.size()));
    for (const WorldBus& b : s.buses) {
        w.Quantized(b.x, kWorldMinX, kWorldMaxX, 16); w.Quantized(b.y, kWorldMinY, kWorldMaxY, 16); w.Quantized(b.z, kWorldMinZ, kWorldMaxZ, 16);
        w.Quantized(b.headingX, -1.0f, 1.0f, 10); w.Quantized(b.headingZ, -1.0f, 1.0f, 10);
        w.Quantized(b.speed, 0.0f, kMaxSpeed, 8);
        w.Quantized(detail::WrapAngle(b.wheelRotation), 0.0f, 6.2831853f, 10); w.Bool(b.servedStation);
    }
    w.U8(static_cast<uint32_t>(s.vehicles.size()));
    for (const WorldVehicle& v : s.vehicles) {
        w.U16(v.index);
        w.Quantized(v.x, kWorldMinX, kWorldMaxX, 16); w.Quantized(v.y, kWorldMinY, kWorldMaxY, 16); w.Quantized(v.z, kWorldMinZ, kWorldMaxZ, 16);
        w.Quantized(detail::WrapAngle(v.heading), 0.0f, 6.2831853f, 11);
        w.Quantized(v.steer, -0.8f, 0.8f, 7);
        w.Quantized(std::max(0.0f, v.speed), 0.0f, kMaxSpeed, 8);
        w.Bits(v.variant & 0x1Fu, 5); w.Bits(v.emergency & 0x3u, 2); w.Bool(v.parked);
    }
    w.U8(static_cast<uint32_t>(s.pedestrians.size()));
    for (const WorldPedestrian& p : s.pedestrians) {
        w.U16(p.id & 0xFFFFu);
        w.Quantized(p.x, kWorldMinX, kWorldMaxX, 16); w.Quantized(p.y, kWorldMinY, kWorldMaxY, 14); w.Quantized(p.z, kWorldMinZ, kWorldMaxZ, 16);
        w.Quantized(detail::WrapAngle(p.yaw), 0.0f, 6.2831853f, 9);
        w.Quantized(std::max(0.0f, p.speed), 0.0f, 10.0f, 6);
        w.U8(p.appearance); w.Bits(p.reaction & 0x7u, 3); w.Bool(p.moving); w.Bool(p.dead); w.Bool(p.police);
    }
}

inline std::optional<WorldSnapshot> ReadWorld(BitReader& r) {
    WorldSnapshot s;
    s.tick = r.U32(); s.day = r.U16();
    s.clock = r.Quantized(0.0f, 1.0f, 20);
    s.elapsed = static_cast<float>(r.U32()) / 1000.0f;
    s.weather = static_cast<uint8_t>(r.U8()); s.weatherRemaining = r.Quantized(0.0f, 600.0f, 10);
    s.vehicleCount = static_cast<uint16_t>(r.U16());
    const size_t buses = r.U8();
    if (buses > kMaxWorldBuses) return std::nullopt;
    for (size_t i = 0; i < buses && !r.Failed(); ++i) {
        WorldBus b;
        b.x = r.Quantized(kWorldMinX, kWorldMaxX, 16); b.y = r.Quantized(kWorldMinY, kWorldMaxY, 16); b.z = r.Quantized(kWorldMinZ, kWorldMaxZ, 16);
        b.headingX = r.Quantized(-1.0f, 1.0f, 10); b.headingZ = r.Quantized(-1.0f, 1.0f, 10);
        b.speed = r.Quantized(0.0f, kMaxSpeed, 8); b.wheelRotation = r.Quantized(0.0f, 6.2831853f, 10); b.servedStation = r.Bool();
        s.buses.push_back(b);
    }
    const size_t vehicles = r.U8();
    if (vehicles > kMaxWorldVehicles) return std::nullopt;
    for (size_t i = 0; i < vehicles && !r.Failed(); ++i) {
        WorldVehicle v;
        v.index = static_cast<uint16_t>(r.U16());
        v.x = r.Quantized(kWorldMinX, kWorldMaxX, 16); v.y = r.Quantized(kWorldMinY, kWorldMaxY, 16); v.z = r.Quantized(kWorldMinZ, kWorldMaxZ, 16);
        v.heading = r.Quantized(0.0f, 6.2831853f, 11); v.steer = r.Quantized(-0.8f, 0.8f, 7); v.speed = r.Quantized(0.0f, kMaxSpeed, 8);
        v.variant = static_cast<uint8_t>(r.Bits(5)); v.emergency = static_cast<uint8_t>(r.Bits(2)); v.parked = r.Bool();
        s.vehicles.push_back(v);
    }
    const size_t pedestrians = r.U8();
    if (pedestrians > kMaxWorldPedestrians) return std::nullopt;
    for (size_t i = 0; i < pedestrians && !r.Failed(); ++i) {
        WorldPedestrian p;
        p.id = r.U16();
        p.x = r.Quantized(kWorldMinX, kWorldMaxX, 16); p.y = r.Quantized(kWorldMinY, kWorldMaxY, 14); p.z = r.Quantized(kWorldMinZ, kWorldMaxZ, 16);
        p.yaw = r.Quantized(0.0f, 6.2831853f, 9); p.speed = r.Quantized(0.0f, 10.0f, 6);
        p.appearance = static_cast<uint8_t>(r.U8()); p.reaction = static_cast<uint8_t>(r.Bits(3)); p.moving = r.Bool(); p.dead = r.Bool(); p.police = r.Bool();
        s.pedestrians.push_back(p);
    }
    if (r.Failed()) return std::nullopt;
    return s;
}

} // namespace Bazuko::Net
