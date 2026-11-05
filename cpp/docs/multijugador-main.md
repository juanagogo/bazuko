# Inventario de `main.cpp` para el multijugador

`main()` es **una sola función de ~2 700 líneas** (`src/main.cpp`, líneas 69–2766). No hay un objeto «jugador»: el jugador son unas **100 variables locales** declaradas entre las líneas 143 y 360, y el bucle principal (línea 826) las lee y escribe junto con el mundo, el dibujo y la interfaz. Este documento las reparte por capas para partir la función sin cambiar cómo se juega.

## 1. Regiones de código

| Líneas | Qué hace | Capa futura |
|---|---|---|
| 69–142 | Ventana, renderer, audio, UI, ciudad, `Simulation`, lago, decals, cielo | **Cliente** (el servidor sin ventana crea solo ciudad y `Simulation`) |
| 143–360 | **Estado del jugador** (ver §2), recetas, acciones, lambdas de golpe/atropello | Sesión del jugador (**servidor**) |
| 360–560 | Carga de `savegame.json` y creador de personaje | Perfil por jugador (`ProfileStore`) |
| 633–793 | Recoger y clasificar bolsas, vender, precio de la recicladora | **Servidor** (economía y botín) |
| 794–825 | Pruebas por variables de entorno y creador inicial | Cliente / pruebas |
| 826–941 | Eventos del sistema, teclas, cursor y cámara con ratón | **Cliente** |
| 942–1076 | Movimiento del personaje (WASD, salto, agua, ragdoll, caída) | `PlayerController`: el cliente predice, el servidor valida |
| 1077–1143 | Lluvia (moja y resfría), adrenalina | **Servidor** (supervivencia) |
| 1144–1177 | Psicosis y alucinaciones | **Cliente** (efecto local, decidido) |
| 1179–1334 | Clasificar con Q, recoger con F, tienda (B/L) | Comandos al servidor |
| 1335–1511 | Interacción con E (retrovisor, perro, tiendas, jíbaro, fabricar) | Comandos al servidor |
| 1512–1563 | Construir el cambuche y dormir | Servidor (dormir **desactivado** en línea) |
| 1564–1771 | Acciones del personaje: golpes, patadas, esquivar, popó, caricia al Chato | Combate: servidor valida |
| 1772–1852 | Golpes recibidos, atropello, muerte, clima, GPS | Mixto |
| 1853 | Cámara | **Cliente** |
| 1856–2231 | Render 3D (ciudad, personaje, vehículos, cielo) | **Cliente** |
| 2232–2766 | Interfaz (ImGui), barra rápida, menús, cambuche, guardado al salir | **Cliente** |

Conclusión: **~25 % es servidor** (estado, reglas y economía), **~55 % cliente** (dibujo, UI, cámara, entrada) y **~20 % mixto** (movimiento y combate, que el cliente predice y el servidor valida).

## 2. Estado del jugador (líneas 143–360)

Reparto de las variables, que es lo que formará la `PlayerSession`:

- **Movimiento y cuerpo**: `playerPos`, `playerYaw`, `playerVelocity`, `playerOnDeck`, `playerWaterDepth`, `playerSwimming`, `swimPhase`, `swimPitch`, `locomotionPhase`, `jumpOffset`, `jumpMoving`, `jumpDirection`, `jumpSpeed`, `playerCrouching`, `playerKnockedDown`, `knockdownRemaining`, `knockdownLyingYaw`, `knockedOnDeck`, `vehicleImpactCooldown`, `deathByVehicleImpact`.
- **Supervivencia**: `needs[7]`, `diseases`, `warmTimer`, `playerWetness`, `playerFreezing`, `coldCheckTimer`, `tiredGait`, `boostActive`, `boostTimer`.
- **Economía y progreso**: `inventory`, `inventoryWeight`, `money`, `xp`, `level`, `talentPoints`, `unlockedTalents`, `bigSack`, `hotbar`, `equippedWeapon`, `itemsCollected`, `itemsSold`, `missionProgress`, `objective`, `sorting`, `sortProgress`, `sortPosition`.
- **Combate y acciones**: `playerAction`, `playerActionClip`, `actionTime`, `actionDuration`, `punchChain`, `comboStep`, `comboIdle`, `clickTime`, `clickMove`, `clickTracking`, `clickWasLocked`, `actionHitDone`, `playerHitKind`, `playerHitTime`, `playerStaggerDirection`, `fightStanceRemaining`, `knifeStanceRemaining`, `stillSeconds`, `nextKnifeIsStab`, `nextKickIsHigh`, `nextDodgeIsDuck`, `pickupTime`, `pickupTarget`, `grabTime`.
- **Popó y caricia al Chato**: `poopCooldown`, `poopAnimationRemaining`, `poopMode`, `poopElapsed`, `poopStepDone`, `poopThrowDirection`, `petWaiting`, `petRewardPending`, `petWaitTime`.
- **Compañero**: `companionName`, `companionCoat`, `companionIsFriend`, `companionPosition`.
- **Radio**: `radioOn`, `radioVolume`, `radioBattery`.
- **Es del cliente, no de la sesión**: `graphicsQuality`, cámara, UI, audio, `playerRagdoll` (solo su pose), `starField`, `skyColors`, `gps` y su destino.

## 3. Plan por pasos (cada uno verificable y reversible)

1. ~~**Reunir el estado en `PlayerSession`**~~ (`game/PlayerSession.hpp`) y que `main()` use **referencias con el mismo nombre** (`auto& money = session.money;`). No cambia ni una línea de lógica: las 98 referencias a `inventory`, 67 a `needs[`, etc. siguen compilando igual. *Hecho en este paso.*
2. **Probar el guardado y la carga** con la sesión (el `savegame.json` resultante debe ser idéntico antes y después).
3. ~~**Sacar la lógica de supervivencia**~~ **Hecho**: `game/Survival.cpp` (`StepSurvival`) contiene frío, hambre, sed, energía, higiene, ánimo, salud, lluvia, gripe y adrenalina; `main()` solo rellena sus datos y avisa a la interfaz. Prueba diferencial `bazuko_survival_test`: una copia literal del código viejo contra la nueva en **600 000 pasos aleatorios**, idénticos bit a bit (incluidos empapados, resfriados, adrenalinas y frío) y con la misma secuencia de azar.
4. **Sacar la economía** (botín, clasificar, vender, tienda, fabricar, talentos) a `EconomySystem`, ya con comandos (`CollectCommand`, `SellCommand`...) en lugar de teclas.
5. **Movimiento**: `PlayerController::Step(session, input, world, dt)` con la misma regla para cliente (predicción) y servidor (validación). Hoy está mezclado con el ragdoll y las animaciones.
6. **Combate**: `MeleeCombat` ya existe y es la base de la validación del servidor.
7. **Dejar `main()` como cliente**: leer entrada, construir el `PlayerInput`, mostrar el estado.

## 4. Cómo se verifica sin pruebas de interfaz

`main()` no está cubierto por las pruebas automáticas, así que cada paso se comprueba con:
- compilación sin avisos nuevos y los 18 tests (`ctest`);
- una captura en el mismo punto (`BAZUKO_SHOT`) idéntica a la de antes;
- el `savegame.json` generado tras una sesión corta, comparado campo a campo con el anterior;
- a partir del paso 3, pruebas unitarias propias del sistema extraído (como `bazuko_simulation_hash`).
