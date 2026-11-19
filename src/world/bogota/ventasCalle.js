// src/world/bogota/ventasCalle.js
// Ventas de la calle: la chaza de dulces y minutos, el carrito de tinto y el carro de fritanga, con su sombrilla.
// Cada puesto se arma con piezas de un color (cajas, tubos, lonas) que se funden en pocas mallas con color por vértice.
import * as THREE from 'three';

const BLANCO = [0.5, 0.875];
const UNO = new THREE.Vector3(1, 1, 1);
const vec = (p) => new THREE.Vector3(p[0], p[1], p[2]);
const giro = (r) => new THREE.Quaternion().setFromEuler(new THREE.Euler(r[0], r[1], r[2]));
const suave = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Azar propio de cada puesto: sale de su nombre, no del azar del juego. */
export function azarDe(texto) {
  let s = 2166136261;
  for (const letra of String(texto)) s = Math.imul(s ^ letra.codePointAt(0), 16777619);
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Qué puesto es según lo que vende y cómo se llama. */
export function varianteDeVenta(kind, { title = '', items = [] } = {}) {
  if (kind === 'fritanga') return 'fritanga';
  if (/tinto/i.test(title) || (items.includes('cafe') && !items.includes('cigarrillo'))) return 'tinto';
  return 'dulces';
}

const ETIQUETAS = { minutos: [0, 0], tinto: [1, 0], fritanga: [0, 1], fiado: [1, 1] };
const rectDe = (nombre) => {
  const [col, fila] = ETIQUETAS[nombre], u0 = col * .5 + .006, v1 = 1 - (128 + fila * 192) / 512 - .006;
  return [u0, v1 - 192 / 512 + .012, u0 + .5 - .012, v1];
};

const PINCEL = ['fillRect', 'measureText', 'save', 'translate', 'rotate', 'fillText', 'restore', 'beginPath', 'moveTo', 'quadraticCurveTo', 'stroke', 'createLinearGradient'];

/** Avisos pintados a mano en cartón y lata. Los nombres son inventados. */
function texturaDeAvisos() {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement?.('canvas'), c = canvas?.getContext?.('2d');
  // Sin un lienzo completo (pruebas de Node con un document a medias) los puestos salen sin avisos.
  if (!PINCEL.every((orden) => typeof c?.[orden] === 'function')) return null;
  canvas.width = canvas.height = 512;
  const azar = azarDe('avisos');
  c.fillStyle = '#ffffff';
  c.fillRect(0, 0, 512, 512);
  const aviso = (col, fila, fondo, tinta, grande, chico, tinta2) => {
    const x = col * 256, y = 128 + fila * 192;
    c.fillStyle = fondo;
    c.fillRect(x, y, 256, 192);
    for (let i = 0; i < 260; i++) {
      c.fillStyle = `rgba(${azar() < .5 ? '60,45,30' : '255,250,235'},${.03 + azar() * .06})`;
      c.fillRect(x + azar() * 256, y + azar() * 192, 2 + azar() * 26, 1 + azar() * 3);
    }
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    let px = 78;
    c.font = `900 ${px}px "Arial Narrow", Arial, sans-serif`;
    while (px > 30 && c.measureText(grande).width > 226) c.font = `900 ${--px}px "Arial Narrow", Arial, sans-serif`;
    const ancho = c.measureText(grande).width || 200;
    let cx = x + 128 - ancho / 2;
    c.textAlign = 'left';
    for (const letra of grande) {
      c.save();
      c.translate(cx, y + 78 + (azar() - .5) * 7);
      c.rotate((azar() - .5) * .07);
      c.fillStyle = tinta;
      c.fillText(letra, 0, 0);
      c.restore();
      cx += c.measureText(letra).width || ancho / grande.length;
    }
    c.textAlign = 'center';
    c.font = 'italic 700 27px Arial, sans-serif';
    c.fillStyle = tinta2;
    c.save();
    c.translate(x + 128, y + 146);
    c.rotate(-.025);
    c.fillText(chico, 0, 0);
    c.restore();
    c.strokeStyle = tinta2;
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(x + 34, y + 118);
    c.quadraticCurveTo(x + 128, y + 124 + azar() * 6, x + 222, y + 116);
    c.stroke();
    const mugre = c.createLinearGradient(0, y, 0, y + 192);
    mugre.addColorStop(0, 'rgba(70,55,40,.05)');
    mugre.addColorStop(1, 'rgba(60,45,30,.34)');
    c.fillStyle = mugre;
    c.fillRect(x, y, 256, 192);
  };
  aviso(0, 0, '#d9cfb4', '#8a221c', 'MINUTOS', 'a todo destino $200', '#22386a');
  aviso(1, 0, '#b89a6a', '#3a2416', 'TINTO', 'aromática · perico · pan', '#7a1f1a');
  aviso(0, 1, '#d6c79c', '#8a221c', 'EMPANADAS', 'morcilla · papa criolla', '#2d4a2a');
  aviso(1, 1, '#c9c2ae', '#22386a', 'HOY NO FÍO', 'mañana sí', '#8a221c');
  const textura = new THREE.CanvasTexture(canvas);
  textura.colorSpace = THREE.SRGBColorSpace;
  textura.anisotropy = 4;
  return textura;
}

const material = (clave, opciones) => {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .88, ...opciones });
  m.userData.staticMergeKey = `venta-calle:${clave}`;
  return m;
};
// Three sortea un identificador por cada material y textura. Los compartidos nacen al cargar el archivo: si gastaran el
// azar del juego, con una semilla fija (pruebas de navegador, mediciones) correrían todo lo que se sortea después.
const sinGastarAzar = (crear) => {
  const delJuego = Math.random;
  Math.random = azarDe('ventas de la calle');
  try { return crear(); } finally { Math.random = delJuego; }
};
// Compartidos por todos los puestos: la ciudad funde en un lote por material lo que no se mueve.
// Hay dos juegos iguales (ver crearChaza): antes dos chazas del mismo sector se fundían juntas solo si les tocaba el
// mismo paraguas, y de eso dependía cuánto azar gastaba la ciudad al fundir.
const [CUERPOS, LUCES, VIDRIO] = sinGastarAzar(() => {
  const map = texturaDeAvisos(), luz = { emissive: '#ffc27a', emissiveIntensity: .04, roughness: .5 };
  return [
    [material('cuerpo', { map }), material('cuerpo:b', { map })],
    [material('luz', luz), material('luz:b', luz)],
    new THREE.MeshStandardMaterial({ color: '#c9d4cc', transparent: true, opacity: .34, roughness: .3, depthWrite: false })
  ];
});
const CUERPO = CUERPOS[0];
const LUZ_DE_DIA = .04, LUZ_DE_NOCHE = 2.2;

/** Junta piezas de un color en mallas con color por vértice. Lo de abajo sale más sucio. */
class Piezas {
  constructor() {
    this.partes = [];
    this.marcos = [new THREE.Matrix4()];
    this.canal = 'cuerpo';
  }

