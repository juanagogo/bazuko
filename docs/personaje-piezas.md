# Piezas del personaje realista

El personaje se arma con piezas de MakeHuman exportadas por `tools/personaje/exportar_variantes.py` a partir de `tools/personaje/catalogo.json`. El juego lee el resultado en `public/models/personaje/catalogo.json`.

## Qué funciona sin exportar

- **Descalzo** (`calzado`): no usa malla; se ve el pie del cuerpo.
- **Bastón y mochila** (`look.accesorios`): se construyen con geometría simple en `src/character/props.js` y se atan a los huesos `RightHand` y `Spine2`. No dependen de MakeHuman ni de licencias externas.
- **Desgaste y canas**: shaders de `src/character/weathering.js` sobre las texturas existentes.

## Sombreros (`cabeza`)

| Id | Asset | Pack | Licencia |
| --- | --- | --- | --- |
| `boina` | `jujube_newsboy_cap` (jujube) | [Hats 01](https://static.makehumancommunity.org/assets/assetpacks/hats01.html) | CC0 |
| `gorro-lana` | `mindfront_knitted_hat_01` (Mindfront) | [Hats 03](https://static.makehumancommunity.org/assets/assetpacks/hats03.html) | CC-BY |

Ambos están exportados para los seis cuerpos, con su versión liviana. El gorro de lana oculta el cuero cabelludo que tapa. Con cualquier sombrero, `src/character/hatFit.js` mide el borde inferior del sombrero alrededor de la cabeza y recorta el pelo que queda por encima, así el pelo largo sale por debajo sin atravesarlo.

El bastón no cuelga del hueso de la mano: en cada cuadro se coloca vertical en el puño y su palo se alarga hasta el suelo.

**CC-BY exige crédito.** El crédito a Mindfront está en el README (*Recursos de terceros*) y en la lista de `src/ui/DeveloperNote.js`. No quitarlo mientras el gorro siga en el juego.

Si MPFB no crea el material de una pieza (pasó con la boina), el exportador lo arma con la textura difusa y el normal map declarados en el `.mhmat` de la pieza.

## Exportar

1. Instalar en Blender 5.2 la extensión **MPFB** desde *Edit → Preferences → Get Extensions*.
2. En MPFB, cargar los *MakeHuman system assets* y los packs Hats 01 y Hats 03 (*Apply Assets → Library settings → Load pack from zip*).
3. Ejecutar desde la raíz del repositorio:

```sh
"D:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --python tools/personaje/exportar_variantes.py
```

Para regenerar un solo cuerpo, añadir `-- hombre-mayor`. Para añadir piezas sin rehacer las demás (ni tener instalados sus assets), usar `-- --piezas=boina,gorro-lana`: solo exporta esas piezas y las suma al catálogo existente. Si un asset no está instalado, MPFB falla al buscar su `.mhclo`: revisar que el nombre de la carpeta coincida con el del catálogo.

Después de exportar, ejecutar `npm test`: `tests/street-presets.test.js` comprueba que los estilos y ambos catálogos coincidan.
