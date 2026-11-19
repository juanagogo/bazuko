import * as THREE from 'three';
import { addGeo, addGrid, box, tube } from './carParts.js';
import { curve, lerp } from './carLoft.js';

const color = hex => new THREE.Color(hex).toArray();
const hielo = color('#a6aaa9'), negro = color('#202328'), goma = color('#191a1e');
const asiento = color('#26272a'), costura = color('#53545a'), aluminio = color('#727982');
const rojo = color('#a01820'), diodo = color('#e43c38'), metal = .3, pintura = .94, vinilo = .018;
const PI = Math.PI;

// Planta y altura medidas en el perfil lateral. Las secciones anchas del pasajero
// se estrechan en el valle y vuelven a cerrar contra los laterales del tanque.
function secciones(filas, perfil) {
  const [base, cima, ancho] = [1, 2, 3].map(k => curve(filas.map(p => [p[0], p[k]])));
  return (x, t) => {
    const lado = Math.min(perfil.length - 2, Math.floor(t));
    const a = perfil[lado], c = perfil[lado + 1], d = t - lado;
    return [x, lerp(base(x), cima(x), lerp(a[1], c[1], d)), ancho(x) * lerp(a[0], c[0], d)];
  };
}

function cerrar(b, filas, perfil, tono, superficie, seccion, tapizado = false) {
  const ini = filas[0][0], fin = filas.at(-1)[0];
  const nx = tapizado ? 174 : 72, ny = (perfil.length - 1) * (tapizado ? 5 : 1);
  const grano = (i, j) => {
    let h = Math.imul(i + 7907, 1597334677) ^ Math.imul(j + 4111, 3812015801);
    h = Math.imul(h ^ h >>> 16, 2246822519);
    return ((h ^ h >>> 13) >>> 0) / 4294967295;
  };
  addGrid(b, nx, ny, (i, j) => {
    const p = seccion(lerp(ini, fin, i / nx), j * (perfil.length - 1) / ny);
    if (tapizado && i > 0 && i < nx && j > 0 && j < ny) {
      const veta = (grano(i, j) - .5) * .00018, v = j / ny;
      p[1] += veta * Math.cos(v * PI);
      p[2] += veta * Math.sin(v * PI);
    }
    return p;
  }, { color: tapizado ? (u,v) => {
    const tacto = .92 + .15 * grano(Math.round(u*nx), Math.round(v*ny)) - .09 * Math.sin(v*PI);
    return tono.map(c => c * tacto);
  } : tono, metal: superficie, out: [0, 0, 1] });
  for (const [x, lado] of [[ini, -1], [fin, 1]]) {
    const contorno = perfil.map((p, i) => seccion(x, i));
    contorno.push(...contorno.slice(1,-1).reverse().map(([px,y,z]) => [px,y,-z]));
    const anillo = contorno.map(p => b.v(...p, lado, 0, 0, undefined, undefined, ...tono, superficie));
    for (let i = 1; i < anillo.length - 1; i++) {
      if (lado > 0) b.tri(anillo[0], anillo[i], anillo[i+1]);
      else b.tri(anillo[0], anillo[i+1], anillo[i]);
    }
  }
}

function cordon(b, puntos, r, tono, mascara, espejo = false, segmentos = 34) {
  const camino = new THREE.CatmullRomCurve3(puntos.map(p => new THREE.Vector3(...p)));
  addGeo(b, new THREE.TubeGeometry(camino, segmentos, r, 8, false), { color: tono, metal: mascara, mirror: espejo });
}

