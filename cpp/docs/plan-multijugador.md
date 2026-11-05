# Plan: multijugador en línea para el port C++

Estado de partida (revisado en el código, no supuesto):

- `Simulation::Update(dt, playerPosition)` y `Simulation::Render(renderer, time, focusPosition)` reciben **una sola posición**. Peatones, tráfico, aves, ratas, policía y el Chato reaccionan a ese único jugador.
- El jugador vive en `main.cpp` (2 769 líneas, ~106 usos de `playerPos`): movimiento, física, combate, inventario, necesidades, UI y bucle de juego conviven ahí. `game/PlayerState.hpp` solo tiene el inventario y la regeneración.
- `Simulation.cpp` (6 300 líneas) mezcla lógica y dibujo en una misma clase; el azar sale de un único `std::mt19937 m_Random`.
- Los menús (costal, tienda, mapa, pausa, dormir) **detienen la simulación**. En red eso no puede ser así.
- El guardado es un `savegame.json` local.

## Decisiones de arquitectura

| Tema | Decisión | Por qué |
|---|---|---|
| Modelo | **Servidor autoritativo** (mismo ejecutable con `--servidor`, sin ventana ni GPU) | Evita trampas, un solo mundo, funciona en un VPS |
| Qué es compartido | Tráfico, peatones, fauna, policía, semáforos, reloj, clima, el Chato de cada jugador | Es lo que hace que «sea el mismo mundo» |
| Qué es por jugador | Inventario, dinero, necesidades, cambuche, `steal.buscado`, apariencia | Progresión propia, sin dependencias entre cuentas |
| Transporte | **UDP fiable** con ENet o GameNetworkingSockets (decidir en el hito 1) | No escribir sockets a mano |
| Tasa | Simulación del servidor a 30 Hz; instantáneas a 15–20 Hz; input del cliente a 30 Hz | Equilibrio de ancho de banda y respuesta |
| Cliente | Predicción y reconciliación del jugador local; **interpolación ~100 ms** del resto | Es lo que se siente fluido |
| Datos | Instantáneas con **delta y radio de interés** (~120 m) | ~80 peatones + tráfico no caben enteros a 20 Hz |
| Persistencia | Servidor guarda por identificador de jugador (JSON o SQLite) | Sustituye al `savegame.json` local |

Fuera de alcance de la primera versión: voz, matchmaking público, anticheat, cuentas con contraseña, más de 8 jugadores por servidor.

## Resultados del hito 0 (medido)

`bazuko_simulation_hash_test` (en `ctest`, 20 s) corre la simulación real con semilla 42 y el jugador frente al cambuche:

- **La simulación es determinista** dentro de un mismo equipo: dos simulaciones nuevas dan el mismo hash en 13 de 13 puntos de control (60 s). Es la red de seguridad para el hito 1 (`--esperado <hash>` compara con un hash guardado).
- **Presupuesto de red**: el mundo es pequeño (28 carros, 22 peatones, 2 buses). Una instantánea **completa** con posiciones cuantizadas pesa ~512 B, es decir ~10 KB/s por cliente a 20 Hz, y baja a 1,6–9 KB/s con radio de interés de 120 m. El ancho de banda **no es un problema**; el costo del multijugador está en la lógica, no en la red.
- `Simulation` expone ahora `GetPedestrians()` (solo lectura) para pruebas y para la futura serialización.

## Hitos

Cada hito termina con algo ejecutable y una comprobación concreta. No se empieza el siguiente sin cerrar el anterior.

### Hito 0 — Pruebas y mediciones de base (1–2 días)
- Prueba que ejecuta N segundos de simulación con semilla fija y compara un hash del estado (posiciones de vehículos y peatones). Sirve para detectar que la refactorización **no cambia el comportamiento**.
- Medir cuánto tarda `Simulation::Update` y cuántos bytes tendría el estado de tráfico + peatones serializado.
- **Listo cuando:** `ctest` incluye la prueba de hash y pasa con el juego actual.

