import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { addGeo, addGrid, box, tube, COLOR } from './carParts.js';

const tela = .62, goma = .1, metal = .3;
const rgb = hex => new THREE.Color(hex).toArray();
const nylon = rgb('#26292a'), canto = rgb('#393c39'), hilo = rgb('#847e6c');
const plata = rgb('#b5b9a6'), acero = rgb('#6d7576'), carbon = rgb('#353a3c');
const centroX = -.74;

function malla(b, puntos, indices, color, material = 0) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(puntos.flat(), 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  addGeo(b, g, { color, metal: material });
}

function cordon(b, puntos, radio, color, material = 0, cerrado = false, lados = 5) {
  const trayectoria = new THREE.CatmullRomCurve3(puntos.map(p => new THREE.Vector3(...p)), cerrado);
  addGeo(b, new THREE.TubeGeometry(trayectoria, Math.max(puntos.length + 2, 12), radio, lados, cerrado),
    { color, metal: material });
}

// Cuatro paños rectos unidos por esquinas de radio fijo. Las costuras y las cintas siguen este mismo patrón.
function contorno(y, hx, hz, radio, pliegue = 0) {
  const puntos = [];
  for (let k = 0; k < 4; k++) {
    const a = k * Math.PI / 2;
    const cx = k === 0 || k === 3 ? hx - radio : radio - hx;
    const cz = k < 2 ? hz - radio : radio - hz;
    for (let i = 0; i <= 5; i++) {
      const angulo = a + Math.PI * i / 10;
      puntos.push([centroX + cx + radio * Math.cos(angulo), y, cz + radio * Math.sin(angulo)]);
    }
    const [x0, , z0] = puntos.at(-1);
    const x1 = k === 0 ? centroX - hx + radio : k === 2 ? centroX + hx - radio : x0;
    const z1 = k === 1 ? radio - hz : k === 3 ? hz - radio : z0;
    for (let i = 1; i < 6; i++) {
      const t = i / 6;
      const arruga = Math.sin(t * Math.PI) * Math.sin(t * Math.PI * 2 + k * 1.8) * pliegue;
      puntos.push([x0 + (x1 - x0) * t + (k % 2 ? arruga : 0), y,
        z0 + (z1 - z0) * t + (k % 2 ? 0 : arruga)]);
    }
  }
  return puntos;
}

function volumenDeLona(b, secciones, color, material) {
  const filas = secciones.map(s => contorno(...s));
  const puntos = filas.flat(), n = filas[0].length, indices = [];
  for (let k = 1; k < filas.length; k++) {
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, p = (k - 1) * n, q = k * n;
      indices.push(p + i, q + i, q + j, p + i, q + j, p + j);
    }
  }
  for (const k of [0, filas.length - 1]) {
    const centro = puntos.push([centroX, secciones[k][0], 0]) - 1;
    for (let i = 0; i < n; i++) {
      const a = k * n + i, c = k * n + (i + 1) % n;
      if (k === 0) indices.push(centro, a, c);
      else indices.push(centro, c, a);
    }
  }
  malla(b, puntos, indices, color, material);
}

function parrilla(b) {
  cordon(b, contorno(.972, .203, .175, .052), .009, carbon, metal, true, 8);
  for (const x of [-.891, -.80, -.70, -.60]) {
    tube(b, [x, .973, -.17], [x, .973, .17], .008, 8, { color: carbon, metal });
  }
  for (const lado of [-1, 1]) {
    cordon(b, [[-.922, .971, .126 * lado], [-.859, .915, .134 * lado], [-.704, .824, .146 * lado],
      [-.567, .707, .123 * lado], [-.481, .656, .105 * lado]], .009, carbon, metal, false, 8);
    tube(b, [-.58, .971, .15 * lado], [-.48, .835, .117 * lado], .008, 8, { color: carbon, metal });
    // El perno lateral sujeta el tirante al chasis.
    tube(b, [-.484, .661, .098 * lado], [-.484, .661, .113 * lado], .014, 6, { color: acero, metal });
  }
  addGeo(b, new RoundedBoxGeometry(.382, .028, .341, 2, .01), {
    position: [centroX, .989, 0], color: nylon, metal: goma
  });
}

