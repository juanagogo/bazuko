// Depósito de acero, tomas de aire y aletas independientes de la segunda generación.
// Las coordenadas están en metros. +X apunta a la rueda delantera y +Z al escape.
import * as THREE from 'three';
import { addGeo, addGrid, tube, COLOR } from './carParts.js';
import { curve, lerp } from './carLoft.js';

const rgb = hex => new THREE.Color(hex).toArray();
const hielo = rgb('#a6aaa9'), grafito = rgb('#303237'), rejilla = rgb('#515459');
const aluminio = rgb('#bfc4c6'), oscuro = rgb('#17191b'), rojo = rgb('#f14026');
const pintura = .94, metal = .31;

// Las dos bajadas de la chapa se apoyan delante del asiento. El resalte bajo el emblema continúa hasta la toma.
const estaciones = [
  [-.151,.871,.837,.095], [-.124,.909,.796,.122], [-.068,.961,.742,.148],
  [-.008,1.005,.684,.160], [.046,1.026,.696,.169], [.057,1.030,.773,.176],
  [.079,1.035,.816,.181], [.109,1.039,.842,.187], [.157,1.043,.853,.198], [.219,1.037,.842,.203],
  [.285,1.014,.840,.194], [.342,.972,.846,.178], [.390,.933,.858,.144], [.414,.900,.878,.084]
];
const [techo, base, ancho] = [1,2,3].map(k => curve(estaciones.map(e => [e[0], e[k]])));
// El rebaje que recibe la toma sólo recorta el bajo del tanque. El perfil superior
// sigue una chapa continua, incluso donde cambia bruscamente la altura del recorte.
const fondoChapa = curve([[-.151,.820],[-.11,.765],[-.025,.686],[.10,.694],[.25,.730],[.34,.770],[.414,.852]]);
const contorno = curve([[0,.87],[.035,.945],[.16,.977],[.42,.998],[.66,1],[.76,.989],
  [.82,.962],[.865,.899],[.925,.783],[.969,.590],[.991,.32],[1,0]]);
const suave = THREE.MathUtils.smoothstep;

function costado(x, y) {
  const suelo = fondoChapa(x);
  const t = THREE.MathUtils.clamp((y - suelo) / (techo(x) - suelo), 0, 1);
  const rodilla = .026 * (1 - suave(x, -.11,.08)) * (1 - suave(t, .10,.64));
  // El nervio estampado recorre el hombro de la chapa y se desvanece antes de la pipa.
  const linea = .543 + .11 * Math.sin((x+.09)*5.4);
  const hombro = .0068 * Math.exp(-((t-linea)**2)/.013) * suave(x,-.129,-.026)
    * (1-suave(x,.30,.408)) * Math.sin(Math.PI*t);
  return ancho(x) * contorno(t) + hombro - rodilla;
}

function deposito(b) {
  addGrid(b, 94, 45, (i, j) => {
    const x = lerp(-.151,.414,i / 94);
    // Más muestras en el lomo: el brillo cruza la unión central sin un filo.
    const fase = Math.PI * j / 45, t = (1 + Math.cos(fase)) * .5;
    const y = lerp(base(x),techo(x),t);
    return [x,y,costado(x,y)];
  }, { color: hielo, metal: pintura, out: [0,0,1] });
  addGrid(b, 74, 5, (i, j) => {
    const x = lerp(-.151,.414,i / 74), u = j / 5;
    return [x, base(x) + .014 * (1-u), u * costado(x,base(x))];
  }, { color: grafito, out: [0,-1,0] });
  for (const [x, dx] of [[-.151,-1],[.414,1]]) {
    addGrid(b, 7, 24, (i,j) => {
      const t = .0001 + .9998 * j / 24, y = lerp(base(x),techo(x),t);
      return [x,y,costado(x,y)*i/7];
    }, { color: hielo, metal: pintura, out: [dx,0,0] });
  }
  const x = .125, alto = techo(x);
  for (const [r, h, dy, color, clase] of [
    [.055,.005,0,COLOR.trim,0], [.051,.005,.0035,aluminio,metal], [.041,.004,.0065,oscuro,0], [.034,.004,.009,aluminio,metal]
  ]) addGeo(b,new THREE.CylinderGeometry(r,r,h,48),{position:[x,alto+dy,0],color,metal:clase});
  addGeo(b, new THREE.BoxGeometry(.021,.0018,.0044), {position:[x-.003,alto+.0114,0],color:oscuro});
  for (let k = 0; k < 6; k++) {
    const a = k*Math.PI/3;
    addGeo(b,new THREE.CylinderGeometry(.0028,.0028,.0014,6), {
      position:[x+.046*Math.cos(a),alto+.0066,.046*Math.sin(a)],color:grafito,metal
    });
  }
}

