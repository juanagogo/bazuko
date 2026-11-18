# Plan: modo historia

Es la vida de una persona que vive en la calle en el centro de Bogotá: **cómo llegó allí y qué pasa después**. No es una historia de «salir adelante» ni de «hundirse»: es una historia de **sobrevivir con dignidad** y de las decisiones que caben en esa vida.

## Punto de partida (lo que ya existe)

- **Orígenes** (`src/data/origins.js`, ya en el juego web): *Perdí el trabajo*, *Me desplazaron*, *Salí de mi país*, *El gota a gota*. Cada uno con un relato sobrio y un efecto, bajo la regla de que **nadie gana una ventaja por lo que le pasó**. El modo historia parte de estos cuatro y no inventa otros.
- **Momentos** (`Momentos.js`, `PrimeraPlana.js`, `momentosTextos.js`): pantallas de cartón (muerte, arresto, dormir, recorte de periódico). Es el lenguaje visual para las escenas.
- **Mundo con lugares con historia**: el Parque Tercer Milenio (se construyó donde estuvo el Cartucho), la Caracas, el Portal, La Candelaria, Chapinero, el viaducto, el Parque del Lago.
- **Sistemas vivos**: necesidades, clima y hora, jíbaro, dealer, recicladores, policía, «limpieza social», radio con boletines, el Chato, talentos y el cambuche.
- **Pendiente de construir**: un sistema de misiones real (hoy solo hay un objetivo de tutorial en el HUD), diálogos con opciones, estado de historia en el guardado y escenas.

## Principios de tono (innegociables)

Salen de lo que el proyecto ya decidió (`AGENTS.md`, sección *Limpieza social* y la nota de origen) y se vuelven reglas del guion:

1. **Dignidad.** La persona nunca es un chiste, un monstruo ni un símbolo. Tiene nombre, pasado, humor, gustos y vínculos.
2. **Sin causa única ni culpa única.** Nadie «llegó a la calle por una droga»: llega por una **cadena** de pérdidas (trabajo, vivienda, vínculos, salud), y el consumo, si aparece, es consecuencia o forma de aguantar, nunca el origen moral.
3. **Sin moralejas ni puntajes.** Sin barras de «moral», sin logros, sin cuentas de muertes o robos. Las decisiones cambian el mundo y a las personas, no un número.
4. **Sin glamour.** Ni el consumo, ni la violencia, ni el robo se muestran como aspiracionales. Tampoco se castigan con sermón.
5. **Lo más delicado es lo más sobrio**: la violencia contra habitantes de calle (la «limpieza social», que existe en la realidad) se cuenta con el mismo cuidado del recorte de periódico actual: sin exclamaciones y sin espectáculo.
6. **Humor de calle sí**, a costa del sistema y de la situación, **nunca de la persona**.
7. **Sin final de «rescate».** El juego puede mostrar salidas posibles (hogar de paso, retorno a casa, un trabajo) y también permanencias dignas (comunidad, oficio de reciclador). Ninguna se presenta como «la correcta».

## Premisa

El jugador crea a su personaje y elige **de dónde viene** (uno de los cuatro orígenes). El modo historia se cuenta en **tres tiempos** que se entrelazan:

- **Antes** (recuerdos): cómo era la vida y cómo se fue deshaciendo. Se vive a pedazos, no de golpe.
- **El Llegar** (prólogo): los primeros días en la calle. Es el tutorial emocional: frío, hambre, no saber dónde dormir, aprender los códigos.
- **Ahora** (el cuerpo del juego): una vida en el centro, con personas que la sostienen o la complican, y decisiones que no tienen respuesta limpia.

### «Cómo llegó» y «por qué» por origen (esquemas de guion)

Cada uno sigue la misma estructura de cinco pérdidas: **trabajo → vivienda → vínculo → salud → documentos**, con su detonante propio.

| Origen | Detonante | Qué se rompe después | Qué lo deja en la calle |
|---|---|---|---|
| **Perdí el trabajo** | Cierran el local donde trabaja; sin contrato ni prestaciones. | No alcanza la pieza; deja de ver a su hija por vergüenza. | Un desalojo en una noche de lluvia. |
| **Me desplazaron** | Salen del campo huyendo de la violencia con lo puesto. | Llegan a la ciudad sin papeles, sin red; la ayuda tarda y se pierde en trámites. | Las pensiones del centro se acaban antes que el subsidio. |
| **Salí de mi país** | Cruzó la frontera buscando trabajo. | Empleo informal, sin permiso; deuda con quien lo trajo. | Lo despiden, pierde el cuarto, y no puede volver ni quedarse con papeles. |
| **El gota a gota** | Un préstamo pequeño para arreglar algo. | Intereses diarios, amenazas, vender lo que tiene. | Pierde casa y negocio; huye de los cobradores. |

Ninguno de los cuatro menciona el consumo como causa. Si el jugador lo encuentra más adelante, **el juego lo trata como parte de la vida en la calle** (frío, dolor, insomnio, compañía), no como el «porqué».

### Reparto (personajes recurrentes)

Personas, no arquetipos. Cada una con su propia necesidad, que el jugador puede ayudar o no.

