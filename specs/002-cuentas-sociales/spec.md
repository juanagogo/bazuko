# Feature Specification: Cuentas de jugador y funciones sociales

**Feature Branch**: `cpp-lobby-carton` (la especificación no crea rama propia)

**Created**: 2026-11-13

## Clarifications

### Session 2026-11-13

- Q: ¿La historia exige cuenta? → A: No. La cuenta es obligatoria solo para el multijugador y las funciones en línea; la historia se juega sin cuenta ni internet.
- Q: ¿Cómo se recupera una contraseña olvidada? → A: Correo opcional y privado; con correo se recupera con un código; sin correo no hay recuperación.
- Q: ¿Por qué estadística se ordena la clasificación? → A: Varias tablas, una por estadística, cada una con top 10, top 100 y global.

**Status**: Draft

**Input**: User description: "Cuentas de jugador y funciones sociales del port en C++ de Bazuko, que sirvan tanto en el modo historia como en el multijugador: perfiles reales con nombre de usuario y contraseña guardados en una base de datos en AWS; iniciar sesión, cerrar sesión, cambiar contraseña y gestionar el perfil; validación de usuarios (nombre único, solo letras y números, sin caracteres complejos); tabla de clasificación con estadísticas de los jugadores en multijugador (top 10, top 100 y global); amigos; chat global y chat con amigos; comunicación de voz (VoIP) por proximidad dentro de la partida. Seguridad: las contraseñas y los perfiles de otros usuarios nunca deben filtrarse por la red ni el servidor debe exponerlos."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Crear cuenta e iniciar sesión (Priority: P1)

Al abrir el juego, el jugador puede crear una cuenta con un nombre de usuario y una contraseña, o entrar con una cuenta que ya tiene. Desde cualquier equipo con el juego, con su nombre y su contraseña, recupera su perfil. Puede cerrar sesión y entrar con otra cuenta. El nombre de usuario es único, solo tiene letras y números, y es el nombre con que lo ven los demás.

**Why this priority**: Todo lo demás (clasificación, amigos, chat, voz) necesita saber quién es cada jugador. Sin cuentas no hay nada que construir encima.

**Independent Test**: Crear una cuenta en un equipo, cerrar el juego, abrirlo en otro equipo y entrar con el mismo nombre y contraseña: el perfil es el mismo. Intentar crear otra cuenta con el mismo nombre (aunque cambien mayúsculas) es rechazado.

**Acceptance Scenarios**:

1. **Given** un nombre libre y una contraseña válida, **When** el jugador crea la cuenta, **Then** queda con la sesión iniciada y su nombre aparece en el lobby.
2. **Given** un nombre que ya existe (sin importar mayúsculas y minúsculas), **When** alguien intenta crear una cuenta con él, **Then** el juego dice que ese nombre ya está tomado y no crea nada.
3. **Given** un nombre con espacios, tildes, símbolos o emojis, **When** el jugador lo escribe, **Then** el juego le dice que solo se permiten letras (a–z) y números, antes de enviarlo.
4. **Given** una cuenta existente, **When** el jugador escribe mal la contraseña, **Then** el juego dice «usuario o contraseña incorrectos» sin revelar cuál de los dos falló.
5. **Given** la sesión iniciada, **When** el jugador cierra el juego y lo vuelve a abrir en el mismo equipo, **Then** sigue con la sesión iniciada sin escribir la contraseña de nuevo, hasta que cierre sesión.
6. **Given** la sesión iniciada, **When** el jugador pulsa «Cerrar sesión», **Then** vuelve a la pantalla de entrar y el equipo no guarda nada que permita volver a entrar sin la contraseña.

---

### User Story 2 - Gestionar el perfil y la contraseña (Priority: P1)

Con la sesión iniciada, el jugador abre su perfil: ve su nombre, su apariencia, sus estadísticas y la fecha en que creó la cuenta. Puede cambiar la contraseña (escribiendo antes la actual) y elegir qué de su perfil ven los demás.

**Why this priority**: Sin poder cambiar la contraseña, una contraseña filtrada no tiene arreglo. Es parte del mínimo de una cuenta segura.

**Independent Test**: Cambiar la contraseña en un equipo; en otro equipo con la sesión abierta, la sesión se cierra y la contraseña vieja ya no sirve.

**Acceptance Scenarios**:

