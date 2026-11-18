# Feature Specification: Mejorar las animaciones del personaje y los NPC (port en C++)

**Feature Branch**: `001-mejorar-animaciones-port` (sin rama propia: se trabaja sobre la rama actual y no se crea una nueva)

**Created**: 2026-11-09

**Status**: Draft

**Input**: User description: "Mejorar las animaciones del personaje jugable y de los NPC del port en C++ de Bazuko, por lotes aprobables uno a uno: locomoción (caminata, correr, tres saltos), agachado (popó, inspeccionar y recoger basura), acciones con objetos (retrovisor, nadar, fumar, oler, basuco), combate (puños, patadas, captura policial) y NPC subiendo y bajando de vehículos. Valen para jugador y NPC, con movimiento libre de licencias restrictivas y con comparación visual antes y después que el usuario aprueba."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Caminar, correr y saltar se ven naturales (Priority: P1)

Quien juega ve a su personaje, y a los peatones, caminar y correr con un paso creíble: zancada que corresponde a la velocidad, brazos que acompañan, torso que no flota. Los tres saltos (desde quieto, caminando y corriendo con zancada) tienen preparación, vuelo y caída reconocibles, y se enlazan con el paso sin cortes bruscos.

**Why this priority**: es lo que más tiempo está en pantalla en cualquier partida y lo que más se nota en todos los personajes a la vez; mejora la percepción de todo el juego aunque nada más cambie.

**Independent Test**: arrancar el juego, caminar, correr y saltar en los tres modos frente a la cámara y comparar con las capturas de «antes» del mismo recorrido; cada movimiento se evalúa por separado.

**Acceptance Scenarios**:

1. **Given** el jugador en reposo, **When** empieza a caminar y luego a correr, **Then** el paso cambia de forma continua con la velocidad, sin deslizar los pies sobre el suelo de forma visible.
2. **Given** el jugador quieto, caminando o corriendo, **When** salta, **Then** ve la variante que corresponde a su estado (estático, en movimiento o con zancada) y conserva su rumbo y su velocidad durante el vuelo.
3. **Given** un peatón caminando o corriendo asustado, **When** se le mira de cerca y de lejos, **Then** su paso es de la misma calidad que el del jugador.

---

### User Story 2 - Agacharse con sentido en cada acción (Priority: P2)

El personaje se agacha de forma distinta según lo que hace: para hacer popó, para inspeccionar una caneca o una bolsa y para recoger lo que encuentra. La postura, la profundidad y hacia dónde mira son coherentes con la acción y con el objeto.

**Why this priority**: son acciones muy frecuentes del ciclo de supervivencia (recolectar basura) y hoy se leen todas como la misma postura genérica.

**Independent Test**: ejecutar cada acción por separado en el juego y revisar que la postura corresponda a lo que se hace y que al terminar el personaje vuelva a la postura de pie sin saltos.

**Acceptance Scenarios**:

1. **Given** una caneca o bolsa al alcance, **When** el jugador inspecciona, **Then** se inclina hacia ella con las manos hacia el objeto; al recoger, la mano toma el objeto y se incorpora.
2. **Given** el jugador activa la acción de hacer popó, **When** la ejecuta, **Then** adopta una postura de cuclillas estable y vuelve a ponerse de pie al terminar.
3. **Given** cualquiera de las tres acciones, **When** el jugador es interrumpido (golpe, salto, nado), **Then** la animación se corta sin dejar al personaje torcido o en el suelo.

---

### User Story 3 - Las acciones con objetos se ven creíbles (Priority: P3)

Robar un retrovisor, nadar, fumar un cigarrillo o un porro, oler y usar la pipa de basuco tienen cada una su movimiento propio, con las manos y la cabeza donde corresponde y con el objeto en la mano durante el gesto.

**Why this priority**: son los gestos que le dan identidad a la vida de calle del juego, pero cada uno ocurre con menos frecuencia que caminar o agacharse.

**Independent Test**: ejecutar cada acción y comparar con el «antes» en el juego; en cada una, el objeto (retrovisor, cigarrillo, pipa) queda sujeto a la mano durante todo el gesto.

**Acceptance Scenarios**:

1. **Given** un carro en circulación, **When** el jugador roba el retrovisor, **Then** extiende el brazo hacia el espejo, lo agarra y lo recoge, con el cuerpo orientado hacia el carro.
2. **Given** agua profunda, **When** el jugador nada, **Then** las brazadas y el cuerpo se ven coordinados con la dirección y la velocidad.
3. **Given** un cigarrillo, un porro, el pegante (que se huele) o la pipa de basuco, **When** el jugador los usa, **Then** cada gesto es reconocible y distinto de los demás.

