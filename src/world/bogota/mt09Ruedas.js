import * as THREE from 'three';
import { addGeo, COLOR, tube } from './carParts.js';
import { aro, perno, plancha, ventanaCircular } from './motoRuedas.js';

const TAU = Math.PI * 2;
const tono = hex => new THREE.Color(hex).toArray();
const FLUO = tono('#f03927'), LABIO = tono('#fc4933'), CANAL = tono('#d02c21');
const NEGRO = tono('#25272a'), TITANIO = tono('#89898a');
const ACERO_OSCURO = tono('#666970'), NEGRO_FUNDIDO = tono('#3e4044'), SELLO = tono('#6a6f75');
const RODADURA = tono('#353636'), HOMBRO = tono('#282a2a'), SURCO = tono('#161819');
const FLANCO = tono('#222424'), RELIEVE = tono('#2b2c2c');
const METAL = .3, FRESADO = .31, PISTA = .33, GOMA = .1, PINTURA = .94;

function punto(rueda, radio, angulo, z) {
  return [rueda.x + Math.cos(angulo) * radio, rueda.y + Math.sin(angulo) * radio, z];
}

function coronaCircular(exterior, interior, pasos = 80) {
  const forma = new THREE.Shape(ventanaCircular(0, 0, exterior, pasos).getPoints());
  forma.holes.push(ventanaCircular(0, 0, interior, pasos));
  return forma;
}

// Trazos en una cuadrícula de 3 × 4 para las inscripciones del molde, leídas desde cada costado.
const signos = {
  '0':['126AEDC841'], '1':['41D','CE'], '2':['1268CE'], '5':['2046AEC'],
  '7':['02D'], '8':['12654841','568CDEA6'], '/':['C2'],
  Z:['02CE'], R:['C012654','5E'], T:['02','1D'], U:['08DA2'],
  B:['C012654','45AEC'], E:['20CE','46'], L:['0CE'], S:['21456ADC']
};
function inscripcion(rueda, b, perfil, lado, texto, angulo) {
  const alto = .0065, paso = .0053, rBase = perfil[7][0] - .0055;
  function vertice(digito, distancia) {
    const id = parseInt(digito, 16), u = id % 4, v = Math.floor(id / 4);
    const r = rBase + (1-v/3)*alto;
    const j = perfil.findIndex(([radio]) => radio >= r);
    const [r0,w0] = perfil[j-1], [r1,w1] = perfil[j];
    const z = rueda.semiancho * THREE.MathUtils.lerp(w0,w1,(r-r0)/(r1-r0)) + .00014;
    return punto(rueda,r,angulo-lado*(distancia+u*paso*.34)/rBase,lado*z);
  }
  for (let i = 0; i < texto.length; i++) for (const linea of signos[texto[i]] ?? []) {
    const distancia = (i-texto.length*.5) * paso;
    for (let j = 1; j < linea.length; j++) tube(b, vertice(linea[j-1],distancia), vertice(linea[j],distancia),
      .00047, 5, { color: RELIEVE, metal: GOMA, open: true });
  }
}

