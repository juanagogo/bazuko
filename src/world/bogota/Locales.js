// Locales de barrio: qué oficio atiende en el primer piso de cada solar. Solo datos y sorteo, sin Three ni lienzo.
import { rng } from './textures.js';
import { neighborhoodAt } from './NeighborhoodIdentity.js';

/** Clases en que se reparten los oficios. Un solar mide de 1 a 4 tiles: con cinco clases, dos vecinos nunca coinciden. */
export const CLASES = 5;

/** Nombres de cada oficio que caben en el aviso grande; el que sigue va en el rótulo pintado. */
export const NOMBRES_DE_AVISO = 2;

// peso: [popular, comercio, residencial, centro]. Todos los nombres son inventados.
const oficio = (id, clase, titulo, nombres, fondo, tinta, acento, interior, persiana, toldos, anden, peso, extra = {}) =>
  Object.freeze({ id, clase, titulo, nombres: Object.freeze(nombres), fondo, tinta, acento, interior, persiana,
    toldos: Object.freeze(toldos), anden: Object.freeze(anden), peso: Object.freeze(peso), ...extra });

export const OFICIOS = Object.freeze([
  oficio('tienda', 0, 'TIENDA', ['DONDE PACHO', 'LA VECINA', 'MI RANCHITO'], '#b79a3c', '#4f1d18', '#7a2a1f',
    'abarrotes', 'persianaVerde', ['awning', 'toldoLona'], ['canastas', 'nevera'], [2, 1, 3, 1], { reja: true }),
  oficio('drogueria', 0, 'DROGUERÍA', ['SALUD Y VIDA', 'EL ALIVIO', 'LA BOTICA DEL BARRIO'], '#dedbcb', '#2c6a45', '#2c6a45',
    'farmacia', 'persianaGris', ['toldoVerde', 'toldoVerde'], ['tijera', 'matera'], [1, 2, 2, 1], { luz: true, bandera: 'cruz' }),
  oficio('montallantas', 0, 'MONTALLANTAS', ['EL DESPINCHE', 'LA TUERCA', 'DON CHUCHO'], '#3b3c3a', '#d9b53c', '#d8d2c0',
    'taller', 'persianaGris', ['zinc', 'zinc'], ['llantas', 'llantas'], [4, .6, 0, 0]),
  oficio('cabinas', 0, 'CABINAS', ['A TODO OPERADOR', 'INTERNET Y LLAMADAS', 'LA CONEXIÓN'], '#2f5b86', '#e9dd8a', '#e6e0cf',
    'cabinas', 'persianaAzul', ['awning2', 'toldoLona'], ['tijera', 'afiches'], [1, 2, 1, 2]),
  oficio('restaurante', 0, 'RESTAURANTE', ['EL CORRIENTAZO', 'DONDE LA TÍA', 'SAZÓN DE MI TIERRA'], '#a8452f', '#f0e3c4', '#e7c95a',
    'mesas', 'persianaRoja', ['awning', 'toldoLona'], ['almuerzo', 'sillas'], [1, 2, 1, 2]),

  oficio('panaderia', 1, 'PANADERÍA', ['EL TRIGAL', 'LA MOGOLLA', 'PAN DE LAS CINCO'], '#c79a4a', '#5a2a16', '#7a2f1a',
    'pan', 'persianaOcre', ['toldoLona', 'awning'], ['sillas', 'canastas'], [1, 2, 3, 1], { luz: true }),
  oficio('ferreteria', 1, 'FERRETERÍA', ['EL TORNILLO', 'LA PUNTILLA', 'EL MARTILLO'], '#35557a', '#ecdc7c', '#e6e0cf',
    'ferre', 'persianaAzul', ['zinc', 'awning2'], ['costales', 'cajas'], [2, 2, 1, .6]),
  oficio('peluqueria', 1, 'PELUQUERÍA', ['EL COPETE', 'TIJERAS DE ORO', 'BARBERÍA EL PATILLAS'], '#7d4a78', '#f0e2c8', '#e8c96a',
    'barberia', 'persianaGris', ['awning2', 'toldoLona'], ['matera', 'afiches'], [1, 2, 2, 1], { bandera: 'barbero' }),
  oficio('compraventa', 1, 'COMPRAVENTA', ['EL CENTAVO', 'LA PRENDA', 'EL EMPEÑO'], '#b3a03a', '#2a2a26', '#7a1f1a',
    'oficina', 'persianaOcre', ['zinc', 'toldoLona'], ['afiches', 'cajas'], [3, 1, .4, 1], { reja: true }),
  oficio('lavanderia', 1, 'LAVANDERÍA', ['AL INSTANTE', 'LA ESPUMA', 'ROPA LIMPIA'], '#4f8ea3', '#f1ead6', '#f1ead6',
    'ropa', 'persianaAzul', ['awning2', 'toldoLona'], ['matera', 'canastas'], [.5, 1, 2, 1]),
  oficio('tramites', 1, 'TRÁMITES', ['DECLARACIONES', 'CONTADOR Y ABOGADO', 'AUTENTICACIONES'], '#56605c', '#eae3cf', '#d9c06a',
    'oficina', 'persianaGris', ['toldoVerde', 'awning2'], ['matera', 'tijera'], [0, 1, .4, 4]),

  oficio('carniceria', 2, 'FAMA', ['LA NOVILLA', 'EL BUEN CORTE', 'LA TERNERA'], '#a33a30', '#f1e8d6', '#f1e8d6',
    'carne', 'persianaRoja', ['awning', 'awning'], ['canastas', 'tijera'], [1, 2, 2, .5]),
  oficio('papeleria', 2, 'PAPELERÍA', ['FOTOCOPIAS', 'EL TAJALÁPIZ', 'LA CARTULINA'], '#d8cf9e', '#273f73', '#9a2a22',
    'papeleria', 'persianaAzul', ['awning2', 'toldoLona'], ['tijera', 'afiches'], [.6, 2, 1, 3]),
  oficio('motos', 2, 'TALLER DE MOTOS', ['EL PIÑÓN', 'LA BIELA', 'EL PISTÓN'], '#2f3a36', '#e2863a', '#d8d2c0',
    'taller', 'persianaRoja', ['zinc', 'zinc'], ['llantas', 'caneca'], [4, .6, 0, 0]),
  oficio('cigarreria', 2, 'CIGARRERÍA', ['LA 10', 'EL PORTAL', 'LA ESQUINA'], '#8a3b2e', '#efe2c2', '#e3c25a',
    'botellas', 'persianaVerde', ['awning', 'toldoVerde'], ['canastas', 'sillas'], [1, 2, 1, 2], { reja: true }),
  oficio('modisteria', 2, 'MODISTERÍA', ['ARREGLOS', 'EL DEDAL', 'LA AGUJA'], '#b77f95', '#3a1f33', '#f0e6d2',
    'ropa', 'persianaOcre', ['toldoLona', 'awning2'], ['matera', 'afiches'], [1, 1, 2, .6]),

  oficio('fruteria', 3, 'FRUVER', ['LA COSECHA', 'EL GUACAL', 'LA PLAZA CHIQUITA'], '#5f8a3e', '#f2e9c4', '#f0d04a',
    'fruta', 'persianaVerde', ['toldoVerde', 'toldoLona'], ['guacales', 'guacales'], [1, 2, 3, .5]),
  oficio('cacharreria', 3, 'REMATE', ['TODO A MIL', 'EL BARATILLO', 'EL AGÁCHESE'], '#c7a530', '#8a1f1a', '#1f3f73',
    'abarrotes', 'persianaRoja', ['awning', 'toldoLona'], ['cajas', 'tijera'], [2, 3, 1, 1]),
  oficio('billares', 3, 'BILLARES', ['LA BOLA 8', 'EL TACO', 'LA CARAMBOLA'], '#2f5f48', '#ead9a0', '#ead9a0',
    'billar', 'persianaVerde', ['zinc', 'toldoVerde'], ['canastas', 'sillas'], [2, 1, .5, .6], { luz: true }),
  oficio('zapateria', 3, 'REMONTADORA', ['EL TACÓN', 'LA SUELA', 'ZAPATERO REMENDÓN'], '#6b4a30', '#edd9a8', '#edd9a8',
    'ropa', 'persianaOcre', ['toldoLona', 'zinc'], ['cajas', 'matera'], [2, 1, 1, .6]),
  oficio('cafeteria', 3, 'CAFETERÍA', ['TINTO Y PAN', 'EL PERICO', 'LA GRECA'], '#6f4630', '#f0dfb8', '#e5b95a',
    'pan', 'persianaOcre', ['toldoLona', 'awning'], ['sillas', 'almuerzo'], [.6, 2, 1, 4]),

  oficio('asadero', 4, 'ASADERO', ['POLLO DORADO', 'EL FOGÓN', 'LA GALLINA CRIOLLA'], '#c68a2a', '#6a1c14', '#6a1c14',
    'pollos', 'persianaRoja', ['awning', 'toldoLona'], ['sillas', 'canastas'], [1, 2, 2, 1]),
  oficio('miscelanea', 4, 'MISCELÁNEA', ['LA CHUCHERÍA', 'DOÑA FLOR', 'EL DETALLE'], '#4f7fa0', '#f3e7c0', '#f2d35a',
    'abarrotes', 'persianaAzul', ['awning2', 'toldoLona'], ['tijera', 'matera'], [1, 2, 2, 1]),
  oficio('chatarreria', 4, 'CHATARRERÍA', ['COMPRAMOS', 'EL COBRE', 'LA BÁSCULA'], '#5a4a3c', '#e8d49a', '#e8d49a',
    'chatarra', 'persianaGris', ['zinc', 'zinc'], ['chatarra', 'costales'], [5, .3, 0, 0]),
  oficio('licorera', 4, 'LICORERA', ['EL ALAMBIQUE', 'LA ÚLTIMA', 'EL BRINDIS'], '#3a3f6a', '#ecd98a', '#e9e2cf',
    'botellas', 'persianaAzul', ['awning2', 'zinc'], ['canastas', 'canastas'], [1, 2, 1, 1], { luz: true, reja: true }),
  oficio('chance', 4, 'CHANCE', ['LA SUERTE', 'EL PÁLPITO', 'EL NÚMERO DE HOY'], '#3f7a4a', '#f3ecc8', '#f0d04a',
    'oficina', 'persianaVerde', ['toldoVerde', 'toldoLona'], ['tijera', 'afiches'], [1, 2, 1, 2], { reja: true }),
  oficio('residencias', 4, 'RESIDENCIAS', ['EL DORADO', 'EL DESCANSO', 'LA POSADA'], '#7a3440', '#f0dfc0', '#e6c46a',
    'recepcion', 'persianaGris', ['toldoLona', 'awning'], ['matera', 'afiches'], [2, .6, .3, 1], { luz: true })
]);

