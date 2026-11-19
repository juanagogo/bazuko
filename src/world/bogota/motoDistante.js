// Silueta de la moto urbana y su kit de reparto cuando ocupan pocos píxeles en la calle.
import * as THREE from 'three';
import { Batch, COLOR, addGeo, addGrid, bar, box, tube } from './carParts.js';
import { conAzarPropio } from './carLibreas.js';
import { dibujarPlacaMoto } from './motoPlaca.js';

// El alfa del lote dice qué es cada pieza: 1 toma el color de la moto, .3 es metal, .1 es caucho; el resto, plástico.
const PAINTED = 1, METAL = .3, CAUCHO = .1;
// Máscaras del material compartido. Los valores por encima de .5 también reciben la pintura por instancia.
const TANK = .9, SIDE_PANEL = .77, SADDLE = .025, OPTIC = .42, FORK = .34;
const srgb = hex => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
const WHITE = [1, 1, 1], SEAT = srgb('#39302b'), STEEL = [.5, .52, .54], ENGINE = [.028, .028, .03], ALU = [.14, .145, .15];
const RIM = [.2, .205, .21], RAIL = [.06, .06, .065], AMBER = srgb('#c8741c'), STOP = srgb('#a02a22'), PLATE = srgb('#d6b02a');
const LENS = [.81, .78, .63], GLASS = [.42, .47, .5], HELMET = [.1, .1, .094], VISOR = [.02, .025, .03], REFLECTIVE = [.6, .6, .55];

/**
 * Perfil lateral con volumen: el contorno al centro y encogido a cada lado, como un cuerpo inflado.
 * El contorno va en sentido antihorario visto desde +Z; así salen el tanque, el asiento y las tapas sin cajas.
 */
function pillow(points, halfWidth, shrink = .74) {
  const n = points.length;
  let cx = 0, cy = 0;
  for (const [x, y] of points) { cx += x; cy += y; }
  cx /= n; cy /= n;
  const position = [], index = [];
  for (const side of [1, -1]) for (const [x, y] of points) position.push(cx + (x - cx) * shrink, cy + (y - cy) * shrink, side * halfWidth);
  for (const [x, y] of points) position.push(x, y, 0);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, c = 2 * n;
    index.push(i, c + i, c + j, i, c + j, j, c + i, n + i, n + j, c + i, n + j, c + j);
  }
  for (let i = 1; i < n - 1; i++) index.push(0, i, i + 1, n, n + i + 1, n + i);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/** Guardabarros: lámina curva sobre la rueda, visible por encima y por debajo. */
function fender(b, cx, cy, radius, a0, a1, halfWidth, color, metal = 0) {
  const point = (i, j) => {
    const a = a0 + (a1 - a0) * i / 6, z = (j - 1) * halfWidth, r = radius - (j === 1 ? 0 : .018);
    return [cx + r * Math.cos(a), cy + r * Math.sin(a), z];
  };
  addGrid(b, 6, 2, point, { color, metal, mirror: false, out: [0, 1, 0] });
  addGrid(b, 6, 1, (i,j) => point(i,j*2), { color: COLOR.dark, mirror: false, out: [0, -1, 0] });
}

