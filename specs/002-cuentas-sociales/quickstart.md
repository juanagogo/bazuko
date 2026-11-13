# Quickstart: validar cuentas y funciones sociales

## Requisitos

- Node.js 22, AWS CLI con el perfil `bazuko` (región us-east-2), AWS CDK v2 (`npx cdk`).
- El juego compilado (`cmake --build cpp/build --config Release`).

## 1. Servicios

```sh
cd cpp/servicios
npm ci
npm test                       # reglas de nombres, filtro, permisos, clasificación, resultados (node:test, sin AWS)
npx cdk diff --profile bazuko  # revisar antes de desplegar
npx cdk deploy --profile bazuko
```

La pila escribe `cpp/servicios/salida.json` con el id del grupo de usuarios, el id del cliente y las direcciones `https://` y `wss://`. El juego las lee al compilar (`-DBAZUKO_CUENTAS_CONFIG=...`) o de `servidores.json`.

## 2. Pruebas del juego

```sh
ctest -C Release -R "cuentas|nombres|voz|sesion"
```

- `bazuko_nombres_test`: la misma regla y lista de nombres que el servidor.
- `bazuko_sesion_test`: el token guardado con DPAPI no sirve copiado a otro usuario; cerrar sesión borra el archivo.
- `bazuko_voz_test`: curva de volumen por distancia, reenvío solo a ≤ 30 m y nunca entre bloqueados, nada se envía sin pulsar V.

## 3. Escenarios a mano (dos juegos, dos cuentas)

| # | Pasos | Esperado |
|---|---|---|
| 1 | Crear `Prueba1`; crear `prueba1` | la segunda: «ese nombre ya está tomado» (SC-004) |
| 2 | Crear `Hola Mundo`, `Ñandú`, `ab` | rechazados en el juego; y con `aws cognito-idp sign-up` directo, rechazados por el servidor |
| 3 | Entrar con contraseña mala 10 veces | Cognito frena los intentos (SC-009) |
| 4 | Cambiar contraseña en el juego A | el juego B cierra sesión |
| 5 | `Prueba1` agrega a `Prueba2`; `Prueba2` acepta | ambos se ven conectados; al abrir sala, el amigo ve «en la sala X» |
| 6 | Chat global y privado | llegan en < 2 s; un bloqueado no recibe nada |
| 7 | Partida por internet con las dos cuentas; `Guardar y salir` | la clasificación muestra la partida en < 1 min (SC-005) |
| 8 | Voz: hablar a 3 m, 15 m y 40 m | pleno, más bajo, nada |
| 9 | Historia sin sesión y sin internet | abre y guarda como hoy |

## 4. Revisión de seguridad (SC-003)

- Capturar el tráfico del juego (Wireshark) durante los escenarios 1–8: solo TLS hacia AWS; por el relevo no viaja ningún token ni correo.
- Pedir `GET /jugadores/Prueba2` con el token de `Prueba1` y revisar que la respuesta tenga solo los campos de `PerfilPublico`.
- Pedir `PUT /yo` o `POST /partidas/.../resultado` con el token de un invitado: `no_permitido`.
- Revisar en CloudWatch Logs que ninguna línea tenga `password`, `token` ni correos.
- Revisar `bazuko_sesion.bin`: no contiene la contraseña y copiado a otro usuario no sirve.
