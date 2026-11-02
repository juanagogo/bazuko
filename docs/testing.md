# Pruebas

Las pruebas de navegador se adaptaron del PR [juanagogo/bazuko#4](https://github.com/juanagogo/bazuko/pull/4), commit `2df40da`, de Jonme-Mopri. La corrección asociada renderiza las recetas inmediatamente al abrir fabricación; esto es necesario porque el panel pausa la simulación.

## Pruebas unitarias y compilación

```sh
npm ci
npm test
npm run build
```

Las regresiones de jugabilidad comprueban el salto y el recorrido de ambas rampas del viaducto, la resistencia a enfermedades de Piel Dura, el peso final al fabricar con el costal lleno y la llegada del GPS a destinos marcados sobre edificios. En este último caso, ruta, marcador y guardado comparten el punto transitable cercano al edificio.

`map-services.test.js` y `map-view.test.js` comprueban precios, espacio en el costal, prioridad de necesidades, sugerencias y filas del mapa.

`cures.test.js` comprueba que cada remedio cure una enfermedad que existe y no se gaste sin ella, que la aguapanela cure la gripe y se tome aunque no la haya, que solo la basura con metal traiga tétanos y dormir sucio traiga sarna, y que las partidas viejas conserven la intoxicación. `dealer.test.js` verifica que comprarle al dealer para revenderle nunca deje ganancia, ni con Contactos; que `E` abra su tienda sin vender; que se venda solo la sustancia elegida, y que la requisa se lleve la mercancía sin pagar.

`inventory-actions.test.js` verifica que vaciar el inventario notifique a sus suscriptores, desequipe el arma y cancele su ataque pendiente. También comprueba que intentar fumar nadando, en el aire o aturdido conserve objeto, necesidades, audio y efectos, y que un consumo permitido gaste una sola unidad.

En C++, `bazuko_playerstate_test` comprueba que la carga conserve los objetos permitidos por el costal grande y los talentos, y que la regeneración no reviva al jugador durante una caída mortal. Se ejecuta con `ctest --test-dir cpp/build --output-on-failure` después de configurar y compilar los objetivos nativos. Estas pruebas de lógica no requieren abrir la ventana del juego.

## Sala de pruebas

`sala.html` (solo en `npm run dev`) prueba piezas sueltas sin cargar la ciudad: el jugador sobre un piso plano con la misma cámara, controles y render del juego. Las pruebas viven en `src/sala/pruebas.js`; cada una es `{ id, nombre, descripcion, montar(sala) }` y `montar` devuelve sus botones (`acciones`) y, si quiere, un texto de `estado` que se refresca en el panel. Se abre una en concreto con `sala.html?prueba=<id>`. `sala.timeScale` acelera la simulación para lo que tarda (un cigarrillo dura 10 minutos) y `sala.updaters`, `beforeRender` y `afterRender` permiten colgar sistemas como los efectos de consumo. No reemplaza las pruebas de navegador ni comprueba la ciudad, el tráfico o el guardado.

El perfil `sala.html?prueba=personaje&animaciones=mixamo-preview` permite comparar el banco Mixamo preparado en Blender. `tests/e2e/mixamo-room.spec.js` recorre sus nueve clips, verifica poses finitas, apoyos de geometría sobre el piso, raíz fija, pausa, avance por fotograma y errores de carga. También comprueba que la selección de la sala conserve la preferencia de modelo del juego. Las capturas sirven para revisar la calidad visual además de las aserciones numéricas.

`sala.html?prueba=posturas` muestra una persona por cada postura de la capa de cuerpo. Permite cambiar de cuerpo, de modelo completo a liviano y de familia de paso, echarlos a andar y hacerlos caer.

`sala.html?prueba=peatones` pone dos filas con cada arquetipo y una con quienes se quedan en su sitio. Permite sacar otra tanda, pasar de modelo completo a liviano, echarlos a andar, hacer llover, ensuciar al jugador para ver quién se tapa la nariz y probar las paradas.

Para ejecutar únicamente las pruebas de animaciones en la sala (con el puerto 5188 libre):

```sh
PLAYWRIGHT_GPU=1 npx playwright test tests/e2e/mixamo-room.spec.js tests/e2e/animation-room.spec.js
```

## Integración continua

`.github/workflows/ci.yml` ejecuta `npm ci`, `npm test` y `npm run build` en cada pull request y en cada push a `main`. Solo descarga de Git LFS los WAV de `public/audio`; los respaldos del port C++ en `cpp/assets/audio` no se descargan. Las pruebas de navegador no forman parte de la CI.

## Preparar Chromium

```sh
npx playwright install chromium
```

## Pruebas de navegador

```sh
npm run test:e2e
npm run test:e2e:headed
npm run test:e2e:ui
npm run test:report
```

En equipos donde SwiftShader no termina la preparación gráfica, ejecutar con la GPU local y ventana visible:

```sh
PLAYWRIGHT_GPU=1 npm run test:e2e:headed
```

Playwright inicia su propio Vite en `127.0.0.1:5188`, con puerto estricto y sin reutilizar otro servidor, para verificar esta copia del proyecto. Ejecuta Chromium con un solo worker y WebGL por software para limitar el uso de GPU y memoria. Cada prueba limpia el almacenamiento local de su contexto aislado; no borra la partida de tu navegador habitual.

Los escenarios esperan a que termine la pantalla de carga antes de interactuar. Verifican creación del personaje, talentos, recetas de fabricación, edición de apariencia, ayuda plegable, inventario y pausa. Se cierra fabricación antes de editar el personaje para respetar la pausa actual. Se comprueba que Escape cierre un panel sin abrir simultáneamente otro.

El escenario de regresiones comprueba además que Espacio eleve al jugador en el bucle real, que el panel permita fabricar con 20 kg ocupados cuando los ingredientes liberan espacio y que marcar Colpatria complete la llegada en una acera accesible.

## Actualización visual

La dirección, paleta y límites de la actualización están en [direccion-visual.md](direccion-visual.md).

- `character-motion.test.js`: movimiento independiente de FPS, poses sin acumulación, aislamiento entre esqueletos y conservación de pies/raíz.
- `urban-atmosphere.test.js`: cielo y lluvia con color de salida correcto, cambios de día/noche y entorno PBR exterior.
- `photo-mode.test.js`: entrada/salida, cámara y audio restaurados, atajos, foco, captura PNG, nombre del archivo, marcas del mundo fuera de la foto y controles que se esconden.
- `entrada.test.js` y `tests/e2e/entrada.spec.js`: pantalla de carga en una tinta, palabra que se escribe, fallo y reintento, creador en cinco tamaños con teclado y dedo, y modo foto y panel de rendimiento con el juego real. Ver `docs/identidad-visual.md`.
- El navegador comprueba F2, simulación y tráfico congelados, HUD oculto, descarga PNG con contenido real y restauración de cámara; también detecta errores JavaScript y de compilación de shaders durante ese flujo.
- El creador se recorre a 1280×800 y 375×812 con movimiento reducido. Se comprueba que sus acciones permanezcan visibles y que las cuatro pestañas de pausa no produzcan desbordamiento horizontal a 375 px.

Para guardar capturas de inspección del creador, menús, radar y modo foto:

```sh
mkdir -p work/visual-review
BROWSER=none PLAYWRIGHT_GPU=1 GPS_SHOTS=work/visual-review npm run test:e2e:headed
```

La captura del modo foto conserva la resolución del canvas (según calidad/DPR). La actualización reutiliza los modelos y clips existentes; no agrega un nuevo catálogo 3D. Las pruebas locales no establecen un rendimiento objetivo para todos los equipos ni validan el port C++ gráfico, y la compilación sigue advirtiendo sobre el tamaño del paquete principal.

## Animación, combate y lago

`character-action-integration.test.js` carga los GLTF y clips locales para comprobar articulación en el cuerpo vestido, continuidad de locomoción, salto en movimiento y natación. `action-pose.test.js` cubre restauración por instancia, fases de golpe de respaldo y límites del esqueleto. `melee-combat.test.js` y `melee.test.js` verifican resolución del ataque, combos y fases por arma, selección frontal, daño y KO; la integración conserva la comprobación de altura y obstáculos, incluida la OBB del bus.

- `combat-geometry.test.js` y `enemy-reach.test.js`: alcance en calle, puente y agua; paredes y buses girados; barrido de persecuciones y nueva comprobación del contacto al impactar.
- `police-chase-integration.test.js`: captura única, obstáculos, ribera, altura, abandono y retorno gradual al patrullaje.
- `npc-combat-integration.test.js`: contactos únicos por ataque, KO y recuperación sin renovar botín, empujes seguros y cancelación de contraataques.
- `tests-player-combat-integration.test.js`: combos, energía, orientación actual, múltiples objetivos y cancelación al cambiar arma, caer, recibir daño o entrar al agua.
- `gamepad-context.test.js`: navegación de paneles y modo foto, acciones según contexto y liberación de entradas al perder foco, ocultar la pestaña o desconectar el mando. Usa un mando simulado; no valida un dispositivo físico.

`lake-depth.test.js` compara profundidad con raycasts del fondo y comprueba pilares hasta el lecho. `water-movement.test.js` valida flotación, entrada predictiva y salida gradual. `player-water-integration.test.js` recorre con el Player real la orilla hasta el nado y de regreso, cae desde altura y comprueba que el agua no capture al jugador sobre el viaducto. `water-effects.test.js` verifica los pools, pausa y liberación de recursos.

Los E2E `actions.spec.js` recorren caminar/correr, congelan un salto y un impacto real para capturarlos, se lanzan al lago, nadan con estela y salen andando. `upgrade.spec.js` comprueba HUD compacto, alertas sin abrir el detalle, objetivos de 44 px y agua congelada durante foto. Para conservar capturas de las acciones, añadir `UPGRADE_SHOTS=work/visual-review` a la ejecución de navegador. Estas capturas deben revisarse visualmente; la lógica sola no confirma la calidad de una animación.

`integration.spec.js` reúne doce escenarios en el bucle real de la ciudad:

- Combo con cuchillo, KO con botella y recuperación del NPC sin renovar la recompensa.
- Entrada al agua que cancela el contacto pendiente, el cigarrillo y la pipa.
- Menús: T y C cierran su panel, cada ventana abre desde arriba, el costal con 34 tipos a cinco tamaños, el mapa grande sobre el cartón, el dial de la radio a 375, la carreta en su indicador y el recorrido sin ratón: Q y E en la pausa, flechas en el costal y foco visible en la mesa.
- Modo foto que congela patrulla, agresores, sustancias y radio, y reanuda la simulación al salir.
- Arresto desde el agua y recuperación sin movimiento, amenazas ni efectos pendientes.
- Mando simulado para usar el inventario sin descartar objetos y operar el modo foto.
- Arma casera equipada desde el inventario: barrido, remate con más daño, esqueleto con matrices finitas y «Vender todo» sin tocar el arma de la mano.
- La misma arma y dormir con el perfil `mixamo-game-preview`, que comparte esas poses con el banco Mixamo: acostado mientras duerme y sin arma visible, de pie al despertar.
- Sin plata de noche: radar y mapa llevan al jíbaro, `E` abre la tienda sin vender nada, solo se vende lo elegido, la fila de venta cabe a 375 y 1280 px, el aviso de requisa queda encima de la tienda, `Q` y `E` cierran sin reabrir y de día no compra.
- Tienda con mando simulado: vender deja el foco en la fila que queda; sin ventas, o al quedarse sin plata, el foco espera en el aviso o en la fila, A no compra ni vende otra cosa y la cruceta sigue desde ahí.
- Dormir en plena carrera con el modelo realista: sin teclas no resbala al despertar y se levanta de a poco, también si ya va andando.
- Dormir sucio en la pose nueva: se acuesta mientras duerme y se levanta al despertar, la sarna llega con su aviso y queda guardada; la pomada no se gasta sin la enfermedad, con el aviso encima del inventario, y después la cura.

## Materiales, barrios y sombras de contacto

`texture-materials.test.js` verifica separación entre albedo y datos físicos, espacios de color y límites de tamaño. `neighborhood-identity.test.js` conserva el plan urbano y su geometría; `architecture-determinism.test.js` comprueba que crear más materiales no cambie las casas ni las colisiones. `contact-shadows.test.js` cubre suelo, viaducto, salto, agua, rampas, capacidad y liberación. `lake-shore-materials.test.js` verifica la mezcla de ribera sin alterar el terreno.

`street-materials.test.js` comprueba las marcas en reposo, aislamiento de materiales, normales y transparencia conservadas, semilla estable, los tonos y su ausencia, las zonas por islas, la misma clave de programa por tipo de superficie y la lluvia compartida. `street-clothes.test.js` usa los cuerpos y las prendas reales: arriba y abajo en cada prenda de cada cuerpo con los dos modelos, los mismos colores en ambos, poros y cejas pintadas según el modelo, medias bajo el pantalón largo y el crespo sin sus láminas sueltas. `shared-images.test.js` carga esos glTF por el camino real del cargador y comprueba que cada imagen se descargue y se decodifique una vez, que a cada material le llegue la que pide su archivo, con sus ajustes, y que desechar a alguien no libere ninguna textura. `body-language-guards.test.js` usa un cuerpo real y cuida lo que la capa de cuerpo promete: el liviano la lleva y se mueve igual que el completo, cada familia de paso se hornea una vez por cuerpo, el update del personaje no pide matrices de mundo, el liviano esconde la piel que su ropa tapa, el estilo se nota y entra igual a cualquier FPS, las posturas que oscilan se mueven de verdad y ninguna pasa del tope de frecuencia. La integración en `mixamo-preview.test.js` verifica que el desgaste explícito 0 siga respetándose. `PLAYWRIGHT_GPU=1 npx playwright test tests/e2e/street-appearance.spec.js` entra a la sala con `?aspecto=realista`, moja y seca al personaje sin cambiar su look ni sus clips, detecta errores de shaders y guarda capturas de rostro y cuerpo. Se revisan visualmente por separado; esta prueba no es una medición de FPS.

`tools/review-bogota-route.mjs` toma las mismas vistas de día y noche y registra renderer, resolución y tiempos de cuadro. Las capturas se inspeccionan visualmente; las cifras solo describen ese equipo y recorrido. El detalle y los límites están en [recorrido-bogota.md](recorrido-bogota.md).

`building-details.test.js` comprueba límites de geometría, agrupación por pared, alineación de ventanas y brillo nocturno en las dos vistas. `urban-trees.test.js`, `urban-planting.test.js` y `park-vegetation.test.js` verifican semillas, materiales compartidos, viento, reservas, agua y presupuestos. `vegetation-lifecycle.test.js` construye y libera el arbolado integrado para detectar recursos huérfanos o liberaciones duplicadas, incluyendo los materiales de profundidad.

## Ciudad, tráfico y luz

`city-placement.test.js` comprueba lo que se colocó en la ciudad: ni vendedores ni objetos en la calzada, el vendedor de la plaza alcanzable, la portada y las gradas de la iglesia, el muro de las torres curvas, la fuente que frena antes de su borde y se rodea sin trabarse, el carril del bus libre hasta la lámina, el suelo junto a los estribos y bajo la rampa del puente del lago, sin rendijas, el GPS junto a los postes del separador, ningún poste ni mobiliario sobre una rampa, la rejilla de aparición fuera de las cajas y el semáforo a la vista del carril de la X 66.

La prueba larga de `traffic.test.js` monta el tráfico como una partida: ciudad completa, una flota con dos patrullas, parqueados, NPC y perro como peatones, y buses con semáforos. Corre cinco semillas de cinco minutos, y una más con persecuciones repetidas, y falla si un vehículo pasa más de 200 segundos parado. Para medir un cambio de flota, usar ese montaje y varias semillas en procesos nuevos: una medición sin parqueados ni peatones no vio los atascos reales. Para un cambio en la conducta de la gente, sumar sustos periódicos a personas fijas cercanas a cruces y calzada, con el jugador quedándose cerca como lo haría al robar: sin sustos, un fijo nunca sale de su sitio y un atasco de minutos no se ve.

`sun-field.test.js` y `render-city.test.js` comprueban que el campo de sol llegue a cada material iluminado, también a los de shader propio, y el orden de dibujo: el suelo antes que las sombras de contacto y el halo del farol después de los cerros. `environment-mix.test.js` cubre el fundido de los mapas de entorno y `auto-quality.test.js` la calidad automática, también al volver de otra pestaña. `graphics-change.test.js` cubre los cambios de calidad y resolución: el lienzo solo se toca al dibujar, las sombras se compilan antes de cambiarlas, lo elegido vale desde el clic y un contexto recuperado vuelve a hornear los mapas. `moon-light.test.js` cubre la luz de la luna a ras del piso. `vehicle-details.test.js` cubre plumillas, espejos, direccionales y carros parqueados apagados; `vehicle-brands.test.js` falla si la flota nombra una marca real o lleva un emblema.

## Gente de la calle

`archetypes.test.js` prueba los arquetipos contra el catálogo real: cada pieza existe para su sexo, ni el código, ni la documentación, ni las guías de piezas nombran una marca, tampoco en plural (los nombres van cifrados en la prueba, y la estación de servicio de `GasStation.js` es la única excepción, escrita con su archivo), las texturas del juego son las limpias por su sha256, los repartos por zona, la forma de `tonos` y su ausencia, las tallas, y que nadie pida una postura con la mano ocupada. `street-props.test.js` cubre los accesorios: una sola malla, geometría y material compartidos, y que liberar a una persona no destruya lo que los demás siguen usando. `street-look.test.js` cubre el aspecto: nadie viste un tono parecido a su piel, ningún cuerpo joven lleva prendas que descubran, medido con la malla real, el tono del zapato, el pelo según la piel, las pieles oscuras, el tamaño de costal y bolsa, su balanceo, y qué lleva el modelo liviano. `gait-families.test.js` comprueba además que la pierna que pisa se estire sin mover los pies. `audio-stride.test.js` fija la distancia entre pisadas. `street-conduct.test.js` cubre las conductas de `Npc`: paradas, nunca parado en un cruce, fijos que se levantan, huyen o pelean y vuelven a su sitio, parejas, vendedores, mirar, nariz, paraguas y el modelo lejano que toma una postura una sola vez. `fixed-people.test.js` arma la ciudad real y comprueba que sigan siendo 88 personas, con entre 15 y 20 fijos, sin ninguno en un cruce, en la calzada, a menos de 1,7 m de un carril, dentro de un muro, encima de un lugar del juego o tapando un paso, y que todos puedan volver.

`fright-conduct.test.js` cubre lo que hace una persona cuando la asustan: salir del cruce aunque el jugador siga al lado y esperar de pie en el andén, esperar a un paso si le ocupan el sitio, pararse antes de andar, encajar un golpe abajo sin moverse ni responder, quitarse del camino de una patrulla, correr con el paraguas, soltar bastón y paraguas junto al cuerpo con cualquier empuje, sin subir solos y sin materiales nuevos, caer con un muro o un andén que se acaba detrás, dejar de rebotar en un rincón, cambiar de modelo a media subida, y los umbrales del modelo completo. También los gestos del jugador con un arma, encogerse bajo techo, el robo a quien está en el piso, el conductor bravo noqueado y que ningún peatón actualice matrices de mundo en su cuadro. `fright-city.test.js` arma la ciudad real: los fijos huyen por la red, no entran en nada sólido y vuelven desde ocho direcciones, ningún tramo de andén atraviesa un sólido, nadie queda en una isla y el sitio de espera queda lejos de los carriles. `fright-body.test.js` usa el cuerpo real: tiempo de pararse de afán, el golpe abajo sin salto de cadera, la caída desde el piso sin que la cadera suba, el camino de caer y pararse sin saltos, con la mano y la rodilla en el piso y el tronco de último, en los dos modelos, el agarre del bastón al correr, la altura de rodilla, tobillo y punta del pie en todo el camino de todos los planes con los seis cuerpos, y la mano en el piso cuando va a recoger lo caído. En `fright-conduct.test.js`, además: caer sin atravesar bancas, bolardos, zorras ni carros, un sardinel detrás, el empuje que se queda antes, el paraguas cerrado hasta tener el brazo arriba y en la mano al cambiar de modelo, la varilla del conductor en el piso, y huir sin entrar al agua. `fixed-people.test.js` mira que en la ciudad real todo eso esté anotado y que los objetos grandes se hayan medido antes de fundirse. `tests/e2e/shoe-sole.spec.js` mide la planta en la imagen, cuadro contra cuadro con y sin el oscurecido, en las dos calidades; `tests/e2e/ko-body.spec.js` comprueba que noqueado el grupo no gire en ninguno de los dos modelos.

## Mezcla de audio

`audio-mix-integration.test.js` recorre el grafo de Web Audio del golpe seco: fuente, filtro, ganancia local, canal Efectos y maestro. Comprueba Efectos en cero, silencio maestro, pausa de una reproducción ya iniciada y cambio de mezcla durante pausa. El golpe usa `_fx()` igual que las salpicaduras y otros efectos; la prueba comparte el contexto simulado de audio y no confirma la calidad audible en parlantes. Las suites de audio existentes conservan sus comprobaciones de tráfico, voces, consumo y efectos de sustancias.

Los informes y archivos de fallos se escriben en `playwright-report/` y `test-results/`, excluidos de Git. El informe HTML no se abre automáticamente al terminar. Para comprobar únicamente el descubrimiento de los escenarios, sin iniciar Chromium:

```sh
node node_modules/@playwright/test/cli.js test --list
```

La ejecución con renderizado por software sirve para verificar flujos; sus FPS no representan el rendimiento de una GPU real.

## Identidad de la interfaz

`letra.test.js` comprueba que el manifiesto diga lo que trae la letra, que todo carácter de un texto del juego exista en ella o en la tabla de dibujos, las cifras de ancho fijo, el peso y que el programa dé lo que está guardado y repita los mismos bytes. `pictos.test.js` comprueba la tabla de dibujos y el paso de los textos. `materiales.test.js` comprueba los seis colores, el contraste, las marcas, el foco único, los 44 px, el movimiento reducido, que nada parpadee, el orden de las hojas y la lluvia.

`tests/momentos.test.js` y `tests/e2e/momentos.spec.js` comprueban los momentos grandes: primera plana impresa, muertes sin grito, recorte de la limpieza social de punta a punta con el juego real, TE CASCARON, CERRADO, voces sin filtro en el lienzo y el consejo al anochecer siguiente. `npm run imprenta` regenera la letra de imprenta, y la prueba comprueba que dé lo mismo.

`tests/hud-estados.test.js` y `tests/e2e/hud.spec.js` comprueban el HUD: estados de búsqueda, retazo, avisos y, en los cinco anchos con el juego real, que ninguna letra quede sobre el relleno y que los avisos no entren en la zona del personaje.

`tests/celular.test.js` comprueba sin navegador la forma de la hora, la distancia y el porcentaje, el orden de las necesidades, el mismo cierre en todos los menús, los textos de todos los objetos con el dedo y con mando, y los acordes de LB. `tests/e2e/celular.spec.js` recorre el juego con dedos a doce tamaños: que nada pase por debajo de la hoja «Más», el costal con 34 objetos y casi lleno, poco alto, el pulgar en la palanca con otro dedo en los menús, soltar afuera y la interrupción, la isométrica, Brincar tras la barra, el pellizco del mapa, morir, caer preso, dormir, armar, comprar y vender; con ratón, los botones del HUD y Tab dentro de la mesa y las mañas; y con un mando simulado, Fabricar y las casillas.

`tests/tactil.test.js` comprueba los controles táctiles sin navegador: palanca, activación, teclas inyectadas, «Más», textos sin teclas y la hoja. `tests/e2e/tactil.spec.js` los recorre con toques emulados en Chromium: dos dedos a la vez, sostener, tocar con otro dedo, volver de la pausa, y que con ratón y teclado no aparezca nada. Es emulación: no reemplaza probar en un teléfono.

`PLAYWRIGHT_GPU=1 npm run test:e2e:headed -- tests/e2e/identity.spec.js tests/e2e/game.spec.js tests/e2e/upgrade.spec.js` verifica la interfaz BAZUKO con la GPU local: distribución de controles y dinero, inventario con objetos, accesos rápidos, creador, pestañas, mapa/GPS y modo foto. La prueba de identidad incluye escritorio, móvil estrecho y orientación horizontal; los controles deben caber y poder pulsarse sin solaparse. Ver `docs/identidad-visual.md` para paleta y responsabilidades de cada hoja de estilos.