function maleta(b) {
  volumenDeLona(b, [
    [.997,.176,.184,.032], [1.004,.197,.199,.040], [1.028,.207,.212,.045],
    [1.074,.212,.219,.049,.005], [1.124,.216,.224,.050,-.005], [1.174,.214,.225,.055,.006],
    [1.237,.217,.227,.053,-.005], [1.284,.211,.221,.051,.003], [1.313,.204,.215,.048]
  ], (x, y, z) => {
    const jaspe = .82 + .09 * Math.sin(27 * x + 19 * y) * Math.cos(35 * z - 19 * y);
    return [jaspe, jaspe, jaspe];
  }, tela);
  volumenDeLona(b, [
    [1.000,.183,.188,.032], [1.005,.201,.203,.040], [1.032,.210,.215,.046], [1.052,.211,.217,.047]
  ], nylon, 0);
  cordon(b, contorno(1.052, .211, .218, .047), .0028, canto, 0, true);

  // La tapa cae por delante de la cremallera y se aplasta un poco hacia la manija.
  volumenDeLona(b, [
    [1.298,.210,.221,.045], [1.309,.219,.229,.048], [1.339,.221,.231,.052],
    [1.366,.215,.223,.053], [1.381,.193,.203,.052], [1.389,.147,.157,.047],
    [1.391,.042,.048,.018]
  ], [.81, .82, .80], tela);
  cordon(b, contorno(1.312, .220, .230, .049), .0045, nylon, 0, true, 7);
  cordon(b, contorno(1.370, .209, .219, .052), .0024, canto, 0, true);
  cordon(b, contorno(1.301, .211, .222, .048), .0018, acero, metal, true);

  // Dos bolsillos abombados, con una pinza en el fuelle y el ribete reflectivo cosido al paño.
  const costado = (u, v) => {
    const forma = Math.sin(Math.PI * u) * Math.sin(Math.PI * v);
    return [centroX + (u - .5) * (.325 - .018 * Math.cos(v * Math.PI)),
      1.063 + v * .182 - .009 * Math.sin(Math.PI * u), .212 + .024 * forma + .012 * v];
  };
  addGrid(b, 12, 8, (i, j) => costado(i / 12, j / 8),
    { color: [.65, .66, .63], metal: tela, out: [0, 0, 1] });
  for (const lado of [-1, 1]) {
    const contornoBolsillo = [];
    for (const [u, v] of [[.016,.99],[.012,.82],[.017,.40],[.035,.15],[.10,.035],[.25,.017],[.52,.007],
      [.82,.018],[.95,.064],[.983,.22],[.99,.64],[.985,.985]]) {
      const [x,y,z] = costado(u, v);
      contornoBolsillo.push([x,y,(z + .0015) * lado]);
    }
    cordon(b, contornoBolsillo, .0028, canto);
  }
  // Solapa superior más oscura, con puntada y bordes enrollados.
  addGrid(b, 12, 3, (i, j) => {
    const u = i / 12, v = j / 3;
    return [centroX + (u - .5) * .349, 1.209 + .056 * v - .010 * Math.sin(Math.PI * u),
      .219 + .010 * Math.sin(Math.PI * u) + .014 * (1 - v)];
  }, { out: [0, .1, 1], color: [.46, .46, .45], metal: tela });
  const cinta = (i, j) => {
    const u = i / 10, v = .42 + .12 * j;
    const [x, y, z] = costado(.055 + .89 * u, v);
    return [x, y, z + .0013];
  };
  addGrid(b, 10, 1, cinta, { out: [0, 0, 1], color: plata, metal: .28 });
  for (let i = 0; i < 22; i++) {
    addGrid(b, 1, 1, (s,t) => {
      const u = .063 + .87 * (i + .60 * s) / 22, v = .404 + .006 * t;
      const [x,y,z] = costado(u,v);
      return [x,y,z+.0017];
    }, { out: [0,0,1], color: hilo });
  }
  // Las correas cierran sobre la cara trasera; cada una pasa por el seno abierto de su hebilla.
  for (const z of [-.113, .113]) {
    const perfil = [[-.933,1.037],[-.954,1.08],[-.958,1.175],[-.957,1.264],[-.961,1.324],
      [-.959,1.351],[-.945,1.371],[-.915,1.382],[-.855,1.388]];
    addGrid(b, perfil.length - 1, 1, (i,j) => [perfil[i][0],perfil[i][1],z + (j-.5)*.031],
      { color: nylon, mirror: false, out: [-1, .2, 0] });
    const ic = -.962;
    const broche = [[ic,1.198,z-.016],[ic,1.199,z+.016],[ic,1.192,z+.021],[ic,1.173,z+.021],
      [ic,1.168,z+.015],[ic,1.168,z-.015],[ic,1.173,z-.021],[ic,1.192,z-.021]];
    cordon(b, broche, .0034, acero, metal, true, 6);
    tube(b, [ic-.0007,1.182,z-.020], [ic-.0007,1.182,z+.020], .0027, 6, { color: acero, metal });
  }
  // Asa de cinta de nylon doblada sobre dos refuerzos de lona.
  for (const x of [-.838, -.642]) {
    addGeo(b, new RoundedBoxGeometry(.058,.005,.052,1,.002),
      { position: [x,1.391,0], color: nylon });
  }
  const asa = [[-.853,1.394],[-.827,1.398],[-.807,1.421],[-.785,1.437],
    [-.744,1.444],[-.703,1.438],[-.678,1.419],[-.655,1.396],[-.630,1.394]];
  for (const cara of [-1,1]) {
    addGrid(b, asa.length-1, 2, (i,j) => [asa[i][0],asa[i][1] + (j===1?.002:0) + cara*.0018,(j-1)*.015],
      { color: cara===1?canto:nylon, mirror:false, out:[0,cara,0] });
  }
  // Cursor y tirador flexible en el costado de la mano derecha.
  box(b, [.014,.009,.01], [-.849,1.305,.225], { color: acero, metal });
  cordon(b, [[-.848,1.303,.231],[-.856,1.286,.233],[-.865,1.272,.231],
    [-.874,1.271,.230],[-.866,1.288,.230],[-.850,1.305,.230]], .0019, nylon);
}

