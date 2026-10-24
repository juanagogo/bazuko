# Vagabundo

Juego de supervivencia urbana en 3D para el navegador, ambientado en un barrio inspirado en el centro de Bogotá, Santa Inés y El Cartucho. Explora las calles, recoge y vende materiales, consigue comida y agua y mejora tu cambuche.

Este proyecto es un fork de [juanagogo/bazuko](https://github.com/juanagogo/bazuko), con mejoras de cámara, visibilidad, circulación y equilibrio de supervivencia.

![Cruce nocturno en tercera persona con gasolinera, edificios altos, carros y viaducto](docs/images/ciudad-nocturna-tercera-persona.webp)

## Características

- Integración experimental en `pruebas-integracion`: carriles rojos con SOLO BUS, estación, semáforos que regulan el tráfico, inventario por casillas y modelos de bolsas, canecas, lámparas, carros, taxi, TransMilenio y cambuche del fork de [mreyeswilson](https://github.com/mreyeswilson/bazuko). [Detalles de integración y procedencia](docs/modelos-importados.md).
- Radar relativo a la cámara, pausa con volumen y calidad gráfica, llovizna y compañero canino El Chato, adaptados de [Cristianlv11/bazuko](https://github.com/Cristianlv11/bazuko/tree/feature/mejoras-navegacion-audio-pausa-clima). [Detalles de compatibilidad](docs/integracion-cristian.md).
- Cámaras en tercera persona e isométrica, intercambiables durante la partida.
- Techos y paredes que se ocultan cuando tapan al personaje en vista isométrica, con muros bajos y silueta del jugador.
- Peatones que caminan por los andenes y cruzan las calles.
- Diez palomas en cada uno de los tres parques: caminan, levantan vuelo cuando el jugador o un NPC se acerca a menos de 3,5 metros y aterrizan en otro lugar. Cada bandada usa cinco lotes de geometría instanciada, sin luces ni física; se suspende a más de 90 metros del jugador.
- Carros y taxis con recorridos aleatorios entre 90 alternativas transitables y un bus articulado que circula por la troncal y para en la estación.
- Calzadas de 12 metros y andenes de 4 metros.
- Ciudad de 240 × 322 metros: conserva la ampliación urbana y añade un gran parque al sur, con barrios nuevos al oriente y al sur, dos calles y dos carreras adicionales y dos parques nuevos.
- Creación de personaje, inventario, reciclaje, comercio, talentos y construcción del cambuche.
- Ciclo de día y noche y necesidades de supervivencia con un ritmo relajado. Un día del juego dura una hora real.
- Panel de FPS actuales, mínimos, máximos, promedio, percentiles recientes, 1 % de FPS bajos y coordenadas X, Y, Z.
- Pantalla de carga con precarga de personajes, texturas y shaders antes de iniciar la partida y la medición de FPS.
- Descarte de sectores fuera de cámara, geometría agrupada, iluminación limitada y resolución adaptable para reducir el trabajo de renderizado.

## Capturas

Las capturas actuales muestran la ciudad de noche en tercera persona, con edificios de distintas alturas, tráfico y los nuevos espacios urbanos. Son imágenes reales del juego compartidas durante el desarrollo.

### Parque, palomas y El Chato

![Parque de noche con palomas, El Chato, vendedor ambulante y bus sobre el viaducto](docs/images/parque-palomas-y-chato.webp)

### Estación Portal del Centro

![Bus articulado junto a la estación Portal del Centro, con la pasarela y el viaducto al fondo](docs/images/estacion-portal-del-centro.webp)

### Calles y comercio bajo el viaducto

![Cruce bajo el viaducto con semáforos, peatones, vendedor de frutas y fachadas de ladrillo](docs/images/acceso-al-viaducto.webp)

### Recorrido elevado junto a Colpatria

![Buses articulados sobre el viaducto, junto a la Torre Colpatria y los edificios del barrio](docs/images/viaducto-y-colpatria.webp)

Las cinco capturas están en [docs/images](docs/images), en formato WebP optimizado y con su resolución original.

## Ejecutar en el navegador

Necesitas Node.js 22.12 o posterior, npm, Git y Git LFS. Los motores, claxones, pasos y ambiente usan Opus; los cinco efectos WAV pequeños se distribuyen con Git LFS.

```sh
git lfs install
git clone https://github.com/GrandaCoder/Vagabundo.git
cd Vagabundo
git lfs pull
npm ci
npm run dev
```

Abre la dirección que indique Vite en la terminal, normalmente **http://localhost:5173**. Si ese puerto está ocupado, Vite elegirá otro.

En la primera partida se abre el creador de personaje. El juego se sirve con Vite; para ejecutarlo utiliza el servidor de desarrollo en lugar de abrir `index.html` directamente.

En PowerShell, si una política de ejecución impide usar `npm`, ejecuta los mismos comandos con `npm.cmd`.

## Controles

| Tecla o acción | Función |
| --- | --- |
| `W`, `A`, `S`, `D` | Moverse. En tercera persona, el movimiento sigue el rumbo de la cámara. |
| `Shift` | Correr. |
| `V` o botón de cámara | Alternar entre tercera persona e isométrica. |
| Clic izquierdo en la calle | Fijar el ratón para girar la cámara en tercera persona. |
| Arrastrar con botón izquierdo/derecho o flechas | Girar la cámara sin fijar el ratón. |
| Rueda del ratón | Ajustar la distancia de la cámara en tercera persona. |
| `I` / `Tab` o botón Inventario | Abrir el inventario por casillas; el mundo queda en pausa. |
| `1`–`5` | Asignar el objeto seleccionado a acceso rápido mientras el inventario está abierto; usarlo cuando está cerrado. |
| `Enter`, `X`, `R` en el inventario | Usar, tirar una unidad (Mayús: todo), ordenar. |
| `E` | Interactuar con el objetivo cercano. |
| Mantener y soltar `Q` junto a basura | Seleccionar materiales y recogerlos al soltar. |
| `Q` junto al dealer | Abrir su tienda. |
| `B` o `L` | Pedir limosna. |
| `F` | Activar o desactivar el boost, que consume energía y salud. |
| `T` | Abrir talentos. |
| `C` | Abrir fabricación. |
| `P` | Editar el personaje. |
| `M` | Alternar entre el personaje realista y el modelo liviano. |
| `Esc` o botón Pausa | Abrir ajustes de pausa; cerrar primero el panel activo y liberar el cursor. |
| `N` | Mostrar u ocultar el radar. |
| `R` en la calle | Abrir o cerrar la radio AM/FM; permite sintonizar emisoras y cambiar pilas. |
| `X` en la calle | Lanzar si llevas munición; de lo contrario, hacer popó. |
| `Z` en la calle | Hacer popó. |
| `K` | Abrir el mapa y marcar un destino con ruta. |
| Clic en comida o bebida del inventario | Consumir el objeto. |

## Cómo empezar

Los materiales del cambuche aparecen en bolsas de basura repartidas por nueve zonas de la ciudad. Cada conjunto de bolsas reserva al menos **8 cartones, 8 tablas, 6 latas, 1 lona, 1 colchón y 1 vela**, además del botín aleatorio. Los cartones y las latas son comunes, las tablas poco comunes, la lona y la vela raras, y el colchón muy raro. Las bolsas vaciadas se reponen tras 20 segundos y conservan su reserva de materiales para que venderlos, perderlos o usarlos no bloquee la construcción. Si el costal está lleno, lo que no cabe permanece en esa bolsa; recogerlo de nuevo no vuelve a sortear su contenido. Las rarezas aparecen al recoger materiales y al pasar el cursor sobre el inventario o los requisitos de construcción.

1. Recorre los andenes y acércate a los objetos para ver las acciones disponibles.
2. Recoge materiales y véndelos en la recicladora para conseguir dinero.
3. Compra comida y agua y consúmelas desde el inventario.
4. Construye y mejora el cambuche para poder descansar. Su menú muestra una vista previa del modelo terminado, incluso antes de reunir los materiales.

La partida guarda datos localmente en el navegador al crear o editar el personaje, al dormir y con **Guardar partida ahora** en el menú de pausa. También conserva la amistad de El Chato, las preferencias de cámara, radar, calidad y volumen. Los datos dependen del navegador y de la dirección desde la que juegas; no hay sincronización entre dispositivos.

Al cruzar delante de un carro, este intenta frenar progresivamente. Si te atraviesas demasiado cerca, puede atropellarte: el daño depende de la velocidad y puede ser mortal. El golpe activa un ragdoll articulado y lanza al personaje hacia arriba y hacia delante según la velocidad. Si sobrevive, se levanta después de caer; si muere, la pantalla de recuperación espera a que termine la caída. El conductor sigue frenando hasta detenerse y espera brevemente antes de continuar. Los vehículos en movimiento y estacionados tienen colisiones mediante cajas invisibles simples, sin calcular los triángulos de sus modelos.

Si la salud llega a cero, el juego se pausa y muestra una pantalla de recuperación. El regreso al cambuche ocurre al pulsar **Volver al cambuche**.

## Radar, pausa y El Chato

El radar gira con la cámara en las dos vistas: arriba representa el frente de la pantalla. Muestra las calles, andenes, manzanas, parques y el lago del propio trazado del juego, con la flecha del jugador según su rumbo y el nombre de la calle por donde caminas. Debajo aparecen la distancia y la dirección al lugar más cercano. Usa **N** para ocultarlo o mostrarlo.

Con **K**, o con un clic en el radar, se abre el mapa completo de la ciudad y el juego queda en pausa. Muestra las calles rotuladas (Calle 7 a Calle 10, Carreras 6 a 15 y Avenida Caracas), el Portal del Centro y los puntos de interés. Como en GTA V:

- El panel de la izquierda muestra el destino con su distancia y tiempo a pie, los lugares agrupados (refugio, servicios, comercio, lugares y El Chato) con qué se hace en cada uno y su tecla, y la leyenda de colores.
- Al pasar el ratón por un ícono aparece su información. Sobre el resto del mapa se ven la zona, la calle, el tipo de suelo y si se puede caminar.
- Un clic en el mapa, en un ícono o en un lugar de la lista marca el destino, y una ruta morada a pie aparece en el mapa y en el radar.
- La ruta sigue andenes y cruza las calles en ángulo recto. Evita manzanas, el agua y, en lo posible, el carril del TransMilenio.
- Si te desvías, la ruta se recalcula, y el marcador queda en el borde del radar mientras esté lejos.
- Al llegar, el destino se borra. Clic derecho o **Supr** lo quitan antes.
- La rueda acerca o aleja el mapa, y arrastrar lo mueve. **K** o **Esc** lo cierran.

**Esc** o **Pausa** abren los ajustes: volumen maestro, silencio, calidad gráfica y guardado manual. Cerrar una tienda o el inventario con Esc no abre a la vez la pausa. Abrir cualquier panel libera el cursor. El volumen afecta también a los motores y claxones actuales, que mantienen su reproducción normal y sus voces independientes.

El Chato aparece junto al cambuche. Acércate y pulsa **E**: si llevas pan o una lata de atún, lo alimentas y se vuelve compañero; también puedes acariciarlo para recuperar 5 de ánimo, con 20 segundos entre caricias. Te sigue por lugares transitables, rodea paredes y respeta las cajas de los vehículos. Avisa de basura cercana que aún no se haya vaciado, con un ladrido breve sintetizado y un mensaje. Dormir con él aporta 15 de ánimo adicional y lo muestra acostado a tu lado. La amistad se guarda sin invalidar partidas anteriores.

El cielo usa tonos de amanecer andino y cambia entre nublado y llovizna con 350 partículas cercanas al jugador. El clima y El Chato se detienen durante la pausa; el material de lluvia se prepara en la pantalla de carga.

## Rendimiento

**Pausa → Calidad** permite elegir Baja (sin sombras ni silueta, hasta 1× de resolución), Media (sombras de 1024 px, hasta 1.25×) y Alta (sombras de 2048 px, hasta 1.5×). Las primeras partidas usan Media; se conserva una preferencia ya guardada. La adaptación respeta el límite seleccionado y puede reducir temporalmente efectos y frecuencia de animación cuando bajar resolución no basta. La niebla y la distancia de cámara acompañan el perfil efectivo. La mejora de FPS depende del equipo y de la zona; no se garantiza una cantidad fija.

Al abrir el juego aparece una pantalla de carga por etapas. Espera el mapa, los modelos de jugador y NPC (incluidas sus versiones de detalle), sube las texturas a la GPU y precompila los materiales. Prepara también las sombras y la silueta de la vista inicial antes de mostrar la partida. El creador de personaje sigue disponible en la primera partida. Durante la carga no avanzan el reloj ni las necesidades; la medición de FPS comienza desde cero al entrar a jugar. Si falla un recurso imprescindible, aparece **Reintentar**; los sonidos ausentes no bloquean el inicio. Esta preparación aumenta la espera inicial y el uso de memoria al adelantar la carga de los NPC completos.

El panel inferior derecho muestra FPS actuales, mínimo y máximo por fotograma, promedio de la sesión, milisegundos por cuadro y coordenadas del jugador en metros. Incluye p95, p99, 1 % de FPS bajos y tirones superiores a 100 ms de los últimos 600 cuadros activos. El mínimo de sesión puede corresponder a un único tirón antiguo. **Reiniciar medición** inicia una nueva muestra. El promedio se calcula como cuadros / tiempo real; los menús y la pestaña en segundo plano quedan excluidos. El panel se refresca cuatro veces por segundo para evitar escrituras DOM innecesarias.

La ciudad conserva sus dimensiones y población. La iluminación combina dos luces puntuales cercanas con halos decorativos suaves sobre el suelo para faroles y fogones. Hasta 48 halos cercanos comparten una sola llamada de dibujo y no calculan iluminación ni sombras sobre los materiales. Las llamas y lámparas siguen visibles; las luces decorativas lejanas ya no iluminan paredes y personajes en tiempo real.

Los suelos, marcas y edificios se agrupan por sectores de 32 metros. En tercera persona, las paredes, techos y adornos que comparten material se dibujan juntos; al cambiar a isométrica se recuperan las piezas independientes para ocultar las que tapan al jugador. Las transformaciones de inmuebles se calculan una vez. Las pasadas de silueta solo recorren al jugador y las luces, y el tráfico descarta peatones lejanos antes de comprobar el frenado.

El *frustum culling* descarta sectores completos y vehículos fuera del encuadre antes de recorrer sus mallas. Comprueba el volumen completo para conservar objetos parcialmente visibles y funciona en ambas cámaras. Los objetos necesarios para el mapa de sombras siguen disponibles en esa pasada; Three.js descarta sus mallas fuera de la cámara en la pasada de color. El bus y los NPC siguen su recorrido fuera de pantalla. Los halos también se filtran antes de crear las instancias. El panel muestra **Grupos en cámara** y **Descartados**; los grupos conservados únicamente para sombras explican la diferencia entre ambos contadores y el total.

Si los FPS permanecen por debajo de 45 durante tres segundos, la resolución interna baja gradualmente hasta 0.75×. Con menos de 30 FPS sostenidos, reacciona desde un segundo y ocho cuadros lentos, con un paso mayor. Si ya llegó al mínimo, reduce el perfil efectivo; recupera los efectos antes de subir resolución, tras ventanas estables por encima de 57 FPS. Esto puede suavizar la imagen en equipos lentos; el texto de la interfaz conserva su resolución. El panel también muestra la calidad efectiva, resolución, llamadas de dibujo y triángulos, incluyendo sombras y silueta. Los FPS reales dependen del equipo y deben compararse recorriendo la misma zona y con la misma cámara. Véase [rendimiento y medición](docs/rendimiento.md).

Referencias técnicas: [renderizado y métricas de Three.js](https://threejs.org/docs/pages/WebGLRenderer), [resolución de renderizado](https://threejs.org/manual/pages/responsive.html), [volumen visible de la cámara](https://threejs.org/docs/pages/Frustum.html).

## Sonido

El ambiente usa `city_atmosphere_soun.opus` y los pasos usan `Sounds_of_a_steps.opus`, con mayor cadencia al correr. Cada carro y cada bus mantienen voces independientes para ralentí, marcha y claxon. Robar un retrovisor de un carro estacionado activa `Sonido De Alarma De Auto.opus`, con una voz por carro, sin bucle y respetando volumen, silencio y pausa. Por ahora motores y claxon usan reproducción normal, sin audio espacial, paneo ni atenuación por distancia. El volumen depende de la marcha o el ralentí y permanece igual al girar la cámara. Solo suenan los ocho vehículos más cercanos a menos de 55 metros; las grabaciones se cargan una sola vez y se comparten entre instancias. Robar con E un retrovisor de un carro en circulación reproduce inmediatamente una de las cinco frases `roberto_robo_espejo_n1.mp3`–`roberto_robo_espejo_n5.mp3`, siguiendo su posición y quedando en silencio a 12 metros. En esos carros se roban solo espejos y se mantiene el enfriamiento entre robos; la alarma corresponde a los estacionados. Cuando un carro pita por una persona atravesada, reproduce también una frase elegida al azar entre doce grabaciones: `valentina_n1.mp3`, `valentina_n3.mp3`–`valentina_n7.mp3` y `roberto_n1.mp3`–`roberto_n6.mp3`. Las frases solo empiezan a menos de 8 metros, se atenúan al alejarse y quedan en silencio desde esa distancia; respetan volumen, silencio y pausa. El claxon utiliza una pitada corta de car_horn_sound1.opus, car_horn_sound.opus o car_horn_sound_v3.opus, espera ante peatones atravesados y tiene un intervalo propio de 6–11 segundos. Los semáforos y las colas de vehículos no lo activan por sí solos; si alguien se queda junto al parachoques, el conductor pita incluso estando detenido por rojo o tráfico. Menús, sueño y pestaña oculta pausan el audio; un clic o una tecla desbloquea el sonido si el navegador lo exige.

## Compilación y pruebas

Para generar la versión de producción y verla localmente:

```sh
npm run build
npm run preview
```

La compilación se genera en `dist/`. Abre la dirección que muestre el comando de previsualización.

Las pruebas de navegador con Playwright y su instalación se explican en [docs/testing.md](docs/testing.md). Incluyen creación del personaje, fabricación, ayuda, inventario y pausa. Antes de ejecutarlas, instala Chromium como indica esa guía.

Para ejecutar las pruebas con el runner de Node.js:

```sh
npm test
```

Las pruebas automatizadas cubren colisiones, cámaras, visibilidad de edificios, suelos, navegación de peatones, tráfico, bus, supervivencia, migración de partidas guardadas, ampliación de la ciudad, rendimiento y carga inicial. Los carros circulan a 10–14 m/s en rectas libres (el doble que antes); el bus conserva sus 5 m/s y los semáforos completan su ciclo en 36 segundos, con 14 segundos de verde por eje, 3 de amarillo y 1 de despeje. El tráfico permite cruces simultáneos compatibles, mantiene la prioridad entre giros que se cortan y usa aceleración, frenado y reacción progresivos. Se comprueba su circulación durante diez minutos simulados, además del paso compartido con el bus y la carrocería dentro de la calzada al girar. Las pruebas de arranque verifican que la partida espere modelos, shaders y GPU, que un fallo impida comenzar una partida incompleta y que la espera no contamine las estadísticas de FPS. Las pruebas de modelos importados comprueban las dimensiones de los nueve GLB reales, el uso compartido de recursos, el desvanecimiento del bus y los estados de construcción del cambuche. La reserva de materiales se comprueba contra todas las recetas, también tras reponerse las bolsas, con protección de objetos cuando el costal está lleno.

## Estructura

El archivo [AGENTS.md](AGENTS.md) reúne el contexto técnico, los comandos de trabajo, los puntos de entrada y las decisiones que deben conservarse al continuar el desarrollo. La procedencia de las integraciones está documentada en [modelos importados](docs/modelos-importados.md) e [integración de funcionalidades](docs/integracion-cristian.md).

```text
src/
  core/        Bucle del juego, renderizado, cámara y entrada
  entities/    Jugador y objetos interactivos
  systems/     Supervivencia, inventario, tráfico, guardado y colisiones
  world/       Distrito, edificios, terreno y navegación
  character/   Modelos y apariencia del personaje
  ui/          Interfaz, menús y creador de personaje
  data/        Objetos, talentos y construcción
public/        Modelos y audio
tests/         Pruebas automatizadas
docs/images/   Capturas del juego
```

## Tecnologías

JavaScript con módulos ES, Three.js para el mundo 3D, Vite para desarrollo y compilación y Howler para el audio.

## Integración del original (21 de octubre de 2026)

Integra los cambios de `juanagogo/bazuko` hasta `77f66bd`: radio AM/FM sintetizada con pilas y guardado, movimiento con inercia, ajustes de cámara al correr, humedad del asfalto y nuevas mecánicas de abstinencia, alucinaciones y reacción de peatones a proyectiles. Conserva el tráfico, los modelos, el cambuche, los sonidos y las optimizaciones de esta versión. La radio respeta volumen general, silencio y pausa; el asfalto húmedo se desactiva en calidad baja. Véase [la nota de integración](docs/integracion-upstream.md).

### Animaciones del personaje

El personaje realista usa nuevos movimientos de Quaternius exportados con ActionForge para caminar, correr, buscar, pedir, consumir, agacharse y lanzar. Se conserva la personalización de ropa, pelo y cuerpo, además del ragdoll. El banco optimizado contiene ocho clips sin duplicar las texturas. Consulta [procedencia, adaptación y controles](docs/animaciones-actionforge.md).

### Parque del Lago y viaducto

La ampliación al sur, desde Z 222, añade un lago de unos 100 × 52 metros, senderos, bancas y arbolado. El agua no es transitable y el parque aparece en el radar. Un único puente de asfalto cruza el lago y rodea la Torre Colpatria por el oriente, desde Z 15,43 hasta Z 318. Alcanza 7,82 metros de altura en Z 39 y conserva esa cota hasta Z 280, donde comienza la rampa sur.

El puente mantiene 14 metros de ancho real en todo el recorrido, medidos perpendicularmente a su eje. Sus curvas tienen un radio más amplio y bordes paralelos, sin ensanchamientos locales. La llegada norte está centrada en X 75. El concreto queda bajo el asfalto, sin superficies superpuestas. Los buses ajustan altura e inclinación al tablero y sus colisiones siguen la carrocería. El jugador puede caminar sobre el puente o por las calles inferiores.

### Avenida, comercios y Torre Colpatria

La Caracas alterna edificios de dos a seis pisos y tiene una pasarela en Z 8, con 6,4 metros libres sobre la calzada. La gasolinera junto a X 142, Z 95 incluye marquesina roja, cuatro surtidores, tienda y tótem. La tienda D69, junto a X 53, Z 162, tiene fachada blanca, franjas rojas y vitrinas. Ambos comercios son decorativos, sin compras ni acceso interior.

La Torre Colpatria estilizada mide 112 metros de alto y tiene una planta de 24 × 26 metros en X 81, Z 168. La acompaña un anexo gris de 22 metros de alto, con columnas y locales. Sus franjas amarillas, azules y rojas se iluminan de noche sin añadir luces dinámicas. El viaducto rodea el conjunto y deja libres los edificios.

Cada entrada a la partida comienza a las 22:00 y con llovizna, también al continuar un guardado. Se conserva el día y el progreso; después el reloj y el clima siguen sus ciclos normales.

### Estación Portal del Centro

La avenida se prolonga 74 metros hacia el norte, sin desplazar las coordenadas anteriores. La nueva estación Portal del Centro ocupa una isla central de 4 × 40 metros, centrada en X 75, Z −30, con rampas de acceso de 8 metros en ambos extremos. Su diseño propio incluye estructura metálica gris, paneles de vidrio, cubierta, bancas, señalización y accesos laterales de embarque. Se puede recorrer a pie y localizar su entrada en el radar; sustituye el modelo anterior de estación.

Dos buses recorren la troncal en sentidos opuestos, cada uno en su carril. Ambos paran cuatro segundos en la estación y comparten el viaducto, con carriles paralelos en las curvas. Mantienen colisiones, motores y estados de marcha independientes.

El rodeo de Colpatria usa un eje con transiciones de curvatura suaves entre Z 80 y Z 260. Las barandas, el asfalto y el tablero comparten bordes a distancia perpendicular constante del eje. Los carriles de ambos sentidos siguen ese mismo trazado; el corredor del lago y sus consultas de altura acompañan la curva.

### Ilustraciones de la pantalla de carga

La carga muestra fondos y personajes por parejas numeradas en orden aleatorio, con fundido y movimiento parallax independiente. Cambia de pareja cada 7,5 segundos mientras continúa la carga, sin imponer tiempo adicional de espera. El movimiento respeta la preferencia de reducir animaciones. Si una imagen falla, se conserva la pareja anterior o la pantalla de respaldo.

Las imágenes WebP están en `public/images/pantalla-carga/`: `fondo_pantalla_carga_N.webp` y `personaje_pantalla_carga_N.webp`, con transparencia en el personaje. Los números disponibles se declaran en `src/ui/loading-artwork.json`; al añadir otra pareja, añadir allí su número.

Un edificio de cinco pisos, con planta de 12 × 12 metros y 16,6 metros de alto, ocupa X 75, Z 125, junto al viaducto: fachada de ladrillo, ventanas, puerta y azotea, con colisión sólida y sin acceso interior.

Las antiguas franjas rojas a nivel del suelo bajo el viaducto se convierten en pasto; se conservan las calles transversales, las rampas, los edificios y el lago. Las marcas de cruce no se pintan sobre el césped.

### Variedad de edificios

Veinte solares de casas genéricas se sustituyen por edificios de 3 a 30 pisos, repartidos entre los sectores de la ciudad. Se conservan las casas bajas y los hitos existentes. Los cinco diseños combinan ladrillo con balcones, concreto con bandas horizontales, marcos verticales, coronaciones retranqueadas y esquinas acristaladas, con iluminación nocturna en ventanas. Las torres de mayor altura ocupan solares de al menos 12 × 12 metros; no invaden calles, parques ni el viaducto.

La distribución es determinista. Sus colisiones llegan a la altura de cada edificio y conservan el sistema de ocultación de paredes, la agrupación por sectores y texturas pequeñas compartidas, sin nuevas luces dinámicas.