// Carcasa radial de carretera. La goma entre canales y sus paredes interiores comparten la malla.
function cubierta(rueda, b) {
  const { x, y, semiancho, trasera } = rueda;
  const hombro = y - (trasera ? .041 : .035);
  const mitad = [[.216,.72],[.222,.80],[.226,.866],[.2274,.88],[.2284,.875],
    [hombro-.027,.915],[hombro-.022,.952],[hombro-.016,.982],
    [hombro-.011,1],[hombro-.006,.991],[hombro,.955]];
  for (const lado of [-1, 1]) {
    // El último tramo sigue la tangente del hombro y se cierra exactamente en el borde de la banda.
    const perfil = mitad.map(([r, z]) => [r, lado * z * semiancho]);
    if (lado > 0) perfil.reverse();
    aro(b, x, perfil, (px, py) => {
      const r = Math.hypot(px - x, py - y);
      return r > hombro - .0065 ? HOMBRO : r < .229 ? RELIEVE : FLANCO;
    }, GOMA, 112, y);
    // Nervio circular del molde junto a la zona de inscripción.
    const rasgo = [[hombro-.018,.976],[hombro-.0172,.981],[hombro-.0165,.981]];
    const moldura = rasgo.map(([r,w]) => [r, lado * w * semiancho]);
    if (lado > 0) moldura.reverse();
    aro(b, x, moldura, RELIEVE, GOMA, 112, y);
    inscripcion(rueda,b,mitad,lado,trasera ? '180/55 ZR17' : '120/70 ZR17',1.1);
    inscripcion(rueda,b,mitad,lado,'TUBELESS',3.95);
  }

  const filas = [-1,-.966,-.91,-.81,-.70,-.60,-.49,-.40,-.30,-.21,-.14,-.07,0,.07,.14,.21,.30,.40,.49,.60,.70,.81,.91,.966,1];
  const muestras = [0,.014,.027,.05,.17,.31,.46,.485,.50,.515,.54,.65,.79,.93,.974,.986];
  const pasos = trasera ? 13 : 15, columnas = pasos * muestras.length;
  const geometria = new THREE.BufferGeometry(), posiciones = [], colores = [], indices = [];
  for (const q of filas) {
    const v = Math.abs(q);
    const curva = .92 * v - .25 * Math.sin(v * Math.PI * 1.75) + (q < 0 ? .43*THREE.MathUtils.smoothstep(v,0,.53) : 0);
    const entrada = THREE.MathUtils.smoothstep(v, .11, .30), salida = 1 - THREE.MathUtils.smoothstep(v, .80, .98);
    const sierra = THREE.MathUtils.smoothstep(v, .44, .70) * (1 - THREE.MathUtils.smoothstep(v, .90, .986));
    for (let i = 0; i < columnas; i++) {
      const vuelta = Math.floor(i / muestras.length), t = muestras[i % muestras.length];
      const a = (vuelta + t + curva) * TAU / pasos;
      const ancho = .013 + .013 * Math.sin(Math.PI * v);
      const principal = (1 - THREE.MathUtils.smoothstep(Math.min(t,1-t), ancho * .30, ancho)) * entrada * salida;
      const secundario = vuelta % 2 === 0 ? (1 - THREE.MathUtils.smoothstep(Math.abs(t-.5), .005, .020)) * sierra : 0;
      const corte = Math.max(principal, secundario);
      const r = y - (y - hombro) * v ** 2.35 - corte * .0028;
      posiciones.push(x + r * Math.cos(a), y + r * Math.sin(a), semiancho * .955 * q);
      const pulido = 1 - THREE.MathUtils.smoothstep(v, .12, .90);
      const huella = .975 + .025 * Math.sin(7 * a + v * 20) * Math.cos(3 * a - 12 * v);
      for (let c = 0; c < 3; c++) colores.push(THREE.MathUtils.lerp(THREE.MathUtils.lerp(HOMBRO[c], RODADURA[c], pulido) * huella, SURCO[c], corte));
    }
  }
  for (let j = 0; j < filas.length - 1; j++) for (let i = 0; i < columnas; i++) {
    const a = j * columnas + i, d = j * columnas + (i + 1) % columnas;
    indices.push(a, d, d+columnas, a, d+columnas, a+columnas);
  }
  geometria.setAttribute('position', new THREE.Float32BufferAttribute(posiciones, 3));
  geometria.setIndex(indices);
  geometria.computeVertexNormals();
  const n = geometria.attributes.normal, base = b.count;
  for (let i = 0; i < n.count; i++) {
    b.v(posiciones[i*3], posiciones[i*3+1], posiciones[i*3+2], n.getX(i), n.getY(i), n.getZ(i),
      0, 0, colores[i*3], colores[i*3+1], colores[i*3+2], GOMA);
  }
  for (let i = 0; i < indices.length; i += 3) b.tri(base+indices[i], base+indices[i+1], base+indices[i+2]);
  geometria.dispose();
}

