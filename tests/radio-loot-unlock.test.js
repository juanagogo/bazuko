// tests/radio-loot-unlock.test.js
import test from 'node:test';
import assert from 'node:assert/strict';

import { RadioSystem } from '../src/systems/RadioSystem.js';
import { distributeRadioLoot } from '../src/systems/ShelterLoot.js';

test('Issue #19: distributeRadioLoot entrega exactamente una radio transistor cuando hasRadio es falso', () => {
  const mockPickups = [
    { guaranteedLoot: [] },
    { guaranteedLoot: [] },
    { guaranteedLoot: [] }
  ];

  distributeRadioLoot(mockPickups, false);

  const radioPickups = mockPickups.filter((p) => p.guaranteedLoot.includes('radioTransistor'));
  assert.equal(radioPickups.length, 1, 'Debe haber exactamente un pickup con radioTransistor');
});

test('Issue #19: distributeRadioLoot no duplica la radio en respawns ni cuando el jugador ya la tiene', () => {
  const mockPickups = [
    { guaranteedLoot: ['radioTransistor'] },
    { guaranteedLoot: [] },
    { guaranteedLoot: [] }
  ];

  // Si ya existe una en la basura, no se duplica
  distributeRadioLoot(mockPickups, false);
  let radioCount = mockPickups.filter((p) => p.guaranteedLoot.includes('radioTransistor')).length;
  assert.equal(radioCount, 1, 'No debe duplicar radioTransistor si ya está en la basura');

  // Si el jugador ya la encontró (hasRadio = true), no añade ninguna
  const emptyPickups = [{ guaranteedLoot: [] }, { guaranteedLoot: [] }];
  distributeRadioLoot(emptyPickups, true);
  radioCount = emptyPickups.filter((p) => p.guaranteedLoot.includes('radioTransistor')).length;
  assert.equal(radioCount, 0, 'No debe colocar radioTransistor si el jugador ya posee la radio');
});

test('Issue #19: RadioSystem permite persistir hasRadio y conserva frecuencia y batería', () => {
  const radio = new RadioSystem();
  radio.hasRadio = true;
  radio.setFrequency(890);
  radio.battery = 45;

  const serialized = {
    isOn: radio.isOn,
    freq: radio.frequency,
    battery: radio.battery,
    hasRadio: radio.hasRadio
  };

  assert.equal(serialized.hasRadio, true);
  assert.equal(serialized.freq, 890);
  assert.equal(serialized.battery, 45);

  const restored = new RadioSystem();
  restored.hasRadio = serialized.hasRadio;
  restored.setFrequency(serialized.freq);
  restored.battery = serialized.battery;

  assert.equal(restored.hasRadio, true);
  assert.equal(restored.frequency, 890);
  assert.equal(restored.battery, 45);
});