  /** Lo que se arme dentro queda movido y girado como un bloque. */
  en(pos, rot, armar) {
    this.marcos.push(this.marcos.at(-1).clone().multiply(new THREE.Matrix4().compose(vec(pos), giro(rot), UNO)));
    armar();
    this.marcos.pop();
    return this;
  }

  /** En otro canal ('luz', 'vidrio') las piezas van a otra malla. */
  con(canal, armar) {
    const antes = this.canal;
    this.canal = canal;
    armar();
    this.canal = antes;
    return this;
  }

  _emite(puntos, normales, caras, color, local, uvs, reves = false) {
    const m = local ? this.marcos.at(-1).clone().multiply(local) : this.marcos.at(-1);
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    const parte = { canal: this.canal, P: [], N: [], C: [], U: [] };
    const p = puntos.map((q) => vec(q).applyMatrix4(m)), n = normales.map((q) => vec(q).applyMatrix3(nm).normalize());
    const tinte = (i) => (typeof color === 'function' ? color(i) : color);
    const lado = new THREE.Vector3(), otro = new THREE.Vector3();
    for (const [a, b, c] of caras) {
      lado.subVectors(p[b], p[a]).cross(otro.subVectors(p[c], p[a]));
      const orden = (lado.dot(otro.copy(n[a]).add(n[b]).add(n[c])) < 0) !== reves ? [a, c, b] : [a, b, c];
      for (const i of orden) {
        const k = tinte(i), sucio = this.canal === 'cuerpo' ? .56 + .44 * suave(0, .55, p[i].y) : 1;
        // Nada baja del piso: las patas abiertas se recortan al ras.
        parte.P.push(p[i].x, Math.max(0, p[i].y), p[i].z);
        parte.N.push(n[i].x, n[i].y, n[i].z);
        parte.C.push(k.r * sucio, k.g * sucio, k.b * sucio);
        parte.U.push(...(uvs ? uvs[i] : BLANCO));
      }
    }
    this.partes.push(parte);
    return this;
  }

  caja(ancho, alto, fondo, color, pos = [0, 0, 0], rot = [0, 0, 0]) {
    const x = ancho / 2, y = alto / 2, z = fondo / 2, puntos = [], normales = [], caras = [], tintes = [];
    const k = new THREE.Color(color);
    // Cada cara con su tono: arriba más clara y abajo más oscura, como queda lo que lleva años en la calle.
    const cara = (n, a, b, c, d, tono) => {
      const i = puntos.length, tinte = k.clone().multiplyScalar(tono);
      puntos.push(a, b, c, d);
      normales.push(n, n, n, n);
      tintes.push(tinte, tinte, tinte, tinte);
      caras.push([i, i + 1, i + 2], [i, i + 2, i + 3]);
    };
    cara([0, 1, 0], [-x, y, -z], [-x, y, z], [x, y, z], [x, y, -z], 1);
    cara([0, -1, 0], [-x, -y, -z], [x, -y, -z], [x, -y, z], [-x, -y, z], .6);
    cara([0, 0, 1], [-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z], .94);
    cara([0, 0, -1], [-x, -y, -z], [-x, y, -z], [x, y, -z], [x, -y, -z], .86);
    cara([1, 0, 0], [x, -y, -z], [x, y, -z], [x, y, z], [x, -y, z], .9);
    cara([-1, 0, 0], [-x, -y, -z], [-x, -y, z], [-x, y, z], [-x, y, -z], .9);
    return this._emite(puntos, normales, caras, (i) => tintes[i], new THREE.Matrix4().compose(vec(pos), giro(rot), UNO));
  }

  /** Tubo o tronco de cono de pie, centrado en `pos`. */
  tubo(arriba, abajo, alto, lados, color, pos = [0, 0, 0], rot = [0, 0, 0], tapas = true) {
    const puntos = [], normales = [], caras = [], k = new THREE.Color(color), techo = k.clone().multiplyScalar(1.04), h = alto / 2;
    const inclina = (abajo - arriba) / alto;
    for (let i = 0; i < lados; i++) {
      const a = i / lados * Math.PI * 2, s = Math.sin(a), c = Math.cos(a);
      puntos.push([arriba * s, h, arriba * c], [abajo * s, -h, abajo * c]);
      normales.push([s, inclina, c], [s, inclina, c]);
    }
    for (let i = 0; i < lados; i++) {
      const j = (i + 1) % lados;
      caras.push([i * 2, i * 2 + 1, j * 2 + 1], [i * 2, j * 2 + 1, j * 2]);
    }
    const lateral = puntos.length;
    if (tapas) {
      for (const [radio, y, ny] of [[arriba, h, 1], [abajo, -h, -1]]) {
        if (radio <= 0) continue;
        const centro = puntos.length;
        puntos.push([0, y, 0]);
        normales.push([0, ny, 0]);
        for (let i = 0; i < lados; i++) {
          const a = i / lados * Math.PI * 2;
          puntos.push([radio * Math.sin(a), y, radio * Math.cos(a)]);
          normales.push([0, ny, 0]);
        }
        for (let i = 0; i < lados; i++) caras.push([centro, centro + 1 + i, centro + 1 + (i + 1) % lados]);
      }
    }
    return this._emite(puntos, normales, caras, (i) => (i < lateral ? k : techo), new THREE.Matrix4().compose(vec(pos), giro(rot), UNO));
  }

  /** Bola de pocas caras; con `escala` sirve de empanada, papa, bulto o pan. */
  bola(radio, color, pos = [0, 0, 0], escala = [1, 1, 1], lados = 6, filas = 4, rot = [0, 0, 0]) {
    const puntos = [], normales = [], caras = [], k = new THREE.Color(color);
    for (let f = 0; f <= filas; f++) {
      const v = f / filas * Math.PI;
      for (let i = 0; i < lados; i++) {
        const a = i / lados * Math.PI * 2, n = [Math.sin(v) * Math.sin(a), Math.cos(v), Math.sin(v) * Math.cos(a)];
        puntos.push(n.map((q) => q * radio));
        normales.push(n);
      }
    }
    for (let f = 0; f < filas; f++) for (let i = 0; i < lados; i++) {
      const a = f * lados + i, b = f * lados + (i + 1) % lados, c = a + lados, d = b + lados;
      if (f > 0) caras.push([a, c, b]);
      if (f < filas - 1) caras.push([b, c, d]);
    }
    return this._emite(puntos, normales, caras, k, new THREE.Matrix4().compose(vec(pos), giro(rot), vec(escala)));
  }

