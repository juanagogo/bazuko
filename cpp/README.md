# Bazuko C++ (OpenGL 4.5 Core DSA)

Puerto nativo en C++20 del juego de supervivencia urbana 3D **Bazuko**, ambientado en el centro de Bogotá.

## Arquitectura y Decisiones Técnicas

1. **OpenGL 4.5 Core Profile con Direct State Access (DSA)**:
   - Evita el paradigma clásico de *bind-to-edit* propenso a errores de estado global.
   - Creación y configuración directa de búferes (`glCreateBuffers`, `glNamedBufferData`, `glNamedBufferSubData`).
   - Vertex Arrays desacoplados (`glCreateVertexArrays`, `glVertexArrayVertexBuffer`, `glVertexArrayAttribFormat`), cuya estructura mapea casi 1:1 a los formatos de entrada de Vulkan (`VkVertexInputAttributeDescription`).
   - Uniform Buffer Objects (UBOs) para Cámara, Luces y paletas de hasta 128 huesos (`CameraBlock`, `LightBlock`, `SkinBlock`).
2. **Compatibilidad con Vulkan a futuro**:
   - Capa de abstracción limpia en `src/renderer/`: `Buffer`, `VertexArray`, `Shader`, `Mesh`, `Camera`, `Renderer`.
   - La lógica de juego y el mundo en `src/world/` no realizan llamadas directas a la API gráfica.
3. **Bibliotecas clave**:
   - **Ventana & Contexto**: GLFW 3.4
   - **Loader OpenGL**: GLAD2 (OpenGL 4.5 Core)
   - **Matemáticas**: GLM (vectores, matrices, proyecciones)
   - **Interfaz Gráfica**: Dear ImGui (señalización informativa azul con acentos amarillos)
   - **Formatos y Modelos**: stb_image, cgltf, miniaudio, libopusfile, nlohmann/json

## Estructura del Proyecto

```
cpp/
├── CMakeLists.txt
├── assets/
│   └── shaders/
│       ├── default.vert       # GLSL 450 Core con UBOs de cámara y modelo
│       └── default.frag       # Iluminación difusa, ambiente y niebla atmosférica
├── src/
│   ├── main.cpp               # Bucle principal de juego
│   ├── core/
│   │   ├── Window.hpp/.cpp    # Manejo de ventana GLFW y contexto OpenGL 4.5 Core
│   │   ├── Input.hpp/.cpp     # Entrada de teclado, mouse, deltas y pointer lock
│   │   ├── Clock.hpp          # Delta time y tiempo transcurrido de alta precisión
│   │   └── Log.hpp            # Logging estructurado por niveles
│   ├── renderer/
│   │   ├── GL.hpp             # Loader GLAD y callbacks de depuración OpenGL
│   │   ├── Buffer.hpp/.cpp    # VertexBuffer, IndexBuffer, UniformBuffer (DSA)
│   │   ├── VertexArray.hpp/.cpp # VertexArray (DSA)
│   │   ├── Shader.hpp/.cpp    # Compilador y vinculador GLSL 450
│   │   ├── Mesh.hpp/.cpp      # Estructura de vértices y generadores de primitivas
│   │   ├── Camera.hpp/.cpp    # Cámara en tercera persona e isométrica con suavizado
│   │   └── Renderer.hpp/.cpp  # Pipeline de renderizado por pases y sombreado
│   ├── ui/
│   │   └── UIManager.hpp/.cpp # Integración Dear ImGui con tema oscuro bogotano
│   └── world/
│       └── CityLayout.hpp/.cpp# Grilla urbana de Bogotá (carreras, calles, andenes, edificios)
└── third_party/               # GLAD, stb_image, cgltf, miniaudio, nlohmann/json
```

## Compilación y Ejecución

Un solo `CMakeLists.txt` para Windows y Linux. GLFW, GLM, Dear ImGui, libwebp, libogg, libopus y libopusfile se descargan y compilan solos
(FetchContent) si no están instalados; no hace falta `WEBP_ROOT` ni instalar nada más que el compilador.
El proyecto debe quedar dentro del repositorio (`bazuko/cpp`) para que encuentre `../public` (modelos y audio).

