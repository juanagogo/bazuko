// src/systems/rap/ritmo.js
// El rap del vagón por dentro, sin DOM ni audio: cómo se arma la canción, cuándo cae cada golpe, cómo se juzga
// una pulsación y cuánto flow salió. Todos los tiempos son segundos desde que arranca la caja (el primer compás).

import { SALUDOS, PRESENTACION, CIERRE, ESTROFAS, TRABADAS } from '../../data/rapLetras.js';

export const RITMO = {
  bpm: 92,             // boom bap tranquilo: un compás dura 2,6 s y la marca cruza la barra a 0,38 Hz
  ventanaJusta: 0.08,  // s a cada lado del golpe para que sea justo
  ventanaBien: 0.16,   // s a cada lado para que cuente
  multaExtra: 0.25,    // lo que resta del flow cada pulsación sin golpe cerca (no se gana a punta de machacar)
  previa: 1.6,         // s entre las puertas y el primer golpe de la caja
};

/** Lo que vale cada resultado en el flow. */
export const VALOR = { justo: 1, bien: 0.6, fuera: 0 };

/** Dónde cae cada golpe dentro del compás (0 a 1), según cuántos pedazos tiene la línea: en la caja, el 2 y el 4. */
export const POSICIONES = { 1: [0.75], 2: [0.25, 0.75], 3: [0.25, 0.5, 0.75] };

/** Los niveles de mejor a peor y el flow desde el que se llega a cada uno. */
export const NIVELES = [['durisimo', 0.85], ['bien', 0.6], ['regular', 0.35], ['mal', 0.15], ['bajado', 0]];

export const duracionCompas = (bpm = RITMO.bpm) => 240 / bpm;

/** Buenos días hasta las 12, buenas tardes hasta las 7 de la noche y después buenas noches. */
export function saludoPara(hora = 12) {
  const h = ((Number(hora) % 24) + 24) % 24;
  if (h >= 5 && h < 12) return SALUDOS.dias;
  if (h >= 12 && h < 19) return SALUDOS.tardes;
  return SALUDOS.noches;
}

/** Parte un pedazo en dos por el espacio más cercano a la mitad. Sin espacio, queda entero. */
export function partirPedazo(texto) {
  const mitad = texto.length / 2;
  let mejor = -1;
  for (let i = 0; i < texto.length; i++) {
    if (texto[i] === ' ' && (mejor < 0 || Math.abs(i - mitad) < Math.abs(mejor - mitad))) mejor = i;
  }
  return mejor < 0 ? [texto] : [texto.slice(0, mejor), texto.slice(mejor + 1)];
}

/**
 * Dos estrofas distintas al azar. `evitar` son ids que no deberían salir (las del rap anterior): se dejan por fuera
 * mientras queden por lo menos dos.
 */
export function elegirEstrofas(random = Math.random, estrofas = ESTROFAS, evitar = []) {
  const frescas = estrofas.filter((e) => !evitar.includes(e.id));
  if (frescas.length >= 2) estrofas = frescas;
  const a = Math.floor(random() * estrofas.length) % estrofas.length;
  let b = Math.floor(random() * (estrofas.length - 1)) % (estrofas.length - 1);
  if (b >= a) b++;
  return [estrofas[a], estrofas[b]];
}

/**
 * Arma la canción: dos compases de saludo sin golpes, dos estrofas y el cierre.
 * La segunda estrofa pide un golpe más en la primera y la tercera línea: parte su segundo pedazo.
 * Devuelve { bpm, compas, compases: [{ tipo, texto?, pedazos?, golpes }], golpes: [{ t, compas, pedazo }], fin }.
 */
export function armarCancion({ random = Math.random, hora = 12, bpm = RITMO.bpm, estrofas = null, evitar = [] } = {}) {
  const [primera, segunda] = estrofas ?? elegirEstrofas(random, ESTROFAS, evitar);
  const compases = [
    { tipo: 'intro', texto: saludoPara(hora), pedazos: [] },
    { tipo: 'intro', texto: PRESENTACION, pedazos: [] },
    ...primera.lineas.map((pedazos) => ({ tipo: 'verso', estrofa: primera.id, pedazos: [...pedazos] })),
    ...segunda.lineas.map((pedazos, i) => ({
      tipo: 'verso', estrofa: segunda.id,
      pedazos: i % 2 === 0 ? [pedazos[0], ...partirPedazo(pedazos[1])] : [...pedazos],
    })),
    { tipo: 'cierre', pedazos: [...CIERRE] },
  ];
  const compas = duracionCompas(bpm);
  const golpes = [];
  compases.forEach((c, i) => {
    c.golpes = POSICIONES[c.pedazos.length] ?? [];
    c.golpes.forEach((pos, j) => golpes.push({ t: (i + pos) * compas, compas: i, pedazo: j }));
  });
  return { bpm, compas, compases, golpes, fin: compases.length * compas };
}

