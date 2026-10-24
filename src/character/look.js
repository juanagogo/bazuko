// Catálogo de apariencia. Las paletas están curadas para que cualquier
// combinación (incluido "Al azar") se vea bien.

export const PALETTES = {
  piel: ['#f6d3b3', '#e8b88f', '#d39a6d', '#b07a52', '#8a5a3b', '#5e3b27'],
  pelo: ['#1b1410', '#3b2416', '#6b4423', '#a8742f', '#d9b26a', '#8c8c8c', '#e8e2d6', '#8e2333', '#2a4d8f'],
  ojos: ['#3b2416', '#1b1410', '#5f7a3a', '#3d6b9c', '#a6762f', '#6b6f73'],
  ropa: ['#c0392b', '#2f6fb0', '#3f7a3a', '#7d8288', '#e0962b', '#7a4fa0', '#1f1f1f', '#e8e3d6', '#0f6b6b', '#d6336c', '#33445c', '#f2c600', '#6b4a2e'],
  zapato: ['#1c1c1c', '#e9e9e9', '#7a4a2a', '#2f6fb0', '#c0392b'],
};

export const COLOR_NAMES = {
  piel: ['Muy clara', 'Clara', 'Trigueña', 'Morena', 'Oscura', 'Muy oscura'],
  pelo: ['Negro', 'Castaño oscuro', 'Castaño', 'Cobrizo', 'Rubio', 'Canoso', 'Blanco', 'Vinotinto', 'Azul'],
  ojos: ['Café', 'Negros', 'Verdes', 'Azules', 'Miel', 'Grises'],
  ropa: ['Rojo', 'Azul', 'Verde', 'Gris', 'Naranja', 'Morado', 'Negro', 'Crema', 'Verde petróleo', 'Fucsia', 'Azul jean', 'Amarillo', 'Café'],
  zapato: ['Negro', 'Blanco', 'Café', 'Azul', 'Rojo'],
};

// Qué tanto se nota la calle en la ropa y la piel (ver weathering.js)
export const WEAR_LEVELS = [{ id: 0, label: 'Limpio' }, { id: 1, label: 'Gastado' }, { id: 2, label: 'Muy sucio' }];

// Objetos que se cargan en el cuerpo (ver props.js); no son piezas exportadas de MakeHuman
export const ACCESSORIES = [{ id: 'baston', label: 'Bastón' }, { id: 'mochila', label: 'Mochila' }];

export const STYLES = {
  cuerpo: [{ id: 'a', label: 'Tipo A' }, { id: 'b', label: 'Tipo B' }],
  contextura: [{ id: 'delgado', label: 'Delgado' }, { id: 'normal', label: 'Normal' }, { id: 'robusto', label: 'Robusto' }],
  pelo: [
    { id: 'rapado', label: 'Rapado' }, { id: 'corto', label: 'Corto' }, { id: 'crespo', label: 'Crespo' },
    { id: 'largo', label: 'Largo' }, { id: 'cola', label: 'Cola' }, { id: 'mohicano', label: 'Mohicano' }, { id: 'calvo', label: 'Calvo' },
  ],
  cejas: [{ id: 'delgadas', label: 'Delgadas' }, { id: 'gruesas', label: 'Gruesas' }],
  barba: [{ id: 'ninguna', label: 'Ninguna' }, { id: 'bigote', label: 'Bigote' }, { id: 'candado', label: 'Candado' }, { id: 'completa', label: 'Completa' }],
  arriba: [{ id: 'buzo', label: 'Buzo con capota' }, { id: 'camiseta', label: 'Camiseta' }, { id: 'rayas', label: 'A rayas' }, { id: 'chaqueta', label: 'Chaqueta' }],
  abajo: [{ id: 'jean', label: 'Jean' }, { id: 'sudadera', label: 'Sudadera' }, { id: 'pantaloneta', label: 'Pantaloneta' }],
  zapatos: [{ id: 'tenis', label: 'Tenis' }, { id: 'chanclas', label: 'Chanclas' }, { id: 'botas', label: 'Botas' }],
  cabeza: [{ id: 'nada', label: 'Nada' }, { id: 'gorra', label: 'Gorra' }, { id: 'gorra-atras', label: 'Gorra al revés' }, { id: 'sombrero', label: 'Sombrero' }, { id: 'panoleta', label: 'Pañoleta' }],
};

export const DEFAULT_LOOK = {
  v: 2,
  nombre: '',
  origen: 'reciclador',
  cuerpo: 'a',
  contextura: 'normal',
  estatura: 1,
  piel: 2,
  pelo: 'corto',
  peloColor: 0,
  ojos: 0,
  cejas: 'gruesas',
  barba: 'candado',
  arriba: 'buzo',
  arribaColor: 0,
  abajo: 'jean',
  abajoColor: 10,
  zapatos: 'tenis',
  zapatoColor: 1,
  cabeza: 'gorra',
  cabezaColor: 0,
  desgaste: 2,
  accesorios: [],
};

