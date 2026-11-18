# Investigación (Fase 0): mejorar las animaciones del port

Todas las incógnitas del contexto técnico quedan resueltas aquí. Las afirmaciones de licencia se marcan con su grado de verificación.

## R1. ¿De qué fuentes sale el movimiento nuevo?

**Decisión**: tres fuentes, en este orden de preferencia.

1. **Quaternius Universal Animation Library 1 y 2 (CC0)**, y el lote de 51 clips CC0 de Quaternius que el proyecto ya exportó con ActionForge sobre el esqueleto de 52 huesos.
2. **Base de captura de movimiento de CMU (BVH)**, solo para lo que Quaternius no cubra.
3. **Animación propia hecha a mano** para lo que ninguna biblioteca trae.

**Fundamento**
- *Quaternius UAL*: la página oficial declara CC0 y «libre para proyectos personales, educativos y comerciales» (verificado en la página oficial). La biblioteca 1 trae locomoción en 8 direcciones, trote, sprint, empujar, gatear, nadar, sentarse y muerte. La biblioteca 2 añade combos cuerpo a cuerpo y parkour (fuente: descripción de la página y prensa; **no pude confirmar clip por clip** y la versión gratuita («Standard») trae solo alrededor del 70 %). El contenido exacto se confirma abriendo el visor de animaciones de Quaternius en la tarea de inventario.
- *ActionForge*: ya está en el proyecto. Su documentación (`docs/animaciones-actionforge.md`) dice que su biblioteca es CC0 y que el archivo original tiene 51 clips sobre el mismo esqueleto `mixamorig:*` de 52 huesos; solo 8 se usan hoy. Verificar la licencia directamente en la página de ActionForge antes de incorporar clips nuevos.
- *CMU*: su preguntas frecuentes oficiales dicen que los datos «pueden ser copiados, modificados o redistribuidos sin permiso» (verificado en la página oficial; el certificado de la página falla, por eso lo leí sin verificar el certificado, solo para texto público). Piden dar crédito a la fuente. Fuentes secundarias coinciden en que se permite el uso comercial; una entrada de blog sin fuente dice lo contrario, así que **se cita la frase oficial y se guarda copia de la página en el registro de licencias**. Cuidado: las conversiones comunitarias a FBX pueden traer otra licencia (por ejemplo CC BY-NC); se usan solo los BVH originales.
- *Propia*: para lo que no existe en captura libre: la captura policial (dos personajes), usar la pipa de basuco, robar el retrovisor y oler el pegante.

**Alternativas descartadas**
- **Mixamo** (Adobe): permite uso comercial y regalías cero, y no pide atribución, pero prohíbe redistribuir los archivos de animación como recurso suelto (fuente: foros de Adobe que citan sus preguntas frecuentes; no pude leer la página oficial, devolvió 403). El repositorio del juego es público y lleva los clips dentro, así que **no se añaden clips nuevos de Mixamo**.
- **MotionBricks** (NVIDIA): probado en este proyecto. Funciona en la GPU del usuario y su licencia de modelo permite uso comercial, pero las poses de partida de ejemplo tienen licencia solo de evaluación, exige GPU NVIDIA con TensorRT en quien lo corra, usa otro esqueleto y la salida no ha demostrado ser mejor que un clip de captura. Se deja como línea de investigación aparte y **no forma parte de este plan**.
- **Conjuntos de datos académicos** (AMASS, LAFAN1, Bandai Namco): licencias no comerciales o de investigación.

**Riesgo detectado fuera de este alcance**: `andar-erguido.glb` y `andar-cansado.glb` salen de Mixamo, y se publican en el repositorio. Conviene que el usuario revise si eso cumple las condiciones de Mixamo; este plan no los toca.

## R2. ¿Cómo se lleva un clip ajeno al cuerpo del juego?

**Decisión**: reorientar cada clip, hueso por hueso, al esqueleto de 52 huesos con el método que ya usa el proyecto (`cpp/tools/agregar_correr_mixamo.py`): `giro_destino = (giro_pose_origen · giro_reposo_origen⁻¹) · giro_reposo_destino`, con altura de cadera escalada y **sin avance horizontal**.

**Fundamento**: ya probado en el proyecto para el clip de correr; los esqueletos de ActionForge/Mixamo comparten nombres de hueso y solo difieren en la postura de reposo. Para fuentes con otros nombres de hueso (CMU, Quaternius UAL) se añade una tabla de correspondencia de huesos por fuente.

**Alternativa descartada**: retargeteo por direcciones (apuntar cada hueso hacia la misma posición que el original). Se probó con el clip de MotionBricks; pierde el giro de antebrazos, muñecas y pies, que en caminar y correr se nota.

## R3. ¿Saltos por clip o por código?

**Decisión**: conservar el control por código de las fases (despegue, vuelo, caída, aterrizaje, según `JumpMoves.hpp`) y sustituir las **poses** de cada fase por poses tomadas de clips de captura (parkour de Quaternius UAL 2), de modo que la física siga mandando sobre el tiempo y la altura.

**Fundamento**: la altura y la distancia del salto las gobierna la física del juego (0,66 m, 1,3 veces la velocidad de carrera); un clip fijo desfasaría pies y suelo. Las poses clave de captura aportan naturalidad sin atar el tiempo.

**Alternativa**: reproducir el clip completo con su duración. Se prueba solo en el lote 1 si las poses por fase no alcanzan.

## R4. ¿Cómo se juzga «mejor»?

**Decisión**: cada lote produce un GIF lado a lado (actual / nuevo) desde la misma cámara y las mismas condiciones, más capturas dentro del juego, y el usuario aprueba o pide cambios (criterio SC-001 de la especificación). Los criterios medibles (pies sin deslizar, costo, transiciones) se comprueban con pruebas automáticas.

**Fundamento**: lo que se evalúa es una impresión visual; la herramienta de comparación ya existe (`BAZUKO_PREVIEW_CLIP`, `BAZUKO_PREVIEW_TIME`, captura de pantalla del juego) y funcionó en la prueba con el clip generado.

## R5. Costo de los NPC y tamaño del banco

**Decisión**: los clips nuevos entran al banco compartido de 52 huesos (24 cuadros por segundo) y los NPC siguen usando el cuerpo de detalle reducido que comparte los clips ya preparados; **no se crea animación por instancia**. Presupuesto de tamaño: el banco actual pesa 3,6 MB y no debe superar 10 MB.

**Fundamento**: ya es la arquitectura del port; mantiene SC-003 (menos del 5 % de pérdida de cuadros por segundo).

## R6. Vehículos con modelos restringidos

**Decisión**: no se producen clips de entrar, salir ni intercambiar para los modelos restringidos del proyecto (los de la memoria del proyecto), aunque el banco actual lleve variantes para ellos (`*_raptor`, `*_renault6`).

**Fundamento**: el port no carga ni publica esos modelos; hacer animación específica para ellos sería trabajo muerto.

## R7. Constitución del proyecto

`.specify/memory/constitution.md` es todavía la plantilla sin rellenar, así que no hay puertas formales. Las reglas que aplican se toman de `AGENTS.md` y se listan en la comprobación del plan.
