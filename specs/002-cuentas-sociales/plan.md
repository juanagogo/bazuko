# Implementation Plan: Cuentas de jugador y funciones sociales

**Branch**: `cpp-lobby-carton` (sin rama propia; la especificación es `002-cuentas-sociales`) | **Date**: 2026-11-13 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/002-cuentas-sociales/spec.md`

## Summary

Cuentas reales para el multijugador y las funciones en línea, sin tocar que la historia se juegue sin cuenta ni internet. Las contraseñas las guarda y las comprueba **Amazon Cognito**; nada nuestro las ve ni las almacena. Perfil, amigos, bloqueos, clasificación (una tabla por estadística) e historial de chat viven en un **HTTP API** con Lambdas y **DynamoDB**; el chat y la presencia en vivo, en un **WebSocket API**. Todo en us-east-2 y siempre prendido, aunque el relevo se apague de noche. La **voz por proximidad** usa Opus y viaja por la sesión de la sala que ya existe (relevo o red local), con el anfitrión reenviando solo a quienes están a ≤ 30 m. El juego habla con AWS por TLS (WinHTTP en Windows, libcurl en los demás) y guarda solo el token de renovación cifrado con DPAPI. Detalles y alternativas en [research.md](research.md).

## Technical Context

**Language/Version**: C++20 (juego, como hoy); TypeScript sobre Node.js 22 (Lambdas e infraestructura)

**Primary Dependencies**: juego: WinHTTP / libcurl (HTTPS y WebSocket), miniaudio (captura), Opus (ya en el proyecto), ENet (sesión de la sala), Dear ImGui (pantallas); servicios: AWS CDK v2, `@aws-sdk/client-dynamodb`, `@aws-sdk/client-apigatewaymanagementapi`, `aws-jwt-verify`

**Storage**: Cognito (cuentas y contraseñas); DynamoDB bajo demanda (perfiles, estadísticas, amistades, presencia, mensajes, partidas, límites); en el equipo, `bazuko_sesion.bin` cifrado con DPAPI

**Testing**: CTest (pruebas C++ existentes y nuevas); `node:test` para las Lambdas; escenarios a mano en [quickstart.md](quickstart.md)

**Target Platform**: juego en Windows 10/11 (Linux y macOS siguen compilando); servicios en AWS us-east-2, Lambdas arm64

**Project Type**: juego de escritorio + servicios en la nube

**Performance Goals**: entrar < 3 s (SC-002); chat < 2 s (SC-006); voz < 0,5 s de retraso (SC-007); el juego mantiene sus cuadros por segundo con 8 voces (la red y la codificación en hilos aparte)

**Constraints**: ninguna contraseña, token ni dato privado de otro jugador por la red ni en registros (FR-009–FR-014, SC-003); User-Agent genérico `Bazuko/1.0`; costo dentro del crédito del plan gratuito, con alarma de presupuesto de 5 USD/mes; historia sin cuenta ni internet; proyecto de AWS solo en us-east-2

**Scale/Scope**: 500 conectados a la vez (SC-008), miles de cuentas; 8 jugadores por sala con voz

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` todavía es la plantilla sin llenar: no hay principios que revisar. Se aplican en su lugar las reglas del proyecto (`AGENTS.md`) y las del usuario:

| Regla | Cumple | Cómo |
|---|---|---|
| Sin datos personales en cabeceras o URLs | Sí | User-Agent genérico; tokens solo en `Authorization` hacia AWS o en el cuerpo del primer mensaje del WebSocket |
| Proyecto de AWS en una sola región | Sí | Todo en us-east-2; nada en us-east-1 |
| Créditos y documentación sin atribuciones a herramientas | Sí | Documentación nueva en `cpp/docs/cuentas.md` describe el comportamiento en el juego |
| Tono de la identidad (cartón y marcador, sin exclamaciones de más) | Sí | Pantallas nuevas con `ui/Carton` como el lobby |
| Guardado local de la historia intacto | Sí | La historia no lee ni escribe nada en AWS |
| Pruebas de lógica no sustituyen revisión en el juego | Sí | Quickstart con escenarios a mano y capturas |

Re-check tras la fase 1: sin cambios.

## Project Structure

### Documentation (this feature)

