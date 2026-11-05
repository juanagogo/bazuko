// src/ui/momentosTextos.js
// Lo que dicen los momentos grandes y las cuentas que no necesitan pantalla: sin DOM, para probarlo en Node.
// La plana grita solo cuando el jugador hizo algo y lo pagó. Las demás muertes son calladas: se lo hicieron o le pasó.
import { cop } from '../utils/money.js';
import { hora as horaDeJuego } from './formato.js';

export const esMujer = (look) => (look?.real?.sexo ?? look?.sexo) === 'mujer';
export const nombreDe = (look) => look?.nombre?.trim() || (esMujer(look) ? 'Parcera' : 'Parcero');
const mayusculas = (texto) => texto.toLocaleUpperCase('es-CO');

/** Cómo se dice el nombre de una vía en la calle: «la Caracas», «la Calle 8». */
const dichaEnLaCalle = (nombre) => `la ${nombre.replace(/^Av\.\s*/, '')}`;

/**
 * La vía más cercana de verdad. `vias` es lo de `streetLabels`, en metros; `esCalzada(x, z)` dice si hay calzada en un
 * punto. Una vía que no pasa a la altura del jugador no cuenta, salvo que ninguna pase.
 */
export function calleCercana(x, z, vias, esCalzada = null) {
  let mejor = null, respaldo = null;
  for (const via of vias ?? []) {
    if (via.minX !== undefined && x < via.minX) continue;
    const distancia = via.vertical ? Math.abs(x - via.x) : Math.abs(z - via.z);
    if (!respaldo || distancia < respaldo.distancia) respaldo = { via, distancia };
    if (esCalzada && !(via.vertical ? esCalzada(via.x, z) : esCalzada(x, via.z))) continue;
    if (!mejor || distancia < mejor.distancia) mejor = { via, distancia };
  }
  const elegida = (mejor ?? respaldo)?.via;
  return elegida ? dichaEnLaCalle(elegida.name) : 'la calle';
}

// ---------- la plana ----------

/** El titular, partido para cada pantalla: dos líneas si hay ancho, tres si no. */
export function titularDeArresto(look, calle) {
  const quien = esMujer(look) ? 'LA' : 'LO';
  const donde = `EN ${mayusculas(calle)}!`;
  return { largo: [`¡${quien} COGIÓ LA TOMBA`, donde], corto: [`¡${quien} COGIÓ`, 'LA TOMBA', donde] };
}

export const pieDeFoto = (look) => `${esMujer(look) ? 'Esta' : 'Este'} es ${nombreDe(look)}.`;
export const sueltaDeArresto = (look) => `${esMujer(look) ? 'La' : 'Lo'} sueltan en otro lado. La próxima, despístelos.`;

const conCantidad = (it, nombres) => {
  const nombre = nombres?.[it.id]?.name ?? it.name ?? it.id;
  return it.qty > 1 ? `${nombre} ×${it.qty}` : nombre;
};

/** Lo que se lleva la tomba: la plata primero y todo el costal. `max`: cuántas cosas se escriben; lo demás se cuenta. */
export function perdidoEnArresto(dinero, items, nombres, max = 3) {
  const todo = [...(dinero > 0 ? [cop(dinero)] : []), ...(items ?? []).map((it) => conCantidad(it, nombres))];
  return { cosas: todo.slice(0, max), resto: Math.max(0, todo.length - max) };
}

/** Lo que se pierde al morir: la primera mitad de lo que hay en el costal, igual que `Game._respawn`. */
export function perdidoAlMorir(items, nombres, max = 3) {
  const mitad = (items ?? []).slice(0, Math.floor((items?.length ?? 0) / 2));
  return { cosas: mitad.slice(0, max).map((it) => conCantidad(it, nombres)), resto: Math.max(0, mitad.length - max) };
}

// ---------- las muertes ----------

/** El título, en marcador y sin exclamación. */
export function tituloDeMuerte(causa, stats) {
  if (causa === 'atropello') return 'Me atropellaron';
  if (causa === 'golpiza') return 'Te cascaron';
  if (causa === 'limpieza') return 'Te mató la limpieza social';
  if (stats?.isFreezing) return 'Me mató el frío';
  if (stats?.sed <= 0) return 'Me mató la sed';
  if (stats?.hambre <= 0) return 'Me mató el hambre';
  if (stats?.energia <= 0) return 'No di más';
  return 'Me quedé sin salud';
}

/** Un consejo corto, en usted. La limpieza social no lleva: el suyo llega al anochecer siguiente. */
export function consejoDeMuerte(causa, stats) {
  if (causa === 'limpieza') return null;
  if (causa === 'atropello') return 'Mire a los dos lados antes de cruzar: un carro no frena de una.';
  if (causa === 'golpiza') return 'Si un conductor se baja con la varilla, córrale y no pare.';
  if (stats?.isFreezing) return 'Con lluvia de noche, busque candela o techo.';
  if (stats?.sed <= 0) return 'Busque agua antes de que el cuerpo no dé más.';
  if (stats?.hambre <= 0) return 'Busque comida antes de que el cuerpo no dé más.';
  return 'Coma, beba agua y descanse antes de que el cuerpo no dé más.';
}

/** En el cartón: lo perdido ya va tachado arriba. */
export const CONSECUENCIAS = 'Vuelvo al cambuche con salud, hambre y sed en 60 o más.';
/** Con el recorte no se dice qué se perdió, y va en una línea. */
export const CONSECUENCIAS_RECORTE = 'Se vuelve al cambuche. Se pierde la mitad de lo que hay en el costal.';
export const CONSEJO_CAMIONETA = 'Si vuelve la camioneta, córrale y no pare';

