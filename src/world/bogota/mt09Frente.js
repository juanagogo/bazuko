// Delantera de la MT-09 2019: ópticas en dos alojamientos separados, cuatro proyectores y dos guías de posición.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { addGeo, addGrid, tube, COLOR } from './carParts.js';

const color = hex => new THREE.Color(hex).toArray();
const carbono = color('#292c30'), grafito = color('#3b4044'), sombra = color('#11151a');
const acero = color('#9ca8ae'), aluminio = color('#c4ced2'), niquel = color('#d5e1e7');
const electrico = color('#ecf6ff'), cristal = color('#b5cbd7'), plataMate = color('#b2b6b7');
const metal = .3, pulido = .31, lente = .04, policarbonato = .065, goma = .1;
const v = p => new THREE.Vector3(...p);
const Y = new THREE.Vector3(0, 1, 0);
const P = Math.PI;
const mueve = (base, eje, distancia) => v(base).addScaledVector(eje, distancia).toArray();

function torno(b, base, eje, radios, tono, alfa = 0, lados = 24, mirror = false) {
  const g = new THREE.LatheGeometry(radios.map(([r,h]) => new THREE.Vector2(r,h)), lados);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Y,eje));
  addGeo(b,g,{ color:tono, metal:alfa, position:base, mirror });
}

function latiguillo(b, puntos, radio, tono, alfa = 0, mirror = false, tramos = 20) {
  const curva = new THREE.CatmullRomCurve3(puntos.map(v));
  addGeo(b,new THREE.TubeGeometry(curva,tramos,radio,8,false),{color:tono,metal:alfa,mirror});
}

function carcasa(b, medidas, centro, radio, tono, alfa = 0) {
  addGeo(b,new RoundedBoxGeometry(...medidas,2,radio),{position:centro,color:tono,metal:alfa});
}

// Contornos en el plano de la cara. Cada arista conserva su tramo recto y tiene un empalme redondo.
function contorno(puntos, corte = .18) {
  const borde = [];
  for (let i=0; i<puntos.length; i++) {
    const a = puntos[(i + puntos.length - 1) % puntos.length], p = puntos[i], c = puntos[(i + 1) % puntos.length];
    const s = p.map((n,j) => n + (a[j] - n)*corte), t = p.map((n,j) => n + (c[j] - n)*corte);
    for (let k=0; k<=3; k++) {
      const u=k/3, w=1-u;
      borde.push(p.map((n,j) => s[j]*w*w+2*w*u*n+t[j]*u*u));
    }
  }
  return borde;
}

const une = (a,b,t) => a.map((n,j) => THREE.MathUtils.lerp(n,b[j],t));

// Malla de dos perfiles cerrados expresados en el espacio, con orientación fija por cara.
function faja(b, atras, frente, tono, alfa, direccion, espejo = false) {
  for (let i=0; i<atras.length; i++) {
    const k=(i+1)%atras.length;
    const pa=atras[i], pb=atras[k], pc=frente[k], pd=frente[i];
    const afuera=typeof direccion === 'function' ? direccion(pa,pd) : direccion;
    addGrid(b,1,1,(u,w)=> w ? (u ? pc : pd) : (u ? pb : pa),{color:tono,metal:alfa,mirror:espejo,out:afuera});
  }
}

function cara(b, anillo, centro, tono, alfa, normal, espejo = false) {
  const puntos = anillo.map(v), cc = v(centro);
  for (let i=0; i<puntos.length; i++) {
    const p=puntos[i], q=puntos[(i+1)%puntos.length];
    const n=p.clone().sub(cc).cross(q.clone().sub(cc));
    if (n.lengthSq() < 1e-16) continue;
    const invierte=n.dot(v(normal))<0;
    n.normalize().multiplyScalar(invierte ? -1 : 1);
    for (const lado of espejo ? [1,-1] : [1]) {
      const ids=[cc,p,q].map(t=>b.v(t.x,t.y,t.z*lado,n.x,n.y,n.z*lado,undefined,undefined,...tono,alfa));
      if (invierte === (lado===1)) b.tri(ids[0],ids[2],ids[1]); else b.tri(...ids);
    }
  }
}