/** Cada texto posible de un aviso grande: 54, para que quepan juntos en una sola textura. */
export const AVISOS_GRANDES = Object.freeze(OFICIOS.flatMap(oficio =>
  oficio.nombres.slice(0, NOMBRES_DE_AVISO).map(nombre => Object.freeze({ oficio, nombre }))));

const POR_CLASE = Array.from({ length: CLASES }, (_, clase) => OFICIOS.filter(o => o.clase === clase));
const ZONAS = ['popular', 'comercio', 'residencial', 'centro'];

/** El barrio pobre es el del cambuche y El Cartucho; el comercio y el lago ya tienen su perfil. */
export function zonaDelLocal(x, z) {
  const barrio = neighborhoodAt(x, z).id;
  if (barrio === 'cambuche' || (x < 70 && z < 128)) return 'popular';
  if (barrio === 'comercio') return 'comercio';
  if (barrio === 'lago') return 'residencial';
  return 'centro';
}

/**
 * Local de un solar. `seed` es la semilla de la casa y `paso` el tile donde empieza su frente, a lo largo de la calle:
 * el mismo solar da siempre el mismo local y dos solares seguidos caen en clases distintas.
 */
export function localDelSolar({ seed, paso, x = 0, z = 0 }) {
  const azar = rng(((seed >>> 0) ^ 0x10ca1e5) >>> 0);
  const zona = zonaDelLocal(x, z), columna = ZONAS.indexOf(zona);
  const candidatos = POR_CLASE[((Math.round(paso) % CLASES) + CLASES) % CLASES];
  let total = 0;
  for (const candidato of candidatos) total += candidato.peso[columna];
  let tirada = azar() * total, elegido = candidatos[candidatos.length - 1];
  for (const candidato of candidatos) {
    tirada -= candidato.peso[columna];
    if (tirada < 0) { elegido = candidato; break; }
  }
  const nombre = elegido.nombres[Math.floor(azar() * NOMBRES_DE_AVISO)];
  const persiana = azar();
  // En el barrio pobre hay más persianas abajo.
  const cerrada = zona === 'popular' ? .42 : .26;
  return { ...elegido, zona, nombre, rotulo: elegido.nombres[NOMBRES_DE_AVISO], estado: persiana < cerrada ? 'cerrada' : persiana < cerrada + .22 ? 'media' : 'abierta' };
}
