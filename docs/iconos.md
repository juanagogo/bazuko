# Iconos de objetos

La mesa de fabricación muestra los objetos con iconos de [game-icons.net](https://game-icons.net), publicados bajo la licencia [Creative Commons BY 3.0](https://creativecommons.org/licenses/by/3.0/). Se tomaron del repositorio [game-icons/icons](https://github.com/game-icons/icons), commit `82d948812bfe3f269ef8f731dcdb07b08160edc4`.

`cuchillo.svg` y `botella_picada.svg` son siluetas dibujadas para el proyecto, sin relación con game-icons.net.

Cada archivo de `src/ui/item-art/` (salvo esos dos) se adaptó de la misma forma: se quitó el fondo negro cuadrado y el trazo pasó a `currentColor`, para que la interfaz lo tiña según la familia del objeto (material, médico, sustancia, valor o equipo). El dibujo no se modificó.

| Archivo | Objeto en el juego | Icono original | Autor |
| --- | --- | --- | --- |
| `radioTransistor.svg` | Radio transistor AM/FM | [Pocket radio](https://game-icons.net/1x1/delapouite/pocket-radio.html) | Delapouite |
| `cuchillo.svg` | Cuchillo | Dibujo propio del proyecto (silueta de cuchillo) | Equipo del proyecto |
| `botella_picada.svg` | Botella picada | Dibujo propio del proyecto (botella con la boca rota) | Equipo del proyecto |
| `arma.svg` | Arma casera | [Spiked bat](https://game-icons.net/1x1/skoll/spiked-bat.html) | Skoll |
| `curita.svg` | Curita | [Sticking plaster](https://game-icons.net/1x1/lorc/sticking-plaster.html) | Lorc |
| `antibiotico.svg` | Antibiótico | [Medicine pills](https://game-icons.net/1x1/delapouite/medicine-pills.html) | Delapouite |
| `rifa.svg` | Cartón de rifa | [Ticket](https://game-icons.net/1x1/delapouite/ticket.html) | Delapouite |
| `hierba.svg` | Hierba seca | [Herbs bundle](https://game-icons.net/1x1/delapouite/herbs-bundle.html) | Delapouite |
| `chatarra.svg` | Chatarra | [Gears](https://game-icons.net/1x1/lorc/gears.html) | Lorc |
| `cable.svg` | Cable cobre | [Wire coil](https://game-icons.net/1x1/delapouite/wire-coil.html) | Delapouite |
| `pilas.svg` | Pilas AA | [Battery pack](https://game-icons.net/1x1/sbed/battery-pack.html) | Sbed |
| `madera.svg` | Tablas | [Planks](https://game-icons.net/1x1/delapouite/planks.html) | Delapouite |
| `botella.svg` | Botella PET | [Water bottle](https://game-icons.net/1x1/delapouite/water-bottle.html) | Delapouite |
| `carton.svg` | Cartón | [Cardboard box](https://game-icons.net/1x1/delapouite/cardboard-box.html) | Delapouite |
| `lata.svg` | Lata vacía | [Soda can](https://game-icons.net/1x1/guard13007/soda-can.html) | Guard13007 |
| `pastilla.svg` | Pastilla | [Pill](https://game-icons.net/1x1/lorc/pill.html) | Lorc |
| `yunque.svg` | Cabecera y acción de fabricar | [Anvil impact](https://game-icons.net/1x1/lorc/anvil-impact.html) | Lorc |

El inventario y la barra rápida todavía usan emojis; `src/ui/itemArt.js` está preparado para reutilizar estos iconos allí. Al añadir un icono, documentar aquí su origen y autor: la prueba `tests/crafting.test.js` comprueba que cada archivo tenga su fila.
