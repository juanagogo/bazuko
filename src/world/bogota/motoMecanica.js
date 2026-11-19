// Monocilíndrica refrigerada por aire. Todo se incorpora al lote de la moto.
import * as THREE from 'three';
import { addGeo, bar, tube } from './carParts.js';

const color = hex => new THREE.Color(hex).toArray();
const METAL = .3;
const bastidor = color('#242c2d'), hierro = color('#414746'), cilindro = color('#424947');
const aluminio = color('#969b93'), torneado = color('#c1c1b3'), acero = color('#858d8e');
const pavonado = color('#454d50'), inox = color('#bfc2bd'), goma = color('#252726');
const bronce = color('#9a8368'), laton = color('#a68d56'), aceite = color('#503b25');
const tau = Math.PI * 2;
const vertical = new THREE.Vector3(0, 1, 0);
const vec = p => new THREE.Vector3(...p);

function recorrido(b, puntos, radio, tono, tramos, lados = 10, mascara = METAL) {
  const curva = new THREE.CatmullRomCurve3(puntos.map(vec));
  addGeo(b, new THREE.TubeGeometry(curva, tramos, radio, lados, false), { color: tono, metal: mascara });
}

function piezaTorneada(b, desde, hasta, perfil, tono, lados = 24) {
  const direccion = vec(hasta).sub(vec(desde)).normalize();
  const g = new THREE.LatheGeometry(perfil.map(([r, y]) => new THREE.Vector2(r, y)), lados);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(vertical, direccion));
  addGeo(b, g, { position: desde, color: tono, metal: METAL });
}

// Contorno fundido con esquinas suaves. El plano del dibujo es el lateral de la moto (X,Y).
function contornoRedondo(puntos) {
  const s = new THREE.Shape();
  const primero = puntos[0], ultimo = puntos[puntos.length - 1];
  s.moveTo((primero[0] + ultimo[0]) / 2, (primero[1] + ultimo[1]) / 2);
  puntos.forEach(([x, y], i) => {
    const sig = puntos[(i + 1) % puntos.length];
    s.quadraticCurveTo(x, y, (x + sig[0]) / 2, (y + sig[1]) / 2);
  });
  s.closePath();
  return s;
}

function fundicion(b, figura, z, profundidad, bisel, tono, pose = {}) {
  const g = new THREE.ExtrudeGeometry(figura, {
    depth: profundidad, bevelEnabled: true, bevelSize: bisel, bevelThickness: bisel,
    bevelSegments: 2, curveSegments: 4, steps: 1
  });
  g.translate(0, 0, z);
  addGeo(b, g, { color: tono, metal: METAL, ...pose });
}

function tornillo(b, x, y, z, lado, radio = .0075) {
  const extremo = z + lado * .005;
  tube(b, [x, y, z], [x, y, extremo], radio, 6, { color: inox, metal: METAL });
  tube(b, [x, y, extremo], [x, y, extremo + lado * .0006], radio * .43, 6, { color: pavonado, metal: METAL });
}

const angulo = .23, sen = Math.sin(angulo), cos = Math.cos(angulo);
// Coordenadas en el cilindro inclinado hacia la rueda delantera, alrededor de su pie.
const enMotor = (x, h, z) => [.041 + x * cos + h * sen, .429 - x * sen + h * cos, z];
const normalMotor = (x, y, z) => [x * cos + y * sen, -x * sen + y * cos, z];