// Aros con vértices compartidos para que un molde inyectado o una lámina curva
// recojan el reflejo de una luz continua a través de las diferentes secciones.
function molde(b, anillos, punta, tono, alfa, normal, espejo = true) {
  const n = anillos[0].length;
  const xyz = anillos.flat(2), indices = [];
  for (let k=0; k<anillos.length-1; k++) {
    for (let i=0; i<n; i++) {
      const a=k*n+i, d=k*n+(i+1)%n;
      indices.push(a,d,d+n,a,d+n,a+n);
    }
  }
  if (punta) {
    const centro=xyz.length / 3, inicio=centro-n;
    xyz.push(...punta);
    for (let i=0; i<n; i++) indices.push(inicio+i,inicio+(i+1)%n,centro);
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(xyz,3));
  g.setIndex(indices);
  const orientacion = new THREE.Vector3();
  const posiciones = g.getAttribute('position');
  for (let i=0; i<indices.length; i+=3) {
    const a = new THREE.Vector3().fromBufferAttribute(posiciones,indices[i]);
    const u = new THREE.Vector3().fromBufferAttribute(posiciones,indices[i+1]).sub(a);
    const w = new THREE.Vector3().fromBufferAttribute(posiciones,indices[i+2]).sub(a);
    orientacion.add(u.cross(w));
  }
  if (orientacion.dot(v(normal)) < 0) {
    for (let i=0; i<indices.length; i+=3) [indices[i+1],indices[i+2]]=[indices[i+2],indices[i+1]];
    g.setIndex(indices);
  }
  g.computeVertexNormals();
  addGeo(b,g,{color:tono,metal:alfa,mirror:espejo});
}

const ojoX = (z,y) => .658 - .40*z - .34*(y-.80);
const frenteOjo = (p,d=0) => [ojoX(...p)+d,p[1],p[0]];
const ejeLed = v([1,.12,.34]).normalize();

function proyector(b,z,y,r) {
  const base=[ojoX(z,y)-.025,y,z], giro=new THREE.Quaternion().setFromUnitVectors(Y,ejeLed);
  // Cada cuenco aluminizado recoge el LED en facetas ópticas, con un cerco pavonado
  // y una lente asférica más pequeña que la boca del propio reflector.
  const ax=v([0,0,1]).cross(ejeLed).normalize(), az=ejeLed.clone().cross(ax);
  const punto=(angulo,radio,fondo) => v(base).addScaledVector(ejeLed,fondo)
    .addScaledVector(ax,radio*Math.cos(angulo)).addScaledVector(az,radio*Math.sin(angulo)).toArray();
  for (let i=0;i<20;i++) {
    const a=2*P*i/20, delta=2*P/20;
    addGrid(b,2,3,(k,h)=>{
      const t=h/3;
      const radio=r*(.37+.65*t);
      return punto(a+delta*k/2,radio,-.006+.021*t*t+.0019*Math.sin(k*P/2)*t);
    },{color:i%4===0 ? niquel : acero,metal:pulido,mirror:true,out:ejeLed.toArray()});
  }
  torno(b,base,ejeLed,[[r*.97,.012],[r*1.026,.013],[r*1.045,.015],[r*1.014,.017],[r*.96,.016]],
    color('#79848d'),pulido,40,true);
  torno(b,base,ejeLed,[[.63*r,-.002],[.70*r,.001],[.71*r,.003],[.66*r,.004]],sombra,0,32,true);
  const g=new THREE.SphereGeometry(1,32,14,0,2*P,0,P/2);
  g.scale(r*.64,.012,r*.64);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Y,ejeLed));
  const centro=mueve(base,ejeLed,.004);
  const gradiente=(px,py,pz) => {
    const rel=v([px-centro[0],py-centro[1],pz-centro[2]]);
    const u=rel.dot(ax)/r,w=rel.dot(az)/r;
    const centroFrio=Math.exp(-((u+.12)**2+(w+.10)**2)/.12);
    const destello=.22*Math.exp(-((u-.35)**2/.008+(w-.10)**2/.08));
    const nivel=.055+.42*centroFrio+destello;
    return [nivel*.78,nivel*.91+.035,nivel+.077];
  };
  addGeo(b,g,{position:centro,color:gradiente,metal:lente,mirror:true});
  const nucleo=new THREE.SphereGeometry(1,24,10,0,2*P,0,P/2);
  nucleo.scale(r*.245,.0027,r*.27).applyQuaternion(giro);
  addGeo(b,nucleo,{position:mueve(base,ejeLed,.0153),color:electrico,metal:.045,mirror:true});
}

