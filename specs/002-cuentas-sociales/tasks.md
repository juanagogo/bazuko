---
description: "Lista de tareas: cuentas de jugador y funciones sociales"
---

# Tasks: Cuentas de jugador y funciones sociales

**Input**: Design documents from `specs/002-cuentas-sociales/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/](contracts/)

**Tests**: se incluyen. La especificación pide comprobar que nada privado se filtra (SC-003) y que los nombres inválidos se rechazan aunque se salten el juego (SC-004); el proyecto exige pruebas de lógica para cada cambio de lógica.

**Organization**: por historia de usuario, en el orden de prioridad de la especificación (US1, US2, US7, US3, US4, US5, US6).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: se puede hacer en paralelo (otros archivos, sin dependencias pendientes)
- Rutas: el juego en `cpp/src`, sus pruebas en `cpp/tests`, la nube en `cpp/servicios`

---

## Phase 1: Setup

- [X] T001 Crear el proyecto de servicios en `cpp/servicios/` (`package.json` con Node 22, TypeScript, `aws-cdk-lib`, `aws-jwt-verify`, `@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`, `@aws-sdk/client-apigatewaymanagementapi`; `tsconfig.json`; script `npm test` con `node --test`)
- [X] T002 [P] Crear la app CDK vacía en `cpp/servicios/bin/bazuko-cuentas.ts` y `cpp/servicios/lib/pila-cuentas.ts` fijada a us-east-2 y a la cuenta del perfil `bazuko`, con `salida.json` de salidas
- [X] T003 [P] Añadir al `.gitignore` `cpp/servicios/node_modules/`, `cpp/servicios/cdk.out/` y `bazuko_sesion.bin`
- [X] T004 [P] Crear las carpetas `cpp/src/online/` y `cpp/src/voice/` y una biblioteca `bazuko_online` en `cpp/CMakeLists.txt` (WinHTTP y Crypt32 en Windows, libcurl en los demás), enlazada al juego, como `bazuko_net` — hecho `bazuko_online` (WinHTTP y Crypt32); `cpp/src/voice/` y libcurl quedan para la voz y otros sistemas

---

## Phase 2: Foundational (bloquea todas las historias)

- [X] T005 [P] Escribir la regla de nombres compartida en `cpp/servicios/src/reglas/nombres.ts` (`^[A-Za-z0-9]{3,16}$`, sin distinguir mayúsculas, lista de `cpp/servicios/datos/nombres-prohibidos.json`) y su prueba en `cpp/servicios/test/nombres.test.ts`
- [X] T006 [P] Escribir la misma regla en C++ en `cpp/src/online/NameRules.hpp` (lista prohibida embebida desde el mismo JSON al compilar) y la prueba `cpp/tests/NameRulesTest.cpp` que recorre los mismos casos que `nombres.test.ts`
- [X] T007 Definir en `cpp/servicios/lib/pila-cuentas.ts` el grupo de usuarios `bazuko-jugadores` (username sin distinguir mayúsculas, correo opcional, recuperación solo por correo verificado, contraseña ≥ 8, sin MFA), el cliente público sin secreto (`USER_PASSWORD_AUTH` y `REFRESH_TOKEN_AUTH`, acceso 60 min, renovación 30 días con rotación, revocación activada, `PreventUserExistenceErrors` activado)
- [X] T008 Escribir el disparador `cpp/servicios/src/disparadores/preRegistro.ts` (rechaza nombres inválidos o prohibidos y contraseñas iguales al nombre) y conectarlo en la pila; prueba en `cpp/servicios/test/preRegistro.test.ts`
- [X] T009 [P] Crear en la pila las tablas DynamoDB de [data-model.md](data-model.md) (`Perfiles`, `Estadisticas`, `Amistades`, `Conexiones`, `Presencia`, `Mensajes`, `Pendientes`, `Partidas`, `Limites`) con sus índices y TTL, bajo demanda y cifradas
- [ ] T010 Crear en la pila el HTTP API con autorizador JWT del grupo y del cliente, límite de 20 pedidos/s por ruta, registros de acceso sin cabeceras `Authorization`, y retención de registros de 14 días — hecho: API con autorizador JWT y límite 20/40; pendiente: registros de acceso del API
- [X] T011 [P] Escribir `cpp/servicios/src/comun/publico.ts` (construye `PerfilPublico` desde una lista blanca de campos, según visibilidad y amistad) y `respuestas.ts`, `limites.ts`, `tablas.ts`; prueba `cpp/servicios/test/publico.test.ts` que falla si aparece cualquier campo fuera de la lista
- [X] T012 [P] Añadir en la pila una alarma de presupuesto de 5 USD/mes
- [X] T013 Escribir el cliente HTTPS en hilo propio `cpp/src/online/Http.hpp/.cpp` (WinHTTP / libcurl, TLS con validación del sistema, User-Agent `Bazuko/1.0`, cuerpo JSON, tiempo máximo 10 s, nunca escribe cuerpos ni cabeceras en el registro)
- [X] T014 Leer la configuración de servicios (región, id del grupo, id del cliente, `https://`, `wss://`) de `cpp/servidores.json` (campo `cuentas`) con respaldo grabado al compilar, en `cpp/src/core/ServerList.cpp` — hecho de otra forma: región y cliente al compilar (`BAZUKO_CUENTAS_REGION`, `BAZUKO_CUENTAS_CLIENTE`) y por variables de entorno del mismo nombre, en `cpp/src/online/AccountConfig.hpp`; las URL https/wss llegan con sus historias

