// Identidad visual en coordenadas del mundo. No modifica tiles, destinos,
// alturas ni navegación; los perfiles se comparten entre fachadas y andenes.
const profile = (id, palette, signage) => Object.freeze({
  id, palette: Object.freeze(palette), signage: Object.freeze(signage)
});

export const NEIGHBORHOODS = Object.freeze({
  cambuche: profile('cambuche', {
    facadeBase: '#dfc7aa', facadeAccent: '#a57350', plinth: '#7b7162',
    trim: '#bead8e', metal: '#64706a', signBackground: '#e4d2af',
    signText: '#423f34', pavingTint: '#a79781'
  }, { style: 'painted', font: 'bold sans-serif', border: 'single', weathering: .55 }),
  comercio: profile('comercio', {
    facadeBase: '#e3ddd0', facadeAccent: '#934c3f', plinth: '#666b69',
    trim: '#cfb98c', metal: '#456e6c', signBackground: '#753f38',
    signText: '#f1e4c5', pavingTint: '#aaa89e'
  }, { style: 'fascia', font: 'bold sans-serif', border: 'double', weathering: .25 }),
  lago: profile('lago', {
    facadeBase: '#d4dfcf', facadeAccent: '#628273', plinth: '#6c7e70',
    trim: '#d6cfb4', metal: '#53796e', signBackground: '#46695b',
    signText: '#eee6cc', pavingTint: '#a8ad98'
  }, { style: 'painted', font: 'sans-serif', border: 'single', weathering: .18 }),
  centro: profile('centro', {
    facadeBase: '#ddd8cf', facadeAccent: '#888b84', plinth: '#777872',
    trim: '#bcb9af', metal: '#717b7a', signBackground: '#555d5c',
    signText: '#e5e0d3', pavingTint: '#a6a49d'
  }, { style: 'fascia', font: 'sans-serif', border: 'single', weathering: .3 })
});

/** Los límites siguen el recorrido del cambuche al comercio y al parque sur. */
export function neighborhoodAt(x, z) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return NEIGHBORHOODS.centro;
  if (z >= 222) return NEIGHBORHOODS.lago;
  if (x >= 92 && x <= 144 && z >= 68 && z < 128) return NEIGHBORHOODS.cambuche;
  if (x >= 36 && x <= 184 && z >= 128 && z < 222) return NEIGHBORHOODS.comercio;
  return NEIGHBORHOODS.centro;
}
