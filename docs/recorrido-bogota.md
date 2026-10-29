# Materiales y barrios del recorrido

La renovación sigue el trayecto cambuche → comercio → Parque del Lago. Conserva el trazado de Bogotá, las reservas de edificios, las alturas físicas, el GPS y las coordenadas de las partidas.

## Dirección

Asfalto gris azulado, concreto tibio, ladrillo tolete, metal pintado y vegetación oliva. Los avisos mantienen los oficios y comercios del centro: panadería, ferretería, compraventa, cigarrería, modistería y fotocopias. Las fachadas tienen desgaste moderado; los rótulos conservan color y legibilidad.

- Cambuche: revoque remendado, tierra y andenes de acabado irregular; ocres y metal envejecido.
- Comercio: paños de fachada más definidos, zócalos grises, persianas y letreros populares. Se conservan los colores azules, rojos, verdes y amarillos de los avisos existentes.
- Lago: pavimento claro, césped oliva y una transición entre grava, lodo húmedo y el lecho. Los paseos y las salidas del agua conservan su geometría.
- Centro: base neutra para enlazar las zonas sin cubrir toda la ciudad con un único acabado.

## Materiales compartidos

`textures.js` genera asfalto, andén, ladrillo, concreto, tierra, césped, tejas, placas y fachadas. Color, relieve y rugosidad se dibujan por separado: un aviso no se convierte en relieve y una mancha no se convierte en un agujero. El color usa sRGB; relieve y rugosidad usan datos lineales. Los materiales repiten en metros y comparten texturas entre edificios.

La humedad suaviza la rugosidad y oscurece ligeramente el suelo sin convertirlo en metal. En baja se conserva una respuesta más discreta a la lluvia. La ribera usa una sola malla, un material PBR y una textura de detalle pequeña, con mezcla por vértices; no modifica el fondo ni la profundidad física.

`NeighborhoodIdentity.js` contiene perfiles y límites en coordenadas del mundo. `UrbanBuildings.js` aplica los perfiles a sus materiales conservando el plan físico y las alturas de los solares.

Las casas genéricas usan ahora semillas locales por coordenadas. Su distribución y sus detalles permanecen estables aunque se creen más materiales. Antes dependían del azar global, por lo que no se reproduce necesariamente la misma fachada de una partida anterior; los tiles y las colisiones físicas sí conservan sus valores.

## Edificios y vegetación

`BuildingDetails.js` añade marcos, alféizares, rejas, bajantes y remates de azotea a las fachadas. El detalle cercano se concentra en los pisos bajos y se agrupa por material y pared; sigue la ocultación de edificios en vista isométrica. Los vidrios, las cortinas y algunas ventanas cálidas varían por edificio; el brillo de estas últimas se activa solo de noche, sin luces adicionales. Los locales conservan sus avisos y persianas. Las casas mantienen los balcones de madera y los tonos de ladrillo y revoque del centro.

`UrbanTrees.js` sustituye las copas poliédricas por ramas y hojas recortadas con tres siluetas inspiradas en urapanes, eucaliptos y arrayanes. Son interpretaciones visuales, no modelos botánicos. Cada árbol usa dos mallas y comparte los materiales y dos texturas pequeñas con los demás; el viento mueve el follaje y su sombra con el mismo uniforme.

`UrbanPlanting.js` distribuye el arbolado con semillas locales, separación y un máximo de 90 árboles. Respeta el césped, las reservas y la distancia entre copas y viaducto. `ParkVegetation.js` añade grupos de pastos, arbustos bajos, flores discretas y juncos en tierra firme junto al lago. Los jardines se agrupan por sectores de 32 metros y comparten un material sin texturas adicionales. Los paseos, el cambuche, las bancas y las salidas del agua quedan libres.

Las plantas son decoración sin colisiones nuevas. El mapa transitable y las partidas guardadas mantienen sus coordenadas; el movimiento de hojas y pastos se detiene al pausar la simulación.

## Sombras de contacto

`ContactShadows.js` añade sombras suaves bajo jugador, peatones, perro y vehículos, también en calidad baja. Se dibujan mediante dos lotes instanciados con un máximo compartido de 128 sombras, sin nuevas luces ni mapas de sombra. En media y alta tienen menos intensidad para complementar las sombras direccionales.

La consulta de suelo conserva la capa de calle o viaducto, se adapta a rampas y atenúa la sombra al saltar. Los actores sumergidos o escondidos no proyectan esta sombra. No sustituye a una sombra solar completa ni a la iluminación indirecta.

## Comprobar el resultado

`npm test`, `npm run build` y `PLAYWRIGHT_GPU=1 npm run test:e2e:headed` comprueban lógica, compilación y recorridos de juego. Las pruebas específicas verifican perfiles, geometría conservada, contratos de texturas, agua y sombras por altura.

`node tools/review-bogota-route.mjs --url http://127.0.0.1:5173/ --output work/recorrido --label revision` genera capturas del cambuche, el comercio, el acceso al lago y la ribera. Incluye día/noche, los tres perfiles en el cambuche y mediciones cortas con el bucle de juego completo. Usa Chromium aislado, resolución fija y registra la GPU. Los resultados de un equipo no garantizan sus FPS en otros dispositivos; la captura por sí sola tampoco sustituye a probar las interacciones.
