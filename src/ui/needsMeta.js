// src/ui/needsMeta.js
// Nombre, icono (ver icons.js) y color de cada necesidad; el HUD y la pestaña Estado usan los mismos.

// En este orden se leen, en el cartón y en la pausa: la salud primero, siempre en el mismo sitio.
export const NEED_META = [
  { id: 'salud', glyph: 'heart', label: 'Salud', color: '#97c887' },
  { id: 'hambre', glyph: 'food', label: 'Hambre', color: '#efca52' },
  { id: 'sed', glyph: 'droplet', label: 'Sed', color: '#82b8dc' },
  { id: 'energia', glyph: 'zap', label: 'Energía', color: '#8fc3cf' },
  { id: 'higiene', glyph: 'bath', label: 'Higiene', color: '#75bfa8' },
  { id: 'animo', glyph: 'smile', label: 'Ánimo', color: '#cc9cae' },
  { id: 'vicio', glyph: 'cigarette', label: 'Vicio', color: '#c5ad8b' },
];

/** Bajo este valor la cifra se invierte; bajo el crítico, la fila entera es placa roja. Nada parpadea. */
export const NEED_LOW = 30;
export const NEED_CRITICAL = 15;

export function needLevel(value) {
  return value < NEED_CRITICAL ? 'critical' : value < NEED_LOW ? 'low' : 'ok';
}

/** Lo que se escribe al lado del nombre cuando la fila está crítica: el estado no depende solo del color. */
export const NEED_ORDEN = {
  salud: 'a curarme', hambre: 'a comer', sed: 'a beber', energia: 'a dormir',
  higiene: 'a lavarme', animo: 'a calmarme', vicio: 'me pide', calor: 'a la candela',
};

// Lo más urgente: un solo retazo. Cada estado pesa según qué tan mal está, y las sumas salen de lo que pasa en el
// juego: sin agua se pierde salud más rápido que sin comida, y con la salud casi en cero no hay nada más urgente.
const URGENCIAS = [
  { id: 'salud', grito: 'ESTOY MUY MAL', orden: 'Busco dónde curarme', peso: (s) => (s.salud <= 30 ? 100 - s.salud * 2 : 0) },
  { id: 'sed', grito: 'TENGO SED', orden: 'Busco agua', peso: (s) => (s.sed <= 20 ? 95 - s.sed * 2.5 : 0) },
  { id: 'hambre', grito: 'TENGO HAMBRE', orden: 'Busco comida', peso: (s) => (s.hambre <= 20 ? 90 - s.hambre * 2.5 : 0) },
  { id: 'energia', grito: 'NO DOY MÁS', orden: 'Busco dónde dormir', peso: (s) => (s.energia <= 20 ? 80 - s.energia * 2.5 : 0) },
  { id: 'frio', grito: 'TENGO FRÍO', orden: 'Busco candela o techo', peso: (s) => (s.isFreezing && !(s.calor > 0) ? 70 : 0) },
  { id: 'malilla', grito: 'TENGO MALILLA', orden: 'Caminar me cuesta', peso: (s) => (s.inWithdrawal ? 55 : 0) },
];
const AGUANTE = 8; // lo que hay que ganarle al retazo que ya está, para que no vaya y venga entre dos parecidos

/** El estado más urgente de ahora, o null. `previo` es el id del que ya está en pantalla. */
export function masUrgente(stats, previo = null) {
  let mejor = null, pesoMejor = 0, pesoPrevio = 0;
  for (const u of URGENCIAS) {
    const peso = u.peso(stats);
    if (u.id === previo) pesoPrevio = peso;
    if (peso > pesoMejor) { pesoMejor = peso; mejor = u; }
  }
  if (previo && pesoPrevio > 0 && pesoMejor < pesoPrevio + AGUANTE) return URGENCIAS.find((u) => u.id === previo);
  return mejor;
}