function faros(b) {
  const piel=contorno([[.013,.820],[.029,.871],[.115,.913],[.163,.922],[.184,.904],[.182,.877],
    [.163,.821],[.139,.787],[.074,.761],[.012,.750]],.19);
  const hueco=contorno([[.025,.806],[.032,.824],[.105,.862],[.152,.884],[.162,.883],[.157,.863],
    [.140,.826],[.120,.804],[.072,.786],[.026,.773]],.21);
  const exterior=piel.map(p=>frenteOjo(p,.004));
  const dorso=piel.map(([z,y]) => frenteOjo([.090+(z-.090)*.86,.837+(y-.837)*.75],-.071));
  const labio=hueco.map(p=>frenteOjo(p,.006)), fondo=hueco.map(p=>frenteOjo(p,-.027));
  const bordePrismas=hueco.map(p=>frenteOjo(p,-.008));
  const picos=piel.map((p,i)=>.013+.010*Math.max(0,Math.min(1,(p[1]-.82)/.08))+.0027*Math.sin(i*P/20));
  const ceja=(t,base,alto)=>piel.map((p,i)=>frenteOjo(une(p,hueco[i],t),base+alto*picos[i]));
  const costado=piel.map((p,i)=>une(dorso[i],exterior[i],.71));
  molde(b,[dorso,costado,exterior,ceja(.09,.005,.48),ceja(.24,.005,.93),ceja(.47,.006,1),
    ceja(.71,.007,.68),ceja(.92,.007,.21),labio],null,color('#31363b'),.94,[1,.24,.27]);
  cara(b,dorso,[.508,.84,.086],sombra,0,[-1,0,0],true);
  faja(b,labio,bordePrismas,sombra,lente,[1,0,.3],true);
  faja(b,bordePrismas,fondo,color('#656f78'),pulido,[1,0,.3],true);
  cara(b,fondo,frenteOjo([.089,.833],-.032),color('#363d44'),metal,[1,0,.3],true);
  proyector(b,.055,.803,.024);
  proyector(b,.121,.843,.0275);
  // Cubierta óptica continua con la junta fuera del área transparente.
  const centroLente=[.091,.826];
  const vidrio=t=>hueco.map(p=>frenteOjo(une(centroLente,p,t),.008+.009*(1-t*t)));
  molde(b,[vidrio(1),vidrio(.88),vidrio(.62),vidrio(.33),vidrio(.12)],frenteOjo(centroLente,.017),
    color('#dce9f2'),policarbonato,[1,0,.3]);

  // Arista exterior de aluminio pintado que afila hacia el centro bajo la guía de posición.
  const guiar=(puntos,radio,tono,alfa) => latiguillo(b,puntos.map(p=>frenteOjo(p,.009)),radio,tono,alfa,true,28);
  const cuchilla=new THREE.CatmullRomCurve3([[.177,.871,0],[.173,.850,0],[.16,.818,0],[.143,.795,0],
    [.123,.782,0],[.088,.768,0],[.054,.757,0]].map(v));
  addGrid(b,36,5,(i,j)=>{
    const t=i/36, w=j/5, p=cuchilla.getPoint(t), dir=cuchilla.getTangent(t);
    const ancho=.0015+.0060*Math.sin(P*t)**.6;
    return frenteOjo([p.x+dir.y*(w-.5)*ancho,p.y-dir.x*(w-.5)*ancho],.012+.003*Math.sin(P*w));
  },{color:plataMate,metal:.94,mirror:true,out:[1,.1,.20]});
  guiar([[.119,.797],[.096,.787],[.075,.780],[.049,.772]],.0024,electrico,.045);

  // El soporte negro a cuatro tornillos desciende desde la tija y separa los ojos hasta la punta de la máscara.
  const secciones=[[.752,.010],[.77,.015],[.814,.019],[.839,.025],[.855,.042],[.869,.052],
    [.886,.062],[.909,.065],[.927,.074],[.947,.095],[.967,.106],[.980,.108]];
  const f=(z,y)=>.656-.66*(y-.775)-.21*Math.abs(z);
  const superficie=(u,ancho,h)=>{
    const bordeAlto=Math.max(0,Math.min(1,(h-.943)/.037));
    const y=h-.014*bordeAlto*bordeAlto*(1-u*u), z=u*ancho;
    const resalte=.0068*(1-u*u)+.0042*Math.exp(-((u-.76)**2)/.015)*Math.sin(P*(h-.752)/.228);
    return [f(z,y)+resalte,y,z];
  };
  addGrid(b,18,secciones.length-1,(i,j)=>superficie(i/18,secciones[j][1],secciones[j][0]),{
    color:color('#383d41'),metal:.94,mirror:true,out:[1,.53,.18]});
  const borde=secciones.map(([y,w])=>superficie(1,w,y));
  addGrid(b,1,borde.length-1,(i,j)=>[borde[j][0]-.021*i,borde[j][1],borde[j][2]-.002*i],{
    color:carbono,metal:0,mirror:true,out:[0,.1,1]});
  addGrid(b,12,secciones.length-1,(i,j)=>{
    const [x,y,z]=superficie(i/12,secciones[j][1],secciones[j][0]);
    return [x-.021,y,z-.002*i/12];
  },{color:carbono,metal:0,mirror:true,out:[-1,-.1,0]});
  addGrid(b,12,1,(i,j)=>{
    const [x,y,z]=superficie(i/12,.108,.980); return [x-.018*j,y-.001*j,z];
  },{color:carbono,metal:0,mirror:true,out:[0,1,0]});
  for (const [z,y] of [[.051,.917],[.047,.883]]) {
    const pie=[f(z,y)+.010,y,z];
    const eje=v([1,.50,.1]).normalize();
    torno(b,pie,eje,[[.006,-.003],[.008,0],[.007,.003],[.004,.004]],acero,metal,16,true);
    tube(b,mueve(pie,eje,.003),mueve(pie,eje,.0043),.0026,6,{color:sombra,mirror:true});
  }
  // Dos nervaduras contenidas en el soporte del faro, moldeadas junto a los tornillos.
  const canal=[[.016,.863],[.020,.879],[.024,.898],[.028,.915]];
  latiguillo(b,canal.map(([z,y])=>[f(z,y)+.0075,y,z]),.0027,color('#272c31'),0,true,12);
  for (const [dx,dy] of [[.49,.88],[.48,.92]]) {
    tube(b,[dx,dy,.099],[.558,dy-.026,.12],.009,10,{color:grafito,metal,mirror:true});
  }
}