  /** Listón, palo o cuerda de `a` a `b`. */
  tramo(a, b, grosor, color, fondo = grosor) {
    const va = vec(a), vb = vec(b), largo = va.distanceTo(vb);
    const e = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize()));
    return this.caja(grosor, largo, fondo, color, va.add(vb).multiplyScalar(.5).toArray(), [e.x, e.y, e.z]);
  }

  /** Tela por filas de puntos, con sombreado suave y las dos caras; `color(fila, columna)` pinta cada paño. */
  lona(filas, color, dentro = .62, mancha = null) {
    const alto = filas.length, ancho = filas[0].length, puntos = filas.flat(), suma = puntos.map(() => new THREE.Vector3());
    const p = puntos.map(vec), u = new THREE.Vector3(), w = new THREE.Vector3(), caras = [], tintes = [];
    for (let i = 0; i + 1 < alto; i++) for (let j = 0; j + 1 < ancho; j++) {
      const a = i * ancho + j, b = a + 1, c = a + ancho + 1, d = a + ancho;
      const k = new THREE.Color(typeof color === 'function' ? color(i, j) : color);
      for (const [x, y, z] of [[a, b, c], [a, c, d]]) {
        const n = u.subVectors(p[y], p[x]).cross(w.subVectors(p[z], p[x])).clone();
        if (n.y < 0) n.negate();
        for (const q of [x, y, z]) suma[q].add(n);
        caras.push([x, y, z]);
        tintes.push(k);
      }
    }
    // Cada triángulo lleva sus tres puntos propios para que el paño vecino pueda ser de otro color.
    const sueltos = caras.flat(), indices = caras.map((_, t) => [t * 3, t * 3 + 1, t * 3 + 2]);
    // El envés se alumbra como el haz, más apagado: la lona deja pasar la luz.
    for (const [reves, tono] of [[false, 1], [true, dentro]]) {
      this._emite(sueltos.map((q) => puntos[q]), sueltos.map((q) => suma[q].clone().normalize().toArray()), indices,
        (i) => tintes[Math.floor(i / 3)].clone().multiplyScalar(tono * (mancha ? mancha(Math.floor(sueltos[i] / ancho), sueltos[i] % ancho) : 1)), null, null, reves);
    }
    return this;
  }

  /** Aviso pintado: tabla con la etiqueta por delante. */
  aviso(etiqueta, ancho, alto, pos, rot = [0, 0, 0], tabla = '#8a7355') {
    const [u0, v0, u1, v1] = rectDe(etiqueta), x = ancho / 2, y = alto / 2, claro = new THREE.Color('#cfc6ad');
    return this.en(pos, rot, () => {
      this.caja(ancho + .02, alto + .02, .012, tabla, [0, 0, -.008]);
      this._emite([[-x, -y, 0], [x, -y, 0], [x, y, 0], [-x, y, 0]], [[0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1]], [[0, 1, 2], [0, 2, 3]],
        CUERPO.map ? new THREE.Color(1, 1, 1) : claro, null, [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
    });
  }

  /** Reparte las piezas de un canal en `cuantas` mallas seguidas. */
  mallas(canal, cuantas, material, alCrear = null) {
    const partes = this.partes.filter((parte) => parte.canal === canal), mallas = [];
    const n = Math.min(cuantas, partes.length);
    for (let k = 0; k < n; k++) {
      const trozo = partes.slice(Math.floor(k * partes.length / n), Math.floor((k + 1) * partes.length / n));
      const geometry = new THREE.BufferGeometry();
      for (const [nombre, clave, paso] of [['position', 'P', 3], ['normal', 'N', 3], ['color', 'C', 3], ['uv', 'U', 2]]) {
        geometry.setAttribute(nombre, new THREE.Float32BufferAttribute(trozo.flatMap((parte) => parte[clave]), paso));
      }
      mallas.push(new THREE.Mesh(geometry, material));
      alCrear?.(k + 1);
    }
    return mallas;
  }
}

const LATA = '#878b82', LATA_OSCURA = '#6c7069', OXIDO = '#74492e', HIERRO = '#34322f', CAUCHO = '#26241f';
const MADERA = '#7b6248', MADERA_VIEJA = '#64503c', MADERA_CLARA = '#8f775a', CARTON = '#9c8460', ICOPOR = '#cfcabb';
const PINTURAS = ['#5d7c84', '#78895f', '#93574a', '#b3a47c', '#56678a', '#8a7f6a'];
const DULCES = ['#b5564b', '#c5a141', '#5d9566', '#4f7ca3', '#d5cfc1', '#c0783b', '#85608f', '#cf8b9c'];
const TERMOS = ['#9c382f', '#2f5c88', '#d2cab8', '#3f7553', '#8c8c88'];
// Las sombrillas de la calle se reconocen por el color: gajos rojo y amarillo, azul y blanco, verde y blanco, arcoíris.
// Ninguna lona sale con el color de la tienda: son tintes de tela que ya pasó varios veranos a la intemperie.
const LONAS = [
  ['#a8473a', '#c9a644'], ['#406382', '#d9d3c4'], ['#2f7a3c', '#d9d3c4'], ['#a8473a', '#d9d3c4'], ['#a66a42', '#406382'],
  ['#a8473a', '#c9a644', '#2f7a3c', '#406382']
];
const quemada = (color, cuanto) => new THREE.Color(color).lerp(new THREE.Color('#b3a996'), cuanto);
const elige = (lista, azar) => lista[Math.floor(azar() * lista.length)];
/** Los colores de la sombrilla de un puesto salen de su nombre, aparte de lo que tenga en el surtido. */
export const lonaDe = (title) => elige(LONAS, azarDe(`la sombrilla de ${title}`));

const RADIO = 1.2, ALERO = 2.085, COPA = 2.4, PUNTA = 2.475, FALDON = .06;

/**
 * Paño de tela entre filas que pueden tener distinto número de puntos (una punta, tres, cinco): sombreado suave y las
 * dos caras. `color(franja, a lo ancho)` pinta cada triángulo y `mancha(fila, a lo ancho)` ensucia cada punto.
 */
function pano(k, filas, color, dentro, mancha = null) {
  const puntos = filas.flat(), p = puntos.map(vec), suma = puntos.map(() => new THREE.Vector3());
  const ancho = [], fila = [], inicio = [], caras = [], tintes = [], u = new THREE.Vector3(), w = new THREE.Vector3();
  filas.forEach((puntosDeFila, f) => {
    inicio.push(ancho.length);
    puntosDeFila.forEach((_, j) => { ancho.push(puntosDeFila.length > 1 ? j / (puntosDeFila.length - 1) : .5); fila.push(f); });
  });
  for (let f = 0; f + 1 < filas.length; f++) {
    const n = filas[f].length, m = filas[f + 1].length;
    for (let i = 0, j = 0; i < n - 1 || j < m - 1;) {
      // La costura avanza por la fila que va más atrás, para que los triángulos no se estiren.
      const arriba = i < n - 1 && (j >= m - 1 || (i + 1) / (n - 1) <= (j + 1) / (m - 1));
      const cara = arriba ? [inicio[f] + i, inicio[f] + i + 1, inicio[f + 1] + j] : [inicio[f] + i, inicio[f + 1] + j + 1, inicio[f + 1] + j];
      if (arriba) i++; else j++;
      const normal = u.subVectors(p[cara[1]], p[cara[0]]).cross(w.subVectors(p[cara[2]], p[cara[0]])).clone();
      if (normal.y < 0) normal.negate();
      for (const q of cara) suma[q].add(normal);
      caras.push(cara);
      tintes.push(new THREE.Color(typeof color === 'function' ? color(f, (ancho[cara[0]] + ancho[cara[1]] + ancho[cara[2]]) / 3) : color));
    }
  }
  const sueltos = caras.flat(), indices = caras.map((_, t) => [t * 3, t * 3 + 1, t * 3 + 2]);
  for (const [reves, tono] of [[false, 1], [true, dentro]]) {
    k._emite(sueltos.map((q) => puntos[q]), sueltos.map((q) => suma[q].clone().normalize().toArray()), indices,
      (i) => tintes[Math.floor(i / 3)].clone().multiplyScalar(tono * (mancha ? mancha(fila[sueltos[i]], ancho[sueltos[i]]) : 1)), null, null, reves);
  }
  return k;
}

/**
 * Sombrilla de vendedor: lona quemada por el sol que cuelga en curva entre varillas, un remiendo, faldón raído,
 * balde de cemento al pie y la cuerda que la amarra al puesto. Ocupa lo mismo que el parasol de antes.
 */
function sombrilla(k, colores, azar, amarre = null) {
  const gajos = 8, remiendo = Math.floor(azar() * gajos), parche = quemada(elige(['#6f7f8a', '#8a6f5a', '#5f7a62'], azar), .35).multiplyScalar(.8);
  // Asoleada, no borrada: cada gajo pierde entre un 16 y un 28 % de su color.
  const tonos = Array.from({ length: gajos }, (_, i) => quemada(colores[i % colores.length], .16 + azar() * .12));
  // La mugre se junta en el alero y en el remiendo: arriba la lona queda limpia y hacia el borde se oscurece.
  const enVarilla = Array.from({ length: gajos }, () => [0, 1, 2, 3].map((f) => 1 - f * f * (.026 + azar() * .012)));
  const enMedio = Array.from({ length: gajos }, () => [0, 1, 2, 3].map((f) => 1 - f * f * (.03 + azar() * .016)));
  const varilla = (i, t) => {
    const a = i / gajos * Math.PI * 2, r = RADIO * t;
    return [r * Math.sin(a), COPA - (COPA - ALERO) * Math.pow(t, 1.7), r * Math.cos(a)];
  };
  // La tela cuelga entre varilla y varilla: hacia el medio del gajo queda más baja y metida, en curva y no en pico.
  const entre = (i, t, ancho, cae = 0) => {
    const a = varilla(i, t), b = varilla(i + 1, t), panza = Math.sin(Math.PI * ancho), mete = 1 - .035 * t * panza;
    return [(a[0] + (b[0] - a[0]) * ancho) * mete, a[1] + (b[1] - a[1]) * ancho - .075 * t * t * panza - cae, (a[2] + (b[2] - a[2]) * ancho) * mete];
  };
  const CUARTOS = [0, .25, .5, .75, 1];
  for (let i = 0; i < gajos; i++) {
    const filas = [[varilla(i, 0)], [0, .5, 1].map((ancho) => entre(i, 1 / 3, ancho)), CUARTOS.map((ancho) => entre(i, 2 / 3, ancho)), CUARTOS.map((ancho) => entre(i, 1, ancho))];
    const mugre = (f, ancho) => {
      const borde = enVarilla[(i + (ancho > .5 ? 1 : 0)) % gajos][f];
      return borde + (enMedio[i][f] - borde) * Math.sin(Math.PI * ancho);
    };
    // El remiendo es un retazo cosido hacia el alero, no el gajo entero, y ya tomó parte del color de la lona.
    const retazo = i === remiendo ? parche.clone().lerp(tonos[i], .45) : null;
    pano(k, filas, (f, ancho) => (retazo && f === 2 && ancho > .26 && ancho < .74 ? retazo : tonos[i]), .62, mugre);
    // El faldón se deshilacha: cuelga parejo en las varillas y más corto o más largo en cada cuarto.
    const cae = FALDON * (.7 + azar() * .3), raido = [1, .55 + cae * 5, cae / FALDON, 1.35 - cae * 6, 1];
    pano(k, [filas[3], CUARTOS.map((ancho, j) => entre(i, 1, ancho, FALDON * raido[j]))], tonos[(i + 1) % gajos].clone().multiplyScalar(.68), .7,
      (f, ancho) => (f ? .86 : 1) * (1 - .1 * Math.sin(Math.PI * ancho)));
    const desde = vec(varilla(i, .06)), hasta = vec(varilla(i, .98).map((v, eje) => (eje === 1 ? v - .012 : v)));
    const e = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), hasta.clone().sub(desde).normalize()));
    k.tubo(.008, .008, desde.distanceTo(hasta), 3, HIERRO, desde.add(hasta).multiplyScalar(.5).toArray(), [e.x, e.y, e.z], false);
  }
  k.tubo(.022, .022, COPA - .02, 6, '#8c8c86', [0, (COPA - .02) / 2 + .01, 0], [0, 0, 0], false);
  k.tubo(0, .03, PUNTA - COPA + .02, 6, HIERRO, [0, (PUNTA + COPA - .02) / 2, 0]);
  k.tubo(.05, .05, .05, 6, HIERRO, [0, 1.92, 0]);
  // Balde de cemento que la sostiene.
  k.tubo(.15, .12, .26, 8, '#6f6a5f', [0, .13, 0]);
  k.tubo(.135, .135, .02, 8, '#8f8b80', [0, .262, 0]);
  if (amarre) {
    k.tramo([0, 1.05, 0], amarre, .012, '#b9a06a');
    k.tramo([0, .62, 0], [amarre[0] * .9, amarre[1] - .25, amarre[2] * .9], .012, '#b9a06a');
    k.tubo(.03, .03, .05, 6, '#b9a06a', [0, 1.05, 0]);
  }
  return k;
}

