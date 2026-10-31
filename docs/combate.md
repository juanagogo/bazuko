# Combate en desarrollo

G o clic inicia jab/cross con impacto diferido. Los NPC valientes responden con preparación, golpe y recuperación; hay dos turnos por objetivo. Los desplazamientos de persecución y empuje consultan el suelo transitable.

Al pasar caminando a menos de 2,8 metros de un peatón, puede hablar una vez y respeta un enfriamiento por NPC; las frases «Asqueroso» y «Petrista» solo se asignan a voces femeninas. Tras robar, la víctima y los perseguidores usan la categoría exclusiva `theftChase`; incluye «Peste» como voz femenina y «Encuerenrata» para cualquier perseguidor. Al quedar fuera de combate, cada NPC reproduce al azar «Derrota» o «Ahh» una sola vez; la voz puede terminar aunque el NPC tenga cero de salud. La muerte del jugador reproduce únicamente «Ahh». Otros combates conservan las voces de grupo. El banco evita repetir una grabación durante ocho segundos y procura no reutilizar las últimas cuatro voces seleccionadas.

H sujeta un NPC vivo a menos de 1,4 metros o lo suelta. J lo derriba. El agarre dura como máximo tres segundos. Los recursos actuales sustituyen las poses de agarre. Esta implementación es parcial: faltan agarres iniciados por NPC, barra de liberación A/D, cancelación al abrir menús, separación espacial entre combatientes y pruebas específicas. No se ha verificado visualmente en navegador. No presentar como fase completa.

Al quedar fuera de combate, un peatón termina la caída, desaparece durante ocho segundos y reaparece en su punto original con la misma apariencia. Mientras está ausente se liberan sus modelos; la población del distrito no cambia. Los carros mantienen el frenado gradual, pero el contacto físico a baja velocidad también puede causar atropello.