---

### User Story 4 - Peleas con golpes y capturas convincentes (Priority: P4)

Los puñetazos y las patadas tienen preparación, impacto y recuperación legibles, tanto del jugador como de los NPC agresivos. Cuando la policía alcanza al jugador, ahora lo atrapa y lo somete con una animación propia entre el agente y el jugador, en vez de limitarse a golpearlo.

**Why this priority**: el combate y el arresto son momentos de alta tensión del juego; la captura policial es una animación nueva que hoy no existe.

**Independent Test**: provocar una pelea y dejar que una patrulla alcance al jugador; revisar que los golpes se lean bien y que la captura tenga principio, sujeción y final.

**Acceptance Scenarios**:

1. **Given** un enfrentamiento, **When** el jugador o un NPC golpea con puño o patada, **Then** se distinguen preparación, impacto y recuperación y el golpe corresponde al momento en que se aplica el daño.
2. **Given** un policía que alcanza al jugador, **When** lo captura, **Then** ambos personajes muestran una secuencia de sujeción coordinada (el agente agarra y reduce, el jugador es reducido) y el juego continúa con lo que ya hace hoy tras ser atrapado.
3. **Given** que el jugador está fuera del alcance al llegar el policía, **When** el policía lo alcanza después, **Then** la captura empieza desde donde estén los dos, sin teletransportes visibles.

---

### User Story 5 - Los conductores suben y bajan del vehículo con naturalidad (Priority: P5)

Los NPC que conducen se bajan de su vehículo y vuelven a subir con un movimiento creíble: abren la puerta, salen, y al regresar entran y se sientan, tanto en carros como en patrullas y motos.

**Why this priority**: ocurre pocas veces por partida y solo con NPC, pero hoy es de los gestos más pobres.

**Independent Test**: provocar a un conductor para que se baje y vuelva a subir, y revisar la salida y la entrada en cada tipo de vehículo.

**Acceptance Scenarios**:

1. **Given** un conductor detenido, **When** se baja, **Then** abre la puerta del lado correspondiente, sale y queda de pie junto al vehículo sin atravesarlo.
2. **Given** el conductor de regreso junto a su puerta, **When** sube, **Then** entra, se sienta y cierra la puerta sin aparecer sentado de golpe.

---

### Edge Cases

- Una acción se interrumpe a la mitad (golpe, caída, entrar al agua, muerte): el personaje no debe quedar en una pose imposible ni con el objeto atravesado.
- El jugador cambia de caminar a correr o a saltar justo al inicio o final de otro movimiento: la transición no debe mostrar un salto brusco.
- Muchos NPC en pantalla con las animaciones nuevas: el costo por NPC no debe notarse en cuadros por segundo.
- Cuerpos y ropas distintas (variantes del creador de personaje): el mismo movimiento debe verse bien en todas, sin que miembros o prendas atraviesen el cuerpo.
- La policía captura al jugador con un obstáculo, un bus o una pared muy cerca: la secuencia no atraviesa geometría de forma visible.
- Un clip con licencia dudosa o sin atribución: no puede entrar al juego hasta resolverlo.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El juego MUST ofrecer, para el jugador y los NPC, una caminata y una carrera cuya velocidad de paso corresponde a la velocidad de desplazamiento, sin deslizamiento visible de los pies.
- **FR-002**: El juego MUST ofrecer tres saltos distintos (desde quieto, caminando y corriendo con zancada) que conserven el rumbo y la velocidad de quien salta.
- **FR-003**: El juego MUST ofrecer tres movimientos de agachado diferenciados: hacer popó, inspeccionar basura y recoger basura.
- **FR-004**: El juego MUST ofrecer movimientos propios para robar el retrovisor, nadar, fumar (cigarrillo y porro), oler y usar la pipa de basuco.
- **FR-005**: El juego MUST ofrecer golpes de puño y patadas con preparación, impacto y recuperación legibles, sincronizados con el momento en que se aplica el daño.
- **FR-006**: El juego MUST ofrecer una animación de captura policial, nueva, en la que el agente agarra y reduce al jugador, que reemplaza el simple golpe cuando la policía lo alcanza.
- **FR-007**: El juego MUST ofrecer movimientos de salir y volver a entrar al vehículo para los NPC conductores, para cada tipo de vehículo que hoy los lleva.
- **FR-008**: Todos los movimientos MUST valer para el jugador y los NPC con el mismo cuerpo, y verse bien en las variantes de cuerpo y ropa del creador de personaje.
- **FR-009**: Todos los movimientos MUST dejar el desplazamiento horizontal al juego: el personaje no debe desplazarse por cuenta de la animación; solo puede cambiar la altura del cuerpo y las poses.
- **FR-010**: El costo de animar a los NPC MUST mantenerse en el mismo orden que el actual: el juego no debe bajar de forma apreciable sus cuadros por segundo con los 80 peatones y 8 vendedores en pantalla.
- **FR-011**: Cada movimiento que no se haya creado desde cero MUST tener una licencia verificada que permita uso comercial y redistribución dentro de un juego, y su origen y atribución MUST quedar documentados junto al recurso. Ningún material con licencia solo de evaluación o no comercial puede entrar al juego.
- **FR-012**: Los movimientos que no tengan una fuente libre equivalente (por ejemplo, la captura policial o la pipa de basuco) MUST crearse expresamente para el juego, sin material de terceros.
- **FR-013**: El trabajo MUST entregarse por lotes (locomoción, agachado, acciones con objetos, combate, vehículos), y cada lote MUST presentarse con una comparación visual de antes y después que el usuario revisa y aprueba antes de empezar el siguiente.
- **FR-014**: Ningún movimiento ni recurso MUST incluir marcas o logos, y los cuerpos jóvenes MUST seguir sin mostrar torso ni piernas descubiertos en ninguna pose.
- **FR-015**: La acción «oler» MUST ser el gesto de oler el pegante o un cigarrillo como parte del consumo: el objeto sube a la nariz, se hace la inhalación y se baja, reconocible y distinto de fumar.

