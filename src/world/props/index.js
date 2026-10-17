// src/world/props/index.js
import * as THREE from 'three';
import { Farol } from './Farol.js';
import { Banca } from './Banca.js';
import { Semaforo } from './Semaforo.js';
import { Hidrante } from './Hidrante.js';
import { Cartel } from './Cartel.js';
import { ArbolMuerto } from './ArbolMuerto.js';

/**
 * Crea un prop aleatorio en base a pesos por tipo.
 * Devuelve { instance, group, updatable }
 */
export function createRandomProp(position, forcedType = null, opts = {}) {
  const roll = Math.random();
  let type = forcedType;

  if (!type) {
    if (roll < 0.30) type = 'farol';
    else if (roll < 0.50) type = 'banca';
    else if (roll < 0.65) type = 'semaforo';
    else if (roll < 0.78) type = 'hidrante';
    else if (roll < 0.90) type = 'cartel';
    else type = 'arbol';
  }

  let instance;
  let needsUpdate = false;

  switch (type) {
    case 'farol':    instance = new Farol(position, opts); break;
    case 'banca':    instance = new Banca(position, Math.random() * Math.PI * 2); break;
    case 'semaforo': instance = new Semaforo(position, Math.random() * Math.PI * 2); needsUpdate = true; break;
    case 'hidrante': instance = new Hidrante(position); break;
    case 'cartel':   instance = new Cartel(position, Math.random() * Math.PI * 2, 'PUERTO CENIZA'); break;
    case 'arbol':    instance = new ArbolMuerto(position); break;
    default: return null;
  }

  return {
    instance,
    group: instance.group,
    updatable: needsUpdate,
    type
  };
}

export { Farol, Banca, Semaforo, Hidrante, Cartel, ArbolMuerto };