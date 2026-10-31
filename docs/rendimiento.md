# Rendimiento y medición

Las optimizaciones reducen trabajo de renderizado y consultas de simulación conservando el mapa, las partidas guardadas, los cruces y las colisiones por altura. La referencia de la primera entrega es el commit `3abc15a8fae36ba3f479296ff101128c2fcd7429`.

## Cambios

- Las casas que reutilizan una variante de fachada comparten el material base. Las paredes que se atenúan conservan materiales independientes; los lotes cerrados usan sus propios materiales compartidos, para que una pared transparente no afecte a otras casas. Las luces nocturnas actualizan ambos conjuntos.
- Cámara y movimiento consultan una cuadrícula espacial de 16 metros. Las cajas extensas se registran en todas las celdas que ocupan, se deduplican y conservan el orden de resolución anterior. Permanecen las pruebas precisas AABB/OBB, el barrido y los colliders `layered`.
- El tráfico indexa personas y vehículos una vez por subpaso y separa vehículos por ruta. Las consultas cubren la distancia de frenado y el tamaño del otro vehículo; no se suspende tráfico por estar fuera de cámara.
- Los peatones a más de 40 metros dejan de actualizar su pose, aunque sigan caminando. Los cercanos y medios tienen una frecuencia visual según el perfil gráfico. Navegación, reacciones y movimiento continúan.
- Las acciones de animación con un peso residual inferior a 0,001 se desactivan. Cambiar apariencia o retirar un NPC libera materiales, esqueletos y geometrías propios, también si una carga asíncrona llega después de retirar al personaje. Los recursos del banco siguen compartidos. La geometría de cuerpo que se recorta bajo ropa tiene buffers propios para poder liberarlos sin dañar otra instancia.
- Las luces se descubren al registrar una rama, sin recorrer toda la ciudad cada segundo. Sus posiciones estáticas se fijan después de cargar modelos; intensidad y visibilidad siguen actualizándose. El fogón ya está registrado antes de construirlo y se activa mediante visibilidad. Se mantienen dos proxies de luz y los halos instanciados.
- Faroles, aros de robo de los carros estacionados, bolsas, contenedores y sus aros se dibujan en lotes instanciados (`InstancedChunks`, `VehicleBatches` e `InstanceBatches`). Cada objeto conserva su `visible` como estado del juego (recogida, reaparición, robo, enfriamiento); el lote de recogibles se arma después del descarte por frustum. El aro de potenciador no se dibuja mientras su opacidad es 0.
- La silueta conserva sus dos pasadas correctivas, pero se omite en calidad baja y cuando los volúmenes de colisión no indican obstrucción del jugador. La lista de luces de esas pasadas es explícita y no necesita recorrer la ciudad.
- La primera partida empieza en calidad baja. La adaptación baja resolución con mayor rapidez ante carga severa y, al alcanzar el mínimo, puede reducir sombras, silueta, distancia de cámara y frecuencia visual de animación. No sobrepasa el perfil elegido por el jugador ni cambia la simulación.

El recorte isométrico conserva sus paredes individuales. Esta entrega no reexporta esqueletos reducidos ni introduce un sistema nuevo de LOD geométrico para edificios. Son pasos posteriores que necesitan medición y revisión visual de los recursos.

En una comparación estructural con la misma ciudad de 511 edificios y 1.372 colliders, los materiales de los lotes cerrados pasaron de 903 a 345 y sus mallas de 908 a 890. Una consulta de cámara en la zona inicial pasó de revisar 1.372 cajas a obtener siete candidatas. Para esta comparación se usó geometría real y se sustituyeron Canvas y carga de personajes; el azar de generación se mantuvo separado del de UUID para conservar la escena. Son recuentos de trabajo, no una medición de FPS ni de GPU.

## Estadísticas recientes

El mínimo y máximo del HUD siguen siendo históricos desde el último reinicio. Los nuevos percentiles usan un anillo de los últimos 600 cuadros activos, no una ventana temporal fija. `p95` y `p99` son percentiles de duración de cuadro con rango más próximo; valores menores son mejores. El 1 % bajo se obtiene como `1000 / media de duración del 1 % de cuadros más lentos`, redondeando hacia arriba la cantidad de cuadros. Los tirones cuentan duraciones superiores a 100 ms dentro del mismo anillo.