// Un radio fundido es grueso en la raíz, angosto en el centro y ensanchado junto al aro.
function radios(rueda, b) {
  const estaciones = [[.038,0,.017,.019],[.056,.003,.016,.018],[.080,.008,.012,.014],
    [.119,.017,.0060,.010],[.161,.025,.0049,.008],[.189,.029,.0063,.010],[.207,.029,.010,.013]];
  const contorno = [[1,0],[.76,.74],[.38,1],[-.60,.86],[-1,.37],[-1,-.37],[-.60,-.86],[.38,-1],[.76,-.74]];
  const indices = [];
  for (let j = 0; j < estaciones.length - 1; j++) for (let i = 0; i < contorno.length; i++) {
    const a = j * contorno.length + i, d = j * contorno.length + (i+1) % contorno.length;
    indices.push(a,d,d+contorno.length, a,d+contorno.length,a+contorno.length);
  }
  for (let i = 0; i < 10; i++) {
    const a = i * TAU / 10 + .12, posiciones = [];
    for (const [r,t,w,h] of estaciones) for (const [u,v] of contorno) {
      posiciones.push(rueda.x + r * Math.cos(a) - (t + u*w) * Math.sin(a),
        rueda.y + r * Math.sin(a) + (t + u*w) * Math.cos(a), v*h * (rueda.trasera ? 1.35 : 1));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(posiciones, 3));
    g.setIndex(indices); g.computeVertexNormals();
    addGeo(b, g, { color: FLUO, metal: PINTURA });
  }
}

// Los diez brazos de la fundición llegan por separado al barril. El nervio más grueso va hacia el buje.
function rin(rueda, b) {
  const { x, y, semiancho } = rueda;
  const seccion = [[.222,.77],[.225,.82],[.224,.86],[.219,.86],[.216,.81],[.214,.70],
    [.211,.61],[.205,.48],[.202,.34],[.201,-.34],[.205,-.48],[.211,-.61],[.214,-.70],
    [.216,-.81],[.219,-.86],[.224,-.86],[.225,-.82],[.222,-.77]];
  aro(b, x, seccion.map(([radio, z]) => [radio, z * semiancho]), (_px, _py, z) => {
    const parte = Math.abs(z) / semiancho;
    return parte > .78 ? LABIO : parte < .48 ? CANAL : FLUO;
  }, PINTURA, 112, y);
  radios(rueda, b);
  const buje = [[.013,-.83],[.027,-.83],[.032,-.67],[.053,-.56],[.058,-.38],[.046,-.16],
    [.046,.16],[.058,.38],[.053,.56],[.032,.67],[.027,.83],[.013,.83]];
  aro(b, x, buje.map(([radio, z]) => [radio, z * semiancho]), FLUO, PINTURA, 56, y);
  for (const lado of [-1, 1]) {
    const z = lado * (rueda.trasera ? .104 : .090);
    aro(b, x, [[.011, z * .42],[.019, z * .42],[.020, z],[.011, z]], TITANIO, METAL, 30, y);
    perno(b, x, y, z, .014, .012, NEGRO_FUNDIDO);
  }
  tube(b, punto(rueda, .205, 4.1, .006), punto(rueda, .179, 4.07, .021), .0046, 10, { color: COLOR.rubber, metal: .1 });
  tube(b, punto(rueda, .181, 4.072, .020), punto(rueda, .173, 4.063, .024), .0055, 8, { color: NEGRO });
}

