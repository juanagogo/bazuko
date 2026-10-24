// src/character/presets.js
// Estilos de calle listos para elegir en el creador: combinaciones curadas de piezas realistas,
// colores y desgaste inspiradas en habitantes de calle reales. Solo usan piezas del catálogo exportado.

export const STREET_PRESETS = [
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

/** Aplica un estilo de calle sin tocar la identidad (nombre y origen). */
export function applyStreetPreset(look, preset) {
  return { ...look, ...preset.look, real: { ...preset.look.real }, accesorios: [...(preset.look.accesorios ?? [])], v: 2 };
}
