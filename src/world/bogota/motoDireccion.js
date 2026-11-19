import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { addGeo, addGrid, COLOR, tube } from './carParts.js';

const metal = .3, caucho = .1, vidrio = .04;
const cromado = new THREE.Color('#d6dce0').toArray();
const fundicion = new THREE.Color('#656c70').toArray();
const pavonado = new THREE.Color('#353d42').toArray();
const marfil = new THREE.Color('#e2ded0').toArray();
const ambar = new THREE.Color('#ef902b').toArray();
const bermellon = new THREE.Color('#e46546').toArray();
const arriba = new THREE.Vector3(0, 1, 0);
const ejeX = new THREE.Vector3(1, 0, 0);
const ejeZ = new THREE.Vector3(0, 0, 1);
const claro = [1, 1, 1];
const aVector = p => new THREE.Vector3(...p);
const avanzar = (p, eje, d) => aVector(p).addScaledVector(eje, d).toArray();

function torno(b, base, eje, perfil, color, alfa, lados, mirror = false) {
  const g = new THREE.LatheGeometry(perfil.map(([r, h]) => new THREE.Vector2(r, h)), lados);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(arriba, eje));
  addGeo(b, g, { position: base, color, metal: alfa, mirror });
}

function conducto(b, puntos, radio, color, alfa, tramos, lados = 6, mirror = false) {
  const curva = new THREE.CatmullRomCurve3(puntos.map(aVector));
  addGeo(b, new THREE.TubeGeometry(curva, tramos, radio, lados, false), { color, metal: alfa, mirror });
}

function bloque(b, posicion, medidas, radio, color, alfa = 0, mirror = false) {
  addGeo(b, new RoundedBoxGeometry(...medidas, 1, radio), { position: posicion, color, metal: alfa, mirror });
}

const pie = [.66, .294, .088];
const ejeBarra = aVector([-.272, .699, 0]).normalize();
const enBarra = h => avanzar(pie, ejeBarra, h);

function horquillas(b) {
  // Cada botella tiene un pie fundido para el eje y se estrecha al llegar al retén.
  torno(b, pie, ejeBarra, [
    [.010, -.031], [.028, -.025], [.031, -.010], [.030, .061], [.026, .119],
    [.024, .263], [.028, .275], [.028, .292], [.025, .296]
  ], fundicion, metal, 18, true);
  torno(b, pie, ejeBarra, [[.025, .286], [.0285, .289], [.028, .302], [.022, .309], [.019, .309]],
    COLOR.trim, 0, 20, true);
  torno(b, pie, ejeBarra, [[.0188, .295], [.0188, .725]], cromado, metal, 20, true);
  // Camisa superior y tapa de precarga sobre la tija.
  torno(b, pie, ejeBarra, [[.021, .535], [.024, .545], [.024, .713], [.022, .725]], pavonado, metal, 20, true);
  torno(b, pie, ejeBarra, [[.0215, .718], [.023, .722], [.023, .728], [.017, .732]], cromado, metal, 18, true);
  const cabeza = enBarra(.729);
  tube(b, cabeza, avanzar(cabeza, ejeBarra, .007), .013, 6, { color: fundicion, metal, mirror: true });
  tube(b, [.66,.30,-.104], [.66,.30,.105], .014, 16, { color: fundicion, metal });
  tube(b, [.66,.30,.103], [.66,.30,.117], .017, 6, { color: cromado, metal, mirror: true });

  // Las tijas abrazan ambas barras y el pivote central por detrás del eje de la horquilla.
  for (const [h, espesor] of [[.546,.022],[.685,.021]]) {
    const [x,y] = enBarra(h);
    bloque(b, [x-.008,y,0], [.059,espesor,.197], .007, pavonado, metal);
    tube(b, [x-.035,y-.012,0], [x-.035,y+.017,0], .031, 16, { color: fundicion, metal });
    torno(b, pie,ejeBarra, [[.024,h-.011],[.029,h-.009],[.029,h+.01],[.024,h+.012]],
      fundicion, metal, 16, true);
    tube(b,[x-.010,y,.099],[x-.010,y,.110],.007,6,{color:cromado,metal,mirror:true});
  }
  const pivot = enBarra(.688);
  tube(b,[pivot[0]-.035,pivot[1]+.012,0],[pivot[0]-.035,pivot[1]+.027,0],.018,6,{color:cromado,metal});
}

const faroY = .94;

