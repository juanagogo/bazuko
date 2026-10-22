// src/data/zorra.js
// Parámetros de balance y textos de la zorra de reciclador. No importa nada.

export const ZORRA = {
  precio: 40000,           // COP: costo de comprar la zorra
  bonoPeso: 40,            // kg: capacidad extra de carga mientras se empuja
  multVelocidad: 0.7,      // ×: velocidad del jugador al empujar la zorra
  distanciaDelante: 1.9,   // m: del ancla (pies del que empuja) al centro del modelo
  avisoSobrepesoCada: 4,   // s: tiempo mínimo entre toasts de sobrepeso
  origen: {
    descuento: 0.75,       // ×: precio para el origen reciclador
    fuerza: 1.2            // ×: fuerza en el forcejeo para el origen reciclador
  },
  teclas: {
    soltar: 'KeyG',        // tecla para soltar la zorra
    agarrar: 'KeyG',       // tecla para agarrar la zorra propia soltada
    robar: 'KeyG',         // tecla para llevarse la zorra descuidada de un reciclador
    forcejear: 'KeyE',     // tecla para iniciar y machacar el forcejeo
    cancelar: 'KeyG'       // tecla para rendirse en el forcejeo
  },
  mapa: {
    nombre: 'Tu zorra',    // etiqueta en el radar cuando la zorra está en el suelo
    icono: '🛒',           // icono en el radar
    color: '#c98a3a'       // color del punto en el radar
  }
};

export const RECICLADORES = {
  cantidad: 4,                 // recicladores con zorra en la ciudad
  intervaloCaneca: [20, 40],   // s: espera aleatoria entre búsquedas de caneca
  radioCaneca: 30,             // m: distancia máxima a una bolsa candidata
  duracionParada: 5,           // s: rebusque normal junto a la caneca
  probDescuido: 0.10,          // 0..1: probabilidad de dejar la zorra sola en una parada
  duracionDescuido: 8,         // s: tiempo que la zorra queda sin vigilar
  distanciaDescuido: 4,        // m: a qué distancia de la caneca deja la zorra
  tiempoRecuperar: 300,        // s: de juego sin pausa para que consiga otra zorra
  movidaMax: 1                 // m: si la bolsa elegida se mueve más que esto, elige otra
};

// Calibración: con fuerza 1 la barra sube `empuje × pulsaciones/s − tironNpc` por segundo.
// A 3 pulsaciones/s se queda quieta y se pierde por tiempo; a 4/s se gana en 5 s;
// a 5/s, en 2,5 s.
export const FORCEJEO = {
  barraInicial: 0.5,       // 0..1: progreso con el que arranca la barra
  empuje: 0.1,             // fracción de barra por pulsación con fuerza 1
  tironNpc: 0.3,           // fracción de barra por segundo que recupera el reciclador
  duracion: 6,             // s: tiempo máximo antes de perder
  energiaBaja: 30,         // umbral de energía por debajo del cual se pierde fuerza
  multEnergiaBaja: 0.6,    // ×: fuerza con energía baja
  multAbstinencia: 0.5,    // ×: fuerza en abstinencia
  castigoSalud: 15,        // puntos de salud perdidos al perder
  castigoAnimo: 10,        // puntos de ánimo perdidos al perder
  espera: 120,             // s: sin aceptar otro forcejeo tras ganarle al jugador
  botin: {
    min: 2,                // materiales mínimos al ganar
    max: 4,                // materiales máximos al ganar
    materiales: ['lata', 'botella', 'carton', 'chatarra'] // ids posibles del botín
  }
};

export const TEXTOS_ZORRA = {
  sueltaPrimero: 'Suelta la zorra primero',
  sobrepeso: 'Con tanto peso no das ni un paso',
  muerte: 'Te desmayaste y te desocuparon la zorra',
  yaTienes: 'Ya tienes zorra',
  agarrar: '[G] Agarrar zorra',
  robar: '[G] Llevarse la zorra',
  forcejear: '[E] Forcejear por la zorra',
  enojado: 'Este reciclador no quiere más forcejeos',
  nombreCompra: 'Zorra de reciclador',
  descCompra: `Carga ${ZORRA.bonoPeso} kg más, pero vas más lento y no puedes correr.`,
  comprada: 'Compraste una zorra',
  soltada: 'Soltaste la zorra',
  agarrada: 'Agarraste la zorra',
  robada: 'Te llevaste la zorra',
  ganaste: 'Le ganaste la zorra al reciclador',
  perdiste: 'El reciclador te sacó a empujones',
  ayudaForcejeo: 'Machaca [E] · [G] para rendirte'
};

export const INSULTOS_RECICLADOR = [
  '¡Ey, mi zorra, ladrón!',
  '¡Devuélvame eso, gamín!',
  '¡Qué mala clase, parce!',
  '¡Ni se le ocurra volver por acá!',
  '¡Eso es trabajo de todo el día, home!',
  '¡Ojalá se le pinche una llanta, hampón!'
];