## Perfil de CPU

Desde la consola del navegador, después de entrar a jugar:

```js
const game = window.__game;
game.profiler.reset();
game.performanceHUD.metrics.reset();
game.profiler.enabled = true;
```

Recorrer la misma zona durante 30–60 segundos y luego obtener los datos:

```js
game.profiler.enabled = false;
JSON.stringify(game.getPerformanceReport(), null, 2);
```

El perfilador almacena hasta 1.800 cuadros en memoria y separa jugador/cámara/colisiones, sistemas, mundo/NPC, tráfico, entidades/clima/audio, envío de render/luces/culling e interfaz. Devuelve p50/p95/p99 en milisegundos. Está desactivado por defecto, no escribe por cuadro en consola y no envía datos a ningún servicio.

El tiempo alrededor del render es CPU y envío de órdenes: **no mide el tiempo GPU**. Para GPU usar una captura del navegador o consultas temporales asíncronas válidas. Comparar con la misma resolución, cámara, calidad, escena y DPR fijo. Un navegador con renderizado por software sirve para comprobar flujos, no para estimar FPS del equipo del jugador.

## Mantenimiento

- Las cajas estáticas se indexan de nuevo al sustituir su array o cambiar su longitud. Tras mover o modificar una caja ya registrada, llamar a `collisions.invalidateStaticIndex()`.
- Al añadir luces dentro de una rama existente, llamar a `localLights.register(rama)`. Tras mover fuentes marcadas como estáticas, usar `localLights.refreshSources({ static: true })` después de terminar los cambios. Añadir o retirar raíces directamente de la escena ya registra o retira sus luces.
- Mantener los materiales de lotes cerrados separados de los clones que cambian de opacidad. No liberar geometrías o texturas compartidas al destruir un personaje.
- Validar con `npm test`, `npm run build` y `npm run test:e2e`. Las pruebas de regresión comparan el barrido indexado con una consulta exhaustiva e incluyen límites de celdas, cajas extensas, limpieza de recursos, recuperación de calidad y estadísticas acotadas.

## Validación de la primera entrega

`npm test` completó correctamente los 47 archivos de pruebas y `npm run build` terminó sin errores. Las pruebas de navegador se intentaron con Chromium y renderizado por software: una ejecución llegó a la partida, pero los recorridos completos encontraron tiempos agotados y cierres de pestaña durante la preparación gráfica. No se consideran una suite E2E aprobada ni una medición de FPS en GPU real. Se corrigió una expectativa antigua de la nota inicial que exigía créditos actualmente ocultos, manteniendo intacta esa nota.

## Línea base de la ciudad sola (rama cambio-de-prueba-de-ciudad)

Medida con `?perf` en X 209.48, Z 38.65 (tercera persona, mediodía, calidad baja bloqueada, panel DEV con carros, TransMilenio, peatones, palomas, Chato, árboles, lluvia, luces, sombras y efectos apagados). El tiempo es el de CPU de `Renderer.render` (mediana de las llamadas del bucle del juego), que no depende de la velocidad del panel integrado.

| Qué se oculta | Dibujos | CPU de render |
| --- | --- | --- |
| nada | 1018 | 19,9 ms |
| `Edificios agrupados en tercera persona` | 701 | 15,3 ms |
| todos los `Sector x,z` estáticos | 157 | 7,4 ms |

- Cada dibujo cuesta 14–20 µs de CPU; con ~1000 dibujos el cuadro supera los 30 ms sin que los triángulos (≈400 mil, la mayoría en objetos sueltos y semáforos) ni los píxeles sean el límite.
- Los sectores estáticos suman ~550 dibujos con 146 materiales distintos y mallas diminutas (media de 20–60 triángulos): la fusión por material × chunk de 32 m produce muchos dibujos pequeños. Las calzadas, andenes y bordillos suman ~90; la vista cerrada de edificios, ~320 en tres decenas de variantes de fachada.

**Chunks estáticos de 96 m (antes 32 m).** En el mismo punto: 1018 → 706 dibujos y 19,9 → 15,1 ms de CPU de render. El corte por frustum sigue por chunk y las sombras usan proxies propios, así que solo se dibujan algo más de triángulos por chunk parcialmente visible.

