// Bus de eventos y utilidades de jugador del multijugador: cola con limite, suscriptores, y eleccion del jugador mas cercano.
#include "net/EventBus.hpp"

#include <cstdio>

using namespace Bazuko::Net;

static int failures = 0;
#define CHECK(condition, message) do { \
    if (!(condition)) { ++failures; std::printf("FALLO (%d): %s\n", __LINE__, message); } \
} while (0)

int main() {
    EventBus bus;
    int heard = 0;
    GameEventType lastType = GameEventType::Alarm;
    const size_t handle = bus.Subscribe([&](const GameEvent& e) { ++heard; lastType = e.type; });
    bus.Emit(GameEventType::MirrorStolen, 2, {10.0f, 0.0f, 20.0f}, 1.0f, 77);
    bus.Emit(GameEventType::Honk, 0, {1.0f, 0.0f, 2.0f});
    CHECK(heard == 2 && lastType == GameEventType::Honk, "el suscriptor oye cada evento al emitirse");
    CHECK(bus.Pending() == 2 && bus.Emitted() == 2, "la cola guarda lo emitido");
    const auto drained = bus.Drain();
    CHECK(drained.size() == 2 && drained[0].type == GameEventType::MirrorStolen && drained[0].player == 2 && drained[0].tick == 77, "Drain entrega en orden");
    CHECK(bus.Pending() == 0 && bus.Drain().empty(), "Drain vacia la cola");
    bus.Unsubscribe(handle);
    bus.Emit(GameEventType::Died, 1, {});
    CHECK(heard == 2, "tras desuscribirse ya no se oye");

    EventBus small;
    small.SetMaxQueued(3);
    for (int i = 0; i < 10; ++i) small.Emit(GameEventType::Shout, 0, {}, static_cast<float>(i));
    const auto kept = small.Drain();
    CHECK(kept.size() == 3 && kept.front().value == 7.0f && kept.back().value == 9.0f, "la cola tiene limite y conserva lo mas reciente");

    std::vector<PlayerView> players(3);
    players[0].id = 1; players[0].position = {0.0f, 0.0f, 0.0f};
    players[1].id = 2; players[1].position = {10.0f, 0.0f, 0.0f};
    players[2].id = 3; players[2].position = {4.0f, 0.0f, 0.0f}; players[2].alive = false;
    CHECK(NearestPlayer(players, {9.0f, 0.0f, 0.0f})->id == 2, "el mas cercano");
    CHECK(NearestPlayer(players, {4.5f, 0.0f, 0.0f})->id == 1 || NearestPlayer(players, {4.5f, 0.0f, 0.0f})->id == 2, "un jugador muerto no cuenta");
    CHECK(NearestPlayer(players, {4.1f, 0.0f, 0.0f})->id != 3, "ignora al jugador no vivo aunque este mas cerca");
    CHECK(NearestPlayer(players, {100.0f, 0.0f, 0.0f}, 20.0f) == nullptr, "fuera de alcance no hay ninguno");
    CHECK(NearestPlayer({}, {0.0f, 0.0f, 0.0f}) == nullptr, "sin jugadores devuelve nullptr");

    if (failures == 0) std::printf("Eventos y jugadores: todo correcto\n");
    return failures == 0 ? 0 : 1;
}