/** Banquito plástico de pata abierta. */
function banquito(k, pos, color, rot = 0) {
  return k.en(pos, [0, rot, 0], () => {
    k.caja(.3, .035, .3, color, [0, .43, 0]);
    k.caja(.22, .05, .22, new THREE.Color(color).multiplyScalar(.85), [0, .39, 0]);
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) k.tramo([x * .16, 0, z * .16], [x * .11, .4, z * .11], .035, new THREE.Color(color).multiplyScalar(.9));
  });
}

/** Butaco de madera del vendedor. */
function butaco(k, pos, rot = 0) {
  return k.en(pos, [0, rot, 0], () => {
    k.caja(.32, .035, .26, MADERA, [0, .46, 0]);
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) k.tramo([x * .15, 0, z * .12], [x * .12, .45, z * .09], .04, MADERA_VIEJA);
    k.caja(.26, .03, .03, MADERA_VIEJA, [0, .2, .1]);
    k.caja(.3, .02, .24, '#7a4f4a', [0, .485, 0]);
  });
}

function termo(k, pos, color, alto = .32) {
  k.tubo(.07, .075, alto, 8, color, [pos[0], pos[1] + alto / 2, pos[2]]);
  k.tubo(.05, .07, .05, 8, '#2b2a28', [pos[0], pos[1] + alto + .025, pos[2]]);
  k.caja(.03, .03, .09, '#2b2a28', [pos[0], pos[1] + alto + .03, pos[2] + .06]);
  return k.caja(.02, alto * .5, .025, '#2b2a28', [pos[0] - .085, pos[1] + alto * .55, pos[2]]);
}