const perfilCasco = [
  [-.092,.102,-.076,.079],[-.071,.129,-.106,.096],[-.043,.141,-.122,.104],
  [-.023,.146,-.128,.106],[.004,.143,-.129,.108],[.039,.137,-.123,.108],
  [.060,.126,-.114,.104],[.085,.104,-.099,.090],[.106,.075,-.074,.064],
  [.118,.039,-.039,.034],[.121,.010,-.010,.009]
];
const giro = -.48, cs = Math.cos(giro), sn = Math.sin(giro), limiteVisor = 3 * Math.PI / 8;
function puntoCasco(angulo, fila, separacion = 0) {
  const [y, frente, atras, ancho] = perfilCasco[fila];
  const c = Math.cos(angulo), s = Math.sin(angulo), radio = (frente - atras) / 2;
  const x = (frente + atras) / 2 + (radio + separacion) * c;
  const z = (ancho + separacion) * s;
  // El visor tiene forma de ceja: se ensancha hacia la nariz y se estrecha a la altura de los pivotes.
  const altura = y + (fila === 3 ? -.010 : fila === 6 ? .009 : 0) * Math.max(0, c);
  return [.292 + cs * x + sn * z, .897 + altura, .230 - sn * x + cs * z];
}

function casco(b) {
  const divisiones = 48, corte = 9;
  const puntos = [], indices = [];
  const vertices = new Int32Array(divisiones * perfilCasco.length).fill(-1);
  const angulo = i => i * Math.PI * 2 / divisiones;
  function vertice(k, i) {
    const id = k * divisiones + i;
    if (vertices[id] === -1) vertices[id] = puntos.push(puntoCasco(angulo(i), k)) - 1;
    return vertices[id];
  }
  for (let k = 0; k < perfilCasco.length - 1; k++) {
    for (let i = 0; i < divisiones; i++) {
      if (k >= 3 && k < 6 && (i < corte || i >= divisiones - corte)) continue;
      const j = (i + 1) % divisiones;
      const a = vertice(k, i), d = vertice(k + 1, i), c = vertice(k + 1, j);
      indices.push(a, d, c, a, c, vertice(k, j));
    }
  }
  const ultimaFila = perfilCasco.length - 1, cima = puntos.push([.292, 1.019, .230]) - 1;
  for (let i = 0; i < divisiones; i++) indices.push(cima, vertice(ultimaFila, (i + 1) % divisiones), vertice(ultimaFila, i));
  malla(b, puntos, indices, rgb('#454949'));
  const izquierda = puntoCasco(-limiteVisor, 4), derecha = puntoCasco(limiteVisor, 4);
  const frente = puntoCasco(0, 4);
  addGrid(b, 24, 3, (i,j) => puntoCasco(-limiteVisor + i * limiteVisor / 12, 3+j,.0039),
    { color: (_u,v) => {
      const brillo = .015 + .045 * (1-v) + .032 * Math.exp(-(((v-.58)/.18)**2));
      return [brillo*.79,brillo*.96,brillo*1.16];
    }, metal: .3, mirror: false, out: [frente[0]-.292, 0, frente[2]-.230] });
  // Junta del visor y pequeñas bisagras de grafito.
  const junta = [];
  for (let i=0; i<=18; i++) junta.push(puntoCasco(-limiteVisor+i*limiteVisor/9,6,.0023));
  for (let k=5; k>=3; k--) junta.push(puntoCasco(limiteVisor,k,.0023));
  for (let i=17; i>=0; i--) junta.push(puntoCasco(-limiteVisor+i*limiteVisor/9,3,.0023));
  for (let k=4; k<=5; k++) junta.push(puntoCasco(-limiteVisor,k,.0023));
  cordon(b,junta,.0027,nylon,0,true,6);
  for (const [signo, pos] of [[-1,izquierda],[1,derecha]]) {
    tube(b, pos, puntoCasco(signo*limiteVisor,4,.0065), .012, 12, { color: carbon });
    tube(b, puntoCasco(signo*limiteVisor,4,.0065), puntoCasco(signo*limiteVisor,4,.0075),
      .0048, 8, { color: acero, metal });
  }
  // Mentonera con tres tomas de aire y una protección de caucho alrededor del hueco inferior.
  for (const offset of [-.38,0,.38]) {
    addGrid(b, 4, 1, (i,j) => {
      const t = offset + (i/4-.5)*.23, a = puntoCasco(t,1,.0021), c = puntoCasco(t,2,.0021);
      return a.map((n,k) => n + (c[k]-n) * (.4 + .26*j));
    }, { color: COLOR.dark, mirror:false, out:[cs,0,-sn] });
  }
  const borde = Array.from({length:32},(_,i) => puntoCasco(i*Math.PI/16,0,-.001));
  cordon(b,borde,.0045,nylon,goma,true,6);
  const [x,y,z] = [.292,.897+perfilCasco[0][0],.230];
  const forro = [...borde, ...borde.map(([px,py,pz]) => [x+(px-x)*.73,py+.015,z+(pz-z)*.73]),
    [x,y+.044,z]];
  const interior = [];
  for (let i=0; i<borde.length; i++) {
    const j=(i+1)%borde.length, n=borde.length;
    interior.push(i,j,n+j,i,n+j,n+i,n+i,n+j,2*n);
  }
  malla(b,forro,interior,COLOR.dark);
  cordon(b,[[.351,1.051,.244],[.34,1.058,.251],[.317,1.039,.253],[.291,1.003,.245]],
    .0041,nylon,0,false,6);
}

export function llenarKitReparto(b) {
  parrilla(b);
  maleta(b);
  casco(b);
}
