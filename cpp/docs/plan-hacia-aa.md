# Plan de evolución gráfica y técnica hacia calidad AA (Port C++)

Este documento define la ruta técnica y de producción para evolucionar el puerto nativo en C++ (`cpp/`) desde la paridad funcional con la versión web hacia un acabado gráfico y de simulación de nivel **AA contemporáneo** (referencias estéticas y de escala: *Sleeping Dogs*, *Yakuza Kiwami*, *S.T.A.L.K.E.R.*). 

El objetivo es aprovechar la arquitectura en C++20 y OpenGL 4.5 Core DSA para dotar al centro de Bogotá de una atmósfera densa, creíble y cinematográfica, preservando un presupuesto estricto de rendimiento (60 FPS estables en gráficos integrados modernos y más de 120 FPS en tarjetas dedicadas).

---

## 1. Diagnóstico del estado actual

### Fortalezas existentes en `cpp/`
* **Arquitectura modular de renderizado:** `src/renderer/` desacopla búferes, vertex arrays (DSA), shaders, cámaras y modelos de la simulación del mundo.
* **Control directo de estado (DSA):** Reducción drástica del overhead del driver de OpenGL (`glCreateBuffers`, `glVertexArrayVertexBuffer`, `glNamedBufferSubData`).
* **UBOs estructurados:** `CameraBlock`, `LightBlock` y paletas de huesos de hasta 128 transformaciones (`SkinBlock`) optimizadas en hardware.
* **Rendimiento base excelente:** Medición en escena urbana completa (Ryzen 5 / RTX 3050) sobre 140–187 FPS medios en tarjeta dedicada y 47–87 FPS en gráficos integrados Radeon, con 0 tirones superiores a 100 ms.
* **Semillas atmosféricas listas:** Parámetros como `m_Wetness`, `m_Metallic`, `m_Roughness`, `m_Sway` (viento en árboles), `m_PushOut` y sombras ortográficas básicas ya existen en `Renderer.hpp`.

### Brechas técnicas frente a un estándar AA
1. **Iluminación empírica:** El sombreado actual usa aproximaciones difusas/especulares básicas en vez de un modelo de microfacetas físicamente correcto (PBR Cook-Torrance).
2. **Límite de luces locales:** La estructura fija `kMaxLampLights = 32` limita la vida nocturna de Bogotá (farolas, semáforos, faros de vehículos, vitrinas y fogatas).
3. **Sombras de cascada única:** Un solo mapa ortográfico provoca pérdida de detalle en sombras distantes (Torre Colpatria, viaducto) o artefactos de pixelado cerca del jugador.
4. **Pipeline LDR (Low Dynamic Range):** Renderizado en 8 bits por canal sin curva de mapeo tonal cinematográfico (ACES) ni oclusión ambiental en espacio de pantalla (SSAO).
5. **Relieve plano:** Ausencia de mapas de normales (MikkTSpace) en mallas de arquitectura, asfalto y ropa.

---

## 2. Fases de implementación

```
                                  MAPA DE RUTA HACIA AA
┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
│   FASE 1: PBR    │ ─> │ FASE 2: CLUSTER  │ ─> │ FASE 3: CLIMA &  │ ─> │ FASE 4: POST-FX  │
│ Materiales reales│    │ 100+ luces & CSM │    │ Charcos & Niebla │    │ HDR, ACES & SSAO │
└──────────────────┘    └──────────────────┘    └──────────────────┘    └──────────────────┘
                                                                                 │
                                                                                 ▼
                                                                        ┌──────────────────┐
                                                                        │  FASE 5: ASSETS  │
                                                                        │  Decals & Foot IK│
                                                                        └──────────────────┘
```

---

### Fase 1: Pipeline de materiales PBR (Physically Based Rendering)
**Meta:** Eliminar el aspecto plástico y lograr que ladrillos, asfalto, metales y prendas reaccionen con precisión física ante cualquier condición de luz.

1. **BRDF Cook-Torrance en `default.frag`:**
   * **Distribución de microfacetas (D):** GGX / Trowbridge-Reitz.
   * **Atenuación geométrica (G):** Modelo Smith con aproximación de Schlick-GGX.
   * **Efecto Fresnel (F):** Aproximación de Schlick ($F_0$ de 0.04 para dieléctricos, interpolado por metalicidad).