function aleta(b, h, rx, rz, grosor, borde, tonoFrente = torneado) {
  // Las entradas para los espárragos parten el contorno de la fundición. El canto sale fresado en plata.
  const lados = 40;
  const perfil = Array.from({ length: lados }, (_, i) => {
    const a = tau * i / lados, x = Math.cos(a), z = Math.sin(a);
    const muesca = .91 + .09 * (1 - Math.exp(-((Math.abs(x) - .64) ** 2) / .007));
    return [Math.sign(x) * Math.abs(x) ** .66 * rx * muesca, Math.sign(z) * Math.abs(z) ** .66 * rz * muesca];
  });
  const anillos = [[h, .945], [h + borde, 1], [h + grosor - borde, 1], [h + grosor, .945]];
  for (let k = 0; k < anillos.length - 1; k++) {
    const [y0, s0] = anillos[k], [y1, s1] = anillos[k + 1];
    const bandas = perfil.map(([x, z], i) => {
      const antes = perfil[(i + lados - 1) % lados], despues = perfil[(i + 1) % lados];
      const dx = despues[0] - antes[0], dz = despues[1] - antes[1];
      const nx = dz / Math.hypot(dx, dz), nz = -dx / Math.hypot(dx, dz);
      const ny = Math.hypot(x, z) * (s0 - s1) / (y1 - y0), longitud = Math.hypot(1, ny);
      const n = normalMotor(nx / longitud, ny / longitud, nz / longitud);
      const tono = k === 1 ? tonoFrente : aluminio;
      return [[s0, y0], [s1, y1]].map(([s, y]) =>
        b.v(...enMotor(x * s, y, z * s), ...n, undefined, undefined, ...tono, METAL));
    });
    bandas.forEach(([abajo, arriba], i) => {
      const sig = bandas[(i + 1) % lados];
      b.quad(abajo, arriba, sig[1], sig[0]);
    });
  }
  for (const [y, lado] of [[h, -1], [h + grosor, 1]]) {
    const n = normalMotor(0, lado, 0);
    const centro = b.v(...enMotor(0, y, 0), ...n, undefined, undefined, ...hierro, METAL);
    const aro = perfil.map(([x, z]) => b.v(...enMotor(x * .945, y, z * .945), ...n, undefined, undefined, ...cilindro, METAL));
    aro.forEach((p, i) => {
      const sig = aro[(i + 1) % lados];
      if (lado > 0) b.tri(centro, sig, p);
      else b.tri(centro, p, sig);
    });
  }
}

function bloqueMotor(b) {
  const contorno = [[-.202,.338],[-.19,.432],[-.125,.494],[-.015,.492],[.041,.518],
    [.161,.497],[.205,.417],[.183,.318],[.112,.262],[-.038,.244],[-.154,.27]];
  fundicion(b, contornoRedondo(contorno), -.092, .184, .013, hierro);
  // La unión del semicárter se lee por delante del motor y por debajo.
  fundicion(b, contornoRedondo(contorno), -.003, .003, .015, pavonado);

  for (const lado of [-1, 1]) {
    const x = lado > 0 ? .033 : .001, y = .365, z = .097 * lado;
    const radio = lado > 0 ? .107 : .099;
    piezaTorneada(b, [x,y,z], [x,y,lado], [
      [radio * 1.12,0],[radio * 1.12,.007],[radio * 1.04,.013],[radio * 1.03,.023],
      [radio * .92,.038],[radio * .74,.045],[0,.045]
    ], aluminio, 36);
    const cara = z + .045 * lado;
    piezaTorneada(b, [x,y,cara], [x,y,lado], [
      [radio * .65,0],[radio * .65,.003],[radio * .61,.005],[radio * .53,.005],[radio * .50,.002]
    ], pavonado, 32);
    piezaTorneada(b, [x,y,cara], [x,y,lado], [[.018,0],[.018,.003],[.015,.006],[0,.006]], acero, 24);
    for (let i = 0; i < 6; i++) {
      const a = tau * (i + .33) / 6;
      tornillo(b, x + radio * 1.035 * Math.cos(a), y + radio * 1.035 * Math.sin(a), z + .014 * lado, lado);
    }
  }
  // Tapón de aceite y mirilla de nivel en el lado del embrague.
  piezaTorneada(b, [.123,.426,.116], [.18,.53,.23], [[.019,0],[.019,.011],[.016,.015],[0,.015]], hierro, 10);
  piezaTorneada(b, [.135,.333,.111], [.135,.333,.20], [[.014,0],[.014,.008],[.011,.008]], inox, 20);
  piezaTorneada(b, [.135,.333,.111], [.135,.333,.20], [[.011,.007],[0,.007]], aceite, 20);
  tube(b, enMotor(0, .002, 0), enMotor(0, .255, 0), .082, 24, { color: cilindro, metal: METAL });

  for (let i = 0; i < 8; i++) {
    const ancho = .097 + .017 * Math.sin((i + 1) * Math.PI / 11);
    aleta(b, .031 + i * .019, ancho, ancho * 1.06, .0068, .0017);
  }
  for (const h of [.186, .207, .229]) aleta(b, h, .113, .122, .011, .0023);
  aleta(b, .246, .108, .116, .035, .006, aluminio);
  aleta(b, .276, .091, .101, .017, .005, hierro);
  for (const x of [-.064, .063]) for (const z of [-.071, .071]) {
    tube(b, enMotor(x,.027,z), enMotor(x,.272,z), .005, 8, { color: pavonado, metal: METAL });
    tube(b, enMotor(x,.281,z), enMotor(x,.297,z), .009, 6, { color: acero, metal: METAL });
  }
  // Bujía lateral, aislante cerámico y capuchón con el cable que sube hasta la bobina.
  const bujia = enMotor(.017,.252,.099);
  piezaTorneada(b, bujia, [.145,.725,.143], [
    [.012,0],[.012,.012],[.009,.014],[.009,.030],[.007,.033]
  ], color('#b0aaa0'), 12);
  recorrido(b,[bujia,[.12,.705,.12],[.125,.732,.132],[.083,.762,.128],[-.009,.764,.084]],.008,goma,17,8,0);
  // El carburador tiene cuba, tapa, abrazaderas y un manguito al filtro bajo el sillín.
  recorrido(b,[[-.235,.672,0],[-.148,.655,0],[-.083,.641,0],[-.02,.644,0],[.026,.653,0]],.039,goma,16,14,0);
  piezaTorneada(b,[-.085,.64,0],[.055,.64,0],[[.041,0],[.044,.008],[.042,.018],[.037,.032],[.039,.066]], aluminio);
  piezaTorneada(b,[-.054,.59,.012],[-.054,.687,.012],[[.012,0],[.031,.006],[.035,.018],[.032,.04],[.032,.072],[.033,.08],[0,.081]], aluminio,18);
  for (const x of [-.139,-.018]) tube(b,[x-.003,.646,0],[x+.004,.646,0],.041,18,{color:inox,metal:METAL});
  recorrido(b,[[-.055,.671,.030],[-.069,.697,.046],[-.137,.727,.073],[-.134,.79,.050]],.004,goma,12,6,0);
}

