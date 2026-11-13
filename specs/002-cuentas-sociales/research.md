# Research: Cuentas de jugador y funciones sociales

Decisiones de la fase 0. Cuenta de AWS: región us-east-2, plan gratuito con 100 USD de crédito hasta el 12 de mayo de 2027 (`aws freetier get-account-plan-state`).

## R1. Quién guarda usuarios y contraseñas

- **Decision**: un grupo de usuarios de Amazon Cognito (user pool), plan de funciones Lite/Essentials, con un cliente de aplicación público (sin secreto) y el flujo `USER_PASSWORD_AUTH` por HTTPS. El nombre de usuario es el `username` de Cognito con `UsernameConfiguration.CaseSensitive = false`; el correo es un atributo opcional, no se usa para entrar.
- **Rationale**: la contraseña nunca la toca código nuestro ni queda en una base de datos propia: Cognito la guarda con su propio hash y la compara. Ya trae lo que pide la especificación: política de contraseñas (FR-004), bloqueo progresivo tras intentos fallidos (FR-008, SC-009), recuperación por correo verificado con código (FR-008b), `GlobalSignOut` y revocación de tokens (FR-006), rotación de tokens de renovación (FR-012). Gratis hasta 10 000 usuarios activos al mes.
- **Alternatives considered**: (a) un servidor propio en C++ en la instancia del relevo con contraseñas en SQLite/DynamoDB y bcrypt/argon2: hay que escribir y mantener hash, bloqueo, recuperación por correo y revocación, y cualquier fallo filtra contraseñas; (b) flujo SRP de Cognito: evita enviar la contraseña aunque sea dentro de TLS, pero hay que implementar SRP en C++; se deja como mejora posterior porque TLS ya protege el tránsito (FR-009).

## R2. Reglas del nombre de usuario

- **Decision**: el juego valida `^[A-Za-z0-9]{3,16}$` y la lista de nombres prohibidos antes de enviar; el servidor lo vuelve a validar con un disparador Lambda *Pre sign-up* que rechaza el registro si no cumple (FR-003). La unicidad sin mayúsculas la da Cognito.
- **Rationale**: Cognito permite más caracteres en `username`; el disparador es la única forma de imponer la regla del lado del servidor aunque alguien llame a Cognito sin el juego.
- **Alternatives considered**: validar solo en el juego (se salta con una llamada directa a Cognito).

## R3. Servicios del juego (perfil, amigos, clasificación, chat)

- **Decision**: API de AWS sin servidores propios: un **HTTP API** de API Gateway con autorizador JWT de Cognito para pedidos sueltos (perfil, amigos, bloqueos, clasificación, resultados de partida, historial de mensajes) y un **WebSocket API** para lo que llega en vivo (chat, presencia, avisos de solicitudes). Funciones Lambda en Node.js 22 sobre arm64 y tablas DynamoDB bajo demanda. Todo en us-east-2.
- **Rationale**: siempre prendido sin pagar una máquina ni depender del horario de la instancia (el chat y la clasificación sirven de noche aunque el relevo esté apagado). TLS administrado (`https://`, `wss://`), escala sola, y el costo a esta escala cae dentro de la capa gratuita o en centavos. El autorizador JWT del HTTP API valida la firma, el emisor y la audiencia sin código nuestro.
- **Alternatives considered**: (a) extender `bazuko_relay` en la t4g.micro: ENet no cifra, habría que añadir TLS, y la instancia se apaga de 0:00 a 6:00; (b) AppSync: más piezas y GraphQL sin necesidad.

## R4. Autenticación del WebSocket

- **Decision**: el cliente abre `wss://…` sin token en la URL y manda como primer mensaje `{"accion":"entrar","token":<access token>}`; la Lambda de mensajes valida el token con `aws-jwt-verify` y asocia la conexión a la cuenta. Una conexión sin autenticar en 10 s se cierra, y antes de autenticarse no recibe nada.
- **Rationale**: los tokens en la URL quedan en registros de acceso; el WebSocket API no permite cabeceras propias desde todos los clientes.

## R5. Cliente HTTPS y WebSocket en el juego

- **Decision**: WinHTTP en Windows (ya se usa en `core/ServerList.cpp` y `audio/LiveStream.cpp`), que trae WebSocket (`WinHttpWebSocket*`) y valida certificados con el sistema. En Linux y macOS, libcurl para HTTPS y su soporte WebSocket (`curl_ws_*`), detrás de la misma interfaz `online/Http.hpp`. Todo en un hilo aparte, como `ServerListFetch`, para no congelar el lobby.
- **Rationale**: sin dependencias nuevas en Windows; mismas reglas de privacidad: User-Agent genérico `Bazuko/1.0`, sin datos del equipo en cabeceras.

## R6. Dónde guarda el equipo la sesión

- **Decision**: solo el token de renovación (refresh token), cifrado con DPAPI del usuario de Windows (`CryptProtectData`) en `bazuko_sesion.bin` junto al guardado; en otros sistemas, archivo con permisos 0600. Los tokens de acceso e identidad viven solo en memoria. Cerrar sesión revoca el token (`RevokeToken`) y borra el archivo (FR-012). Rotación de tokens de renovación activada; validez del de acceso 60 min, del de renovación 30 días.
- **Rationale**: DPAPI impide que otro usuario del equipo o una copia del archivo a otro equipo sirvan.