2. **Texturizado con empaquetado ORM:**
   * Estandarizar canales de textura secundarios en un solo archivo `.webp`:
     * **R:** Oclusión ambiental horneada (*Ambient Occlusion*).
     * **G:** Rugosidad (*Roughness*).
     * **B:** Metalicidad (*Metallic*).
   * Reduce lecturas de textura a una sola muestra para tres propiedades clave.
3. **Mapeo de normales (Normal Mapping):**
   * Añadir atributos `aTangent` (vec4, con signo de bitangente) a `Mesh.hpp` y cargarlos desde glTF en `Model.cpp`.
   * Matriz TBN en `default.vert` para transformar normales de espacio tangente a espacio de mundo.
   * Relieve real para andenes agrietados, adoquines del Parque del Lago y muros de ladrillo bogotano.
4. **Iluminación basada en imagen (IBL) básica:**
   * Mapa de entorno difuso de baja resolución (*irradiance map*) para sustituir el color ambiental plano (`ambientColor`) por reflexión direccional del cielo y edificios circundantes.

---

### Fase 2: Iluminación a gran escala y sombras en cascada (CSM)
**Meta:** Permitir que el centro de la ciudad de noche sostenga cientos de fuentes de luz activas y sombras nítidas a cualquier distancia.

1. **Clustered Forward Shading (o Forward+):**
   * Reemplazar el arreglo estático de 32 farolas por una rejilla tridimensional de *clusters* en el espacio de la cámara (por ejemplo, $16 \times 9 \times 24$ celdas de profundidad logarítmica).
   * Un *Compute Shader* o pasada de CPU ligera clasifica qué luces intersectan cada celda.
   * **Impacto:** Permite manejar más de **250 luces dinámicas** (postes, semáforos sincronizados, faros delanteros y traseros de carros y buses, letreros de tiendas y ventanas) evaluando solo las luces que realmente afectan a cada fragmento.
2. **Cascaded Shadow Maps (CSM):**
   * Dividir el frustum de la cámara en 3 o 4 particiones (*cascades*):
     * Cascada 0 (0 a 10 m): sombras de alta definición en el jugador, basura, canecas y detalles inmediatos.
     * Cascada 1 (10 a 40 m): vehículos, peatones cercanos y mobiliario urbano.
     * Cascada 2 (40 a 120 m): fachadas de edificios y puentes del viaducto.
     * Cascada 3 (120 a 300 m): sombras masivas de rascacielos (Torre Colpatria).
   * Filtrado PCF (Percentage Closer Filtering) con rotación de Poisson para bordes suaves sin serrucho.

---

### Fase 3: Atmósfera e identidad bogotana (Lluvia, charcos y niebla)
**Meta:** Explotar el clima bogotano como pilar estético diferencial del proyecto.

1. **Superficies mojadas dinámicas:**
   * Vincular `m_Wetness` con la acumulación de lluvia del sistema climático:
     * El albedo de asfalto y concreto se oscurece gradualmente al absorber agua.
     * El valor de rugosidad (*roughness*) desciende hacia $0.02$ en polígonos horizontales ($N_y > 0.8$), convirtiéndolos en superficies especulares.
     * Capa de micro-ondas de gotas de lluvia generadas proceduralmente mediante ruido animado por tiempo en el fragment shader.
2. **Reflejos en espacio de pantalla (Screen Space Reflections - SSR):**
   * Trazado de rayos en el buffer de profundidad para reflejar luces de neón, semáforos y siluetas de edificios sobre el asfalto mojado y el agua del lago.
3. **Niebla volumétrica y conos de luz (*God Rays*):**
   * Pasada de dispersión de luz en el volumen de niebla existente.
   * Faros de los buses y patrullas, luces de advertencia y farolas generan conos de luz visibles al atravesar la llovizna nocturna o la niebla matutina de los cerros.

---

### Fase 4: Pipeline de post-procesado cinematográfico
**Meta:** Integrar todos los elementos lumínicos con coherencia fotográfica.

1. **Framebuffer HDR Floating-Point:**
   * Migrar el render target principal en `Renderer::BeginScaledTarget` a `GL_RGBA16F`.
   * Permite valores de radiancia superiores a 1.0 (luces estroboscópicas de policía, filamentos de tungsteno, destellos de relámpagos).
2. **Curva de mapeo tonal ACES (Academy Color Encoding System):**
   * Implementar ACES Filmic Tone Mapping en `present.frag`.
   * Evita que las luces brillantes quemen los píxeles a blancos planos, preservando gradientes ricos de saturación y contraste.
