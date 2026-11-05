# Plan: multijugador en línea para el port C++

Estado de partida (revisado en el código, no supuesto):

- `Simulation::Update(dt, playerPosition)` y `Simulation::Render(renderer, time, focusPosition)` reciben **una sola posición**. Peatones, tráfico, aves, ratas, policía y el Chato reaccionan a ese único jugador.
- El jugador vive en `main.cpp` (2 769 líneas, ~106 usos de `playerPos`): movimiento, física, combate, inventario, necesidades, UI y bucle de juego conviven ahí. `game/PlayerState.hpp` solo tiene el inventario y la regeneración.
- `Simulation.cpp` (6 300 líneas) mezcla lógica y dibujo en una misma clase; el azar sale de un único `std::mt19937 m_Random`.
- Los menús (costal, tienda, mapa, pausa, dormir) **detienen la simulación**. En red eso no puede ser así.
- El guardado es un `savegame.json` local.

## Decisiones tomadas (5 de noviembre de 2026)

| Tema | Decisión | Consecuencia principal |
|---|---|---|
| Servidor | **Anfitrión rotativo**: un jugador aloja el mundo y, si se va, otro lo releva | El estado del mundo debe poder **transferirse**; hace falta encontrar al anfitrión (salas) y llegar a él a través de NAT |
| PvP | **Activo** | El servidor valida cada golpe con compensación de latencia; reglas contra el acoso |
| Dormir | **No disponible en multijugador** | El reloj del mundo es continuo; la energía se recupera descansando (sin saltar el tiempo) |
| Jugadores por mundo | **100 (cifra de pruebas)** | Radio de interés, frecuencia por distancia y tope por paquete; el ancho de banda del anfitrión es el límite |
| Plataformas | **Windows, Linux (nativo y con Proton/Wine) y macOS** | macOS está **bloqueado por OpenGL 4.5** (ver más abajo) |

### Anfitrión rotativo: qué exige

Interpretación: el anfitrión puede **cambiar sin cortar la partida** (cuando se desconecta, y opcionalmente por cesión voluntaria o por bajo rendimiento). Para eso:

1. **Estado transferible.** El anfitrión envía a un *sucesor* un *checkpoint* completo cada pocos segundos: reloj, clima, jugadores conectados, posiciones del mundo (medido: ~512 B para tráfico y peatones) y objetos persistentes. La IA interna (rutas, carriles) no se serializa: el nuevo anfitrión la **reconstruye proyectando cada vehículo y peatón a su ruta más cercana**. Hay un instante de relevo (~1–3 s) que se disimula con la misma pantalla de «reconectando».
2. **Elección del sucesor** por puntaje: latencia media con el resto, ancho de subida medido, FPS/CPU y tipo de NAT; se recalcula a lo largo de la sesión y se anuncia a todos.
3. **El perfil vive en cada jugador**, no en el anfitrión: inventario, dinero y cambuche se guardan en su equipo (`ProfileStore`) y el anfitrión solo los valida (`Sanitize`). Así un relevo no pierde nada.
4. **Conectividad.** ENet no atraviesa NAT. Hay que añadir ICE/STUN y un relay de respaldo detrás de la interfaz `Host` (ya aísla el transporte). Candidatos: **libdatachannel** (WebRTC: ICE, cifrado DTLS, mensajes fiables y no fiables, portable a las tres plataformas) o GameNetworkingSockets. ENet se conserva para LAN y pruebas.
5. **Un servicio mínimo de salas** (código de sala, señalización y relay). «Sin servidor propio» no es del todo posible: alguien tiene que ayudar a que los jugadores se encuentren y, si el NAT no deja, a retransmitir. Es un servicio pequeño (un VPS barato).
6. **Confianza.** El anfitrión es la autoridad y **puede hacer trampa**. Es aceptable para amigos y pruebas; no hay garantías competitivas. El relay oculta las IP entre jugadores.

### PvP: reglas propuestas (a validar)