export const NAME_IDEAS = ['Jairo', 'Yeison', 'Luz Dary', 'Wilmer', 'Yuli', 'Brayan', 'Marleny', 'Don Chepe', 'Nelson', 'Leidy', 'El Mono', 'Doña Gloria', 'Kevin', 'La Flaca', 'Fredy', 'Sandra'];

const ids = (k) => STYLES[k].map((s) => s.id);
const clampIdx = (v, arr, d) => (Number.isInteger(v) && v >= 0 && v < arr.length ? v : d);
const pickId = (v, k, d) => (ids(k).includes(v) ? v : d);

/** Limpia un nombre: texto plano, sin espacios dobles, máximo 16 caracteres. */
export function cleanName(s) {
  return String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
}

/** Normaliza (y migra) cualquier apariencia guardada al formato actual. */
export function normalizeLook(raw = {}) {
  const l = { ...DEFAULT_LOOK, accesorios: [] };
  if (!raw || typeof raw !== 'object') return l;
  if (raw.v !== 2) {
    // formato anterior: { piel, buzo, gorra, barba, origen }
    const oldCap = [null, 6, 0, 1, 11];
    if (Number.isInteger(raw.piel)) l.piel = Math.min(5, raw.piel + 1);
    if (Number.isInteger(raw.buzo)) l.arribaColor = clampIdx(raw.buzo, PALETTES.ropa, 0);
    if (Number.isInteger(raw.gorra)) {
      l.cabeza = raw.gorra === 0 ? 'nada' : 'gorra';
      l.cabezaColor = oldCap[raw.gorra] ?? 0;
    }
    if (raw.barba !== undefined) l.barba = raw.barba ? 'candado' : 'ninguna';
    if (typeof raw.origen === 'string') l.origen = raw.origen;
    return l;
  }
  l.nombre = cleanName(raw.nombre);
  // piezas del personaje realista (las valida RealisticCharacter con el catálogo)
  if (raw.real && typeof raw.real === 'object') l.real = { ...raw.real };
  l.origen = typeof raw.origen === 'string' ? raw.origen : l.origen;
  for (const k of ['cuerpo', 'contextura', 'pelo', 'cejas', 'barba', 'arriba', 'abajo', 'zapatos', 'cabeza']) l[k] = pickId(raw[k], k, l[k]);
  l.estatura = typeof raw.estatura === 'number' ? Math.min(1.08, Math.max(0.92, raw.estatura)) : 1;
  l.piel = clampIdx(raw.piel, PALETTES.piel, l.piel);
  l.peloColor = clampIdx(raw.peloColor, PALETTES.pelo, l.peloColor);
  l.ojos = clampIdx(raw.ojos, PALETTES.ojos, l.ojos);
  l.arribaColor = clampIdx(raw.arribaColor, PALETTES.ropa, l.arribaColor);
  l.abajoColor = clampIdx(raw.abajoColor, PALETTES.ropa, l.abajoColor);
  l.zapatoColor = clampIdx(raw.zapatoColor, PALETTES.zapato, l.zapatoColor);
  l.cabezaColor = clampIdx(raw.cabezaColor, PALETTES.ropa, l.cabezaColor);
  l.desgaste = clampIdx(raw.desgaste, WEAR_LEVELS, l.desgaste);
  l.accesorios = Array.isArray(raw.accesorios)
    ? ACCESSORIES.map((a) => a.id).filter((id) => raw.accesorios.includes(id))
    : [];
  return l;
}

/** Combinación al azar, curada: pelo casi siempre natural, ropa que contrasta. */
export function randomLook(base = DEFAULT_LOOK) {
  const r = Math.random;
  const any = (arr) => arr[Math.floor(r() * arr.length)];
  const style = (k) => any(STYLES[k]).id;
  const top = Math.floor(r() * PALETTES.ropa.length);
  let bottom = any([10, 6, 3, 12, 2]);
  if (bottom === top) bottom = 10;
  return normalizeLook({
    ...base,
    v: 2,
    cuerpo: style('cuerpo'),
    contextura: style('contextura'),
    estatura: 0.94 + r() * 0.12,
    piel: Math.floor(r() * PALETTES.piel.length),
    pelo: style('pelo'),
    peloColor: r() < 0.85 ? Math.floor(r() * 5) : Math.floor(r() * PALETTES.pelo.length),
    ojos: Math.floor(r() * PALETTES.ojos.length),
    cejas: style('cejas'),
    barba: r() < 0.45 ? 'ninguna' : style('barba'),
    arriba: style('arriba'),
    arribaColor: top,
    abajo: style('abajo'),
    abajoColor: bottom,
    zapatos: style('zapatos'),
    zapatoColor: Math.floor(r() * PALETTES.zapato.length),
    cabeza: r() < 0.3 ? 'nada' : style('cabeza'),
    cabezaColor: Math.floor(r() * PALETTES.ropa.length),
  });
}