**Color por vértice y mallas sin UV en la fusión estática.** Los materiales lisos (sin mapas, emisión ni transparencia) que solo difieren en el tono se dibujan con un material portador por acabado y el color viaja en un atributo por vértice (`VertexColorCarriers`, adaptado de la idea de Slop New York de que el color sea dato y no programa); 22 portadores sustituyen decenas de materiales. Las mallas lisas sin UV (el tablero del puente) ahora entran en la fusión. Mismo punto: 706 → 631 dibujos, 15,1 → 14,6 ms de CPU de render. Queda la vista cerrada de edificios (~240 dibujos) y los objetos sueltos.

**Vista cerrada de edificios con materiales unificados.** `buildClosedView` creaba un material por pared y chunk; ahora usa el mismo `MaterialDeduper` y los portadores de color por vértice. Mismo punto: 631 → 554 dibujos, 14,6 → 13,4 ms de CPU de render (de 1018 y 19,9 ms al inicio de la rama).

**Fachadas de casas con un solo material procedural (`src/graphics/CityFacade.js`).** Las casas usaban una textura de lienzo (color, emisión y relieve) por combinación de ancho, pisos, estilo y variante, y cada una era un material y un dibujo por chunk. Ahora todas comparten un material TSL cuya variación (ancho, pisos, estilo ladrillo/pintada/ruina, semilla y tono) va en los atributos de vértice `facadeParams` y `facadeTone`: ventanas con marco, rejas, cortinas y tablas, persianas metálicas con grafiti en la planta baja y ventanas encendidas por la noche con `cityUniforms.lightsOn`. La fusión estática y la vista cerrada conservan esos atributos (`userData.vertexAttributes`) y el corte isométrico usa copias que comparten el grafo con `alphaHash`. Mismo punto: 554 → 407 dibujos, 13,4 → 11,6 ms de CPU de render; las texturas únicas bajan de 443 a 262. La adaptación no usa cajas unitarias instanciadas: la geometría de cada casa sigue fusionada por chunk, que cuesta los mismos dibujos.

**Qué queda por dibujar tras las fachadas (mismo punto, 417 mallas visibles).** Calzada, andén, bordillo y pasto suman unos 21 dibujos y las marcas viales unos 17: los chunks de 96 m y el color por vértice ya los dejaron en pocas mallas, así que no hay una ganancia grande pendiente en calles y andenes. Lo que domina ahora es: objetos sueltos de props (puestos, cajas, aros de recogibles, conos de luz: ~110), rótulos de locales con una textura de lienzo cada uno (~56), color por vértice de sectores y vista cerrada (~77) y vehículos agrupados (24).

**Rótulos de locales en atlas (`ShopSignAtlas`).** Cada rótulo creaba su canvas, su textura y su material. Ahora se pintan una sola vez por combinación de nombre y color en atlas de 2048 × 2048 (casillas de 512 × 128, 64 por atlas) y cada plano apunta a su casilla con UV; todos comparten el material del atlas y la vista cerrada los fusiona por chunk. Mismo punto: 407 → 365 dibujos, 11,6 → 10,5 ms de CPU de render. Las barras de las ventanas se desvanecen a distancia para evitar el moiré.

**Reparto del cuadro en tu punto (calidad baja, ciudad sola, 350 dibujos).** Con la sonda `?perf`: render de CPU 10,3 ms; ocultando la vista cerrada de edificios 9,3 ms, y además los sectores 7,1 ms (148 dibujos), de modo que **toda la ciudad cuesta ya unos 3 ms**. Con la escena vacía el render sigue costando 3,7 ms (2 ms sin el pipeline posterior ni fondo, entorno, niebla ni hook de árboles), un suelo fijo que no depende de los dibujos de la ciudad. El tiempo de GPU medido con consultas de tiempo (`__bazukoPerf.gpu()`, disponible solo con `?perf`) es de ~0,9 ms en este equipo, así que aquí el límite es CPU. Los grupos que quedan sueltos (puestos de venta, tienda, mesa de crafteo, fogatas y otros con `update`) son animados o lugares de interacción y suman unos 110 dibujos a lo lejos, no a tu punto; no los toqué.

