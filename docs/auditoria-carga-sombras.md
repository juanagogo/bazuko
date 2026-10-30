# Auditoría de carga, sombras y recorrido — 26 de octubre de 2026

Base: `1c34e57`; cambios en `pruebas-slop-actualizacion`. Referencia inspeccionada:
Slop New York `09361be1fe6a2efaee6ef62420a664c677e577b9`, `js/main.js` y
`js/scene-culling.js`. Three.js sigue en 0.186.1, con WebGPU y Vite.

## Causas verificadas y correcciones

1. **Preparación duplicada.** `compileAsync` de Three 0.186 selecciona un contexto
   de render de profundidad 0; el pase de escena dentro de RenderPipeline se dibuja
   en profundidad 1. Además, el render vacío del posprocesado dejaba en caché una
   clave de luces sin la ciudad. La compilación no incrementa `info.calls` y esa
   clave podía seguir usándose. La primera pasada completa descartaba miles de
   RenderObjects recién preparados. Ahora la preparación utiliza el contexto MRT
   real, inicializa la cuadrícula de luces agrupadas e invalida esa clave temporal.
   El adaptador restaura inmediatamente el método de selección de contexto, también
   ante fallo; no cambia los contextos usados por los cuadros normales.
2. **Miles de recorridos durante la carga.** Cada llamada a `compileAsync` recorría
   la escena para recoger luces. Ahora se preparan lotes de hasta 64 objetos por
   familia, con 16 trabajos simultáneos como límite. Se conservan los objetos,
   padres, matrices, materiales y vinculaciones individuales. No basta con
   compilar un representante. Los contadores diferencian familias, lotes,
   RenderObjects, programas y pipelines.
3. **Detalle de árboles preparado demasiado tarde.** La selección de LOD ocultaba
   bancos que aparecían al conducir. Entonces se construían grafos/pipelines por
   primera vez. La carga prepara explícitamente esos bancos, incluidas sus variantes
   de sombra, sin modificar la distribución, cantidad, LOD ni matrices de árboles.
   Sus estados visibles se restauran incluso si falla la preparación. Las
   ocultaciones ajenas a esos bancos siguen respetándose.
4. **Código de shader distinto para bancos equivalentes.** Los nombres generados
   de buffers de matrices hacían diferentes programas que realizaban lo mismo.
   Se estabiliza solo el nombre del buffer de matrices del InstancedMesh. Cada banco
   conserva su propio atributo, datos y binding; no comparte transformaciones con
   otro banco. Se emplean atributos de almacenamiento también en bancos pequeños,
   siguiendo el código del donante, evitando sus subidas redundantes como uniformes.
5. **Transformaciones repetidas por cada cascada.** La raíz inmóvil de la escena
   actualizaba su matriz identidad automáticamente y forzaba el recorrido de ramas
   congeladas. Ahora la raíz conserva su matriz y las transformaciones del mundo se
   actualizan una vez por cuadro, antes de la vista y las dos cascadas. Personajes,
   ruedas, vehículos y objetos móviles siguen actualizándose cada cuadro.
6. **Sondas de tráfico repetidas.** Cada prueba de distancia recalculaba orientación
   y trigonometría del otro vehículo. Ahora cada subpaso conserva esos valores junto
   al índice espacial que ya consultaban todos los conductores antes de moverse.
   El siguiente subpaso los renueva. Se conserva el filtro de altura de los buses,
   las prioridades, las colisiones y las velocidades.

No se desactivan sombras, SSR, bloom, población ni modelos para obtener estas
mejoras. Golden hour sigue dibujando dos mapas de sombras; esto tiene un costo real.
No se alterna la cascada lejana entre cuadros: una prueba anterior produjo defectos
en movimiento. Tampoco se modifica el almacenamiento MSAA que necesita la silueta.

## Protocolo reproducible

`tools/performance-audit.mjs` abre Edge con GPU, usando la compilación de producción,
1280 × 720, DPR 1, calidad alta fija, adaptación bloqueada y semilla 44117. Crea una
partida temporal en un contexto aislado: no toca el guardado del navegador habitual.
Cada repetición mide una carga con caché HTTP nueva y una recarga en el mismo contexto.
La caché de shaders del controlador GPU no se vacía; «cold» no significa GPU fría.

- Carga: clic en «Empezar» hasta liberar la partida. `startup.totalMs` también incluye
  preparación anterior al clic y no se debe mezclar con esta cifra.
- Primer giro: 360° en tercera persona; otro observador registra los primeros seis
  segundos de cuadros desde `_running`, antes de los viajes de ida y vuelta de las
  herramientas de prueba.
- Vistas fijas: midday, golden y night, con sombras y sin ellas. Los tiempos CPU se
  separan de los timestamp-query de GPU.
- Recorrido: el mismo carro desde X 92, Z 20, hacia +Z durante 16 segundos, Golden
  hour, misma población y calidad. El tráfico sigue vivo: sus posiciones no son
  idénticas cuadro por cuadro entre equipos/ejecuciones. Para comparar el recorrido
  se excluyen intentos interrumpidos por choques (no alcanzan Z 135, o se desvían más
  de 2 m del eje X 92). Se conserva también el resultado bruto de esos intentos.
- Se guardan intervalos medios, p95/p99, máximo, dibujos, triángulos, memoria JS,
  contadores de compilación, perfil CPU y errores. La memoria JS no es memoria GPU.

```powershell
npm run build
$env:AUDIT_LABEL = 'after'
$env:AUDIT_RUNS = '3'
$env:AUDIT_SCREENSHOTS = '1'
node tools/performance-audit.mjs
```

