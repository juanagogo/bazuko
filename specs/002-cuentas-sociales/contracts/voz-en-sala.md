# Contrato: voz por la sesión de red de la sala

Dos tipos nuevos en `MessageType` de `src/net/Protocol.hpp` (`Voice = 0x40`, `VoiceFrom = 0x41`), enviados sin fiabilidad por el canal no fiable que ya usa el estado de los jugadores (un juego anterior descarta tipos desconocidos). Pasa por el relevo como cualquier otro dato: nadie ve la IP de nadie.

## Invitado → anfitrión: `VozTrama` (0x40)

| Campo | Tamaño |
|---|---|
| tipo `0x40` | 1 |
| secuencia | 2 |
| tamaño Opus | 2 |
| trama Opus (16 kHz mono, 20 ms, ~20 kbit/s, FEC) | ≤ 160 |

## Anfitrión → invitado: `VozDe` (0x41)

| Campo | Tamaño |
|---|---|
| tipo `0x41` | 1 |
| id del jugador que habla | 1 |
| secuencia | 2 |
| tamaño Opus | 2 |
| trama Opus | ≤ 160 |

## Reglas

- El anfitrión reenvía una trama solo a jugadores a ≤ 30 m del que habla según su último estado, y nunca entre un par bloqueado (`GET /partidas/{codigo}/bloqueos`). Su propia voz la manda igual.
- Más de 60 tramas por segundo de un mismo jugador se descartan.
- El receptor decodifica, rellena pérdidas con FEC/PLC, y aplica ganancia por distancia: 1 hasta 5 m, `1 − ((d−5)/25)²` hasta 30 m, 0 después; multiplicada por el volumen de voces y 0 si lo silenció.
- Sin pulsar V (modo «pulsar para hablar») o con la voz apagada no se codifica ni se envía nada.
- Un juego anterior ignora los tipos 0x40/0x41 sin romperse.