**Suelo fijo del render: recorrido de matrices.** `scene.updateMatrixWorld()` visita los ~15 000 nodos de la escena en cada fotograma aunque nada cambie, y Three 0.186 no salta los objetos ocultos ni los congelados. Con todo activo en tu punto costaba 1,5 ms, de los que unos 0,7 ms eran los ~60 huesos de cada peatón fuera de cámara. Ahora (1) las ramas totalmente congeladas por `freezeStaticTransforms` solo se recorren si alguien las marca como modificadas, si un ancestro fuerza la actualización o si se les añade un hijo, y (2) la raíz de cada NPC (`skipWhenHidden`, `src/graphics/HiddenSubtrees.js`) no recorre sus huesos mientras está oculta y recupera todo al mostrarse. Resultado: recorrido de matrices 1,5 → 0,8 ms y render 15,4 → 14,3 ms con todos los sistemas activos (72 NPC, 51 fuera de cámara). No se aplica a los grupos del descarte por frustum (coches, perro, recogibles): calculan sus límites con las matrices de sus hijos y quedarían obsoletas. El resto del suelo fijo (~2 ms con la escena vacía) está en el pipeline posterior y el renderer de Three, no en el juego.

**Ruido en las ventanas de las casas.** La semilla de cada fachada viaja como atributo de vértice y llega al píxel interpolada con un error de ~1e-5; el seno de la función de azar la multiplica por ~4·10⁴ y el resultado cambiaba de un píxel a otro (ventanas con puntos que titilan al mover la cámara, manchas de grafiti moteadas). Ahora el shader redondea la semilla antes de usarla, así que cada celda recibe el mismo valor en todos sus píxeles.

## Sombras solares (rama cambio-de-prueba-de-ciudad)

Medido en X 209.48, Z 38.65 con la ciudad sola y calidad media. Slop New York usa también dos cascadas (`SunLight`, PCF); la diferencia está en lo que entra en ellas: sustitutos de sombra de 500 m, instancias troceadas por celdas y casi nada suelto. Aquí cada cascada dibujaba cosas enteras:

| Cascadas del sol | Antes | Ahora |
| --- | --- | --- |
| Dibujos (cascada cercana + lejana) | 74 + 223 | 27 + 56 |
| Triángulos | 567 mil + 668 mil | 135 mil + 262 mil |

Lo que lo causaba y lo que se hizo:
- **Recogibles (bolsas y contenedores):** sus modelos tienen 8 mil y 18 mil triángulos y el lote los repetía todos (415 mil) en cada cascada. Más allá de 48 m de la cámara se dibujan en un lote aparte que no proyecta sombra (`InstanceBatches`, `SHADOW_RANGE`).
- **Semáforos:** un único lote con todos los de la ciudad (71 mil triángulos) se dibujaba en cada vista y cascada. Ahora hay un lote por celda de 64 m y el descarte por frustum los separa.
- **Sustitutos de sombra:** celdas de 160 m (antes 64 m), menos dibujos por cascada. Los lotes instanciados mantienen su celda de 64 m (`INSTANCE_CELL`).
- **Lotes vacíos:** los lotes de vehículos y recogibles sin instancias se dibujaban en la vista y en cada cascada. Tras el calentamiento se ocultan (`scene.userData.skipEmptyBatches`); durante él se dibujan para que sus pipelines queden preparados.
- **Objetos pequeños lejanos:** los lugares de interacción (tienda, punto de venta, mesa de crafteo, traficante, contenedores) y los objetos animados registrados en el descarte dejan de proyectar sombra a más de 60 m (`FrustumCulling`, opción `shadowRange`) y entran en el descarte por frustum.

En esa medición, el tiempo de CPU del render con sombras seguía siendo ~5,5 ms mayor que sin ellas. Lo dominaba el trabajo por objeto de Three en cada cascada (recorrido del grafo, enlaces y uniformes). Posteriormente se probó alternar la cascada lejana entre cuadros y se descartó por defectos de sombras en movimiento.