## R7. Que nada privado se filtre por la red

- **Decision**:
  - Los tokens solo viajan a AWS por TLS; **nunca** se mandan a otros jugadores ni al relevo.
  - Las respuestas se construyen desde una lista blanca de campos públicos (`PerfilPublico`), nunca devolviendo el registro completo.
  - El correo solo lo lee su dueño (Cognito, atributo legible solo con su propio token).
  - El relevo ya oculta las IP entre anfitrión e invitados; el chat y la presencia van por AWS y no exponen direcciones (FR-011).
  - Cada Lambda toma la cuenta del token (`sub`), nunca de un parámetro del pedido (FR-013).
- **Rationale**: un jugador nunca puede pedir datos de otro por un camino que el servidor no haya filtrado.

## R8. Clasificación

- **Decision**: tabla `Estadisticas` (una fila por cuenta) y un índice secundario global por estadística (`dias`, `plata`, `peleas`, `partidas`, `tiempo`) con clave de partición fija `"tabla"` y clave de orden el valor. Top 10/100 y global por páginas = `Query` descendente con paginación; el puesto propio = `Query` con `Select: COUNT` de los valores mayores, con caché de 60 s en la tabla.
- **Rationale**: simple y suficiente para miles de cuentas (SC-008 pide 500 conectados). Si crece mucho, se cambia a un recálculo periódico sin tocar el cliente.
- **Alternatives considered**: ElastiCache/Redis con conjuntos ordenados: costo fijo mensual innecesario.

## R9. Estadísticas que no se puedan inventar

- **Decision**: cada jugador con sesión registra en el servicio su entrada a la sala (`POST /partidas/{codigo}/presente`). Al terminar, solo el anfitrión manda los resultados; el servidor acredita solo a cuentas que se registraron presentes en esa sala y en esa ventana de tiempo, descarta valores imposibles (FR-018: días no mayores que el tiempo jugado permite, plata con tope por hora) y nunca acepta resultados de una cuenta sobre sí misma fuera de una partida.
- **Rationale**: el servidor no ve la partida (el relevo solo reenvía bytes). Así un jugador no puede acreditar estadísticas a quien no jugó, ni un invitado inflar las suyas. El anfitrión aún podría exagerar dentro de los topes: se documenta como límite conocido.
- **Alternatives considered**: simular la partida en el servidor (reescribir el juego como autoritativo): fuera de alcance.

## R10. Voz por proximidad

- **Decision**: captura con miniaudio (ya es el motor de audio), 16 kHz mono, tramas de 20 ms, códec Opus (ya está en el proyecto por opusfile) a ~20 kbps con FEC. Las tramas van por la sesión de red existente (relevo o red local) en un canal ENet no fiable, al anfitrión, que las reenvía solo a quienes estén a ≤ 30 m del que habla (y no lo tengan bloqueado). Cada receptor decodifica y atenúa: volumen 1 hasta 5 m, curva hasta 0 a 30 m. Pulsar para hablar (V) por defecto; detección de voz opcional por umbral de energía.
- **Rationale**: reutiliza la conexión que ya oculta las IP y ya conoce las posiciones; nada de audio pasa por AWS fuera del relevo. Ancho de banda con 8 personas hablando: < 1,5 Mbit/s en el anfitrión.
- **Alternatives considered**: Amazon Chime SDK (salas de voz sin posición, costo por minuto); WebRTC (gran dependencia nueva en C++).

## R11. Bloqueos en la voz y el chat de la sala

- **Decision**: el anfitrión recibe del servicio, al entrar cada jugador, solo la lista de *nombres* bloqueados entre los presentes (`GET /partidas/{codigo}/bloqueos`, que responde pares de jugadores de esa sala), y no reenvía voz ni chat de sala entre ellos.

## R12. Correo de recuperación

- **Decision**: el envío de correos de Cognito por defecto (hasta 50 al día) al inicio. Si se queda corto, pasar a Amazon SES en us-east-2 con una identidad verificada.

## R13. Infraestructura como código

- **Decision**: AWS CDK v2 en TypeScript en `cpp/servicios/` (el proyecto ya usa Node.js 22). Una sola pila `BazukoCuentas` con el grupo de usuarios, los disparadores, las Lambdas, los dos API y las tablas. Pruebas de las Lambdas con `node:test`.
- **Rationale**: un solo `cdk deploy` reproducible; `cdk diff` muestra qué cambia antes de tocar la cuenta.

## R14. Costo esperado

Con unos cientos de jugadores: Cognito gratis (< 10 000 activos al mes); Lambda, DynamoDB bajo demanda y API Gateway en centavos o dentro de la capa gratuita; CloudWatch Logs con retención de 14 días. Lo que más podría costar es la salida de datos de la voz por el relevo (EC2: 100 GB/mes gratis, luego ~0,09 USD/GB). Se añadirá una alarma de presupuesto de 5 USD/mes.
