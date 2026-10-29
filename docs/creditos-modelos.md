# Créditos y licencias de los modelos 3D

Modelos de terceros que usa el port C++ (carpeta `public/models/`). Las licencias salen de la ficha pública de cada modelo en Sketchfab (consulta del 28 de octubre de 2026); si una ficha cambia, manda la ficha. Los enlaces abren el modelo por su identificador.

## Con atribución obligatoria

| Modelo | Autor | Licencia | Enlace |
|---|---|---|---|
| Toyota Hilux Revo Prerunner 2021 | Asadawut.Kaewma | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | https://sketchfab.com/models/04ae6d8e07e84f55a9e1d7e3261be171 |

| Labrador Dog | kenchoo (basado en «Dog» de all of life, según la descripción de la ficha) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | https://sketchfab.com/3d-models/labrador-dog-1f56cfbab07e4fe49b5d9e521c82073a |

**Cambios sobre el original (Labrador):** `public/models/labrador.glb` se preparó con Blender a partir de la exportación completa de la ficha (`perro_nuevo/source/Labrador.glb`): se unió la malla del hocico a la cabeza, se quitó la forma clave (morph) y se escaló a metros, se dejó un solo material de pelaje con la textura de color a 2048 px (JPEG), se reasignaron al pie de cada pata los pesos que estaban en huesos de IK fijos y se suavizaron los pesos de piel. Su único clip original (un Idle de 13 s) se conserva como `Idle`; los demás se crearon moviendo sus huesos: caminar, trotar, correr, giros, mirar, olfatear, alerta, sentarse, echarse, dormir, reverencia y salto, con los nombres que usa el juego. La carpeta `perro_nuevo/` (descarga original) no se sube: `.gitignore` la excluye.

**Cambios sobre el original (Hilux):** se convirtió a glTF, se separó la carrocería de las cuatro ruedas para que giren y viren, se midieron su caja y sus asientos para colocar al conductor y se ajustó la escala. La geometría y las texturas no se rediseñaron.

## Licencia gratuita de Sketchfab (Free Standard)

Permite usar el modelo gratis en un proyecto. Sketchfab no permite redistribuir el archivo del modelo por sí solo; si el repositorio llega a ser público, conviene comprobar este punto o retirar estos archivos.

| Modelo | Autor | Enlace |
|---|---|---|
| Mercedes-Benz SLK 55 AMG (2012) | geyges | https://sketchfab.com/models/03096be29f4d4e5ca3b7291207c002c8 |
| Volkswagen Crafter | geyges | https://sketchfab.com/models/647fb3d619c645a4b8e62d80db7cab98 |
| Volkswagen Jetta GLI (2025) | geyges | https://sketchfab.com/models/4adbe6ffcf5246ddac95921cb39bd2bf |

Los tres se convirtieron a glTF y se separaron en carrocería, ruedas y, en el Mercedes, la puerta del conductor.

## Sin permiso de redistribución (fuera del repositorio)

Estos modelos no son descargables de forma oficial (licencia «Standard» de pago, «Editorial» o sin licencia indicada), así que **no se suben al repositorio**: `.gitignore` los excluye y quien tenga una copia legítima puede colocarla en `public/models/` para usarlos en local. El port **no los carga por defecto**: sin ellos el juego usa los modelos de respaldo (el Labrador animado en lugar del Pitbull, otros carros de cabina y el bus articulado hecho en Blender). Con copias propias con licencia se activan definiendo `BAZUKO_MODELOS_RESTRINGIDOS=1` antes de abrir el juego. Antes de publicar el proyecto con ellos hay que comprarlos o pedirlos al autor, o reemplazarlos por modelos de licencia libre.

| Modelo | Autor | Licencia en la ficha | Enlace | Archivos que se esperan |
|---|---|---|---|---|
| Dog - Pitbull (El Chato) | RedDeer | Standard | https://sketchfab.com/models/001fab8be8174ebba05b4d5ae1f22b0c | `chato.glb` |
| Ford F150 Raptor | codexito | Standard | https://sketchfab.com/models/7a96fa6484744fc9b0a99ad68f710a9a | `vehiculos/raptor*` |
| Renault 6 | codexito | Standard | https://sketchfab.com/models/9ffb467d90ec44d1a70a97cf7c6093e2 | `vehiculos/renault6*` |
| City Bus | Rescue3D Assets | Standard | https://sketchfab.com/models/51b9602a56a74c458a9bbdf4cd885c86 | (no se usa) |
| Tesla MODEL X [Animation] | Virtual Studio | Editorial | https://sketchfab.com/models/36e9d3598c554bb69f3d9cd00e161818 | `vehiculos/modelx*` |
| Transmilenio Bus - Colombian Bus | camilooh | Sin licencia indicada | https://sketchfab.com/models/7e465ccd0f2e4e088f8ebdeb5f575ed5 | `transmilenio/` |

El Pitbull se preparó con Blender (metros, textura de color a 1024 px y 38 de sus 130 animaciones, todas en el sitio).

## Bus articulado de respaldo

`public/models/bus-articulado/` (carrocería de dos secciones, fuelle flexible y seis ruedas) se modeló desde cero en Blender tomando como referencia fotos de los buses articulados de TransMilenio; del `tm.opt.glb` del juego base solo se midieron las posiciones de ventanas y puertas. No contiene geometría ni texturas de modelos de terceros. El letrero LED usa una textura de puntos generada por script (`letrero_led.png`) y el logo y el nombre «TransMilenio» son marcas de su titular, usadas aquí solo como ambientación del juego. Con `BAZUKO_MODELOS_RESTRINGIDOS=1` y una copia propia del Transmilenio biarticulado de la tabla anterior, el juego lo usa en su lugar.

## Otros modelos del juego

El resto de los modelos importados (peatones, vehículos del tráfico, mobiliario urbano, fauna, árboles) conserva la procedencia que indica [modelos-importados.md](modelos-importados.md).
