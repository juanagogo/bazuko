# Guía rápida de validación: cómo se revisa un lote

Escenarios que prueban que un lote funciona de punta a punta. Los formatos están en [clip-contract.md](contracts/clip-contract.md) y [license-registry.md](contracts/license-registry.md); las entidades, en [data-model.md](data-model.md).

## Requisitos previos

- El port compilado (`cmake --build cpp/build --config Release`).
- Blender 5.2 instalado (se usa sin interfaz).
- Los clips de partida (Quaternius UAL, ActionForge o CMU) descargados fuera del repositorio, con su licencia anotada en el registro.

## Escenario 1: preparar un clip y revisarlo antes de entrar al banco

1. Reorientar el clip al esqueleto de 52 huesos, en el sitio, con el script de `cpp/tools/animaciones/`.
2. Comprobar el contrato del clip con la prueba del banco: debe pasar huesos, frecuencia, cadera en el sitio, bucle cerrado y tamaño.
3. Dejar el clip como `<Nombre>_nuevo` en una copia del banco, sin tocar el banco del repositorio.
4. Verlo en el juego apuntando a esa copia con `BAZUKO_PUBLIC=<carpeta>`, `BAZUKO_PREVIEW_CLIP=<Nombre>_nuevo` y `BAZUKO_PREVIEW_TIME=<segundo>`; se toma una captura con `BAZUKO_SHOT`.

**Resultado esperado**: el clip se ve en el personaje sin deslizar los pies y sin desplazarse por su cuenta.

## Escenario 2: comparación de antes y después de un lote

1. Generar, para cada movimiento del lote, un GIF lado a lado (actual / nuevo) con la misma cámara.
2. Añadir capturas del juego del mismo recorrido con el clip actual y con el nuevo.
3. Entregarlos al usuario con el estado del lote en `en revision`.

**Resultado esperado**: el usuario decide por movimiento: aprobar o pedir cambios.

## Escenario 3: aprobación y paso al siguiente lote

1. Con la aprobación del usuario, los clips `_nuevo` toman el nombre original en el banco del repositorio.
2. Se actualizan la documentación del banco, el registro de licencias y las capturas que lo describen.
3. El lote pasa a `aprobado` y puede empezar el siguiente.

**Resultado esperado**: sin aprobación no se avanza; el banco del repositorio no cambia antes de la aprobación.

## Escenario 4: cuadros por segundo con los NPC

1. Correr el recorrido de referencia con 80 peatones y 8 vendedores, antes y después del lote.
2. Medir cuadros por segundo en las mismas condiciones.

**Resultado esperado**: la pérdida es menor al 5 % (SC-003).

## Escenario 5: licencias

1. Recorrer cada clip de captura del banco y comprobar que tiene su sección en `cpp/docs/animaciones-licencias.md`.

**Resultado esperado**: ningún clip de captura sin registro (SC-004).
