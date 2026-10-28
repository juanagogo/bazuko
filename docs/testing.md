# Pruebas

Las pruebas de navegador se adaptaron del PR [juanagogo/bazuko#4](https://github.com/juanagogo/bazuko/pull/4), commit `2df40da`, de Jonme-Mopri. La corrección asociada renderiza las recetas inmediatamente al abrir fabricación; esto es necesario porque el panel pausa la simulación.

## Pruebas unitarias y compilación

```sh
npm ci
npm test
npm run build
```

## Integración continua

`.github/workflows/ci.yml` ejecuta `npm ci`, `npm test` y `npm run build` en cada pull request y en cada push a `main`. Solo descarga de Git LFS los WAV de `public/audio`; los respaldos del port C++ en `cpp/assets/audio` no se descargan. Las pruebas de navegador no forman parte de la CI.

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