**Checkpoint**: `npm test`, `npx cdk synth` y `ctest -R nombres` pasan; nada desplegado todavía.

---

## Phase 3: User Story 1 - Crear cuenta e iniciar sesión (P1) 🎯 MVP

**Goal**: crear cuenta, entrar, quedarse con la sesión y cerrar sesión desde el lobby.

**Independent Test**: crear cuenta en un equipo y entrar con ella en otro; un nombre repetido o inválido se rechaza (también llamando a Cognito directo).

- [X] T015 [P] [US1] Prueba `cpp/tests/SessionStoreTest.cpp`: el token guardado no contiene texto plano, no se descifra con otra entropía y cerrar sesión borra el archivo
- [X] T016 [US1] Escribir `cpp/src/online/Cognito.hpp/.cpp`: `SignUp`, `ConfirmSignUp`, `InitiateAuth` (`USER_PASSWORD_AUTH`, `REFRESH_TOKEN_AUTH`), `RevokeToken`, con errores traducidos a mensajes del juego («usuario o contraseña incorrectos» sin decir cuál)
- [X] T017 [US1] Escribir `cpp/src/online/Session.hpp/.cpp`: tokens en memoria, renovación antes de vencer, `bazuko_sesion.bin` cifrado con DPAPI (0600 en otros sistemas), cerrar sesión revoca y borra; nombre de la última cuenta en `bazuko_ajustes.json` (`cuenta`) — hecho salvo guardar el nombre de la última cuenta en `bazuko_ajustes.json`
- [X] T018 [US1] Escribir `cpp/src/ui/AccountScreens.hpp/.cpp` con las pantallas de cartón «Entrar» y «Crear cuenta» (nombre validado mientras se escribe con `NameRules`, contraseña dos veces, correo opcional con el aviso de que sin correo no hay recuperación) — hecho dentro de `cpp/src/ui/Lobby.cpp` (pantalla Perfil), no en un archivo aparte
- [X] T019 [US1] Integrar en `cpp/src/ui/Lobby.cpp`: estado de la sesión en el inicio, botones «Entrar» / «Cerrar sesión», y «Multijugador» que pide sesión antes de seguir (FR-008c)
- [X] T020 [US1] En `cpp/src/main.cpp`, abrir la sesión guardada al iniciar en un hilo sin frenar la carga, y usar el nombre de la cuenta como nombre del jugador en el multijugador por internet
- [ ] T021 [US1] Probar con la pila desplegada (con aprobación del usuario) los escenarios 1–3 de [quickstart.md](quickstart.md), incluido el registro directo con `aws cognito-idp sign-up`