// Desplaza una chapa modelada en XY sobre una superficie z(x,y) sin perder las normales de sus biseles.
function proyectar(b, geo, profundidad, color, acabado = 0, espejo = true) {
  const p = geo.attributes.position, n = geo.attributes.normal, normal = new THREE.Vector3(), eps = .0001;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i);
    const dx = (profundidad(x+eps,y)-profundidad(x-eps,y))/(2*eps);
    const dy = (profundidad(x,y+eps)-profundidad(x,y-eps))/(2*eps);
    normal.fromBufferAttribute(n,i);
    normal.set(normal.x - dx*normal.z, normal.y - dy*normal.z, normal.z).normalize();
    n.setXYZ(i,normal.x,normal.y,normal.z);
    p.setZ(i,profundidad(x,y)+p.getZ(i));
  }
  addGeo(b,geo,{color,metal:acabado,mirror:espejo});
}

function silueta(puntos, radio = .006) {
  const forma = new THREE.Shape();
  const vs = puntos.map(([x,y]) => new THREE.Vector2(x,y));
  if (radio === 0) {
    forma.setFromPoints(vs);
    forma.closePath();
    return forma;
  }
  vs.forEach((v,i) => {
    const previo = vs[(i+vs.length-1)%vs.length], siguiente = vs[(i+1)%vs.length];
    const d = Math.min(radio, v.distanceTo(previo)*.25, v.distanceTo(siguiente)*.25);
    const antes = v.clone().lerp(previo,d/v.distanceTo(previo)), despues = v.clone().lerp(siguiente,d/v.distanceTo(siguiente));
    if (i === 0) forma.moveTo(antes.x,antes.y);
    else forma.lineTo(antes.x,antes.y);
    forma.quadraticCurveTo(v.x,v.y,despues.x,despues.y);
  });
  forma.closePath();
  return forma;
}

function panel(b, puntos, profundidad, color, acabado, espesor, bisel) {
  const geo = new THREE.ExtrudeGeometry(silueta(puntos), {
    depth:espesor, bevelEnabled:true, bevelThickness:bisel, bevelSize:bisel, bevelSegments:3, curveSegments:5
  });
  proyectar(b,geo,profundidad,color,acabado);
}

function emblemas(b) {
  const cx=.248, cy=.926, escala=.022;
  const superficie = (x,y) => costado(x,y)+.0022;
  for (const [r,d,color,acabado] of [[1,.0006,aluminio,metal],[.90,.0011,oscuro,0]]) {
    const geo = new THREE.CircleGeometry(escala*r,48);
    geo.translate(cx,cy,d);
    proyectar(b,geo,superficie,color,acabado);
  }
  // Tres diapasones cruzados, inscritos en la medalla del costado del depósito.
  for (let k = 0; k < 3; k++) {
    const a = k * 2*Math.PI/3;
    for (const perfil of [
      [[-.047,-.64],[.047,-.64],[.047,.28],[-.047,.28]],
      [[-.15,.66],[-.08,.66],[-.08,.34],[0,.24],[.08,.34],[.08,.66],[.15,.66],[.15,.31],[0,.13],[-.15,.31]]
    ]) {
      const letras = perfil.map(([x,y]) => [cx+escala*(x*Math.cos(a)-y*Math.sin(a)),cy+escala*(x*Math.sin(a)+y*Math.cos(a))]);
      const g = new THREE.ShapeGeometry(silueta(letras,0));
      g.translate(0,0,.0017);
      proyectar(b,g,superficie,aluminio,metal);
    }
  }
}

const zToma = (x,y) => .155 + .128*(x-.1) + .040*(y-.80);

function rotulo(b) {
  // Gráfica angular roja sobre el plástico negro. En el lado izquierdo se recompone para que el 09 también se lea.
  const baseX=.321, baseY=.763;
  const formas = [
    [[-.49,.05],[-.25,.05],[-.09,.94],[-.34,.94]],
    [[-.18,.05],[-.08,.05],[.08,.94],[-.02,.94]],
    [[.18,.05],[.78,.05],[.94,.94],[.34,.94]],
    [[1.03,.05],[1.55,.05],[1.72,.94],[1.04,.94],[.94,.46],[1.39,.46],[1.36,.32],[1.08,.32]]
  ];
  const agujeros = [null,null,[[.43,.29],[.57,.70],[.71,.70],[.63,.29]],[[1.20,.63],[1.23,.76],[1.48,.76],[1.45,.63]]];
  for (const lado of [1,-1]) formas.forEach((poligono,i) => {
    const situar = ([u,v]) => {
      const dx = lado*(u-.60)*.075;
      return [lado*(baseX+dx), baseY+v*.029-.17*dx];
    };
    const forma = silueta(poligono.map(situar),0);
    if (agujeros[i]) forma.holes.push(silueta(agujeros[i].map(situar),0));
    const geo = new THREE.ShapeGeometry(forma);
    geo.translate(0,0,.0128);
    if (lado < 0) geo.rotateY(Math.PI);
    proyectar(b,geo,(x,y) => lado*zToma(x,y),rojo,.94,false);
  });
}

