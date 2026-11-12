// Prediccion y reconciliacion del jugador local, sin red real: un cliente (Predictor) y un servidor autoritativo se hablan por el simulador de red.
// Comprueba que con una red perfecta la prediccion coincide con el servidor, y que con latencia, jitter y perdida las correcciones son pequenas y
// el cliente termina exactamente donde esta el servidor.
#include "net/NetSim.hpp"
#include "net/PlayerSim.hpp"
#include "net/Prediction.hpp"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <random>

using namespace Bazuko;
using namespace Bazuko::Net;

static int failures = 0;
#define CHECK(condition, message) do { \
    if (!(condition)) { ++failures; std::printf("FALLO (%d): %s\n", __LINE__, message); } \
} while (0)

namespace {

struct Result { float maxCorrection = 0.0f, meanCorrection = 0.0f, finalError = 0.0f, maxAheadError = 0.0f; long corrections = 0, snapshots = 0, inputsLost = 0; };

Result Run(const NetSimConfig& up, const NetSimConfig& down, uint32_t seed, int seconds) {
    PlayerSession server;
    server.position = glm::vec3(100.0f, 0.0f, 100.0f);
    Predictor client(server);
    NetSim toServer(up, seed), toClient(down, seed + 1);
    std::mt19937 random(seed + 7);
    std::uniform_real_distribution<float> unit(0.0f, 1.0f);

    PlayerInput server_last;                  // ultima entrada del cliente que el servidor conoce
    uint32_t lastSequence = 0;
    Result result;
    double now = 0.0;
    float heading = 0.0f; bool running = false, walking = true;
    const int ticks = seconds * 30 + 150;      // al final se deja de enviar para que todo se asiente
    float sum = 0.0f;
    for (int tick = 0; tick < ticks; ++tick) {
        now = tick * (1000.0 / 30.0);
        // cliente: elige su entrada (camina en una direccion, la cambia cada ~1,5 s, a veces corre o se detiene), la cuantiza, la predice y la manda
        if (tick < seconds * 30) {
            if (tick % 45 == 0) { heading = unit(random) * 6.2831853f; running = unit(random) < 0.4f; walking = unit(random) < 0.85f; }
        } else walking = false;
        PlayerInput raw;
        raw.moveX = walking ? std::cos(heading) : 0.0f; raw.moveZ = walking ? std::sin(heading) : 0.0f;
        raw.buttons = static_cast<uint16_t>(running ? kRun : 0);
        raw.yaw = heading;
        PlayerInput sent = Quantized(raw);
        const uint32_t sequence = client.Apply(sent);
        sent.sequence = sequence;
        {
            BitWriter w; Write(w, sent);
            toServer.Send(w.Data(), now);
        }
        // servidor: toma la entrada mas nueva que haya llegado, la aplica cada paso y, cada 2 pasos, manda una instantanea
        for (const auto& packet : toServer.Receive(now)) {
            BitReader r(packet);
            if (ReadType(r) != MessageType::Input) continue;
            if (const auto input = ReadInput(r)) { if (input->sequence > lastSequence) { server_last = *input; lastSequence = input->sequence; } }
        }
        ApplyInput(server, server_last, FlatWorld(), kStepSeconds);
        if (tick % 2 == 0) {
            Snapshot snapshot; snapshot.serverTick = static_cast<uint32_t>(tick); snapshot.ackInput = lastSequence;
            snapshot.players.push_back(MakeSnapshot(1, server));
            BitWriter w; Write(w, snapshot);
            toClient.Send(w.Data(), now);
        }
        // cliente: recibe instantaneas
        for (const auto& packet : toClient.Receive(now)) {
            BitReader r(packet);
            if (ReadType(r) != MessageType::Snapshot) continue;
            const auto snapshot = ReadSnapshot(r);
            if (!snapshot || snapshot->players.empty()) continue;
            const float correction = client.Reconcile(snapshot->players[0], snapshot->ackInput);
            ++result.snapshots;
            result.maxCorrection = std::max(result.maxCorrection, correction);
            sum += correction; if (correction > 0.0005f) ++result.corrections;
        }
        // cuanto se aleja la prediccion de lo que el servidor tiene AHORA (adelanto legitimo por la latencia, no error)
        if (tick < seconds * 30) result.maxAheadError = std::max(result.maxAheadError, glm::distance(client.State().position, server.position));
    }
    result.meanCorrection = result.snapshots ? sum / static_cast<float>(result.snapshots) : 0.0f;
    result.finalError = glm::distance(client.State().position, server.position);
    if (result.finalError > 0.1f)
        std::printf("   (final: cliente %.3f,%.3f vel %.3f,%.3f pendientes %zu / servidor %.3f,%.3f vel %.3f,%.3f ultima secuencia %u)\n", client.State().position.x, client.State().position.z,
                    client.State().playerVelocity.x, client.State().playerVelocity.z, client.Pending(), server.position.x, server.position.z, server.playerVelocity.x, server.playerVelocity.z, lastSequence);
    result.inputsLost = static_cast<long>(toServer.Lost());
    return result;
}

} // namespace

