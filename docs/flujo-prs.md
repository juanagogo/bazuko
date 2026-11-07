# Flujo de trabajo de los pull requests

Cómo se junta en este fork (`jersonmejia452-hue/bazuko`) el trabajo de la comunidad y el propio, para subirlo a `juanagogo/bazuko` en un solo PR.

## Ramas

| Rama | Para qué | Quién escribe |
|---|---|---|
| `main` | Espejo de `juanagogo/bazuko@main`. Solo avanza en fast-forward desde upstream. | Nadie la edita a mano |
| Rama de integración | Los PR abiertos de upstream y los del fork, cada uno con su merge `--no-ff` | El encargado de integrar |
| Una rama por tarea | Una mejora (objetivos, guardado, robo de autos…), creada desde la rama de integración | Quien hace la tarea |

Cada tarea abre un PR en borrador hacia la rama de integración, y no hacia `main`.

## Traer lo de upstream

```sh
git remote add upstream https://github.com/juanagogo/bazuko.git
git fetch upstream main '+refs/pull/*/head:refs/remotes/upstream/pr/*'
git push origin upstream/main:main          # solo si es fast-forward
git merge --no-ff upstream/pr/<N> -m "Integra PR #<N> de juanagogo/bazuko (<autor>)"
```

- Un merge por PR, para que la historia diga de quién es cada cambio.
- Si un PR ya viene dentro de otro (por ejemplo, #46 trae diez), no se integra dos veces.
- Si un PR parte de una base muy vieja y choca en muchos archivos, se deja fuera y se anota: lo actualiza su autor.
- Cuando dos PR resuelven lo mismo, se queda el que ya está en upstream o el más completo. El otro se adapta encima y no se duplica.

## Antes de fusionar

1. La CI está en verde (`npm test` y `npm run build`, con los WAV de Git LFS).
2. Los conflictos están resueltos y explicados en el mensaje del merge.
3. Se cumplen las reglas del juego que vigilan las pruebas: los textos en usted (`voz.test.js`), los estilos en `src/ui/css/` con la paleta de seis colores (`materiales.test.js`) y nada que el juego cargue se queda fuera de `dist/` (`dist-ligero.test.js`).
4. El PR dice qué cambia para el jugador, qué se probó y qué no.

Nada de force-push a `main` ni a ramas ajenas: los arreglos sobre la rama de otro van en commits o merges nuevos.

## Subir a upstream

Cuando la rama de integración está verde y probada, se abre **un** PR hacia `juanagogo/bazuko:main` con:

- la lista de PR incluidos, cada uno con su número y su autor;
- los conflictos resueltos y lo que se dejó fuera;
- los PR propios del fork, con su descripción.

Así juanagogo puede cerrar los PR originales como incluidos.