const baseBarra = [.72,.30,.103], ejeBarra=v([-.305,.675,0]).normalize();
const enBarra = h => mueve(baseBarra,ejeBarra,h);

function horquilla(b) {
  torno(b,baseBarra,ejeBarra,[[.015,-.035],[.034,-.024],[.040,.001],[.035,.074],[.026,.115],[.024,.13]],
    grafito,metal,24,true);
  torno(b,baseBarra,ejeBarra,[[.0205,.11],[.0205,.328]],niquel,pulido,36,true);
  torno(b,baseBarra,ejeBarra,[[.021,.291],[.029,.292],[.030,.306],[.028,.321],[.0295,.336],
    [.0275,.573],[.026,.600],[.0255,.727],[.024,.738]],carbono,metal,36,true);
  torno(b,baseBarra,ejeBarra,[[.025,.286],[.030,.289],[.030,.301],[.028,.304]],COLOR.trim,0,24,true);
  const tapa=enBarra(.738);
  tube(b,tapa,mueve(tapa,ejeBarra,.007),.016,6,{color:aluminio,metal,mirror:true});
  tube(b,mueve(tapa,ejeBarra,.007),mueve(tapa,ejeBarra,.0095),.005,8,{color:grafito,metal,mirror:true});
  tube(b,[.72,.30,-.123],[.72,.30,.123],.013,20,{color:acero,metal});
  tube(b,[.72,.30,.121],[.72,.30,.131],.018,6,{color:aluminio,metal,mirror:true});
  for (const [h,grosor] of [[.566,.029],[.711,.021]]) {
    const [x,y]=enBarra(h);
    carcasa(b,[.060,grosor,.207],[x-.008,y,0],.007,grafito,metal);
    torno(b,baseBarra,ejeBarra,[[.026,h-grosor*.55],[.031,h-grosor*.44],[.031,h+grosor*.4],[.026,h+grosor*.56]],
      grafito,metal,24,true);
    tube(b,[x-.036,y,.104],[x-.036,y,.118],.005,6,{color:acero,metal,mirror:true});
  }
  // La montura radial y las pastillas están en el módulo de ruedas. Aquí llega el racor de cada pinza.
  tube(b,[.423,1.064,.189],[.436,1.064,.189],.0078,12,{color:grafito,metal});
  tube(b,[.435,1.064,.189],[.440,1.064,.189],.0064,6,{color:acero,metal});
  latiguillo(b,[[.438,1.064,.189],[.453,1.055,.188],[.475,1.032,.179],[.481,.991,.156],[.481,.865,.126],[.538,.715,.13],
    [.591,.575,.119],[.620,.462,.091],[.610,.397,.085]],.0037,COLOR.trim,0,false,36);
  latiguillo(b,[[.610,.397,.085],[.615,.507,.089],[.624,.618,.071],[.628,.654,0],
    [.621,.615,-.073],[.613,.491,-.091],[.610,.397,-.085]],.0035,COLOR.trim,0,false,30);
  tube(b,[.609,.399,.079],[.610,.397,.090],.0065,6,{color:acero,metal,mirror:true});
}

