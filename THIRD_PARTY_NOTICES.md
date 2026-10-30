# Third-party code

## Slop New York — update 09361be1

Additional adaptations are pinned to revision `09361be1fe6a2efaee6ef62420a664c677e577b9` of https://github.com/mrdoob/slop-newyork and are covered by the MIT license and copyright notice below:

- `actor-models.js`: urban bus loft/body material and SUV geometry; local Bogotá destination, police identification and colors replace foreign liveries. Entity dimensions, +X orientation and shared batches remain BAZUKO adapters.
- `controllers.js`: power-limited acceleration, with BAZUKO player speed limits halved.
- `traffic.js`: main-road yielding, blocked-exit checks and waiting priority adapted to Bogotá's path reservations; no geographic data imported.
- `audio-synthesis.js`: combustion buffers, transmission and tire voices in `SlopMotorSynthesis.js`. Helicopter, bicycle and siren branches/resources are excluded. `audio-events.js` supplies horn synthesis alongside the existing crash adaptation.
- `tsl-materials.js`: period-integrated facade filtering in `FacadeNodes.js`, adapted to local brick colors and BAZUKO night controls.
- `main.js`: instance matrix storage and material-grouped asynchronous preparation inform `InstanceStorage.js` and `ShaderWarmup.js`. BAZUKO prepares every required binding and hidden tree LOD, using 64-object compilation batches. `ScenePassPreparation.js` and `StableInstanceShaders.js` are local compatibility adaptations for pinned Three.js 0.186.1; no library files are modified.

The original revision remains recorded below for modules whose source has not changed.

## Slop New York — vehicle geometry

Source: https://github.com/mrdoob/slop-newyork

Revision: 1b54e165ddc26b3e951d5614d56a88995da1da38, js/actor-models.js.

Adaptation in src/vehicles/SlopGeometry.js: extracted CPU loft geometry, replaced imports with pinned Three.js 0.186.1, excluded integrated mirrors by default. WebGL materials and the BAZUKO vehicle adapter are implemented separately. No geographic datasets are included.

MIT License

Copyright (c) 2026 Mr.doob

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

The vehicle TSL material graph in src/vehicles/SlopMaterial.js is also adapted from js/actor-models.js at the revision above. Foreign liveries were removed, local plate and TAXI labels were added, and wheel/braking/night state was connected to BAZUKO entities.

Additional adapted modules at the same Slop New York revision: src/graphics/Atmosphere.js (sky, environment and cascaded-sun arrangement), src/graphics/PostProcessing.js (TSL color grading and bloom), and src/graphics/VisualPipeline.js (MRT and SSR arrangement). They are adjusted to BAZUKO's scale, clock, weather and quality profiles. These adaptations are covered by the MIT notice above.
The time-of-day profiles (`golden`, `midday`, `blue-hour`, `night`) in `src/graphics/Atmosphere.js` are adapted from `js/lighting.js` and remain driven by BAZUKO's Bogotá clock.
`src/graphics/ShadowProxies.js` adapts the cell-based shadow stand-ins of `js/scene-culling.js` (position-only casters merged per cell and face side on a layer only the sun cascades render), with 64 m cells for Bogotá's scale and building stand-ins built from BAZUKO's fading wall and roof parts.
`src/graphics/InstancedChunks.js` adapts `chunkInstancedMesh` from the same file: copies of a repeated model (BAZUKO's street lamps) become one InstancedMesh per model mesh and 64 m cell, sharing geometry and material, culled per cell by the view and each cascade.
`src/world/bogota/TreeField.js` adapts `js/trees.js` (seeded growth, leaf atlas with coverage-preserving mips, bark tubes and leaf cards, three levels of detail per cell) and `src/graphics/TreeMaterial.js` adapts `createTreeMaterial` and `FoliageLightingModel` from `js/tsl-materials.js`. The New York species (London plane, honey locust, American elm) are replaced by Bogotá species (urapán, eucalipto, caucho sabanero) with their own leaf sprays, growth rules, tints and barks; distances and cells follow BAZUKO's scale and the wind blows from the east-southeast.

## Slop New York — traffic, vehicle contacts and crash effects

The following adaptations use the same pinned revision
`1b54e165ddc26b3e951d5614d56a88995da1da38` and MIT notice above:

- `src/vehicles/SlopTrafficAI.js`: IDM following, stopping, bend-speed approach and MOBIL gap/braking safety from `js/traffic.js`.
- `src/vehicles/SlopCollisionPhysics.js`: oriented SAT, player/traffic impulses, chain impacts, steering, lateral recovery and suspension/yaw coefficients from `js/traffic.js`; wall response from `js/controllers.js`.
- `src/vehicles/CollisionSparks.js`: collision spark distribution and bounded particle pool from `js/traffic.js`, rendered with WebGPU node materials.
- `src/vehicles/SlopCrashAudio.js`: body, metal and debris synthesis from `js/audio-events.js`; contact debounce and severity layering adapted from `js/audio-system.js` and `js/audio-events.js`.
- `src/systems/CityAcoustics.js`: segment-through-box thickness, three-ray aperture and exponential obstruction from `js/audio-acoustics.js`; direct gain through buildings from `js/audio-system.js`. BAZUKO queries its movement spatial index per trace, sums the thickness of its 2 m block strips and applies the result as volume only.

BAZUKO's adapters retain its Car entities, dimensions, +X local front, road network,
bridge heights, traffic lights, TransMilenio service and gameplay. They connect these
algorithms to shared vehicle batches, steerable wheels and Howler's master output.
Vertical contact filtering and bus route constraints are local additions. Geographic
data, New York routes and additional driving modes are not imported.

- `src/graphics/CityFacade.js` adapta a Bogotá la idea de fachadas procedurales con parámetros por vértice y filtrado por periodo de `tsl-materials.js` de Slop New York (MIT). No usa su mapa, coordenadas ni rótulos.
- `src/vehicles/donor/cars.js`, `bus.js` y `vehicles.js`: carrocerías, ruedas orientables, materiales TSL y placas de `js/cars.js`, `js/bus.js` y `js/vehicles.js` de Slop New York 09d27e050d1e75b7a0eea29a82e81aa4646f28e9 (MIT), con placas y colores bogotanos y luces ligadas al encendido nocturno del juego.
- `src/graphics/DonorSurfaces.js`: interiores con paralaje (room mapping) y asfalto con desgaste y charcos de `js/tsl-materials.js` de la misma revisión (MIT), en metros del mundo y sin coordenadas ni rótulos de Nueva York. `src/vehicles/SlopMotorSynthesis.js` se actualizó con la síntesis de combustión de `js/audio-synthesis.js` de esa revisión.