La referencia se construye desde un archivo de Git de `1c34e57`, sin modificar la
rama de trabajo. `AUDIT_ROOT=work/perf-baseline-1c34e57` permite servir su `dist/`.
Los informes JSON, perfiles y capturas quedan en `test-results/performance-<label>/`,
fuera de Git. `AUDIT_PROFILE_STARTUP=1` añade un perfil CPU de carga y primer giro;
no se mezcla esa modalidad con las mediciones normales de carga.

## Resultados de producción

Equipo de la prueba: Windows, NVIDIA GeForce RTX 4060 (controlador 32.0.16.1714),
Edge sin interfaz, WebGPU con timestamp-query. Servidor HTTP local; estos tiempos
no miden la descarga a través de Internet. Tres cargas nuevas y tres recargas por
versión. Son medianas entre ejecuciones, salvo los máximos indicados.

| Medición | Base `1c34e57` | Corrección |
| --- | ---: | ---: |
| Carga nueva, clic → partida | 28,14 s | 20,60 s |
| Recarga con caché HTTP | 27,43 s | 19,23 s |
| Calentamiento completo, cargas nuevas | 11,57 s | 4,49 s |
| Compilación, cargas nuevas | 13,04 s | 13,83 s |
| Midday con sombras, intervalo medio | 32,0 ms | 26,1 ms |
| Golden hour con sombras, intervalo medio | 30,1 ms | 27,6 ms |
| Golden hour sin sombras, intervalo medio | 19,8 ms | 15,5 ms |
| Noche, intervalo medio | 20,2 ms | 15,9 ms |
| Peor intervalo durante el primer giro | 654,8 ms | 314,1 ms |
| Peor intervalo de los primeros 6 s de partida | 658,3 ms | 316,7 ms |
| Recorrido completo, intervalo medio | 61,1 ms | 35,6 ms |
| Recorrido completo, p95 | 75,9 ms | 46,5 ms |
| Recorrido completo, p99 | 169,0 ms | 56,4 ms |
| Recorrido completo, peor intervalo | 696,8 ms | 194,0 ms |
| Programas nuevos durante el recorrido | 24–40 | 2 |
| Construcción síncrona de nodos durante el recorrido | 1056 ms | 47 ms |

La ganancia principal de carga viene de evitar reconstrucciones durante el
calentamiento, no de atribuir una mejora inexistente a la compilación. Las cargas
nuevas variaron entre 24,78–28,74 s antes y 19,12–26,67 s después.

En Golden hour la vista conserva 711 dibujos (mediana), con 1,696 millones de
triángulos antes y 1,707 millones después; la pequeña variación corresponde a
tráfico y NPC vivos. Ambos usan calidad alta y resolución 1,00×. La mediana CPU
total baja de 28,7 a 24,7 ms; el envío de render de 22,5 a 20,8 ms y tráfico de
5,1 a 2,6 ms. El timestamp GPU pasa de 3,7 a 2,9 ms. **El hilo principal sigue
siendo el límite en esa vista; las sombras siguen teniendo un costo importante.**

Para el recorrido se comparan cinco intentos completos por versión. Se excluye
base `run=2,cold` (Z final 39,37) y corrección `run=1,cold` (Z final 74,21),
interrumpidos por choques. Los demás terminan entre Z 139,50 y 152,86; no se
presentan como trayectorias idénticas cuadro a cuadro. La memoria JS mediana al
final de esos recorridos fue 1396 MB → 1243 MB; no representa toda la memoria GPU
y depende del recolector de basura. No hubo excepciones de página ni errores de
WebGPU; ambas versiones solicitan un `favicon.ico` inexistente (404).

Los perfiles CPU se toman durante el recorrido. Detener/serializar el perfil y
capturar imágenes puede pausar el navegador después de la medición: el máximo
histórico del HUD en esas capturas incluye esa intervención y no sustituye los
intervalos registrados en JSON. Capturas: `test-results/performance-after-final/`.

Validación automatizada: **365 pruebas aprobadas** y compilación de producción
correcta. Se incluyen regresiones de contexto MRT, caché de luces, restauración
ante errores, bindings independientes, LOD ocultos, transformaciones móviles,
cola de detalle y sondas de tráfico con separación de alturas.

Revisión final del 28 de octubre: se comprobaron capturas del parque y de la calle
en tercera persona e isométrica, de día y de noche. La prueba adicional en navegador
alternó media → baja → alta → media → alta: el cielo permaneció visible y el sol
conservó intensidad 3,8 en Golden hour. Preparar media por primera vez tardó 713 ms
en total; volver a configuraciones ya listas tardó 18–24 ms. Esos tiempos de operación
no son intervalos de cuadro. La vegetación se desactivó desde DEV mientras se
preparaban variantes de efectos y se restauró con los mismos estados de los 134
bancos. Evidencia local: `test-results/performance-smoke/results.json` y capturas
de esa carpeta. Las únicas incidencias de consola fueron los 404 de favicon ya
presentes en la referencia.

## Límites restantes

La carga todavía requiere crear miles de vinculaciones y preparar sombras y
posprocesado. El donante tiene otra geometría, población, modelos y versión de
Three; sus ocho segundos no son una medición comparable. Estas correcciones no
demuestran que toda la tecnología del donante esté migrada.

El costo restante de la vista densa se concentra en el envío de objetos, uniformes
y comandos de render, además de las cascadas. Los NPC con prendas separadas y los
modelos locales aportan más dibujos que una ciudad totalmente agrupada. Cualquier
optimización adicional de esos modelos debe validar ropa, animaciones, cabello,
transparencias y ocultaciones, sin reducirlos silenciosamente.
