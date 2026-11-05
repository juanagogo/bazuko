# Dónde el código asume un solo jugador

Inventario para el hito 1 del [plan multijugador](plan-multijugador.md). Medido en el código (no supuesto); no cambia nada del juego. Referencias a `src/world/Simulation.hpp` (SH) y `src/main.cpp` (M).

## 1. La simulación recibe una sola posición

| Función | Qué hace con «el jugador» | Qué haría con varios |
|---|---|---|
| `Update(dt, playerPosition)` (SH:363) | Reparte la posición a todos los subsistemas | Recibe `std::span<const PlayerView>` (ver `net/PlayerView.hpp`) |
| `UpdatePedestrians` (SH:569) | Peatones se asustan, huyen y se acercan al jugador | Reaccionan al más cercano (`NearestPlayer`) |
| `UpdateDrivers` (SH:570) | Conductores bravos, vigilan al jugador | El conductor bravo es de quien robó el espejo |
| `UpdatePickups` (SH:580) | Recoge objetos cerca del jugador | Cada jugador recoge los suyos; el servidor decide quién llega primero |
| `UpdatePigeons`, `UpdateRats` (SH:581, 584) | Huyen de una persona | Huyen del más cercano |
| `UpdatePsychosis` (SH:525) | Voces y alucinaciones del jugador | Es por jugador: sale del servidor como evento al cliente |
| `BeginPet(playerPosition, yaw)` (SH:413) | Acariciar al Chato | Un Chato por jugador, con su dueño |

## 2. El dibujo usa «el foco»

`Render(renderer, time, focusPosition)` y todas las consultas de luces (`GetHeadlightBeams`, `GetStrobeLights`, `GetNearestLampLights`, `GetCambucheFireLight`, `GetDealerFireLights`, `GetPedestrianBubbles`, `DrawArticulatedBus`) reciben el foco para **descartar lo lejano**. En el cliente seguirá siendo la posición del jugador local; no hay que cambiarlas. Lo que sí cambia: dibujar a **otros jugadores** (personaje con su `Look` y animación por velocidad).

## 3. Estado del jugador mezclado con el mundo

- Miembros de `Simulation` que son del jugador: `m_PlayerFacing`, `m_PlayerHygiene`, `m_PlayerHits`, y los setters `SetPlayerFacing`, `SetPlayerHygiene`, `SetMissionProgress`, `SetCambucheState`, `SetDogState/Look/Coat`. Pasan a un `PlayerSession` por jugador.
- `SetDay`, `SetDayProgress` (4 y 2 llamadas desde `main.cpp`) son del **mundo** y los fija el servidor.
- El cambuche (`SetCambucheState`) y el Chato (`SetDogState`) son por jugador: el mundo dibuja uno por cada sesión.

## 4. `main.cpp` hace de servidor y de cliente a la vez

~106 usos de `playerPos`. Las zonas que habría que partir:

1. **Entrada y movimiento** (teclado, mando, física, salto, agua, ragdoll): pasa al `PlayerController` con un `PlayerInput`. El cliente lo predice; el servidor lo valida (`ToyServer::Step` es el modelo de juguete).
2. **Necesidades, enfermedades, clima y frío**: autoritativos en el servidor; el cliente solo los muestra.
3. **Inventario, tiendas, fabricación, reciclador, dealer y jíbaro**: comandos validados por el servidor (`net/ProfileStore::Sanitize` ya define lo que es un inventario legítimo).
4. **Combate y robos**: el servidor comprueba distancia, orientación y obstáculos (ya existe `MeleeCombat`).
5. **UI** (HUD, mapa, costal, pausa): solo cliente. En línea la pausa **no detiene** el mundo.
6. **Guardado**: del `savegame.json` local a un perfil por jugador en el servidor (`ProfileStore`).

## 5. Eventos que hoy son llamadas directas

Estos eventos disparan audio o efectos desde la lógica; irían por `net/EventBus`:
`mirror-stolen`, `substance-consumed`, `sleep-start`, claxon y alarmas, golpes recibidos y dados, arresto, muerte y recuperación, compra, recoger objeto, subir y bajar de vehículo, choque.

## 6. Azar y tiempo

- El mundo se siembra con **42** (`main.cpp`); ahora se puede cambiar con `BAZUKO_SEED`. En red lo fija el servidor y lo manda en `Welcome::worldSeed`.
- La prueba `bazuko_simulation_hash` demuestra que, con la misma semilla, la simulación es reproducible: es la red de seguridad de esta refactorización.
- `lootRandom` (`main.cpp`) usa `std::random_device`: el botín debe pasar al servidor para que no se pueda repetir una tirada.

## Orden sugerido para el hito 1

1. `PlayerView` y `NearestPlayer` en aves y ratas (el sistema más simple y sin efectos laterales).
2. Peatones (susto, huida); comprobar el hash con un solo jugador.
3. Tráfico y semáforos (frenan ante cualquiera).
4. Policía y persecución (la parte con más reglas).
5. Sacar el estado de jugador de `Simulation` a `PlayerSession`.
6. Emitir los eventos por el `EventBus` en paralelo y retirar las llamadas directas cuando coincidan.
