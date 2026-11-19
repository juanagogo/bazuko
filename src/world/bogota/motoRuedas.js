import * as THREE from 'three';
import { addGeo, COLOR, tube } from './carParts.js';

const TAU = Math.PI * 2;
const EJE_Y = .30, METAL = .30, GOMA = .10;
const tono = hex => new THREE.Color(hex).toArray();
const BANDA = tono('#323537'), FLANCO = tono('#222628'), FONDO_SURCO = tono('#101112');
const GRAFITO = tono('#353b3d'), TITANIO = tono('#79766d'), FRESADO = tono('#aaa59a');
const ACERO = tono('#b8bbb8'), HIERRO = tono('#55595b'), CARRIER = tono('#4c4540');
const BRONCE = tono('#836d50'), OSCURO = tono('#252729');

/** Torno de perfil (radio, Z) sobre el eje de la rueda. */
export function aro(b, x, perfil, color, metal = METAL, lados = 64, y = EJE_Y) {
  const g = new THREE.LatheGeometry(perfil.map(([radio, z]) => new THREE.Vector2(radio, z)), lados);
  g.rotateX(Math.PI / 2);
  addGeo(b, g, { position: [x, y, 0], color, metal });
}

export function plancha(b, forma, { x, y = EJE_Y, z, grosor, giro = 0, bisel = 0, color }) {
  const g = new THREE.ExtrudeGeometry(forma, {
    depth: grosor, steps: 1, curveSegments: 4, bevelEnabled: bisel > 0,
    bevelSegments: 1, bevelThickness: bisel, bevelSize: bisel,
  });
  g.rotateZ(giro);
  addGeo(b, g, { position: [x, y, z], color, metal: METAL });
}

export function perno(b, x, y, z, radio, largo, color, lados = 6) {
  const g = new THREE.CylinderGeometry(radio, radio, largo, lados);
  g.rotateX(Math.PI / 2);
  addGeo(b, g, { position: [x, y, z], color, metal: METAL });
}

export function ventanaCircular(x, y, radio, lados) {
  const agujero = new THREE.Path();
  for (let k = 0; k < lados; k++) {
    const a = k * TAU / lados;
    const px = x + radio * Math.cos(a), py = y + radio * Math.sin(a);
    if (k === 0) agujero.moveTo(px, py);
    else agujero.lineTo(px, py);
  }
  agujero.closePath();
  return agujero;
}

/** El perfil transversal y el dibujo de lluvia se forman en la misma superficie, sin calcos sobre la goma. */
export function neumatico(b, x, ancho, radioExterior = EJE_Y) {
  const filas = [-1, -.91, -.72, -.55, -.35, -.21, -.09, 0, .09, .21, .35, .55, .72, .91, 1];
  // A cada vuelta se alternan un canal de hombro largo y otro corto. Las muestras estrechas labran sus dos labios.
  const pasos = [0, .04, .071, .108, .144, .20, .38, .50, .535, .575, .61, .69, .85];
  const repeticiones = 24, columnas = pasos.length * repeticiones;
  const posiciones = [], colores = [], indices = [];
  const pulso = (t, centro, anchoCanal) => 1 - THREE.MathUtils.smoothstep(Math.abs(t - centro), anchoCanal * .32, anchoCanal);
  for (const q of filas) {
    const v = Math.abs(q);
    const hombro = THREE.MathUtils.smoothstep(v, .078, .30) * (1 - THREE.MathUtils.smoothstep(v, .88, 1));
    for (let i = 0; i < columnas; i++) {
      const vuelta = Math.floor(i / pasos.length), t = pasos[i % pasos.length];
      const retraso = q > 0 ? .39 * THREE.MathUtils.smoothstep(v, 0, .5) : 0;
      const giro = (vuelta + t + .82 * v ** 1.35 + retraso) * TAU / repeticiones;
      const principal = pulso(t, .09, .071) * hombro;
      const corto = pulso(t, .554, .060) * hombro * THREE.MathUtils.smoothstep(v, .37, .74);
      const hendidura = Math.max(principal, corto);
      const extra = radioExterior - .30;
      const radio = radioExterior - (.043 + extra * .51) * v ** 2.1 - .0043 * hendidura;
      posiciones.push(x + radio * Math.cos(giro), radioExterior + radio * Math.sin(giro), q * ancho * .97);
      for (let c = 0; c < 3; c++) colores.push(THREE.MathUtils.lerp(BANDA[c], FONDO_SURCO[c], hendidura));
    }
  }
  for (let j = 0; j < filas.length - 1; j++) for (let i = 0; i < columnas; i++) {
    const siguiente = (i + 1) % columnas;
    const a = j * columnas + i, d = j * columnas + siguiente;
    indices.push(a, d, d + columnas, a, d + columnas, a + columnas);
  }
  const banda = new THREE.BufferGeometry();
  banda.setAttribute('position', new THREE.Float32BufferAttribute(posiciones, 3));
  banda.setIndex(indices);
  banda.computeVertexNormals();
  const normales = banda.attributes.normal.array;
  const base = b.count;
  for (let i = 0; i < posiciones.length; i += 3) {
    b.v(posiciones[i], posiciones[i+1], posiciones[i+2], normales[i], normales[i+1], normales[i+2],
      0, 0, colores[i], colores[i+1], colores[i+2], GOMA);
  }
  for (let i = 0; i < indices.length; i += 3) b.tri(base + indices[i], base + indices[i+1], base + indices[i+2]);
  banda.dispose();
  // Hombro, costado abombado y resalte del talón. La pista exterior termina sobre el hombro.
  const medio = [[.216, .61], [.221, .77], [.226, .85], [.228, .91], [.230, .91],
    [.232, .87], [.241, .965], [.250, 1], [.2575, .972]];
  for (const lado of [-1, 1]) {
    const perfil = medio.map(([r, z]) => [r + (radioExterior - .30) * (r - .216) / .084, z * ancho * lado]);
    if (lado === 1) perfil.reverse();
    aro(b, x, perfil, (px, py) => {
      const r = Math.hypot(px - x, py - radioExterior);
      return r > .232 && r < .254 ? FLANCO : COLOR.rubber;
    }, GOMA, 80, radioExterior);
  }
}