function optica(b) {
  const base = [.436, faroY, 0];
  // La cubeta va metida dentro de la carcasa. Desde delante se ve el interior cóncavo,
  // la bombilla y los prismas del cristal que cortan sus reflejos.
  torno(b, base, ejeX, [[.012,0],[.055,.010],[.087,.032],[.105,.072],[.106,.108],[.104,.130]],
    claro, 1, 36);
  torno(b, base, ejeX, [[.103,.103],[.108,.106],[.108,.122],[.105,.128]],
    COLOR.trim, 0, 36);
  torno(b, base, ejeX, [[.105,.113],[.108,.116],[.109,.124],[.106,.133],[.100,.139],[.093,.138],[.092,.134]],
    cromado, metal, 44);
  const radio = .094, xBorde = .570;
  const profundidad = r => xBorde - .048 * (1 - (r/radio)**2);
  const colorFaceta = ['#c1cbd0','#dae2e4','#ced8dd','#aab7bf'].map(c => new THREE.Color(c).toArray());
  for (let i = 0; i < 24; i++) {
    const a = i * Math.PI / 12;
    addGrid(b, 1, 4, (u, v) => {
      const r = .014 + (radio-.014) * v/4, theta = a + u*Math.PI/12;
      return [profundidad(r), faroY + r*Math.sin(theta), r*Math.cos(theta)];
    }, { out: [1,0,0], color: colorFaceta[i%4], metal, mirror: false });
  }
  torno(b, [.52,faroY,0], ejeX, [[.014,0],[.017,.003],[.017,.011],[.011,.014]], pavonado, metal, 18);
  addGeo(b, new THREE.SphereGeometry(.011, 12, 8), {
    scale:[1.55,1,1], position:[.548,faroY,0], color:marfil, metal:vidrio
  });
  const cubreBombilla = new THREE.SphereGeometry(.0124, 14, 5, 0, Math.PI*2, 0, Math.PI/2);
  cubreBombilla.rotateZ(-Math.PI/2);
  addGeo(b, cubreBombilla, { scale:[.38,1,1], position:[.561,faroY,0], color:fundicion, metal });
  // Vidrio prensado: cada cordón cambia de normal desde el filo oscuro a la cara que refleja el cielo.
  // Entre cordones el vidrio es transparente y deja leer el reflector real del mismo lote opaco.
  const arista = new THREE.Color('#d4e0e0').toArray(), sombra = new THREE.Color('#83969d').toArray();
  for (let k=-8; k<=8; k++) {
    const z = k*.0097, alto = Math.sqrt(.091**2-z*z);
    addGrid(b,2,8,(i,j) => {
      const y = (j/4-1)*alto;
      const x = .571 + .009 * (1-(y*y+z*z)/(.093*.093));
      return [x + (i===1 ? .0008 : 0), faroY+y, z+(i-1)*.00085];
    }, { out:[1,0,0], color:u => u===0 ? sombra : arista, metal:vidrio, mirror:false });
  }
  for (const angulo of [.75, 2.39, 4.71]) {
    const y = faroY+.104*Math.sin(angulo), z = .104*Math.cos(angulo);
    tube(b,[.56,y,z],[.57,y,z],.0038,8,{color:fundicion,metal});
  }
}

function luces(b) {
  // Orejetas en forma de triángulo apoyadas en el tubo y en el costado de la cubeta.
  const placa = new THREE.Shape();
  placa.moveTo(.429,.868); placa.quadraticCurveTo(.440,.860,.449,.875);
  placa.lineTo(.520,.929); placa.quadraticCurveTo(.533,.944,.518,.954);
  placa.lineTo(.414,.927); placa.quadraticCurveTo(.404,.925,.410,.906); placa.closePath();
  const g = new THREE.ExtrudeGeometry(placa, { depth:.0048, bevelEnabled:false, curveSegments:4 });
  addGeo(b,g,{position:[0,0,.088],color:pavonado,metal,mirror:true});
  tube(b,[.514,.938,.085],[.514,.938,.111],.010,10,{color:fundicion,metal,mirror:true});
  tube(b,[.514,.938,.108],[.514,.938,.115],.009,6,{color:cromado,metal,mirror:true});
  optica(b);
  // Señal ámbar sobre vástago elástico. El borde de la copa protege la lente.
  tube(b,[.474,.895,.088],[.484,.898,.145],.009,10,{color:COLOR.trim,mirror:true});
  const base = [.458,.898,.151];
  torno(b,base,ejeX,[[.006,0],[.019,.011],[.022,.028],[.022,.040],[.019,.044]],
    COLOR.trim,0,18,true);
  torno(b,base,ejeX,[[.0195,.040],[.020,.043],[.016,.048],[.004,.051],[0,.051]],
    ambar,vidrio,20,true);
}