// La parte barrida por las pastillas enseña surcos de desgaste concéntricos. Cada banda
// está recortada para sus propios taladros y se une a la siguiente a tope.
function pistaFreno(rueda, b, radio, centroZ) {
  const { x, y, trasera } = rueda;
  const interior = trasera ? .68 : .70, espesor = .0045;
  const bordes = [interior,.718,.725,.794,.802,.8785,.884,.967,.978,.994,1];
  const acabados = ['#727473','#a8aba9','#bdc1c0','#a9aeac','#c5c9c7',
    '#afb3b1','#bfc4c2','#b2b7b6','#c8ccca','#999e9c'].map(tono);
  const fondo = tono('#5c6264'), filo = tono('#a3aaa8');
  const huecos = Array.from({ length: 3 }, (_, fila) =>
    Array.from({ length: 15 }, (_, i) => {
      const a = TAU * i / 15 + fila * .067 + (i % 2) * .012, r = radio * (.758 + fila * .088);
      return [r*Math.cos(a), r*Math.sin(a)];
    })
  );
  for (let k = 0; k < bordes.length-1; k++) {
    const forma = coronaCircular(radio * bordes[k+1], radio * bordes[k], 112);
    const fila = k === 2 ? 0 : k === 4 ? 1 : k === 6 ? 2 : -1;
    if (fila !== -1) for (const [hx,hy] of huecos[fila]) forma.holes.push(ventanaCircular(hx, hy, .00375, 10));
    for (const lado of [-1,1]) {
      const g = new THREE.ShapeGeometry(forma);
      if (lado < 0) {
        const indices = g.index.array, normales = g.attributes.normal;
        for (let i = 0; i < indices.length; i += 3) [indices[i+1],indices[i+2]] = [indices[i+2],indices[i+1]];
        for (let i = 0; i < normales.count; i++) normales.setZ(i, -1);
      }
      addGeo(b, g, { position: [x,y,centroZ+lado*espesor/2], color: acabados[k], metal: PISTA });
    }
  }
  // El avellanado descubre metal claro en la boca y el taladro atraviesa los 4,5 mm del disco.
  function pared(cx, cy, radios, alturas, pasos, dentro, color, marca) {
    const base = b.count, sentido = dentro ? -1 : 1;
    const pendiente = (radios[1]-radios[0]) / (alturas[1]-alturas[0]);
    const escala = 1 / Math.hypot(1, pendiente);
    for (let j = 0; j < 2; j++) for (let i = 0; i < pasos; i++) {
      const a = TAU * i / pasos, co = Math.cos(a), si = Math.sin(a);
      b.v(cx+radios[j]*co, cy+radios[j]*si, centroZ+alturas[j], sentido*co*escala,
        sentido*si*escala, -sentido*pendiente*escala, 0,0,...color,marca);
    }
    for (let i = 0; i < pasos; i++) {
      const a = base+i, d = base+(i+1)%pasos;
      if (dentro) b.quad(a,a+pasos,d+pasos,d);
      else b.quad(a,d,d+pasos,a+pasos);
    }
  }
  const mitad = espesor/2, nucleo = mitad-.00050;
  pared(x,y,[radio,radio],[-mitad,mitad],112,false,fondo,METAL);
  pared(x,y,[radio*interior,radio*interior],[-mitad,mitad],112,true,fondo,METAL);
  for (const fila of huecos) for (const [hx,hy] of fila) {
    pared(x+hx,y+hy,[.00375,.00335],[-mitad,-nucleo],10,true,filo,PISTA);
    pared(x+hx,y+hy,[.00335,.00335],[-nucleo,nucleo],10,true,fondo,METAL);
    pared(x+hx,y+hy,[.00335,.00375],[nucleo,mitad],10,true,filo,PISTA);
  }
}

// Cabeza Allen con su hexágono hundido, utilizable por ambos lados del disco.
function tornilloAllen(b, px, py, z, lado, radio) {
  const perfil = [[1,0],[1,.15],[.88,.26],[.48,.26],[.40,.19],[.40,-.02]];
  const pasos = 12, base = b.count;
  for (let j = 0; j < perfil.length; j++) for (let i = 0; i < pasos; i++) {
    const [r,h] = perfil[j], a = i * TAU / pasos, exterior = j < 2;
    // Los puntos intermedios quedan en la cara plana del hexágono.
    const hex = j >= 3 && i % 2 ? Math.cos(Math.PI/6) : 1;
    const co = Math.cos(a), si = Math.sin(a), c = j >= 4 ? NEGRO : TITANIO;
    const nz = j >= 4 ? .18 : exterior ? .27 : 1, nr = Math.sqrt(1-nz*nz) * (j >= 4 ? -1 : 1);
    b.v(px+radio*r*hex*co, py+radio*r*hex*si, z+lado*radio*h,
      nr*co,nr*si,lado*nz,0,0,...c,FRESADO);
  }
  for (let j = 0; j < perfil.length-1; j++) for (let i = 0; i < pasos; i++) {
    const a = base+j*pasos+i, d = base+j*pasos+(i+1)%pasos;
    if (lado > 0) b.quad(a,d,d+pasos,a+pasos);
    else b.quad(a,a+pasos,d+pasos,d);
  }
  const centro = b.v(px,py,z-lado*radio*.02,0,0,lado,0,0,...NEGRO,METAL);
  for (let i = 0; i < pasos; i++) {
    const a = base+(perfil.length-1)*pasos+i, d = base+(perfil.length-1)*pasos+(i+1)%pasos;
    if (lado > 0) b.tri(centro,a,d);
    else b.tri(centro,d,a);
  }
}

