# Contexto de desarrollo de Vagabundo

## Alcance de esta guía

Este archivo es una referencia flexible para entender el proyecto, no una camisa de fuerza ni un conjunto de reglas que deban seguirse al pie de la letra. Aplicar criterio según la tarea y adaptar sus recomendaciones cuando exista una solución más adecuada. Las indicaciones explícitas de quien solicita el trabajo tienen prioridad sobre esta guía. Si el código o las necesidades del proyecto cambian, actualizar el contexto en lugar de conservar instrucciones obsoletas.

## Proyecto y documentación

Juego de supervivencia urbana en navegador, ambientado en el centro de Bogotá. Usa JavaScript con módulos ES, Three.js, Vite, Howler y cannon-es. No requiere servidor de aplicación: el guardado reside en el almacenamiento local del navegador.

- `README.md`: funciones, controles, capturas y ejecución.
- `docs/modelos-importados.md`: procedencia y adaptación de los recursos.
- `docs/integracion-cristian.md`: integración de radar, pausa, clima y compañero.
- `docs/testing.md`: pruebas unitarias y de navegador.
- `src/ui/DeveloperNote.js`: créditos y nota de colaboración al iniciar.

Mantener los créditos de las contribuciones y explicar los cambios por su comportamiento dentro del juego. La documentación debe centrarse en el proyecto y sus colaboradores, sin atribuciones a herramientas de escritura ni datos del entorno personal.

## Comandos

Requiere Node.js 22.12 o posterior, npm, Git y Git LFS.

```sh
git lfs pull
npm ci
npm run dev
npm test
npm run build
```

Los cinco efectos WAV pequeños usan Git LFS; motores, ambiente, pasos, alarmas y voces están en Opus o MP3. Respetar los nombres exactos y codificar las rutas con espacios. El código nunca debe cargar punteros LFS como si fueran audio.

Para las pruebas de navegador, instalar Chromium con `npx playwright install chromium` y ejecutar `npm run test:e2e`. Su servidor utiliza el puerto 5188. No presentar el descubrimiento de escenarios como una ejecución completa. Una validación de compilación o de lógica tampoco confirma calidad visual, sonido audible ni FPS del equipo.

## Puntos de entrada

- `src/main.js`: carga inicial y nota del desarrollador.
- `src/core/game.js`: simulación, integración de sistemas, entidades, guardado y recuperación.
- `src/world/districts/Bogota.js`: ciudad, parques, peatones, semáforos y bus.
- `src/world/bogota/CityLayout.js` y `StreetLayout.js`: ampliación, calzadas y migración de posiciones.
- `src/systems/TrafficSystem.js`: rutas, prioridades, frenado y atropellos.
- `src/systems/CollisionSystem.js` y `PlayerRagdoll.js`: cajas de vehículos y caída articulada.
- `src/systems/AudioSystem.js` y `VehicleAudio.js`: bancos compartidos, voces y alcance.
- `src/entities/PigeonFlock.js`: bandadas instanciadas y reacción a personas.
- `src/ui/HUD.js`, `InventoryUI.js`, `placeMenus.js`: paneles y acciones del jugador.
- `src/ui/ShelterPreview.js`: imagen del refugio terminado sin alterar la construcción.

## Decisiones que deben conservarse

