# Contrato: WebSocket API `bazuko-envivo` (wss, us-east-2)

Una conexión por juego abierto con sesión iniciada. Sin token en la URL.

## Del juego al servidor

| `accion` | Campos | Notas |
|---|---|---|
| `entrar` | `token` (access token) | primer mensaje, antes de 10 s; si falla, se cierra la conexión |
| `estado` | `estado` (`conectado`/`jugando`), `sala?` | presencia; se repite cada 2 min |
| `decir` | `canal` (`global` / `dm:<nombre>`), `texto` (≤ 200) | límite: 5 mensajes en 10 s y 30 por minuto |
| `reportar` | `mensaje` (id) | guarda el mensaje para revisión |

## Del servidor al juego

| `tipo` | Campos |
|---|---|
| `listo` | `nombre` | conexión autenticada |
| `mensaje` | `id`, `canal`, `nombreAutor`, `texto` (ya filtrado), `enviado` |
| `presencia` | `nombre`, `estado`, `sala?` (solo a amigos) |
| `solicitud` | `nombre` (nueva solicitud de amistad) / `aceptada` |
| `frenado` | `segundos` (límite de chat superado) |
| `sesion` | `cerrada` (se cambió la contraseña o se borró la cuenta) |

## Reglas

- El canal de la sala no pasa por aquí: usa el chat de la partida que ya existe (`MessageType::Chat` por el relevo o la red local), con el mismo filtro de palabras, que el juego descarga de `GET /chat/palabras` y guarda.

- El servidor nunca reenvía `token`, `cuenta`, ni el id de conexión de otro.
- Mensajes de/para una cuenta bloqueada por el destinatario no se entregan.
- El texto se recorta a 200 caracteres, se quitan caracteres de control y se tapan las palabras de la lista configurable (`servicios/datos/palabras.json`).