3. **Bloom físico con filtrado progresivo (Dual Filtering):**
   * Cadena de reducción y aumento de resolución (*Downsample/Upsample chain*) con desenfoque bilineal progresivo.
   * Otorga un resplandor óptico suave y orgánico alrededor de focos intensos sin artefactos de parpadeo.
4. **SSAO (Screen Space Ambient Occlusion):**
   * Pasada de oclusión ambiental basada en el buffer de profundidad y normales.
   * Genera sombras de contacto esenciales en la base de los edificios, esquinas de andenes, ruedas de vehículos y pliegues de ropa.

---

### Fase 5: Pipeline de assets, detalles y animación
**Meta:** Alinear el contenido artístico y la interacción física con la calidad del nuevo renderizador.

1. **Sistema de calcomanías proyectadas (*Decals*):**
   * Mallas volumétricas que proyectan texturas sobre superficies existentes sin duplicar geometría:
     * Grafitis en paredes y pilares del viaducto.
     * Manchas de aceite de motor en calzadas.
     * Grietas en el asfalto y afiches pegados en postes.
2. **Cinemática inversa para pies (*Foot IK*):**
   * Ajuste de altura y orientación de tobillos para que el jugador y peatones apoyen los pies correctamente sobre cordones de acera, escaleras, rampas del viaducto y desniveles del terreno.
3. **Transición y mezcla de animaciones (*Blend Trees*):**
   * Interpolación continua entre posturas de descanso, caminata, trote, carrera y giro con desaceleración inercial realista.
4. **Micro-vegetación y sombreado translúcido:**
   * Texturas foliadas con simulación de dispersión subsuperficial (*Subsurface Scattering* falso para hojas iluminadas a contraluz).

---

## 3. Presupuesto técnico y métricas de control

Para mantener la promesa de rendimiento del proyecto, cada hito debe validarse con el arnés automatizado de benchmarks (`BAZUKO_BENCH=1`):

| Parámetro / Componente | Calidad Baja (iGPU / Portátil) | Calidad Media (Recomendada) | Calidad Alta (Entusiasta / AA) |
|---|---|---|---|
| **Resolución interna** | 1.0× (nativa o 720p) | 1.0× (1080p) | 1.0×–1.5× con TAA/SMAA |
| **PBR & Normal Mapping** | Activo (Cook-Torrance simplificado) | Activo completo | Activo completo + Parallax básico |
| **Luces dinámicas activas** | Hasta 32 más cercanas | Hasta 96 en clusters | Hasta 250+ en clusters |
| **Sombras (CSM)** | 1 cascada (1024 px) | 2 cascadas (1024 / 2048 px) | 4 cascadas (2048 px) con PCF suave |
| **SSAO** | Desactivado | 8 muestras con blur | 16 muestras con reconstrucción |
| **Reflejos en lluvia** | Planar aproximado en suelo | SSR de bajo coste | SSR con fallback a cubemap |
| **Niebla volumétrica** | Exponencial analítica | Raymarching simplificado | Frustum volumétrico 3D |
| **Objetivo de FPS** | **≥ 60 FPS** | **≥ 90 FPS** | **≥ 120 FPS** (en GPU dedicada) |

---

## 4. Orden de ejecución sugerido

1. **Paso Inmediato 1:** Pasar el framebuffer principal a `GL_RGBA16F` e integrar **ACES Tone Mapping** en `present.frag`. Permite contrastes inmediatos de iluminación cinematográfica sin romper nada existente.
2. **Paso Inmediato 2:** Habilitar cálculo de tangentes en `Model.cpp` y agregar soporte de **Normal Maps** en `default.vert` / `default.frag`.
3. **Paso Inmediato 3:** Refinar la física de `m_Wetness` para que el suelo moje su rugosidad y genere reflejos especulares nítidos durante lloviznas y aguaceros.
4. **Paso Estructural:** Implementar la rejilla de **Clustered Shading** para liberar el potencial lumínico nocturno de Bogotá.
5. **Paso de Pulido:** Añadir el pase de **SSAO** para asentar todos los objetos sólidamente en el escenario urbano.

---

## 5. Estado de ejecución

Medición con el mismo método que el benchmark de la paridad (`BAZUKO_BENCH=1`, 1920×1009, resolución fija, 600 cuadros, una corrida por configuración, RTX 3050 Laptop y Radeon integrada). Referencia anterior a este plan: RTX 187 / 172 / 141 FPS y Radeon 87 / 66 / 47 FPS en calidad baja / media / alta, de día.