function tablero(b) {
  // LCD desplazado a la derecha, inclinado hacia el piloto detrás de la máscara.
  const origen=[.458,1.029,.044], normal=v([-.64,.768,0]).normalize(), alto=v([normal.y,-normal.x,0]);
  const dial=(u,w,h)=>v(origen).add(new THREE.Vector3(0,0,u)).addScaledVector(alto,w).addScaledVector(normal,h).toArray();
  const borde=contorno([[-.074,-.025],[-.058,-.035],[.065,-.035],[.079,-.023],[.076,.025],[.047,.035],[-.065,.035],[-.077,.025]],.12);
  const aro=(escala,prof)=>borde.map(([u,w])=>dial(u*escala,w*escala,prof));
  const tapa=aro(1,.004), costura=aro(.992,-.001), haciaLaRueda=normal.clone().negate().toArray();
  molde(b,[costura,aro(.995,-.006),aro(.973,-.010),aro(.89,-.017),aro(.79,-.021),aro(.37,-.025)],
    dial(0,0,-.026),carbono,0,haciaLaRueda,false);
  faja(b,costura,tapa,grafito,0,(a,d)=>v(d).sub(v(origen)).toArray());
  const garganta=contorno([[-.019,-.012],[-.014,-.018],[.009,-.018],[.018,-.011],[.018,.012],
    [.010,.018],[-.013,.018],[-.019,.011]],.24);
  const cuna=(su,sw,altura)=>garganta.map(([u,w])=>dial(.019+u*su,.001+w*sw,altura));
  molde(b,[cuna(1.1,1.13,-.021),cuna(1,1,-.027),cuna(.9,.84,-.035),cuna(.68,.59,-.038)],
    dial(.019,.001,-.039),color('#282d30'),0,haciaLaRueda,false);
  latiguillo(b,[dial(.036,-.009,-.028),dial(.047,-.025,-.022),[.484,.969,.071],[.463,.934,.073]],
    .0034,sombra,0,false,12);
  cara(b,tapa,dial(0,0,.0045),sombra,0,normal.toArray());
  addGrid(b,1,1,(i,j)=>dial(-.063+.112*i,-.022+.045*j,.0055),{color:color('#8e9e9d'),metal:lente,mirror:false,out:normal.toArray()});
  const recta=(x0,y0,x1,y1,ancho,tono)=>{
    const n=Math.hypot(x1-x0,y1-y0);
    addGrid(b,1,1,(s,t)=>dial(THREE.MathUtils.lerp(x0,x1,s)+(t-.5)*ancho*(y0-y1)/n,
      THREE.MathUtils.lerp(y0,y1,s)+(t-.5)*ancho*(x1-x0)/n,.006),{color:tono,metal:0,mirror:false,out:normal.toArray()});
  };
  for (let i=0;i<19;i++) {
    const u=-.057+i*.005;
    recta(u,.011,u+.0018,.015+.004*i/18,.0024,i>14 ? color('#805d53') : grafito);
  }
  for (const [u,w,s,t] of [[-.045,-.016,-.029,-.016],[-.028,-.015,-.028,.003],[-.03,.004,-.045,.004],[-.046,.003,-.046,-.014]]) {
    recta(u,w,s,t,.0025,sombra);
  }
  for (let i=0;i<4;i++) recta(.014+i*.006,-.013,.014+i*.006,-.007,.0025,carbono);
  for (let i=0;i<4;i++) {
    const p=dial(.057,-.020+i*.011,.006);
    tube(b,p,mueve(p,normal,.0006),.0028,12,{color:i===2?color('#398e66'):grafito,metal:lente});
  }
  for(const z of [.000,.088]) tube(b,[.444,.96,z],[.449,1.018,z],.008,10,{color:carbono,metal});
}