function frenado(rueda, b, lado) {
  const { x, y, trasera } = rueda;
  const radio = trasera ? .1225 : .149;
  const centroZ = lado * (trasera ? .097 : .064);
  pistaFreno(rueda, b, radio, centroZ);
  // Araña negra de cinco anclajes. Cada brazo termina en dos casquillos de la pista flotante.
  const arana = new THREE.Shape();
  for (let k = 0; k < 100; k++) {
    const a = TAU * k / 100, lomo = .5 + .5 * Math.cos(5 * a);
    const r = radio * (.325 + .423 * lomo ** .87);
    if (!k) arana.moveTo(r, 0);
    else arana.lineTo(r * Math.cos(a), r * Math.sin(a));
  }
  arana.closePath();
  arana.holes.push(ventanaCircular(0, 0, .026, 32));
  for (let i = 0; i < 5; i++) {
    const a = i * TAU / 5;
    const hueco = new THREE.Path();
    for (const [j,[r,t]] of [[.40,-.068],[.54,-.11],[.64,-.093],[.64,.055],[.57,.109],[.44,.099]].entries()) {
      const px = radio*r*Math.cos(a+t), py = radio*r*Math.sin(a+t);
      if (j === 0) hueco.moveTo(px,py);
      else hueco.lineTo(px,py);
    }
    hueco.closePath();
    arana.holes.push(hueco);
  }
  plancha(b, arana, { x, y, z: centroZ - lado * .0012 - .0018, grosor: .0036, color: trasera ? ACERO_OSCURO : NEGRO_FUNDIDO });
  for (let i = 0; i < 5; i++) {
    const a = i * TAU / 5;
    for (const desfase of [-.115, .115]) {
      const [px, py] = punto(rueda, radio * .719, a + desfase, 0);
      tornilloAllen(b, px, py, centroZ + .0024 * lado, lado, .0052);
    }
    const [px, py] = punto(rueda, .041, a, 0);
    perno(b, px, py, centroZ * .71, .008, Math.abs(centroZ) * .60, NEGRO_FUNDIDO, 12);
    tornilloAllen(b, px, py, centroZ + .0025 * lado, lado, .0057);
  }
}

function anilloABS(rueda, b, z) {
  const forma = coronaCircular(.063, .036, 90);
  for (let i = 0; i < 40; i++) {
    const a = i * TAU / 40;
    const hueco = new THREE.Path();
    [[.048,a-.041],[.059,a-.045],[.059,a+.045],[.048,a+.041]].forEach(([r, t], j) => {
      const px = r * Math.cos(t), py = r * Math.sin(t);
      if (!j) hueco.moveTo(px, py);
      else hueco.lineTo(px, py);
    });
    hueco.closePath();
    forma.holes.push(hueco);
  }
  plancha(b, forma, { x: rueda.x, y: rueda.y, z, grosor: .0014, color: NEGRO_FUNDIDO });
}