function canastoDePan(k, pos, azar) {
  k.tubo(.17, .13, .12, 8, '#9a7a4a', [pos[0], pos[1] + .06, pos[2]]);
  for (let i = 0; i < 5; i++) {
    const a = i / 5 * Math.PI * 2;
    k.bola(.055, i % 2 ? '#b98a4a' : '#c79a58', [pos[0] + Math.sin(a) * .08, pos[1] + .13, pos[2] + Math.cos(a) * .08], [1, .7, 1.25], 5, 3, [0, a, 0]);
  }
  // Trapo que tapa medio canasto.
  const filas = [];
  for (let i = 0; i <= 2; i++) filas.push([-1, 0, 1].map((j) => [pos[0] - .19 + i * .11, pos[1] + .17 - Math.abs(j) * .07 - (i === 0 ? .08 : 0), pos[2] + j * .17]));
  return k.lona(filas, azar() < .5 ? '#c9c2ae' : '#a9b3a0', .8);
}

function nevera(k, pos, azar) {
  k.caja(.44, .3, .32, ICOPOR, [pos[0], pos[1] + .15, pos[2]]);
  k.caja(.46, .05, .34, '#bdb8a8', [pos[0], pos[1] + .325, pos[2]], [0, 0, .04]);
  k.caja(.2, .012, .34, '#5c7f96', [pos[0], pos[1] + .2, pos[2]]);
  for (let i = 0; i < 4; i++) {
    const x = pos[0] - .14 + i * .095, color = elige(['#b9c6c2', '#a9683a', '#b7a94a', '#9a4a3c'], azar);
    k.tubo(.028, .032, .17, 6, color, [x, pos[1] + .435, pos[2] + (i % 2 ? .05 : -.04)]);
    k.tubo(.012, .02, .05, 6, '#d8d4c8', [x, pos[1] + .545, pos[2] + (i % 2 ? .05 : -.04)]);
  }
  return k;
}

/** Tira de bolsas de paquetes colgada de un palo. */
function tiraDeBolsas(k, arriba, cuantas, azar) {
  k.tramo(arriba, [arriba[0], arriba[1] - cuantas * .13 - .03, arriba[2]], .008, '#d8d2c2');
  for (let i = 0; i < cuantas; i++) {
    k.caja(.11, .12, .035, elige(['#b9973a', '#a8463a', '#5d8a56', '#b06a35', '#c9c1a8'], azar),
      [arriba[0], arriba[1] - .1 - i * .13, arriba[2] + .012], [(azar() - .5) * .25, (azar() - .5) * .5, (azar() - .5) * .2]);
  }
  return k;
}

function rueda(k, pos, radio, eje = 'x') {
  const rot = eje === 'x' ? [0, 0, Math.PI / 2] : [Math.PI / 2, 0, 0];
  k.tubo(radio, radio, .05, 8, CAUCHO, pos, rot);
  return k.tubo(radio * .45, radio * .45, .06, 6, '#7d7d76', pos, rot);
}

/** Cajón de dulces sobre ruedas, con vitrina inclinada, aviso de minutos y celulares amarrados. */
function carroDeDulces(carro, surtido, azar, items) {
  const pintura = elige(PINTURAS, azar), cx = -.12, cz = -.14;
  carro.en([cx, 0, cz], [0, 0, 0], () => {
    carro.caja(.8, .5, .48, pintura, [0, .65, 0]);
    carro.caja(.84, .03, .52, MADERA_VIEJA, [0, .915, 0]);
    carro.caja(.82, .04, .5, MADERA_VIEJA, [0, .39, 0]);
    for (const x of [-.27, 0, .27]) carro.caja(.24, .4, .012, new THREE.Color(pintura).multiplyScalar(.86 + azar() * .2), [x, .65, .243]);
    carro.caja(.8, .06, .012, OXIDO, [0, .43, .244]);
    carro.caja(.2, .12, .014, MADERA_CLARA, [.2, .7, -.245]);
    rueda(carro, [-.43, .2, 0], .2);
    rueda(carro, [.43, .2, 0], .2);
    carro.tramo([-.43, .2, 0], [.43, .2, 0], .025, HIERRO);
    carro.tramo([-.3, 0, .2], [-.3, .4, .2], .04, MADERA_VIEJA);
    carro.tramo([.3, 0, .2], [.3, .4, .2], .04, MADERA_VIEJA);
    carro.tramo([-.4, .8, -.24], [-.5, .98, -.4], .03, MADERA_VIEJA);
    carro.tramo([.4, .8, -.24], [.5, .98, -.4], .03, MADERA_VIEJA);
    carro.tramo([-.52, .98, -.4], [.52, .98, -.4], .03, MADERA);
    carro.aviso('fiado', .3, .2, [-.2, .66, .252], [0, 0, .04], CARTON);
  });
  butaco(carro, [-.6, 0, -.66], .4);
  surtido.en([cx, .93, cz], [0, 0, 0], () => {
    // Vitrina inclinada hacia quien compra.
    surtido.caja(.46, .02, .4, '#4a3f33', [-.16, .09, .02], [.32, 0, 0]);
    surtido.caja(.46, .16, .02, MADERA, [-.16, .08, -.19]);
    for (const x of [-.395, .075]) surtido.caja(.015, .1, .4, MADERA, [x, .08, .02], [.32, 0, 0]);
    for (let fila = 0; fila < 4; fila++) for (let col = 0; col < 6; col++) {
      const z = .16 - fila * .1, y = .045 + fila * .033;
      if (fila === 3) surtido.caja(.058, .09, .022, col % 2 ? '#d6d0c2' : '#b9b3a4', [-.345 + col * .074, y + .05, z], [.32, 0, 0]);
      else surtido.caja(.062, .03, .075, elige(DULCES, azar), [-.345 + col * .074, y + .02, z], [.32, 0, (azar() - .5) * .2]);
    }
    for (const [x, color] of [[.15, '#b9a05a'], [.26, '#a86a5a']]) {
      surtido.tubo(.045, .05, .13, 8, '#aab3ad', [x, .065, .15]);
      surtido.tubo(.05, .05, .025, 8, color, [x, .142, .15]);
      for (let i = 0; i < 3; i++) surtido.bola(.02, elige(DULCES, azar), [x + (i - 1) * .022, .05 + i * .03, .195], [1, 1, .5], 4, 2);
    }
    surtido.tubo(.03, .026, .16, 6, '#e3dfd3', [.36, .08, .15]);
    surtido.caja(.16, .035, .1, '#d8d2c4', [.24, .018, 0]);
    for (let i = 0; i < 5; i++) surtido.tubo(.006, .006, .09, 4, i % 2 ? '#e6e1d5' : '#c79a58', [.18 + i * .03, .045, 0], [Math.PI / 2, 0, 0]);
    // Aviso de minutos en su palo, con los celulares amarrados con cadena.
    surtido.tramo([-.4, 0, -.22], [-.4, .64, -.22], .025, MADERA_VIEJA);
    surtido.aviso('minutos', .36, .26, [-.26, .5, -.2], [0, 0, -.05], '#b9b3a2');
    for (const [x, largo] of [[-.38, .16], [-.2, .22]]) {
      surtido.tramo([x, .37, -.19], [x + .02, .37 - largo, -.15], .008, '#8c8c86');
      surtido.caja(.05, .1, .014, '#24262b', [x + .02, .32 - largo, -.15], [0, 0, (azar() - .5) * .5]);
      surtido.caja(.036, .05, .004, '#59646b', [x + .02, .335 - largo, -.142]);
    }
    // Paquetes colgados del palo de la derecha.
    surtido.tramo([.42, 0, -.22], [.42, .77, -.22], .022, MADERA_VIEJA);
    surtido.tramo([.42, .76, -.24], [.42, .76, .02], .018, MADERA_VIEJA);
    tiraDeBolsas(surtido, [.42, .75, -.19], 4, azar);
    tiraDeBolsas(surtido, [.42, .75, -.04], 3, azar);
    if (items.includes('cafe')) {
      termo(surtido, [.14, 0, -.15], elige(TERMOS, azar));
      termo(surtido, [.27, 0, -.13], elige(TERMOS, azar), .28);
    }
  });
  if (items.includes('pan') || items.includes('empanada')) {
    // Guacal al lado con el canasto de lo de comer.
    surtido.caja(.34, .3, .3, MADERA_VIEJA, [-.68, .15, .3]);
    for (const y of [.08, .22]) surtido.caja(.35, .05, .31, MADERA_CLARA, [-.68, y, .3]);
    canastoDePan(surtido, [-.68, .3, .3], azar);
  }
  if (items.includes('refresco') || items.includes('agua')) nevera(surtido, [.88, 0, -.4], azar);
}

