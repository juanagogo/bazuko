# Tráfico y choques de Slop adaptados a Bogotá

Experimento en `pruebas-slop-newyork`. Referencia directa: [Slop New York](https://github.com/mrdoob/slop-newyork/tree/1b54e165ddc26b3e951d5614d56a88995da1da38), revisión fija `1b54e165ddc26b3e951d5614d56a88995da1da38`, licencia MIT conservada en `THIRD_PARTY_NOTICES.md`.

## Comportamiento

Los carros automáticos usan las ecuaciones IDM del donante: aceleración libre, distancia deseada según velocidad y velocidad relativa, frenado ante el líder y la línea de parada. Parámetros: aceleración 2 m/s², frenado cómodo 3 m/s², intervalo 1,2 s, distancia base 2 m y desaceleración de emergencia limitada a 9 m/s². Las curvas limitan velocidad por radio y aceleración lateral 3,5 m/s²; el límite se anticipa antes de entrar. Se retiraron la demora artificial de reacción y el límite de variación de aceleración que alteraban la respuesta del donante.

Las decisiones de semáforo distinguen entre poder frenar antes de entrar y haber comprometido ya el cruce. Una salida bloqueada impide entrar. El adaptador conserva las reservas de cruces y recorridos bogotanos, con continuaciones compatibles y prioridad entre trayectorias que se cortan. MOBIL comprueba distancia y frenado seguro para líder y seguidor en carriles adyacentes declarados. La red actual no declara carriles paralelos aptos para adelantar: no se inventan adelantamientos sobre andenes o carriles del bus.

## Física y representación

Los contactos usan el SAT orientado y la respuesta del original: separación, impulso, reducción de velocidad, deslizamiento, giro y golpes de suspensión. Los impactos se propagan a otros carros mediante `knockOn`. Después, el tráfico amortigua su impulso y recupera el carril de forma gradual. Las colisiones contra muros producen rebote frontal o deslizamiento lateral. Esta es la física cinemática del donante, sin un nuevo motor de cuerpos rígidos.

`Car` sigue siendo la entidad de posición y estado. El adaptador convierte el frente +Z del donante al +X de BAZUKO. La carrocería y el collider comparten la misma raíz; el balanceo de suspensión afecta solo a la carrocería. Las ruedas cercanas se dibujan por instancias independientes con dirección delantera y giro, sin reasignar sus buffers. Se mantienen luces de frenado, intermitentes y retrovisores robables. Los aros de robo de los carros estacionados también se dibujan en un lote del mismo banco; su visibilidad sigue reflejando robo, enfriamiento y conducción. Los impactos generan chispas en un banco fijo de 120 partículas y sonidos sintetizados de carrocería, metal y fragmentos; respetan volumen general, silencio y pausa.

Los buses tienen mayor resistencia a impactos, conservan su ruta, altura, paradas y sentido. Su desplazamiento lateral se limita y amortigua para mantenerlos sobre los puentes. Los vehículos en niveles distintos no se golpean entre sí. La adaptación conserva las dimensiones y velocidades de Bogotá; no equivale a importar toda la simulación o red de Nueva York.

La conducción manual mantiene F para entrar/salir de estacionados, W/S, A/D, Shift, B y V. Solo se permite salir detenido y con un punto libre; la velocidad residual de un choque también cuenta. Al salir se transfiere el movimiento residual al carro estacionado, sin duplicarlo ni modificar el guardado.

## Validación reproducible

- `tests/slop-collision-physics.test.js`: coeficientes numéricos de impactos frontales y laterales, masa de bus, separación vertical, carambolas, rebote contra muro, IDM y seguridad MOBIL.
- `tests/traffic-collision-world.test.js`: contacto entre entidades reales, desplazamiento y recuperación del carril; ausencia de impulsos entre puente y calle inferior.
- `tests/vehicle-batches.test.js`: raíz compartida, dirección de ruedas delanteras, suspensión, buffers estables y robo/reposición de retrovisores.
- `tests/slop-crash-audio.test.js`: síntesis finita, recursos compartidos, contactos repetidos, silencio, distancia y liberación de voces.
- La suite de tráfico conserva diez minutos simulados de los 24 carros, seguimiento, peatones, semáforos, cruces, curvas y coexistencia con buses. La suite de conducción verifica acceso, marcha atrás, muros, pausa y salida segura.

Con `npm run dev`, abrir `/tools/traffic-physics-validation.html`: escenario acotado en WebGPU que utiliza TrafficSystem, Car, PlayerDriving y los bancos gráficos reales. Los botones provocan un choque frontal, uno lateral y una carambola. Muestra impactos, impulso y giro máximos y comprueba posiciones finitas. No lee ni escribe partidas o preferencias. Es una comprobación funcional de contactos, no un benchmark de FPS ni una revisión completa del tráfico de toda la ciudad.

La prueba frontal del navegador registró contacto a 11,78 m/s, impulso máximo de 6,33 m/s y giro máximo de 0,175 rad con posiciones finitas. Estos valores describen ese escenario; no se usan como promesa de rendimiento. La validación automatizada del sonido no confirma una escucha subjetiva ni sustituye una revisión de toda la partida.

La prueba lateral registró contacto a 11,75 m/s, impulso máximo de 6,612 m/s y giro máximo de 0,225 rad, también con posiciones finitas y sin errores de consola. La recuperación posterior del carril está cubierta por la prueba de integración. [Captura del escenario lateral](images/slop/choque-lateral-webgpu.png).
