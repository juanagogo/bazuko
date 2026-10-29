# Modelos incorporados en pruebas-integracion

Se incorporan estos nueve archivos del fork [mreyeswilson/bazuko](https://github.com/mreyeswilson/bazuko), commit `dd3656fb3c6ccf68d7760987e4d9263ff72cd566`:

| Archivo | Uso | SHA del blob de origen |
| --- | --- | --- |
| `car1.opt.glb` | Carros particulares y estacionados | `467e3027904088ea991ccb86044d41b74d731225` |
| `car2.opt.glb` | Taxis | `4780b2a8ea6e2f08beb981bee824cb87c8863d62` |
| `tm.opt.glb` | Bus de la troncal Caracas | `d476d59db1e384937c266aecdc7a9ff7070ebc01` |
| `cambuche.opt.glb` | Refugio del jugador | `5c7b4f63d94a46e3d84d59c3bee5ac2d12f130af` |
| `bolsa.opt.glb` | Bolsas de basura recogibles | `c28ae6b1d36ce68e3019da5c32c86eec58d3c685` |
| `contenedor.opt.glb` | Doce canecas permanentes | `c397c0493335eccdb02f23993f2d7bb71fa7d576` |
| `estacion.opt.glb` | Estación de la Caracas | `a7377b9ea950bcddad525767f78f51e516765fa8` |
| `semaforo.opt.glb` | Semáforos instanciados | `ce667cb18b60d88806ff94ca235492d281afc211` |
| `lamparas.opt.glb` | Lámparas sobre los andenes | `69c565a575235631215903d9d489524559801f1f` |

Los GLB conservan sus texturas originales. Seis de ellos tienen la geometría reducida con Blender mediante `tools/modelos/optimizar_glb.py`, que parte siempre del archivo del commit en que se incorporó:

| Archivo | Triángulos | Tamaño |
| --- | --- | --- |
| `car1.opt.glb` | 11.923 → 5.887 | 735 → 513 KiB |
| `car2.opt.glb` | 9.529 → 4.730 | 776 → 599 KiB |
| `contenedor.opt.glb` | 18.640 → 6.524 | 1.084 → 593 KiB |
| `bolsa.opt.glb` | 7.973 → 2.375 | 334 → 131 KiB |
| `cambuche.opt.glb` | 44.058 → 22.029 | 2.366 → 1.472 KiB |
| `semaforo.opt.glb` | 3.544 → 2.302 | 320 → 205 KiB |

Canecas y cambuche se reducen sin soldar las costuras UV para que la textura no se desplace; carros, bolsa y semáforo se sueldan antes para no abrir grietas. El 4 % inferior de cada modelo no se reduce, de modo que el centro del poste que calculan `fitImportedModel` y los semáforos no cambia, y las dimensiones se mantienen. El semáforo ya no incluye los mapas normal y de rugosidad que su material descarta; los lentes se siguen detectando por el color base. El bus y las lámparas se dejan intactos: el fuelle del bus se abre al reducirlo. Para regenerarlos: `blender -b --factory-startup --python tools/modelos/optimizar_glb.py`.

`perro.glb` (El Chato) no es importado: lo genera `tools/modelos/generar_perro.py` en Blender con un modificador Skin sobre un esqueleto de aristas, una subdivisión y pesos por distancia a 21 huesos. Tiene 1.684 triángulos, colores de vértice como tonos relativos del pelaje y ningún clip: `src/entities/Dog.js` mueve sus huesos con marchas de paso, trote y galope, y posturas de sentarse, echarse y dormir. Para regenerarlo: `blender -b --factory-startup --python tools/modelos/generar_perro.py`.

Se adaptan escala y orientación en tiempo de carga. Los carros siguen apuntando a +X local y el bus a −Z local; sus dimensiones se ajustan a las rutas existentes. El cargador comparte geometrías y texturas entre instancias. El bus tiene materiales independientes para que su desvanecimiento no cambie otras instancias.

Los modelos de vehículos contienen las ruedas y carrocería en una misma malla; las ruedas de estos GLB no giran por separado. La circulación, las paradas y el frenado siguen a cargo de los sistemas de esta versión.

El cambuche también es una sola malla con mobiliario integrado. Se muestra al construir base y techo; antes solo se ven las piezas ya construidas y el anillo que señala el lugar. Los beneficios de las mejoras siguen dependiendo de lo construido, aunque el GLB incluya esos detalles visualmente. El fogón y la vela se muestran según lo construido. El refugio se ubica en X=112.98, Z=94.64. El inicio y la reaparición quedan delante, en X=112.98, Z=97.84, para evitar aparecer dentro del modelo. Los refugios decorativos de los NPC conservan su aspecto.

Los modelos se cargan durante la pantalla de carga, antes de calcular los límites usados para el descarte de objetos fuera de cámara y preparar los shaders.

Cada entrada al juego comienza delante del cambuche, también al cargar una partida guardada. El inventario, las construcciones y los demás datos se restauran. Antes de construir la base, unos cartones dentro del anillo señalan el lugar de construcción; al armar la base, esos cartones se sustituyen por ella.

También se adapta el panel de `src/ui/InventoryUI.js`, sus estilos y la colocación de luces de `src/entities/Semaforos.js` del mismo commit de origen. El inventario usa los efectos y objetos de esta versión, mantiene el límite de peso y conserva objetos de partidas antiguas aunque necesite más de veinte casillas. La barra rápida se guarda con la partida. El mundo se pausa mientras el panel está abierto.

La troncal tiene pavimento rojo y texto amarillo «SOLO BUS». Los semáforos comparten un ciclo de 36 segundos: cada eje tiene catorce segundos de verde, tres de amarillo y uno de despeje. Carros y bus frenan antes del cruce; los que ya están dentro lo despejan. Los lentes pintados del propio GLB se oscurecen o emiten luz mediante el material, según el eje de cada instancia: conservan su posición bajo las viseras, sin discos separados ni luces puntuales adicionales. Las lámparas usan el pool existente de iluminación cercana. Las canecas se buscan como las bolsas, permanecen visibles al vaciarse y se reponen cada 120 segundos; la reserva garantizada del cambuche sigue en las bolsas.

Los 24 carros pueden combinar noventa recorridos transitables. Su velocidad de crucero varía entre 10 y 14 m/s (duplicada solo para los carros; el bus mantiene 5 m/s), con aceleración progresiva y frenado anticipado antes de obstáculos y giros. Cada uno elige cambios con intervalos propios; se incorpora a otra ruta únicamente cuando coincide su posición y sentido sobre un tramo recto compartido. Evita repetir los últimos tres recorridos y mantiene la posición al cambiar. El frenado detecta carros de otros recorridos y al TransMilenio; el bus también frena ante carros que todavía estén cruzando la troncal. El bus conserva su servicio y parada de estación.

La señalización cubre los veinte cruces de la ciudad ampliada, con cuatro accesos señalizados por cruce. Con verde, los carros pueden cruzar simultáneamente por trayectorias compatibles y seguir al líder del mismo carril. Los giros que se cortan se resuelven por orden de llegada; quien ya entró conserva el paso hasta que sale toda su carrocería y mantiene su recorrido durante la maniobra. El TransMilenio comparte el cruce con los carriles paralelos y espera cuando una trayectoria atraviesa su carril. La comprobación incluye toda la longitud del bus orientada sobre la troncal. Los conductores tienen pequeñas diferencias de aceleración, frenado y reacción; anticipan los giros, usan curvas de 3,2 metros de radio y cambian la aceleración progresivamente. La simulación de diez minutos comprueba que los 24 carros siguen circulando sin bloqueos permanentes.

Los nueve audios convertidos a Opus por el usuario se integran desde `public/audio`: ambiente urbano, pasos, dos motores para carros, dos para el bus y tres claxones. `VehicleAudio` comparte los buffers de Howler y asigna identificadores de reproducción independientes por vehículo. Mezcla ralentí y marcha según la velocidad, con pequeñas variaciones de tono y posición inicial del bucle. Todos los sonidos se reproducen normalmente, sin posición ni panner; la distancia solo ajusta el volumen. Se conservan las instancias y la activación de claxon por vehículo. Las pitadas usan segmentos cortos de las grabaciones, con paciencia y enfriamiento individuales. Los archivos de claxon actuales son car_horn_sound1.opus, car_horn_sound.opus y car_horn_sound_v3.opus. Las rutas se actualizan tras el cambio de nombres. Los fallos de carga registran la ruta exacta en consola y en AudioSystem.loadErrors, evitando fallos silenciosos.

El audio espacial con panner sigue desactivado. La prueba con Howler real comprueba que motores y claxones no crean panners y conectan su fuente directamente a la ganancia y a la salida. La selección de hasta seis vehículos audibles conserva el presupuesto de audio; su volumen baja con la distancia (motores de 6 a 40 metros, 55 el bus; claxon hasta 30) y no cambia con la cámara. Un límite global de dos claxones simultáneos evita coros de pitos.

Los carros distinguen la distancia de frenado ante el jugador del límite de avance ante otros obstáculos. La presencia del jugador ya no recorta instantáneamente el desplazamiento: si la frenada no alcanza, se detecta el contacto mediante muestras del volumen recorrido de la carrocería, también al girar. El impacto aplica daño según la velocidad y activa un ragdoll de once cajas y diez articulaciones, con protección contra daño repetido por fotograma. La simulación Cannon solo funciona durante la caída y mueve el esqueleto del modelo, tanto procedural como importado. Después, el conductor termina de frenar y espera dos segundos antes de continuar. El personaje sale despedido hacia arriba y hacia delante, choca con el suelo, paredes y vehículos cercanos, y se levanta si sobrevive. Una muerte por atropello espera a que termine la caída antes de mostrar la recuperación y restaura el esqueleto al volver al cambuche. Cada vehículo usa una caja invisible reutilizable para bloquear al jugador; la simulación del ragdoll considera como máximo cuarenta obstáculos cercanos y no usa mallas de triángulos. El tráfico también frena ante carros estacionados.
