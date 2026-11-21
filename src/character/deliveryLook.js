export const DELIVERY_COLORS = Object.freeze({ red: '#d93a34', dark: '#1d1d1f', reflective: '#bfc3c7', denim: '#5c7fa5' });

export function deliveryLook(look, gear = []) {
  if (!gear.length) return look;
  const result = { ...look, deliveryGear: gear };
  const real = { ...look?.real };
  if (gear.includes('jacket')) {
    result.arriba = 'chaqueta';
    result.arribaColor = 0;
    real.ropa = real.sexo === 'mujer' ? 'sudadera' : 'chaqueta';
    real.tonos = { arriba: DELIVERY_COLORS.red, abajo: DELIVERY_COLORS.denim,
      calzado: real.tonos?.calzado, patron: 'reflectivo', patronColor: DELIVERY_COLORS.reflective };
  }
  if (gear.includes('cap')) {
    result.cabeza = 'gorra';
    result.cabezaColor = 0;
    real.cabeza = 'sin-sombrero';
  }
  if (gear.includes('bag')) result.accesorios = (look?.accesorios ?? []).filter(id => id !== 'mochila');
  return { ...result, real };
}
