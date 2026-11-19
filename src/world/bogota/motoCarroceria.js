// Carrocería de la 250. Las curvas del tanque y del asiento sirven también de soporte a filetes, rodilleras y costuras.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { addGeo, addGrid, box, tube, COLOR } from './carParts.js';
import { curve, lerp } from './carLoft.js';

const rgb = hex => new THREE.Color(hex).toArray();
const PI = Math.PI;
const ACERO = rgb('#afbac1'), ALUMINIO = rgb('#858c90'), LATON = rgb('#ba9866');
const MARFIL = rgb('#e5d5ad'), GOMA = rgb('#222628'), VINILO = rgb('#423129');
const HILO = rgb('#a0876c'), TAPA = rgb('#313a3c'), PINTURA = [1, 1, 1];
const METAL = .3, CUERO = .018, LACA = .94;

function conducto(b, puntos, radio, color, metal = 0, mirror = false, pasos = 24) {
  const guia = new THREE.CatmullRomCurve3(puntos.map(p => new THREE.Vector3(...p)));
  addGeo(b, new THREE.TubeGeometry(guia, pasos, radio, 8, false), { color, metal, mirror });
}

function redondeado(b, medidas, centro, radio, color, metal = 0, mirror = false) {
  addGeo(b, new RoundedBoxGeometry(...medidas, 3, radio), { position: centro, color, metal, mirror });
}

// Secciones transversales superelípticas. La interpolación monótona conserva el perfil trazado en cada estación.
function piel(estaciones, potenciaZ, potenciaY, deformar) {
  const [inferior, superior, ancho] = [1, 2, 3].map(k => curve(estaciones.map(fila => [fila[0], fila[k]])));
  return (x, angulo) => {
    const coseno = Math.cos(angulo), seno = Math.sin(angulo);
    const bajo = inferior(x), alto = superior(x);
    const y = lerp(bajo, alto, .5 + .5 * Math.sign(coseno) * Math.abs(coseno) ** potenciaY);
    const z = ancho(x) * Math.sign(seno) * Math.abs(seno) ** potenciaZ;
    return deformar ? deformar(x, y, z, coseno) : [x, y, z];
  };
}

const tanque = piel([
  [-.197, .832, .839, .016], [-.175, .798, .882, .077], [-.105, .759, .925, .111],
  [-.016, .737, .969, .150], [.105, .733, 1.011, .187], [.205, .748, 1.025, .193],
  [.296, .778, 1.009, .176], [.372, .804, .973, .139], [.414, .841, .923, .085],
  [.431, .873, .886, .024]
], .84, .87);

const sillon = piel([
  [-.845, .869, .885, .029], [-.822, .846, .914, .096], [-.747, .833, .938, .141],
  [-.62, .834, .943, .153], [-.53, .825, .929, .151], [-.415, .805, .892, .146],
  [-.30, .800, .875, .134], [-.205, .807, .878, .114], [-.129, .822, .891, .096],
  [-.101, .844, .873, .065]
], .58, .61, (x, y, z, arriba) => {
  const fase = (x + .764) / .049;
  const pliegue = Math.exp(-((Math.sin(fase * PI) / .265) ** 2));
  return [x, y - .006 * pliegue * Math.max(0, arriba), z];
});

function cerrarPiel(b, forma, inicio, fin, pasos, color, metal) {
  const costillas = 32;
  addGrid(b, pasos, costillas, (i, j) => forma(lerp(inicio, fin, i / pasos), PI * j / costillas),
    { color, metal, out: [0, 0, 1] });
  for (const [x, signo] of [[inicio, -1], [fin, 1]]) {
    const anillo = Array.from({ length: costillas * 2 }, (_, i) => {
      const p = forma(x, PI * i / costillas);
      return b.v(...p, signo, 0, 0, undefined, undefined, ...color, metal);
    });
    for (let i = 1; i < anillo.length - 1; i++) {
      if (signo > 0) b.tri(anillo[0], anillo[i], anillo[i + 1]);
      else b.tri(anillo[0], anillo[i + 1], anillo[i]);
    }
  }
}