- Golpes validados por el servidor con **rebobinado de posiciones hasta 200 ms** (compensación de latencia) y las mismas comprobaciones de distancia, orientación y obstáculos de `MeleeCombat`.
- **Protección al reaparecer** (3 s de invulnerabilidad) y sin pelea dentro de la estación ni a menos de 15 m del cambuche propio (propuesta de zona segura).
- Sin marcadores de bajas, sin logros: coherente con el tono del juego. El anfitrión puede **silenciar y expulsar**.
- Qué pierde quien muere ya existe (`perdidoAlMorir`); robar a otros jugadores sería una opción del anfitrión, apagada por defecto.

### Dormir apagado: cambios

- Se desactivan `sleep-start`, la cama y la rama de pausa de `Game._loop` en modo en línea; `Player.updateSleepPose` no se usa.
- La **energía** se recupera *descansando* (sentado o echado junto al cambuche o en un banco), más lenta que dormir y sin saltar el reloj. Hay que diseñar el ritmo para que no sea un castigo.
- En el modo historia (un jugador) dormir sigue existiendo.

### 100 jugadores: lo medido

`bazuko_net_bots --servidor` con 100 bots **todos juntos** (el peor caso):

| Medida | Resultado |
|---|---|
| CPU del servidor de juguete | **~6 % de un núcleo** (Update medio 2 ms, peor 4,6 ms) |
| Salida del anfitrión | **~930 KB/s ≈ 7,4 Mbit/s** (~9,3 KB/s por jugador) |
| Instantánea llena (48 jugadores) | 544 bytes (cabe en un paquete) |

La CPU de la red no es el problema; **la subida del anfitrión sí**: 7,4 Mbit/s es demasiado para muchas conexiones domésticas. Plan de reducción a < 3 Mbit/s (hito D): posiciones relativas al receptor (~7 B por jugador en lugar de 11), 15 Hz para lo cercano, omitir a los quietos (delta), y límite de jugadores recomendado según la subida medida del anfitrión. El coste real del anfitrión será la simulación y el dibujo de su propio cliente: opción de **anfitrión sin ventana** para sesiones grandes.

### Plataformas

- **Windows**: nativo (es lo que se compila y prueba hoy).
- **Linux**: compilación nativa con GCC/Clang (el `CMakeLists.txt` ya lo contempla) y ejecución del `.exe` con **Proton/Wine**. Ambas exponen el OpenGL 4.5 del controlador, así que el renderer debería funcionar; la red (`ws2_32` en Wine) también. **No se ha probado todavía**: es el hito E.
- **macOS: bloqueo técnico.** El renderer usa **OpenGL 4.5 core**: ~96 llamadas de acceso directo al estado, *shader storage buffers* para las luces por clúster y shaders `#version 450`. macOS solo ofrece **OpenGL 4.1** (obsoleto) y no soporta compute ni SSBO en OpenGL. Wine y Game Porting Toolkit traducen DirectX, no OpenGL 4.5, así que tampoco ayudan. Para tener cliente de Mac hay que elegir:
  - **A.** Bajar el renderer a OpenGL 4.1 (sin acceso directo al estado ni SSBO; luces por clúster en texturas/UBO): ~4–8 semanas y probable pérdida de rendimiento.
  - **B.** Backend Vulkan con MoltenVK: más trabajo, pero es el camino a largo plazo.
  - **C.** En Mac, solo servidor/anfitrión **sin ventana** (la simulación sin GL es portable una vez hecho el hito 1) y cliente por otra vía.
  Mi recomendación: decidirlo después del hito 3; hasta entonces, mantener todo el código de red y simulación **libre de OpenGL** (ya lo está).

## Decisiones de arquitectura