/** Rueda de ruta: labio torneado, cinco aspas barridas y disco ventilado en la delantera. */
function wheel(b, x, r, disc) {
  const width = disc ? .048 : .061;
  const bead = r - .077;
  const lathe = (section, segments, color, metal) => {
    const shape = section.map(([radius, z]) => new THREE.Vector2(radius, z));
    const g = new THREE.LatheGeometry(shape, segments);
    addGeo(b, g, { rotation: [Math.PI / 2, 0, 0], position: [x, r, 0], color, metal });
  };
  lathe([[bead, -width * .66], [r - .018, -width], [r, 0], [r - .018, width], [bead, width * .66]], 22, COLOR.rubber, CAUCHO);
  // El labio cierra directamente contra el talón; el interior queda abierto entre las aspas.
  lathe([[bead + .0035, width * .68], [bead - .016, width * .58], [bead - .016, -width * .58], [bead + .0035, -width * .68]], 20,
    (_x, _y, z) => Math.abs(z) > width * .63 ? STEEL : RIM, METAL);

  const hubRadius = disc ? .047 : .072;
  tube(b, [x, r, -.045], [x, r, .045], hubRadius, 7, { color: ALU, metal: METAL });
  for (let k = 0; k < 5; k++) {
    const start = Math.PI * 2 * k / 5;
    // Tres aristas longitudinales forman la cara tallada; los costados cierran el aspa hasta el cubo.
    const blade = (end, rail, side = 1) => {
      const radius = end ? bead - .014 : hubRadius * .84;
      const angle = start + (end ? .22 : -.45) + (rail - 1) * (end ? .095 : .39);
      const z = rail === 1 ? .024 : .012;
      return [x + radius * Math.cos(angle), r + radius * Math.sin(angle), side * z];
    };
    addGrid(b, 1, 2, (i, j) => blade(i, j), {
      out: [0, 0, 1], color: (_i, j) => j === .5 ? RIM : COLOR.plasticLight, metal: METAL
    });
    for (const edge of [0, 2]) {
      const dir = edge - 1;
      addGrid(b, 1, 1, (i, j) => blade(i, edge, j ? 1 : -1), {
        out: [-Math.sin(start) * dir, Math.cos(start) * dir, 0], mirror: false, color: COLOR.plasticLight, metal: METAL
      });
    }
  }
  if (!disc) return;
  // El aro de frenado se sujeta a la maza por cuatro brazos; entre ellos se ve pasar la luz.
  for (const face of [-1, 1]) {
    const sector = (i, edge) => {
      const angle = i * Math.PI / 8;
      const radius = edge ? .135 : (i % 4 === 0 ? hubRadius * .75 : .104);
      return [x + radius * Math.cos(angle), r + radius * Math.sin(angle), .047 + face * .002];
    };
    addGrid(b, 16, 1, sector, { out: [0, 0, face], mirror: false, color: (_i, edge) => edge ? STEEL : ALU, metal: METAL });
  }
  bar(b, [x - .119, r + .047, .054], [x - .082, r + .107, .054], .041, .042, { color: COLOR.gray, metal: METAL });
}