function rin(b, x, ancho) {
  const perfil = [[.224, .78], [.225, .84], [.222, .88], [.219, .88], [.216, .80],
    [.214, .66], [.211, .58], [.208, .42], [.205, .33], [.204, -.33],
    [.208, -.42], [.211, -.58], [.214, -.66], [.216, -.80], [.219, -.88], [.222, -.88], [.225, -.84], [.224, -.78]];
  aro(b, x, perfil.map(([r, z]) => [r, z * ancho]), (_x, _y, z) => {
    const labio = Math.abs(z) / ancho;
    return labio > .817 ? FRESADO : labio > .75 ? TITANIO : GRAFITO;
  });

  // Una sola pieza de fundición por aspa: el pie se abre en dos nervios que aterrizan en el labio interior.
  const aspa = new THREE.Shape();
  aspa.moveTo(.041, -.020);
  aspa.quadraticCurveTo(.078, -.028, .117, -.010);
  aspa.quadraticCurveTo(.153, .001, .200, -.026);
  aspa.lineTo(.211, -.031);
  aspa.lineTo(.211, -.014);
  aspa.quadraticCurveTo(.172, .009, .139, .018);
  aspa.quadraticCurveTo(.163, .037, .202, .050);
  aspa.lineTo(.202, .064);
  aspa.quadraticCurveTo(.149, .056, .119, .037);
  aspa.quadraticCurveTo(.084, .013, .039, .019);
  aspa.closePath();
  const cara = (_x, _y, z) => Math.abs(z) > .0145 ? TITANIO : Math.abs(z) > .0135 ? FRESADO : GRAFITO;
  for (let i = 0; i < 5; i++) {
    const giro = i * TAU / 5 + .22;
    plancha(b, aspa, { x, z: -.014, grosor: .028, giro, bisel: .0024, color: cara });
  }
  aro(b, x, [[.013,-.065],[.027,-.065],[.028,-.052],[.055,-.041],[.063,-.032],
    [.057,-.012],[.057,.012],[.063,.032],[.055,.041],[.028,.052],[.027,.065],[.013,.065]], GRAFITO, METAL, 32);
  for (const lado of [-1, 1]) {
    perno(b, x, EJE_Y, .070 * lado, .020, .010, HIERRO, 16);
    perno(b, x, EJE_Y, .079 * lado, .0145, .012, FRESADO);
  }
  const a = -.66, punto = (r, z) => [x + r * Math.cos(a), EJE_Y + r * Math.sin(a), z];
  tube(b, punto(.208, -.008), punto(.182, -.019), .0048, 8, { color: COLOR.rubber, metal: GOMA });
  tube(b, punto(.183, -.019), punto(.178, -.021), .006, 8, { color: HIERRO, metal: METAL });
}

