# Domicilios en Rappi

## Comprar y equipar

El mapa muestra **La Esquinita — Equipo de Rappi**. Acércate a la tienda y pulsa **E** para comprar el equipo por **$50.000** después de completar seis tipos distintos de misiones de Calle. Las partidas nuevas empiezan con **$0**. Si ya tienes el equipo en tu partida, puedes seguir repartiéndolo con el maletín que compraste.

Dentro del juego, abre **Ayuda → Guía de domicilios de Rappi** o **Pausa → Controles** para consultar cómo comprar el equipo, aceptar, recoger y entregar pedidos.

La compra agrega y equipa el maletín, la chaqueta reflectiva y la gorra. Puedes poner o quitar cada pieza en el costal o en **P → Ropa → Equipo de reparto**. La ropa de calle se conserva bajo la apariencia de reparto. Las piezas pesan cero, quedan en el costal tras un arresto y están excluidas de la venta, el reciclaje, el descarte y la caleta.

## Cambiar de rol

**J** u **O** abre Misiones en la pestaña del rol activo. Puedes consultar **Calle** o **Rappi** con el ratón o las flechas del teclado. Usa **Poner maletín** para repartir y **Volver a Calle** para quitarlo. Solo el maletín activa Rappi. Las misiones de Calle conservan su avance mientras repartes y siguen renovándose a medianoche.

## Recoger y entregar

1. En **J → Rappi**, elige **Aceptar pedido**. El GPS marca La Esquinita o un puesto de comida.
2. Pulsa **E** al llegar para recoger el pedido. El GPS señala al cliente en la calle o la portería y el HUD muestra cuánto tiempo queda para la propina.
3. Pulsa **E** junto al cliente o la portería para cobrar. Puedes recoger y entregar a pie o con la bicicleta casi detenida. La interacción del pedido tiene prioridad sobre el cosquilleo cuando estás al alcance.

| Destino | Pago base | Experiencia |
| --- | ---: | ---: |
| Cliente en la calle | $3.000 | 25 XP |
| Portería | $4.000 | 35 XP |

El plazo para ganar **$1.000 de propina** empieza al recoger el pedido. Va de 45 segundos a 4 minutos según la distancia. Al vencer, el pedido sigue disponible por la tarifa base. Si te quitas el maletín, puedes retomar el pedido equipándolo de nuevo. El tiempo sigue corriendo durante la simulación y se detiene al pausar el juego.

Desde **J → Rappi** puedes volver a marcar el destino con **Seguir pedido** o abandonar el encargo con **Cancelar pedido**.

## Faltas y reactivación

Después de recoger un pedido, **Quedarme con el pedido** agrega una empanada si hay espacio en el costal y registra una falta. A la tercera falta se retiran las tres piezas del equipo y se suspenden los pedidos. Al pagar **$18.000** en La Esquinita, recuperas el equipo con el maletín puesto y las faltas vuelven a cero. El número de entregas completadas se conserva.

## Implementación y guardado

`src/systems/DeliverySystem.js` gestiona el equipo, los pedidos, el plazo, las recompensas y las faltas. `src/world/bogota/deliveryPlaces.js` sitúa recogidas frente a los comercios y entregas junto a peatones o en andenes frente a fachadas. El GPS actualiza el destino cuando el cliente se desplaza y la ruta sigue marcada. Al alquilar una bicicleta se conserva la ruta activa del pedido.

El guardado conserva la propiedad del equipo, las piezas puestas, las entregas, las faltas y el pedido pendiente con el tiempo restante desde la recogida. `DailyMissionSystem` guarda los tipos de misión completados entre días. Si una partida anterior carece de historial, recupera los tipos que figuren como completados en sus misiones guardadas.

Para ejecutar las comprobaciones de lógica y de navegador, consulta la [guía de pruebas de domicilios, descanso y bicicleta](testing.md#domicilios-descanso-y-bicicleta).