| Tema | Decisión | Por qué |
|---|---|---|
| Modelo | **Anfitrión autoritativo rotativo** (un jugador; el mismo ejecutable también puede correr sin ventana) | Un solo mundo, sin servidor dedicado; relevo del anfitrión |
| Qué es compartido | Tráfico, peatones, fauna, policía, semáforos, reloj, clima, el Chato de cada jugador | Es lo que hace que «sea el mismo mundo» |
| Qué es por jugador | Inventario, dinero, necesidades, cambuche, `steal.buscado`, apariencia | Progresión propia, sin dependencias entre cuentas |
| Transporte | **UDP fiable** con ENet o GameNetworkingSockets (decidir en el hito 1) | No escribir sockets a mano |
| Tasa | Simulación del servidor a 30 Hz; instantáneas a 15–20 Hz; input del cliente a 30 Hz | Equilibrio de ancho de banda y respuesta |
| Cliente | Predicción y reconciliación del jugador local; **interpolación ~100 ms** del resto | Es lo que se siente fluido |
| Datos | Instantáneas con **delta y radio de interés** (~120 m) | ~80 peatones + tráfico no caben enteros a 20 Hz |
| Persistencia | **Cada jugador guarda su perfil** (`ProfileStore`); el anfitrión lo valida con `Sanitize` | Un relevo de anfitrión no pierde nada |

Fuera de alcance de la primera versión: voz, matchmaking público, anticheat, cuentas con contraseña, más de 8 jugadores por servidor.

## Resultados del hito 0 (medido)

`bazuko_simulation_hash_test` (en `ctest`, 20 s) corre la simulación real con semilla 42 y el jugador frente al cambuche:

- **La simulación es determinista** dentro de un mismo equipo: dos simulaciones nuevas dan el mismo hash en 13 de 13 puntos de control (60 s). Es la red de seguridad para el hito 1 (`--esperado <hash>` compara con un hash guardado).
- **Presupuesto de red**: el mundo es pequeño (28 carros, 22 peatones, 2 buses). Una instantánea **completa** con posiciones cuantizadas pesa ~512 B, es decir ~10 KB/s por cliente a 20 Hz, y baja a 1,6–9 KB/s con radio de interés de 120 m. El ancho de banda **no es un problema**; el costo del multijugador está en la lógica, no en la red.
- `Simulation` expone ahora `GetPedestrians()` (solo lectura) para pruebas y para la futura serialización.

## Avance del hito 1 (primeros pasos hechos)

