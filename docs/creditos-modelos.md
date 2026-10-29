# Créditos y licencias de los modelos 3D

Modelos de terceros que usa el port C++ (carpeta `public/models/`). Las licencias salen de la ficha pública de cada modelo en Sketchfab (consulta del 28 de octubre de 2026); si una ficha cambia, manda la ficha. Los enlaces abren el modelo por su identificador.

## Con atribución obligatoria

| Modelo | Autor | Licencia | Enlace |
|---|---|---|---|
| Toyota Hilux Revo Prerunner 2021 | Asadawut.Kaewma | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | https://sketchfab.com/models/04ae6d8e07e84f55a9e1d7e3261be171 |

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

Estos modelos no son descargables de forma oficial (licencia «Standard» de pago, «Editorial» o sin licencia indicada), así que **no se suben al repositorio**: `.gitignore` los excluye y quien tenga una copia legítima puede colocarla en `public/models/` para usarlos en local. Sin ellos el juego funciona con los modelos de respaldo (perro anterior animado por código, otros carros de cabina y el bus de la versión web). Antes de publicar el proyecto con ellos hay que comprarlos o pedirlos al autor, o reemplazarlos por modelos de licencia libre.

| Modelo | Autor | Licencia en la ficha | Enlace | Archivos que se esperan |
|---|---|---|---|---|
| Dog - Pitbull (El Chato) | RedDeer | Standard | https://sketchfab.com/models/001fab8be8174ebba05b4d5ae1f22b0c | `chato.glb` |
| Ford F150 Raptor | codexito | Standard | https://sketchfab.com/models/7a96fa6484744fc9b0a99ad68f710a9a | `vehiculos/raptor*` |
| Renault 6 | codexito | Standard | https://sketchfab.com/models/9ffb467d90ec44d1a70a97cf7c6093e2 | `vehiculos/renault6*` |
| City Bus | Rescue3D Assets | Standard | https://sketchfab.com/models/51b9602a56a74c458a9bbdf4cd885c86 | (no se usa) |
| Tesla MODEL X [Animation] | Virtual Studio | Editorial | https://sketchfab.com/models/36e9d3598c554bb69f3d9cd00e161818 | `vehiculos/modelx*` |
| Transmilenio Bus - Colombian Bus | camilooh | Sin licencia indicada | https://sketchfab.com/models/7e465ccd0f2e4e088f8ebdeb5f575ed5 | `transmilenio/` |

El Pitbull se preparó con Blender (metros, textura de color a 1024 px y 38 de sus 130 animaciones, todas en el sitio).

## Otros modelos del juego

El resto de los modelos importados (peatones, vehículos del tráfico, mobiliario urbano, fauna, árboles) conserva la procedencia que indica [modelos-importados.md](modelos-importados.md).
