// Pruebas del protocolo de red sin red: ida y vuelta de cada mensaje, error de cuantizacion, rechazo de paquetes truncados o corruptos
// (nunca debe fallar ni leer fuera del buffer) y comportamiento estadistico del simulador de red.
#include "net/Interaction.hpp"
#include "net/NetSim.hpp"
#include "net/Protocol.hpp"
#include "net/WorldSnapshot.hpp"

#include <cmath>
#include <cstdio>
#include <random>

using namespace Bazuko::Net;

namespace {
int g_Failures = 0;
void Check(bool condition, const char* what) {
    if (!condition) { std::printf("FALLO: %s\n", what); ++g_Failures; }
}
bool Near(float a, float b, float tolerance) { return std::fabs(a - b) <= tolerance; }
}

int main() {
    // BitWriter / BitReader
    {
        BitWriter w;
        w.Bits(5, 3); w.Bool(true); w.U8(200); w.U16(54321); w.U32(0xDEADBEEFu); w.Quantized(12.34f, 0.0f, 100.0f, 12); w.String("hola parcero");
        BitReader r(w.Data());
        Check(r.Bits(3) == 5, "bits sueltos");
        Check(r.Bool(), "booleano");
        Check(r.U8() == 200 && r.U16() == 54321 && r.U32() == 0xDEADBEEFu, "enteros de 8, 16 y 32 bits");
        Check(Near(r.Quantized(0.0f, 100.0f, 12), 12.34f, 100.0f / 4095.0f), "cuantizado dentro de su error");
        Check(r.String() == "hola parcero" && !r.Failed(), "cadena");
        r.U32(); r.U32();
        Check(r.Failed(), "leer de mas marca fallo");
    }

    // Hello / Welcome / Reject
    {
        BitWriter w;
        Hello hello; hello.name = "Jairo"; hello.look = {1, 2, 3, 250};
        Write(w, hello);
        BitReader r(w.Data());
        Check(ReadType(r) == MessageType::Hello, "tipo Hello");
        const auto back = ReadHello(r);
        Check(back && back->name == "Jairo" && back->look == hello.look && back->protocol == kProtocolVersion, "Hello ida y vuelta");
    }
    {
        BitWriter w;
        Welcome welcome; welcome.playerId = 7; welcome.serverTick = 123456; welcome.worldSeed = 99;
        Write(w, welcome);
        BitReader r(w.Data());
        ReadType(r);
        const auto back = ReadWelcome(r);
        Check(back && back->playerId == 7 && back->serverTick == 123456 && back->worldSeed == 99 && back->tickRate == 30, "Welcome ida y vuelta");
    }
    {
        BitWriter w; Write(w, Reject{RejectReason::ServerFull});
        BitReader r(w.Data()); ReadType(r);
        const auto back = ReadReject(r);
        Check(back && back->reason == RejectReason::ServerFull, "Reject ida y vuelta");
    }

    // Input: direccion, rumbo y botones
    {
        BitWriter w;
        PlayerInput input; input.sequence = 4242; input.moveX = -0.5f; input.moveZ = 1.0f; input.yaw = 3.5f; input.buttons = kRun | kJump | kAttack;
        Write(w, input);
        Check(w.Size() == 1 + 4 + 1 + 1 + 2 + 2 || w.Size() <= 12, "el input cabe en una docena de bytes");
        BitReader r(w.Data()); ReadType(r);
        const auto back = ReadInput(r);
        Check(back && back->sequence == 4242 && back->buttons == (kRun | kJump | kAttack), "input: secuencia y botones");
        Check(back && Near(back->moveX, -0.5f, 0.01f) && Near(back->moveZ, 1.0f, 0.01f) && Near(back->yaw, 3.5f, 0.002f), "input: direccion y rumbo cuantizados");
        // el cero es exacto (si no, "quieto" llegaria como un movimiento diminuto)
        BitWriter wz; PlayerInput zero; Write(wz, zero);
        BitReader rz(wz.Data()); ReadType(rz);
        const auto zeroBack = ReadInput(rz);
        Check(zeroBack && zeroBack->moveX == 0.0f && zeroBack->moveZ == 0.0f, "el movimiento cero se conserva exacto");
        Check(back && std::fabs(back->moveX + 0.5f) < 0.005f, "ejes con error menor de 0,005");
        // rumbo fuera de [0, 2pi) y negativo: se envuelve
        BitWriter w2; PlayerInput wrap; wrap.yaw = -1.0f; Write(w2, wrap);
        BitReader r2(w2.Data()); ReadType(r2);
        const auto wrapped = ReadInput(r2);
        Check(wrapped && Near(wrapped->yaw, 6.2831853f - 1.0f, 0.002f), "rumbo negativo se envuelve");
    }

    // Snapshot: precision de posicion y tamano
    {
        BitWriter w;
        Snapshot snapshot; snapshot.serverTick = 900; snapshot.ackInput = 77;
        for (uint8_t i = 0; i < 8; ++i) {
            PlayerSnapshot p; p.id = i; p.x = 112.98f + i * 10.0f; p.y = 0.92f; p.z = -57.4f + i * 3.3f; p.yaw = 0.5f * i; p.speed = 1.5f * i; p.animation = i; p.flags = static_cast<uint8_t>(i & 3);
            snapshot.players.push_back(p);
        }
        Write(w, snapshot);
        BitReader r(w.Data()); ReadType(r);
        const auto back = ReadSnapshot(r);
        bool exact = back && back->players.size() == 8 && back->serverTick == 900 && back->ackInput == 77;
        float worst = 0.0f;
        if (exact) for (size_t i = 0; i < 8; ++i) {
            const auto& a = snapshot.players[i]; const auto& b = back->players[i];
            worst = std::max({worst, std::fabs(a.x - b.x), std::fabs(a.y - b.y), std::fabs(a.z - b.z)});
            exact = exact && a.id == b.id && a.animation == b.animation && a.flags == b.flags && Near(a.yaw, b.yaw, 0.007f) && Near(a.speed, b.speed, 0.16f);
        }
        Check(exact, "Snapshot ida y vuelta");
        Check(worst < 0.009f, "posicion con error menor de 9 mm");
        std::printf("Snapshot de 8 jugadores: %zu bytes (error maximo de posicion %.4f m)\n", w.Size(), worst);
        Check(w.Size() <= 8 * 14 + 16, "Snapshot de 8 jugadores cabe en ~130 bytes");
    }

    // Identificadores hasta 127 y tope de 48 jugadores por instantanea
    {
        BitWriter w;
        Snapshot big;
        for (uint32_t i = 0; i < 100; ++i) { PlayerSnapshot p; p.id = static_cast<uint8_t>(i + 1); p.x = 5.0f * i; big.players.push_back(p); }
        Write(w, big);
        BitReader r(w.Data()); ReadType(r);
        const auto back = ReadSnapshot(r);
        Check(back && back->players.size() == kMaxSnapshotEntries, "una instantanea lleva como mucho 48 jugadores");
        Check(back && back->players.back().id == kMaxSnapshotEntries, "los identificadores de 7 bits se conservan");
        BitWriter w2; PlayerSnapshot high; high.id = 127; Snapshot one; one.players.push_back(high); Write(w2, one);
        BitReader r2(w2.Data()); ReadType(r2);
        Check(ReadSnapshot(r2)->players[0].id == 127, "el identificador 127 cabe");
        std::printf("Snapshot de %zu jugadores: %zu bytes\n", kMaxSnapshotEntries, w.Size());
        Check(w.Size() <= 720, "una instantanea llena cabe en un paquete de 720 bytes");
    }

    // Robustez: truncar o corromper nunca debe romper la lectura
    {
        BitWriter w;
        Snapshot snapshot;
        for (uint8_t i = 0; i < 6; ++i) snapshot.players.push_back({i, 10.0f, 0.0f, 20.0f, 1.0f, 2.0f, 3, 4});
        Write(w, snapshot);
        for (size_t cut = 0; cut < w.Size(); ++cut) {
            BitReader r(w.Data().data(), cut);
            const auto type = ReadType(r);
            if (type == MessageType::Snapshot) Check(!ReadSnapshot(r) || cut >= w.Size() - 1, "snapshot truncado se rechaza");
        }
        std::mt19937 random(5);
        int rejected = 0, accepted = 0;
        for (int i = 0; i < 20000; ++i) {   // basura aleatoria: ningun lector debe caer
            std::vector<uint8_t> junk(random() % 48);
            for (auto& b : junk) b = static_cast<uint8_t>(random());
            BitReader r(junk);
            const auto type = ReadType(r);
            if (!type) { ++rejected; continue; }
            switch (*type) {
                case MessageType::Hello: (ReadHello(r) ? accepted : rejected)++; break;
                case MessageType::Welcome: (ReadWelcome(r) ? accepted : rejected)++; break;
                case MessageType::Reject: (ReadReject(r) ? accepted : rejected)++; break;
                case MessageType::Input: (ReadInput(r) ? accepted : rejected)++; break;
                case MessageType::Snapshot: (ReadSnapshot(r) ? accepted : rejected)++; break;
                case MessageType::Ping: case MessageType::Pong: (ReadPing(r) ? accepted : rejected)++; break;
                case MessageType::Chat: (ReadChat(r) ? accepted : rejected)++; break;
                default: ++rejected; break;
            }
        }
        std::printf("Basura aleatoria: %d rechazados, %d aceptados (sin caidas)\n", rejected, accepted);
        // un nombre demasiado largo se corta, y uno declarado mas largo de lo permitido se rechaza
        BitWriter longName; Hello hello; hello.name = std::string(100, 'x'); Write(longName, hello);
        BitReader r(longName.Data()); ReadType(r);
        const auto cut = ReadHello(r);
        Check(cut && cut->name.size() == kMaxNameLength, "nombre largo se corta al maximo");
        BitWriter bad; bad.U8(static_cast<uint32_t>(MessageType::Hello)); bad.U16(1); bad.U8(200);
        for (int i = 0; i < 200; ++i) bad.U8('a');
        BitReader rb(bad.Data()); ReadType(rb);
        Check(!ReadHello(rb), "nombre declarado mas largo del limite se rechaza");
    }

    // Simulador de red
    {
        NetSim lossy({0.0, 0.0, 20.0, 0.0}, 3);
        for (int i = 0; i < 10000; ++i) lossy.Send({1}, 0.0);
        const double rate = 100.0 * lossy.Lost() / lossy.Sent();
        std::printf("Perdida pedida 20 %%, observada %.1f %%\n", rate);
        Check(rate > 18.0 && rate < 22.0, "la perdida simulada es la pedida");

        NetSim laggy({100.0, 0.0, 0.0, 0.0}, 3);
        laggy.Send({1}, 0.0);
        Check(laggy.Receive(99.0).empty() && laggy.Receive(100.0).size() == 1, "la latencia retrasa exactamente");

        NetSim jitter({50.0, 40.0, 0.0, 0.0}, 3);
        for (int i = 0; i < 200; ++i) jitter.Send({static_cast<uint8_t>(i & 0xFF)}, i * 5.0);
        bool reordered = false;
        int previous = -1;
        for (double now = 0.0; now < 2000.0; now += 1.0)
            for (const auto& p : jitter.Receive(now)) { if (previous > p[0] && p[0] != 0 && previous != 255) reordered = true; previous = p[0]; }
        Check(reordered, "con jitter alto algunos paquetes llegan desordenados");

        NetSim duplicate({0.0, 0.0, 0.0, 50.0}, 3);
        for (int i = 0; i < 1000; ++i) duplicate.Send({1}, 0.0);
        Check(duplicate.Duplicated() > 400 && duplicate.Duplicated() < 600, "duplicados simulados");
    }

    // Golpe, golpe recibido y mundo compartido: ida y vuelta, y rechazo de paquetes truncados
    {
        StrikeCommand strike; strike.yaw = 2.0f; strike.kind = 3; strike.damage = 22.0f; strike.reach = 1.6f; strike.knockback = 1.5f;
        BitWriter w; Write(w, strike);
        BitReader r(w.Data());
        Check(ReadType(r) == MessageType::Strike, "tipo Strike");
        const auto back = ReadStrike(r);
        Check(back && back->kind == 3 && Near(back->yaw, 2.0f, 0.01f) && Near(back->damage, 22.0f, 0.2f) && Near(back->reach, 1.6f, 0.05f), "golpe ida y vuelta");
        StrikeCommand wild; wild.damage = 9999.0f; wild.reach = 500.0f; wild.knockback = 99.0f;
        BitWriter w2; Write(w2, wild);
        BitReader r2(w2.Data()); ReadType(r2);
        const auto clamped = ReadStrike(r2);
        Check(clamped && clamped->damage <= kMaxStrikeDamage + 0.01f && clamped->reach <= kMaxStrikeReach + 0.01f && clamped->knockback <= kMaxStrikeKnockback + 0.01f, "un golpe con valores absurdos se recorta al escribir");
        BitReader truncated(std::vector<uint8_t>{static_cast<uint8_t>(MessageType::Strike), 1});
        ReadType(truncated);
        Check(!ReadStrike(truncated).has_value(), "golpe truncado se rechaza");
        HitEvent hit; hit.kind = 2; hit.fromX = 0.6f; hit.fromZ = -0.8f;
        BitWriter w3; Write(w3, hit);
        BitReader r3(w3.Data()); ReadType(r3);
        const auto hitBack = ReadHit(r3);
        Check(hitBack && hitBack->kind == 2 && Near(hitBack->fromX, 0.6f, 0.02f) && Near(hitBack->fromZ, -0.8f, 0.02f), "golpe recibido ida y vuelta");
        WorldSnapshot world; world.tick = 77; world.day = 3; world.clock = 0.42f; world.elapsed = 123.456f; world.weather = 4; world.weatherRemaining = 90.0f; world.vehicleCount = 61;
        world.vehicles.push_back({12, 100.5f, 0.0f, 80.25f, 1.0f, 0.2f, 7.5f, 3, 2, false});
        world.pedestrians.push_back({5, 90.0f, 0.1f, 70.0f, 2.5f, 1.4f, 4, 1, true, false, true});
        world.buses.push_back({75.0f, 0.0f, -30.0f, 0.0f, -1.0f, 8.0f, 1.0f, true});
        BitWriter w4; Write(w4, world);
        BitReader r4(w4.Data()); ReadType(r4);
        const auto worldBack = ReadWorld(r4);
        Check(worldBack && worldBack->vehicles.size() == 1 && worldBack->pedestrians.size() == 1 && worldBack->buses.size() == 1 && worldBack->vehicleCount == 61 && worldBack->day == 3, "mundo ida y vuelta");
        if (worldBack) Check(Near(worldBack->vehicles[0].x, 100.5f, 0.02f) && worldBack->vehicles[0].variant == 3 && worldBack->pedestrians[0].police && Near(worldBack->elapsed, 123.456f, 0.01f), "valores del mundo");
        for (size_t cut = 1; cut < w4.Data().size(); cut += 7) {   // cualquier truncamiento se rechaza sin salirse del buffer
            std::vector<uint8_t> part(w4.Data().begin(), w4.Data().begin() + static_cast<long>(cut));
            BitReader tr(part); ReadType(tr);
            Check(!ReadWorld(tr).has_value(), "mundo truncado se rechaza");
        }
    }

    if (g_Failures == 0) std::printf("Protocolo de red: todo correcto\n");
    return g_Failures == 0 ? 0 : 1;
}