1. **Given** la sesión iniciada, **When** el jugador cambia la contraseña escribiendo la actual y la nueva dos veces, **Then** la nueva sirve para entrar y la vieja no.
2. **Given** la contraseña actual mal escrita, **When** el jugador intenta cambiarla, **Then** el cambio se rechaza.
3. **Given** la contraseña cambiada, **When** otro equipo tenía la sesión abierta con esa cuenta, **Then** esa sesión se cierra y pide entrar de nuevo.
4. **Given** el perfil abierto, **When** el jugador cambia su apariencia o su visibilidad, **Then** el cambio se guarda en su cuenta y lo ve igual desde otro equipo.

---

### User Story 3 - Tabla de clasificación (Priority: P2)

En el lobby hay una tabla con los mejores jugadores del multijugador: el top 10, el top 100 y la tabla global (todos, por páginas). Cada fila muestra puesto, nombre y estadísticas. El jugador siempre ve su propio puesto, aunque no esté en el top.

**Why this priority**: Da sentido a jugar en línea y es lo primero que los jugadores comparan, pero depende de que existan cuentas.

**Independent Test**: Jugar partidas multijugador con varias cuentas de prueba; la tabla las ordena según sus estadísticas, y cada cuenta ve su propio puesto.

**Acceptance Scenarios**:

1. **Given** varias cuentas con partidas jugadas, **When** el jugador abre la clasificación, **Then** ve el top 10 ordenado y puede cambiar a top 100 y global.
2. **Given** el jugador fuera del top 100, **When** abre la clasificación, **Then** ve su propio puesto y sus estadísticas aparte.
3. **Given** una partida multijugador terminada, **When** el jugador vuelve al lobby, **Then** la clasificación refleja esa partida en menos de un minuto.
4. **Given** partidas solo de historia, **When** se abre la clasificación, **Then** esas partidas no cuentan.
5. **Given** un jugador que manipula su juego para mandar estadísticas falsas, **When** las envía, **Then** no cuentan: solo cuenta lo que confirma quien aloja la partida o el servidor.

---

### User Story 4 - Amigos (Priority: P2)

El jugador busca a otro por su nombre de usuario exacto y le manda una solicitud de amistad. El otro la acepta o la rechaza. En la lista de amigos se ve quién está conectado y en qué sala está, y se puede entrar a esa sala. Se puede quitar a un amigo y bloquear a cualquier jugador.

**Why this priority**: Es la base del chat con amigos y de jugar juntos, pero el juego funciona sin ella.

**Independent Test**: Dos cuentas se agregan; cada una ve a la otra conectada o desconectada al cambiar de estado, y una puede entrar a la sala de la otra desde la lista.

**Acceptance Scenarios**:

1. **Given** un nombre exacto de otro jugador, **When** el jugador le manda solicitud, **Then** el otro la ve pendiente y puede aceptarla o rechazarla.
2. **Given** un nombre que no existe, **When** el jugador lo busca, **Then** el juego dice que no lo encontró, sin dar pistas de nombres parecidos.
3. **Given** dos amigos, **When** uno entra a una sala, **Then** el otro lo ve «en la sala X» y puede unirse (si la sala tiene código, igual se lo pide).
4. **Given** un jugador bloqueado, **When** intenta mandar solicitud, mensajes o hablar por voz, **Then** nada le llega a quien lo bloqueó.
5. **Given** un amigo quitado, **When** se revisa la lista de cualquiera de los dos, **Then** ya no aparece.

---

### User Story 5 - Chat global y chat con amigos (Priority: P3)

En el lobby y dentro de la partida hay un chat de texto con pestañas: el canal global, donde escriben todos los conectados, y conversaciones privadas con cada amigo. Dentro de una partida también hay un canal de la sala.

**Why this priority**: Mejora mucho la experiencia social, pero el juego ya es jugable con voz o sin hablar.

**Independent Test**: Dos cuentas conectadas: un mensaje en el canal global llega a ambas; un mensaje privado solo llega al amigo; un jugador bloqueado no recibe nada.

**Acceptance Scenarios**:

1. **Given** el chat global abierto, **When** el jugador escribe un mensaje, **Then** lo ven todos los conectados en menos de 2 segundos.
2. **Given** un amigo desconectado, **When** el jugador le escribe, **Then** el amigo lo ve al conectarse.
3. **Given** un mensaje con palabras ofensivas de una lista configurable, **When** se envía, **Then** esas palabras llegan tapadas.
4. **Given** un jugador que manda muchos mensajes seguidos, **When** supera el límite, **Then** sus mensajes se frenan un rato y se le avisa.
5. **Given** cualquier mensaje, **When** se muestra, **Then** solo se ve el nombre de usuario de quien lo mandó, nunca datos de su cuenta ni su dirección de red.