/** Pista de acero taladrada y araña flotante con ventanas que dejan ver las aspas al fondo. */
function disco(b, x, radio, z, trasero) {
  const pista = new THREE.Shape(ventanaCircular(0, 0, radio, 72).getPoints());
  pista.holes.push(ventanaCircular(0, 0, radio * .684, 60));
  for (let k = 0; k < 12; k++) for (let j = 0; j < 3; j++) {
    const a = TAU * k / 12 + j * .096;
    const r = radio * (.765 + j * .079);
    pista.holes.push(ventanaCircular(r * Math.cos(a), r * Math.sin(a), radio * .028, 7));
  }
  plancha(b, pista, { x, z, grosor: .004, color: ACERO });

  const arana = new THREE.Shape();
  for (let i = 0; i <= 72; i++) {
    const a = TAU * i / 72;
    const r = radio * (.425 + .312 * Math.pow((1 + Math.cos(a * 6)) / 2, 2.3));
    if (!i) arana.moveTo(r, 0);
    else arana.lineTo(r * Math.cos(a), r * Math.sin(a));
  }
  arana.closePath();
  arana.holes.push(ventanaCircular(0, 0, radio * .174, 24));
  plancha(b, arana, { x, z: z - .0025, grosor: .004, color: CARRIER });
  for (let i = 0; i < 6; i++) {
    const a = i * TAU / 6, px = x + radio * .709 * Math.cos(a), py = EJE_Y + radio * .709 * Math.sin(a);
    perno(b, px, py, z + .0048, .0065, .0035, TITANIO, 12);
    perno(b, px, py, z + .0069, .0026, .001, OSCURO, 8);
    perno(b, x + .041 * Math.cos(a), EJE_Y + .041 * Math.sin(a), z + .004, .005, .006, FRESADO);
  }
  const angulo = trasero ? .50 : 2.37;
  const punto = (r, t) => [x + r * Math.cos(angulo) - t * Math.sin(angulo),
    EJE_Y + r * Math.sin(angulo) + t * Math.cos(angulo)];
  // La pinza abraza las dos caras de la pista. La mordaza exterior deja que se lean las dos cámaras de pistón.
  const pinza = new THREE.Shape();
  pinza.moveTo(radio - .025, -.035);
  pinza.quadraticCurveTo(radio - .012, -.055, radio + .012, -.041);
  pinza.lineTo(radio + .023, -.017);
  pinza.quadraticCurveTo(radio + .028, .032, radio + .010, .043);
  pinza.quadraticCurveTo(radio - .011, .051, radio - .025, .031);
  pinza.closePath();
  const acabado = trasero ? GRAFITO : BRONCE;
  plancha(b, pinza, { x, z: z + .007, grosor: .022, giro: angulo, bisel: .0028, color: acabado });
  plancha(b, pinza, { x, z: z - .013, grosor: .009, giro: angulo, bisel: .0015, color: GRAFITO });
  for (const t of [-.022, .019]) {
    const [px, py] = punto(radio + .011, t);
    perno(b, px, py, z + .009, .008, .034, HIERRO, 12);
    const [bx, by] = punto(radio - .003, t);
    perno(b, bx, by, z + .0315, .0108, .005, acabado, 16);
    perno(b, bx, by, z + .0343, .0047, .0025, HIERRO);
  }
  const [mx, my] = punto(radio + .011, .030);
  const anclaje = trasero ? [x + .13, EJE_Y + .027, .074] : [x - .045, EJE_Y + .118, .078];
  tube(b, [mx, my, z - .007], anclaje, .008, 8, { color: HIERRO, metal: METAL });
}

function corona(b, x) {
  const forma = new THREE.Shape();
  const dientes = 40;
  for (let i = 0; i < dientes; i++) {
    for (const [fase, r] of [[0,.0945],[.25,.0995],[.48,.101],[.65,.0995],[.89,.0945]]) {
      const a = TAU * (i + fase) / dientes;
      if (!i && !fase) forma.moveTo(r, 0);
      else forma.lineTo(r * Math.cos(a), r * Math.sin(a));
    }
  }
  forma.closePath();
  forma.holes.push(ventanaCircular(0, 0, .025, 24));
  for (let i = 0; i < 5; i++) {
    const a = TAU * i / 5;
    const ventana = new THREE.Path();
    for (const [k, [r, delta]] of [[.046,-.22],[.074,-.28],[.083,-.20],[.084,.19],[.077,.27],[.049,.20]].entries()) {
      const px = r * Math.cos(a + delta), py = r * Math.sin(a + delta);
      if (!k) ventana.moveTo(px, py);
      else ventana.lineTo(px, py);
    }
    ventana.closePath();
    forma.holes.push(ventana);
    const k = a + .61;
    perno(b, x + .062 * Math.cos(k), EJE_Y + .062 * Math.sin(k), -.075, .006, .009, FRESADO);
  }
  plancha(b, forma, { x, z: -.073, grosor: .006, color: TITANIO });
}

/** Ruedas de aleación para la moto urbana. Todas las piezas terminan en el lote instanciado de la calle. */
export function ruedasMoto(b) {
  for (const [x, ancho] of [[.66, .056], [-.66, .073]]) {
    const trasero = x < 0;
    neumatico(b, x, ancho);
    rin(b, x, ancho);
    disco(b, x, trasero ? .120 : .143, trasero ? .066 : .060, trasero);
  }
  corona(b, -.66);
}