La [auditoría del 26 de octubre](auditoria-carga-sombras.md) documenta las correcciones posteriores de preparación duplicada, matrices por cuadro, buffers de instancias y tirones al cambiar el detalle de los árboles, junto con su protocolo de producción y resultados.
## Optimización para el presupuesto de 60 FPS

La referencia de esta comparación es `28811e9`. Un cuadro a 60 FPS dispone de 16,67 ms. Las mejoras aplicadas son:

- El concreto del viaducto tiene UV y entra en la agrupación por sector: el puente agrupado pasa de 341 a 38 mallas, con los mismos 19.902 triángulos.
- Las consultas de altura del viaducto reutilizan un índice de triángulos por franjas de ocho metros. Conservan el orden, la tolerancia y los triángulos de la consulta anterior. Las pruebas comparan rampas y ambos bordes de las curvas contra la consulta exhaustiva.
- Árboles, bancas y otros objetos estáticos pueden compartir lotes cuando sus materiales son iguales. Las partes animadas y las paredes que se atenúan mantienen sus materiales independientes. Se liberan los materiales sustituidos que ya no usa la escena.
- El vaivén del follaje se calcula en el shader. Cada árbol guarda su fase y frecuencia en las UV de la copa y todos leen el tiempo compartido `foliageWind`, que el distrito avanza una vez por fotograma; la sombra usa el mismo desplazamiento. Así los árboles se agrupan como geometría estática. No volver a animarlos con `userData.update`: eso los saca de los lotes.
- Las lámparas GLB se instancian por sector después de precargarlas. Las luces originales conservan su posición, intensidad y registro; los lotes comparten geometría y materiales del modelo.
- Los semáforos se dividen en lotes por sector. Antes, su única malla obligaba a dibujar todos los postes de la ciudad en cualquier vista. Cada lote conserva las fases de sus lentes y comparte los buffers de vértices; el descarte también funciona en las pasadas de sombra.
- El render actualiza las raíces dinámicas de la escena y, dentro de la ciudad congelada, los buses y objetos animados registrados. Omite el recorrido recursivo de matrices de los inmuebles; las animaciones, esqueletos y sombras siguen recibiendo sus transformaciones actuales. En una comparación consecutiva en la misma partida, el p95 de CPU de render pasó de 11,7 a 9,5 ms al activar esta actualización selectiva.
- Las barras del HUD solo cambian su ancho cuando varía una décima de porcentaje, evitando invalidar los estilos por cambios imperceptibles cada cuadro.
- La resolución adaptable responde a caídas sostenidas por debajo de 58 FPS. Requiere cuadros lentos en al menos el 20 % de la ventana para ignorar un tirón aislado. Solo recupera calidad o resolución tras cuatro ventanas por encima de 59 FPS con menos de 12 ms medios de CPU hasta el render. Esta señal de CPU no sustituye una medición de GPU.
- Los menús y el sueño dibujan el fondo como máximo a 15 Hz; una pestaña oculta no envía cuadros a la GPU. Se conserva la suspensión de simulación y se excluyen esos intervalos de las estadísticas activas. En calidad baja tampoco se consulta la obstrucción de una silueta desactivada.

### Comparación medida

Chromium con WebGL acelerado por Radeon 680M, viewport 1280 × 800, DPR 1, tercera persona y lluvia nocturna. Cada muestra dura ocho segundos después de 2,5 segundos de estabilización. Se desactivó la adaptación de resolución para comparar el mismo perfil, sin obtener mejoras reduciendo píxeles. El tráfico y los NPC continúan activos: sus trayectorias y la geometría visible pueden variar entre ejecuciones. Son muestras locales de esas vistas, no una garantía para cualquier equipo o recorrido.

| Vista | Calidad | p95 antes → después (ms) | p99 después (ms) | 1 % bajo antes → después (FPS) |
| --- | --- | --- | --- | --- |
| Inicio | Baja | 16,6 → 13,8 | 15,2 | 39,4 → 62,8 |
| Colpatria | Baja | 20,2 → 12,7 | 13,3 | 33,5 → 65,4 |
| Lago | Baja | 19,2 → 11,9 | 13,2 | 39,0 → 71,8 |
| Terminal | Baja | 15,6 → 10,2 | 10,8 | 42,7 → 87,8 |
| Inicio | Alta | 25,3 → 16,2 | 17,5 | 30,4 → 43,8 |

