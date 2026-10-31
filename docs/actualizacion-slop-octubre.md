# Actualización de la tecnología de Slop New York

Trabajo en curso en `pruebas-slop-actualizacion`, desde `2367767`. Referencia actualizada por avance directo y comprobada con GitHub: `09d27e050d1e75b7a0eea29a82e81aa4646f28e9` (MIT).

La adaptación conserva Bogotá, sus edificios y redes viales, personajes, ropa, TransMilenio, supervivencia y guardados. El objetivo es sustituir las implementaciones técnicas anteriores con las del donante donde cumplen la misma función. Los datos geográficos de Manhattan y las modalidades ajenas al juego no sustituyen esas funciones.

## Entregas que se verifican

- Carrocerías y materiales actuales, ruedas detalladas y orientables, ocho variantes terrestres, recursos compartidos e interacciones existentes.
- Sonido actualizado de motores, cambios, aceleración, encendido y choques, mezclado con volumen, pausa y voces locales.
- Resolución de render a 1×, sin reducción automática a 0,75×.
- Interiores con paralaje y filtrado a distancia; asfalto procedural con desgaste y charcos dependientes de la humedad.
- Revisión de tráfico, contactos, sombras, vegetación, agrupación y preparación contra el código actualizado.
- Eliminación de rutas reemplazadas, pruebas, compilación y comprobación real de WebGPU antes de considerar terminada la migración.

No se atribuyen mejoras de FPS por el tamaño del mapa o por copiar módulos. La comparación necesita la misma población, cámara, resolución y calidad; los resultados se registrarán al completar la validación.

## Estado de esta entrega

- Vehículos: carrocerías, materiales y ruedas del donante en las clases sedán, taxi, SUV, policía, SUV de policía, pickup, furgón, miniván y bus. El modo antiguo con modelos GLB ya no existe: `actual` y `slop` dibujan el mismo vehículo.
- Resolución: 1× en todas las calidades; la carga sostenida solo baja efectos (presión), no píxeles.
- Interiores con paralaje en las ventanas de las casas y asfalto con charcos que siguen la humedad del clima.
- Tráfico: quien va detrás en el mismo acceso ya no reserva el cruce antes que quien tiene delante (dejaba ambos detenidos). Con varias semillas siguen apareciendo atascos largos, también antes de esta entrega: queda pendiente revisar la coordinación de cruces contra `traffic.js` del donante.
- Pendiente de comprobar en un equipo real: sonido de motores, arranque y aceleración, y los FPS.

## Corrección de carrocerías y sonido al conducir

- Techo, vidrios, rines, retrovisores y aviso del taxi salían negros. El material del donante se escribió para una versión de Three más nueva: en la 0.186 cada nodo compartido (normal de vista, anchos de derivada, máscaras de rueda, pintura base) se asigna donde se usa por primera vez, y eso ocurría dentro del If de la carrocería. Las demás piezas leían esas variables sin valor y la luz las pintaba negras. Ahora se usan antes de las ramas por pieza.
- Al subir a un carro suena el motor de arranque; el acelerador del jugador (W, con Shift a fondo) es la carga del motor, así que los cambios y las revoluciones responden al pedal. Pickup, furgón, miniván y SUV de policía usan el motor de SUV del donante.