/** Carrito de tinto: coche adaptado con termos, vasos, pan y aromática. */
function carroDeTinto(carro, surtido, azar, items) {
  const pintura = elige(PINTURAS, azar), cx = -.18, cz = -.12, tubo = '#77786f';
  carro.en([cx, 0, cz], [0, 0, 0], () => {
    for (const [x, z] of [[-.3, -.19], [.3, -.19], [-.3, .19], [.3, .19]]) {
      rueda(carro, [x, .09, z], .09, 'z');
      carro.tramo([x, .09, z * .9], [x * .9, .5, z * .8], .022, tubo);
    }
    carro.tramo([-.3, .09, -.19], [.3, .09, -.19], .018, tubo);
    carro.tramo([-.3, .09, .19], [.3, .09, .19], .018, tubo);
    carro.caja(.66, .03, .4, MADERA_VIEJA, [0, .3, 0]);
    carro.caja(.7, .24, .44, pintura, [0, .62, 0]);
    carro.caja(.74, .03, .48, MADERA, [0, .755, 0]);
    carro.caja(.7, .1, .012, new THREE.Color(pintura).multiplyScalar(.8), [0, .56, .226]);
    // Manubrio del coche, del lado de quien vende.
    carro.tramo([-.3, .6, -.2], [-.34, 1.02, -.44], .022, tubo);
    carro.tramo([.3, .6, -.2], [.34, 1.02, -.44], .022, tubo);
    carro.tramo([-.36, 1.02, -.44], [.36, 1.02, -.44], .03, CAUCHO);
    carro.aviso('tinto', .4, .27, [0, .46, .24], [-.12, 0, .03], CARTON);
    carro.tramo([-.12, .6, .23], [-.12, .5, .245], .006, '#b9a06a');
    carro.tramo([.12, .6, .23], [.12, .5, .245], .006, '#b9a06a');
    // Bolsa de basura colgada del manubrio.
    carro.bola(.1, '#2f2e2b', [.42, .8, -.4], [.8, 1.3, .8], 6, 4);
  });
  butaco(carro, [-.66, 0, -.6], .5);
  surtido.en([cx, .77, cz], [0, 0, 0], () => {
    const colores = [...TERMOS];
    for (let i = colores.length - 1; i > 0; i--) { const j = Math.floor(azar() * (i + 1)); [colores[i], colores[j]] = [colores[j], colores[i]]; }
    for (let i = 0; i < 5; i++) termo(surtido, [-.28 + i * .14, 0, -.1 + (i % 2) * .03], colores[i], .3 + (i % 3) * .03);
    for (const x of [-.26, -.17]) surtido.tubo(.032, .026, .2 + azar() * .06, 6, '#e3dfd3', [x, .11, .13]);
    surtido.caja(.2, .012, .16, '#8d8f88', [.2, .006, .12]);
    for (let i = 0; i < 4; i++) surtido.tubo(.03, .024, .06, 6, '#e3dfd3', [.14 + (i % 2) * .09, .042, .08 + Math.floor(i / 2) * .08]);
    surtido.tubo(.045, .045, .1, 8, '#a9b0aa', [-.03, .05, .14]);
    for (let i = 0; i < 4; i++) surtido.caja(.012, .12, .03, i % 2 ? '#56794a' : '#6f8f55', [-.045 + i * .012, .15, .14], [(azar() - .5) * .5, azar() * 3, (azar() - .5) * .5]);
    surtido.tubo(.035, .04, .08, 6, '#c9c4b6', [.06, .04, .16]);
    surtido.tubo(.03, .03, .012, 6, '#9c382f', [.06, .086, .16]);
  });
  surtido.en([cx, .315, cz], [0, 0, 0], () => {
    if (items.includes('pan')) canastoDePan(surtido, [-.12, 0, 0], azar);
    surtido.tubo(.1, .1, .22, 8, '#5f86a0', [.18, .11, 0]);
    surtido.tubo(.04, .06, .05, 8, '#d8d4c8', [.18, .245, 0]);
  });
  if (items.includes('cigarrillo')) {
    surtido.caja(.2, .03, .14, MADERA_CLARA, [cx + .25, .785, cz - .12]);
    for (let i = 0; i < 4; i++) surtido.caja(.04, .065, .018, i % 2 ? '#d6d0c2' : '#b9b3a4', [cx + .19 + i * .045, .83, cz - .12], [-.3, 0, 0]);
  }
  tiraDeBolsas(surtido, [cx + .36, 1.38, cz - .43], 3, azar);
  surtido.tramo([cx + .36, 1.0, cz - .44], [cx + .36, 1.4, cz - .44], .018, tubo);
}

/** Lo que tiene de más cada puesto de chaza: carro, surtido y sombrilla, cada cosa en su kit. */
const VARIANTES = { dulces: carroDeDulces, tinto: carroDeTinto };
// La ciudad vuelve a sortear por cada malla y por cada lote cuando funde lo estático, y las pruebas con semilla dependen
// de cuánto azar se gasta: estas 38 piezas en dos lotes piden lo mismo que las 26 mallas en doce lotes de antes.
const MALLAS_DE_CHAZA = { sombrilla: 9, luz: 1, carro: 12, surtido: 16 };
const MALLAS_DEL_SURTIDO_ANTES_DEL_SORTEO = 12;