function tablero(b) {
  // El velocímetro mira al conductor. Esfera, rayas y aguja tienen alturas distintas dentro del bisel.
  const eje = aVector([-.52,.854,0]).normalize(), arribaDial = aVector([eje.y,-eje.x,0]);
  const centro = [.418,1.015,0], cara = avanzar(centro,eje,.047);
  tube(b, [.425,.938,0], centro, .013,12,{color:pavonado,metal});
  torno(b,centro,eje,[[.022,-.019],[.043,-.006],[.052,.016],[.052,.044],[.050,.048]],
    COLOR.trim,0,28);
  torno(b,centro,eje,[[.051,.039],[.054,.041],[.054,.047],[.051,.051],[.047,.051],[.045,.047]],
    cromado,metal,34);
  tube(b, avanzar(cara,eje,-.003), cara, .0468,32,{color:COLOR.dash});
  const enDial = (u,v,h) => aVector(cara).addScaledVector(ejeZ,u).addScaledVector(arribaDial,v).addScaledVector(eje,h).toArray();
  for (let i=0; i<=40; i++) {
    const a = (-132 + i*264/40)*Math.PI/180, s = Math.sin(a), c = Math.cos(a);
    const mayor = i%5===0, r0 = mayor ? .032 : .036, r1=.0405;
    addGrid(b,1,1,(j,k) => {
      const r = k ? r1 : r0, ancho = (mayor ? .0010 : .0005)*(2*j-1);
      return enDial(r*s + ancho*c, r*c-ancho*s, .0004);
    }, { out:eje.toArray(), color:i>34 ? bermellon : marfil, mirror:false });
  }
  // Ventana del contador mecánico, con los rodillos e indicación de punto muerto en verde.
  addGrid(b,1,1,(i,j) => enDial((i-.5)*.030,-.020+j*.007,.0005),
    { out:eje.toArray(),color:fundicion,metal,mirror:false });
  for (let i=0; i<5; i++) {
    addGrid(b,1,1,(u,v) => enDial(-.013+i*.0054+u*.004,-.0188+v*.0047,.0007),
      { out:eje.toArray(),color:COLOR.dash,mirror:false });
    addGrid(b,1,1,(u,v) => enDial(-.012+i*.0054+u*.0017,-.0178+v*.0028,.0008),
      { out:eje.toArray(),color:marfil,mirror:false });
  }
  const testigo = enDial(-.014,.016,.0005);
  tube(b,testigo,avanzar(testigo,eje,.0018),.0024,10,
    {color:new THREE.Color('#6fa879').toArray(),metal:vidrio});
  addGrid(b,1,1,(i,j) => enDial(i ? -.026 : .0041, (i ? -.023 : .0033)+(j-.5)*(i ? .0007:.0030),.0018),
    {out:eje.toArray(),color:bermellon,mirror:false});
  tube(b,enDial(0,0,.001),enDial(0,0,.004),.0046,10,{color:fundicion,metal});
}