```text
specs/002-cuentas-sociales/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── http-api.md
│   ├── websocket.md
│   └── voz-en-sala.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
cpp/
├── servicios/                     # NUEVO: nube (CDK + Lambdas, TypeScript)
│   ├── bin/bazuko-cuentas.ts      # app CDK
│   ├── lib/pila-cuentas.ts        # Cognito, tablas, Lambdas, HTTP API, WebSocket API, presupuesto
│   ├── src/
│   │   ├── reglas/nombres.ts      # regla de nombres + lista prohibida (misma que el juego)
│   │   ├── reglas/filtro.ts       # filtro de palabras del chat
│   │   ├── disparadores/preRegistro.ts
│   │   ├── http/{yo,jugadores,amigos,clasificacion,partidas,chat}.ts
│   │   ├── envivo/{conectar,mensaje,desconectar}.ts
│   │   └── comun/{tablas,publico,limites,respuestas}.ts   # PerfilPublico: lista blanca de campos
│   ├── datos/{nombres-prohibidos.json,palabras.json}
│   └── test/*.test.ts
├── src/
│   ├── online/                    # NUEVO: cliente de cuentas y social
│   │   ├── Http.hpp/.cpp          # HTTPS + WebSocket (WinHTTP / libcurl), en hilo propio
│   │   ├── Cognito.hpp/.cpp       # SignUp, InitiateAuth, ChangePassword, ForgotPassword, RevokeToken, GlobalSignOut
│   │   ├── Session.hpp/.cpp       # tokens en memoria, renovación, archivo DPAPI
│   │   ├── NameRules.hpp          # la regla de nombres (compartida con las pruebas)
│   │   ├── Social.hpp/.cpp        # perfil, amigos, clasificación, partidas (HTTP API)
│   │   └── LiveLink.hpp/.cpp      # WebSocket: chat, presencia, avisos
│   ├── voice/                     # NUEVO: voz por proximidad
│   │   ├── VoiceCapture.hpp/.cpp  # miniaudio, pulsar para hablar / detección de voz
│   │   ├── VoiceCodec.hpp/.cpp    # Opus 16 kHz mono 20 ms
│   │   └── VoiceMixer.hpp/.cpp    # ganancia por distancia, silenciados, reproducción
│   ├── net/Protocol.hpp           # + MessageType::Voice/VoiceFrom
│   ├── net/NetSession.*           # reenvío de voz del anfitrión por distancia y bloqueos
│   ├── ui/Lobby.cpp               # + Entrar / Crear cuenta / Perfil / Clasificación / Amigos
│   ├── ui/AccountScreens.*        # NUEVO: formularios de cuenta y perfil (cartón)
│   ├── ui/SocialPanel.*           # NUEVO: amigos y chat (lobby y partida)
│   └── main.cpp                   # sesión al abrir; multijugador exige cuenta; resultados al terminar
├── tests/
│   ├── NameRulesTest.cpp          # NUEVO
│   ├── SessionStoreTest.cpp       # NUEVO
│   └── VoiceProximityTest.cpp     # NUEVO
└── docs/cuentas.md                # NUEVO
```

**Structure Decision**: el juego sigue en `cpp/src` con dos carpetas nuevas (`online/`, `voice/`) que no dependen de la ciudad ni del renderizador, para probarlas solas como `net/`. La nube va en `cpp/servicios/`, junto a `servidores.json` y al relevo, porque es parte del port C++ y no del juego web.

## Fases de entrega (por prioridad de la especificación)

1. **Cuentas (US1, US2, US7)**: pila de Cognito con el disparador de nombres; `online/Cognito`, `Session`, `NameRules`; pantallas de entrar, crear cuenta, perfil, cambiar contraseña, recuperar con correo, cerrar sesión, borrar cuenta; multijugador exige sesión; la historia no.
2. **Clasificación (US3)**: tablas y rutas de partidas y clasificación; el juego registra presencia, el anfitrión manda resultados; pantalla con pestañas por estadística y top 10 / top 100 / global.
3. **Amigos (US4)**: rutas de amigos y bloqueos; WebSocket con presencia; lista de amigos con «Unirse».
4. **Chat (US5)**: canal global y privados por WebSocket con historial; chat de sala existente con el filtro descargado.
5. **Voz (US6)**: captura, Opus, reenvío del anfitrión por distancia, mezcla, ajustes y silenciar.

Cada fase se despliega y se prueba sola; el juego sin servidores de cuentas sigue funcionando en historia y red local.

## Riesgos y límites conocidos

- El anfitrión podría exagerar resultados dentro de los topes (el servidor no ve la partida). Mitigado con presencia registrada y valores máximos; documentado.
- `USER_PASSWORD_AUTH` envía la contraseña a Cognito dentro de TLS; SRP queda como mejora.
- El correo de Cognito por defecto tiene 50 envíos al día; si se queda corto, se pasa a SES.
- Antes de desplegar: confirmar que Cognito, API Gateway WebSocket, Lambda y DynamoDB están disponibles en el plan gratuito del proyecto (si alguno no lo está, hay que pasar al plan pagado o activar funciones avanzadas en AWS Settings).
- Desplegar la pila crea recursos en la cuenta: se hará solo con aprobación.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| Dos API (HTTP y WebSocket) | chat y presencia necesitan llegar sin que el juego pregunte | sondeo por HTTP cada pocos segundos: más costo, más retraso (SC-006) |
| Código TypeScript nuevo en un port C++ | Lambdas y CDK en Node.js, que el proyecto ya usa | Lambdas en C++: tiempo de arranque y empaquetado mucho más difíciles |