// Una pieza plegada de chapa/inyección: la triangulación de la cara conserva los
// quiebres de la silueta, incluso en paneles cóncavos. El reverso y el canto cierran la pieza.
function placaLateral(b, puntos, espesor, tono, mascara, espejo = true) {
  const triangles = THREE.ShapeUtils.triangulateShape(puntos.map(([x,y]) => new THREE.Vector2(x,y)), []);
  const coords = [], indices = [];
  for (const capa of [0, -espesor]) for (const [x,y,z] of puntos) coords.push(x,y,z + capa);
  const n = puntos.length;
  for (let [a,c,d] of triangles) {
    const p = puntos[a], q = puntos[c], r = puntos[d];
    if ((q[0]-p[0])*(r[1]-p[1]) - (q[1]-p[1])*(r[0]-p[0]) < 0) [c,d] = [d,c];
    indices.push(a,c,d,n+a,n+d,n+c);
  }
  const area = puntos.reduce((s,p,i) => {
    const q = puntos[(i+1)%n];
    return s + p[0]*q[1] - q[0]*p[1];
  }, 0);
  for (let i=0; i<n; i++) {
    const j = (i+1)%n;
    if (area > 0) indices.push(i,n+i,n+j,i,n+j,j);
    else indices.push(i,j,n+j,i,n+j,n+i);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(coords, 3));
  g.setIndex(indices);
  const plana = g.toNonIndexed();
  plana.computeVertexNormals();
  g.dispose();
  addGeo(b, plana, { color: tono, metal: mascara, mirror: espejo });
}

function sillin(b) {
  const filas = [
    [-.787,.925,.936,.041],[-.759,.908,.941,.101],[-.656,.886,.923,.146],[-.537,.855,.901,.153],
    [-.471,.812,.882,.151],[-.386,.767,.840,.143],[-.308,.748,.821,.131],[-.254,.747,.820,.121],
    [-.177,.754,.838,.108],[-.123,.785,.867,.096],[-.103,.811,.872,.072]
  ];
  const perfil = [[0,1],[.34,.996],[.61,.98],[.82,.951],[.92,.903],[.974,.819],
    [1,.68],[.993,.47],[.966,.23],[.86,.047],[.58,0],[0,0]];
  const forma = secciones(filas,perfil);
  cerrar(b,filas,perfil,asiento,vinilo,forma,true);
  const pespunte = (x, t, fuera = .001) => {
    const p = forma(x,t);
    p[1] += .0005; p[2] += fuera;
    return p;
  };
  const borde = Array.from({length: 45}, (_,i) => pespunte(lerp(-.778,-.108,i/44),3.8));
  cordon(b,borde,.0014,goma,vinilo,true,64);
  for (let i = 0; i < 69; i++) {
    const x = -.764 + i * .0093;
    tube(b,pespunte(x,3.61),pespunte(x+.0055,3.62),.0007,5,{color:costura,metal:vinilo,open:true,mirror:true});
  }
  // Asa plana de pasajero y su sombra en ambos cantos, sujetada bajo la falda.
  addGrid(b, 4, 14, (i,j) => {
    const p = forma(-.557 + i*.006, j/14*9);
    p[1] += .0024 * (1 - j/14); p[2] += .002 * j/14;
    return p;
  }, {color: goma, metal: vinilo, out:[0,0,1]});
}