Las cuatro muestras en calidad baja quedan por debajo del presupuesto hasta p99. La muestra en alta todavía contiene cuadros por encima de 16,67 ms. No se limitaron ni alteraron los FPS mostrados. En el terminal las llamadas de dibujo aumentan de 431 a 444 al dividir los semáforos, pero los triángulos enviados bajan de 499.652 a 356.084 y el tiempo de cuadro mejora.

Una verificación independiente de 15 segundos por vista dio entre 79,2 y 105,9 FPS medios en baja, con p99 entre 11,3 y 14,2 ms y 1 % bajo entre 62,9 y 83,6 FPS. En alta dio 63,5 FPS medios, pero p95 de 17,2 ms: el promedio no implica 60 constantes. Otra repetición posterior coincidió con actividad elevada de otro navegador y registró entre 52,5 y 80,2 FPS medios en baja, con p99 de hasta 37,8 ms; en alta registró 47,2 FPS medios. El perfil de CPU mejoró con la actualización selectiva de matrices, pero no se aisló la contribución de GPU, compositor y carga concurrente. Se conservan ambas repeticiones; no se declara alcanzado un mínimo universal de 60 FPS.

En una comparación aislada de 100.000 consultas de altura, tras la primera pasada, la consulta anterior tomó entre 317 y 346 ms y la indexada entre 65 y 77 ms. Este recuento de CPU no representa por sí solo una ganancia equivalente de FPS.

### Reproducir las mediciones

Requiere Chromium de Playwright (`npx playwright install chromium`) y el servidor de desarrollo o de producción activo. Ejecutar una sola medición gráfica a la vez:

```sh
npm run dev -- --host 127.0.0.1
# En otra terminal:
npm run benchmark:performance
# Con preview o muestras más largas:
npm run benchmark:performance -- --url http://127.0.0.1:4173/ --seconds 30
```

El comando abre un navegador aislado, crea un personaje, recorre cinco vistas y guarda `report.json` y capturas reales en `work/performance/`. Por defecto mide 15 segundos por vista después de cinco segundos de estabilización. El JSON incluye el renderer WebGL, FPS medios, percentiles recientes, 1 % bajo, fases de CPU, resolución, llamadas de dibujo y triángulos. Los percentiles siguen usando los últimos 600 cuadros y el perfilador hasta 1.800. La semilla inicial es fija; no elimina la variabilidad temporal de NPC y tráfico. El comando identifica renderizadores por software y los señala en el informe. `--headless` permite ejecutarlo sin ventana, aunque hay que comprobar el renderer antes de interpretar FPS. Las partidas del navegador habitual no se modifican.

Para evaluar estabilidad durante una partida real, complementar las vistas fijas con caminata, giros de cámara, cambios de calidad y ambas cámaras durante varios minutos. Registrar resolución y calidad efectiva junto con p95/p99; un promedio superior a 60 no demuestra que todos los cuadros cumplan el presupuesto.

### Validación de esta optimización

`npm test` aprueba las 256 pruebas y `npm run build` completa la compilación. Las pruebas de lógica comprueban conservación de geometría, agrupación por materiales, transformaciones y luces de las instancias, descarte de semáforos, equivalencia de alturas, actualización de raíces dinámicas sin recorrer inmuebles y adaptación ante 55 FPS sostenidos. La suite E2E en Chromium acelerado completa ayuda, inventario y pausa; el escenario de edición falla al esperar que P abra el creador. En `28811e9`, P abre la personalización de la mascota, un conflicto previo a esta optimización. No se considera una suite E2E completamente aprobada.

Una comprobación adicional con giros continuos de cámara durante 15 segundos por modo registró 89,1 FPS medios en tercera persona y 109,4 en isométrica, a calidad baja. Durante 1,5 segundos de inventario abierto, el reloj y las muestras activas permanecieron constantes y hubo 21 renders de fondo. Al simular `document.hidden = true`, el reloj y el contador de renders no avanzaron durante 1,5 segundos; ambos se reanudaron al restaurar la visibilidad. La prueba de visibilidad ejercita la rama del juego y no certifica el comportamiento del compositor del sistema operativo.