### Hito 1 — Separar simulación de presentación (2–4 semanas) · *el más pesado*
1. Extraer de `Simulation` un núcleo `SimulationCore` sin `Renderer`, `Mesh`, `Model`, `Audio` ni ImGui (estado y reglas). El dibujo pasa a `SimulationView`, que **lee** ese estado.
2. Cambiar `Update(dt, playerPosition)` por `Update(dt, std::span<const PlayerView>)`, con `PlayerView {id, posición, velocidad, yaw, en_vehículo, buscado}`.
3. Cada comportamiento que miraba «al jugador» elige al **más cercano** o al relevante: aves y ratas (huyen del más cercano), peatones (se asustan por cualquiera), tráfico (frena ante cualquiera), patrulla (persigue al de mayor `buscado` en su campo de visión).
4. Sacar de `main.cpp` un `PlayerController` (movimiento, física, combate, necesidades, inventario) que funcione sin UI y reciba un `PlayerInput`.
5. El audio y los efectos visuales se disparan con **eventos** (`MirrorStolen`, `Honk`, `HitTaken`…), no llamándose desde la lógica.
6. Un único generador de azar con semilla explícita en el servidor.
- **Listo cuando:** el juego de un jugador se ve y suena igual, `ctest` pasa y la prueba de hash del hito 0 da el mismo resultado con 1 jugador.
- **Riesgo:** regresiones sutiles. Mitigación: hacerlo por sistemas (aves → ratas → peatones → tráfico → policía), con el hash comprobado tras cada uno.

### Hito 2 — Red mínima: se ven caminar entre ellos (1–2 semanas)
1. Biblioteca de red integrada en CMake. Módulo `net/` con `Server`, `Client`, `Packet` (serialización binaria con versión de protocolo).
2. Conexión, identificador, apariencia (`Look`) y desconexión.
3. Cliente envía `PlayerInput` con número de secuencia; servidor mueve al jugador y devuelve su posición.
4. Otros jugadores se dibujan con el modelo del personaje y sus animaciones (idle/walk/run por velocidad), interpolados.
5. Modo host: el ejecutable puede lanzar servidor y cliente local a la vez, para probar sin segunda máquina.
- **Listo cuando:** dos clientes en la misma máquina (y luego en dos máquinas) se ven moverse, con 100 ms de latencia simulada sin saltos.
- Herramienta: variable para inyectar latencia y pérdida de paquetes (`BAZUKO_NET_LAG`, `BAZUKO_NET_LOSS`).

### Hito 3 — Mundo compartido: tráfico, peatones, fauna (2–3 semanas)
1. Instantáneas con delta de vehículos (posición, yaw, velocidad, ruta, luces/claxon), peatones (posición, estado, clip), aves, ratas, buses y semáforos.
2. Radio de interés por cliente y prioridad por distancia; las entidades lejanas se envían a menor frecuencia.
3. El cliente **no simula** tráfico ni peatones: solo los interpola y los dibuja. La simulación local desaparece en modo en línea.
4. Reloj y clima sincronizados (hora de servidor + tasa).
5. Mantener fuera de red las cosas puramente visuales (hierba, brillos, partículas locales).
- **Listo cuando:** dos clientes ven los mismos carros y peatones en los mismos lugares (diferencia < 1 m tras interpolar) y el ancho de banda medido por cliente es < 60 KB/s.

### Hito 4 — Interacciones y economía (2–3 semanas)
1. Comandos del cliente validados por el servidor: recoger/soltar, comprar y vender (tienda, jíbaro, reciclador), consumir, fabricar, cosquilleo/robo de espejos, golpes y armas.
2. Inventario y dinero en el servidor; el cliente solo lo muestra.
3. Combate entre jugadores y contra NPC con **verificación de distancia, orientación y obstáculos en el servidor** (ya existe `MeleeCombat`; se reutiliza ahí).
4. Reglas de PvP decididas por el servidor (activo/inactivo, daño, castigo) y robo entre jugadores como opción.
5. Eventos al cliente (`substance-consumed`, golpes recibidos, aviso de policía) para sus efectos de imagen y sonido.
- **Listo cuando:** dos jugadores pueden comprar, robar un espejo y pelearse sin que ninguno pueda dar dinero o ítems falsos con un cliente modificado.

### Hito 5 — Policía, vehículos conducidos y mascota (2 semanas)
1. Persecución por `steal.buscado` de cada jugador; qué patrulla persigue a quién y cómo se reparten.
2. Entrar y conducir vehículos (motos y carros): el servidor integra el vehículo y los demás lo ven interpolado; la colisión con peatones y jugadores en el servidor.
3. El Chato: uno por jugador, simulado en el servidor, sincronizado por posición, clip y estado.
4. Conductores bravos, «limpieza social» y demás sistemas temporales: se instancian **por jugador** (el servidor los lanza cerca de quien corresponde).
- **Listo cuando:** una persecución con dos jugadores cerca no deja a la patrulla indecisa ni parpadeando entre objetivos.

