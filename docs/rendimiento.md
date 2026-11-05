# Rendimiento y medición

Las optimizaciones reducen trabajo de renderizado y consultas de simulación conservando el mapa, las partidas guardadas, los cruces y las colisiones por altura. La referencia de la primera entrega es el commit `3abc15a8fae36ba3f479296ff101128c2fcd7429`.

## Cambios

- Las casas que reutilizan una variante de fachada comparten el material base. Las paredes que se atenúan conservan materiales independientes; los lotes cerrados usan sus propios materiales compartidos, para que una pared transparente no afecte a otras casas. Las luces nocturnas actualizan ambos conjuntos.
- Cámara y movimiento consultan una cuadrícula espacial de 16 metros. Las cajas extensas se registran en todas las celdas que ocupan, se deduplican y conservan el orden de resolución anterior. Permanecen las pruebas precisas AABB/OBB, el barrido y los colliders `layered`.
- El tráfico indexa personas y vehículos una vez por subpaso y separa vehículos por ruta. Las consultas cubren la distancia de frenado y el tamaño del otro vehículo; no se suspende tráfico por estar fuera de cámara.
- Los peatones a más de 40 metros dejan de actualizar su pose, aunque sigan caminando. Los cercanos y medios tienen una frecuencia visual según el perfil gráfico. En calidad baja, además, dejan de dibujarse cuando la niebla ya casi los tapa (ver «Costo en calidad baja»). Navegación, reacciones y movimiento continúan.
- Las acciones de animación con un peso residual inferior a 0,001 se desactivan. Cambiar apariencia o retirar un NPC libera materiales, esqueletos y geometrías propios, también si una carga asíncrona llega después de retirar al personaje. Los recursos del banco siguen compartidos. La geometría de cuerpo que se recorta bajo ropa tiene buffers propios para poder liberarlos sin dañar otra instancia.
- Las luces se descubren al registrar una rama, sin recorrer toda la ciudad cada segundo. Sus posiciones estáticas se fijan después de cargar modelos; intensidad y visibilidad siguen actualizándose. El fogón ya está registrado antes de construirlo y se activa mediante visibilidad. Se mantienen dos proxies de luz y los halos instanciados.
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

## Optimización para el presupuesto de 60 FPS

La referencia de esta comparación es `28811e9`. Un cuadro a 60 FPS dispone de 16,67 ms. Las mejoras aplicadas son:

- El concreto del viaducto tiene UV y entra en la agrupación por sector: el puente agrupado pasa de 341 a 38 mallas, con los mismos 19.902 triángulos.
- Las consultas de altura del viaducto reutilizan un índice de triángulos por franjas de ocho metros. Conservan el orden, la tolerancia y los triángulos de la consulta anterior. Las pruebas comparan rampas y ambos bordes de las curvas contra la consulta exhaustiva.
- Árboles, bancas y otros objetos estáticos pueden compartir lotes cuando sus materiales son iguales. Las partes animadas y las paredes que se atenúan mantienen sus materiales independientes. Se liberan los materiales sustituidos que ya no usa la escena.
- El vaivén del follaje se calcula en el shader. Cada árbol guarda su fase y frecuencia en las UV de la copa y todos leen el tiempo compartido `foliageWind`, que el distrito avanza una vez por fotograma; la sombra usa el mismo desplazamiento. Así los árboles se agrupan como geometría estática. No volver a animarlos con `userData.update`: eso los saca de los lotes.
- Los postes de alumbrado, hechos por código en `StreetLampModel.js`, se instancian por sector. Las luces originales conservan su posición, intensidad y registro; los lotes comparten geometría y materiales del modelo.
- Los semáforos se dividen en lotes por sector, de 64 metros: más o menos un cruce. Antes, su única malla obligaba a dibujar todos los postes de la ciudad en cualquier vista. Cada lote conserva las fases de sus lentes y comparte los buffers de vértices; el descarte también funciona en las pasadas de sombra.
- El render actualiza las raíces dinámicas de la escena y, dentro de la ciudad congelada, los buses y objetos animados registrados. Omite el recorrido recursivo de matrices de los inmuebles; las animaciones, esqueletos y sombras siguen recibiendo sus transformaciones actuales. En una comparación consecutiva en la misma partida, el p95 de CPU de render pasó de 11,7 a 9,5 ms al activar esta actualización selectiva.
- Las barras del HUD solo cambian su ancho cuando varía una décima de porcentaje, evitando invalidar los estilos por cambios imperceptibles cada cuadro.
- La resolución adaptable responde a caídas sostenidas por debajo de 58 FPS. Requiere cuadros lentos en al menos el 20 % de la ventana para ignorar un tirón aislado. Solo recupera calidad o resolución tras cuatro ventanas por encima de 59 FPS con menos de 12 ms medios de CPU hasta el render. Esta señal de CPU no sustituye una medición de GPU. El cambio de resolución se aplica justo antes de dibujar el cuadro siguiente; ver «Cambios de calidad y resolución».
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