- **Un reciclador veterano**: enseña el oficio y las reglas; tiene su propia deuda con el pasado.
- **Una vendedora de tinto**: ve más de lo que dice; el centro de una red de favores.
- **Un joven recién llegado**: espejo del jugador; puede acabar bajo la protección del jugador o en manos de la olla.
- **Una trabajadora social** (institucional, no villana): ofrece un camino con su propio costo (cupos, horarios, papeles).
- **Un policía**: no uniformemente cruel ni bueno; su decisión cambia con la hora, el sitio y la presión.
- **Alguien del pasado** (familia, antiguo jefe, deudor): el hilo que conecta *Antes* con *Ahora*.
- **El Chato**: la constancia. Su destino es una de las decisiones más difíciles del juego.

## Estructura (borrador de actos)

1. **El Llegar** (prólogo, ~1 h). Primera noche, primer cambuche, aprender oficio, el primer error. Se juega con los controles y sistemas que ya existen, con guion encima.
2. **La Calle** (acto I). Se establece la rutina, la red de personas, un conflicto local (un robo, una deuda, un enfermo). Primeros recuerdos.
3. **Lo que se debe** (acto II). El pasado alcanza al personaje (según origen): el deudor, el trámite, la familia, la frontera. Aparece la oferta institucional.
4. **El Cartón** (acto III). Una noche difícil en la ciudad (lluvia, frío, la camioneta). Es el punto de mayor riesgo y el más sobrio.
5. **Lo que queda** (epílogo). Un cierre abierto según lo que el jugador cuidó: personas, el Chato, el cambuche, el pasado. **No hay pantalla de «ganaste»**: hay una última escena en la ciudad, de día, con lo que quedó.

Duración objetivo: 8–12 horas con un solo origen; cada origen cambia el prólogo, los recuerdos y el acto II (acto I, III y epílogo comparten estructura con variaciones).

## Cómo se construye (técnico)

### Sistemas nuevos (módulos)

1. **Estado de historia** (`story/StoryState`): banderas, contadores acotados, relaciones por persona, objetos clave, acto actual. Se guarda en el `savegame.json` (con versión y migración). **No se muestran numéricamente al jugador.**
2. **Datos de guion en JSON** (`assets/data/historia/*.json`): escenas, diálogos, misiones, condiciones y efectos. Sin lógica de historia en C++; así se escribe y prueba sin recompilar. Con un validador (`tools/validar_historia.py`) que comprueba referencias rotas, textos fuera de la tipografía del juego (`letra.test`) y ramas sin salida.
3. **Motor de misiones y objetivos** (`story/Quest`): estados, pasos, condiciones (lugar, hora, clima, necesidad, objeto, persona, evento) y recompensas **diegéticas** (un objeto, una puerta abierta, una persona que vuelve), no puntos. Sustituye el objetivo suelto del HUD.
4. **Diálogos con opciones** (`story/Dialogue`): tarjetas de cartón y marcador (misma identidad que `SignStyle`/`Momentos`), con retrato del NPC, opciones cortas, y reacciones breves del personaje. Teclado y mando, sin cronómetros de decisión.
5. **Escenas** (`story/Scene`): secuencias cortas con control de cámara, atenuado, hora y clima forzados, NPC que caminan a un punto y pantallas de cartón. Reutiliza la cámara de foto y los *Momentos*.
6. **NPC con agenda** (`character/Npc` + horarios): los personajes del reparto tienen rutina por hora (dónde duermen, dónde trabajan, cuándo faltan). Aparecen donde el guion los necesita **sin teletransportarse**.
7. **Recuerdos** (`story/Memory`): objetos (una foto, una tarjeta, una llave) que al **inspeccionarse** abren un flashback breve (una escena o un texto en cartón). Se coleccionan solo como parte del inventario normal.
8. **Disparadores en el mundo**: una zona, una hora, una necesidad por debajo de un umbral, una lluvia, un arresto, la muerte, una venta, etc. Se conectan a los eventos que ya hay (`substance-consumed`, `mirror-stolen`, `sleep-start`…).
9. **Audio y música**: capa de ambiente narrativo (radio, voces breves, silencios). Música mínima; lo diegético manda (radio del juego, boletines locales).
10. **Modo de prueba**: `BAZUKO_HISTORIA=<acto>.<escena>` para saltar a una escena, y registro de banderas, como los modos de prueba que ya existen.

### Cambios sobre lo existente

- **Misiones y economía**: lo que hoy se puede hacer libremente (reciclar, pedir, vender, el jíbaro) se vuelve **fuente de situaciones**, no solo de dinero.
- **Creador de personaje**: añade elegir el origen (ya definido) y un **nombre**; el nombre se usa en diálogos y en el recorte.
- **Muerte y arresto**: siguen siendo explícitos; en historia la muerte **no es «fin de partida»** automático: abre un tramo breve de consecuencia (qué pasó con lo que dejó) y reanuda.
- **Pausa y menús**: se mantienen (es un modo de un jugador); si luego hay multijugador, el modo historia queda fuera de él.
- **Idioma y registro**: español de Bogotá, con la jerga que ya usa el juego; sin tecnicismos, sin sociolecto caricaturesco.