function colin(b) {
  const filas = [
    [-.826,.915,.923,.025],[-.792,.883,.926,.080],[-.723,.848,.909,.119],
    [-.610,.806,.880,.144],[-.51,.744,.847,.148],[-.425,.678,.812,.125],[-.338,.638,.761,.090]
  ];
  const perfil = [[0,1],[.77,.96],[1,.73],[.92,.40],[.58,.045],[0,0]];
  cerrar(b,filas,perfil,negro,0,secciones(filas,perfil));
  // La caja bajo el asiento llega a la viga lateral del chasis. El labio superior entra
  // bajo el vinilo y deja a la vista el cambio de material en la cintura del piloto.
  const caja = [[-.508,.749,.767,.108],[-.458,.697,.806,.127],[-.388,.677,.790,.130],
    [-.277,.666,.773,.121],[-.177,.674,.782,.116],[-.093,.700,.829,.112],[-.069,.725,.832,.095]];
  const seccionCaja = [[0,1],[.91,.96],[1,.82],[.98,.59],[.82,.32],[.62,.10],[0,0]];
  cerrar(b,caja,seccionCaja,color('#282a2e'),0,secciones(caja,seccionCaja));
  placaLateral(b,[[-.447,.759,.131],[-.399,.757,.134],[-.316,.744,.130],[-.212,.736,.123],
    [-.149,.729,.116],[-.180,.694,.113],[-.244,.686,.116],[-.357,.709,.125]],.005,
    color('#34373c'),0);
  for (const [x,y,z] of [[-.395,.750,.135],[-.195,.714,.120]]) {
    tube(b,[x,y,z-.004],[x,y,z+.001],.005,14,{color:negro,mirror:true});
    tube(b,[x,y,z],[x,y,z+.0018],.0032,6,{color:aluminio,metal,mirror:true});
  }
  // Dos pequeñas aletas pintadas salen de debajo de la silla y rematan en punta frente al amortiguador.
  placaLateral(b, [[-.727,.882,.121],[-.647,.867,.138],[-.537,.839,.152],[-.455,.779,.151],
    [-.326,.649,.108],[-.410,.675,.122],[-.525,.734,.139],[-.609,.802,.145]], .009,hielo,pintura);
  // Stop triangular fino alojado directamente en el colín, visible desde atrás.
  const lente = (i,j,sep) => {
    const u = i/16, z = (u-.5)*.168, curva = Math.abs(2*u-1);
    return [-.793 + .043*curva**1.7 - sep, .886 + .015*curva + j*(.022 - .012*curva), z];
  };
  addGrid(b,16,1,(i,j)=>lente(i,j,.001),{color:rojo,metal:.04,mirror:false,out:[-1,0,0]});
  for (let i=1;i<16;i++) {
    const p=lente(i,.48,.0018);
    addGeo(b,new THREE.SphereGeometry(1,10,7),{position:p,scale:[.003,.004,.0045],color:diodo,metal:.046});
  }
  // Los intermitentes nacen del subcolín, por encima y por delante del soporte independiente de la placa.
  tube(b,[-.711,.840,.069],[-.725,.828,.149],.009,12,{color:goma,mirror:true});
  for (const [x, largo, tono, mascara] of [[-.727,.033,negro,0],[-.746,.019,color('#dc943d'),.04]]) {
    addGeo(b,new THREE.SphereGeometry(1,22,12),{color:tono,metal:mascara,position:[x,.827,.151],scale:[largo,.018,.021],mirror:true});
  }
}

function guardabarrosDelantero(b) {
  // La corona, el faldón y las orejas de fijación son la misma inyección. El canto
  // vuelve debajo de la pieza y la pata se apoya a ras del soporte de la horquilla.
  const caida = curve([[.394,.015],[.48,.030],[.55,.043],[.585,.069],[.606,.094],
    [.626,.134],[.650,.186],[.670,.239],[.687,.249],[.707,.221],[.721,.101],
    [.743,.054],[.769,.036],[.840,.027],[.914,.016]]);
  const bordeExterior = curve([[.394,.071],[.548,.086],[.617,.099],[.670,.124],[.691,.125],
    [.720,.102],[.760,.085],[.914,.071]]);
  const seccion = [[0,0],[.41,.001],[.59,.004],[.70,.005],[.80,.001],[.90,-.004],
    [.96,-.011],[1,-.019]];
  function punta(i,j,interior=false) {
    const u=i/84, t=j/10;
    const inicio=.390 + .010 * t*t, fin=.914 - .021 * t*t;
    const x=lerp(inicio,fin,u), alto=.30 + Math.sqrt(.338**2 - (x-.72)**2);
    const caidaLocal=caida(x), ancho=.074 + .005*Math.sin(u*PI);
    let y,z;
    if (j < seccion.length) {
      const [a,h]=seccion[j];
      y=alto+h; z=a*ancho;
    } else {
      const v=(j-7)/3;
      y=alto-lerp(.019,caidaLocal,v); z=lerp(ancho,bordeExterior(x),Math.sin(v*PI/2));
    }
    return [x,y-(interior?.003:0),z-(interior?.002*t:0)];
  }
  for (const interior of [false,true]) {
    addGrid(b,84,10,(i,j)=>punta(i,j,interior),{
      color:interior?negro:hielo,metal:interior?0:pintura,out:[0,interior?-1:1,interior?-1:1]
    });
  }
  addGrid(b,84,1,(i,j)=>punta(i,10,Boolean(j)),{color:hielo,metal:pintura,out:[0,-1,1]});
  for (const [i,signo] of [[0,-1],[84,1]]) {
    addGrid(b,10,1,(j,k)=>punta(i,j,Boolean(k)),{color:hielo,metal:pintura,out:[signo,0,0]});
  }
  for (const [x,y,z] of [[.631,.501,.105],[.677,.410,.124]]) {
    tube(b,[x,y,.084],[x,y,z+.001],.009,14,{color:negro,mirror:true});
    tube(b,[x,y,z],[x,y,z+.003],.0075,16,{color:aluminio,metal,mirror:true});
    tube(b,[x,y,z+.003],[x,y,z+.004],.0048,6,{color:goma,mirror:true});
  }
  // Catadióptricos de la versión europea, fijados a las botellas.
  for (const [z,alto,ancho,tono,material] of [[.123,.033,.016,negro,0],[.129,.028,.012,color('#ed871d'),.04]]) {
    const g=new THREE.SphereGeometry(1,20,12);
    g.scale(ancho,alto,.006); g.rotateZ(.41);
    addGeo(b,g,{position:[.654,.446,z],color:tono,metal:material,mirror:true});
  }
}

