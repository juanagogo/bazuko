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
- Ciclo de día y noche con sol, luna con fases, estrellas y nubes; cuatro temporadas bogotanas y siete estados del tiempo, de soleado a tormenta eléctrica. Necesidades de supervivencia con un ritmo relajado. Un día del juego dura una hora real. [Detalles del clima](docs/clima.md).
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
| `M` | Abrir el mapa para marcar un destino; en el mapa, cerrarlo. |
| `K` | Alternar entre el personaje realista y el modelo liviano. |
| `Esc` o botón Pausa | Abrir la pausa en la pestaña Estado; cerrar primero el panel activo y liberar el cursor. |
| `N` | Mostrar u ocultar el radar. |
| `+` / `−` | Acercar o alejar el radar. |
| `F3` | Mostrar u ocultar el panel de rendimiento. |
| `R` en la calle | Abrir o cerrar la radio AM/FM; permite sintonizar emisoras y cambiar pilas. |
| `X` en la calle | Lanzar si llevas munición; de lo contrario, hacer popó. |
| `Z` en la calle | Hacer popó. |
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

## Radar, mapa, GPS y pausa

La columna inferior izquierda reúne los avisos, las necesidades y el radar con el mismo ancho. Cada necesidad muestra su icono, nombre, barra y valor; bajo 30 el valor se resalta y bajo 15 la barra parpadea. Los colores son los mismos en la pestaña Estado. El radar tiene tres tamaños (Pequeño, Mediano y Grande, en **Ajustes**) que también ajustan el ancho de la columna y crecen con la pantalla. Muestra el plano de la ciudad (calles, andenes, manzanas, parques, lago y el viaducto en franja translúcida) y gira con la cámara en las dos vistas: arriba representa el frente de la pantalla. La **N** del borde indica el norte. Al correr se aleja para ver más lejos; **+** y **−**, con el teclado o con los botones de su esquina, cambian el alcance base, que se guarda, y la esquina inferior indica el alcance actual. Debajo aparece el destino marcado o, sin destino, el lugar más cercano, con su distancia y dirección en una segunda línea. Ocultarlo con **N** o con **✕** deja un botón **Radar** para recuperarlo.

**M** abre el mapa grande con el norte arriba. Se puede arrastrar, acercar con la rueda o con los botones **+** y **−**, volver al jugador con **◎**, ver toda la ciudad con **⤢** y marcar un destino con un clic, sobre un lugar o en cualquier punto de la calle. Una leyenda identifica andenes, calles, parques, agua, edificios y la ruta. La lista **Ir a…** ordena los lugares de la ciudad del más cercano al más lejano. El clic derecho o **Quitar destino** lo borra. El GPS calcula la mejor ruta a pie: prefiere andenes, parques y cruces peatonales, evita caminar por la calzada y rodea edificios y el lago. Va por la calle inferior, no por el viaducto. La ruta amarilla aparece en el radar y en el mapa y se recalcula si el jugador se desvía más de 6 metros. Un haz amarillo marca el destino en la calle y desaparece al llegar. El destino se guarda con la partida.

La pausa tiene cuatro pestañas de alto fijo, que se recorren con **Q** y **E**: Mapa, Estado (necesidades, dinero, nivel, El Chato y guardado manual), Ajustes (volumen, silencio, calidad gráfica, panel de rendimiento, radar con su tamaño y alcance, haz del destino, modelo y radio) y Controles. Cerrar una tienda o el inventario con Esc no abre a la vez la pausa. Abrir cualquier panel libera el cursor. El volumen afecta también a los motores y claxones actuales, que mantienen su reproducción normal y sus voces independientes.

El Chato es el único perro del juego y aparece junto al cambuche, donde merodea y olfatea mientras no tiene dueño. Acércate y pulsa **E**: si llevas pan o una lata de atún, lo alimentas y se vuelve compañero; también puedes acariciarlo para recuperar 5 de ánimo, con 20 segundos entre caricias, y lo celebra con un brinco y la cola. Te sigue al paso, al trote o al galope según lo lejos que estés, rodea paredes y respeta las cajas de los vehículos; si lo dejas muy atrás, por ejemplo al tomar el bus, aparece cerca de ti. Cuando te detienes se sienta y, si sigues quieto, se echa. Avisa de basura cercana que aún no se haya vaciado y ladra a los peatones que sospechan de ti; mientras te acompaña de cerca, distrae y reduce la probabilidad de que te pillen robando. Dormir con él aporta 15 de ánimo adicional y lo muestra dormido a tu lado. En la pestaña Estado de la pausa puedes elegir su pelaje, accesorio y tamaño. La amistad y la apariencia se guardan sin invalidar partidas anteriores.