- **Aves y ratas ya son multijugador.** `Simulation::Update(dt, const std::vector<Net::PlayerView>&)` acepta varios jugadores; `BirdFlock::Update` sigue la velocidad de cada uno por separado (parado, caminando o corriendo) y las aves huyen del más cercano; las ratas se asustan del jugador o peatón más cercano. El resto de sistemas (peatones, tráfico, policía, recogida de objetos, psicosis) sigue usando al primer jugador hasta migrarse. El juego de un jugador (`Update(dt, vec3)`) no cambia.
- **Se corrigió un estado oculto del mundo**: `s_SpotCursor` (la búsqueda de sitios donde aparecen bolsas de basura) era una variable `static`, así que sobrevivía entre mundos en el mismo proceso. Con la semilla 7 hacía que dos simulaciones seguidas divergieran a los ~50 s. Ahora es un miembro (`m_TrashSpotCursor`); para la primera simulación el resultado es idéntico. Importa para el relevo de anfitrión: un mundo nuevo no hereda nada del anterior.
- **Red de seguridad ampliada** (`bazuko_simulation_hash`): el hash incluye aves y ratas; comprueba que dos simulaciones son iguales y que **un segundo jugador lejano no altera el mundo cerca del primero**.
- **Hashes de referencia** (120 s, jugador frente al cambuche, este equipo y compilador; incluyen carros, peatones, buses, aves, ratas, bolsas y el Chato): semilla 42 → `6b482f2217bb6fef`; semilla 7 → `3a281df13e1e567c`. Tras cada paso del hito 1 deben seguir iguales (`bazuko_simulation_hash_test.exe 120 42`). (Antes de añadir las bolsas al hash eran `f3bea226476185c2` y `d751c7b74f6082b6`; ese cambio fue solo de la prueba, no del juego.)
- **Peatones multijugador.** Aparecen por turnos alrededor de cada jugador (con un solo jugador, igual que antes: 22 de día y 9 de noche; cada jugador extra suma 8 de día y 4 de noche hasta 110 y 50). Saludan o se quejan del olor al jugador más cercano (la higiene solo se conoce del primero por ahora), huyen y atacan al más cercano, y solo se retiran o se empujan entre sí cuando están lejos de **todos**. Los golpes de un peatón llevan el id del jugador golpeado (`ConsumePlayerHitFor`). Medido: con dos jugadores a 190 m, 30 peatones, 16 junto al primero y 14 junto al segundo; con uno, los hashes de referencia no cambian.
- **Tráfico y policía multijugador.** El movimiento del tráfico no depende del jugador (los carros frenan ante peatones; al jugador lo atropella la colisión, por diseño), así que no cambió. Lo que sí: los carros abandonados reaparecen fuera de la vista de **todos** los jugadores, la distancia de cada conductor es a la persona más cercana, y `CallPolice(at, chance, byPlayer)` guarda a quién acude la patrulla despachada (`DriverInfo::targetPlayer`): va tras **su** jugador aunque haya otros más cerca. Medido con dos jugadores a 190 m: la patrulla despachada por el delito del segundo llegó a 13 m de él y se quedó a 68 m del primero (semillas 42 y 7). Con un solo jugador los hashes de referencia no cambian.
- **Bolsas y estado del jugador.** Las bolsas de basura aparecen fuera de la vista de **todos** los jugadores (a más de 12 m y no justo delante de nadie) y su tope sube 8 por jugador extra (35 con uno). Comprobado con dos jugadores: 39 bolsas, ninguna a menos de 12 m de alguno; con uno, el hash (ahora con bolsas) es idéntico antes y después del cambio. `PlayerView` ya lleva la **higiene** y la **orientación** de cada jugador (antes eran variables únicas de `Simulation`), así que los peatones se quejan del olor del jugador que tienen cerca y no del primero.
- **Psicosis**: son alucinaciones del jugador local, solo se dibujan en su pantalla; se queda como efecto **local del cliente** (no se sincroniza).
- **`main()` mapeado y estado reunido.** [`multijugador-main.md`](multijugador-main.md) reparte las ~2 700 líneas de `main()` por capas (≈25 % servidor, 55 % cliente, 20 % mixto) y lista las ~100 variables del jugador. Ese estado vive ahora en `game/PlayerSession.hpp` (84 miembros) y `main()` lo usa con referencias de los mismos nombres: ni una línea de lógica cambió. Verificado con captura idéntica (0,23 % de píxeles distintos frente a 0,08 % de ruido entre corridas) y `savegame.json` con las mismas 35 claves.
- **Supervivencia extraída de `main()`** a `game/Survival.cpp`, con prueba diferencial contra el código original (600 000 pasos idénticos). Una corrida nocturna de 10 s da las mismas necesidades que antes (diferencia máxima 0,0002 por el tiempo entre cuadros).
- **Economía extraída de `main()`** a `game/Economy.cpp` (inventario, venta, compra, fabricación, consumo, experiencia, soltar objetos e infección al rebuscar), con prueba diferencial de 300 000 operaciones contra las lambdas originales. Limitación: la prueba demuestra que las reglas son idénticas; el cableado de sonidos y avisos en `main()` se verificó compilando, arrancando el juego y comparando el guardado, pero no con una partida interactiva.
- **Movimiento extraído de `main()`** a `game/Movement.cpp` con prueba diferencial de 300 000 cuadros; caminando solo 8 s el personaje termina en la misma posición que antes (74,978 frente a 74,979).
- **Pelea extraída de `main()`** a `game/Fight.cpp` (recibir golpes, esquivar, tambaleo y la acción en curso), con prueba diferencial de 300 000 pasos. La caricia al Chato en una sesión normal da el mismo resultado que antes (+5 de ánimo).
- **Entrada separada**: `PlayerInput` (intenciones del jugador en un cuadro) + `PlayerInputSampler` (teclado a intenciones); `main()` ya no lee las teclas de juego. Verificado con la prueba de `MoveDirection` (64 000 casos), autowalk 74,975 y caricia +5, y 23 tests. Limitación: las teclas reales (WASD, shift, control, espacio, J/K/G/H, clic, E, F, Q, B/L, 1–5, Z/X) no se pueden simular aquí: conviene probarlas a mano.
- **Prediccion y reconciliacion del jugador local** (núcleo del hito 2, ya probado sin red real): `net/PlayerSim` aplica un `Net::PlayerInput` con **las mismas reglas de `game/Movement`** en cliente y servidor; `net/Prediction.hpp` (`Predictor`) predice al instante, guarda las entradas sin confirmar y, al llegar una instantánea con `ackInput`, toma el estado autoritativo y vuelve a aplicar lo pendiente. `bazuko_prediction_test` (cliente y servidor hablando por `NetSim`): red perfecta → corrección máxima **1 cm**; 80 ms de latencia constante → 0,9 cm (el cliente va 0,6 m por delante, adelanto legítimo); 100 ms ±30 y 8 % de pérdida → corrección máxima 0,40 m y media 7,6 cm; 150 ms ±50 y 15 % de pérdida en 10 semillas → peor corrección 1,0 m y el cliente siempre termina a **5 mm** del servidor. El servidor de juguete ya avanza a sus jugadores con estas reglas (pasos fijos de 1/30 s).
- **Un error que la prueba encontró**: con 8 bits sobre [-1, 1] el movimiento cero no se podía representar (quedaba en ±0,004) y `Movement` lo normalizaba a velocidad completa, así que «quieto» llegaba como caminar. Los ejes se codifican ahora como enteros de −127 a 127 (cero exacto); la instantánea además lleva la velocidad de cada jugador (+2,5 B por jugador).
- **Lo que queda del hito 1**: (1) el Chato y el cambuche son por jugador (en `Simulation` hay uno de cada uno; pasa al hito 5), (2) sacar de `main.cpp` los sistemas (supervivencia, economía, movimiento, combate; ver los pasos 3–7 de `multijugador-main.md`) y dejarlo como cliente, y (3) conectar el `EventBus` a audio y efectos. Con esto termina la parte de `Simulation`: el siguiente paso grande es el `PlayerController`.
- **Primer modo jugable (hito 2, versión provisional).** Compilando con `-DBAZUKO_NET=ON` el juego acepta `--anfitrion[=puerto]` o `--conectar=ip[:puerto]` (también `BAZUKO_HOST` / `BAZUKO_JOIN`). `net/NetSession` hace de anfitrión o de cliente: cada jugador simula su propio personaje y **cuenta su estado** (posición, rumbo, velocidad, caído) al anfitrión a 20 Hz; el anfitrión lo valida (dentro del mapa, valores finitos), lo reenvía a los demás dentro de un radio de 160 m (máx. 48 por instantánea) y los clientes lo suavizan. Los demás se dibujan como personas con el cuerpo de un civil fijado por su id, caminando, corriendo o caídos según su velocidad. Entradas y salidas salen como avisos. Medido (`bazuko_netsession_test`, tres jugadores por 127.0.0.1): ~0,4 m de error visual; con 80 ± 20 ms y 8 % de pérdida, hasta 0,6 m; con la partida llena el cliente sobrante es rechazado; un estado fuera del mapa se ignora. Con el juego real, dos instancias se ven entre sí (verificado con capturas del anfitrión).
- **Mundo compartido (hito 3, primera parte).** El anfitrión simula tráfico, peatones, buses, reloj y tiempo y manda cada 100 ms (`net/WorldSnapshot.hpp`, `Simulation::ExportWorld`) los 40 carros y 48 peatones más cercanos a cada invitado (radio de 160 m), todos los buses y el reloj, el día, el clima y el reloj de los semáforos. El invitado (`Simulation::SetGuestMode`) **no simula** peatones, tráfico ni buses: aplica la instantánea (`ApplyWorld`) y extrapola a velocidad constante hasta la siguiente. Con la misma semilla (42 por defecto, `BAZUKO_SEED`) los dos tienen la misma lista de carros; si el número no coincide, el invitado rechaza el mundo y avisa en el registro. Medido con `bazuko_world_share_test` (40 s, anfitrión y un invitado, instantáneas escritas y leídas de verdad): error medio **0,01 m** en carros (máx. 0,06 m), 0,00 m en peatones (máx. 0,19 m), 0,05 m en buses, reloj y día iguales, **592 B por instantánea (5,8 KB/s por invitado)**, ningún peatón cercano perdido. Los hashes de referencia (semillas 42 y 7) no cambian y pasan las 27 pruebas con red.
- **Qué falta del mundo compartido**: el invitado ve a los peatones y carros del anfitrión, pero **no puede interactuar** con ellos (golpear, robar, que lo atropellen o lo persiga la policía), porque las colisiones y reglas siguen en el simulador local, que ya no los mueve; los ocupantes, puertas y gestos (puñetazos, burbujas de conversación) de los peatones y carros no viajan todavía; el reloj de semáforos vuelve a cero cada ~70 min (un salto de fase); no se interpola entre instantáneas (solo se extrapola) ni se baja la frecuencia de lo lejano; la semilla se fija con `BAZUKO_SEED` en ambos lados (no viaja en el `Welcome`) y las bolsas de basura, el perro y las aves siguen siendo locales. La comprobación en el juego real fue con dos instancias en la misma máquina: el reloj y el tiempo coinciden y el cliente ve al anfitrión, pero no comparé los carros fotograma a fotograma.
- **Interacciones (hito 4, primera parte).** El cliente **pide** y el anfitrión **decide** (`net/Interaction.hpp`, `NetSession::Strike`): cada golpe del jugador viaja como `StrikeCommand` (rumbo, tipo, daño, alcance, retroceso); el anfitrión usa **su última posición conocida del atacante**, limita el alcance a 3 m y el daño a 63, ignora golpes más rápidos que uno cada 180 ms, exige que la víctima esté delante (cono de ~57°) y dentro del alcance (+0,4 m por la demora de red) y no golpea a jugadores caídos. El golpe también se aplica a **peatones y vehículos del mundo del anfitrión** (`HitPedestrian`/`HitVehicle`), de modo que el invitado puede pelear con la gente de la calle compartida. El golpe recibido llega como `HitEvent` y pasa por el mismo `Fight::ReceiveHit` de siempre. PvP activo (decisión del 5 de noviembre). El anfitrión además mete a los invitados como jugadores del mundo (`Simulation::Update(dt, pos, otros)`): los peatones aparecen alrededor de ellos, se asustan o los atacan, la policía va tras su jugador, y los golpes de peatones a un invitado se le entregan por la red. Pruebas: `bazuko_netsession_test` (D: golpe conecta, otro lado no, dos golpes casi simultáneos cuentan uno, alcance de 50 m pedido se recorta a 3 m, un jugador tendido no recibe golpes, el anfitrión golpea a un cliente por la red) y `bazuko_netprotocol_test` (ida y vuelta, valores absurdos recortados, truncados rechazados). Los hashes de referencia no cambian.
- **Qué falta del hito 4**: inventario, dinero, compras, ventas, fabricación, robo de espejos y a peatones, cosquilleo y armas siguen siendo **locales y confiados** (cada jugador puede dar dinero o ítems a su propio personaje con un cliente modificado); el daño de PvP es el fijo de `Fight::ReceiveHit` (no usa el arma), el invitado no puede ser atropellado por reglas del anfitrión (lo detecta su propia copia de los carros), no hay castigo ni robo entre jugadores, y el invitado ve a los peatones golpeados por él solo cuando el anfitrión los actualiza (hasta 100 ms después). Nada de esto se ha probado todavía en una partida real de dos personas peleando.
- **Limitaciones del modo provisional anterior**: el anfitrión no es autoritativo sobre el estado de cada jugador (basta para probar, no para PvP justo), no hay nombres sobre los jugadores ni migración de anfitrión, y el Chato y el cambuche siguen siendo locales. Sin `-DBAZUKO_NET=ON` el juego es idéntico al de un jugador. El siguiente paso es que el invitado pueda interactuar con ese mundo (hito 4).

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
2. Dormir: **no existe en línea** (decisión). Se desactivan la cama y la rama de pausa; la energía se recupera descansando.
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