function pinza(rueda, b, lado) {
  const { x, y, trasera } = rueda;
  const radio = trasera ? .1225 : .149;
  const a = trasera ? .44 : 2.43, centroZ = lado * (trasera ? .097 : .064);
  const posicion = (r, t, z) => [x + r * Math.cos(a) - t * Math.sin(a), y + r * Math.sin(a) + t * Math.cos(a), z];
  const carcasa = new THREE.Shape();
  carcasa.moveTo(radio - .022, -.032);
  carcasa.quadraticCurveTo(radio - .022, -.043, radio - .008, -.046);
  carcasa.lineTo(radio + .012, -.045);
  carcasa.quadraticCurveTo(radio + .023, -.040, radio + .022, -.022);
  carcasa.lineTo(radio + .024, .028);
  carcasa.quadraticCurveTo(radio + .017, .047, radio + .001, .046);
  carcasa.lineTo(radio - .019, .036);
  carcasa.quadraticCurveTo(radio - .025, .027, radio - .022, -.032);
  carcasa.closePath();
  const exterior = centroZ + lado * .017;
  plancha(b, carcasa, { x, y, z: exterior - .011, grosor: .022, giro: a, bisel: .002, color: NEGRO_FUNDIDO });
  plancha(b, carcasa, { x, y, z: centroZ - .013 * lado - .007, grosor: .014, giro: a, bisel: .0016, color: NEGRO });
  for (const t of [-.021, .020]) {
    const [px, py] = posicion(radio - .003, t, 0);
    const tapa = trasera ? .010 : .013;
    perno(b, px, py, exterior + lado * .0108, tapa, .003, NEGRO, 20);
    perno(b, px, py, exterior + lado * .0126, tapa*.82, .0021, SELLO, 16);
    tornilloAllen(b,px,py,exterior+lado*.0137,lado,tapa*.49);
    const desde = posicion(radio + .014, t, centroZ);
    perno(b, desde[0], desde[1], centroZ, .006, .025, NEGRO_FUNDIDO, 10);
    const alto = t > 0 ? .359 : .421;
    const hasta = trasera ? [-.59,.34,.106] : [.72 - (alto - .30) * .452, alto, .103 * lado];
    tube(b, desde, hasta, .008, 10, { color: NEGRO_FUNDIDO, metal: METAL });
  }
  // Pasador de retención, nervio del puente y filo cobrizo de las pastillas junto a la pista.
  tube(b,posicion(radio+.013,-.035,exterior+lado*.009),posicion(radio+.017,.031,exterior+lado*.009),
    .004,10,{color:NEGRO,metal:METAL});
  tube(b,posicion(radio+.008,-.033,centroZ+lado*.0039),posicion(radio+.006,.031,centroZ+lado*.0039),
    .0026,7,{color:tono('#5a4d3e'),metal:METAL});
  const puente=posicion(radio+.010,-.035,0);
  tornilloAllen(b,puente[0],puente[1],exterior+lado*.0107,lado,.0036);
  if (!trasera) {
    perno(b, .610, .397, .085 * lado, .0055, .013, TITANIO);
  }
}

function coronaDeCadena(b, rueda) {
  const { x, y } = rueda;
  const forma = new THREE.Shape();
  for (let i = 0; i < 45; i++) {
    for (const [fase, r] of [[0,.105],[.23,.110],[.43,.112],[.64,.111],[.87,.105]]) {
      const a = (i + fase) * TAU / 45;
      if (i === 0 && fase === 0) forma.moveTo(r, 0);
      else forma.lineTo(r * Math.cos(a), r * Math.sin(a));
    }
  }
  forma.closePath();
  forma.holes.push(ventanaCircular(0, 0, .035, 40));
  for (let i = 0; i < 6; i++) {
    const a = i * TAU / 6;
    const hueco = new THREE.Path();
    [[.056,-.17],[.080,-.27],[.092,-.18],[.092,.17],[.079,.28],[.056,.15]].forEach(([r, delta], j) => {
      const px = r * Math.cos(a + delta), py = r * Math.sin(a + delta);
      if (j === 0) hueco.moveTo(px, py);
      else hueco.lineTo(px, py);
    });
    hueco.closePath();
    forma.holes.push(hueco);
    const [px, py] = punto(rueda, .065, a + .52, 0);
    perno(b, px, py, -.109, .006, .008, TITANIO);
  }
  plancha(b, forma, { x, y, z: -.108, grosor: .006, color: ACERO_OSCURO });
  aro(b, x, [[.026,-.105],[.047,-.105],[.061,-.095],[.055,-.066],[.030,-.064]], NEGRO, METAL, 48, y);
}

/** MT-09 Ice Fluo 2019. La huella nominal es de 120 mm delante y 180 mm detrás, ambas en rin de 17 pulgadas. */
export function ruedasMT09(b) {
  const delantera = { x: .72, y: .30, semiancho: .06, trasera: false };
  const trasera = { x: -.72, y: .315, semiancho: .09, trasera: true };
  for (const rueda of [delantera, trasera]) {
    cubierta(rueda, b);
    rin(rueda, b);
    for (const lado of rueda.trasera ? [1] : [-1, 1]) {
      frenado(rueda, b, lado);
      pinza(rueda, b, lado);
    }
  }
  anilloABS(delantera, b, -.071);
  anilloABS(trasera, b, .102);
  coronaDeCadena(b, trasera);
}