### Hito 6 — Menús sin pausa, dormir y muerte (1–2 semanas)
1. Quitar la pausa de simulación al abrir costal, tienda, mapa o pausa en modo en línea; el jugador queda **vulnerable** y la UI lo indica.
2. Dormir: se pasa el tiempo solo si todos los jugadores cercanos duermen, o se limita a una siesta que no avance el reloj global (decisión de diseño pendiente).
3. Muerte y recuperación: el servidor conserva la causa, el sitio y la pantalla de cartón; la recuperación sigue siendo explícita.
4. Cierre limpio de sesión: soltar vehículos, avisar y guardar.
- **Listo cuando:** abrir el costal no congela el mundo para nadie y morir/recuperarse funciona sin dejar al jugador teletransportado.

### Hito 7 — Persistencia y sesiones (1–2 semanas)
1. Identificador de jugador (clave local generada al primer arranque) y guardado en servidor por esa clave: posición, inventario, dinero, necesidades, talentos, cambuche, apariencia, `steal.buscado`.
2. Reglas de reaparición (los jugadores empiezan frente a su cambuche, como hoy).
3. Migración del `savegame.json` actual como «perfil inicial» opcional.
4. Pantalla de conexión: IP/puerto, nombre del jugador y apariencia; lista de jugadores y chat simple.
- **Listo cuando:** salir y volver a entrar en el mismo servidor conserva todo lo que hoy conserva un guardado.

### Hito 8 — Robustez, seguridad y operación (2 semanas)
- Tiempos de espera, reconexión, límite de velocidad de paquetes, validación de tamaños y de rangos en todo lo que llega.
- Servidor dedicado (Linux): construcción sin GPU, registro (`log`) y parámetros (`--puerto`, `--jugadores`, `--semilla`).
- Pruebas: carga con jugadores simulados (bots), 5 % de pérdida, 200 ms de latencia, y una prueba larga (30 min) de estabilidad.
- Documentación: cómo alojar, cómo conectarse, requisitos de red y puertos.
- **Listo cuando:** 8 jugadores durante 30 minutos sin caídas ni derivas visibles, CPU del servidor < 50 % de un núcleo.

## Estimación global

| Hito | Esfuerzo | Acumulado |
|---|---|---|
| 0 Línea base | 1–2 días | 0,3 sem |
| 1 Separar sim/dibujo | 2–4 sem | ~4 sem |
| 2 Red mínima | 1–2 sem | ~6 sem |
| 3 Mundo compartido | 2–3 sem | ~9 sem |
| 4 Interacciones | 2–3 sem | ~12 sem |
| 5 Policía/vehículos/Chato | ~2 sem | ~14 sem |
| 6 Menús, dormir, muerte | 1–2 sem | ~16 sem |
| 7 Persistencia | 1–2 sem | ~18 sem |
| 8 Robustez | ~2 sem | ~20 sem |

Primer punto jugable en grupo: **hito 3** (~9 semanas). Lo más arriesgado es el hito 1.

## Riesgos principales

1. **Refactorización de `Simulation`** (muy acoplada al dibujo y a un jugador): hacerla por sistemas y con la prueba de hash.
2. **Ancho de banda del tráfico y los peatones**: delta + radio de interés + frecuencia por distancia; medir desde el hito 3.
3. **Pausa de menús**: cambia el ritmo de juego; requiere decisiones de diseño (vulnerabilidad mientras se abre el costal).
4. **Sistemas pensados para un jugador** (limpieza social, conductor bravo, psicosis, efectos de sustancias): decidir cuáles son por jugador y cuáles globales antes del hito 5.
5. **Determinismo**: no se exige entre máquinas (el servidor manda), así que no hace falta aritmética determinista; sí una semilla explícita para reproducir errores.
6. **Licencias**: un servidor público distribuye modelos; mantener los restringidos fuera (ya excluidos).

## Decisiones que necesito de ti antes de empezar

1. ¿Servidor dedicado (alguien lo aloja) o «anfitrión» (un jugador es el servidor)? El plan sirve para ambos; la diferencia es cómo se empaqueta.
2. ¿PvP activo por defecto, opcional por servidor o desactivado?
3. ¿Dormir avanza el reloj del mundo para todos?
4. ¿Cuántos jugadores como objetivo (4, 8, 16)?
5. ¿Plataformas del servidor (Windows, Linux, ambas)?

## Primer paso propuesto

Empezar por el **hito 0 y el inicio del hito 1** (prueba de hash + `PlayerView` en aves y ratas), que es reversible, no cambia el juego y revela rápido cuánto cuesta el resto.
