# Data Model: Cuentas de jugador y funciones sociales

`cuenta` = el `sub` de Cognito (identificador estable). Nunca se muestra a otros jugadores; ellos ven solo `nombre`.

## Cognito: grupo de usuarios `bazuko-jugadores`

| Campo | Regla |
|---|---|
| `username` | 3–16, `^[A-Za-z0-9]+$`, único sin distinguir mayúsculas (FR-002); validado también por el disparador *Pre sign-up* (FR-003) y contra la lista de nombres prohibidos |
| contraseña | ≥ 8 caracteres, distinta del nombre (lo revisa el disparador) (FR-004); solo la guarda Cognito |
| `email` | opcional, privado; verificado con código antes de servir para recuperar (FR-008a) |
| recuperación | solo por correo verificado (FR-008b) |
| tokens | acceso 60 min, renovación 30 días con rotación; revocación activada |

## DynamoDB (us-east-2, bajo demanda, cifrado en reposo)

### `Perfiles`
- PK `cuenta`
- `nombre` (como se escribió), `nombreMin` (minúsculas, para buscar), `apariencia` (JSON acotado: las opciones del creador de personaje), `visibilidad` (`todos` | `amigos`), `creado`, `borrado` (bool)
- GSI `porNombre`: PK `nombreMin` — búsqueda exacta de amigos (FR-019)

### `Estadisticas`
- PK `cuenta`
- `nombre`, `partidas`, `dias`, `plata`, `peleas`, `muertes`, `tiempo` (segundos), `actualizado`, `tabla` = `"T"` (constante)
- GSI `porDias`, `porPlata`, `porPeleas`, `porPartidas`, `porTiempo`: PK `tabla`, SK el valor (FR-016)
- Reglas: solo crece con resultados aceptados (FR-017/018); una cuenta borrada se elimina de esta tabla

### `Amistades`
- PK `cuenta`, SK `otra`
- `estado`: `pendienteEnviada` | `pendienteRecibida` | `amigos` | `bloqueado` (bloqueo es de un solo lado)
- Transiciones: nada → (`pendienteEnviada`, `pendienteRecibida`) en las dos filas; aceptar → `amigos` en las dos; rechazar/cancelar/quitar → borrar las dos; bloquear → borra la relación y deja `bloqueado` solo en la fila de quien bloquea
- Tope: 200 `amigos` por cuenta (FR-022)

### `Conexiones` (WebSocket)
- PK `conexionId`; `cuenta`, `autenticada`, `abierta` (fecha); TTL 2 h
- GSI `porCuenta`: PK `cuenta` — presencia y entrega en vivo

### `Presencia`
- PK `cuenta`; `estado` (`conectado` | `jugando`), `sala` (código de la sala si es pública o si el que pregunta es amigo), `visto`; TTL 10 min, se renueva cada 2 min

### `Mensajes`
- PK `canal` (`global` | `dm#<cuentaA>#<cuentaB>` con las dos ordenadas), SK `enviado#<id>` (el chat de la sala va por la partida, no por aquí)
- `autor` (cuenta), `nombreAutor`, `texto` (≤ 200, ya filtrado), TTL: global 24 h, privados 30 días (FR-024)
- `Pendientes`: PK `cuenta`, SK `enviado#<id>` → privados no entregados

### `Partidas`
- PK `partida` (el código de la sala), SK `cuenta`
- `marca` (desde cuándo no se le acredita nada a esa cuenta), `anfitrion` (bool), `contada` (ya sumó una partida); TTL 7 días
- La cuenta escribe su propia fila al entrar (`presente`). El anfitrión informa cada minuto; a cada cuenta presente se le acredita como mucho lo que cabe en `ahora − marca`, y la marca avanza (escritura condicional), así que ningún informe acredita dos veces lo mismo. Volver a la misma sala tras 30 min cuenta como otra partida

### `Limites`
- PK `cuenta#accion` (`chat`, `solicitud`, `resultado`), contador por ventana; TTL igual a la ventana (FR-025)

## En el equipo del jugador

| Dato | Dónde | Protección |
|---|---|---|
| token de renovación | `bazuko_sesion.bin` | DPAPI (Windows) / 0600 |
| token de acceso e identidad | memoria | se pierde al cerrar |
| nombre de la última cuenta | `bazuko_ajustes.json` (`cuenta`) | no es secreto; solo para rellenar el campo |
| contraseña | nunca se guarda | — |
