# Rebusque en el semáforo

Con **pelotas de malabares** en el costal (Tienda La Esquinita, $3.000; no se gastan y no se venden dos veces), frente a la cola de un semáforo en rojo, **B** hace un show. L sigue siendo siempre limosna.

## Cuándo B es del show

- Hay carros quietos frente a un rojo a menos de 9 m (`TrafficSystem.stoppedAtRed`, que solo lee el tráfico y los semáforos).
- El jugador está frente a la cola, a más de 2,5 m del centro del carro más cercano (no del parachoques: frente a un carro de 4,2 m eso deja pararse a unos 0,4 m de la trompa) y sin pegarse a ningún costado, y no está dentro del cruce. Las busetas del tráfico cuentan como cualquier carro.
- Al rojo le quedan al menos 4 s; el show dura 5 s o lo que quede de rojo menos 1,5 s.
- La esquina no tuvo otro show en los últimos 40 s y a esos carros no se les trabajó en el último minuto.

Si hay pelotas y carros pero algo de eso falla, B dice por qué («Ya va a cambiar la luz…», «Aquí en el cruce me atropellan…», «Esta esquina ya me vio…») y no pide limosna. Sin pelotas, en verde o lejos de la cola, B pide limosna como siempre; la primera vez que hay carros en rojo al lado sin pelotas sale una pista de la tienda.

## Durante el show y al cobrar

- El aviso cuenta los segundos del show y del rojo, también en la pantalla táctil. El carro no ofrece E (retrovisor) ni Q (vidrio) hasta que termine.
- Mientras dura el show no se puede pegar ni empezar otra acción: la pose de malabares vuelve cada medio segundo, así que G y el clic no hacen nada, un golpe a medias se corta y comer o usar algo se reemplaza. Alejarse sí corta el show.
- Alejarse más de 2,5 m corta el show sin paga. El carro que arranca no paga; si arrancan todos, «Cambió la luz y arrancaron sin pagarme». Morir, dormir o caer preso lo cancelan; abrir un menú lo deja en pausa con el resto del juego.
- Al terminar, cada conductor reacciona por su cuenta (`systems/rebusque/reacciones.js`, tabla en `data/rebusqueReacciones.js`): paga ($200 a $1.000), propina ($1.000 a $2.000, o un billete de $5.000), regala comida, se excusa, sube el vidrio, no mira, pita o insulta. Frente al primero de la cola la paga sube un 15 % y un show recortado paga en proporción; todo en múltiplos de $100. Con mal olor la probabilidad de recibir algo baja a la mitad; con lluvia, un 40 %.
- Un show a cuatro carros deja en promedio unos $1.000 a $1.200. Lo que pasaría de $3.000 en un minuto real se vuelve «no tiene sencillo», salvo el primer pago del minuto, que pasa entero: un billete de $5.000 suelto sí sale.
- Después del cobro el jugador sigue frente a la trompa y, como con cualquier peatón, el carro lo espera en verde hasta que se quite; la cola de atrás espera con él.
- Cuesta 5 de energía y da 4 de experiencia por conductor que paga.

## El cuerpo y las pelotas

- Mientras dura el show, el personaje mira a la cola y hace malabares con tres pelotas en cascada: un lanzamiento cada 0,32 s, alternando manos (`systems/rebusque/ritmo.js`). Los brazos (`character/rebusquePose.js`, aplicada por `ActionPose` después del mezclador, como calentarse) suben cada mano justo cuando lanza, y las pelotas (`systems/rebusque/RebusqueVisual.js`) vuelan entre las palmas con el mismo reloj, a unos 73 cm sobre la mano.
- El muñeco procedural no tiene esa pose: se frota las manos (calentarse) y las pelotas salen de un punto delante del pecho.
- El show renueva la acción cada medio segundo. Cobrar o cortar el show (alejarse, morir, dormir, caer preso) la suelta de una vez; saltar u otra acción baja los brazos al instante y caminar los baja de a poco. Si el jugador ya está en otra acción (un salto, un golpe), soltar el show no se la quita.
- Las pelotas son tres mallas propias sin sombras que se crean con el primer show y se ocultan al terminar.