function tomas(b) {
  const negro = rgb('#303235');
  // Fondo de la concavidad entre la rodilla del piloto y el conducto de admisión.
  panel(b, [[.016,.691],[.043,.792],[.090,.840],[.147,.847],[.233,.805],[.199,.770],
    [.143,.761],[.086,.713]], (x,y)=>.150+.19*(x-.08)+.04*(y-.80),oscuro,0,.012,.003);
  panel(b, [[.135,.845],[.262,.841],[.392,.861],[.440,.821],[.473,.720],
    [.300,.743],[.228,.767],[.195,.803]], zToma, negro, 0, .009,.002);
  const labio = (x,y)=>zToma(x,y)+.010;
  panel(b, [[.168,.837],[.267,.833],[.396,.852],[.411,.838],[.297,.814],[.212,.813]],
    labio,rgb('#45474a'),0,.002,.001);
  rotulo(b);
  for (const [x,y] of [[.233,.805],[.405,.821]]) {
    const z=zToma(x,y)+.0125;
    tube(b,[x,y,z],[x,y,z+.0017],.005,12,{color:oscuro,mirror:true});
    tube(b,[x,y,z+.0018],[x,y,z+.0025],.002,6,{color:rejilla,metal,mirror:true});
  }
  // Bocas enfrentadas al aire. Cada paño negro queda en un plano más profundo que el marco y los dos travesaños.
  const boca = (v,w,retirada=0) => [
    .470-.077*v-retirada,
    .729+.138*v,
    .188+.046*w+.008*v
  ];
  addGrid(b,8,12,(i,j)=>boca(j/12,i/8,.008),{color:oscuro,out:[1,.35,.1]});
  const refuerzo = (v1,v2,w1,w2,color) => addGrid(b,2,2,(i,j)=>boca(lerp(v1,v2,j/2),lerp(w1,w2,i/2)),
    {color,out:[1,.35,.1]});
  for (let i=1; i<10; i++) {
    const w=i/10;
    tube(b,boca(.025,w,.006),boca(.975,w,.006),.0007,5,{color:rejilla,mirror:true,open:true});
  }
  for (let i=1; i<22; i++) {
    const v=i/22;
    tube(b,boca(v,.03,.0058),boca(v,.97,.0058),.00065,5,{color:rejilla,mirror:true,open:true});
  }
  refuerzo(0,1,0,.073,negro); refuerzo(0,1,.89,1,negro);
  for (const v of [0,.32,.65,.954]) refuerzo(v,v+.046,0,1,negro);
  // Dos aletas plateadas, independientes de las tomas superiores, en los laterales del radiador.
  const zAleta = (x,y) => .188 + .18*(x-.28) + .07*(y-.62);
  panel(b, [[.300,.755],[.365,.730],[.443,.676],[.368,.569],[.330,.468],[.268,.450],
    [.275,.574],[.318,.665]], zAleta,hielo,pintura,.008,.0035);
  for (const [x,y] of [[.331,.714],[.291,.505]]) {
    const z=zAleta(x,y)+.012;
    tube(b,[x,y,z],[x,y,z+.0018],.0054,14,{color:grafito,metal,mirror:true});
    tube(b,[x,y,z+.0018],[x,y,z+.0023],.0024,6,{color:oscuro,mirror:true});
  }
  tube(b,[.347,.640,.192],[.347,.640,.254],.010,18,{color:COLOR.trim,mirror:true});
  for (const z of [.210,.215,.220,.225]) {
    tube(b,[.347,.640,z],[.347,.640,z+.002],.0118,18,{color:oscuro,mirror:true});
  }
  for (const [x,z,escala,color,acabado] of [
    [.343,.256,[.023,.019,.036],oscuro,0], [.352,.259,[.022,.017,.033],rgb('#b25d20'),.04],
    [.359,.260,[.019,.016,.030],rgb('#e28a24'),.04]
  ]) addGeo(b,new THREE.SphereGeometry(1,20,12),{position:[x,.640,z],scale:escala,color,metal:acabado,mirror:true});
  for (let j=-4;j<=4;j++) {
    const z=.260+j*.0053, radio=Math.sqrt(1-((z-.260)/.030)**2);
    const puntos=[];
    for (let i=0;i<=12;i++) {
      const a=(i/12-.5)*2.58;
      puntos.push(new THREE.Vector3(.359+.01935*radio*Math.cos(a),.640+.0162*radio*Math.sin(a),z));
    }
    const nervadura=new THREE.CatmullRomCurve3(puntos);
    addGeo(b,new THREE.TubeGeometry(nervadura,12,.0006,5,false),{color:rgb('#bd711e'),metal:.04,mirror:true});
  }
}

export function tanqueMT09(b) {
  deposito(b);
  emblemas(b);
  tomas(b);
}