**Checkpoint**: MVP de cuentas utilizable.

---

## Phase 4: User Story 2 - Gestionar el perfil y la contraseña (P1)

**Goal**: ver y cambiar el perfil, cambiar la contraseña, recuperar con correo y borrar la cuenta.

**Independent Test**: cambiar la contraseña en un equipo cierra la sesión del otro; la vieja deja de servir.

- [ ] T022 [P] [US2] Escribir las rutas `GET/PUT/DELETE /yo` y `GET /jugadores/{nombre}` en `cpp/servicios/src/http/yo.ts` y `jugadores.ts` (cuenta tomada del token; respuesta con `publico.ts`); pruebas en `cpp/servicios/test/yo.test.ts`, incluido que un token no pueda leer ni cambiar otra cuenta
- [X] T023 [US2] Añadir a `cpp/src/online/Cognito.cpp` `ChangePassword` + `GlobalSignOut`, `ForgotPassword` / `ConfirmForgotPassword`, verificar, cambiar o quitar el correo, y `DeleteUser` después de `DELETE /yo` — hecho salvo `DeleteUser` (espera a `DELETE /yo`)
- [ ] T024 [US2] Escribir `cpp/src/online/Social.hpp/.cpp` con el perfil (`GET/PUT /yo`, apariencia y visibilidad) sobre `Http`
- [ ] T025 [US2] Pantalla de perfil en `cpp/src/ui/AccountScreens.cpp`: nombre, fecha, apariencia (abre el creador de personaje y guarda en la cuenta), visibilidad, correo, «Cambiar contraseña», «Olvidé mi contraseña» en la pantalla de entrar, «Borrar cuenta» con confirmación — hecho en `cpp/src/ui/Lobby.cpp`: correo (agregar, cambiar, quitar, verificar), «Cambiar contraseña» y «Olvidé mi contraseña»; faltan fecha, apariencia, visibilidad y «Borrar cuenta»
- [X] T026 [US2] Cerrar la sesión local cuando la renovación falla por revocación y mostrar «Su sesión se cerró» en el lobby
- [ ] T027 [US2] Probar el escenario 4 de [quickstart.md](quickstart.md) con dos juegos

---

## Phase 5: User Story 7 - Historia con la cuenta (P2)

**Goal**: la historia sigue sin cuenta ni internet; con sesión usa el nombre y la apariencia del perfil.

**Independent Test**: sin sesión y sin red, la historia abre y guarda; con sesión, el personaje lleva el nombre del perfil.

- [ ] T028 [US7] En `cpp/src/main.cpp` y `cpp/src/ui/Lobby.cpp`, que «Historia» nunca pida sesión ni espere a la red, y que con sesión aplique nombre y apariencia del perfil sin tocar el guardado
- [ ] T029 [US7] Probar el escenario 9 de [quickstart.md](quickstart.md) con la red desconectada y capturar el lobby con y sin sesión

---

## Phase 6: User Story 3 - Tabla de clasificación (P2)

**Goal**: una tabla por estadística con top 10, top 100, global y el puesto propio.

**Independent Test**: una partida por internet entre dos cuentas aparece en la clasificación en menos de un minuto; las de historia y red local no cuentan.

