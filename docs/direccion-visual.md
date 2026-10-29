# Bogotá, otra noche

La actualización visual web conserva el barrio, el inicio nocturno, las partidas y la calidad baja predeterminada. La identidad sale de la calle: asfalto, concreto, ventanas cálidas y señalización ámbar. El personaje y la ciudad son protagonistas.

## Sistema visual

| Token | Color | Uso |
| --- | --- | --- |
| Asfalto | `#101b22` | Fondos y superficies principales |
| Pizarra | `#1d303c` | Paneles y controles |
| Papel | `#edf1ed` | Texto principal |
| Niebla | `#9cabb1` | Texto secundario |
| Ámbar | `#eeb65c` | Acción principal, selección y navegación |
| Salvia | `#86aa9b` | Dinero, progreso y estados positivos |

Tipografía: Overpass ya incluida; titulares de peso alto, etiquetas cortas, texto normal de 13–16 px. Mayúsculas reservadas para rótulos. Números tabulares para estado y recursos.

```
CREADOR / ESCRITORIO
┌──────────────────────────────┬───────────────────────┐
│ BAZUKO / BOGOTÁ              │ Crea tu personaje     │
│ Otra noche. Tu historia.     │ categorías            │
│                              │                       │
│       PERSONAJE 3D            │ opciones desplazables │
│       sobre una acera         │                       │
│                              ├───────────────────────┤
│      ↶ arrastra para girar ↷  │ Al azar       Jugar    │
└──────────────────────────────┴───────────────────────┘
MÓVIL: escenario arriba, editor abajo; acciones siempre visibles.

PARTIDA
┌──────────────────────────────────────────────────────┐
│ identidad · hora · recursos       radio / foto / pausa│
│ cámara                                     inventario│
│                                                      │
│                   CIUDAD                             │
│                                                      │
│ necesidades                                          │
│ radar                         ayuda       acceso rápido│
└──────────────────────────────────────────────────────┘
```

## Decisiones y límites

- Jerarquía por espacio, contraste y una línea ámbar; quitar marcos dobles, fondos azules saturados y brillos decorativos de los paneles.
- Menús opacos y legibles, HUD compacto con fondo estable; no depender de desenfoques caros para leerlo.
- Botones de 44 px, foco visible, estados seleccionados explícitos y movimiento reducido. Mantener los atajos y nombres de controles existentes.
- Movimiento secundario sutil; sin desplazar pies, física o colisiones. Cielo y lluvia aprovechan los shaders existentes, sin luces globales nuevas ni posprocesado pesado.
- Modo foto congela la simulación, deja componer con la cámara y descarga el render sin interfaz. La exportación usa la resolución del canvas; no promete una captura 4K independiente de calidad.

Autocrítica: una combinación oscura con ámbar por sí sola sería una plantilla genérica. El pavimento del creador, el rótulo editorial asimétrico y la iluminación exterior conectan la interfaz con esta ciudad. Se evitan neón cian/magenta, tarjetas decorativas repetidas y fotografías ajenas al mundo del juego. Verificar el resultado real en pantalla ancha y estrecha, no solo que compile.