## La calle y la luz

Calidad baja, mismos encuadres antes y después, con el tráfico congelado. Los peatones siguen moviéndose, así que cada cifra tiene unas decenas de llamadas de ruido.

| Encuadre | Llamadas antes | Llamadas después | Triángulos antes | Triángulos después |
| --- | ---: | ---: | ---: | ---: |
| Semáforo, día | 970 | 1012 (+4 %) | 459 mil | 498 mil |
| Semáforo, noche | 974 | 1031 (+6 %) | 459 mil | 500 mil |
| Calle de inicio, día | 930 | 943 (+1 %) | 430 mil | 450 mil |
| Calle de inicio, noche con lluvia | 959 | 985 (+3 %) | 431 mil | 453 mil |
| Avenida, día | 1951 | 1979 (+1 %) | 863 mil | 919 mil |
| Avenida, aguacero | 2004 | 2032 (+1 %) | 866 mil | 922 mil |
| Cruce, día | 552 | 608 (+10 %) | 291 mil | 320 mil |
| Cruce, noche | 553 | 622 (+13 %) | 291 mil | 321 mil |
| Isométrica, inicio | 779 | 816 (+5 %) | 288 mil | 274 mil |
| Isométrica, avenida | 975 | 982 (+1 %) | 295 mil | 340 mil |

En calidad media los mismos encuadres suben entre 2 % y 7 % en llamadas, y hasta 16 % en triángulos en la vista isométrica de la avenida. El número de texturas queda igual, con diferencias de unas pocas: se agregan dos atlas, la forma de los charcos y la luz de los faroles, y desaparecen las que usaba la pintura anterior.

Con toda la mejora y las correcciones unidas, una medición puntual en calidad media da estas llamadas y triángulos:

- Vista de inicio: 1.382 y 809 mil de día; 1.557 y 867 mil de noche con lluvia.
- Semáforo: 1.693 y 942 mil de día; 1.847 y 993 mil de noche.
- Avenida de día: 2.692 y 1,56 millones. Isométrica de día: 2.286 y 745 mil.
- Estación: 262 y 269 mil de día; 345 y 316 mil de noche.
- Carga de unos 5 segundos. Al entrar hay unas 1.350 geometrías y 870 texturas en memoria; tras tres minutos de recorrido, unas 2.110 y 1.280.

En las paradas con pocos objetos a la vista una persona completa pesa más en porcentaje: la banca de oriente en baja pasa de 172 a 195 llamadas y de 188 mil a 241 mil triángulos, 13 % y 28 %, con una o dos personas completas más en pantalla.

Cómo se contiene el costo:

- La pintura, los sardineles, el mobiliario, los cables, la luz de los faroles y los charcos son una malla por material y por sector de 64 metros. Ninguno agrega un objeto por tapa o por caneca, ni luces ni colisiones.
- La luz de los faroles y los charcos no dibujan cuando no hacen falta: de día y con el suelo seco, sus materiales están apagados y no gastan llamadas.
- La sombra sobre la calle no usa mapas de sombra. Sale de un mapa de alturas de la ciudad, de un texel por metro, que solo se recalcula cuando el sol se ha movido lo suficiente, y se consulta una vez por píxel en los materiales iluminados: calles, fachadas, carros, buses, motos, postes, semáforos, copas y torres. Solo el agua del lago queda fuera. Las copas consultan el mapa unos metros hacia el sol, más allá de sus propias hojas, con un programa propio. Un material con shader propio debe encadenar esta consulta con `chainSunField`, o con `patchSunFieldShader` si es una clase: si no, queda a pleno sol dentro de la sombra.
- El paso del mapa de entorno de día al de noche es un fundido de `EnvironmentMix` sobre una sola textura de 384×512 (1,5 MB), para que el piso no salte de brillo. Cuesta una pasada de esa textura cada vez que el cambio ya se notaría, unas pocas por segundo, solo durante el minuto real que dura el amanecer o el atardecer; el resto del día no dibuja nada. Como la textura es siempre la misma, ningún material busca programa en ese momento. Suma un programa, que se compila al cargar.
- La sombra de las nubes se calcula por vértice.
- La niebla por elevación solo hace su cuenta en los píxeles que de verdad llevan niebla; el resto no la paga. No agrega texturas ni llamadas.
- El prado suma una textura de un canal, de un texel por metro, y cuatro lecturas por píxel del ruido de la cúpula, solo en el pasto. Todos los acabados de andén comparten un programa con dos lecturas más. Las matas del borde y los charcos de los faroles de hierro van en los lotes de calle que ya existían, sin llamadas por objeto.
- Los materiales de los personajes comparten sus programas entre personas: son 13 variantes para piel, tela, zapatos, pelo y barba, y aparecen desde la entrada. Lo propio de cada persona va en uniformes y la lluvia es un solo valor compartido, así que vestir o mojar a alguien no cuesta llamadas ni programas. Frente a los materiales anteriores suman 6 programas netos; llamadas y triángulos quedan casi iguales. Detalle en [MATERIALES_CALLE.md](../tools/personaje/MATERIALES_CALLE.md).
- Cada imagen de personaje se descarga, se decodifica y se sube a la GPU una sola vez, aunque la usen muchos archivos de cuerpos y prendas. Cada glTF sigue recibiendo su propia textura, con sus ajustes, y lo único que comparten es la imagen. Hasta entrar, en calidad baja, son 49 descargas de imagen en vez de 328 y 58 decodificadas en vez de 337. Tras tres minutos de recorrido las texturas reservan en la GPU de 855 a 876 MB en baja y 873 MB en media; cuando cada archivo traía su copia eran de 2,2 a 2,45 GB. La carga en frío queda en unos 5 segundos, contra unos 8. Llamadas, triángulos y programas no cambian. Desechar a alguien no libera ninguna imagen: las usa cualquiera que lleve esa ropa, y se quedan para el siguiente.
- Los opacos siguen en el orden de siempre, por material. Ordenarlos por programa baja a menos de la mitad los cambios de programa, de 470 a 136 en la parada más cara, pero el tiempo de cuadro casi no cambia, y donde dos superficies quedan a la misma profundidad gana otra: en una de doce paradas cambian 636 pixeles del piso, 56 de ellos en 8 niveles o más. Por eso no se hace.

Costo de construcción de cada sistema, medido rehaciéndolo con la partida cargada: campo de sol, 4 ms; pintura, 9 ms; toda la calle, con cables, mobiliario, faroles y charcos, 21 ms; atlas de pintura, 4 ms; atlas de mobiliario, 1 ms más la subida a la GPU al primer uso. La carga completa no cambia de forma medible: alrededor de seis segundos antes y después, con cinco o seis programas de shader más.

La calidad automática observa cuadros de hasta 18 ms con un trabajo de hasta 12 ms durante 20 segundos antes de subir, y compila las sombras antes de encenderlas. El tope de trabajo es el que aún cabe en 60 FPS después de subir: en la medición, prender las sombras multiplicó por 1,4 el trabajo de un cuadro. En dos corridas con la máquina ocupada, un equipo con 8,4 a 9,7 ms de trabajo típico tardó 115 segundos en subir con un tope de 9 ms y 20,7 segundos con el de 12 ms. El intervalo se mide con el sello de `requestAnimationFrame`: el reloj al entrar al cuadro oscila y, a 60 FPS, una de cada cuatro muestras parecía lenta sin serlo. Vuelve a baja si en una ventana de 3 segundos al menos el 20 % de los cuadros son lentos y la ventana no llega a 58 FPS, o si hay presión; no insiste en esa sesión. En Ajustes se avisa cuando el juego corre en otra calidad que la elegida. Un intervalo de más de 250 ms, como el que deja volver de otra pestaña, no cuenta como holgura ni como tirón: en baja la cuenta vuelve a empezar. Con sombras, uno suelto se ignora, pero tres en una misma ventana de 3 segundos la devuelven a baja. Esos intervalos no reinician la ventana: si lo hicieran, un equipo con intervalos que rozan ese valor nunca bajaría. No aplica a quien ya tiene una calidad guardada, y no escribe la preferencia.