function ruedaTrasera(b) {
  const punto = (u,t,debajo) => {
    const a=lerp(.36,1.28 + .06*Math.cos(t*PI),u), radio=.347-.019*t*t-(debajo?.0035:0);
    return [-.72 + radio*Math.cos(a), .315 + radio*Math.sin(a), t*(.101 - .022*u*u)];
  };
  for(const debajo of [false,true]) addGrid(b,26,8,(i,j)=>punto(i/26,j/8,debajo),{
    color:negro,out:[0,debajo?-1:1,0]
  });
  // Brazo izquierdo fundido. La luz pasa por el hueco entre los dos nervios.
  const grisBrazo=color('#42484a');
  cordon(b,[[-.70,.335,-.137],[-.78,.405,-.143],[-.859,.467,-.141],[-.966,.545,-.128]],.013,grisBrazo,metal,false,30);
  cordon(b,[[-.73,.350,-.136],[-.855,.429,-.146],[-.891,.463,-.144],[-.969,.549,-.129]],.009,grisBrazo,metal,false,26);
  tube(b,[-.965,.55,-.131],[-.984,.558,-.022],.011,12,{color:grisBrazo,metal});
  tube(b,[-.722,.338,-.125],[-.722,.338,-.153],.020,16,{color:aluminio,metal});
  // Aleta y portamatrícula curvos encima del neumático, separados del colín por completo.
  const aleta = (u,t,interior=false) => {
    const a=lerp(2.07 + .064*t*t,2.73 - .034*t*t,u);
    const r=.350-.008*t*t-.009*t**8-(interior?.005:0);
    return [-.72+r*Math.cos(a),.315+r*Math.sin(a),t*(.107-.017*u)];
  };
  for (const interior of [false,true]) {
    addGrid(b,24,9,(i,j)=>aleta(i/24,j/9,interior),{color:negro,out:[interior?1:-1,interior?-1:1,0]});
  }
  addGrid(b,24,1,(i,j)=>aleta(i/24,1,Boolean(j)),{color:negro,out:[0,0,1]});
  for (const [u,d] of [[0,1],[1,-1]]) {
    addGrid(b,9,1,(j,k)=>aleta(u,j/9,Boolean(k)),{color:negro,out:[d,0,0]});
  }
  cordon(b,[[-.975,.555,-.112],[-.989,.568,-.095],[-1.002,.603,-.068],[-.998,.647,-.047]],.009,grisBrazo,metal,false,16);
  tube(b,[-1.001,.600,-.057],[-1.001,.600,.057],.009,12,{color:grisBrazo,metal});
  const centro=new THREE.Vector3(-1.013,.607,0), inclinacion=.23;
  const normal=new THREE.Vector3(-Math.cos(inclinacion),Math.sin(inclinacion),0);
  const arriba=new THREE.Vector3(Math.sin(inclinacion),Math.cos(inclinacion),0);
  function puntoPlaca(y,z,extra) {
    return centro.clone().addScaledVector(arriba,y).addScaledVector(normal,extra).add(new THREE.Vector3(0,0,z)).toArray();
  }
  const amarillo=color('#edc642'), borde=color('#a18836');
  box(b,[.009,.124,.186],puntoPlaca(0,0,0),{color:negro,rotation:[0,0,-inclinacion]});
  for (const [w,h,d,tono] of [[.174,.112,.0048,borde],[.168,.106,.0053,amarillo]]) {
    const marco=[[-.48,-.50],[.48,-.50],[.50,-.47],[.50,.47],[.48,.50],[-.48,.50],[-.50,.47],[-.50,-.47]];
    const pts=marco.map(([z,y])=>puntoPlaca(y*h,z*w,d));
    const ids=pts.map(p=>b.v(...p,...normal.toArray(),undefined,undefined,...tono,0));
    for (let i=1;i<ids.length-1;i++) b.tri(ids[0],ids[i],ids[i+1]);
  }
  for (const signo of [-1,1]) {
    tube(b,puntoPlaca(-.040,.065*signo,-.007),puntoPlaca(.037,0,-.007),.0038,8,{color:grisBrazo,metal});
    tube(b,puntoPlaca(.034,.063*signo,-.008),puntoPlaca(.034,.063*signo,-.004),.0055,6,{color:aluminio,metal});
  }
  // Placa colombiana ficticia en dos renglones. Los trazos se estampan en relieve.
  const letras={
    M:[[[-1,-1],[-1,1],[0,-.14],[1,1],[1,-1]]],
    T:[[[-1,1],[1,1]],[[0,1],[0,-1]]],
    V:[[[-1,1],[0,-1],[1,1]]],
    0:[[[-.60,-1],[-1,-.70],[-1,.72],[-.62,1],[.60,1],[1,.70],[1,-.70],[.60,-1],[-.60,-1]]],
    9:[[[-.80,-1],[.33,-.92],[.95,-.52],[.95,.70],[.57,1],[-.59,1],[-1,.66],[-1,.18],[-.61,-.16],[.35,-.16],[.95,.18]]],
    A:[[[-1,-1],[0,1],[1,-1]],[[-.62,-.23],[.62,-.23]]]
  };
  for (const [fila,dy] of [['MTV',.021],['09A',-.021]]) {
    Array.from(fila).forEach((letra,k)=>{
      const punto=([u,v])=>puntoPlaca(dy+.015*v,(k-1)*.041+.011*u,.0064);
      for (const trazo of letras[letra]) for (let i=1;i<trazo.length;i++) {
        tube(b,punto(trazo[i-1]),punto(trazo[i]),.0018,7,{color:negro});
      }
    });
  }
  for(const z of [-.066,.066]) {
    tube(b,puntoPlaca(.045,z,.005),puntoPlaca(.045,z,.007),.0038,8,{color:aluminio,metal});
  }
  box(b,[.027,.025,.074],puntoPlaca(.071,0,0),{color:negro,rotation:[0,0,-inclinacion]});
  for(const [z,r,tono,material] of [[.093,.017,negro,0],[.097,.014,rojo,.04]]) {
    tube(b,puntoPlaca(-.022,z-.004,0),puntoPlaca(-.022,z,0),r,20,{color:tono,metal:material,mirror:true});
  }
}

export function asientoYGuardabarrosMT09(b) {
  sillin(b);
  colin(b);
  guardabarrosDelantero(b);
  ruedaTrasera(b);
}
