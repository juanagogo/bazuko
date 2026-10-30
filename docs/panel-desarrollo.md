# Panel de desarrollo de sistemas

Disponible en la compilación de producción con **DEV** o **F2**. No requiere parámetros de URL. La ventana se puede plegar y desplazar; Escape, F2 y × la cierran sin abrir pausa. El ratón queda libre y las acciones del jugador se bloquean, mientras el mundo y las métricas siguen avanzando. Para recuperar la captura del ratón, hacer clic en la escena como habitualmente.

Los interruptores afectan solo a la sesión: no escriben el guardado ni las preferencias gráficas. Todos comienzan activos. «Activar todo» los restaura. Los vendedores interactuables permanecen activos al apagar peatones. Para apagar carros es necesario salir del vehículo.

## Aislamiento

`DebugSystems` centraliza `setEnabled`, `isEnabled`, `counts`, `reset`, notificaciones y cambios pendientes. Los grupos invisibles de identidad mantienen separada la máscara de desarrollo de la visibilidad de LOD y descarte de cámara. Restaurar conserva las mismas entidades, posiciones, rutas, ropa y enfriamientos. Se filtran también los participantes en colisiones, cruces, reacciones, interacciones y audio; no basta con ocultar las mallas.

El detalle de NPC que termina mientras está desactivado se descarta y puede solicitarse nuevamente al restaurar. La vegetación omite su actualización de LOD, incluido el callback previo al render. Las voces de motores y claxones se retiran por entidad; las voces locales y alarmas del grupo desactivado se detienen.

Lluvia suspende partículas, actualización, audio y humedad visible, conservando el estado climático para reanudar sin acumular tiempo. El interruptor permite el clima existente, no fuerza lluvia: la base del proyecto conserva `RAIN_ENABLED = false` temporalmente. Luces locales afecta focos, puntos y halos; conserva cielo, sol y semáforos. Sombras solares usa las cascadas existentes.

Reflejos y bloom utiliza variantes de posprocesado preparadas secuencialmente por la cola gráfica, para las calidades ya disponibles y ambas cámaras. El interruptor queda deshabilitado durante la preparación; el estado se confirma al completar y vuelve al anterior ante fallo. Se conserva el ajuste tonal y la salida de color. El cambio puede mostrar una pausa de preparación; las siguientes alternancias reutilizan las variantes.

## Medición

El panel actualiza como máximo cuatro veces por segundo FPS, p95, dibujos, triángulos, calidad efectiva, resolución y cantidades activas/totales. Los totales cuentan entidades disponibles, no las visibles por la cámara. «Reiniciar medición» comparte el acumulador del HUD.

Al abrir se bloquea la adaptación automática conservando calidad efectiva y resolución actuales. La casilla permite restablecer el comportamiento previo sin cerrar la ventana. Al cerrar se restaura el bloqueo anterior. Los interruptores siguen vigentes hasta restaurarlos o terminar la partida. Al terminar se liberan eventos, intervalo, suscripción, máscaras y elementos del panel.

## Validación reproducible

- `npm test`: regresiones de máscaras, comerciantes, conservación de entidades, retirada, rechazo al conducir, preparación pendiente, fallo gráfico y detalle de NPC tardío, además de la suite existente.
- `npm run build`.
- Servir `dist` en el puerto 5190 y ejecutar `node tools/validate-developer.mjs`. Requiere Edge instalado con WebGPU. Crea una partida temporal en un contexto aislado; verifica simulación activa, controles bloqueados, interruptores combinados, contadores a cero, efectos/restauración, Activar todo, F2, Escape, plegado y vistas de día/noche en ambas cámaras. Guarda captura e informe en `test-results/developer/` (no versionados).

Las pruebas automatizadas no certifican la percepción del audio ni una mejora concreta de FPS en otros equipos. Para comparar rendimiento fijar la misma cámara, población, calidad y resolución, y reiniciar la medición tras cada cambio.

Resultado de esta entrega: 346 pruebas aprobadas, compilación correcta (con el aviso existente de tamaño de bundles) y validación de producción en Edge/WebGPU sin errores de página. En la escena probada se retiraron y restauraron 39 carros, 2 TransMilenio, 66 peatones ambientales, 30 palomas y El Chato; los seis vendedores quedaron activos. El número de árboles depende de la generación de la ciudad. No se atribuye una mejora de FPS: la captura verifica funcionamiento y cantidades, no constituye un benchmark comparativo.