### Hito A — Anfitrión rotativo (4–6 semanas)
1. Checkpoint completo del mundo hacia un sucesor, con reconstrucción de la IA por proyección a las rutas.
2. Puntaje de sucesor (latencia, subida, FPS, NAT) y anuncio a todos.
3. Relevo: el sucesor asume, los clientes se reconectan solos y conservan su perfil.
- **Listo cuando:** con 6 bots, cerrar el anfitrión a mitad de partida deja a todos de vuelta en < 5 s, con el mismo reloj y sin perder inventario.

### Hito B — Conectividad: NAT y salas (3–4 semanas)
1. Transporte nuevo detrás de `Host`: ICE/STUN con relay de respaldo y cifrado (libdatachannel o GameNetworkingSockets); ENet queda para LAN.
2. Servicio de salas (código de sala, señalización, relay) y pantalla de conexión.
- **Listo cuando:** dos equipos en redes domésticas distintas juegan sin abrir puertos.

### Hito C — PvP autoritativo (2–3 semanas)
Validación con rebobinado de 200 ms, protección al reaparecer, zonas seguras, silenciar y expulsar. Pruebas con 200 ms de latencia y bots.

### Hito D — Red para 100 jugadores (1–2 semanas)
Posiciones relativas al receptor, delta, frecuencia adaptativa a la subida del anfitrión. Meta: < 3 Mbit/s con 100 jugadores juntos.