function mando(b) {
  const mitad=[[.408,.993,0],[.409,.993,.070],[.402,1.006,.111],[.410,1.043,.150],
    [.397,1.064,.198],[.374,1.071,.254],[.321,1.065,.380]];
  const opuesta=mitad.slice(1).reverse().map(([x,y,z])=>[x,y,-z]);
  latiguillo(b,[...opuesta,...mitad],.0123,aluminio,pulido,false,40);
  for (const z of [-.046,.046]) {
    carcasa(b,[.047,.071,.030],[.410,.961,z],.007,grafito,metal);
    carcasa(b,[.052,.024,.032],[.408,.996,z],.005,grafito,metal);
    for (const x of [.389,.428]) tube(b,[x,1.006,z],[x,1.011,z],.005,6,{color:acero,metal});
  }
  const origen=[.369,1.071,.267], eje=v([-.043,-.001,.113]).normalize();
  const perfil=[[.0185,-.006],[.022,-.003],[.022,0],[.018,.003],[.0161,.010],
    [.0166,.023],[.017,.054],[.0169,.080],[.0164,.102],[.0163,.108],
    [.0176,.110],[.0182,.112],[.018,.114],[.015,.117]];
  torno(b,origen,eje,perfil,color('#282a2c'),goma,36,true);
  // Ranuras diagonales moldeadas en dos bandas, con una nervadura estrecha por cada flanco.
  const tangente=Y.clone().cross(eje).normalize(), radial=eje.clone().cross(tangente);
  for (let n=0;n<9;n++) {
    for (const [h0,h1,signo] of [[.012,.051,1],[.056,.103,-1]]) {
      const p=(i,j)=>{
        const t=i/12, w=j/3, h=THREE.MathUtils.lerp(h0,h1,t);
        const ang=2*P*n/9+signo*(t-.5)*.53+(w-.5)*.052*(.18+.82*Math.sin(P*t)**.55);
        const r=.0162+.00094*Math.sin(P*(h-.004)/.111)+.00019+.00018*Math.sin(w*P)*Math.sin(t*P);
        return v(origen).addScaledVector(eje,h).addScaledVector(tangente,r*Math.cos(ang)).addScaledVector(radial,r*Math.sin(ang)).toArray();
      };
      addGrid(b,12,3,p,{color:color('#35393a'),metal:goma,mirror:true,
        out:v(p(6,2)).sub(v(mueve(origen,eje,(h0+h1)/2))).toArray()});
    }
  }
  torno(b,origen,eje,[[.012,.116],[.015,.118],[.014,.138],[.011,.141],[.0033,.141]],carbono,metal,22,true);
  tube(b,mueve(origen,eje,.138),mueve(origen,eje,.1415),.0034,6,{color:grafito,metal,mirror:true});
  torno(b,origen,eje,[[.017,-.041],[.025,-.037],[.028,-.020],[.025,-.006],[.019,-.003]],carbono,0,20,true);
  carcasa(b,[.019,.010,.023],[.379,1.097,.244],.0035,color('#ab312d'));
  carcasa(b,[.020,.009,.023],[.382,1.095,-.242],.0035,grafito);
  carcasa(b,[.059,.040,.044],[.403,1.076,.191],.006,grafito,metal);
  carcasa(b,[.062,.008,.046],[.403,1.097,.191],.0028,carbono);
  for(const z of [.178,.204]) tube(b,[.401,1.10,z],[.401,1.102,z],.0033,8,{color:acero,metal});
  latiguillo(b,[[.397,1.065,.200],[.433,1.062,.218],[.440,1.047,.250],[.433,1.043,.322],[.413,1.041,.378]],
    .0054,aluminio,pulido,true,22);
  addGeo(b,new THREE.SphereGeometry(.008,12,8),{position:[.413,1.041,.378],color:aluminio,metal:pulido,mirror:true});
  latiguillo(b,[[.395,1.064,-.21],[.462,1.040,-.15],[.467,.976,-.12],[.423,.85,-.101],[.273,.674,-.106]],.004,sombra,0,false,20);
}

