import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { TalentSystem } from '../src/systems/TalentSystem.js';
import { DiseaseSystem } from '../src/systems/DiseaseSystem.js';
import { Pickup } from '../src/entities/Pickup.js';
import { ITEMS } from '../src/data/items.js';

globalThis.window ??= { dispatchEvent() {} };
globalThis.CustomEvent ??= class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };

function unlock(...ids) {
  const talents = new TalentSystem();
  talents.addPoints(10);
  for (const id of ids) assert.equal(talents.unlock(id), true, id);
  return talents;
}

test('los talentos multiplican resistencias y tasas, pero suman la capacidad de carga', () => {
  const talents = unlock('surv1', 'surv2', 'collector1', 'collector2');
  assert.equal(talents.getEffect('diseaseResist'), 0.6);
  assert.equal(talents.getEffect('diseaseResist', 0.5), 0.3);
  assert.equal(talents.getEffect('decayMult', 100), 70);
  assert.equal(talents.getEffect('rareChanceMult'), 1.25);
  assert.equal(talents.getEffect('maxWeightBonus', 20), 30);
  assert.equal(talents.getEffect('xpMult'), 1);
});

test('Piel Dura reduce la infección real del 12 % al 7,2 % al recoger basura', (t) => {
  const base = new TalentSystem();
  const resistant = unlock('surv1', 'surv2');
  let roll = 0;
  t.mock.method(Math, 'random', () => roll);
  const infections = (talents) => {
    let total = 0;
    // Tiradas uniformes deterministas: cubren la probabilidad completa sin azar.
    for (let i = 0; i < 1000; i++) {
      roll = (i + 0.5) / 1000;
      const disease = new DiseaseSystem();
      if (disease.tryInfect(false, talents.getEffect('diseaseResist'))) total++;
    }
    return total;
  };
  assert.equal(infections(base), 120);
  assert.equal(infections(resistant), 72);
});

/** Azar repetible: la misma secuencia con y sin la maña. */
function azar(semilla) {
  let s = semilla >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Escoge `bolsas` bolsas con los efectos que pasa InteractionSystem y devuelve lo que vale lo recogido. */
function valorEscogido(efectos, { bolsas = 4000, semilla = 7, boost = false, sorted = true } = {}) {
  const random = Math.random;
  Math.random = azar(semilla);
  try {
    const bolsa = new Pickup(new THREE.Scene(), new THREE.Vector3());
    let valor = 0;
    for (let i = 0; i < bolsas; i++) {
      bolsa.used = false; bolsa.cooldown = 0;
      for (const id of bolsa.harvest(boost, sorted, efectos).items) valor += ITEMS[id]?.value ?? 0;
    }
    return valor;
  } finally { Math.random = random; }
}

test('«Escoger con calma» saca en promedio el 50 % más de valor al escoger, como dice la maña', () => {
  const calma = unlock('collector1', 'collector2', 'collector3');
  assert.match(calma.get('collector3').desc, /50 % más de valor/);
  const efectos = (talents) => ({ rareChanceMult: talents.getEffect('rareChanceMult', 1), sortValueMult: talents.getEffect('sortValueMult', 1) });
  const sin = efectos(unlock('collector1', 'collector2')), con = efectos(calma);
  for (const boost of [false, true]) {
    const proporcion = valorEscogido(con, { boost }) / valorEscogido(sin, { boost });
    assert.ok(Math.abs(proporcion - 1.5) < .05, `con envión ${boost}: ${proporcion.toFixed(3)} veces el valor de antes`);
  }
  // Recoger de una, sin escoger, no cambia: la maña es de escoger con calma.
  assert.equal(valorEscogido(con, { sorted: false, bolsas: 500 }), valorEscogido(sin, { sorted: false, bolsas: 500 }));
});

test('«Escoger con calma» da tiradas enteras de más: cuatro pasan a seis, y la media tirada se juega a la suerte', (t) => {
  const bolsa = new Pickup(new THREE.Scene(), new THREE.Vector3());
  const tiradas = (efectos, suerte, boost = false) => {
    t.mock.method(Math, 'random', () => suerte);
    bolsa.used = false; bolsa.cooldown = 0;
    const n = bolsa.harvest(boost, true, efectos).items.length;
    t.mock.restoreAll();
    return n;
  };
  // Con suerte alta no sale nada raro: solo cuentan las tiradas comunes.
  assert.equal(tiradas({}, .99), 4);
  assert.equal(tiradas({ sortValueMult: 1.5 }, .99), 6);
  assert.equal(tiradas({ sortValueMult: 1.5 }, .99, true), 9, 'con envión, de seis a nueve');
  // El reciclador escoge cinco: con la maña son siete y media, siete u ocho según la suerte.
  assert.equal(tiradas({ sortValueMult: 1.5, extraRolls: 1 }, .99), 7);
  assert.equal(tiradas({ sortValueMult: 1.5, extraRolls: 1 }, .3), 8);
  // La chance de algo raro también sube a la mitad más: de 12 % a 18 %.
  assert.equal(tiradas({}, .15), 4, 'sin la maña, con esa suerte no sale nada raro');
  assert.equal(tiradas({ sortValueMult: 1.5 }, .15), 6 + 1, 'con la maña sí');
});