| Paso del plan | Estado | Qué se hizo |
|---|---|---|
| 1. HDR + ACES | Hecho | El juego dibuja siempre en un buffer de coma flotante R11G11B10F (4x MSAA; RGBA16F con `BAZUKO_HDRFORMAT=16`) y `present.frag` pasa a lineal, aplica ACES (ajuste de Narkowicz), vuelve a sRGB y tramado. La niebla y los filtros de color se siguen calculando en el espacio anterior para conservar el aspecto. `BAZUKO_NOHDR=1` lo desactiva. |
| 2. Mapas de normales | Hecho | `Vertex` lleva una tangente (vec4); se calcula desde las UV (o se lee del archivo) cuando el material trae mapa de normales, en los cargadores cgltf y Assimp; `default.vert`/`default.frag` arman la base TBN. `BAZUKO_NONORMALMAP=1` lo desactiva. Pendiente: mapas empaquetados ORM y relieve de asfalto, andenes y adoquines (no tienen textura de normales). |
| 3. Suelo mojado | Hecho | Charcos con ruido, rugosidad hasta 0,02 y reflejo del sol, del cielo y de las luces locales en superficies horizontales; ondas de gotas sobre los charcos. Es un reflejo analítico: no hay SSR. |
| 4. Clustered shading | Hecho | Rejilla de 16×9×24 con profundidad logarítmica; las luces se asignan a las celdas en la CPU y cada fragmento solo evalúa las de su celda. Hasta 256 luces (farolas, faros de los vehículos, balizas): presupuestos de 32 (baja), 96 (media) y 250 (alta). |
| 5. SSAO | Hecho | La profundidad multimuestra se resuelve a una textura; el SSAO se calcula a media resolución (6 muestras en media, 12 en alta), con la normal sacada de las derivadas de la posición, y se desenfoca con una caja de 4×4. Se multiplica en `present.frag` antes de ACES. No hay SSAO en calidad baja. |
| Bloom | Hecho | Cadena de 5 niveles que parte de un cuarto de resolución (filtro de 13 muestras al bajar y de tienda al subir); solo pasan los brillos por encima de 1. Fuerza 0,04 (media) y 0,06 (alta). |
| Rayos de luz | Hecho (parcial) | Desenfoque radial del cielo visible hacia el sol, solo en calidad alta y con el sol delante de la cámara, bajo y poco nublado. No es niebla volumétrica: no hay conos de luz de faros ni de farolas en la niebla. |
| Sombras en tres cascadas | Hecho | Mapa cercano (40 a 60 m), lejano (1024 px, 170 m, se rehace cada 90 cuadros con lo dibujado ese cuadro más la ciudad estática) y «ultra» (1024 px, 450 m, solo geometría estática, se rehace al moverse un cuarto del radio o al girar el sol). Las dos últimas solo en calidad alta. Los edificios lejanos proyectan sombra sobre toda la ciudad. Lo que queda detrás de la cámara y es dinámico sigue sin proyectar en los mapas lejanos. |
| Reflejos en pantalla (SSR) | Hecho | Calidad media: el rayo reflejado se traza contra el color y la profundidad del cuadro anterior, con la normal analítica del charco. Calidad alta: G-buffer (segundo destino de color multimuestra con normal octaédrica y reflectividad por pixel) y pasada a media resolución con 28 pasos y refinamiento binario, que respeta las ondas de la lluvia. El G-buffer cuesta 6 a 8 % en la Radeon, por eso solo se usa en alta. Todo se apaga solo cuando el juego baja la resolución por carga. |
| Niebla por altura, volumétrica y haces de los faros | Hecho | La niebla se espesa cerca del suelo con la bruma (`SetHeightFog`); los faros de los vehículos dibujan conos translúcidos que se ven con niebla, lluvia o poca luz (hasta 8 en media y 20 en alta). En calidad alta, con bruma o lluvia, `volfog.frag` recorre a media resolución cada rayo de vista (14 pasos con vibración) desde la cámara hasta la superficie usando la profundidad y el mapa de sombras del sol: los edificios y el viaducto dejan haces de luz y la escena se ve a través de la niebla (transmitancia). No dispersa la luz de las farolas ni de los faros (eso lo hacen los conos). |
| Decals | Hecho | `Decals`: manchas de aceite, grietas y mugre en el suelo, grafitis en las caras de edificios y muros que dan a la calle (firmas de trazos con contorno, brillo y chorreones) y afiches en paredes y postes de luz; unos 360 en total, repartidos por un hash de cada baldosa, edificio y poste. Todo con texturas generadas en código y mezcla alfa. Los afiches de los postes se orientan hacia la calle. |
| Pies con IK | Hecho (inclinación y cadera) | En rampas del viaducto y de la estación la punta del pie sigue la pendiente real que recorre el personaje (suavizada) y la cadera baja hasta 10 cm al bajar y un poco al subir; vale para el jugador y para los peatones. No hay IK de dos huesos que busque el suelo bajo cada pie ni ajusta escalones; `BAZUKO_NOFOOTIK=1` lo desactiva. |
| Mezcla de animaciones | Hecho (arranque y frenado) | La mezcla de caminar y correr por velocidad ya existía; ahora el reposo se mezcla con la caminata por debajo de 1,1 m/s en vez de cambiar de golpe. Los peatones siguen con clips sueltos. |