function retrovisores(b) {
  const talon=[.384,1.075,.207], eje=v([0,1,0]);
  torno(b,talon,eje,[[.010,0],[.012,.005],[.011,.030],[.009,.036]],carbono,metal,16,true);
  latiguillo(b,[[.383,1.105,.207],[.383,1.124,.209],[.382,1.138,.222],[.373,1.151,.238],[.351,1.194,.290],[.346,1.203,.302]],
    .0047,carbono,pulido,true,18);
  const rotula=[.347,1.199,.296], inclinacion=v([-.22,.56,.76]).normalize();
  torno(b,rotula,inclinacion,[[.0055,-.004],[.007,0],[.0085,.006],[.009,.011],[.010,.016]],grafito,metal,20,true);
  const centro=[.345,1.231,.345];
  const poligono=contorno([[-.065,-.011],[-.054,-.023],[-.020,-.030],[.021,-.028],[.052,-.015],
    [.059,-.001],[.055,.015],[.034,.028],[.002,.031],[-.026,.024],[-.056,.009]],.37);
  const casquete=(u,w,f)=>[centro[0]+f-.19*u+.22*w,centro[1]+w+.28*u,centro[2]+u];
  const corona=(ancho,alto,prof,centroY=0)=>poligono.map(([u,w])=>casquete(u*ancho,w*alto+centroY,prof));
  const borde=corona(1,1,-.003), encaje=corona(.93,.86,-.0069);
  molde(b,[borde,corona(.999,.994,.000),corona(.971,.950,.005),corona(.885,.84,.011,.0006),
    corona(.72,.65,.017,.0024),corona(.51,.44,.022,.003),corona(.26,.22,.024,.0036)],
    casquete(.002,.004,.025),color('#2b3033'),.94,[1,.06,.17]);
  molde(b,[borde,corona(.991,.988,-.0048),corona(.970,.928,-.0071),encaje],null,
    color('#303538'),0,[-1,0,-.17]);
  molde(b,[encaje,corona(.71,.66,-.0093),corona(.37,.33,-.0116)],casquete(0,0,-.0125),
    cristal,pulido,[-1,0,-.17]);
}

export function frenteMT09(b) {
  horquilla(b);
  faros(b);
  mando(b);
  tablero(b);
  retrovisores(b);
}
