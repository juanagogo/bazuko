// src/ui/needsMeta.js
// Nombre, icono (lucide, ver icons.js) y color de cada necesidad; el HUD y la pestaña Estado usan los mismos.

export const NEED_META = [
  { id: 'hambre', glyph: 'food', label: 'Hambre', color: '#e9a83b' },
  { id: 'sed', glyph: 'droplet', label: 'Sed', color: '#3d8ef0' },
  { id: 'energia', glyph: 'zap', label: 'Energía', color: '#a678ff' },
  { id: 'salud', glyph: 'heart', label: 'Salud', color: '#ec4b4f' },
  { id: 'higiene', glyph: 'bath', label: 'Higiene', color: '#2fc3ad' },
  { id: 'animo', glyph: 'smile', label: 'Ánimo', color: '#ef77b6' },
  { id: 'vicio', glyph: 'cigarette', label: 'Vicio', color: '#b8977a' },
];

/** Bajo este valor la necesidad se resalta; bajo el crítico, parpadea. */
export const NEED_LOW = 30;
export const NEED_CRITICAL = 15;

export function needLevel(value) {
  return value < NEED_CRITICAL ? 'critical' : value < NEED_LOW ? 'low' : 'ok';
}