- [X] T030 [P] [US3] Escribir `cpp/servicios/src/http/partidas.ts` (`presente`, `bloqueos`, `resultado`: solo el anfitrión, una vez, solo a presentes, topes de valores imposibles) con pruebas en `cpp/servicios/test/partidas.test.ts` (invitado que manda resultados, cuenta no presente, días imposibles, segundo informe) — hecho en `test/clasificacion.test.ts`. Cambio respecto al plan: el anfitrión informa cada minuto y al salir, y cada fila de la partida lleva una marca de tiempo que avanza con cada informe, así que nada se acredita dos veces y una migración de anfitrión no pierde lo jugado. `bloqueos` queda para la voz (US6)
- [X] T031 [P] [US3] Escribir `cpp/servicios/src/http/clasificacion.ts` (`GET /clasificacion/{tabla}` con paginación y puesto propio) con pruebas en `cpp/servicios/test/clasificacion.test.ts`
- [X] T032 [US3] Añadir a `cpp/src/online/Social.cpp` partidas y clasificación
- [X] T033 [US3] En `cpp/src/main.cpp`, registrar presencia al entrar a una sala por internet y, siendo anfitrión, mandar los resultados al terminar o al volver al lobby (con reintento si no hay red) — `cpp/src/online/Match.cpp`; las peleas ganadas son derribos entre jugadores
- [X] T034 [US3] Pantalla de clasificación en `cpp/src/ui/Lobby.cpp`: pestañas Días, Plata, Peleas, Partidas, Tiempo; Top 10 / Top 100 / Global por páginas; la fila propia resaltada aparte — se abre con «Clasificación» en Multijugador
- [ ] T035 [US3] Probar el escenario 7 de [quickstart.md](quickstart.md)

---

## Phase 7: User Story 4 - Amigos (P2)

**Goal**: solicitudes, lista con estado y sala, unirse, quitar y bloquear.

**Independent Test**: dos cuentas se agregan y cada una ve a la otra conectada y en qué sala.

- [ ] T036 [P] [US4] Escribir `cpp/servicios/src/http/amigos.ts` (solicitudes, aceptar, rechazar, quitar, bloquear; tope 200; límite de 20 solicitudes por hora) con pruebas en `cpp/servicios/test/amigos.test.ts`, incluido que un bloqueado no pueda mandar solicitud
- [ ] T037 [US4] Crear en la pila el WebSocket API y escribir `cpp/servicios/src/envivo/{conectar,mensaje,desconectar}.ts` con `entrar` (token en el primer mensaje, cierre a los 10 s sin autenticar), `estado` y los avisos `presencia`, `solicitud`, `sesion`; pruebas en `cpp/servicios/test/envivo.test.ts`
- [ ] T038 [US4] Escribir `cpp/src/online/LiveLink.hpp/.cpp` (WebSocket con WinHTTP / libcurl, reconexión, presencia cada 2 min)
- [ ] T039 [US4] Escribir `cpp/src/ui/SocialPanel.hpp/.cpp` con la lista de amigos (conectado, en la sala X con «Unirse», que pide el código si la sala lo tiene), solicitudes y bloqueados; accesible desde el lobby
- [ ] T040 [US4] Probar el escenario 5 de [quickstart.md](quickstart.md)

---

## Phase 8: User Story 5 - Chat global y con amigos (P3)

**Goal**: canal global, privados entre amigos (con entrega diferida) y chat de sala filtrado.

**Independent Test**: un mensaje global llega a las dos cuentas; un privado solo al amigo; a un bloqueado no le llega nada.

- [ ] T041 [P] [US5] Escribir `cpp/servicios/src/reglas/filtro.ts` y `cpp/servicios/datos/palabras.json` con pruebas en `cpp/servicios/test/filtro.test.ts`
- [ ] T042 [US5] Añadir `decir` y `reportar` a `cpp/servicios/src/envivo/mensaje.ts` (límites de 5 en 10 s y 30 por minuto, aviso `frenado`, bloqueos, `Pendientes` para amigos desconectados) y `GET /chat/{canal}` y `GET /chat/palabras` en `cpp/servicios/src/http/chat.ts`; pruebas en `cpp/servicios/test/chat.test.ts`
- [ ] T043 [US5] Añadir el chat a `cpp/src/ui/SocialPanel.cpp`: pestañas Global, Sala y una por amigo, en el lobby y en la partida, sin quitar el control del personaje mientras no se escribe
- [ ] T044 [US5] Aplicar el filtro descargado al chat de la sala existente (`MessageType::Chat`) en `cpp/src/net/NetSession.cpp`, tanto al enviar como al mostrar
- [ ] T045 [US5] Probar el escenario 6 de [quickstart.md](quickstart.md)

---

## Phase 9: User Story 6 - Voz por proximidad (P3)