---

### User Story 6 - Voz por proximidad (Priority: P3)

Dentro de una partida multijugador, el jugador habla por micrófono y lo oyen los jugadores cercanos a su personaje: más fuerte cerca, cada vez más bajo, y nada más allá de una distancia. Se puede hablar presionando una tecla o con detección de voz, silenciar a cualquiera y apagar la voz del todo.

**Why this priority**: Es la función más pesada y la más arriesgada (red, privacidad), y las demás no dependen de ella.

**Independent Test**: Dos jugadores en la misma sala: cerca se oyen; al alejarse el volumen baja; pasado el alcance no se oyen; uno silenciado no se oye.

**Acceptance Scenarios**:

1. **Given** dos jugadores a menos de 5 metros, **When** uno habla, **Then** el otro lo oye a volumen pleno con menos de medio segundo de retraso.
2. **Given** los jugadores alejándose, **When** pasan de 5 a 30 metros, **Then** el volumen baja de forma gradual y más allá de 30 metros no se oye.
3. **Given** un jugador silenciado o bloqueado, **When** habla, **Then** quien lo silenció no lo oye.
4. **Given** el micrófono sin permiso o sin dispositivo, **When** se entra a la partida, **Then** el juego sigue normal y avisa que la voz no está disponible.
5. **Given** la voz activa, **When** el jugador no presiona la tecla de hablar (en ese modo), **Then** no se envía nada de su micrófono.

---

### User Story 7 - Historia con la cuenta (Priority: P2)

El modo historia se sigue jugando sin cuenta y sin internet, como hoy, con su guardado en el equipo. La cuenta es obligatoria solo para el multijugador y las funciones en línea (clasificación, amigos, chat y voz). Si el jugador tiene la sesión iniciada, su personaje de historia usa el nombre y la apariencia del perfil.

**Why this priority**: La petición pide que las cuentas sirvan en ambos modos, sin quitarle a la historia que se juegue sin internet.

**Independent Test**: Sin sesión y sin internet, la historia abre y guarda como hoy; con sesión, el personaje lleva el nombre y la apariencia del perfil; sin sesión, «Multijugador» pide entrar o crear cuenta.

**Acceptance Scenarios**:

1. **Given** la sesión iniciada, **When** el jugador entra a historia, **Then** su personaje lleva el nombre y la apariencia de su perfil.
2. **Given** ninguna sesión iniciada, **When** el jugador elige historia, **Then** juega sin pedirle cuenta, aunque no haya internet.
3. **Given** ninguna sesión iniciada, **When** el jugador elige multijugador, la clasificación, amigos o chat, **Then** el juego le pide entrar o crear una cuenta antes.
4. **Given** el guardado de historia que ya existe en el equipo, **When** el jugador inicia sesión, **Then** el guardado sigue igual y no se pierde.

---

### Edge Cases

- **Sin internet o servidor apagado** (el servidor se apaga de 0:00 a 6:00 hora de Bogotá): el juego dice que las funciones en línea no están disponibles y deja jugar lo que no las necesita.
- **Contraseña olvidada**: si la cuenta tiene correo, se recupera con un código enviado a ese correo; si no tiene, la cuenta no se puede recuperar, y el juego lo advierte al crearla sin correo.
- **Muchos intentos fallidos** de entrar a una misma cuenta: se frena esa cuenta y ese origen por un rato, sin bloquear del todo al dueño.
- **Nombres que suplantan o insultan**: los nombres de una lista configurable (insultos, «admin», «moderador», el nombre del juego) se rechazan al crear la cuenta.
- **Dos equipos con la misma cuenta a la vez**: se permite estar en el lobby en los dos, pero solo un equipo puede estar dentro de una partida con esa cuenta.
- **Un jugador que se desconecta en mitad de la partida**: las estadísticas de esa partida cuentan hasta donde llegó.
- **Partidas en red local sin internet**: se juegan como hoy, pero no cuentan para la clasificación.
- **Cuenta borrada**: desaparece de la clasificación, de las listas de amigos y su nombre queda libre después de un plazo.

## Requirements *(mandatory)*

### Functional Requirements

**Cuentas**