/** Sombrilla suelta, con los colores que se le pidan (ya quemados por el sol). */
export function crearSombrilla(colores, nombre = colores.join()) {
  const g = new THREE.Group();
  g.add(...sombrilla(new Piezas(), colores, azarDe(nombre)).mallas('cuerpo', MALLAS_DE_CHAZA.sombrilla, CUERPO));
  return g;
}

/** Chaza de la calle. La variante sale de lo que vende; los colores y el surtido, de su nombre. */
export function crearChaza({ withUmbrella = true, title = 'Chaza', items = ['cigarrillo', 'agua'] } = {}) {
  const variante = varianteDeVenta('chaza', { title, items }), azar = azarDe(title);
  const g = new THREE.Group(), carro = new Piezas(), surtido = new Piezas();
  g.name = title;
  g.userData.variante = variante;
  VARIANTES[variante](carro, surtido, azar, items);
  const grupo = (nombre, mallas) => {
    const parte = new THREE.Group();
    parte.name = nombre;
    if (mallas.length) parte.add(...mallas);
    g.add(parte);
    return parte;
  };
  grupo('Carro', carro.mallas('cuerpo', MALLAS_DE_CHAZA.carro, CUERPO));
  // El paraguas de antes se sorteaba entre dos, justo después de la mesa y los dulces (208 números). Ese sorteo sigue
  // en su sitio y decide con cuál de los dos juegos de materiales se funde el puesto; lo que se ve no cambia.
  const parteSurtido = grupo('Surtido', []), parteSombrilla = withUmbrella ? grupo('Sombrilla', []) : null;
  let juego = 0;
  parteSurtido.add(...surtido.mallas('cuerpo', MALLAS_DE_CHAZA.surtido, CUERPO, (hechas) => {
    if (withUmbrella && hechas === MALLAS_DEL_SURTIDO_ANTES_DEL_SORTEO) juego = Math.random() < .5 ? 0 : 1;
  }));
  if (withUmbrella) {
    const k = new Piezas();
    sombrilla(k, lonaDe(title), azar, variante === 'tinto' ? [-.11, .77, -.08] : [-.02, .9, -.1]);
    // Linterna colgada de una varilla: de día está apagada.
    k.tramo([.28, 2.2, .1], [.28, 1.98, .1], .008, HIERRO);
    k.tubo(.03, .035, .05, 6, '#3a3a36', [.28, 1.96, .1]);
    k.con('luz', () => k.bola(.045, '#e9dcc0', [.28, 1.9, .1], [1, 1.15, 1], 6, 4));
    parteSombrilla.add(...k.mallas('cuerpo', MALLAS_DE_CHAZA.sombrilla, CUERPO), ...k.mallas('luz', MALLAS_DE_CHAZA.luz, LUCES[0]));
    parteSombrilla.position.set(.3, 0, .2);
    g.traverse((o) => { if (o.isMesh) o.material = (o.material === LUCES[0] ? LUCES : CUERPOS)[juego]; });
    g.userData.setNight = (isNight) => { LUCES[juego].emissiveIntensity = isNight ? LUZ_DE_NOCHE : LUZ_DE_DIA; };
  }
  g.userData.dispose = () => soltarVenta(g);
  return g;
}

// El carro de antes eran 18 mallas sueltas con sus materiales, y Three sortea un identificador por cada malla, geometría
// y material: 220 números en total. Las pruebas con semilla arman la ciudad con el azar sembrado y dependen de esa cuenta.
const SORTEOS_DEL_CARRO_DE_FRITANGA_DE_ANTES = 220;

/** Arma algo contando lo que le pide al azar del juego y, al terminar, pide lo que falte para llegar a lo `deAntes`. */
function conElAzarDeAntes(deAntes, armar) {
  const delJuego = Math.random;
  let pedidos = 0;
  Math.random = () => { pedidos++; return delJuego(); };
  try { return armar(); } finally {
    Math.random = delJuego;
    for (; pedidos < deAntes; pedidos++) delJuego();
  }
}

/**
 * Carro de fritanga: lata, vitrina de vidrio empañado, paila, fogón de carbón, pipeta, ají, banquitos y bombillo.
 * Las brasas y el bombillo siguen a `light`, la luz del puesto, que ya sube de noche y baja de día.
 */
export function crearFritanga(opciones = {}) {
  return conElAzarDeAntes(SORTEOS_DEL_CARRO_DE_FRITANGA_DE_ANTES, () => armarFritanga(opciones));
}