### Linux / WSL2 (Ubuntu)

```bash
sudo apt install build-essential cmake ninja-build pkg-config libx11-dev libxrandr-dev libxinerama-dev \
                 libxcursor-dev libxi-dev libgl1-mesa-dev
cd cpp
cmake -S . -B build -G Ninja
cmake --build build -j
./build/bazuko
```

### Windows (Visual Studio 2022 con "Desarrollo para el escritorio con C++")

```powershell
cd cpp
cmake -S . -B build
cmake --build build --config Release --parallel
.\build\Release\bazuko.exe
```

En Windows, el ejecutable se inicia como aplicación gráfica (sin ventana de consola). La pantalla de carga
actualiza el progreso al completar la carga de los modelos de peatones y del personaje.

### Emisoras de radio

Las emisoras disponibles se configuran en `assets/radio_stations.json`. Para añadir una, agrega un objeto a
`stations` con un `id` único, `name`, `frequency`, `genre`, `program` y `url`. La URL puede quedar vacía para
emisoras ficticias; la selección ya funciona en el menú de pausa (`R`), pero la reproducción de streams online
aún no está implementada. El mismo archivo incluye instrucciones y un ejemplo de los campos.

### Windows desde WSL (compilación cruzada con MinGW-w64)

```bash
sudo apt install mingw-w64 cmake ninja-build
cmake -S . -B build-win -G Ninja -DCMAKE_TOOLCHAIN_FILE=toolchain-mingw64.cmake -DCMAKE_BUILD_TYPE=Release
cmake --build build-win
# build-win/bazuko.exe + build-win/assets/ (copia ambos junto a la carpeta public/)
```

### Dónde busca los recursos

El juego localiza `assets/` (shaders, fuente de los rótulos) y `public/` (modelos y audio) junto al ejecutable,
en las carpetas superiores y en el directorio actual, así que arranca desde `build/`, `build/Release/` o con doble clic.
Para indicar otra carpeta: `bazuko --public <ruta a public/>` o la variable `BAZUKO_PUBLIC`.
Con `-DBAZUKO_COPY_PUBLIC=ON` se copia `public/` junto al ejecutable (~50 MB) para llevarlo a otro equipo.

### Ratón en WSL2

WSLg no entrega bien el modo de cursor oculto/bloqueado de GLFW, por eso la cámara con el ratón puede fallar allí.
En WSLg se puede girar la cámara arrastrando con un botón del ratón o con las flechas. En Windows nativo
(compilado con MSVC o MinGW) el ratón funciona con normalidad.

### Controles iniciales:

- `W`, `A`, `S`, `D`: Moverse por las calles y andenes de la ciudad.
- `Shift`: Correr.
- `Q`: Recoger un objeto cercano; junto a un peatón, intentar un robo directo; junto al dealer, abrir su catálogo.
- `E`: Interacción contextual; hablar, acercarse al perro, comprar, vender reciclables en la recicladora, vender sustancias al dealer de noche, robar espejos o usar un consumible.
- `Z`: Hacer popó; consume hambre e higiene y deja un mojón en el suelo.
- `X`: Lanzar un mojón del costal; si no tienes uno, hace popó.
- `F`: Entregar reciclables para la misión, únicamente en la recicladora.
- `C`: Abrir/cerrar el crafteo; fabrica objetos si tienes ingredientes.
- `I`: Abrir/cerrar el inventario; usar, soltar u ordenar objetos. El mundo queda en pausa mientras está abierto.
- `T`: Abrir/cerrar el árbol de talentos; los puntos se obtienen al subir de nivel.
- `O`: Abrir/cerrar la ficha de El Chato; editar su nombre y pelaje, y acariciarlo.
- `B` / `L`: Pedir limosna.
- `R`: Abrir o cerrar la radio.
- `N`: Mostrar u ocultar el radar.
- `P`: Abrir el creador y personalizador del personaje.
- `Tab`: Capturar o liberar el cursor; al estar libre, clic izquierdo o derecho lo captura. También se puede girar la cámara arrastrando.
- `Flechas`: Girar la cámara; `Rueda del mouse`: acercar o alejar.
- `F11`: Alternar pantalla completa.
- `Esc`: Cerrar directamente el menú abierto; desde el menú principal de pausa, continuar jugando.
- Acércate a la basura o pulsa `Q` junto a ella para recogerla.
- Usa un vendaje con `E` para curar salud y un antibiótico para curar enfermedades.
- Acércate a la recicladora y pulsa `E` para vender materiales reciclables; los objetos de construcción, consumibles, medicinas y sustancias no se reciben. Usa `F` allí para entregar materiales de la misión.
- Acércate al dealer y pulsa `E` o `Q` para comprar tintico, pegante o pastillas. Si llevas sustancias durante la noche, `E` las vende en vez de abrir el catálogo.
- Acércate a una fachada y pulsa `E` para comprar comida, bebidas, medicinas, artículos de higiene o materiales.
- Acércate a una chaza o fritanga de la acera y pulsa `E` para comprar café, pan, agua, comida enlatada o refresco; la oferta depende del puesto.
- Acércate a un auto y pulsa `E` para intentar robarlo; te pueden atrapar.
- Junto a un peatón, usa `E` para intentar un cosquilleo o `Q` para un robo directo; el peatón puede huir o defenderse.
- Junto a un auto estacionado, usa `E` para robar sus retrovisores. Los mojones lanzados pueden impactar a peatones y hacerlos huir.
- Habla con el NPC junto a la recicladora usando `E`; entrega 5 reciclables allí con `F` para cobrar la misión.
- Los semáforos controlan los accesos de las rutas de tráfico a la avenida principal, se ubican en aceras libres y miran hacia los vehículos que se aproximan. Sus ciclos incluyen 14 s de verde, 3 s de amarillo y el despeje en rojo; el frenado respeta la línea de parada.
- También puedes fabricar arma, mochila, curitas y cartón de rifa con `C` si consigues sus materiales.
- `V`: Alternar entre cámara en Tercera Persona y Vista Isométrica.
- `Click izquierdo`: Bloquear cursor para mirar alrededor (estilo juego de acción 3D).
- `Tab`: Bloquear o liberar cursor del mouse.
- `Rueda del mouse`: Zoom de la cámara.
- `Esc`: Liberar cursor o salir.

## Animación y población

El personaje usa los clips `Idle`, `Walk` y `Run` de `public/models/animaciones-prueba.glb`. Se emparejan huesos Mixamo por nombre para las piezas de cuerpo, chaqueta, tenis y pelo; el render aplica `JOINTS_0`, `WEIGHTS_0` y las matrices inversas de bind del glTF. Los peatones eligen destinos alcanzables y siguen rutas de cuadrícula limitadas a aceras, plazas y zonas verdes; no atraviesan edificios para llegar a un punto aleatorio. Los vehículos circulan por circuitos cerrados construidos sobre cruces reales, mantienen distancia y frenan ante el jugador, peatones y semáforos; las fases de los semáforos coordinan el paso de las rutas.

La simulación también incorpora llovizna con partículas y audio, árboles procedurales en los parques, palomas que levantan vuelo al acercarse una persona y a El Chato como compañero: se le puede hacer amistad con `E`, seguir al jugador, acariciar y personalizar desde `O`. El inventario, los talentos y el estado del compañero se guardan junto con la partida. Los vehículos usan colisiones orientadas entre sí y con el jugador; el bus también bloquea el paso. Solo el contacto con el frente de un vehículo en movimiento atropella al personaje y activa un ragdoll articulado con gravedad, restricciones entre extremidades y fricción contra el suelo. El contacto lateral o trasero bloquea el paso sin iniciar la caída.