**Goal**: hablar con los cercanos en la partida, según la distancia.

**Independent Test**: dos jugadores se oyen a 3 m, más bajo a 15 m y nada a 40 m; un silenciado no se oye.

- [ ] T046 [P] [US6] Prueba `cpp/tests/VoiceProximityTest.cpp`: curva de ganancia, el anfitrión reenvía solo a ≤ 30 m y nunca entre bloqueados, nada se envía sin pulsar V, más de 60 tramas/s se descartan
- [ ] T047 [P] [US6] Escribir `cpp/src/voice/VoiceCodec.hpp/.cpp` (Opus 16 kHz mono 20 ms, FEC y PLC)
- [ ] T048 [P] [US6] Escribir `cpp/src/voice/VoiceCapture.hpp/.cpp` (captura de miniaudio en su hilo, pulsar V para hablar o detección de voz, elegir micrófono; sin micrófono, aviso y la partida sigue)
- [ ] T049 [US6] Añadir `Voice = 0x40` y `VoiceFrom = 0x41` a `cpp/src/net/Protocol.hpp` y el reenvío por distancia y bloqueos en `cpp/src/net/NetSession.cpp` (según [contracts/voz-en-sala.md](contracts/voz-en-sala.md))
- [ ] T050 [US6] Escribir `cpp/src/voice/VoiceMixer.hpp/.cpp` (búfer por jugador, ganancia por distancia, volumen de voces de los ajustes, silenciar), reproduciendo por `AudioManager` en la categoría de voces
- [ ] T051 [US6] Indicador de quién habla sobre el personaje (junto al nombre) y opciones de voz en ajustes y en la pausa (modo, micrófono, volumen, apagar, silenciar a cada jugador)
- [ ] T052 [US6] Probar el escenario 8 de [quickstart.md](quickstart.md) y medir los cuadros por segundo con varias voces

---

## Phase 10: Polish

- [ ] T053 [P] Escribir `cpp/docs/cuentas.md` (cómo se crea la cuenta, qué guarda el equipo, qué ven los demás, cómo desplegar la pila) y enlazarla desde `cpp/docs/multijugador-internet.md`
- [ ] T054 Revisión de seguridad de [quickstart.md](quickstart.md) §4: captura de tráfico, respuestas solo con `PerfilPublico`, permisos cruzados, registros sin contraseñas ni tokens ni correos, archivo de sesión
- [ ] T055 [P] Revisar que todos los textos nuevos existan en la letra del juego (`tests/letra`) y sigan el tono de la identidad (cartón y marcador)
- [ ] T056 Pasar `ctest -C Release` completo, `npm test` en `cpp/servicios` y `npx cdk diff`

---

## Dependencies & Execution Order

- **Setup (F1)** → **Foundational (F2)** → historias.
- **US1** es la base de todas: sin sesión no hay perfil, clasificación, amigos, chat ni voz con bloqueos.
- **US2** y **US7** dependen solo de US1.
- **US3** depende de US1 (cuentas) y usa la sesión de la sala existente.
- **US4** depende de US1; introduce el WebSocket que reutiliza **US5**.
- **US5** depende de US4 (WebSocket y amistades).
- **US6** depende de US1 para los bloqueos; la parte de audio y red (T046–T050) se puede hacer en paralelo a US3–US5.
- El despliegue en AWS (T021 y las pruebas a mano de cada historia) necesita la aprobación del usuario cada vez.

### Parallel Opportunities

- F2: T005, T006, T009, T011, T012 en paralelo; T013 aparte del lado del juego.
- US3: T030 y T031 juntos.
- US6: T046, T047 y T048 juntos, mientras se hace otra historia.

## Implementation Strategy

1. **MVP**: F1 + F2 + US1 → cuentas reales en el lobby; se despliega y se prueba.
2. US2 y US7 → cuentas completas y la historia intacta.
3. US3 → clasificación.
4. US4 → US5 → amigos y chat.
5. US6 → voz.

Cada paso se entrega probado, con capturas del juego, y con commit solo cuando el usuario lo pida.
