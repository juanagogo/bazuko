# Edificios y vegetación de Bogotá

La mejora conserva el trazado y las colisiones del juego original. Se concentra en la arquitectura y el verde urbano, con ladrillo, revoque, rejas, avisos comerciales y vegetación de tonos apagados.

## Fachadas

`BuildingDetails.js` agrupa marcos, alféizares, bajantes y rejas por material y pared. Las fachadas alternan vidrio y cortinas; algunas ventanas cálidas se encienden por la noche mediante materiales emisivos, sin añadir luces. Los detalles siguen la ocultación de paredes y techos en la vista isométrica. El detalle de ventanas se limita a los pisos inferiores; las torres conservan sus huellas y alturas.

Las torres de barrio se visten en `fachadaTorres.js`: una fachada pintada por diseño, con vidrio que devuelve el cielo, cortinas y persianas sueltas, y de noche apartamentos salteados en tres tonos. El edificio de cinco pisos de la avenida (`SmallBuilding.js`) toma sus ventanas del atlas de ventanas de las casas. `TINTE_COSTADO`, en `textures.js`, es el único dueño del tinte del ladrillo de los costados de las casas.

Las semillas locales de las casas evitan que crear más geometrías o materiales cambie sus dimensiones. El plano físico y sus colisiones se conservan; las casas que antes dependían del azar global tienen ahora una apariencia estable por coordenadas.

## Azoteas



El acceso de la torre (`Colpatria.js`) lleva una marquesina de 8 × 0,3 × 1,6 m con el letrero «ACCESO PRINCIPAL» encima, un vestíbulo de vidrio oscuro entre las costillas, que hacen de jambas, y dos puertas con dintel de 2,18 m. El vestíbulo y la planta comercial del anexo leen una muestra escondida en un nervio de los lienzos de la fachada (`fachadaColpatria.js`): de día son vidrio oscuro y de noche dan una luz tibia que baja del cielo raso. Si cambian `FRANJAS` o el ancho de las costillas, la muestra tiene que seguir dentro de un nervio. Los letreros del anexo van en su cara norte, la que da a la calle (la oriental queda pegada a una casa), y los tres letreros reciben la luz de la escena y de noche se prenden tenues con las franjas de la torre.

## Arbolado y jardines

`UrbanTrees.js` construye troncos, ramas y hojas recortadas con tres siluetas inspiradas en urapanes, eucaliptos y arrayanes; son interpretaciones visuales, no modelos botánicos. Cada árbol usa dos mallas y menos de 900 triángulos antes de agrupar. Todos comparten un atlas de hojas de 256 × 256 y una textura de corteza de 64 × 128. El mismo viento mueve las hojas y sus sombras.

`UrbanPlanting.js` planifica hasta 90 árboles con semillas locales, separación y distancia al viaducto. `ParkVegetation.js` añade hasta 320 grupos de pastos, arbustos bajos, flores discretas y juncos sobre césped. Conserva las reservas del cambuche, las bancas, los vendedores, el agua y los paseos. Sus mallas se agrupan por sectores de 32 metros y comparten un material sin texturas nuevas.

La máscara de agua es exclusivamente visual y sigue la elipse del lago existente. Esta contribución conserva el lago plano y sus reglas originales; no incorpora natación ni modifica su física. Las plantas son decoración sin nuevas colisiones. El movimiento se detiene al pausar la simulación.

## Verificación

Ejecutar `npm test` y `npm run build`. Para verificar los escenarios de Chromium con la GPU local: `PLAYWRIGHT_GPU=1 npm run test:e2e:headed`.

Las pruebas específicas cubren determinismo, huellas de edificios, agrupación, luces nocturnas, reservas, viento y liberación de recursos. Recorrer el cambuche, los locales y el parque de día y de noche; comparar cámara normal e isométrica, y comprobar las rampas del viaducto. El detalle añade geometría y llamadas de dibujo: las pruebas locales no garantizan el rendimiento de otros equipos.