## Cambios de calidad y resolución

- **La resolución se aplica solo al inicio de `Renderer.render()`.** `setPixelRatio` borra el lienzo aunque el valor no cambie; llamado después de dibujar, el navegador muestra ese lienzo vacío, un cuadro negro en cada cambio. `setQuality`, `adaptResolution` y la bajada automática solo cambian `resolution.ratio`. No llamar a `setPixelRatio` en otro sitio. En una grabación de 426 cuadros con diez cambios forzados no quedó ningún cuadro negro.
- **Elegir una calidad que prende o apaga las sombras compila antes de aplicarla.** La clave del programa de cada material depende de las sombras: sin preparar, el primer cuadro los compila todos de golpe. `Game.setGraphicsQuality` guarda lo elegido y lo muestra en Ajustes desde el clic, compila con `prepareVariant` (`compileAsync`, que en frío aún bloquea cerca de un segundo entre el clic y el primer cuadro) y aplica el cambio al terminar. Si mientras tanto se elige otra cosa, queda lo último. Si la compilación falla o pasa de 15 segundos, el cambio se aplica igual. Sin cambio de sombras, como de media a alta, o antes del primer cuadro, se aplica en el acto. Por eso lo elegido se lee en `game.chosenQuality`; `renderer.quality` es lo aplicado. `renderer.setQuality` llamado directo no compila antes.
- **La subida automática** ya compilaba antes de prender las sombras, en `_raiseAutoQuality`.
- **Apagar las sombras por presión** también queda compilado de antemano. Al tocar el mínimo de resolución, lo siguiente es apagarlas: quien no partió de baja compila en ese momento la variante sin sombras. En calidad media son unos 100 programas más (230 frente a 122 tras un recorrido de tres minutos), solo en los equipos que llegan a ese punto.
- **Los 20 cuadros siguientes a un cambio de sombras no cuentan** para la resolución ni para la calidad automática: pagan el cambio y no dicen nada del equipo. Sin esto, los tirones de la subida en frío bajaban la resolución y se acercaban a los tres intervalos largos que devuelven a baja. Tampoco cuentan los de la espera mientras compila la subida ni los que siguen a recuperar un contexto perdido.
- **Recuperar un contexto WebGL perdido** vuelve a hornear los mapas de entorno en el primer cuadro: Three sube de nuevo lo que tiene en memoria, pero estos mapas son dibujos y quedarían vacíos, con el piso oscuro. Los programas se compilan otra vez, con el tirón que eso trae.

Compilar antes acorta la congelación, no la quita. Sin programas en caché, pasar de baja a alta la primera vez aún congela de 3 a 4 segundos: el primer cuadro con sombras es el que enlaza los programas de profundidad, que no entran en la compilación previa (medido: los enlaces pasan de 96 a 110 en ese cuadro), y el jugador apenas avanza durante la espera. Con caché casi no se nota. Peor cuadro de cada cambio, medido en un solo equipo con la máquina ocupada, comparable solo entre sí:

| Cambio | Sin programas en caché, antes | Sin programas en caché, ahora | Con programas en caché, ahora |
| --- | --- | --- | --- |
| Elegir media en Ajustes | 8,8–10 s | 2,5–2,9 s, con 4,3–4,9 s entre el clic y el cambio | 317 ms |
| Apagar las sombras por presión | 6,5 s | 2,4 s | 300 ms al compilar, 17 ms al apagarlas |
| Subida automática | sin medir | 2,35 s | unos 270 ms |

## Costo en calidad baja

Las primeras partidas van en baja y un equipo lento se queda ahí. Un cuadro de esa calidad gasta menos sin cambiar lo que se ve a distancia de juego. Llamadas y triángulos de un cuadro al mediodía despejado, a 1280 × 720, contados en el renderer:

| Vista | Llamadas, antes | Llamadas, ahora | Triángulos, antes | Triángulos, ahora |
| --- | --- | --- | --- | --- |
| Cambuche | 1.643 | 1.012 (−38 %) | 863.000 | 761.000 (−12 %) |
| Centro | 1.420 | 870 (−39 %) | 799.000 | 743.000 (−7 %) |
| Avenida | 1.623 | 1.085 (−33 %) | 822.000 | 738.000 (−10 %) |

Los peatones caminan, así que su parte varía algo entre una medición y otra. Los cuadros por segundo no están en esta tabla.

- **Transparentes de dos caras en una sola pasada.** Three dibuja dos veces un material transparente `DoubleSide` y le pide programa en cada dibujo. Con `forceSinglePass` esa llamada y ese trabajo desaparecen. Lo usan el aro y el aura de las bolsas, la humedad de las fachadas, la luz de los faroles y, solo en el modelo lejano de los peatones, barbas, cejas y pestañas; el modelo completo conserva las dos pasadas.
- **El aura apagada no se dibuja.** Casi siempre tiene opacidad cero. `material.visible` la apaga y la devuelve con el boost; los flags `.visible` siguen siendo de la cosecha y la reaparición.
- **Semáforos.** El poste completo bajó de 2.443 a 1.948 triángulos: caras que nunca se ven y segmentos que no se distinguen a tres metros. En baja, los lotes a más de 50 metros de la cámara usan un poste liviano de 336 triángulos, `createFarSignalGeometry`, con la misma silueta, las mismas lentes en el mismo sitio y la misma fase por instancia; suelta pernos, abrazaderas, botones, cable y calcomanías. Comparte los límites del completo, así que el descarte no cambia, y 4 metros de margen evitan que un lote cambie de modelo con cada paso. Media, alta y el modo foto usan siempre el completo. Desde el cambuche pasan de 48 llamadas y 118.000 triángulos a 25 y 51.000.
- **Peatones y bolsas lejanos.** Un peatón baja de detalle a los 10 metros, en baja anima cada 0,3 segundos pasados los 20 y congela la pose pasados los 40. Hasta ahora solo dejaba de dibujarse fuera de la cámara o más allá de su plano lejano, a 180 metros. En baja, peatones y bolsas dejan de dibujarse al 70 % de la niebla (`farDetailFog`): 145 metros al mediodía despejado y 103 de noche, con 4 metros de margen para que no parpadeen en el borde. El límite sigue a la niebla, así que se acerca con la lluvia. Solo se apaga el dibujo: ruta, reservas, tráfico y cosecha no se enteran. Un peatón oculto tampoco le cuesta al render el recorrido de sus matrices. En capturas de día del mismo cuadro, con y sin un peatón justo en el límite, cambian hasta 117 píxeles al centro de la pantalla y hasta 225 al borde: el límite se mide desde el jugador y la niebla por profundidad de cámara, así que al borde lo cubre menos. Aumentadas tres veces no se distinguen.
- **Sectores de edificios.** Las zonas nuevas del este no gastan más que las viejas: 4,3 mallas y unos 1.600 triángulos por sector, frente a 10,7 mallas y unos 2.700 en la ciudad vieja, y sin mezcla que impida agruparlas. El gasto estaba en la ciudad vieja: 309 materiales de lotes cerrados, repartidos en trozos de 32 metros, daban muchas llamadas de pocos triángulos. Los lotes cerrados, la fusión estática y los sectores que los agrupan pasaron a 64 metros. Nada cambia de sitio. Los trozos más anchos meten más triángulos en la cámara, por eso los triángulos bajan mucho menos que las llamadas.

Este último cambio también alcanza a media, porque los lotes se arman una sola vez y la calidad puede cambiar en plena partida. Allí no se quita nada de lo que se ve, pero el trato es otro: menos llamadas y algunos triángulos más, sombras incluidas.

| Vista, en media | Llamadas, antes | Llamadas, ahora | Triángulos, antes | Triángulos, ahora |
| --- | --- | --- | --- | --- |
| Cambuche | 2.402 | 1.610 (−33 %) | 1.374.000 | 1.511.000 (+10 %) |
| Centro | 2.195 | 1.471 (−33 %) | 1.270.000 | 1.367.000 (+8 %) |
| Avenida | 2.404 | 1.668 (−31 %) | 1.339.000 | 1.378.000 (+3 %) |
