# Combate en desarrollo

El jugador ataca con `MeleeCombat` (G o clic): armas, combo, preparación, impacto y recuperación. O mantiene la guardia y reduce el daño recibido un 60 %. Un peatón golpeado huye o devuelve el golpe; desmayado, cae, se queda en el piso y se levanta.

Al pasar caminando a menos de 2,8 metros de un peatón, puede hablar una vez y respeta un enfriamiento por persona; las frases «Asqueroso» y «Petrista» solo se asignan a voces femeninas. Tras un robo, la víctima huye gritando y los testigos valientes a menos de 12 metros (hasta seis) se le vienen encima al jugador con `NpcCombat`, que usa dos turnos de golpe por objetivo y la categoría de voz exclusiva `theftChase`. Quien atiende un puesto o está en el piso no se suma. La pelea tiene un tope de 25 segundos y se abandona a más de 25 metros.

H sujeta a un peatón a menos de 1,4 metros o lo suelta, y J lo derriba. El agarre dura como máximo tres segundos. Esta implementación es parcial: faltan agarres iniciados por peatones, barra de liberación, cancelación al abrir menús y separación espacial entre combatientes. No se ha verificado visualmente en navegador.

Las animaciones FBX de pelea se cargan una vez y se adaptan por cuerpo en `buildCharacterClips`; si una falta, el personaje conserva sus gestos anteriores.
