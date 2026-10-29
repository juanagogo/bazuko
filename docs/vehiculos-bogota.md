# Vehículos de Bogotá

La flota conserva los recorridos y las dimensiones de circulación del juego. Los detalles se concentran en las carrocerías, las ruedas, la señalización y el movimiento de sus piezas.

## Carros y taxis

Los cuatro perfiles de carrocería distinguen el compacto «zapatico», el «huevito», el familiar clásico y el sedán. Las cabinas tienen parabrisas inclinados, pilares y marcos; las ruedas ocupan pasos abiertos en los costados. El amarillo de los taxis, sus identificaciones, las placas colombianas, las molduras oscuras y los esmaltes de los particulares mantienen la ambientación bogotana.

Las ruedas giran según la distancia recorrida; el eje delantero acompaña las curvas. El cabeceo y la suspensión afectan solo a la carrocería visual. Las direccionales, los stops y los limpiaparabrisas dependen del estado de circulación y del clima. Estas animaciones usan tiempo de simulación y se detienen al pausar.

Los espejos siguen siendo los objetos que se pueden robar. Los carros y taxis del tráfico muestran un conductor sentado dentro de la cabina.

## Buses de la troncal

Los articulados usan las piezas GLB de `public/models/bus-articulado` (dos secciones, fuelle y seis ruedas) armadas en `ArticulatedBusRig.js`. Ambos sentidos conservan su parada de cuatro segundos, la adaptación a las rampas y el desvanecimiento de los extremos.

## Recursos y compatibilidad

Las carrocerías animadas conservan sus piezas durante la precarga. Los GLB anteriores siguen en el repositorio con sus créditos y pruebas de dimensiones; sus ruedas forman parte de una malla indivisible y no sustituyen a la flota animada nueva.

La geometría fija se agrupa por material. Ruedas y limpiaparabrisas permanecen separados para poder animarlos. La liberación de un vehículo conserva los recursos compartidos que usa el resto.

Los carros mantienen una huella de 4,3 × 1,76 metros. Sus animaciones no trasladan la raíz física. Se conservan los carriles, las prioridades, el frenado progresivo, las partidas guardadas y el presupuesto de audio.

## Comprobación

Ejecutar `npm test`, `npm run build` y `PLAYWRIGHT_GPU=1 npm run test:e2e:headed`. Revisar en el juego las curvas, una cola ante un semáforo, las luces de noche, la lluvia y una parada de bus. Comparar cámaras y calidades gráficas, y comprobar que abrir un menú detenga las animaciones.

Las mediciones de rendimiento corresponden al equipo y al recorrido comprobados; no garantizan los FPS de otros dispositivos.
