# Línea base de rendimiento (T011)

Medida del estado **actual** del juego, antes de cambiar ninguna animación, para comparar con cada lote (criterio SC-003: pérdida menor al 5 %).

## Condiciones

- Equipo: ASUS TUF Gaming A15, NVIDIA GeForce RTX 3050 Laptop GPU (4 GB), Windows 11.
- Ejecutable: `cpp/build/Release/bazuko.exe` (Release), calidad media (`BAZUKO_QUALITY=1`).
- Escena: hora fija 12:00 (`BAZUKO_HOUR=12`), jugador en X 105, Z 100 (`BAZUKO_POS=105,100`), con los 80 peatones y 8 vendedores de la ciudad completa.
- Medición: `BAZUKO_BENCH=1` con captura a los 15 s (`BAZUKO_SHOT_DELAY=15`), 600 cuadros medidos.

Comando (guardando y restaurando la partida alrededor):

```sh
cd cpp/build/Release
cp savegame.json /tmp/sg.bak
BAZUKO_BENCH=1 BAZUKO_QUALITY=1 BAZUKO_HOUR=12 BAZUKO_POS=105,100 BAZUKO_SHOT=bench.png BAZUKO_SHOT_DELAY=15 ./bazuko.exe
cp /tmp/sg.bak savegame.json
```

## Resultados (3 corridas)

| Corrida | FPS medios | p95 (ms) | p99 (ms) | 1 % bajo (FPS) |
|---|---|---|---|---|
| 1 | 93,4 | 11,93 | 12,44 | 78,6 |
| 2 | 92,8 | 11,95 | 12,44 | 78,4 |
| 3 | 92,5 | 11,96 | 12,24 | 80,1 |
| **Media** | **92,9** | 11,95 | 12,37 | 79,0 |

La variación entre corridas es de unos 0,9 FPS (1 %), así que un 5 % de pérdida (unos 4,6 FPS) se distingue bien del ruido.

**Presupuesto para los lotes:** FPS medios no menores de **88,3** en las mismas condiciones.

## Notas

- Los mínimos instantáneos (7 a 10 FPS) aparecen en las tres corridas; no he investigado su origen. Como están igual antes de tocar ninguna animación, el criterio usa la media y el percentil 95 y no el mínimo.
- Si cambia el equipo o los controladores, hay que volver a medir esta línea base antes de comparar.