// Cada estación define X, base, coronación y semiancho. Los dos costados se encuentran en el lomo y en la quilla.
function carroceriaMoto(b, estaciones, perfil, color, metal) {
  const seccion = [...perfil, ...perfil.slice(1,-1).reverse().map(([z,y]) => [-z,y])];
  const puntos = [], indices = [];
  const filas = estaciones.map(([x, base, alto, ancho]) => {
    const inicio = puntos.length / 3;
    if (!ancho) { puntos.push(x,base,0); return [inicio]; }
    return seccion.map(([z,y], j) => {
      puntos.push(x,base + y * (alto - base),z * ancho);
      return inicio + j;
    });
  });
  for (let i = 1; i < filas.length; i++) {
    const izq = filas[i-1], der = filas[i];
    for (let j = 0; j < seccion.length; j++) {
      const k = (j+1) % seccion.length;
      if (izq.length === 1) indices.push(izq[0],der[k],der[j]);
      else if (der.length === 1) indices.push(izq[j],izq[k],der[0]);
      else indices.push(izq[j],izq[k],der[k],izq[j],der[k],der[j]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(puntos,3));
  g.setIndex(indices);
  g.computeVertexNormals();
  addGeo(b,g,{color,metal});
}

// Carcasa, bisel y vidrio combado comparten la misma circunferencia; el hombro del bisel conserva su arista.
function faroMoto(b) {
  const cy = .957, lados = 14;
  function anillo(x, radio, nx, color, metal) {
    const nr = Math.sqrt(1 - nx * nx);
    return Array.from({length:lados}, (_, i) => {
      const a = 2 * Math.PI * i / lados, y = Math.cos(a), z = Math.sin(a);
      return b.v(x, cy + y * radio, z * radio, nx, nr * y, nr * z, undefined, undefined, ...color, metal);
    });
  }
  function unir(atras, frente) {
    for (let i = 0; i < lados; i++) {
      const j = (i+1) % lados;
      b.quad(atras[i],atras[j],frente[j],frente[i]);
    }
  }
  const tapa = b.v(.427,cy,0,-1,0,0,undefined,undefined,...COLOR.trim);
  const carcasa = anillo(.519,.111,-.24,COLOR.trim,0);
  for (let i=0; i<lados; i++) b.tri(tapa,carcasa[(i+1)%lados],carcasa[i]);
  unir(carcasa,anillo(.545,.111,.12,COLOR.trim,0));
  unir(anillo(.545,.112,.22,STEEL,METAL),anillo(.562,.095,.83,STEEL,METAL));
  const borde = anillo(.562,.094,.90,LENS,OPTIC);
  const centro = b.v(.581,cy,0,1,0,0,undefined,undefined,...LENS,OPTIC);
  for (let i=0; i<lados; i++) b.tri(borde[i],borde[(i+1)%lados],centro);
}

function armarMoto() {
  const b = new Batch(), r = .3, front = .66, rear = -.66;
  wheel(b, front, r, true); wheel(b, rear, r, false);
  fender(b, front, r, r + .041, .49, 2.70, .074, WHITE, PAINTED);
  fender(b, rear, r, r + .035, .55, 2.2, .06, COLOR.dark);

  // El tanque se abre alrededor del bastidor y se estrecha donde entran las rodillas.
  carroceriaMoto(b, [
    [-.195,.819,.819,0], [-.12,.774,.915,.110], [.035,.737,.986,.164],
    [.215,.745,1.012,.188], [.33,.786,.985,.162], [.410,.827,.925,.092], [.425,.872,.872,0]
  ], [[0,1],[.70,.95],[1,.67],[.99,.32],[.65,.08],[0,0]], WHITE, TANK);
  const tapon = new THREE.CircleGeometry(.037, 10);
  tapon.rotateX(-Math.PI / 2);
  addGeo(b, tapon, { position: [.213, 1.0125, 0], color: STEEL, metal: METAL });

  // Sillín corrido con un pequeño escalón para el parrillero y el borde redondeado sobre el colín.
  carroceriaMoto(b, [
    [-.823,.895,.895,0], [-.765,.856,.952,.112], [-.605,.836,.953,.141],
    [-.47,.827,.932,.145], [-.345,.814,.894,.139], [-.19,.811,.887,.116], [-.078,.857,.857,0]
  ], [[0,1],[.85,.94],[1,.62],[.92,.14],[0,0]], SEAT, SADDLE);
  addGeo(b, pillow([[-.866,.848],[-.70,.789],[-.41,.748],[-.36,.812],[-.61,.858],[-.80,.881]], .126, .83),
    { color:WHITE, metal:PAINTED });
  addGeo(b, pillow([[-.478,.773],[-.31,.635],[-.179,.597],[-.073,.708],[-.088,.798],[-.39,.821]], .137, .86),
    { color:WHITE, metal:SIDE_PANEL });

  // Cola: stop, direccionales, agarradera del parrillero y la placa amarilla colgada del guardabarros.
  box(b, [.05, .05, .13], [-.86, .825, 0], { color: STOP });
  box(b, [.04, .035, .045], [-.80, .80, .115], { color: AMBER, mirror: true });
  tube(b, [-.54, .854, .142], [-.87, .935, .142], .011, 5, { color: STEEL, metal: METAL, mirror: true, open: true });
  tube(b, [-.87, .935, -.142], [-.87, .935, .142], .011, 5, { color: STEEL, metal: METAL, open: true });
  bar(b, [-.80, .80, 0], [-.925, .70, 0], .016, .11, { color: COLOR.dark });
  box(b, [.012, .125, .215], [-.93, .655, 0], { color: COLOR.dark });
  box(b, [.012, .105, .195], [-.936, .655, 0], { color: PLATE });
  dibujarPlacaMoto(b);

  // Motor monocilíndrico: las aletas tienen vuelo, por eso recortan la luz aun vistas de frente.
  addGeo(b, pillow([[-.18, .29], [.00, .245], [.17, .28], [.205, .405], [.10, .49], [-.13, .485]], .119, .88), { color: ENGINE });
  const torno = (perfil, lados) => new THREE.LatheGeometry(perfil.map(([radio, alto]) => new THREE.Vector2(radio, alto)), lados);
  const tapa = torno([[.098, .103], [.081, .144]], 8);
  tapa.rotateX(Math.PI / 2);
  addGeo(b, tapa, { position: [.025, .364, 0], color: ALU, metal: METAL, mirror: true });
  addGeo(b, new THREE.CircleGeometry(.081, 8), { position: [.025, .364, .144], color: RIM, metal: METAL, mirror: true });
  const inclinacion = .23, ejeCilindro = h => [.045 + h * Math.sin(inclinacion), .431 + h * Math.cos(inclinacion), 0];
  const giroCilindro = [0, 0, -inclinacion];
  box(b, [.145, .236, .153], ejeCilindro(.116), { rotation: giroCilindro, color: ENGINE });
  for (const h of [.07, .11, .15, .19]) {
    box(b, [.189, .009, .205], ejeCilindro(h), { rotation: giroCilindro, color: ALU, metal: METAL });
  }
  box(b, [.175, .047, .183], ejeCilindro(.24), { rotation: giroCilindro, color: COLOR.gray, metal: METAL });
  // El manguito une el filtro con la admisión. La abrazadera y la pipa de bujía se ven bajo el depósito.
  tube(b, [-.205, .678, .015], [.096, .634, .015], .039, 5, { color: COLOR.plastic, open: true });
  tube(b, [-.032, .654, .015], [-.005, .649, .015], .044, 5, { color: ALU, metal: METAL, open: true });
  tube(b, [.119, .677, .013], [.167, .768, .013], .016, 4, { color: COLOR.trim, open: true });

  // La cuna rodea el cárter. El basculante va al eje trasero y cada amortiguador lleva funda y vástago.
  const tuboChasis = { color: COLOR.trim, open: true };
  tube(b, [.405, .83, 0], [.23, .232, 0], .032, 4, tuboChasis);
  tube(b, [.23, .232, 0], [-.13, .248, 0], .029, 4, tuboChasis);
  tube(b, [-.085, .40, .087], [rear, r, .087], .034, 4, { ...tuboChasis, mirror: true });
  tube(b, [-.575, .323, .104], [-.41, .766, .104], .016, 4, { color: STEEL, metal: METAL, open: true, mirror: true });
  tube(b, [-.493, .54, .104], [-.41, .766, .104], .031, 4, { ...tuboChasis, mirror: true });
  addGrid(b, 1, 1, (i, j) => [i ? -.105 : rear, (i ? .405 : .335) + j * .039, -.113], { color: COLOR.plastic, mirror: false, out: [0, 0, -1] });

  // El colector sale de la culata y curva bajo el motor. La boca del silenciador queda hueca.
  const colector = new THREE.CatmullRomCurve3([[.149, .651, .045], [.30, .55, .077], [.275, .307, .132], [.176, .257, .14], [-.20, .277, .152]].map(p => new THREE.Vector3(...p)));
  addGeo(b, new THREE.TubeGeometry(colector, 6, .023, 4, false), { color: srgb('#7e746e'), metal: METAL });
  const escape = torno([[.027, 0], [.061, .095], [.065, .53], [.048, .555], [.028, .555]], 6);
  escape.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(-1, .25, 0).normalize()));
  addGeo(b, escape, { position: [-.19, .275, .152], color: COLOR.plastic });
  addGrid(b, 2, 1, (i, j) => {
    const x = [-.674, -.59, -.284][i], eje = .275 - (x + .19) * .25;
    return [x + (i === 2 && j ? .032 : 0), eje + (j ? .032 : -.023), i === 1 ? .222 : .214];
  }, { color: STEEL, metal: METAL, mirror: false, out: [0, 0, 1] });

  // Horquilla, farola con su lente, direccionales, tablero y manubrio.
  tube(b, [front, r, .069], [.415, .93, .069], .024, 6, { color: STEEL, metal: FORK, mirror: true, open:true });
  box(b, [.09, .03, .17], [.42, .90, 0], { color: COLOR.dark });
  faroMoto(b);
  box(b, [.05, .036, .052], [.482, .909, .146], { color: AMBER, mirror: true });
  box(b, [.07, .05, .13], [.40, 1.01, 0], { color: COLOR.dark });
  tube(b, [.405, 1.018, 0], [.414, 1.072, .18], .012, 4, { color: STEEL, metal: METAL, mirror: true, open: true });
  tube(b, [.414, 1.072, .18], [.365, 1.054, .355], .016, 5, { color: COLOR.rubber, metal: CAUCHO, mirror: true });
  tube(b, [.412, 1.06, .19], [.403, 1.044, .335], .005, 4, { color: STEEL, metal: METAL, mirror: true, open: true });
  // La carcasa abombada mira a la calle, el espejo hacia quien maneja.
  tube(b, [.404, 1.07, .192], [.35, 1.164, .265], .006, 4, { color: STEEL, metal: METAL, mirror: true, open: true });
  const espejo = new THREE.ConeGeometry(.056, .027, 8, 1, true);
  espejo.rotateZ(-Math.PI / 2);
  espejo.scale(1, .58, 1);
  espejo.rotateX(-.22);
  addGeo(b, espejo, { position: [.348, 1.181, .288], color: COLOR.plastic, mirror: true });
  const luna = new THREE.CircleGeometry(.0558, 8);
  luna.rotateY(-Math.PI / 2);
  luna.scale(1, .58, 1);
  luna.rotateX(-.22);
  addGeo(b, luna, { position: [.3345, 1.181, .288], color: GLASS, metal: METAL, mirror: true });

  // Gato lateral y estriberas.
  bar(b, [-.12, .28, -.11], [-.20, .01, -.21], .02, .02, { color: COLOR.dark });
  bar(b, [-.06, .28, .10], [-.06, .28, .20], .022, .022, { color: COLOR.rubber, metal: CAUCHO, mirror: true });

  return b.toGeometry('Moto parqueada (lejana)');
}

