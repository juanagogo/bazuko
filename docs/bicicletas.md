# Bicicletas públicas

Las estaciones entregan una bicicleta con E y permiten robarla con Q. Antes de montar se busca un espacio libre delante o detrás del rack, sin ocupar otra bicicleta ni una pared. Si no hay sitio, la bicicleta sigue en la estación y aparece un aviso. Las posiciones de los puestos respetan la orientación de la estación.

Alquilar cuesta $1.000, cobrados solo si se completa el montaje. Sin dinero suficiente se conserva la bicicleta en el rack. Devolver esa bicicleta a la estación de origen paga $2.000 por honestidad (ganancia neta de $1.000), una sola vez por alquiler pagado. Devolverla en otra estación cierra el alquiler sin recompensa; una bicicleta robada tampoco recibe ese pago. Desmontar y volver a subir a la bicicleta alquilada no vuelve a cobrar. El origen y el pago del alquiler se conservan al guardar la partida.

Dejar una bicicleta en la calle permite alquilar otra o robar una con Q. Cada alquiler nuevo cobra $1.000 y conserva su propio origen; el anterior sigue pendiente, con la bicicleta en su posición. Robar otra aumenta el nivel de búsqueda, sin cobrar un alquiler ni cancelar el anterior. Solo se conduce una a la vez. Devolver una no borra las marcas de origen que aún correspondan a otros alquileres pendientes.

Al alquilar se marca la estación de origen en el GPS. El mapa y el radar conservan además un punto destacado «Origen del alquiler» con la recompensa, aunque se quite el destino del GPS o se desmonte de la bici. El punto se reconstruye al cargar la partida y vuelve a ser una estación normal al cerrar el alquiler. Se puede pulsar en el mapa para marcar de nuevo la ruta de regreso; el GPS conserva sus rutas peatonales actuales.

W aporta impulso; Mayús aumenta el esfuerzo y la velocidad máxima. Soltar W permite rodar por inercia. S frena hasta detenerse; si se mantiene, tras una pausa breve entra la reversa, limitada a 1,6 m/s. W frena la reversa antes de volver a avanzar. A gira el manubrio a la izquierda del ciclista y D a la derecha; al retroceder, la trayectoria responde al sentido inverso de marcha. Espacio hace un salto corto conservando la velocidad horizontal. La gravedad y el apoyo por capas usan el controlador del jugador, también sobre el viaducto: no hay un segundo cuerpo que compita por la posición del ciclista.

E desmonta por un costado con espacio para el jugador. En el aire o con ambos lados ocupados se mantiene el montaje. Alquilar, devolver, bajarse y volver a montar guardan automáticamente la partida en el navegador. Un atropello fuerza la separación: la bicicleta queda donde ocurrió el golpe y puede retomarse con E al recuperarse, incluso si había sido robada.

## Contactos y animación

`src/data/bicycle.js` define las medidas en metros, el sillín, los puños y el recorrido de los pedales. `Bicycle.js` conserva una raíz de movimiento, un grupo visual, dirección delantera, ruedas con pivote en el buje y bielas. Las plataformas de los pedales compensan la rotación de las bielas para seguir horizontales.

En una pendiente, la bicicleta y el ciclista se inclinan juntos según la altura del suelo bajo cada rueda. Ambos suavizan el cambio al entrar en una rampa o volver al plano. La calle y el viaducto conservan sus propias capas de apoyo. Al saltar, la inclinación se desvanece hasta recuperar el contacto con el suelo.

Con un pedido activo puedes recogerlo o entregarlo con **E** sin desmontar. Acércate al destino y frena casi por completo. Al alquilar una bicicleta mientras sigues un pedido, el GPS conserva el destino del reparto. [Guía de domicilios](domicilios.md)

Las posturas de `stances.js` se hornean una vez por cuerpo con la IK existente: dieciséis posiciones por tres ángulos de dirección, para pedaleo, apoyo y reversa. `BodyLanguage` interpola los cuaterniones locales según la fase real de la bicicleta. No resuelve IK ni pide matrices del mundo por cuadro. El modelo geométrico usa sus articulaciones existentes como respaldo. Al quedar detenido apoya el pie izquierdo y conserva el derecho en el pedal; W recoge el apoyo suavemente mientras empieza a moverse. Las piernas se ajustan a cada cuerpo sin mover la raíz física. El salto retira los apoyos y mantiene las manos en el manubrio.

En reversa, las ruedas siguen el desplazamiento real y las bielas conservan su fase. Ambos pies alternan apoyos cerca del suelo para empujar hacia atrás, con una fase propia que depende de la distancia recorrida. La mirada gira suavemente sobre el hombro con cuello y cabeza, sin soltar la cabrilla ni girar la raíz del jugador. Al detenerse o volver a avanzar regresa al frente. Los apoyos, la mirada y el temporizador del cambio de sentido son estados visuales/transitorios y se reinician al montar o desmontar; no bloquean el impulso ni las colisiones.

La misión **Bici de ida y vuelta** aparece cada día en **J → Calle**, junto a las tres misiones rotativas. Completar un alquiler pagado y devolver la bicicleta a su estación de origen entrega una sola recompensa diaria de $1.000, 30 XP y 10 de ánimo, además de los $2.000 de honestidad. Las bicicletas robadas, las devoluciones en otra estación y los intentos fallidos no cuentan. El contrato del alquiler permite completar el recorrido después de guardar y volver a entrar. La misión se guarda al devolverla, se renueva al cambiar de día y solo avanza con el rol Calle activo.

`Player.update` controla desplazamiento, apoyo y gravedad; `Bicycle.drive` calcula impulso y dirección. La animación avanza después de resolver el desplazamiento y antes de actualizar el cuerpo. Las colisiones usan tres barridos para cubrir ambas ruedas y el centro; se ignora únicamente la bicicleta conducida.

Las partidas conservan identificador, posición, rumbo, estado y estación. No se guardan referencias a Three.js, transiciones ni relojes visuales. Los guardados anteriores con estado `rented` recuperan una bicicleta estacionada o montada según `player.bicycleId`; las disponibles se recolocan en los puestos actuales.

## Verificación

```sh
node --test tests/bicycle.test.js tests/daily-missions.test.js tests/stances.test.js tests/body-language-guards.test.js tests/procedural-motion.test.js
npm run build
npm run test:e2e -- tests/e2e/bicycle.spec.js
```

La prueba de navegador recorre el rack, mapa del origen, conducción, salto, frenado, apoyos, reversa, remontaje y misión diaria. Comprueba también el autoguardado real del navegador, recoge errores de JavaScript y guarda capturas en el informe. Para usar Chrome instalado localmente se puede indicar `PLAYWRIGHT_CHANNEL=chrome`. Las pruebas de lógica cubren alquileres simultáneos, cambio a una bicicleta robada y comparación del impulso a 30, 60 y 144 pasos por segundo; eso no mide los FPS del renderizado del equipo.

`tests/bicycle.test.js` también comprueba el apoyo de ambas ruedas en las rampas del viaducto y la sincronización de la pose del ciclista. El reparto montado se comprueba en [las pruebas de domicilios](testing.md#domicilios-descanso-y-bicicleta).
