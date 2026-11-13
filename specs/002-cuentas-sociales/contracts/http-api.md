# Contrato: HTTP API `bazuko-social` (https, us-east-2)

Todas las rutas, salvo las de Cognito, llevan `Authorization: Bearer <access token>`; el autorizador JWT de API Gateway rechaza con 401 lo que no sea un token vigente del grupo `bazuko-jugadores` y del cliente del juego. La cuenta sale del token (`sub`), nunca del cuerpo ni de la ruta.

Respuestas: JSON. Errores: `{"error": "<codigo>"}` con códigos estables (`nombre_invalido`, `no_encontrado`, `limite`, `no_permitido`, `datos_imposibles`, `tope_amigos`). Un jugador visto por otro siempre es un **PerfilPublico**:

```json
{ "nombre": "Jairo", "apariencia": { }, "estadisticas": { "partidas": 0, "dias": 0, "plata": 0, "peleas": 0, "tiempo": 0 }, "estado": "conectado|jugando|desconectado", "sala": "BZK7AQ|null" }
```

Nunca incluye `cuenta`, correo, fechas de sesión ni direcciones. `sala` solo aparece si quien pregunta es amigo y el otro está jugando. Con `visibilidad = amigos`, quien no es amigo ve solo `nombre`.

## Cuentas (directo a Cognito, `cognito-idp.us-east-2.amazonaws.com`)

| Acción | Llamada de Cognito |
|---|---|
| Crear cuenta | `SignUp` (username, password, email opcional) |
| Confirmar correo | `ConfirmSignUp` / `VerifyUserAttribute` |
| Entrar | `InitiateAuth` `USER_PASSWORD_AUTH` |
| Renovar | `InitiateAuth` `REFRESH_TOKEN_AUTH` |
| Cambiar contraseña | `ChangePassword` + `GlobalSignOut` |
| Olvidé la contraseña | `ForgotPassword` → `ConfirmForgotPassword` + `GlobalSignOut` |
| Cerrar sesión | `RevokeToken` |
| Borrar cuenta | `DELETE /yo` (abajo) y luego `DeleteUser` |

## Perfil

| Método y ruta | Cuerpo | Respuesta |
|---|---|---|
| `GET /yo` | — | perfil propio completo (incluye `visibilidad`; el correo lo lee el juego de Cognito) |
| `PUT /yo` | `{apariencia?, visibilidad?}` | perfil propio |
| `DELETE /yo` | — | 204; borra perfil, estadísticas, amistades y pendientes |
| `GET /jugadores/{nombre}` | — | PerfilPublico o 404 (búsqueda exacta, sin sugerencias) |

## Amigos

| Método y ruta | Efecto |
|---|---|
| `GET /amigos` | `{amigos:[PerfilPublico], recibidas:[nombre], enviadas:[nombre], bloqueados:[nombre]}` |
| `POST /amigos/{nombre}` | manda solicitud (o acepta si ya había una recibida) |
| `DELETE /amigos/{nombre}` | rechaza, cancela o quita |
| `POST /bloqueos/{nombre}` / `DELETE /bloqueos/{nombre}` | bloquea / desbloquea |

## Clasificación

| Método y ruta | Respuesta |
|---|---|
| `GET /clasificacion/{tabla}?desde=<cursor>&cuantos=10\|100\|50` | `{filas:[{puesto, nombre, valor}], siguiente:<cursor\|null>, yo:{puesto, valor}}`; `tabla` ∈ `dias, plata, peleas, partidas, tiempo` |

## Partidas

| Método y ruta | Cuerpo | Efecto |
|---|---|---|
| `POST /partidas/{codigo}/presente` | `{anfitrion: bool}` | registra que esta cuenta está en esa sala |
| `GET /partidas/{codigo}/bloqueos` | — | solo para el anfitrión: `[[nombreA, nombreB]]` de presentes que no deben oírse |
| `POST /partidas/{codigo}/resultado` | `{jugadores:[{nombre, dias, plata, peleas, muertes, tiempo}]}` | solo el anfitrión, una vez; acredita a presentes; descarta valores imposibles |

## Chat (historial)

| Método y ruta | Respuesta |
|---|---|
| `GET /chat/{canal}?antes=<cursor>` | últimos 50 mensajes `{nombreAutor, texto, enviado}` de `global` o `dm:<nombre>` (si amigos) |
| `GET /chat/palabras` | lista de palabras que se tapan (para el chat de la sala, que no pasa por el servidor) |

## Límites

- Solicitudes de amistad: 20 por hora. Resultados: 1 por partida. Búsquedas: 60 por minuto. API Gateway con límite de 20 pedidos/s por ruta.