function amortiguador(b, lado) {
  const base = vec([-.597,.324,lado*.108]), cabeza = vec([-.438,.766,lado*.115]);
  const eje = cabeza.clone().sub(base).normalize();
  const longitudinal = cabeza.distanceTo(base);
  const radial = new THREE.Vector3(0,0,1).cross(eje).normalize();
  const transversal = eje.clone().cross(radial).normalize();
  const punto = d => base.clone().addScaledVector(eje,d).toArray();
  tube(b,punto(0),punto(longitudinal),.013,12,{color:inox,metal:METAL});
  piezaTorneada(b,punto(.045),punto(.16),[[.024,0],[.028,.008],[.028,.112],[.029,.117],[.029,.134]],pavonado);
  for (const d of [.116, longitudinal-.062]) {
    piezaTorneada(b,punto(d),punto(d+.01),[[.029,0],[.041,.004],[.041,.012],[.032,.014]],acero,20);
  }
  const vueltas = 8.2, inicio = .126, fin = longitudinal - .058;
  const helice = new THREE.Curve();
  helice.getPoint = (t, destino = new THREE.Vector3()) => {
    const fase = tau * vueltas * t;
    return destino.copy(base).addScaledVector(eje, inicio + t*(fin-inicio))
      .addScaledVector(radial, .0325 * Math.cos(fase)).addScaledVector(transversal, .0325 * Math.sin(fase));
  };
  addGeo(b,new THREE.TubeGeometry(helice,100,.0062,7,false),{color:acero,metal:METAL});
  for (const ojo of [base,cabeza]) {
    const [x,y,z] = ojo.toArray();
    tube(b,[x,y,z-.016],[x,y,z+.016],.023,16,{color:pavonado,metal:METAL});
    tornillo(b,x,y,z+lado*.017,lado,.012);
  }
}

