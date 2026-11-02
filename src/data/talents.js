// src/data/talents.js
// Las mañas: lo que se aprende en la calle, dicho en primera persona. Cada una tiene id, nombre, descripción, costo,
// rama y efectos que se aplican al juego. Los ids y las ramas no se tocan: los usan las partidas guardadas.

export const TALENTS = {
  // ===== RAMA: Recolección =====
  collector1: {
    id: 'collector1',
    name: 'Buen ojo',
    desc: 'Aprendí a ver lo que vale en la basura: 25 % más de cosas raras.',
    branch: 'recoleccion',
    cost: 1,
    requires: [],
    effects: { rareChanceMult: 1.25 }
  },
  collector2: {
    id: 'collector2',
    name: 'Saber cargar',
    desc: 'Acomodo mejor lo que llevo: me caben 10 kg más en el costal.',
    branch: 'recoleccion',
    cost: 1,
    requires: ['collector1'],
    effects: { maxWeightBonus: 10 }
  },
  collector3: {
    id: 'collector3',
    name: 'Escoger con calma',
    desc: 'Escogiendo la basura saco 50 % más de valor y me enfermo 20 % menos.',
    branch: 'recoleccion',
    cost: 2,
    requires: ['collector2'],
    effects: { sortValueMult: 1.5, sortDiseaseMult: 0.8 }
  },

  // ===== RAMA: Supervivencia =====
  surv1: {
    id: 'surv1',
    name: 'Estirar la comida',
    desc: 'Aprendí a aguantar: el hambre y la sed me bajan 30 % más despacio.',
    branch: 'supervivencia',
    cost: 1,
    requires: [],
    effects: { decayMult: 0.7 }
  },
  surv2: {
    id: 'surv2',
    name: 'Saber cuidarme',
    desc: 'La basura me enferma 40 % menos, y dormir también me da menos sarna.',
    branch: 'supervivencia',
    cost: 1,
    requires: ['surv1'],
    effects: { diseaseResist: 0.6 }
  },
  surv3: {
    id: 'surv3',
    name: 'Cabeza fría',
    desc: 'Aprendí a no darle vueltas: el ánimo me baja a la mitad.',
    branch: 'supervivencia',
    cost: 2,
    requires: ['surv2'],
    effects: { mentalDecayMult: 0.5 }
  },

  // ===== RAMA: Crimen =====
  crime1: {
    id: 'crime1',
    name: 'Mano suave',
    desc: 'Me pillan robando 20 % menos.',
    branch: 'crimen',
    cost: 1,
    requires: [],
    effects: { stealCaughtMult: 0.8 }
  },
  crime2: {
    id: 'crime2',
    name: 'Conocidos',
    desc: 'Ya me conocen: me pagan 30 % más por las sustancias.',
    branch: 'crimen',
    cost: 1,
    requires: ['crime1'],
    effects: { substancePriceMult: 1.3 }
  },
  crime3: {
    id: 'crime3',
    name: 'Cogerle el tiro',
    desc: 'Aprendo 50 % más de todo lo que hago.',
    branch: 'crimen',
    cost: 2,
    requires: ['crime2'],
    effects: { xpMult: 1.5 }
  }
};

export const BRANCHES = [
  { id: 'recoleccion',  name: 'El rebusque', emoji: '🗑️' },
  { id: 'supervivencia', name: 'El aguante', emoji: '🩹' },
  { id: 'crimen',        name: 'La viveza', emoji: '🔪' }
];
