// src/data/cambuche.js
// Piezas del cambuche (refugio). Se arman en orden: primero la base.

export const CAMBUCHE = [
  {
    id: 'base', name: 'Base de cartón', icon: 'package', req: { carton: 8 },
    desc: 'Para dormir sin tocar el piso.'
  },
  {
    id: 'techo', name: 'Techo de lona', icon: 'tent', req: { lona: 1 }, needs: 'base',
    desc: 'Duermo mejor: recupero más salud.'
  },
  {
    id: 'paredes', name: 'Paredes de tablas', icon: 'layers', req: { madera: 6 }, needs: 'base',
    desc: 'Nadie me roba mientras duermo.'
  },
  {
    id: 'cama', name: 'Colchón', icon: 'bed', req: { colchon: 1 }, needs: 'base',
    desc: 'Recupero mucha más energía al dormir.'
  },
  {
    id: 'fogon', name: 'Fogón de latas', icon: 'flame', req: { lata: 6, madera: 2 }, needs: 'base',
    desc: 'Calienta: despierto con más ánimo y sin tanta hambre.'
  },
  {
    id: 'vela', name: 'Vela y foto', icon: 'heart', req: { vela: 1 }, needs: 'base',
    desc: 'Despierto más tranquilo: calma el vicio.'
  }
];

// Efectos de dormir según lo construido
export const SLEEP = {
  energia: 45,            // energía base al dormir
  energiaCama: 35,        // extra con colchón
  salud: 10,              // salud base
  saludTecho: 15,         // extra con techo
  animoFogon: 15,         // ánimo extra con fogón
  hambreFogon: 15,        // hambre que no se pierde con fogón
  vicioVela: 15,          // vicio que se calma con vela (en vez de subir)
  roboProb: 0.25,         // probabilidad de robo sin paredes
  roboDinero: 0.4,        // fracción del dinero robado
  roboMaterial: 0.5       // fracción del material robado
};