/** En qué compás va la canción y qué tan avanzado (0 a 1); antes de empezar, el compás es −1. */
export function posicion(cancion, t) {
  if (t < 0) return { compas: -1, fraccion: 0 };
  const compas = Math.min(cancion.compases.length - 1, Math.floor(t / cancion.compas));
  return { compas, fraccion: Math.min(1, (t - compas * cancion.compas) / cancion.compas) };
}

/**
 * Juzga una pulsación en el tiempo `t`: el golpe sin juzgar más cercano dentro de la ventana.
 * Devuelve { indice, calidad: 'justo' | 'bien', error } o null si no había ninguno cerca.
 */
export function juzgar(cancion, resultados, t, { ventanaJusta = RITMO.ventanaJusta, ventanaBien = RITMO.ventanaBien } = {}) {
  let mejor = null;
  cancion.golpes.forEach((g, i) => {
    if (resultados[i]) return;
    const error = t - g.t;
    if (Math.abs(error) > ventanaBien) return;
    if (!mejor || Math.abs(error) < Math.abs(mejor.error)) mejor = { indice: i, error };
  });
  if (!mejor) return null;
  return { ...mejor, calidad: Math.abs(mejor.error) <= ventanaJusta ? 'justo' : 'bien' };
}

/** Los golpes que ya pasaron sin pulsación quedan fuera. Devuelve los índices que se acaban de perder. */
export function marcarPerdidos(cancion, resultados, t, { ventanaBien = RITMO.ventanaBien } = {}) {
  const perdidos = [];
  cancion.golpes.forEach((g, i) => {
    if (!resultados[i] && t > g.t + ventanaBien) { resultados[i] = 'fuera'; perdidos.push(i); }
  });
  return perdidos;
}

/**
 * El flow de 0 a 1: lo que valen los golpes juzgados, menos la multa por pulsar sin golpe cerca.
 * Con `soloJuzgados`, cuenta sobre lo que va de la canción (para que la gente reaccione en el camino).
 */
export function flowDe(cancion, resultados, extras = 0, { soloJuzgados = false } = {}) {
  const juzgados = cancion.golpes.map((_, i) => resultados[i]).filter(Boolean);
  const base = soloJuzgados ? juzgados.length : cancion.golpes.length;
  if (!base) return soloJuzgados ? 0.5 : 0;
  const suma = juzgados.reduce((s, r) => s + (VALOR[r] ?? 0), 0) - extras * RITMO.multaExtra;
  return Math.max(0, Math.min(1, suma / base));
}

/** El nivel que da un flow. */
export function nivelDe(flow) {
  for (const [nivel, desde] of NIVELES) if (flow + 1e-9 >= desde) return nivel;
  return 'bajado';
}

/**
 * La racha del final: cuántos golpes seguidos, contando desde el último juzgado hacia atrás, pegaron (`buenos`)
 * o se perdieron (`malos`). Una de las dos es cero.
 */
export function rachaDe(cancion, resultados) {
  let ultimo = -1;
  cancion.golpes.forEach((_, i) => { if (resultados[i]) ultimo = i; });
  if (ultimo < 0) return { buenos: 0, malos: 0 };
  const fallo = resultados[ultimo] === 'fuera';
  let n = 0;
  for (let i = ultimo; i >= 0 && resultados[i] && (resultados[i] === 'fuera') === fallo; i--) n++;
  return fallo ? { buenos: 0, malos: n } : { buenos: n, malos: 0 };
}

/** Lo que se dice cuando un pedazo no pegó: no se repite el mismo dos veces seguidas. */
export function trabada(random = Math.random, anterior = null) {
  let texto = TRABADAS[Math.floor(random() * TRABADAS.length) % TRABADAS.length];
  if (texto === anterior) texto = TRABADAS[(TRABADAS.indexOf(texto) + 1) % TRABADAS.length];
  return texto;
}