Sombras propias: el sesgo de las sombras bajó de 1,5 / 2,5 texeles de desplazamiento y 0,0004 de profundidad a 0,5 / 1,0 y 0,00025, y el `polygonOffset` del mapa de 2 / 4 a 0,8 / 1,6. Con valores más bajos (0,2 / 0,4 y 0,00015) aparecen rayas de moiré en el coche y las paredes, y con sol bajo en el suelo; con los actuales no. La mejora es moderada: las piezas pequeñas (parachoques, huecos de ruedas, el contenedor) se sombrean mejor a sí mismas, pero el ambiente sigue siendo alto y el contraste de una cara en sombra con una iluminada es bajo. `BAZUKO_SHADOW_BIAS=base,pendiente,profundidad`, `BAZUKO_SHADOW_POLY=factor,unidades` y `BAZUKO_DEBUG_SHADOW=1` (muestra solo el término de sombra) sirven para ajustarlo.

Interruptores de prueba: `BAZUKO_NOHDR`, `BAZUKO_NONORMALMAP`, `BAZUKO_NOPOST` (sin SSAO, bloom ni rayos), `BAZUKO_POST_MODE=ao|bloom`, `BAZUKO_NOSSR` (apaga ambos SSR), `BAZUKO_NOVOLFOG`, `BAZUKO_NODECALS`, `BAZUKO_NOBEAMS`, `BAZUKO_NOFARSHADOW`, `BAZUKO_NOFOOTIK`, `BAZUKO_IK_SLOPE=<grados>` y `BAZUKO_HDRFORMAT=16` (buffer RGBA16F en vez de R11G11B10F).

### Rendimiento medido (FPS medios, de día)

| GPU | Calidad | Antes del plan | Con todo (final) |
|---|---|---|---|
| RTX 3050 | Baja | 187 | 157 |
| RTX 3050 | Media | 172 | 146 |
| RTX 3050 | Alta | 141 | 106 |
| Radeon integrada | Baja | 87 | 74 |
| Radeon integrada | Media | 66 | 53 |
| Radeon integrada | Alta | 47 | 33 |

- Las corridas varían alrededor de ±8 % (el portátil se calienta durante las mediciones): en calidad baja de la RTX, cuatro corridas seguidas dieron 167, 165, 157 y 150; los decals no son la causa.
- Recuperación de rendimiento: el buffer HDR pasó de RGBA16F a R11G11B10F (+2 a +3 %, sin diferencia visible en los niveles del cielo), el bloom parte de un cuarto de resolución, el SSAO usa 6 y 12 muestras, y SSAO, bloom y reflejos se apagan solos cuando el juego ya está bajando la resolución por carga.
- La sombra lejana cuesta unos 3 % en la RTX y nada medible en la Radeon (111 frente a 114 y 35 frente a 35 con `BAZUKO_NOFARSHADOW=1`); cada actualización dibuja unas 1900 mallas, así que puede notarse como un pequeño tirón cada 1,5 s en calidad alta.
- Objetivos del plan: con la RTX la calidad media supera 90 FPS y la alta queda en 106 (objetivo 120); con la Radeon la calidad baja supera 60 y la media y la alta no.
- Son muestras de este equipo (una corrida por configuración): no garantizan lo mismo en otro.

### Lo que sigue sin hacerse

- **Sombra dinámica detrás de la cámara en los mapas lejanos:** los mapas lejano y ultra se alimentan de lo dibujado en el cuadro y de la geometría estática; vehículos y personajes fuera de la vista no proyectan en ellos.
- **SSR con rugosidad por pixel y fallback a cubemap:** el G-buffer ya guarda normal y reflectividad, pero no rugosidad ni sonda de reflejo para lo que no está en pantalla.