El cielo sigue la posición del sol y la luna sobre Bogotá, con nubes que derivan con el viento. El tiempo pasa de forma gradual entre soleado, parcialmente nublado, nublado, neblina, llovizna, aguacero y tormenta según la temporada; ver [docs/clima.md](docs/clima.md). El clima y El Chato se detienen durante la pausa; el material de lluvia se prepara en la pantalla de carga.

## Efectos de consumo

El pegante, la hierba y la pastilla pueden aparecer en las bolsas de basura, con poca frecuencia; la pastilla es la más rara porque el dealer la compra cara. Al consumirlas desde el inventario o el acceso rápido, además de sus efectos sobre las necesidades, cada una cambia la imagen y el sonido durante un rato:

- **Pegante (35 s):** mareo. La imagen se vuelve borrosa y verdosa, los bordes se oscurecen, la visión se duplica y la cámara se mece. Suena una inhalación dentro de la bolsa, un zumbido grave con un pitido de oídos tapados, y el resto de la ciudad se oye apagada, como bajo el agua.
- **Pastilla (45 s):** euforia de colores. El tono oscila despacio, los colores se saturan, una capa de arcoíris gira y la imagen deja estela. Suena un trago, un brillo que sube y un acorde que ondula.
- **Hierba (60 s):** cálido y lento. Tonos dorados, un brillo suave en el centro y una estela leve. Suena un encendedor, una inhalación larga y un fondo grave y cálido.

Cada efecto entra en 3 segundos y se desvanece en los últimos 6. Repetir la misma sustancia renueva su duración; otra distinta reemplaza a la anterior después de desvanecerla en un segundo. Los menús, el inventario y la pestaña oculta congelan el efecto, aunque el sonido de consumir suena con el inventario abierto. Dormir, morir o recuperarse en el cambuche lo cortan con un desvanecido, nunca de golpe. Ninguna oscilación de color o brillo supera medio ciclo por segundo. En calidad baja no hay estela ni desenfoque; el sonido respeta el volumen general, el de efectos y el silencio, y con la preferencia de movimiento reducido del sistema la cámara y la estela se mueven al 20 %. El tintico y el cigarrillo no tienen efecto visual.

## Rendimiento

**Pausa → Calidad** permite elegir Baja (sin sombras ni silueta, hasta 1× de resolución), Media (sombras de 1024 px, hasta 1.25×) y Alta (sombras de 2048 px, hasta 1.5×). Las primeras partidas usan Media; se conserva una preferencia ya guardada. La adaptación respeta el límite seleccionado y puede reducir temporalmente efectos y frecuencia de animación cuando bajar resolución no basta. La niebla y la distancia de cámara acompañan el perfil efectivo. La mejora de FPS depende del equipo y de la zona; no se garantiza una cantidad fija.

Al abrir el juego aparece una pantalla de carga por etapas. Espera el mapa, los modelos de jugador y NPC (incluidas sus versiones de detalle), sube las texturas a la GPU y precompila los materiales. Prepara también las sombras y la silueta de la vista inicial antes de mostrar la partida. El creador de personaje sigue disponible en la primera partida. Durante la carga no avanzan el reloj ni las necesidades; la medición de FPS comienza desde cero al entrar a jugar. Si falla un recurso imprescindible, aparece **Reintentar**; los sonidos ausentes no bloquean el inicio. Esta preparación aumenta la espera inicial y el uso de memoria al adelantar la carga de los NPC completos.

El panel de rendimiento está oculto por defecto; **F3** o **Ajustes → Rendimiento** lo muestran y la preferencia se guarda. Las mediciones y la resolución adaptativa funcionan igual aunque esté oculto. El panel inferior derecho muestra FPS actuales, mínimo y máximo por fotograma, promedio de la sesión, milisegundos por cuadro y coordenadas del jugador en metros. Incluye p95, p99, 1 % de FPS bajos y tirones superiores a 100 ms de los últimos 600 cuadros activos. El mínimo de sesión puede corresponder a un único tirón antiguo. **Reiniciar medición** inicia una nueva muestra. El promedio se calcula como cuadros / tiempo real; los menús y la pestaña en segundo plano quedan excluidos. El panel se refresca cuatro veces por segundo para evitar escrituras DOM innecesarias.

La ciudad conserva sus dimensiones y población. La iluminación combina dos luces puntuales cercanas con halos decorativos suaves sobre el suelo para faroles y fogones. Hasta 48 halos cercanos comparten una sola llamada de dibujo y no calculan iluminación ni sombras sobre los materiales. Las llamas y lámparas siguen visibles; las luces decorativas lejanas ya no iluminan paredes y personajes en tiempo real.