### Key Entities

- **Movimiento**: un gesto o desplazamiento animado del cuerpo (por ejemplo «salto corriendo»). Tiene un nombre, el lote al que pertenece, un origen (captura con licencia libre o creación propia), su atribución y una fecha de aprobación.
- **Lote**: un grupo de movimientos que se entrega y se aprueba junto. Tiene un estado (pendiente, en revisión, aprobado) y sus comparaciones visuales de antes y después.
- **Comparación de antes y después**: evidencia visual del movimiento actual frente al nuevo, en las mismas condiciones de cámara y de escena.
- **Registro de licencias**: lista de cada fuente externa usada, con su licencia, su enlace y la atribución que exige.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: En una revisión lado a lado hecha por el usuario, al menos el 90 % de los movimientos de cada lote se juzgan «mejor o igual» que el movimiento actual, y ninguno «peor».
- **SC-002**: En caminata y carrera a cualquier velocidad, no se aprecia deslizamiento de pies en una revisión visual de un recorrido de al menos 60 segundos del jugador.
- **SC-003**: Con los 80 peatones y 8 vendedores en la escena, los cuadros por segundo no bajan más de un 5 % respecto al estado actual en el mismo recorrido.
- **SC-004**: El 100 % de los recursos de movimiento incorporados tiene su licencia, su enlace y su atribución en el registro, y ninguno tiene una licencia restringida a evaluación o a uso no comercial.
- **SC-005**: El 100 % de los lotes se entrega con su comparación de antes y después y con la aprobación del usuario antes de iniciar el lote siguiente.
- **SC-006**: Los movimientos nuevos funcionan sin cortes visibles al enlazarse con los movimientos vecinos (parado, caminar, correr, saltar, golpear) en una prueba de 50 transiciones al azar.
- **SC-007**: La captura policial se completa de principio a fin, sin atravesar al jugador ni a obstáculos, en al menos el 95 % de 20 capturas provocadas en lugares distintos.

## Assumptions

- El trabajo es solo para el port en C++ del juego; el juego web queda fuera.
- Jugador y NPC comparten el mismo cuerpo y el mismo banco de movimientos, y por eso un movimiento nuevo sirve para ambos.
- El desplazamiento horizontal lo calcula siempre el juego y no la animación, como hoy.
- Existen ya movimientos para casi todos estos gestos (saltos, golpes, patadas, subir y bajar de vehículos, fumar, pipa y nado); «mejorar» significa que el usuario los juzga mejores tras verlos al lado de los actuales. La captura policial es la única animación totalmente nueva.
- «Meter basuco» se refiere a usar la pipa de basuco que el juego ya tiene.
- La captura policial no cambia lo que ocurre en el juego después de que atrapan al jugador; solo sustituye el golpe por una secuencia de sujeción.
- Las fuentes de captura de movimiento libres que sirvan para locomoción (caminar, correr, saltar) se buscarán y verificarán durante el diseño; la lista concreta y sus licencias se fijarán en el plan y se documentan antes de incorporar ningún clip.
- El usuario es quien aprueba cada lote; sin su aprobación no se pasa al siguiente.
- Quedan fuera de alcance: animaciones de animales (El Chato, palomas, ratas), cambios de apariencia del personaje y la versión móvil.
