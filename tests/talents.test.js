import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TalentSystem } from '../src/systems/TalentSystem.js';
import { DiseaseSystem } from '../src/systems/DiseaseSystem.js';

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