function manillar(b) {
  const mitad = [[.392,1.006,0],[.393,1.006,.072],[.400,1.015,.111],
    [.403,1.046,.146],[.392,1.061,.190],[.369,1.059,.250],[.327,1.047,.348]];
  const izquierda = mitad.slice(1).reverse().map(([x,y,z]) => [x,y,-z]);
  conducto(b, izquierda.concat(mitad), .0105, pavonado, metal, 32, 12);
  for (const z of [-.047,.047]) {
    bloque(b,[.392,.986,z],[.039,.054,.027],.005,fundicion,metal);
    bloque(b,[.392,1.009,z],[.042,.025,.029],.005,pavonado,metal);
    for(const x of [.379,.405]) tube(b,[x,1.018,z],[x,1.026,z],.0043,6,{color:cromado,metal});
  }
  const inicio = [.370,1.059,.245], eje = aVector([-.042,-.012,.103]).normalize();
  const perfil = [[.020,0],[.021,.003],[.018,.007],[.016,.009]];
  for (let i=0; i<9; i++) {
    const h = .013 + .0092*i;
    perfil.push([.0168,h],[.0177,h+.002],[.0176,h+.005],[.0165,h+.0062]);
  }
  perfil.push([.0165,.100],[.018,.102],[.018,.106],[.015,.108]);
  torno(b,inicio,eje,perfil,COLOR.rubber,caucho,14,true);
  const extremo = avanzar(inicio,eje,.107);
  tube(b,extremo,avanzar(extremo,eje,.010),.016,14,{color:pavonado,metal,mirror:true});
  tube(b,avanzar(extremo,eje,.010),avanzar(extremo,eje,.011),.005,6,{color:fundicion,metal,mirror:true});
  torno(b,inicio,eje,[[.017,-.040],[.023,-.036],[.026,-.026],[.025,-.005],[.021,-.003]],COLOR.trim,0,14,true);
  bloque(b,[.368,1.081,.222],[.017,.009,.019],.0025,bermellon);
  bloque(b,[.366,1.078,-.223],[.015,.008,.021],.0025,COLOR.plasticLight);
  // Bomba hidráulica del freno a la derecha, con tapa atornillada.
  bloque(b,[.398,1.073,.181],[.049,.031,.034],.004,pavonado,metal);
  bloque(b,[.398,1.09,.181],[.048,.006,.036],.002,COLOR.plasticLight);
  for(const z of [.169,.193]) tube(b,[.398,1.09,z],[.398,1.094,z],.0027,8,{color:cromado,metal});
  conducto(b,[[.397,1.059,.174],[.424,1.057,.184],[.431,1.052,.217],[.421,1.047,.272],[.405,1.045,.330]],.0056,cromado,metal,14,8,true);
  addGeo(b,new THREE.SphereGeometry(.0084,10,7),{position:[.405,1.045,.330],color:cromado,metal,mirror:true});

  // El latiguillo sigue la botella hasta la pinza. El de embrague regresa hacia el cárter.
  conducto(b,[[.413,1.073,.177],[.459,1.041,.153],[.485,.973,.121],[.509,.845,.125],
    [.552,.724,.123],[.578,.553,.109],[.579,.455,.089],[.576,.430,.086]],.004,COLOR.trim,0,22);
  tube(b,[.578,.447,.088],[.576,.429,.086],.0068,6,{color:fundicion,metal});
  conducto(b,[[.380,1.056,-.203],[.423,1.050,-.158],[.438,.980,-.116],[.399,.835,-.100],
    [.318,.714,-.103],[.160,.562,-.096],[.076,.433,-.119]],.0038,COLOR.trim,0,19);
}

function espejos(b) {
  const anclaje = [.387,1.064,.202];
  tube(b,anclaje,[.387,1.090,.202],.008,8,{color:fundicion,metal,mirror:true});
  conducto(b,[[.387,1.087,.202],[.386,1.110,.207],[.379,1.129,.226],
    [.364,1.166,.258],[.345,1.188,.281]],.0046,pavonado,metal,14,8,true);
  addGeo(b,new THREE.SphereGeometry(.009,10,6),{position:[.345,1.188,.281],color:fundicion,metal,mirror:true});
  const centro = [.339,1.204,.292];
  function disco(perfil,color,alfa) {
    const g = new THREE.LatheGeometry(perfil.map(([r,x])=>new THREE.Vector2(r,x)),28);
    g.rotateZ(-Math.PI/2); g.scale(1,.043,.058);
    g.rotateX(-.24); g.rotateY(-.19);
    addGeo(b,g,{position:centro,color,metal:alfa,mirror:true});
  }
  // Bordes convexos y un lomo esmaltado que toma la luz de perfil.
  disco([[.93,-.0068],[.985,-.007],[1,-.004],[.98,.001],[.89,.006],[.63,.012],[.28,.016],[0,.017]],pavonado,metal);
  disco([[.93,-.0077],[.96,-.0074],[.984,-.0066]],cromado,metal);
  const cielo = new THREE.Color('#b4ced9'), horizonte = new THREE.Color('#e0ddd0'), suelo = new THREE.Color('#7b8588');
  disco([[0,-.0107],[.40,-.0104],[.76,-.0094],[.94,-.008]],(_x,y) => {
    const t = THREE.MathUtils.clamp((y-centro[1])/.042,-1,1);
    return horizonte.clone().lerp(t>0 ? cielo : suelo, Math.abs(t)*.86).toArray();
  },vidrio);
}

export function direccionMoto(b) {
  horquillas(b);
  luces(b);
  tablero(b);
  manillar(b);
  espejos(b);
}