- La ciudad base mide 240 × 322 metros, con el Parque del Lago al sur desde Z 222 y una extensión de avenida de 74 metros al norte. Usar sus funciones de altura y navegación; no cambiar coordenadas sin considerar partidas guardadas.
- El cambuche está en X 112.98, Z 94.64. El inicio y la recuperación están en X 112.98, Z 97.84. Conservar la construcción progresiva y la reserva renovable de materiales en la basura.
- El juego y la medición de FPS comienzan después de cargar modelos, materiales y GPU. Menús, inventario, creador y pestaña oculta suspenden la simulación correspondiente.
- La muerte requiere recuperación explícita; no teletransportar automáticamente al jugador. Dejar terminar una caída mortal antes de mostrar su pantalla.
- El frenado de los carros es gradual. Mantener las prioridades de los cruces, rutas aleatorias y carril exclusivo del bus. Los vehículos usan cajas simples de colisión, no sus triángulos.
- Motores y claxones usan reproducción normal con voces por vehículo. Los alcances se calculan con volumen, sin panners: alarma hasta 41 metros, frases de obstrucción hasta 8 metros y frases de robo a carros en circulación hasta 12 metros.
- Los carros en circulación permiten robar espejos con E; los estacionados activan alarma. Mantener el enfriamiento entre robos y evitar duplicar voces por fotograma.
- El Chato conserva su amistad al guardar. Come pan o atún; las caricias tienen enfriamiento. Respetar su navegación y las colisiones existentes.
- Hay diez palomas en cada uno de los tres parques. Huyen del jugador o NPC a menos de 3,5 metros. Conservar instancias compartidas, filtro de personas cercanas y suspensión a distancia.
- La ayuda «!» comienza plegada. El botón de cámara indica el modo de destino. Abrir paneles libera el ratón; Escape cierra primero el panel activo.
- La calidad gráfica elegida limita la resolución automática. Mantener el descarte fuera de cámara, la geometría agrupada y los presupuestos de luces y audio.
- Las primeras partidas usan calidad baja; la calidad efectiva puede bajar bajo carga sin cambiar la preferencia guardada. Cámara, sombras, silueta y animación visual usan ese perfil efectivo. Ver `docs/rendimiento.md`.
- Las cajas estáticas usan un índice espacial: al mover una caja existente invalidarlo con `invalidateStaticIndex()`. Las luces añadidas dentro de ramas existentes se registran con `LocalLights.register`; refrescar posiciones tras mover fuentes estáticas.

## Forma de trabajar

Consultar la rama y los cambios locales antes de editar. Los experimentos se realizan en `pruebas-integracion` cuando se solicite; `main` recibe las integraciones indicadas. No asumir que crear un commit o fusionar implica publicar en el remoto.

Para cambios de lógica, ejecutar las pruebas relacionadas y la compilación cuando corresponda. Para documentación, revisar enlaces y recursos locales. Mantener `dist/`, `node_modules/`, `work/` e informes de pruebas fuera de los commits. Actualizar documentación y capturas cuando cambie lo que describen; las capturas deben corresponder a imágenes reales compartidas o tomadas del juego.

## Integración del original del 21 de octubre de 2026

Ver `docs/integracion-upstream.md`. RadioSystem y RadioModal agregan radio con pilas; PoopSystem y PsychosisSystem coordinan proyectiles y abstinencia. Mantener el volumen y silencio generales también en la radio, evitar actualizaciones duplicadas de El Chato y ejecutar la distorsión de cámara después de seguir al jugador. El radar reutiliza sus puntos estáticos y actualiza al perro dentro del caché. La inercia debe reiniciarse al recuperar al jugador de un atropello.

Las animaciones ActionForge se adaptan en `src/character/actionforge.js`; el banco contiene solo ocho clips y el esqueleto. Conservar las prendas modulares y el respaldo de clips anteriores. Preparar clips sobre copias del cuerpo para no alterar la pose de otros personajes. Mantener el movimiento horizontal en el controlador y permitir la altura animada de cadera para agacharse. Ver `docs/animaciones-actionforge.md`.

## Parque, viaducto y edificios

LakePark.js define el parque al sur desde Z 222. El agua no es transitable. ColpatriaViaduct.js construye el único tablero desde Z 15,43 hasta Z 318; BridgeElevation.js comparte la cota de 7,82 metros. La rampa norte llega a esa cota en Z 39 y la sur comienza en Z 280. No generar otro tablero sobre el lago ni separadores planos debajo. Las consultas de movimiento distinguen la calle inferior del puente y respetan los colliders layered.

El puente conserva 14 metros de ancho real en rectas y curvas; la llegada norte mantiene eje X 75 y bordes X 68–82. bridgeCenter define el eje y bridgeNormal su perpendicular. Generar ambos bordes desplazando 7 metros sobre esa normal; no medir el ancho sobre X ni ensanchar secciones según la envolvente del bus. El concreto se extruye verticalmente 6 cm bajo el asfalto, con las mismas UV globales de las calles. viaductSurface debe coincidir con los triángulos dibujados.

Colpatria.js define la torre de 112 metros, planta de 24 × 26 metros y anexo gris de 22 metros. busPathX y southBusPathX recorren desplazamientos perpendiculares de ±3,5 metros respecto al mismo eje; invierten su Z para mantener rutas en coordenadas del mundo. Mantener sincronizadas rutas, reserva del mapa y geometría del puente. Los tiles colpatria y colpatriaAnnex no generan casas encima. La iluminación usa materiales emisivos, sin nuevas luces.

