// src/character/presets.js
// Estilos de calle y personajes listos para elegir en el creador: combinaciones curadas de piezas
// realistas, colores y desgaste. Tributo a Los Reyes y personajes de la ciudad. Solo usan piezas del catálogo exportado.

export const STREET_PRESETS = [
  {
    id: 'beto',
    label: 'Beto Reyes (El Presidente)',
    desc: 'Traje de paño azul marino impecable, camisa de cuello blanco, corbata roja y zapatos de charol. El presidente del Grupo GER.',
    look: {
      nombre: 'Beto Reyes',
      origen: 'beto',
      piel: 2,
      peloColor: 0,
      ojos: 0,
      cejas: 'gruesas',
      contextura: 'robusto',
      desgaste: 0,
      arribaColor: 10,
      abajoColor: 10,
      zapatoColor: 0,
      cabezaColor: 0,
      accesorios: [],
      real: {
        sexo: 'hombre',
        edad: 'adulto',
        pelo: 'corto',
        barba: 'ninguna',
        ropa: 'chaqueta',
        calzado: 'zapatos',
        cabeza: 'sin-sombrero',
        talla: { ancho: 1.08, alto: 1.02 },
        tonos: {
          arriba: '#1d2b45',
          abajo: '#131b28',
          calzado: '#111111'
        }
      }
    }
  },
  {
    id: 'leo',
    label: 'Leo Reyes (El Mecánico)',
    desc: 'Camisa de jean de trabajo, contextura ágil y botas. El galán mecánico de La Fraguita.',
    look: {
      nombre: 'Leo Reyes',
      origen: 'leo',
      piel: 2,
      peloColor: 0,
      ojos: 0,
      cejas: 'gruesas',
      contextura: 'normal',
      desgaste: 1,
      arribaColor: 10,
      abajoColor: 6,
      zapatoColor: 0,
      cabezaColor: 0,
      accesorios: [],
      real: {
        sexo: 'hombre',
        edad: 'joven',
        pelo: 'desordenado',
        barba: 'bigote',
        ropa: 'camisa',
        calzado: 'botas',
        cabeza: 'sin-sombrero'
      }
    }
  },
  {
    id: 'hilda',
    label: 'Hilda Reyes (La Gata Montesa)',
    desc: 'Camiseta colorida, cabello largo y botas. Toda la alegría y fuerza de la tecnocarrilera.',
    look: {
      nombre: 'Hilda Reyes',
      origen: 'hilda',
      piel: 2,
      peloColor: 0,
      ojos: 0,
      cejas: 'delgadas',
      contextura: 'normal',
      desgaste: 0,
      arribaColor: 0,
      abajoColor: 10,
      zapatoColor: 0,
      cabezaColor: 0,
      accesorios: [],
      real: {
        sexo: 'mujer',
        edad: 'adulta',
        pelo: 'largo',
        barba: 'ninguna',
        ropa: 'blusa',
        calzado: 'botas',
        cabeza: 'sin-sombrero'
      }
    }
  },
  {
    id: 'laisa',
    label: 'Laisa Reyes (La Diva de Rosales)',
    desc: 'Melena exuberante, elegancia deslumbrante y zapatos finos. Conquista Rosales y a Emilio Iriarte.',
    look: {
      nombre: 'Laisa Reyes',
      origen: 'laisa',
      piel: 1,
      peloColor: 0,
      ojos: 0,
      cejas: 'delgadas',
      contextura: 'normal',
      desgaste: 0,
      arribaColor: 9,
      abajoColor: 6,
      zapatoColor: 0,
      cabezaColor: 0,
      accesorios: [],
      real: {
        sexo: 'mujer',
        edad: 'adulta',
        pelo: 'melena',
        barba: 'ninguna',
        ropa: 'blusa',
        calzado: 'zapatos',
        cabeza: 'sin-sombrero'
      }
    }
  },
  {
    id: 'sabio',
    label: 'El Sabio',
    desc: 'Melena y barba largas, canosas. Chaqueta oscura curtida por los años de calle.',
    look: { piel: 2, peloColor: 5, desgaste: 2, real: { sexo: 'hombre', edad: 'mayor', pelo: 'largo', barba: 'larga', ropa: 'chaqueta', calzado: 'zapatos' } }
  },
  {
    id: 'banca',
    label: 'Don de la banca',
    desc: 'Gorro de lana, barba blanca de varios días, chaqueta gruesa, botas y bastón.',
    look: { piel: 3, peloColor: 6, desgaste: 2, accesorios: ['baston'], real: { sexo: 'hombre', edad: 'mayor', pelo: 'rapado', barba: 'descuidada', ropa: 'chaqueta', calzado: 'botas', cabeza: 'gorro-lana' } }
  },
  {
    id: 'caminante',
    label: 'El Caminante',
    desc: 'Pelo revuelto entrecano, bigote, descalzo, con bastón y mochila. Recorre la ciudad de punta a punta.',
    look: { piel: 4, peloColor: 5, desgaste: 2, accesorios: ['baston', 'mochila'], real: { sexo: 'hombre', edad: 'mayor', pelo: 'desordenado', barba: 'bigote', ropa: 'camisa', calzado: 'descalzo' } }
  },
  {
    id: 'reciclador',
    label: 'El Reciclador',
    desc: 'Camiseta rota, cargo lleno de bolsillos y tenis que ya no dan más.',
    look: { piel: 3, peloColor: 0, desgaste: 2, real: { sexo: 'hombre', edad: 'adulto', pelo: 'desordenado', barba: 'descuidada', ropa: 'rota', calzado: 'tenis-rotos' } }
  },
  {
    id: 'dona',
    label: 'La Doña',
    desc: 'Pelo largo canoso y saco de lana para aguantar las noches bogotanas.',
    look: { piel: 2, peloColor: 5, desgaste: 2, real: { sexo: 'mujer', edad: 'mayor', pelo: 'largo', barba: 'ninguna', ropa: 'saco', calzado: 'botas' } }
  },
  {
    id: 'pelao',
    label: 'El Pelao',
    desc: 'Joven, crespo, con el buzo de siempre. Lleva poco en la calle, pero ya se le nota.',
    look: { piel: 4, peloColor: 0, desgaste: 1, real: { sexo: 'hombre', edad: 'joven', pelo: 'crespo', barba: 'ninguna', ropa: 'buzo', calzado: 'tenis' } }
  }
];

/** Aplica un estilo de calle sin tocar la identidad (nombre y origen) a menos que el preset los defina explícitamente. */
export function applyStreetPreset(look, preset) {
  const pLook = preset.look;
  return {
    ...look,
    ...pLook,
    nombre: pLook.nombre ?? look.nombre,
    origen: pLook.origen ?? look.origen,
    real: { ...pLook.real },
    accesorios: [...(pLook.accesorios ?? [])],
    v: 2
  };
}