function deposito(b) {
  cerrarPiel(b, tanque, -.197, .431, 64, PINTURA, LACA);
  // El filete marfil se afina en las dos puntas y lleva un segundo borde de latón.
  for (const [desfase, grosor, color] of [[0, .19, MARFIL], [.258, .028, LATON]]) {
    addGrid(b, 75, 3, (i, j) => {
      const u = i / 75, x = lerp(-.15, .417, u);
      const ancho = grosor * Math.max(.013, Math.sin(PI * u) ** .65);
      const angulo = 1.51 + .31 * Math.sin(u * PI) - .40 * u + desfase + (j / 3 - .5) * ancho;
      const [px, y, z] = tanque(x, angulo);
      return [px, y + .0007 * Math.cos(angulo), z + .0012];
    }, { color, metal: .29, out: [0, 0, 1] });
  }
  // Protector vulcanizado con estrías horizontales en relieve y labios redondeados.
  addGrid(b, 50, 46, (i, j) => {
    const u = (i / 50) * 2 - 1, v = (j / 46) * 2 - 1;
    const extremo = Math.sqrt(Math.max(.0003, 1 - u ** 4));
    const x = -.048 + .105 * u;
    const theta = 1.82 + .46 * extremo * v - .09 * u;
    const p = tanque(x, theta);
    const borde = Math.min(1, 8 * (1 - Math.abs(v)), 11 * (1 - Math.abs(u)));
    const relieve = .008 + (.0028 + .0034 * Math.cos(theta * 43)) * borde;
    p[2] += .0017 + borde * relieve;
    return p;
  }, { color: GOMA, metal: .1, out: [0, 0, 1] });

  const y = tanque(.197, 0)[1];
  for (const [radio, altura, nivel, color, metal] of [
    [.051, .007, .001, COLOR.trim, 0], [.047, .008, .006, ACERO, METAL], [.035, .006, .012, ALUMINIO, METAL]
  ]) addGeo(b, new THREE.CylinderGeometry(radio, radio + .0007, altura, 44), { position: [.197, y + nivel, 0], color, metal });
  redondeado(b, [.022, .003, .007], [.193, y + .0155, 0], .0012, COLOR.trim);
  for (let i = 0; i < 6; i++) {
    const a = i * PI / 3;
    addGeo(b, new THREE.CylinderGeometry(.0027, .0027, .0018, 6), {
      position: [.197 + .041 * Math.cos(a), y + .0103, .041 * Math.sin(a)], color: COLOR.gray, metal: METAL
    });
  }
}

function asiento(b) {
  cerrarPiel(b, sillon, -.845, -.101, 205, VINILO, CUERO);
  const aLoLargo = (x, theta, separacion) => {
    const p = sillon(x, theta);
    p[2] += separacion;
    return p;
  };
  const costura = Array.from({ length: 35 }, (_, i) => aLoLargo(lerp(-.832, -.115, i / 34), 1.23, .0015));
  conducto(b, costura, .0027, rgb('#6a5043'), CUERO, true, 64);
  // Puntada discontinua en la unión de la tapa y el faldón del asiento.
  for (let x = -.813; x < -.136; x += .015) {
    tube(b, aLoLargo(x, 1.15, .0021), aLoLargo(x + .0075, 1.15, .0021), .00085, 5,
      { color: HILO, mirror: true, open: true });
  }
  addGrid(b, 5, 38, (i, j) => {
    const theta = PI * j / 38, p = sillon(-.527 + .028 * i / 5, theta);
    p[1] += .007 * Math.cos(theta);
    p[2] += .005 * Math.sin(theta);
    return p;
  }, { color: rgb('#3c322e'), metal: CUERO, out: [0, 0, 1] });
  redondeado(b, [.038, .019, .007], [-.512, .858, .157], .003, ALUMINIO, METAL, true);
  redondeado(b, [.025, .010, .003], [-.512, .858, .161], .001, VINILO, CUERO, true);
}

