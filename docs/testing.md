# Pruebas

Las pruebas de navegador se adaptaron del PR [juanagogo/bazuko#4](https://github.com/juanagogo/bazuko/pull/4), commit `2df40da`, de Jonme-Mopri. La corrección asociada renderiza las recetas inmediatamente al abrir fabricación; esto es necesario porque el panel pausa la simulación.

## Pruebas unitarias y compilación

```sh
npm ci
npm test
npm run build
```

Las pruebas de robo a peatones también ejecutan la interacción general y el robo en el orden de la partida, con la entrada real del juego. Comprueban que E inicie el cosquilleo junto a un peatón, que una tienda cercana conserve la prioridad y que una pulsación sin objetivos no se arrastre al siguiente cuadro.

Las pruebas de combate verifican el impacto diferido, un solo objetivo por golpe, alcance, altura, paredes y cancelación al recibir daño. También comprueban las tres reacciones de los peatones, su regreso a la navegación, el contraataque y la ausencia de botín repetido. Las poses se comprueban sobre el esqueleto real y el personaje procedural; esos cálculos no sustituyen la revisión visual en el navegador.

## Preparar Chromium

```sh
npx playwright install chromium
```

## Pruebas de navegador

```sh
npm run test:e2e
npm run test:e2e:headed
npm run test:e2e:ui
npm run test:report
```

Playwright inicia su propio Vite en `127.0.0.1:5188`, con puerto estricto y sin reutilizar otro servidor, para verificar esta copia del proyecto. Ejecuta Chromium con un solo worker y WebGL por software para limitar el uso de GPU y memoria. Cada prueba limpia el almacenamiento local de su contexto aislado; no borra la partida de tu navegador habitual.

Los escenarios esperan a que termine la pantalla de carga antes de interactuar. Verifican creación del personaje, talentos, recetas de fabricación, edición de apariencia, ayuda plegable «!», inventario y pausa. Se cierra fabricación antes de editar el personaje para respetar la pausa actual. Se comprueba que Escape cierre un panel sin abrir simultáneamente otro.

Los informes y archivos de fallos se escriben en `playwright-report/` y `test-results/`, excluidos de Git. El informe HTML no se abre automáticamente al terminar. Para comprobar únicamente el descubrimiento de los escenarios, sin iniciar Chromium:

```sh
node node_modules/@playwright/test/cli.js test --list
```

La ejecución con renderizado por software sirve para verificar flujos; sus FPS no representan el rendimiento de una GPU real.