function cuadro(b) {
  for (const lado of [-1,1]) {
    const p = (x,y,z) => [x,y,z*lado];
    recorrido(b,[p(.392,.89,.032),p(.356,.755,.052),p(.288,.535,.074),p(.253,.312,.085),
      p(.20,.247,.091),p(.099,.219,.093),p(-.079,.223,.090),p(-.155,.265,.087),p(-.166,.406,.079)],
    .0195,bastidor,40);
    recorrido(b,[p(.392,.89,.032),p(.231,.866,.041),p(-.015,.792,.073),p(-.119,.654,.085),p(-.166,.406,.079)],
      .021,bastidor,28);
    recorrido(b,[p(-.166,.406,.079),p(-.269,.524,.101),p(-.434,.752,.110),p(-.488,.817,.112),p(-.804,.839,.099)],
      .016,bastidor,26);
    recorrido(b,[p(-.092,.794,.075),p(-.284,.792,.104),p(-.488,.817,.112)],.019,bastidor,14);
    // El basculante se abre alrededor del neumático y la pletina de atrás recibe el eje.
    bar(b,p(-.143,.397,.073),p(-.590,.305,.096),.041,.028,{color:hierro,metal:METAL});
    bar(b,p(-.586,.306,.096),p(-.672,.300,.097),.032,.026,{color:hierro,metal:METAL});
    tube(b,p(-.67,.30,.086),p(-.67,.30,.112),.021,16,{color:acero,metal:METAL});
    tornillo(b,-.663,.30,lado*.116,lado,.012);
    amortiguador(b,lado);
    // Pletina de la estribera y su bisagra para el pasajero.
    recorrido(b,[p(-.299,.608,.092),p(-.348,.510,.117),p(-.399,.477,.142)],.011,pavonado,12,8);
    tube(b,p(-.392,.477,.136),p(-.434,.493,.191),.012,12,{color:goma});
    tube(b,p(-.108,.329,.100),p(-.108,.329,.173),.013,12,{color:acero,metal:METAL});
    tube(b,p(-.108,.329,.169),p(-.108,.329,.238),.018,12,{color:goma});
    for (let i=0;i<6;i++) {
      const z=.175+i*.011;
      tube(b,p(-.108,.329,z),p(-.108,.329,z+.004),.0194,12,{color:hierro});
    }
  }
  tube(b,[-.149,.401,-.087],[-.149,.401,.089],.029,16,{color:bastidor,metal:METAL});
  recorrido(b,[[-.806,.839,-.099],[-.851,.846,-.061],[-.857,.846,0],[-.851,.846,.061],[-.806,.839,.099]],.014,bastidor,18,8);
  // Palanca de cambios, pedal de freno y pata lateral abatible.
  for (const lado of [-1,1]) {
    recorrido(b,[[-.118,.34,lado*.137],[-.092,.318,lado*.164],[.026,.317,lado*.175],[.059,.337,lado*.180]],.0075,acero,13,8);
    tube(b,[.059,.337,lado*.178],[.059,.337,lado*.219],.011,12,{color:goma});
  }
  recorrido(b,[[-.112,.286,-.091],[-.134,.248,-.119],[-.191,.058,-.202],[-.217,.010,-.209]],.011,pavonado,14,8);
  fundicion(b,contornoRedondo([[-.245,.007],[-.247,.013],[-.211,.016],[-.192,.011],[-.194,.005]]),-.226,.034,.0015,pavonado);
}

function escape(b) {
  const salida = [.202,.646,.034], silencioso = [-.25,.276,.170], cola = [-.809,.424,.176];
  // Colector de sección continua y pasador de la brida contra el puerto de escape.
  const colector = [salida,[.263,.627,.050],[.295,.578,.066],[.299,.509,.079],[.279,.388,.116],
    [.257,.275,.134],[.211,.240,.15],[.134,.228,.159],[-.020,.235,.163],[-.18,.260,.168],silencioso];
  recorrido(b, colector, .0265, bronce, 54, 16);
  piezaTorneada(b, salida, [.299,.613,.067], [[.039,0],[.042,.004],[.040,.010],[.030,.015]], aluminio);
  for (const z of [.011,.060]) {
    tube(b,[.200,.648,z],[.215,.643,z+.004],.0067,6,{color:inox,metal:METAL});
  }
  const largo = vec(cola).distanceTo(vec(silencioso));
  piezaTorneada(b, silencioso, cola, [[.027,0],[.033,.013],[.033,.037],[.056,.086],[.064,.129],
    [.066,largo-.067],[.063,largo-.037],[.055,largo-.012],[.050,largo],[.037,largo],[.032,largo-.012]], pavonado, 36);
  const eje = vec(cola).sub(vec(silencioso)).normalize(), base = vec(silencioso);
  const punto = d => base.clone().addScaledVector(eje,d).toArray();
  // La boca se hunde en la doble pared. El fondo oscuro impide ver el lado opuesto del silenciador.
  piezaTorneada(b, punto(largo-.030), cola, [[.032,0],[.032,.029],[.036,.031],[.039,.030]], hierro, 28);
  tube(b,punto(largo-.032),punto(largo-.031),.032,28,{color:goma});
  for (const d of [.128,largo-.068]) {
    piezaTorneada(b,punto(d),cola,[[.064,0],[.067,.002],[.067,.008],[.064,.010]],acero,32);
  }
  // Protector de aluminio perforado. Cada abertura atraviesa ambas caras.
  const proteccion = contornoRedondo([[-.189,-.024],[-.189,.020],[-.162,.040],[.147,.041],
    [.178,.025],[.188,-.009],[.147,-.031],[-.153,-.033]]);
  for (let i=0;i<6;i++) {
    const ranura = new THREE.Path();
    ranura.absellipse(-.128+i*.049,.006,.007,.019,-.48,Math.PI*2-.48,false,-.60);
    proteccion.holes.push(ranura);
  }
  const anclaje = [-.543,.357,.238];
  fundicion(b,proteccion,0,.003,.0023,inox,{rotation:[0,0,-.24],position:anclaje});
  for (const [x,y] of [[-.714,.402],[-.370,.322]]) {
    tube(b,[x,y,.211],[x,y,.240],.009,12,{color:pavonado,metal:METAL});
    tornillo(b,x,y,.242,1,.007);
  }
  bar(b,[-.475,.442,.170],[-.401,.510,.119],.019,.011,{color:bastidor,metal:METAL});
}