El HUD muestra el porcentaje de hambre, sed, energía, salud, higiene, ánimo y vicio sobre cada barra; los estados bajos cambian a amarillo y los críticos a rojo. Hambre, sed, energía, higiene y vicio bajan con el tiempo; pasar hambre o sed hasta cero daña la salud, mientras que la enfermedad la drena y también puede bajar el ánimo. La higiene baja aumenta el riesgo de enfermar al rebuscar; el talento de supervivencia reduce ese riesgo. El ánimo bajo y la abstinencia reducen la velocidad, y la energía agotada la reduce aún más. La salud se regenera lentamente cuando las demás necesidades están atendidas y no hay enfermedad activa.

Consumir comida, agua, café, refrescos, productos de higiene, curas o sustancias modifica las necesidades correspondientes, incluido el ánimo y la energía cuando aplica. Correr y pedir limosna consumen energía; el rechazo por falta de higiene y ser ignorado afectan el ánimo. Acariciar o hacer amistad con El Chato, vender reciclaje, encontrar un objeto raro o acertar con un mojón pueden recuperarlo. Mantén las necesidades por encima de los umbrales críticos y usa vendajes si la salud aparece en rojo.

Los atropellamientos descuentan salud según la velocidad del vehículo (`0.6 × velocidad² + 1.5 × velocidad`, mínimo 4, máximo 100), reducen la energía en una cuarta parte del daño y tienen 1,5 s de enfriamiento. Si la salud llega a cero, el personaje termina su caída antes de mostrar la pantalla de recuperación. Al volver, reaparece en el andén libre más cercano al cambuche (nunca dentro de un edificio o sobre un vehículo); todas las necesidades quedan al menos en 60 %, se curan las enfermedades y se pierde la mitad redondeada hacia abajo de los tipos de objeto del inventario. La partida se guarda en ese estado.

La ciudad incluye cinco fachadas urbanas procedurales —ladrillo con balcones, concreto con bandas, marcos verticales, torre retranqueada y esquina acristalada— en lotes de edificios con frente a andenes o vías. No hay modelos 3D de edificios entre los recursos del proyecto; estas fachadas se construyen con geometría nativa y conservan la cuadrícula y colisiones de la ciudad.

La pantalla de carga usa las cuatro parejas WebP de `public/images/pantalla-carga/`, separa el fondo del personaje para componerlos a pantalla completa y cambia de ilustración mientras prepara el mundo. El avance y los consejos de carga permanecen visibles sobre un degradado oscuro; si falta una ilustración, el juego continúa con el fondo de respaldo.

Los peatones y el personaje jugable usan las piezas modulares de las seis combinaciones de cuerpo; sus clips de reposo, caminata y carrera se retargetean desde `animaciones-actionforge.glb`, con `animaciones-prueba.glb` como respaldo. Los GLB de carros, taxi, TransMilenio, cambuche, bolsas, canecas, lámparas y semáforos se cargan con sus texturas embebidas y sus dimensiones/orientaciones del proyecto web. Los vehículos conservan sus rutas, frenado, colisiones, fases de semáforo y desplazamiento; las doce canecas permanentes mantienen su botín y enfriamiento de 120 segundos. El terminal de buses continúa con su geometría nativa; no se carga el GLB antiguo de estación. El Chato y las palomas siguen usando mallas procedurales porque no hay modelos 3D propios de ellos en `public/models`.

El audio decodifica los archivos Ogg Opus del proyecto original mediante libopusfile; mezcla motores y ralentí de carros y bus, bocinas, alarma, pasos, ambiente y voces de conductores y robos, con alcance, volumen, pausado y enfriamientos coordinados con la simulación. Si un recurso Opus no está disponible o falla al decodificarse, se informa en la salida del juego y los motores y bocinas conservan un sonido sintetizado de respaldo.

Para comprobar que todos los recursos Opus incluidos se decodifican:

```powershell
cmake -S . -B build -DBAZUKO_BUILD_OPUS_TESTS=ON
cmake --build build --config Debug --parallel
ctest --test-dir build -C Debug --output-on-failure
```

## Licencias de terceros

- `assets/fonts/Roboto-Medium.ttf`: Apache 2.0 (Google), tomada de Dear ImGui. Se usa para los rótulos de las fachadas.