- **FR-001**: El sistema MUST permitir crear una cuenta con nombre de usuario y contraseña desde el juego.
- **FR-002**: Los nombres de usuario MUST tener entre 3 y 16 caracteres, solo letras a–z (sin tildes ni ñ) y dígitos 0–9, y MUST ser únicos sin distinguir mayúsculas de minúsculas; se muestran tal como se escribieron.
- **FR-003**: El juego MUST rechazar un nombre inválido antes de enviarlo, y el servidor MUST volver a validarlo y rechazarlo aunque el juego haya sido manipulado.
- **FR-004**: Las contraseñas MUST tener al menos 8 caracteres y no pueden ser iguales al nombre de usuario.
- **FR-005**: El sistema MUST permitir iniciar sesión, mantener la sesión en el mismo equipo y cerrar sesión.
- **FR-006**: El sistema MUST permitir cambiar la contraseña pidiendo la actual, y cerrar las demás sesiones de esa cuenta al cambiarla.
- **FR-007**: El sistema MUST permitir que el jugador borre su cuenta y sus datos.
- **FR-008**: El sistema MUST frenar los intentos repetidos de entrar con contraseña equivocada.
- **FR-008a**: Al crear la cuenta el jugador MAY dar un correo; el correo MUST ser privado (nadie más lo ve) y el jugador MAY agregarlo, cambiarlo o quitarlo desde su perfil confirmando con un código enviado a ese correo.
- **FR-008b**: Con correo, el jugador MUST poder recuperar la cuenta con un código de un solo uso, de vida corta, enviado a ese correo, y poner una contraseña nueva; recuperar MUST cerrar las demás sesiones. El juego MUST responder igual exista o no la cuenta o el correo, para no revelar cuáles existen.
- **FR-008c**: La cuenta MUST ser obligatoria para el multijugador por internet, la clasificación, amigos, chat y voz, y MUST NOT ser necesaria para el modo historia.

**Seguridad y privacidad**

- **FR-009**: Las contraseñas MUST viajar siempre cifradas y MUST guardarse solo de forma que nadie, ni quien administra el servidor, pueda leerlas.
- **FR-010**: Ninguna respuesta del servidor MUST incluir la contraseña, datos de acceso ni datos privados de otro jugador; lo que se ve de otro jugador se limita a su perfil público (nombre, apariencia, estadísticas y estado, según su visibilidad).
- **FR-011**: Los demás jugadores de una partida o un chat MUST NOT recibir la dirección de red de un jugador ni sus datos de sesión.
- **FR-012**: El equipo del jugador MUST guardar solo lo necesario para mantener la sesión, nunca la contraseña, y cerrar sesión MUST borrarlo.
- **FR-013**: Cada pedido al servidor MUST comprobar que quien pide tiene permiso sobre lo que pide (un jugador no puede cambiar el perfil, los amigos ni las estadísticas de otro).
- **FR-014**: El sistema MUST registrar los eventos de seguridad (entradas fallidas, cambios de contraseña, borrado de cuenta) sin registrar contraseñas.

**Clasificación**

- **FR-015**: El sistema MUST llevar por cuenta estadísticas de las partidas multijugador: partidas jugadas, días sobrevividos, plata ganada, peleas ganadas, muertes y tiempo jugado.
- **FR-016**: La clasificación MUST tener varias tablas, una por estadística (días sobrevividos, plata ganada, peleas ganadas, partidas jugadas y tiempo jugado). Cada tabla MUST mostrar top 10, top 100 y global por páginas, y el puesto del propio jugador en esa tabla.
- **FR-017**: Solo MUST contar estadísticas de partidas por internet confirmadas por el anfitrión o el servidor; las del modo historia y las de red local no cuentan.
- **FR-018**: El sistema MUST descartar estadísticas imposibles (por ejemplo, más días que el tiempo jugado permite).

**Amigos**

- **FR-019**: El jugador MUST poder mandar, aceptar, rechazar y cancelar solicitudes de amistad buscando el nombre exacto.
- **FR-020**: La lista de amigos MUST mostrar si cada amigo está conectado y, si está en una sala, cuál, con opción de unirse.
- **FR-021**: El jugador MUST poder quitar amigos y bloquear o desbloquear a cualquier jugador; un bloqueado no puede mandarle solicitudes, mensajes ni voz.
- **FR-022**: Un jugador MUST poder tener hasta 200 amigos.

**Chat**

- **FR-023**: El sistema MUST ofrecer un canal global, conversaciones privadas entre amigos y un canal de la sala dentro de la partida.
- **FR-024**: Los mensajes privados a un amigo desconectado MUST guardarse y entregarse al conectarse (hasta 30 días).
- **FR-025**: Los mensajes MUST tener un largo máximo de 200 caracteres, un límite de envío por jugador y un filtro de palabras configurable.
- **FR-026**: El jugador MUST poder silenciar el canal global y reportar un mensaje.

