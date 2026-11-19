import { COLOR } from './carParts.js';

// Trazos de un carácter de 3,6 × 2,8 cm: centro y medio tamaño en alto y en ancho, mirando la placa desde atrás.
const TRAZO = .0028, ALTO = .018, ANCHO = .014;
// Trazos posibles: arriba, abajo, medio, izquierda y derecha enteras. Cada letra o número es la suma de los suyos.
const TRAZOS = [[ALTO - TRAZO, 0, TRAZO, ANCHO], [TRAZO - ALTO, 0, TRAZO, ANCHO], [0, 0, TRAZO, ANCHO], [0, TRAZO - ANCHO, ALTO, TRAZO], [0, ANCHO - TRAZO, ALTO, TRAZO]];
const SIGNOS = { A: 29, C: 11, E: 15, F: 13, H: 28, L: 10, U: 26, 0: 27, 1: 16, 3: 23, 7: 17, 8: 31 };
// Arriba tres letras y abajo dos números y una letra, como las placas de moto; ninguna existe.
export const PLACAS_MOTO = ['HCE 37L', 'UEL 81C', 'AFC 70L', 'CLE 13C', 'ECF 08L', 'LEF 73C', 'FCL 18L', 'HLC 30C'];
export const MASCARAS = PLACAS_MOTO.flatMap(placa => [...placa.replace(' ', '')].map(signo => SIGNOS[signo]));
// Cada carácter lleva solo los trazos que usa alguna placa en ese sitio; la moto muestra los de la suya.
const TRAZOS_POR_SITIO = [0, 1, 2, 3, 4, 5].map(k => MASCARAS.reduce((suma, mascara, i) => i % 6 === k ? suma | mascara : suma, 0));

export function dibujarPlacaMoto(b) {
  // Dos renglones de tres caracteres de trazo fino, inventados: de cerca se leen letras y números, no cuadros.
  // La U de cada vértice dice qué trazo es (desde 2) y la V en qué carácter va.
  for (let k = 0; k < 6; k++) {
    const y = k < 3 ? .679 : .632, z = (k % 3 - 1) * .052;
    TRAZOS.forEach(([cy, cz, hy, hz], trazo) => {
      if (!(TRAZOS_POR_SITIO[k] >> trazo & 1)) return;
      b.quad(...[[y + cy - hy, z + cz - hz], [y + cy - hy, z + cz + hz], [y + cy + hy, z + cz + hz], [y + cy + hy, z + cz - hz]]
        .map(([py, pz]) => b.v(-.944, py, pz, -1, 0, 0, 2 + trazo, k, ...COLOR.dark)));
    });
  }
}
