# Modelo de datos (Fase 1)

Describe las entidades de la especificación tal como se llevan en archivos. No hay base de datos.

## Movimiento

Un gesto animado del cuerpo (por ejemplo «salto corriendo»).

| Campo | Descripción | Regla de validación |
|---|---|---|
| `nombre` | Nombre del clip en el banco | Único; sigue la convención de [clip-contract.md](contracts/clip-contract.md) |
| `lote` | 1 a 5 | Debe existir en la lista de lotes |
| `origen` | `captura-libre` o `propia` | `captura-libre` exige entrada en el registro de licencias |
| `fuente` | Biblioteca de origen (si es captura) | Obligatoria si `origen` es `captura-libre` |
| `duracion` | Segundos | Mayor que 0; los clips cíclicos cierran su bucle |
| `ciclico` | Sí o no | Caminar, correr, nadar, agachado sostenido son cíclicos |
| `en_sitio` | Siempre sí | Sin desplazamiento horizontal de la cadera |
| `estado` | `pendiente`, `en revision`, `aprobado` | Solo pasa a `aprobado` con aprobación del usuario |

Transiciones de estado: `pendiente` → `en revision` (cuando se entrega la comparación) → `aprobado` (el usuario aprueba) o de vuelta a `pendiente` (pide cambios).

## Lote

Grupo de movimientos que se entrega y aprueba junto.

| Campo | Descripción |
|---|---|
| `numero` | 1 a 5 |
| `nombre` | Locomoción, agachado, acciones con objetos, combate, vehículos |
| `movimientos` | Lista de movimientos del lote |
| `estado` | `pendiente`, `en revision`, `aprobado` |
| `comparaciones` | Lista de comparaciones de antes y después |

Regla: un lote no empieza hasta que el anterior esté `aprobado` (FR-013).

## Comparación de antes y después

| Campo | Descripción |
|---|---|
| `movimiento` | El movimiento que se compara |
| `gif` | Archivo lado a lado, actual contra nuevo, con la misma cámara |
| `capturas` | Capturas dentro del juego, mismas condiciones |
| `notas` | Observaciones y decisión del usuario |

## Registro de licencias

Una fila por cada fuente externa usada (formato en [license-registry.md](contracts/license-registry.md)).

| Campo | Descripción |
|---|---|
| `fuente` | Nombre de la biblioteca |
| `licencia` | CC0, texto de CMU, etc. |
| `enlace` | Dirección de la fuente y de la licencia |
| `atribucion` | Texto exigido o pedido por la fuente |
| `clips` | Clips del juego que provienen de ella |
| `verificacion` | Fecha y cómo se comprobó (página oficial, copia guardada) |

Regla: un clip de captura sin fila en este registro no puede entrar al banco (FR-011).
