# Tablas de correspondencia de huesos por fuente

El banco de animaciones del port usa el esqueleto de 52 huesos `mixamorig:*`. Una biblioteca de captura de otra fuente nombra sus huesos de otra forma (por ejemplo `LeftUpLeg` frente a `mixamorig:LeftUpLeg`, o `thigh_l`). Cada archivo `<fuente>.json` de esta carpeta dice a qué hueso del juego corresponde cada hueso de esa fuente.

Formato:

```json
{
  "fuente": "nombre de la biblioteca",
  "huesos": { "hueso_de_la_fuente": "mixamorig:HuesoDelJuego" },
  "ignorar": ["huesos_de_la_fuente_sin_equivalente"]
}
```

Reglas:

- Los huesos de la fuente que no estén ni en `huesos` ni en `ignorar` hacen que la reorientación avise y se detenga, para que no se pierda movimiento sin notarlo.
- Los dedos pueden ir en `ignorar` si el clip no los anima.
- Las tablas se usan con `cpp/tools/animaciones/reorientar_clip.py`.