/** Lo que lleva de más la moto de reparto: parrilla, cajón térmico sin letrero y el casco colgado del manubrio. */
function armarKit() {
  const b = new Batch();
  // Parrilla sobre la cola, con sus tirantes hasta el amortiguador.
  box(b, [.42, .018, .38], [-.74, 1.0, 0], { color: RAIL, metal: METAL });
  bar(b, [-.90, .995, .15], [-.66, .44, .11], .016, .016, { color: RAIL, metal: METAL, mirror: true });
  // Maleta térmica: base reforzada, costura oscura bajo la tapa y esquinas achaflanadas.
  const contour = (y, x, z, bevel) => [
    [x - bevel, z], [-x + bevel, z], [-x, z - bevel], [-x, -z + bevel],
    [-x + bevel, -z], [x - bevel, -z], [x, -z + bevel], [x, z - bevel],
  ].map(([dx, dz]) => [-.74 + dx, y, dz]);
  const rings = [
    contour(1.012, .181, .193, .035), contour(1.059, .211, .227, .037),
    contour(1.321, .211, .227, .037), contour(1.339, .218, .234, .039),
    contour(1.392, .196, .212, .037),
  ];
  const lid = [.67, .68, .70];
  const fabric = [[COLOR.trim, 0], [WHITE, PAINTED], [COLOR.trim, 0], [lid, PAINTED]];
  for (let k = 0; k < fabric.length; k++) {
    const [color, metal] = fabric[k];
    for (let i = 0; i < 8; i++) {
      const a = rings[k][i], next = (i + 1) % 8, c = rings[k][next];
      addGrid(b, 1, 1, (s, t) => rings[k + t][s ? next : i], {
        out: [(a[0] + c[0]) / 2 + .74, 0, (a[2] + c[2]) / 2], color, metal, mirror: false,
      });
    }
  }
  for (const [ring, normal, color, metal] of [[rings[0], -1, COLOR.trim, 0], [rings[4], 1, lid, PAINTED]]) {
    const ids = ring.map(([x, y, z]) => b.v(x, y, z, 0, normal, 0, 0, 0, ...color, metal));
    for (let i = 1; i < 7; i++) {
      if (normal > 0) b.tri(ids[0], ids[i + 1], ids[i]);
      else b.tri(ids[0], ids[i], ids[i + 1]);
    }
  }
  // A cada lado, bolsillo de lona con solapa y dos bandas reflectivas cortadas al sesgo.
  addGrid(b, 1, 1, (u, v) => [-.887 + .294 * u, 1.09 + .167 * v, .231 + .011 * v], { color: [.52, .52, .53], metal: PAINTED });
  addGrid(b, 1, 1, (u, v) => [-.893 + .306 * u, 1.236 + .041 * v, .245 - .017 * v], { color: COLOR.trim });
  for (const x of [-.833, -.779]) {
    addGrid(b, 1, 1, (u, v) => [x + .027 * u + .048 * v, 1.119 + .080 * v, .235 + .0054 * v], { color: REFLECTIVE, metal: METAL });
  }
  // Las correas traseras se aseguran con dos hebillas, por debajo de una sola manija de cinta.
  for (const z of [-.12, .12]) {
    addGrid(b, 1, 1, (u, v) => [-.953, 1.073 + .244 * v, z + .031 * (u - .5)], { color: COLOR.trim, mirror: false });
    addGrid(b, 1, 1, (u, v) => [-.956, 1.209 + .020 * v, z + .045 * (u - .5)], { color: STEEL, metal: METAL, mirror: false });
  }
  const handle = [[-.806, 1.393], [-.787, 1.419], [-.697, 1.419], [-.678, 1.393]];
  addGrid(b, 3, 1, (i, j) => [handle[i][0], handle[i][1], (j - .5) * .029], { color: COLOR.trim, mirror: false, out: [0, 1, 0] });
  // Casco gris percudido colgado de la correa al lado derecho del tanque: la calota abierta abajo, con su borde de caucho.
  for (const face of [-1, 1]) addGrid(b, 1, 1, (i, j) =>
    [.32 + .05 * j + (i - .5) * .015, .99 + .06 * j, .235 + .001 * face],
  { color: COLOR.trim, mirror: false, out: [0, 0, face] });
  const shell = new THREE.SphereGeometry(.12, 9, 4, 0, Math.PI * 2, 0, 2.2);
  shell.scale(1.12, 1, 1);
  addGeo(b, shell, { position: [.30, .90, .235], color: HELMET });
  const rim = new THREE.CylinderGeometry(.098, .094, .024, 8, 1, true);
  rim.scale(1.12, 1, 1);
  addGeo(b, rim, { position: [.30, .82, .235], color: COLOR.dark });
  const liner = new THREE.CircleGeometry(.094, 8);
  liner.rotateX(Math.PI / 2);
  liner.scale(1.12, 1, 1);
  addGeo(b, liner, { position: [.30, .808, .235], color: COLOR.dark });
  const visor = new THREE.SphereGeometry(.124, 5, 2, Math.PI - 1.25, 2.5, 1.05, .83);
  visor.scale(1.12, 1, 1);
  addGeo(b, visor, { position: [.30, .90, .235], color: VISOR, metal: METAL });
  return b.toGeometry('Cajón de domicilio (lejano)');
}

let moto, kit;

export function motoDistante() {
  return moto ??= conAzarPropio(0x125CC, armarMoto);
}

export function kitDistante() {
  return kit ??= conAzarPropio(0xD0A1C1, armarKit);
}