**Voz**

- **FR-027**: El sistema MUST permitir hablar por voz dentro de una partida multijugador con los jugadores cercanos: volumen pleno hasta 5 metros, bajando hasta 30 metros y nada más allá.
- **FR-028**: El jugador MUST poder elegir entre presionar una tecla para hablar (por defecto) o detección de voz, elegir el micrófono, ajustar el volumen de voces, silenciar a cualquier jugador y apagar la voz.
- **FR-029**: El sistema MUST NOT enviar audio del micrófono cuando el jugador no está hablando según el modo elegido, ni cuando la voz está apagada.
- **FR-030**: Un indicador MUST mostrar sobre cada personaje cuándo está hablando.

**Ambos modos**

- **FR-031**: El nombre y la apariencia del perfil MUST usarse para el personaje en multijugador y, si hay sesión iniciada, también en historia.
- **FR-032**: Si no hay conexión con el servidor de cuentas, el juego MUST seguir permitiendo lo que no lo necesita y decir qué no está disponible.

### Key Entities

- **Cuenta**: el jugador registrado. Nombre de usuario (único, solo letras y números), contraseña protegida, correo opcional y privado, fecha de creación, estado (activa, frenada, borrada).
- **Sesión**: el permiso de un equipo para actuar como una cuenta, con vencimiento. Se cierra al cerrar sesión, al cambiar la contraseña o al borrar la cuenta.
- **Perfil público**: lo que otros pueden ver: nombre, apariencia, estadísticas, estado de conexión y sala, según la visibilidad que elija el dueño.
- **Estadísticas**: los totales de una cuenta en el multijugador por internet, y su puesto en cada tabla.
- **Resultado de partida**: lo que dejó una partida para cada participante, confirmado por el anfitrión o el servidor; alimenta las estadísticas.
- **Amistad**: relación entre dos cuentas: pendiente, aceptada.
- **Bloqueo**: una cuenta que no quiere recibir nada de otra.
- **Mensaje**: texto en un canal (global, sala o privado), con autor, hora y canal.
- **Canal de voz de la sala**: la voz de los jugadores de una partida, mezclada según la distancia entre sus personajes.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Un jugador nuevo crea su cuenta y queda dentro en menos de 1 minuto.
- **SC-002**: Entrar con una cuenta existente toma menos de 3 segundos desde que se pulsa «Entrar».
- **SC-003**: En una revisión del tráfico de red y de las respuestas del servidor, no aparece ninguna contraseña ni dato privado de otra cuenta; tampoco la dirección de red de otros jugadores en el chat.
- **SC-004**: El 100 % de los nombres con caracteres no permitidos y de los nombres repetidos se rechaza, incluso si se envían saltándose el juego.
- **SC-005**: La clasificación muestra el resultado de una partida en menos de 1 minuto después de terminada.
- **SC-006**: Un mensaje de chat llega a quienes están conectados en menos de 2 segundos.
- **SC-007**: La voz llega con menos de medio segundo de retraso y el juego mantiene sus cuadros por segundo con 8 jugadores hablando.
- **SC-008**: El sistema soporta 500 jugadores conectados a la vez sin que entrar, el chat o la clasificación se vuelvan lentos.
- **SC-009**: Tras 10 intentos fallidos de entrar a una cuenta en 15 minutos, los siguientes intentos se frenan.

## Assumptions

- El servidor de cuentas, de chat y de clasificación vive en el mismo proyecto de AWS que el servidor de salas (región us-east-2) y comparte su horario de encendido de 6:00 a 23:59, hora de Bogotá, salvo que se decida otra cosa en el plan.
- No se usan cuentas de Google u otras redes sociales: solo nombre de usuario y contraseña, como se pidió.
- La voz solo funciona dentro de una partida multijugador; en el lobby no hay voz.
- El guardado de la historia sigue en el equipo; no se sube a AWS.
- La red local sigue funcionando sin cuenta y sin servidor, como hoy.
- Los textos y nombres del juego siguen las reglas del proyecto: sin marcas ni logos, y en español.
- La lista de palabras prohibidas para nombres y chat la mantiene el equipo del juego y puede cambiar sin publicar otra versión.
- Los costos de AWS deben mantenerse bajos; el plan elegirá servicios acordes al plan de la cuenta.
- Los jugadores con versiones anteriores del juego, sin cuentas, siguen pudiendo jugar en salas pero no aparecen en la clasificación ni en amigos.