## Hitos

| Hito | Contenido | Esfuerzo | Se puede probar cuando… |
|---|---|---|---|
| **H0. Biblia narrativa** | Documento de personajes, lugares, cronología real de Bogotá, tono y glosario; revisión externa (ver abajo) | 2–3 sem (en paralelo) | Hay un documento aprobado por quienes lo revisan |
| **H1. Estado y datos** | `StoryState`, formato JSON, validador, guardado con versión | 1–2 sem | Un JSON de ejemplo cambia una bandera y sobrevive al guardado |
| **H2. Misiones y objetivos** | Motor de quests y condiciones; reemplazo del objetivo del HUD | 2 sem | Una misión de recolección completa sus pasos por eventos reales |
| **H3. Diálogo** | Tarjeta de diálogo, opciones, retratos, mando y teclado | 1–2 sem | Una conversación con tres ramas y efectos persistentes |
| **H4. Escenas y NPC con agenda** | Escenas con cámara, atenuado y caminatas; rutinas horarias | 2–3 sem | Una escena corta guionada se reproduce igual en 10 de 10 intentos |
| **H5. Prólogo «El Llegar»** | Primera noche jugable completa del origen *Perdí el trabajo* | 3–4 sem | Una persona ajena al proyecto termina la hora sin ayuda y entiende qué hacer |
| **H6. Recuerdos** | Objetos inspeccionables y flashbacks | 1–2 sem | Un recuerdo se abre desde el inventario y cambia un diálogo |
| **H7. Acto I** | Rutina, red de personas, primer conflicto local | 3–4 sem | Juego de principio a fin con un origen |
| **H8. Actos II y III y epílogo** | Variaciones por origen y el tramo de mayor riesgo | 4–6 sem | Los cuatro orígenes llegan al epílogo |
| **H9. Pulido** | Audio, ritmo, pruebas con jugadores, accesibilidad, correcciones de tono | 3 sem | Revisión final del guion con el panel de lectura |

Total: **~5–6 meses** con una sola persona a tiempo completo y escritura incluida; el guion (H0, H5, H7, H8) es la mayor parte del esfuerzo, más que la programación. Un recorte posible: salir con **un solo origen completo** (*Perdí el trabajo*) y añadir los otros tres como actualizaciones.

## Riesgos y cómo se cubren

1. **Trivializar o estigmatizar.** Revisión con **personas que han vivido en la calle** y con organizaciones que trabajan con ellas (recicladores, fundaciones, programas distritales como los de IDIPRON y la Secretaría de Integración Social). Se les paga y se les da crédito; sus correcciones prevalecen.
2. **Pornografía de la miseria.** Todo texto o escena se mide con la pregunta: *¿esto le sirve a la persona retratada o solo al espectador?* Si no, se corta.
3. **Material delicado** (violencia, consumo, suicidio, abuso). Aviso de contenido al empezar, sin sensacionalismo; nada gráfico; no se muestran métodos; si aparece el suicidio o la violencia sexual, solo como un hecho en el pasado y nunca como mecánica; y se incluye un acceso visible a ayuda real (línea nacional de apoyo emocional) dentro del menú de pausa.
4. **Mezcla del hilo moral con el sistema de juego.** Si una acción «da puntos» o «castiga», contradice el tono. Regla: **la historia nunca puntúa**.
5. **Contradicción entre libertad y guion.** Un mundo abierto puede romper escenas: las misiones usan *ventanas* (franja horaria, clima, lugar), pueden esperarse y nunca se pierden por una muerte o por dormir.
6. **Alcance del guion.** Es el mayor riesgo. Por eso el hito 5 (prólogo completo) es el filtro: si cuesta el doble de lo previsto, se recorta el número de orígenes, no la calidad.
7. **Datos reales.** Los hechos históricos (el Cartucho y su demolición para el Parque Tercer Milenio, la intervención del Bronx, las políticas distritales) se verifican con fuentes públicas y se citan en la biblia; lo no verificable se narra como ficción sin nombre propio.

## Decisiones que necesito de ti

1. **Alcance de la primera entrega**: ¿un solo origen completo o los cuatro desde el inicio?
2. **¿Quién escribe y quién revisa?** ¿Hay alguien con experiencia de calle o de trabajo social que pueda acompañar el guion?
3. **Final**: ¿epílogo único con variaciones, o varios finales distintos?
4. **La muerte** en historia: ¿consecuencia narrativa (mi propuesta) o reinicio desde el último descanso?
5. **¿El Chato puede morir?** Es la decisión de tono más fuerte; propongo que solo ocurra si el jugador lo elige o lo descuida durante mucho tiempo, y siempre con escena.
6. **Voces**: ¿solo texto, voces breves de NPC (ya hay voces sueltas) o doblaje?

## Primer paso propuesto

Escribir la **biblia narrativa (H0)** y, en paralelo, el **formato de datos con su validador (H1)**; con eso se puede escribir el prólogo en JSON y probarlo antes de tocar el motor.
