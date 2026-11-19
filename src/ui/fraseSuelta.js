// src/ui/fraseSuelta.js
// La burbuja de quien habla sin ser un peatón: el conductor que contesta desde su carro. Sale encima del carro y va
// con él; la reparte ui/frases.js con las de la gente y se quita sola a su tiempo.
import { Vector3 } from 'three';
import { ALTO_FRASE, acabarFrase, empezarFrase } from './frases.js';

const SOBRE_EL_TECHO = .3; // m entre el techo de quien habla y su burbuja

const sueltas = new WeakMap(); // quien habla → su frase a la vista

function quitar(frase) {
  clearTimeout(frase.reloj);
  frase._bubbleEl?.remove();
  frase._bubbleEl = null;
  acabarFrase(frase);
}

/**
 * A qué altura sobre el piso va la burbuja de `quien`: encima de su techo. `alto` son los metros que mide; sin él, lo
 * que mida su vehículo (`quien.vehicle.height`). Nunca más abajo que la de una persona.
 */
export function altoDeFrase(quien, alto = null) {
  const mide = alto ?? quien?.vehicle?.height;
  return Number.isFinite(mide) ? Math.max(ALTO_FRASE, mide + SOBRE_EL_TECHO) : ALTO_FRASE;
}

/**
 * `quien` (un carro, una buseta, un bus) dice `text` durante `seconds`: su burbuja sale encima de él, a la altura de
 * `altoDeFrase`. Sin `text` se le quita la que tenga.
 */
export function fraseSuelta(quien, text, seconds = 3.5, alto = null) {
  if (typeof document === 'undefined' || !quien?.position?.distanceTo) return;
  const previa = sueltas.get(quien);
  if (previa) { quitar(previa); sueltas.delete(quien); }
  if (!text) return;
  const container = document.getElementById('npc-bubbles-container') ?? document.body;
  if (!container) return;
  const el = document.createElement('div');
  el.className = 'npc-bubble';
  el.textContent = text;
  container.appendChild(el);
  // Lo que ui/frases.js lee de quien habla: dónde está, su burbuja y lo que mide.
  const frase = { get position() { return quien.position; }, _projPos: new Vector3(), _bubbleEl: el, _fraseW: el.offsetWidth, _fraseH: el.offsetHeight, _fraseVista: 'no', _fraseAlto: altoDeFrase(quien, alto), reloj: null };
  el.style.display = 'none';
  frase.reloj = setTimeout(() => quitar(frase), seconds * 1000);
  frase.reloj?.unref?.();
  sueltas.set(quien, frase);
  empezarFrase(frase);
}
