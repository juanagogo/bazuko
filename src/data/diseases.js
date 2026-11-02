// src/data/diseases.js
// Enfermedades de la calle. `fuente` dice cómo se contraen: escarbando la basura, cortándose con
// metal (latas y chatarra) o durmiendo sucio. Cada una tiene su remedio en la tienda (`cure` en items.js).
import { DISEASE_HEALTH_DRAIN, DISEASE_MENTAL_DRAIN, DISEASE_DURATION } from '../utils/constants.js';

export const DISEASES = {
  gripe: {
    id: 'gripe',
    name: 'Gripe',
    emoji: '🤧',
    fuente: 'basura',
    healthDrain: DISEASE_HEALTH_DRAIN,
    mentalDrain: DISEASE_MENTAL_DRAIN * 0.5,
    duration: DISEASE_DURATION
  },
  infeccion: {
    id: 'infeccion',
    name: 'Infección',
    emoji: '🦠',
    fuente: 'basura',
    healthDrain: DISEASE_HEALTH_DRAIN * 1.8,
    mentalDrain: DISEASE_MENTAL_DRAIN,
    duration: DISEASE_DURATION * 1.2
  },
  intoxicacion: {
    id: 'intoxicacion',
    name: 'Intoxicación',
    emoji: '🤢',
    fuente: 'basura',
    healthDrain: DISEASE_HEALTH_DRAIN * 0.8,
    mentalDrain: DISEASE_MENTAL_DRAIN * 1.5,
    duration: DISEASE_DURATION * 0.8
  },

  // Estas tres no se pasan solas en un minuto: para eso están sus remedios.
  parasitos: {
    id: 'parasitos',
    name: 'Parásitos',
    emoji: '🪱',
    fuente: 'basura',
    healthDrain: DISEASE_HEALTH_DRAIN * 0.2,
    hungerDrainMultiplier: 3,   // la comida rinde mucho menos
    duration: DISEASE_DURATION * 8
  },
  tetanos: {
    id: 'tetanos',
    name: 'Tétanos',
    emoji: '🔩',
    fuente: 'corte',
    healthDrain: DISEASE_HEALTH_DRAIN * 0.5,
    mentalDrain: DISEASE_MENTAL_DRAIN,
    speedMultiplier: 0.8,       // rigidez de los músculos
    duration: DISEASE_DURATION * 8
  },
  sarna: {
    id: 'sarna',
    name: 'Sarna',
    emoji: '🐜',
    fuente: 'dormir',
    mentalDrain: DISEASE_MENTAL_DRAIN * 3,  // la rasquiña no deja en paz
    energyDrainMultiplier: 1.5,             // ni descansar
    duration: DISEASE_DURATION * 8
  }
};

/** Nombre para mostrar de una enfermedad; el id si no existe. */
export const diseaseName = (id) => DISEASES[id]?.name ?? id;
