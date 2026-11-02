# Bogotá, otra noche

La actualización visual web conserva el barrio, el inicio nocturno, las partidas y la calidad baja predeterminada. El personaje y la ciudad son protagonistas.

## Interfaz

Los colores, la letra, las marcas y la composición de las pantallas están en [identidad-visual.md](identidad-visual.md).

## Decisiones y límites

- Movimiento secundario sutil; sin desplazar pies, física o colisiones. Cielo y lluvia aprovechan los shaders existentes, sin luces globales nuevas ni posprocesado pesado.
- Modo foto congela la simulación, deja componer con la cámara y descarga el render sin interfaz. La exportación usa la resolución del canvas; no promete una captura 4K independiente de calidad.

## La calle y la luz

Todo lo de esta sección se ve también en calidad baja, la de la primera partida.

**Luz y cielo.** Los edificios, el viaducto y los árboles, también los grandes de Chapinero y Teusaquillo, proyectan sombra sobre la calle aunque no haya mapas de sombra: la sombra gira con la hora, se alarga al amanecer y al atardecer, y se va cuando el cielo se cierra. Lo que está en la calle la recibe igual que el piso: un carro, un bus, una moto, un poste o un semáforo se oscurecen al entrar en ella, y una copa queda clara del lado del sol y oscura por dentro. Los cierres y las rejas del borde dan la sombra corta de su altura. Los rincones entre muros y debajo del puente ven menos cielo y quedan más oscuros que una plaza abierta. El amanecer y el atardecer cambian la luz ambiente poco a poco, durante cerca de un minuto, sin que el piso salte de brillo de un momento a otro. Los días parcialmente nublados, la sombra de las nubes cruza la ciudad despacio. El amanecer y el atardecer tiñen el horizonte de naranja; las estrellas se ven pocas y desaparecen con las nubes. La niebla deja ver más lejos los días despejados y sigue el color del cielo en cada altura, así que las torres lejanas se leen como siluetas y no como cajas pálidas. Los faroles de hierro de la Candelaria y de la plaza dejan su charco de luz sobre el piso; el charco baja del andén a la calzada y se corta contra los muros. A lo lejos esa luz se apaga dentro de la niebla en lugar de aclararla, y la sombra de contacto de carros y personas se sigue viendo encima de ella y de la pintura: nadie flota bajo un farol.

**Pavimento y pintura.** La pintura está gastada de verdad: la cebra se borra donde pisan las llantas, las líneas tienen tramos casi perdidos y cada franja guarda cuánta pintura le queda. El desgaste corre a lo largo de la rodada, en tramos lavados y haces de rayones, sin punteado. La avenida lleva carriles, flechas, PARE y SOLO BUS en la troncal; las calles, líneas de pare, tapas de alcantarilla, sumideros, remiendos, grietas selladas, manchas de aceite, marcas de llanta en los accesos a los cruces y algún hueco. Junto a sardineles y muros se acumula mugre. Un barrio empedrado que no declara pintura se queda sin rayas, pero sigue teniendo tapas y mugre.

**Prado y andén.** El pasto cambia de verde hondo a paja en manchas de una docena de metros y por matas de unos palmos. Contra el andén y los senderos se gasta hasta la tierra, con el borde mordido y no recto, y hay matas bajas donde no llega la guadaña. El lote del cambuche tiene tierra pisada y dos trochas hacia el andén. Todos los parques heredan esto solos, sin datos por parque. El andén es de losas fundidas una a una, con junta fina, tono propio, alguna partida o reparada y manchas grandes que rompen la repetición; no lleva grano fino que titile al alejarse.

**Fuego.** Canecas, fritangas y el fogón del cambuche alumbran de noche. De día su luz baja a una octava parte, en unos segundos, para que nadie tenga la cara naranja al sol; la llama se sigue viendo. Respiran despacio, por debajo de medio ciclo por segundo.

**Lluvia.** La pintura y el pavimento brillan al mojarse. Cuando el aguacero se sostiene aparecen charcos junto al sardinel, en los baches del carril y en losas hundidas del andén, que reflejan el cielo y se secan al escampar; siempre se encharcan los mismos sitios. De noche el pavimento mojado devuelve más luz de los faroles.

**Sardineles, cables y postes.** El sardinel tiene volumen y tramos pintados de amarillo o rojo; cada cebra termina en una rampa corta. Un poste de concreto cada 20 a 30 metros lleva cables con comba de uno a otro, enredos cerca de los transformadores, cruces de calle con zapatos colgados y acometidas hasta las fachadas.

**Lo que la gente deja afuera.** Canastas, llantas, cartón, bultos, sillas plásticas, canecas, bolardos, conos y avisos clavados en poste, con textos inventados. Nada de esto estorba: no se pone en la calzada, ni en paraderos ni frente a puertas, y no tiene colisión.

**Fachadas y azoteas.** La lluvia baja de cada alféizar y deja humedad; las tiendas tienen toldos de lona, contadores de luz con su tubo y letreros pintados a mano. Los edificios altos tienen portal: aluminio y vidrio, reja negra con citófono, madera vieja o lámina pintada, con su placa de nomenclatura. Las casas tienen en la azotea tanques negros, cuarto de escalera, varillas de la obra sin terminar, antena y ropa colgada.

**Noche.** Cada farol deja un pozo de luz cálida en el suelo y un halo suave en la cabeza, sin luces nuevas. El pozo se apaga del todo de día. Nada de esto parpadea.

**Marcas.** Ninguna marca real aparte de las que el juego ya tenía: los avisos, los nombres de tienda y las placas son inventados.

**Calidad automática.** La primera partida arranca en baja. Si el equipo sostiene unos veinte segundos de cuadros holgados, sube sola a media. Prepara las sombras antes de encenderlas para que el juego no se congele, pero el cambio se nota: un tirón, de un par de segundos la primera vez en un navegador que aún no tiene esos programas en caché. Si después no aguanta, vuelve a baja y no insiste en esa sesión. Volver de otra pestaña no cuenta: la espera empieza de nuevo. No se guarda como preferencia, y quien elige una calidad en el menú queda con esa.