Los suelos, marcas y edificios se agrupan por sectores de 32 metros. En tercera persona, las paredes, techos y adornos que comparten material se dibujan juntos; al cambiar a isométrica se recuperan las piezas independientes para ocultar las que tapan al jugador. Las transformaciones de inmuebles se calculan una vez. Las pasadas de silueta solo recorren al jugador y las luces, y el tráfico descarta peatones lejanos antes de comprobar el frenado.

El *frustum culling* descarta sectores completos y vehículos fuera del encuadre antes de recorrer sus mallas. Comprueba el volumen completo para conservar objetos parcialmente visibles y funciona en ambas cámaras. Los objetos necesarios para el mapa de sombras siguen disponibles en esa pasada; Three.js descarta sus mallas fuera de la cámara en la pasada de color. El bus y los NPC siguen su recorrido fuera de pantalla. Los halos también se filtran antes de crear las instancias. El panel muestra **Grupos en cámara** y **Descartados**; los grupos conservados únicamente para sombras explican la diferencia entre ambos contadores y el total.

Si los FPS permanecen por debajo de 45 durante tres segundos, la resolución interna baja gradualmente hasta 0.75×. Con menos de 30 FPS sostenidos, reacciona desde un segundo y ocho cuadros lentos, con un paso mayor. Si ya llegó al mínimo, reduce el perfil efectivo; recupera los efectos antes de subir resolución, tras ventanas estables por encima de 57 FPS. Esto puede suavizar la imagen en equipos lentos; el texto de la interfaz conserva su resolución. El panel también muestra la calidad efectiva, resolución, llamadas de dibujo y triángulos, incluyendo sombras y silueta. Los FPS reales dependen del equipo y deben compararse recorriendo la misma zona y con la misma cámara. Véase [rendimiento y medición](docs/rendimiento.md).