### Hito E — Portabilidad (Linux 1 semana; macOS según la decisión)
Compilar y probar el juego y la red en Linux (nativo y Proton/Wine). macOS: ver «Plataformas».

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

Con las decisiones del 5 de noviembre se suman los hitos A–E (**~11–16 semanas** más, sin contar macOS): el total sube a **unos 8 meses** con una persona. Primer punto jugable en grupo: **hito 3** (~9 semanas). Lo más arriesgado siguen siendo el hito 1 y la conectividad (B).

## Riesgos principales

1. **Refactorización de `Simulation`** (muy acoplada al dibujo y a un jugador): hacerla por sistemas y con la prueba de hash.
2. **Ancho de banda del tráfico y los peatones**: delta + radio de interés + frecuencia por distancia; medir desde el hito 3.
3. **Pausa de menús**: cambia el ritmo de juego; requiere decisiones de diseño (vulnerabilidad mientras se abre el costal).
4. **Sistemas pensados para un jugador** (limpieza social, conductor bravo, psicosis, efectos de sustancias): decidir cuáles son por jugador y cuáles globales antes del hito 5.
5. **Determinismo**: no se exige entre máquinas (el servidor manda), así que no hace falta aritmética determinista; sí una semilla explícita para reproducir errores.
6. **Licencias**: un servidor público distribuye modelos; mantener los restringidos fuera (ya excluidos).

## Decisiones pendientes

1. **macOS**: ¿opción A (renderer a OpenGL 4.1), B (Vulkan/MoltenVK) o C (solo anfitrión sin ventana)? Puede esperar al hito 3.
2. **Servicio de salas**: ¿lo alojas tú (un VPS pequeño) o se busca un servicio de relay gratuito?
3. **PvP**: ¿te sirven las reglas propuestas (protección de 3 s, zona segura en la estación y junto al cambuche, sin robo entre jugadores por defecto)?
4. **Relevo**: ¿solo cuando el anfitrión se va, o también cesión voluntaria / por bajo rendimiento?
5. **Energía sin dormir**: ¿descansar sentado o echado (más lento) te parece bien como sustituto?

## Primer paso propuesto

Empezar el **hito 1** por aves y ratas (con `PlayerView`/`NearestPlayer`, comprobando el hash tras cada paso). Es lo que desbloquea todo lo demás, incluido el relevo de anfitrión (hito A), que necesita el estado del mundo separado del dibujo.