function transmision(b) {
  // Tangentes exteriores entre la corona de la rueda y el piñón del motor.
  const trasera = { x: -.66, y: .30, r: .098 }, motriz = { x: -.146, y: .397, r: .043 };
  const z = -.070, dx = motriz.x - trasera.x, dy = motriz.y - trasera.y;
  const eje = Math.atan2(dy, dx);
  const tangente = Math.acos((trasera.r - motriz.r) / Math.hypot(dx, dy));
  const arriba = eje + tangente, abajo = eje - tangente;
  const sobre = (c, a) => [c.x + c.r * Math.cos(a), c.y + c.r * Math.sin(a)];
  const trasArr = sobre(trasera, arriba), trasAb = sobre(trasera, abajo);
  const motArr = sobre(motriz, arriba), motAb = sobre(motriz, abajo);
  const tramo = Math.hypot(motArr[0] - trasArr[0], motArr[1] - trasArr[1]);
  const arcoM = motriz.r * (2 * tangente), arcoT = trasera.r * (tau - 2 * tangente);
  const longitud = 2 * tramo + arcoM + arcoT;
  const interp = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
  function punto(s) {
    if (s < tramo) return interp(trasArr, motArr, s / tramo);
    s -= tramo;
    if (s < arcoM) return sobre(motriz, arriba - s / motriz.r);
    s -= arcoM;
    if (s < tramo) return interp(motAb, trasAb, s / tramo);
    return sobre(trasera, abajo - (s - tramo) / trasera.r);
  }
  tube(b, [motriz.x,motriz.y,z-.005], [motriz.x,motriz.y,z+.005], motriz.r, 30, { color: pavonado, metal: METAL });
  tornillo(b, motriz.x, motriz.y, z-.005, -1, .013);
  // Un eslabón exterior alterna con uno interior; un pasador común atraviesa las dos platinas.
  const eslabones = Math.round(longitud / .032) * 2;
  const puntos = Array.from({ length: eslabones }, (_, i) => punto(longitud * i / eslabones));
  for (let i = 0; i < eslabones; i++) {
    const p = puntos[i], q = puntos[(i + 1) % eslabones], exterior = i % 2 === 0;
    const l = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const tx = (q[0] - p[0]) / l, ty = (q[1] - p[1]) / l;
    const mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2;
    const perfil=[[-l/2-.003,0],[-l/2,-.0051],[0,-.0033],[l/2,-.0051],[l/2+.003,0],[l/2,.0051],[0,.0033],[-l/2,.0051]];
    for (const lado of [-1, 1]) {
      const plano = z + lado * (exterior ? .0069 : .0048), tono = exterior ? laton : acero;
      const vertices = perfil.map(([u,v]) => b.v(
        mx + u * tx - v * ty, my + u * ty + v * tx, plano, 0, 0, lado, undefined, undefined, ...tono, METAL
      ));
      for (let j = 1; j < vertices.length - 1; j++) {
        if (lado > 0) b.tri(vertices[0], vertices[j], vertices[j + 1]);
        else b.tri(vertices[0], vertices[j + 1], vertices[j]);
      }
    }
    tube(b, [p[0],p[1],z-.0082], [p[0],p[1],z+.0082], .0031, 6, { color: acero, metal: METAL });
  }
}

export function mecanicaMoto(b) {
  cuadro(b);
  bloqueMotor(b);
  escape(b);
  transmision(b);
}