Referencias técnicas: [renderizado y métricas de Three.js](https://threejs.org/docs/pages/WebGLRenderer), [resolución de renderizado](https://threejs.org/manual/pages/responsive.html), [volumen visible de la cámara](https://threejs.org/docs/pages/Frustum.html).

## Sonido

El ambiente usa `city_atmosphere_soun.opus`. Los pasos son pisadas sueltas recortadas de `Sounds_of_a_steps.opus`: suena una cada 1,15 metros caminando y cada 1,9 corriendo, al ritmo de la animación. No se repite la misma pisada dos veces seguidas, y no suenan en el aire. En pasto y tierra suenan más suaves y algo más graves. En Ajustes hay volúmenes de Ambiente (incluida la lluvia), Tráfico (motores, claxones y alarmas), Voces (conductores y robo) y Efectos (pisadas, objetos, ladrido y efectos sintetizados), que se guardan en el navegador; la radio conserva el suyo. Mientras suena una frase, el tráfico y el ambiente bajan al 45 % para que se entienda, y nunca hablan dos personas a la vez: un conductor que pita mientras otro habla se queda callado, y el reclamo por robo interrumpe cualquier frase en curso. Cada carro y cada bus mantienen voces independientes para ralentí, marcha y claxon. Robar un retrovisor de un carro estacionado activa `Sonido De Alarma De Auto.opus`, con una voz por carro, sin bucle y respetando volumen, silencio y pausa. Motores y claxon usan reproducción normal, sin paneo, y se atenúan solo por volumen según la distancia: los motores suenan plenos hasta 6 metros y callan a 40 (55 el bus), y el claxon calla a 30. El volumen depende también de la marcha o el ralentí y permanece igual al girar la cámara. Solo suenan los seis vehículos más cercanos; si varios se agolpan junto al jugador, su mezcla se compensa para no saturar. Las grabaciones se cargan una sola vez y se comparten entre instancias. Robar con E un retrovisor de un carro en circulación reproduce inmediatamente una de las cinco frases `roberto_robo_espejo_n1.mp3`–`roberto_robo_espejo_n5.mp3`, siguiendo su posición y quedando en silencio a 12 metros. En esos carros se roban solo espejos y se mantiene el enfriamiento entre robos; la alarma corresponde a los estacionados. Cuando un carro pita por una persona atravesada, reproduce también una frase elegida al azar entre doce grabaciones: `valentina_n1.mp3`, `valentina_n3.mp3`–`valentina_n7.mp3` y `roberto_n1.mp3`–`roberto_n6.mp3`. Las frases solo empiezan a menos de 8 metros, se atenúan al alejarse y quedan en silencio desde esa distancia; respetan volumen, silencio y pausa. El claxon utiliza una pitada corta de car_horn_sound1.opus, car_horn_sound.opus o car_horn_sound_v3.opus, espera ante peatones atravesados y tiene un intervalo propio de 6–11 segundos. En toda la ciudad suenan como mucho dos pitadas a la vez, separadas al menos 1,5 segundos. Las pitadas ocasionales entre carros que circulan pegados usan las mismas grabaciones, más suaves, solo a menos de 25 metros y con al menos 9 segundos entre una y otra. Los semáforos y las colas de vehículos no lo activan por sí solos; si alguien se queda junto al parachoques, el conductor pita incluso estando detenido por rojo o tráfico. Menús, sueño y pestaña oculta pausan el audio; un clic o una tecla desbloquea el sonido si el navegador lo exige.

## Compilación y pruebas

Para medir el rendimiento en cinco vistas del juego con Playwright y un navegador aislado, deja Vite activo y ejecuta `npm run benchmark:performance`. Genera un informe JSON y capturas en `work/performance/`. Consulta el método, los requisitos y los resultados en [rendimiento y medición](docs/rendimiento.md).

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

El archivo [AGENTS.md](AGENTS.md) reúne el contexto técnico, los comandos de trabajo, los puntos de entrada y las decisiones que deben conservarse al continuar el desarrollo. La procedencia de las integraciones está documentada en [modelos importados](docs/modelos-importados.md) e [integración de funcionalidades](docs/integracion-cristian.md). Los iconos de la mesa de fabricación y sus autores se detallan en [iconos de objetos](docs/iconos.md).

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

## Recursos de terceros

El personaje realista usa assets de [MakeHuman Community](https://static.makehumancommunity.org/assets/assetpacks/index.html), en su mayoría CC0. El gorro de lana es *knitted hat 01* de **Mindfront**, publicado bajo CC-BY en el pack [Hats 03](https://static.makehumancommunity.org/assets/assetpacks/hats03.html). Ver `docs/personaje-piezas.md`.

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

La pantalla muestra tres etapas (ciudad, recursos y preparación gráfica), porcentaje y recuento de tareas terminadas. El porcentaje representa trabajo completado, no bytes descargados ni tiempo restante. Personajes, vehículos y mobiliario avanzan en una cola compartida de hasta seis tareas; las instancias siguen reutilizando los modelos descargados. El cuerpo y las prendas del personaje se solicitan en paralelo. Las actualizaciones de progreso y la subida de texturas a la GPU ceden fotogramas por presupuesto de tiempo, evitando pausas fijas por cada instancia o lote de texturas. La partida y los FPS empiezan después de preparar texturas, shaders y GPU.

La carga muestra fondos y personajes por parejas numeradas en orden aleatorio, con fundido y movimiento parallax independiente. Cambia de pareja cada 7,5 segundos mientras continúa la carga, sin imponer tiempo adicional de espera. El movimiento respeta la preferencia de reducir animaciones. Si una imagen falla, se conserva la pareja anterior o la pantalla de respaldo. Las ilustraciones se solicitan con prioridad baja para favorecer los recursos del juego; al cerrar la carga o abrir el creador se cancela la espera pendiente de la galería.

Las imágenes WebP están en `public/images/pantalla-carga/`: `fondo_pantalla_carga_N.webp` y `personaje_pantalla_carga_N.webp`, con transparencia en el personaje. Los números disponibles se declaran en `src/ui/loading-artwork.json`; al añadir otra pareja, añadir allí su número.

Un edificio de cinco pisos, con planta de 12 × 12 metros y 16,6 metros de alto, ocupa X 75, Z 125, junto al viaducto: fachada de ladrillo, ventanas, puerta y azotea, con colisión sólida y sin acceso interior.

Las antiguas franjas rojas a nivel del suelo bajo el viaducto se convierten en pasto; se conservan las calles transversales, las rampas, los edificios y el lago. Las marcas de cruce no se pintan sobre el césped.

### Variedad de edificios

Veinte solares de casas genéricas se sustituyen por edificios de 3 a 30 pisos, repartidos entre los sectores de la ciudad. Se conservan las casas bajas y los hitos existentes. Los cinco diseños combinan ladrillo con balcones, concreto con bandas horizontales, marcos verticales, coronaciones retranqueadas y esquinas acristaladas, con iluminación nocturna en ventanas. Las torres de mayor altura ocupan solares de al menos 12 × 12 metros; no invaden calles, parques ni el viaducto.

La distribución es determinista. Sus colisiones llegan a la altura de cada edificio y conservan el sistema de ocultación de paredes, la agrupación por sectores y texturas pequeñas compartidas, sin nuevas luces dinámicas.