int main() {
    // 1) red perfecta: la prediccion coincide con el servidor (correcciones de milimetros por la cuantizacion de la instantanea)
    {
        const Result r = Run({}, {}, 1, 40);
        std::printf("Red perfecta: correccion maxima %.4f m, media %.5f m, error final %.4f m (%ld instantaneas)\n", r.maxCorrection, r.meanCorrection, r.finalError, r.snapshots);
        CHECK(r.maxCorrection < 0.05f, "con red perfecta la prediccion casi no se corrige");
        CHECK(r.finalError < 0.02f, "el cliente termina donde esta el servidor");
    }
    // 2) latencia de 80 ms en cada sentido, sin perdida: el servidor ve las entradas con retraso pero en orden y todas
    {
        NetSimConfig lag; lag.lagMs = 80;
        const Result r = Run(lag, lag, 2, 40);
        std::printf("Lag 80 ms: correccion maxima %.4f m, media %.5f m, error final %.4f m, el cliente va %.1f m por delante como mucho\n", r.maxCorrection, r.meanCorrection, r.finalError, r.maxAheadError);
        CHECK(r.maxCorrection < 0.05f, "una latencia constante no obliga a corregir");
        CHECK(r.finalError < 0.02f, "termina donde esta el servidor");
    }
    // 3) mala conexion: 100 ms, 30 ms de jitter y 8 % de perdida en los dos sentidos
    {
        NetSimConfig bad; bad.lagMs = 100; bad.jitterMs = 30; bad.lossPercent = 8;
        const Result r = Run(bad, bad, 3, 60);
        std::printf("Mala red: correccion maxima %.4f m, media %.5f m, error final %.4f m, %ld correcciones de %ld, %ld entradas perdidas\n", r.maxCorrection, r.meanCorrection, r.finalError, r.corrections, r.snapshots, r.inputsLost);
        CHECK(r.maxCorrection < 2.0f, "las correcciones con perdida y jitter son de unos metros como mucho");
        CHECK(r.meanCorrection < 0.3f, "la correccion media es pequena");
        CHECK(r.finalError < 0.05f, "al dejar de moverse el cliente termina donde esta el servidor");
    }
    // 4) varias semillas con mala red: nunca diverge
    {
        NetSimConfig bad; bad.lagMs = 150; bad.jitterMs = 50; bad.lossPercent = 15;
        float worstFinal = 0.0f, worstMax = 0.0f;
        for (uint32_t seed = 10; seed < 20; ++seed) { const Result r = Run(bad, bad, seed, 30); worstFinal = std::max(worstFinal, r.finalError); worstMax = std::max(worstMax, r.maxCorrection); }
        std::printf("Red muy mala (150 ms, 50 ms de jitter, 15 %% de perdida) en 10 semillas: peor correccion %.3f m, peor error final %.4f m\n", worstMax, worstFinal);
        CHECK(worstFinal < 0.1f, "con cualquier semilla el cliente termina cerca del servidor");
    }
    // 5) la cola de entradas sin confirmar tiene limite
    {
        PlayerSession s; Predictor p(s);
        for (int i = 0; i < 1000; ++i) p.Apply(PlayerInput{});
        CHECK(p.Pending() <= 120, "las entradas sin confirmar no crecen sin limite");
    }
    if (failures == 0) std::printf("Prediccion: todo correcto\n");
    return failures == 0 ? 0 : 1;
}