AvenueLandmarks.js define alturas variadas y la pasarela en Z 8. GasStation.js reserva el lote X 145–163, Z 89–117; sus colisiones permiten circular bajo la cubierta. D69Store.js reserva los tiles X 22–26, Z 80–86 con el tipo sólido storeD69, sin generar casas ni objetos encima. Ambos conjuntos se agrupan como geometría estática.

Al iniciar, después de cargar el guardado, fijar las 22:00 sin cambiar el día ni el progreso. Activar llovizna, reiniciar su temporizador y colocar partículas junto al jugador antes del primer render; luego continúan los ciclos normales.

## Estación y buses en ambos sentidos

TransitTerminal.js extiende la avenida al norte: X 54–96, Z −74–0, conservando la ciudad anterior. paintTerminalEntrance abre el borde del mapa sin alterar los carriles de carros existentes. La isla de Portal del Centro mide 4 × 40 metros y está centrada en X 75, Z −30, a 0,92 metros. Sus rampas peatonales de 8 metros usan terminalGroundHeight; no añadir una caja sólida que impida subir. La estructura y el mobiliario sí tienen colliders layered. No cargar el antiguo modelo GLB de estación.

Bogota.busServices contiene ambos buses; busService conserva el primero por compatibilidad. Cada BusService calcula direction desde startZ/endZ, orienta su frente local −Z, adapta el chasis a cinco apoyos y para cuatro segundos en stationZ −30. El carril norte usa X 78,5 y el sur X 71,5 en las rectas. Mantener la precarga, descarte visual, audio, tráfico, colisiones y liberación de recursos para ambos buses. freezeStaticTransforms acepta un Set de raíces dinámicas para no congelarlos.

CollisionSystem mantiene una AABB de referencia y una OBB de dimensiones constantes por bus. El barrido del jugador se resuelve en el espacio local; PlayerRagdoll usa el mismo centro, dimensiones y quaternion. No usar la envolvente diagonal como colisión final. VehicleAudio mantiene voces independientes por instancia. Tráfico y semáforos no bloquean buses elevados por objetos de la calle inferior.

transit-terminal.test.js comprueba acceso a pie, parada y salida en ambos sentidos, carrocerías dentro del tablero y separación al cruzarse en las curvas. Las pruebas de lógica no sustituyen la revisión visual en el juego.

El rodeo de Colpatria usa un eje con transiciones de curvatura suaves entre Z 80 y Z 260. Las barandas, el asfalto y el tablero comparten bordes a distancia perpendicular constante del eje. Los carriles de ambos sentidos siguen ese mismo trazado; el corredor del lago y sus consultas de altura acompañan la curva.

## Ilustraciones de carga

LoadingArtwork.js administra parejas numeradas según loading-artwork.json. Las imágenes WebP optimizadas se guardan en public/images/pantalla-carga; ambos planos deben decodificarse antes de mostrar una pareja. La galería es opcional y nunca bloquea Game.start ni añade espera mínima. Cancelar temporizadores y resultados de cargas anteriores al mostrar el creador o terminar la partida inicial. Conservar el progreso y reintento de LoadingScreen, las rutas relativas a BASE_URL y la preferencia de movimiento reducido.

## Variedad urbana

UrbanBuildings.js planifica sustituciones deterministas sobre tiles building exclusivamente. Conservar el mismo plan al construir las fachadas y las colisiones. Las huellas se incorporan a covered antes de generar casas y relleno; en _buildCollisions se excluyen esos tiles de las cajas genéricas de 8 metros y se añade una caja de altura real por solar. No cambiar el mapa ni ocupar ruinas, calles, parques, edificios especiales o reservas del viaducto. Los cinco diseños usan createBuildingShell y BuildingVisibility, con fachadas repetibles compartidas y sin luces nuevas. Las torres de 30 pisos miden 96 metros, menos que Colpatria.

## Mapa, destino y ruta

CityMap.js dibuja una sola vez la imagen de la ciudad desde `district.map` (2 m por tile) y la estación de inTerminal, y nombra las calles con CITY_CALLES, CITY_CARRERAS y Caracas. La comparten Minimap (gira con la cámara) y WorldMap (tecla K, pausa el juego; registra su tecla antes que Game para cerrar con Escape o K). RouteFinder hace A* sobre esa grilla con isWalkableAt: prefiere andenes, no cruza el asfalto en diagonal y se recalcula si el jugador se aleja más de 6 m de la ruta. Si cambian el trazado o los tipos de tile, actualizar MAP_COLORS y los costos de ruta.