// Tapa prensada con borde plegado. Se conserva una cara lateral limpia para el óvalo esmaltado de cilindrada.
function tapas(b) {
  const perfil = new THREE.Shape();
  perfil.moveTo(-.496, .798);
  perfil.quadraticCurveTo(-.504, .818, -.464, .820);
  perfil.bezierCurveTo(-.38, .830, -.23, .816, -.117, .802);
  perfil.quadraticCurveTo(-.078, .791, -.104, .754);
  perfil.lineTo(-.194, .639);
  perfil.quadraticCurveTo(-.222, .602, -.263, .625);
  perfil.bezierCurveTo(-.337, .660, -.438, .737, -.496, .798);
  const cuerpo = new THREE.ExtrudeGeometry(perfil, { depth: .043, bevelEnabled: true, bevelSegments: 5,
    bevelThickness: .010, bevelSize: .010, curveSegments: 16 });
  addGeo(b, cuerpo, { position: [0, 0, .083], color: TAPA, metal: .24, mirror: true });
  for (const [x, y] of [[-.447, .795], [-.146, .781], [-.233, .649]]) {
    tube(b, [x, y, .135], [x, y, .138], .0055, 8, { color: ALUMINIO, metal: METAL, mirror: true });
  }
  // Plaquita fundida con los números de cilindrada aplicados, legibles desde cualquiera de los costados.
  for (const [radio, z, color, metal] of [[1, .1384, LATON, METAL], [.92, .140, COLOR.trim, 0]]) {
    const placa = new THREE.CircleGeometry(1, 44);
    placa.scale(.061 * radio, .023 * radio, 1);
    addGeo(b, placa, { position: [-.276, .744, z], color, metal, mirror: true });
  }
  const digitos = [
    [[0,.73],[.10,.91],[.39,1],[.74,.94],[.87,.74],[.73,.52],[.06,.07],[.09,0],[.88,0]],
    [[.86,1],[.16,1],[.11,.54],[.44,.58],[.74,.52],[.87,.34],[.78,.12],[.55,.02],[.19,.03],[.02,.12]],
    [[.49,.99],[.75,.91],[.84,.65],[.82,.33],[.65,.09],[.43,.01],[.17,.10],[.10,.39],[.15,.72],[.27,.93],[.49,.99]]
  ];
  for (const lado of [-1, 1]) digitos.forEach((trazo, i) => {
    const puntos = trazo.map(([u,v]) => [-.276 + lado * ((i - 1) * .023 + (u - .45) * .018 + v * .003), .735 + v * .019, lado * .1418]);
    conducto(b, puntos, .00135, MARFIL, .29, false, 20);
  });
}

function guardabarros(b, x, desde, hasta, ancho, color, metal) {
  const punto = (u, t, inferior = false) => {
    const a = lerp(desde, hasta, u);
    const forma = .83 + .17 * Math.sin(PI * u) ** .6;
    const borde = Math.abs(t);
    const r = .346 - .024 * borde ** 2.5 - (inferior ? .004 : 0);
    return [x + r * Math.cos(a), .30 + r * Math.sin(a), ancho * forma * t];
  };
  for (const inferior of [false, true]) {
    addGrid(b, 44, 12, (i, j) => punto(i / 44, (j - 6) / 6, inferior), {
      color: inferior ? COLOR.plastic : color, metal: inferior ? 0 : metal, mirror: false,
      out: [0, inferior ? -1 : 1, 0]
    });
  }
  const borde = Array.from({ length: 24 }, (_, i) => punto(i / 23, 1));
  conducto(b, borde, .0021, color, metal, true, 50);
}

function cola(b) {
  // Barras curvadas para el parrillero y remate integrado bajo el asiento.
  conducto(b, [[-.519,.827,.139],[-.553,.865,.153],[-.711,.897,.153],[-.836,.910,.132],
    [-.878,.913,.092],[-.886,.914,0]], .010, ALUMINIO, METAL, true, 42);
  const colin = piel([[-.908,.798,.814,.030],[-.86,.795,.849,.096],[-.74,.785,.862,.132],
    [-.58,.778,.853,.130],[-.44,.778,.82,.085]], .65, .7);
  cerrarPiel(b, colin, -.908, -.44, 34, PINTURA, LACA);
  redondeado(b, [.058,.061,.148], [-.878,.829,0], .017, COLOR.trim);
  redondeado(b, [.020,.050,.137], [-.910,.829,0], .009, rgb('#a61722'), .04);
  for (let z = -.054; z <= .055; z += .012) {
    tube(b, [-.9201,.816,z], [-.9201,.841,z], .0013, 5, { color: rgb('#bf3741'), metal: .04 });
  }
  tube(b, [-.815,.799,-.164], [-.815,.799,.164], .0075, 10, { color: COLOR.trim });
  for (const [x, ancho, color, metal] of [[-.819,.043,COLOR.trim,0],[-.836,.032,rgb('#d97d20'),.04]]) {
    const pieza = new THREE.SphereGeometry(1, 22, 13);
    addGeo(b, pieza, { position: [x,.799,.164], scale: [.020,.023,ancho], color, metal, mirror: true });
  }
}

export function carroceriaMoto(b) {
  deposito(b);
  asiento(b);
  tapas(b);
  guardabarros(b, .66, .41, 2.74, .073, PINTURA, LACA);
  guardabarros(b, -.66, .26, 2.84, .084, COLOR.plastic, 0);
  for (const x of [.496, .827]) {
    const y = .30 + Math.sqrt(.323 ** 2 - (x - .66) ** 2);
    conducto(b, [[.632,.371,.081],[.630,.441,.084],[x,y,.066]], .0047, ALUMINIO, METAL, true, 12);
  }
  cola(b);
}