/** Un muerto no escribe el cartón: la ciudad lo cuenta en una línea, sin grito. */
export const recorteDeLimpieza = (look, calle) =>
  `Hallan ${esMujer(look) ? 'muerta' : 'muerto'} a ${nombreDe(look)}, habitante de calle, en ${calle}. Nadie vio nada.`;

// ---------- dormir ----------

const horaDeReloj = horaDeJuego;

export const letreroDeDormir = (horaDeDespertar) => ({ arriba: 'CERRADO', abajo: `ABRIMOS A LAS ${horaDeReloj(horaDeDespertar)}` });

// ---------- la foto ----------

const dentro = (v, a, b) => Math.min(b, Math.max(a, v));

/**
 * Qué pedazo del cuadro va en la foto: el personaje de la cintura para arriba, sin importar la distancia de la cámara.
 * `cabeza` y `pies` van en píxeles del cuadro (`pies` puede faltar). Devuelve el recorte, y el centro y el radio del
 * redondel en píxeles de la caja.
 */
export function encuadrar({ ancho, alto, cabeza, pies = null, cajaAncho, cajaAlto }) {
  const aspecto = cajaAncho / cajaAlto;
  const c = cabeza ?? { x: ancho / 2, y: alto * .42 };
  const estatura = pies ? Math.max(alto * .08, Math.abs(pies.y - c.y)) : alto * .22;
  let sh = dentro(estatura / 1.3, alto * .18, alto);
  let sw = sh * aspecto;
  if (sw > ancho) { sw = ancho; sh = sw / aspecto; }
  if (sw < ancho * .22) { sw = ancho * .22; sh = sw / aspecto; }
  if (sh > alto) { sh = alto; sw = sh * aspecto; }
  const sx = dentro(c.x - sw / 2, 0, Math.max(0, ancho - sw));
  const sy = dentro(c.y - sh * .36, 0, Math.max(0, alto - sh));
  const k = cajaAlto / sh;
  const cx = (c.x - sx) * k, cy = (c.y - sy) * k;
  const radio = Math.max(30, dentro(estatura * k * .16, 30, cajaAlto * .34));
  return { sx, sy, sw, sh, cx, cy, radio };
}

/** Un redondel a mano, con su traslape y sin ser perfecto: puntos para un trazo. Siempre el mismo para el mismo tamaño. */
export function redondelAMano(cx, cy, rx, ry, semilla = 7) {
  let s = semilla;
  const azar = () => { s = (s * 16807) % 2147483647; return (s % 1000) / 1000 - .5; };
  const pasos = 34, puntos = [];
  for (let i = 0; i <= pasos; i++) {
    const a = (-112 + i * (404 / pasos)) * Math.PI / 180;
    const k = 1 + azar() * .028 + (i / pasos) * .07;
    puntos.push([cx + rx * k * Math.cos(a), cy + ry * k * Math.sin(a)]);
  }
  return puntos;
}

// ---------- las voces ----------

/** Lo que oye el personaje con la malilla o la paranoia: la calle le habla en usted. */
/**
 * El pie de foto va al lado del redondel, sin tocarlo. Primero donde se lee con la cabeza; si no cabe, en una esquina.
 * @returns {{x: number, y: number}}
 */
export function sitioDelPie({ anchoPie, altoPie, cx, cy, rx, ry, ancho, alto, margen = 10, aire = 26 }) {
  const arriba = Math.max(margen, Math.min(alto - altoPie - margen, cy - ry * .9 - altoPie / 2));
  const candidatos = cx > ancho / 2
    ? [[cx - rx - aire - anchoPie, arriba], [cx + rx + aire, arriba]]
    : [[cx + rx + aire, arriba], [cx - rx - aire - anchoPie, arriba]];
  const finX = ancho - anchoPie - margen, finY = alto - altoPie - margen;
  candidatos.push([margen, finY], [finX, finY], [margen, margen], [finX, margen]);
  const cabe = ([x, y]) => x >= margen && x <= finX && y >= margen && y <= finY;
  const libre = ([x, y]) => x + anchoPie + 4 <= cx - rx || x - 4 >= cx + rx || y + altoPie + 4 <= cy - ry || y - 4 >= cy + ry;
  const [x, y] = candidatos.find((c) => cabe(c) && libre(c)) ?? [margen, finY];
  return { x, y };
}

export const VOCES = [
  '¿Quién está ahí?', 'Lo están siguiendo', 'No mire atrás', 'Todos lo están mirando', 'Vienen por usted',
  'Están en las paredes', 'No confíe en nadie', 'Esos carros lo vigilan', 'Córrale',
];

const chocan = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Un sitio para una voz: nunca encima de `ocupado` (las cifras y lo que se oprime), y en plena persecución tampoco en
 * el centro. Devuelve null si no hay dónde: mejor callar que tapar.
 */
export function sitioParaVoz({ ancho, alto, vozAncho, vozAlto, ocupado = [], persecucion = false, azar = Math.random, intentos = 14 }) {
  const zonas = [...ocupado];
  if (persecucion) zonas.push({ x: ancho * .22, y: alto * .2, w: ancho * .56, h: alto * .7 });
  const libreX = ancho - vozAncho - 16, libreY = alto - vozAlto - 16;
  if (libreX < 16 || libreY < 16) return null;
  for (let i = 0; i < intentos; i++) {
    const voz = { x: 16 + azar() * (libreX - 16), y: 16 + azar() * (libreY - 16), w: vozAncho, h: vozAlto };
    if (!zonas.some((z) => chocan(voz, z))) return { x: Math.round(voz.x), y: Math.round(voz.y) };
  }
  return null;
}