function armarFritanga({ title = 'Fritanga', items = ['empanada', 'morcilla', 'papaCriolla'], light = null } = {}) {
  const azar = azarDe(title), k = new Piezas(), g = new THREE.Group();
  g.name = title;
  g.userData.variante = 'fritanga';
  const lata = () => new THREE.Color(azar() < .5 ? LATA : LATA_OSCURA).multiplyScalar(.92 + azar() * .16);
  // Carro de lata remachada, con abolladuras y óxido abajo.
  k.caja(1.2, .04, .7, HIERRO, [-.1, .44, 0]);
  for (let i = 0; i < 4; i++) k.caja(.3, .4, .014, lata(), [-.55 + i * .3, .66, .35], [(azar() - .5) * .04, 0, 0]);
  k.caja(1.2, .4, .014, lata(), [-.1, .66, -.35]);
  k.caja(1.16, .05, .016, OXIDO, [-.1, .49, .352]);
  for (const x of [-.7, .5]) k.caja(.014, .4, .7, lata(), [x, .66, 0]);
  k.caja(1.26, .03, .76, '#9a9d93', [-.1, .875, 0]);
  rueda(k, [-.1, .24, .4], .24, 'z');
  rueda(k, [-.1, .24, -.4], .24, 'z');
  k.tramo([-.1, .24, -.4], [-.1, .24, .4], .03, HIERRO);
  for (const x of [-.62, .42]) k.tramo([x, 0, .28], [x, .44, .28], .035, HIERRO);
  k.tramo([-.7, .8, -.3], [-.9, .96, -.3], .025, HIERRO);
  k.tramo([-.7, .8, .3], [-.9, .96, .3], .025, HIERRO);
  k.tramo([-.9, .96, -.32], [-.9, .96, .32], .03, CAUCHO);
  k.aviso('fritanga', .62, .24, [-.32, .66, .362], [0, 0, -.02], '#b9b3a2');
  // Vitrina: marco de lata, bandeja y la comida a la vista.
  const vx = -.37, vy = .89;
  for (const [x, z] of [[-.31, -.3], [.31, -.3], [-.31, .3], [.31, .3]]) k.caja(.025, .42, .025, LATA_OSCURA, [vx + x, vy + .21, z]);
  k.caja(.68, .025, .66, '#8f9289', [vx, vy + .43, 0]);
  k.caja(.6, .02, .56, '#b8b5aa', [vx, vy + .1, 0], [.14, 0, 0]);
  if (items.includes('empanada')) for (let i = 0; i < 8; i++) {
    k.bola(.06, i % 3 ? '#c0913f' : '#ad7a30', [vx - .22 + (i % 3) * .085, vy + .15 + (i % 2) * .012, .19 - Math.floor(i / 3) * .1 + (i % 2) * .02], [1.25, .42, .72], 5, 3, [0, (azar() - .5) * .8, 0]);
  }
  if (items.includes('morcilla')) for (let i = 0; i < 4; i++) {
    k.tubo(.028, .028, .2, 5, i % 2 ? '#3a2420' : '#46302a', [vx + .1 + (i % 2) * .12, vy + .145, -.02 - Math.floor(i / 2) * .11], [0, (azar() - .5) * .5, Math.PI / 2]);
  }
  if (items.includes('papaCriolla')) for (let i = 0; i < 9; i++) {
    k.bola(.036, i % 2 ? '#c9a544' : '#b8923a', [vx + .1 + (i % 3) * .06, vy + .16 + (i > 5 ? .045 : 0), .2 - Math.floor(i / 3) * .06 + (i > 5 ? .06 : 0)], [1, .85, 1], 4, 2);
  }
  for (let i = 0; i < 3; i++) k.tubo(.025, .025, .17, 6, '#8a3a26', [vx - .2 + i * .07, vy + .14, -.18], [0, .3, Math.PI / 2]);
  k.con('vidrio', () => {
    k.caja(.62, .4, .008, '#ffffff', [vx, vy + .21, .3]);
    for (const x of [-.31, .31]) k.caja(.008, .4, .6, '#ffffff', [vx + x, vy + .21, 0]);
  });
  // Paila con aceite sobre el quemador, y lo de servir.
  k.tubo(.14, .16, .06, 8, HIERRO, [.27, .92, -.02]);
  k.tubo(.25, .17, .09, 10, '#3d3b37', [.27, .995, -.02]);
  k.tubo(.225, .225, .012, 10, '#7a5a22', [.27, 1.03, -.02]);
  for (let i = 0; i < 4; i++) k.bola(.055, '#b9873a', [.27 + Math.sin(i * 1.7) * .1, 1.04, -.02 + Math.cos(i * 1.7) * .1], [1.2, .4, .7], 5, 3, [0, i, 0]);
  k.tramo([.47, 1.02, -.02], [.66, 1.07, -.1], .022, HIERRO);
  k.tubo(.045, .045, .11, 8, '#a8442f', [.05, .945, .27]);
  k.tubo(.047, .047, .015, 8, '#d8d2c2', [.05, 1.005, .27]);
  k.tramo([.05, .95, .27], [.09, 1.07, .25], .008, '#c9c4b6');
  k.caja(.1, .07, .1, '#b9b6ac', [.2, .925, .29]);
  k.caja(.085, .05, .085, '#e6e2d6', [.2, .975, .29], [0, .2, 0]);
  k.caja(.3, .012, .2, '#8f775a', [.36, .896, .26]);
  // Pipeta de gas con su manguera.
  const pipeta = elige(['#8f8a72', '#7f8a8a', '#93876a'], azar);
  k.tubo(.15, .15, .46, 8, pipeta, [-.97, .25, -.12]);
  k.tubo(.09, .15, .1, 8, pipeta, [-.97, .53, -.12]);
  k.tubo(.16, .16, .03, 8, HIERRO, [-.97, .015, -.12]);
  k.tubo(.1, .1, .06, 8, HIERRO, [-.97, .62, -.12], [0, 0, 0], false);
  k.tubo(.02, .025, .06, 6, '#a88f4a', [-.97, .6, -.12]);
  k.tramo([-.97, .62, -.12], [-.72, .5, -.2], .014, '#2b2a28');
  k.tramo([-.72, .5, -.2], [.2, .5, -.2], .014, '#2b2a28');
  // Fogón de carbón en media caneca, con parrilla.
  k.tubo(.35, .3, .6, 12, '#4a3b30', [.9, .5, 0], [0, 0, 0], false);
  k.tubo(.345, .345, .012, 12, '#231f1c', [.9, .78, 0]);
  for (const a of [0, 2.1, 4.2]) k.tramo([.9 + Math.sin(a) * .26, .22, Math.cos(a) * .26], [.9 + Math.sin(a) * .3, 0, Math.cos(a) * .3], .03, HIERRO);
  k.con('luz', () => {
    for (let i = 0; i < 7; i++) {
      const a = i * 2.4, r = i ? .1 + (i % 3) * .07 : 0;
      k.bola(.075 + (i % 2) * .02, i % 3 ? '#ff5a1a' : '#ff8a30', [.9 + Math.sin(a) * r, .8, Math.cos(a) * r], [1, .4, 1], 5, 2);
    }
    k.bola(.05, '#ffd9a0', [.3, 1.86, .34], [1, 1.2, 1], 6, 4);
  });
  for (let i = -3; i <= 3; i++) k.tramo([.9 + i * .09, .835, -.3], [.9 + i * .09, .835, .3], .01, HIERRO);
  for (let i = 0; i < 3; i++) k.tubo(.028, .028, .2, 6, '#8a3a26', [.8 + i * .1, .86, .1 - i * .09], [Math.PI / 2, 0, .3]);
  k.bola(.07, '#c9b88a', [.98, .85, -.14], [1, .25, 1], 6, 2);
  k.bola(.07, '#bfae80', [.82, .85, -.16], [1, .25, 1], 6, 2);
  // Bombillo colgado de la sombrilla, con su cable por el palo.
  k.tubo(.028, .034, .06, 6, '#2b2a28', [.3, 1.94, .34]);
  k.tramo([.3, 1.97, .34], [.18, 2.22, .22], .008, '#2b2a28');
  k.tramo([.18, 2.22, .22], [.02, 2.3, .11], .008, '#2b2a28');
  // Los banquitos van a los lados: el frente del carro queda libre para quien compra.
  banquito(k, [-.95, 0, .62], elige(['#a2473c', '#b0553f'], azar), .15);
  banquito(k, [1.0, 0, .62], elige(['#3d6688', '#c5bfae'], azar), -.2);
  k.en([0, 0, .1], [0, 0, 0], () => sombrilla(k, lonaDe(title), azar));
  const brillo = new THREE.MeshBasicMaterial({ vertexColors: true });
  const [luz] = k.mallas('luz', 1, brillo);
  luz.name = 'Brasas y bombillo';
  // De día el carbón apenas se ve y el bombillo está apagado; de noche brillan con la luz del puesto.
  luz.onBeforeRender = () => brillo.color.setScalar(.7 + 1.5 * Math.min(1, Math.max(0, ((light?.intensity ?? 2.2) / 2.2 - .12) / .88)));
  g.add(...k.mallas('cuerpo', 1, CUERPO), ...k.mallas('vidrio', 1, VIDRIO), luz);
  g.userData.dispose = () => { soltarVenta(g); light?.dispose(); };
  return g;
}

/** Suelta lo que es de un solo puesto; los materiales comunes siguen para los demás. */
function soltarVenta(puesto) {
  puesto.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry.dispose();
    if (![...CUERPOS, ...LUCES, VIDRIO].includes(o.material)) o.material.dispose();
  });
  puesto.clear();
  puesto.removeFromParent();
}
