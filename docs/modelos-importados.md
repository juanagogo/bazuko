# Modelos incorporados en pruebas-integracion

Se incorporan estos nueve archivos del fork [mreyeswilson/bazuko](https://github.com/mreyeswilson/bazuko), commit `dd3656fb3c6ccf68d7760987e4d9263ff72cd566`:

| Archivo | Uso | SHA del blob de origen |
| --- | --- | --- |
| `car1.opt.glb` | Recurso original; los carros particulares y estacionados del juego se hacen por código | `467e3027904088ea991ccb86044d41b74d731225` |
| `car2.opt.glb` | Recurso original; los taxis del juego se hacen por código | `4780b2a8ea6e2f08beb981bee824cb87c8863d62` |
| `tm.opt.glb` | Recurso original; el bus de la troncal Caracas se hace por código | `d476d59db1e384937c266aecdc7a9ff7070ebc01` |
| `cambuche.opt.glb` | Refugio del jugador | `5c7b4f63d94a46e3d84d59c3bee5ac2d12f130af` |
| `bolsa.opt.glb` | Bolsas de basura recogibles | `c28ae6b1d36ce68e3019da5c32c86eec58d3c685` |
| `contenedor.opt.glb` | Doce canecas permanentes | `c397c0493335eccdb02f23993f2d7bb71fa7d576` |
| `estacion.opt.glb` | Recurso original; la estación del juego se hace por código | `a7377b9ea950bcddad525767f78f51e516765fa8` |
| `semaforo.opt.glb` | Recurso original; el semáforo del juego se hace por código | `ce667cb18b60d88806ff94ca235492d281afc211` |
| `lamparas.opt.glb` | Recurso original; el poste de alumbrado del juego se hace por código | `69c565a575235631215903d9d489524559801f1f` |

Los GLB conservan sus texturas originales. Seis de ellos tienen la geometría reducida con Blender mediante `tools/modelos/optimizar_glb.py`, que parte siempre del archivo del commit en que se incorporó:

| Archivo | Triángulos | Tamaño |
| --- | --- | --- |
| `car1.opt.glb` | 11.923 → 5.887 | 735 → 513 KiB |
| `car2.opt.glb` | 9.529 → 4.730 | 776 → 599 KiB |
| `contenedor.opt.glb` | 18.640 → 6.524 | 1.084 → 593 KiB |
| `bolsa.opt.glb` | 7.973 → 2.375 | 334 → 131 KiB |
| `cambuche.opt.glb` | 44.058 → 22.029 | 2.366 → 1.472 KiB |
| `semaforo.opt.glb` | 3.544 → 2.302 | 320 → 205 KiB |

Canecas y cambuche se reducen sin soldar las costuras UV para que la textura no se desplace; carros, bolsa y semáforo se sueldan antes para no abrir grietas. El 4 % inferior de cada modelo no se reduce, de modo que el centro del poste que calculan `fitImportedModel` y los semáforos no cambia, y las dimensiones se mantienen. El semáforo no incluye mapas normal ni de rugosidad. El bus y las lámparas se dejan intactos: el fuelle del bus se abre al reducirlo. Para regenerarlos: `blender -b --factory-startup --python tools/modelos/optimizar_glb.py`.

`perro.glb` (El Chato) no es importado: lo genera `tools/modelos/generar_perro.py` en Blender con un modificador Skin sobre un esqueleto de aristas, una subdivisión y pesos por distancia a 21 huesos. Tiene 1.684 triángulos, colores de vértice como tonos relativos del pelaje y ningún clip: `src/entities/Dog.js` mueve sus huesos con marchas de paso, trote y galope, y posturas de sentarse, echarse y dormir. Para regenerarlo: `blender -b --factory-startup --python tools/modelos/generar_perro.py`.

Se adaptan escala y orientación en tiempo de carga. Los carros siguen apuntando a +X local y el bus a −Z local; sus dimensiones se ajustan a las rutas existentes. El cargador comparte geometrías y texturas entre instancias. El bus tiene materiales independientes para que su desvanecimiento no cambie otras instancias.

Los modelos de vehículos contienen las ruedas y carrocería en una misma malla; las ruedas de estos GLB no giran por separado. Sus archivos y créditos se conservan como recursos originales. La flota animada actual usa carrocerías con piezas separadas que sobreviven a la precarga, descritas en [Vehículos de Bogotá](vehiculos-bogota.md). La circulación, las paradas y el frenado siguen a cargo de los sistemas del juego.

El cambuche también es una sola malla con mobiliario integrado. Se muestra al construir base y techo; antes solo se ven las piezas ya construidas y el anillo que señala el lugar. Los beneficios de las mejoras siguen dependiendo de lo construido, aunque el GLB incluya esos detalles visualmente. El fogón y la vela se muestran según lo construido. El refugio se ubica en X=112.98, Z=94.64. El inicio y la reaparición quedan delante, en X=112.98, Z=97.84, para evitar aparecer dentro del modelo. Los refugios decorativos de los NPC conservan su aspecto.

Los modelos se cargan durante la pantalla de carga, antes de calcular los límites usados para el descarte de objetos fuera de cámara y preparar los shaders.

Cada entrada al juego comienza delante del cambuche, también al cargar una partida guardada. El inventario, las construcciones y los demás datos se restauran. Antes de construir la base, unos cartones dentro del anillo señalan el lugar de construcción; al armar la base, esos cartones se sustituyen por ella.

También se adapta el panel de `src/ui/InventoryUI.js`, sus estilos y la colocación de luces de `src/entities/Semaforos.js` del mismo commit de origen. El inventario usa los efectos y objetos de esta versión, mantiene el límite de peso y conserva objetos de partidas antiguas aunque necesite más de veinte casillas. La barra rápida se guarda con la partida. El mundo se pausa mientras el panel está abierto.

La troncal tiene pavimento rojo y texto amarillo «SOLO BUS». Los semáforos comparten un ciclo de 36 segundos: cada eje tiene catorce segundos de verde, tres de amarillo y uno de despeje. Carros y bus frenan antes del cruce; los que ya están dentro lo despejan. Las lentes se oscurecen o emiten luz mediante el material, según el eje de cada instancia, sin discos separados ni luces puntuales adicionales. Los postes de alumbrado usan el pool existente de iluminación cercana. Las canecas se buscan como las bolsas, permanecen visibles al vaciarse y se reponen cada 120 segundos; la reserva garantizada del cambuche sigue en las bolsas.

Los carros pueden combinar 79 recorridos transitables, en dos redes que no se cruzan (centro y oriente). Su velocidad de crucero varía entre 10 y 14 m/s (duplicada solo para los carros; el bus mantiene 5 m/s), con aceleración progresiva y frenado anticipado antes de obstáculos y giros. Cada uno elige cambios con intervalos propios; se incorpora a otra ruta únicamente cuando coincide su posición y sentido sobre un tramo recto compartido. Evita repetir los últimos tres recorridos y mantiene la posición al cambiar. El frenado detecta carros de otros recorridos y al TransMilenio; el bus también frena ante carros que todavía estén cruzando la troncal. El bus conserva su servicio y parada de estación.

La señalización cubre los veinticuatro cruces de la ciudad ampliada, con cuatro accesos señalizados por cruce. El carril de la X 66 que sube hacia la Calle 8 tiene además un poste propio al otro lado del cruce (`laneSignal`), porque el suyo cae en plena calzada a sesenta metros y en su esquina está la torre Colpatria. Con verde, los carros pueden cruzar simultáneamente por trayectorias compatibles y seguir al líder del mismo carril. Los giros que se cortan se resuelven por orden de llegada; quien ya entró conserva el paso hasta que sale toda su carrocería y mantiene su recorrido durante la maniobra, pero solo reserva lo que le falta por cruzar: quien espera un rojo más adelante no le quita el verde a los que pasan detrás de él. Los dos cruces que el desvío ensancha hasta la carrera vecina le dejan a ella lo que cae en su calzada. El TransMilenio comparte el cruce con los carriles paralelos y espera en la línea cuando una trayectoria atraviesa su carril; si ya tiene el frente dentro, lo despeja como los carros, porque parado ahí le cerraría el paso a quien cruza. La comprobación incluye toda la longitud del bus orientada sobre la troncal. Los conductores tienen pequeñas diferencias de aceleración, frenado y reacción; anticipan los giros, usan curvas de 3,2 metros de radio y cambian la aceleración progresivamente. Los carros parqueados se apartan del andén solo lo que deja pasar a la buseta por el carril (`src/world/bogota/parkedCars.js`): los más anchos pisan hasta 20 cm de sardinel, como se parquea en Bogotá, y las esquinas donde un carril dobla quedan sin puestos. La prueba larga monta el tráfico como una partida, con la ciudad completa, una sola flota y dos patrullas, los parqueados en su sitio, todos los NPC y el perro como peatones y los buses con sus semáforos: una medición sin parqueados ni peatones no vio los atascos reales. Corre cinco semillas de cinco minutos y falla si un vehículo pasa más de 200 segundos parado. En 48 semillas de diez minutos, cada una en un proceso nuevo y con ese mismo montaje, el peor tiempo fue de 109 segundos, tres ciclos de semáforo en el cruce ancho del desvío, y ningún vehículo quedó atascado.

Los nueve audios convertidos a Opus por el usuario se integran desde `public/audio`: ambiente urbano, pasos, dos motores para carros, dos para el bus y tres claxones. `VehicleAudio` comparte los buffers de Howler y asigna identificadores de reproducción independientes por vehículo. Mezcla ralentí y marcha según la velocidad, con pequeñas variaciones de tono y posición inicial del bucle. Todos los sonidos se reproducen normalmente, sin posición ni panner; la distancia solo ajusta el volumen. Se conservan las instancias y la activación de claxon por vehículo. Las pitadas usan segmentos cortos de las grabaciones, con paciencia y enfriamiento individuales. Los archivos de claxon actuales son car_horn_sound1.opus, car_horn_sound.opus y car_horn_sound_v3.opus. Las rutas se actualizan tras el cambio de nombres. Los fallos de carga registran la ruta exacta en consola y en AudioSystem.loadErrors, evitando fallos silenciosos.

El audio espacial con panner sigue desactivado. La prueba con Howler real comprueba que motores y claxones no crean panners y conectan su fuente directamente a la ganancia y a la salida. La selección de hasta seis vehículos audibles conserva el presupuesto de audio; su volumen baja con la distancia (motores de 6 a 40 metros, 55 el bus; claxon hasta 30) y no cambia con la cámara. Un límite global de dos claxones simultáneos evita coros de pitos.

Los carros distinguen la distancia de frenado ante el jugador del límite de avance ante otros obstáculos. La presencia del jugador ya no recorta instantáneamente el desplazamiento: si la frenada no alcanza, se detecta el contacto mediante muestras del volumen recorrido de la carrocería, también al girar. El impacto aplica daño según la velocidad y activa un ragdoll de once cajas y diez articulaciones, con protección contra daño repetido por fotograma. La simulación Cannon solo funciona durante la caída y mueve el esqueleto del modelo, tanto procedural como importado. Después, el conductor termina de frenar y espera dos segundos antes de continuar. El personaje sale despedido hacia arriba y hacia delante, choca con el suelo, paredes y vehículos cercanos, y se levanta si sobrevive. Una muerte por atropello espera a que termine la caída antes de mostrar la recuperación y restaura el esqueleto al volver al cambuche. Cada vehículo usa una caja invisible reutilizable para bloquear al jugador; la simulación del ragdoll considera como máximo cuarenta obstáculos cercanos y no usa mallas de triángulos. El tráfico también frena ante carros estacionados.

## Bus articulado por piezas

El bus de la troncal se genera por código (`src/world/bogota/BusBody.js`): dos secciones, un fuelle con tres huesos y seis ruedas, con las medidas de `bus.json`; `src/world/bogota/ArticulatedBusRig.js` las ensambla y [TransMilenio](transmilenio.md) lo describe. Las piezas GLB de esa carpeta ya no se cargan. Cada sección sigue el eje del carril por separado, así que el bus se dobla en las curvas y en las rampas del viaducto; el fuelle se deforma entre ellas y las ruedas ruedan (las del primer eje viran). El letrero LED del frente alterna la ruta y el destino con una textura de puntos. Mide 22,1 × 2,72 m (`ARTICULATED_BUS_SIZE`). `tm.opt.glb` ya no se carga. El bus no contiene geometría ni texturas de modelos de terceros, y el nombre «TransMilenio» es marca de su titular, usada solo como ambientación.

## Semáforos y mobiliario de la calle

`semaforo.opt.glb` y `lamparas.opt.glb` ya no se descargan al jugar; quedan en el repositorio con sus créditos, como los otros recursos originales. El semáforo y el poste de alumbrado salen de `src/world/bogota/SignalModel.js` y `src/world/bogota/StreetLampModel.js`, con geometría compartida, una textura pequeña generada sin canvas y el mismo descarte por sectores.

**Semáforo.** Poste galvanizado de base ancha sobre un dado de concreto, con zócalo pintado, franja amarilla, óxido y calcomanías que cambian de un poste a otro. La ménsula con tirante lleva la cabeza principal sobre el carril, a 5,45 m y por debajo del viaducto, con contraplaca negra y borde amarillo retrorreflectivo. Una cabeza baja, a 3,2 m, queda a la vista de quien espera en la línea. Cada poste trae dos peatonales con figura roja de pie y verde caminando, una por cada cebra que llega a la esquina, con su pulsador, y una caja de control.

La luz que se ve es la que obedece el tráfico: quien frena tiene rojo en la cabeza que lo mira. El peatón solo camina mientras los carros de esa cebra están detenidos. Las fases siguen el reloj de la ciudad, así que al pausar el juego no cambian.

Cada lente encendida tiene matriz de diodos de cerca y centro más claro. El resplandor es discreto de día y se ve desde lejos de noche; con el piso mojado, las cabezas que cuelgan sobre el carril dejan su reflejo en el asfalto. Nada de esto agrega luces a la escena.

Los cuatro postes del desvío de la troncal que caen en plena calzada (`x = 125,5`, `z = 142,5`, `155,5`, `186,5` y `199,5`) siguen regulando su acceso, pero no se dibujan: un poste en mitad de un carril se veía como un error.

**Poste de alumbrado.** Concreto gris ahusado de 6,55 m, con pie de mortero, chorreones y rótulo de inventario, y un brazo galvanizado que siempre sale hacia la calzada vecina. Ningún poste queda pegado a un semáforo ni a otro farol. La luminaria tiene cuerpo bajo, fotocelda y lente plana. Según su posición, cada poste luce distintos carteles arrancados y la mitad lleva una caja de fibra con su cable. De noche se enciende toda la ciudad a la vez: tres de cada cuatro en tono de sodio y el resto en tono de LED, con resplandor y reflejo en el piso mojado. La luz que ilumina sigue siendo una por poste, administrada por el pool de iluminación cercana; subió a la altura de la luminaria y se ajustó para que el piso reciba lo mismo que antes.

**Placas de esquina.** Banderas azules con filete blanco que salen del poste, paralelas a la vía que nombran y alejándose de la esquina donde está el semáforo. Se leen bien por las dos caras y el poste no tapa las letras. Todos los nombres viven en un solo lienzo, con un solo material, en lugar de una textura por placa.

**Bancas.** Listones de madera con luz entre ellos, respaldo reclinado y marcos de metal con costilla central. Conservan su clave de lote: se fusionan por sector y siguen reservando su lugar frente al arbolado.
