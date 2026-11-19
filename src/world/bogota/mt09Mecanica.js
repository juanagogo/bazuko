import * as THREE from 'three';
import { FABRICANTE_MT09 } from './mt09Identidad.js';
import { addGeo, addGrid, tube } from './carParts.js';
import { curve } from './carLoft.js';

// El CP3 de 847 cm³ es un bloque refrigerado por líquido que también cierra el chasis.
// X apunta hacia la rueda delantera, Z hacia la tapa del embrague y el escape.
const color = valor => new THREE.Color(valor).toArray();
const estructura = color('#343739'), nervio = color('#494c4d'), carbon = color('#242628');
const hierro = color('#414345'), basalto = color('#343638'), bloque = color('#4b4d4c');
const aluminio = color('#b7b8ac'), pulido = color('#d4d3c5'), zinc = color('#909089');
const laton = color('#7e6b58'), bronce = color('#6f5e4e'), goma = color('#202222'), negro = color('#151719');
const metal = .3, caucho = .1, dosPi = 2 * Math.PI;
const aceroFrio = color('#898578'), aceroCaliente = color('#938779');
const v3 = p => new THREE.Vector3(...p);

function tubo(b, puntos, radio, tono, material = metal, tramos = 20, lados = 10) {
  const ruta = new THREE.CatmullRomCurve3(puntos.map(v3));
  addGeo(b, new THREE.TubeGeometry(ruta, tramos, radio, lados, false), { color: tono, metal: material });
}

function perfilRedondeado(puntos, hueco = false) {
  const s = hueco ? new THREE.Path() : new THREE.Shape();
  const anterior = puntos.at(-1);
  s.moveTo((anterior[0] + puntos[0][0]) / 2, (anterior[1] + puntos[0][1]) / 2);
  puntos.forEach(([x, y], i) => {
    const sig = puntos[(i + 1) % puntos.length];
    s.quadraticCurveTo(x, y, (x + sig[0]) / 2, (y + sig[1]) / 2);
  });
  s.closePath();
  return s;
}

function pieza(b, contorno, z0, z1, bisel, tono, opciones = {}) {
  const forma = perfilRedondeado(contorno);
  for (const hueco of opciones.huecos ?? []) forma.holes.push(perfilRedondeado(hueco, true));
  const g = new THREE.ExtrudeGeometry(forma, {
    depth: z1 - z0, bevelEnabled: true, bevelSize: bisel, bevelThickness: bisel,
    bevelSegments: 3, curveSegments: 6, steps: 1
  });
  g.translate(0, 0, z0);
  addGeo(b, g, { color: tono, metal: opciones.acabado ?? metal, mirror: opciones.espejo ?? false });
}

function torno(b, origen, direccion, perfil, tono, material = metal, lados = 32) {
  const g = new THREE.LatheGeometry(perfil.map(([radio, altura]) => new THREE.Vector2(radio, altura)), lados);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), v3(direccion).normalize()));
  addGeo(b, g, { position: origen, color: tono, metal: material });
}

function perno(b, x, y, z, signo, radio = .0058, tono = zinc) {
  tube(b, [x,y,z-signo*.001], [x,y,z+signo*.0011], radio * 1.30, 16, {color: carbon, metal});
  tube(b, [x,y,z], [x,y,z + signo * .0038], radio, 6, { color: tono, metal: .31 });
  tube(b, [x,y,z + signo * .0038], [x,y,z + signo * .0041], radio * .44, 6, { color: negro });
}

// Loft en X con sección de ocho caras redondeadas. Las normales cambian en el hombro de cada fundición.
// Estaciones: x, cota inferior, cota superior, z interior, z exterior. Funciona en ambos costados.
function fundicionLongitudinal(b, estaciones, tono, pasos = 34) {
  const [y0,y1,z0,z1] = [1,2,3,4].map(k => curve(estaciones.map(f => [f[0],f[k]])));
  const sumar=(min,max,t)=>min+(max-min)*t;
  const punto=(x,a)=>{
    const c=Math.cos(a),s=Math.sin(a);
    return [x, sumar(y0(x),y1(x),.5+.5*Math.sign(c)*Math.abs(c)**.56),
      sumar(z0(x),z1(x),.5+.5*Math.sign(s)*Math.abs(s)**.54)];
  };
  const inicio=estaciones[0][0], fin=estaciones.at(-1)[0], lados=32;
  for(let j=0;j<4;j++){
    const a=(j+.5)*Math.PI/2;
    addGrid(b,pasos,lados/4,(i,k)=>punto(sumar(inicio,fin,i/pasos),(j+(k/(lados/4)))*Math.PI/2),
      {color:tono,metal,mirror:false,out:[0,Math.cos(a),Math.sin(a)]});
  }
  for(const [x,dir] of [[inicio,-1],[fin,1]]){
    const centro = b.v(x,(y0(x)+y1(x))/2,(z0(x)+z1(x))/2,dir,0,0,undefined,undefined,...tono,metal);
    const borde=Array.from({length:lados},(_,i)=>b.v(...punto(x,i*dosPi/lados),dir,0,0,undefined,undefined,...tono,metal));
    for(let i=0;i<lados;i++){
      const sig=(i+1)%lados;
      if(dir>0) b.tri(centro,borde[i],borde[sig]); else b.tri(centro,borde[sig],borde[i]);
    }
  }
}

function estampado(b, texto, cx, cy, z, escala, tono) {
  const letras = {
    Y: [[[0,1],[.34,.53],[.68,1]],[[.34,.53],[.34,0]]],
    A: [[[0,0],[.32,1],[.64,0]],[[.14,.38],[.50,.38]]],
    M: [[[0,0],[0,1],[.35,.46],[.69,1],[.69,0]]],
    H: [[[0,1],[0,0]],[[0,.48],[.63,.48]],[[.63,1],[.63,0]]],
    C: [[[.62,.84],[.46,1],[.17,.96],[0,.72],[0,.26],[.19,.04],[.53,.06],[.65,.22]]],
    P: [[[0,0],[0,1],[.42,1],[.60,.82],[.57,.63],[.39,.53],[0,.53]]],
    3: [[[0,.89],[.39,1],[.62,.85],[.54,.63],[.29,.51],[.52,.44],[.61,.21],[.43,.04],[0,.10]]]
  };
  [...texto].forEach((letra, i) => {
    for (const trazo of letras[letra]) {
      const xs = cx + (i * .85 - texto.length * .425) * escala;
      for (let k = 1; k < trazo.length; k++) {
        const punto = ([x,y]) => [xs + (x + .08*y) * escala, cy + (y - .5) * escala, z];
        tube(b, punto(trazo[k-1]), punto(trazo[k]), escala * .044, 5, { color: tono, metal, open: true });
      }
    }
  });
}

function motor(b) {
  // Bancada de cigüeñal y caja de cambios en una sola fundición; el sumidero se estrecha abajo.
  const bancada = [[-.231,.49],[-.222,.538],[-.08,.565],[.123,.552],[.237,.483],[.244,.354],
    [.170,.269],[.079,.238],[-.094,.248],[-.184,.305],[-.251,.393]];
  pieza(b, bancada, -.139, .140, .009, basalto);
  pieza(b, [[-.164,.315],[.155,.318],[.153,.257],[.085,.219],[-.100,.224],[-.163,.260]], -.116, .123, .006, carbon);
  for(const signo of [-1,1]){
    tubo(b,[[-.163,.323,signo*.126],[-.111,.303,signo*.135],[.091,.301,signo*.135],
      [.166,.328,signo*.132]],.0042,carbon);
    for(const x of [-.126,-.069,.014,.082]){
      tubo(b,[[x,.311,signo*.134],[x+.013,.264,signo*.133],[x+.028,.247,signo*.116]],.0043,hierro);
      perno(b,x,.297,signo*.139,signo,.005);
    }
  }
  // La camisa de agua abraza los tres cilindros; no hay aletas de refrigeración al aire.
  const cilindros = [[.005,.473],[.155,.438],[.286,.671],[.253,.719],[.096,.742],[-.025,.514]];
  pieza(b, cilindros, -.143, .142, .009, hierro);
  const culata = [[.099,.688],[.263,.656],[.292,.706],[.274,.754],[.101,.781],[.075,.747]];
  pieza(b, culata, -.161, .155, .006, bloque);
  pieza(b, [[.093,.744],[.277,.711],[.283,.753],[.246,.779],[.112,.802],[.082,.781]],
    -.158, .153, .007, basalto);
  // Puertos, bobinas y manguitos de las tres mariposas detrás de la culata.
  for (const z of [-.095, 0, .095]) {
    tube(b,[.145,.732,z],[.088,.803,z],.029,18,{color:goma,metal:caucho});
    tube(b,[.110,.778,z],[.103,.787,z],.033,18,{color:zinc,metal});
    tube(b,[.191,.762,z],[.205,.802,z],.014,12,{color:negro});
    tubo(b, [[.205,.802,z],[.166,.813,z],[.119,.795,z+.017],[.061,.792,z+.017]],.0045,goma,caucho,12,7);
    const camisa = new THREE.CylinderGeometry(.058,.055,.210,24);
    addGeo(b,camisa,{position:[.175,.557,z],rotation:[0,0,-.43],color:hierro,metal});
    tube(b,[.248,.538,z],[.254,.535,z],.011,16,{color:basalto,metal});
  }
  for(const signo of [-1,1]){
    const z=signo*.153;
    tubo(b,[[.071,.758,z],[.143,.754,z],[.255,.728,z],[.281,.711,z]],.0046,negro);
    tubo(b,[[.087,.686,z],[.185,.666,z],[.252,.651,z]],.0035,carbon);
    for(const [x,y] of [[.105,.705],[.159,.700],[.249,.677],[.242,.738]]) perno(b,x,y,signo*.163,signo,.0054);
  }
  // Túnel de la distribución, diagonal, con dos costillas y tapón del árbol de levas.
  pieza(b, [[.057,.402],[.123,.364],[.210,.445],[.276,.651],[.273,.723],
    [.239,.754],[.194,.742],[.151,.666],[.042,.478]], .121, .166, .007, bloque);
  for (const [x, y] of [[.096,.441],[.132,.442]]) {
    tubo(b, [[x,y,.172],[x+.043,y+.065,.174],[x+.062,y+.108,.174]], .007, zinc, metal, 9, 8);
  }
  torno(b,[.229,.699,.168],[0,0,1],[[.040,0],[.039,.007],[.034,.012],[.025,.014],[.001,.014]],bronce);
  perno(b,.211,.607,.170,1,.010);
  // Embrague grande sobre el lado derecho. El centro fundido lleva su marca en bajo contraste.
  pieza(b, [[-.199,.488],[-.160,.545],[-.055,.590],[.050,.571],[.094,.493],[.068,.383],
    [.007,.275],[-.036,.248],[-.093,.262],[-.159,.346]], .136,.171,.011,hierro);
  const embrague = [-.055,.444,.170];
  torno(b, embrague,[0,0,1],[[.120,.005],[.122,.010],[.120,.015],[.113,.017]],negro);
  torno(b, embrague,[0,0,1],[[.117,.015],[.114,.025],[.105,.032],[.086,.039],
    [.066,.042],[.057,.044],[.055,.047],[.052,.048],[.001,.048]],hierro);
  torno(b, embrague,[0,0,1],[[.055,.046],[.054,.049],[.050,.050]],carbon);
  estampado(b,FABRICANTE_MT09.toUpperCase(),-.055,.445,.219,.014,basalto);
  for (const [x,y] of [[-.172,.496],[-.118,.555],[-.026,.569],[.048,.522],[.068,.429],
    [.021,.344],[-.016,.265],[-.096,.284],[-.133,.348],[-.180,.419]]) {
    torno(b,[x,y,.168],[0,0,1],[[.013,0],[.012,.012],[.010,.018],[.004,.019]],hierro,metal,18);
    perno(b,x,y,.187,1,.0062);
  }
  pieza(b,[[-.148,.398],[-.107,.359],[-.069,.333],[-.035,.329],[.007,.340],
    [-.003,.299],[-.035,.272],[-.094,.287],[-.132,.335]],.173,.181,.003,hierro);
  torno(b,[-.045,.314,.182],[0,0,1],[[.014,0],[.013,.004],[.009,.005],[.001,.005]],carbon);
  tube(b,[-.045,.314,.186],[-.045,.314,.187],.0086,18,{color:bronce,metal});
  tubo(b,[[.020,.516,.182],[.038,.530,.185],[.070,.540,.188]],.012,hierro);
  tubo(b,[[.037,.512,.177],[.041,.510,.203],[.058,.519,.230],[.084,.531,.232]],.009,carbon);
  tubo(b,[[.080,.528,.227],[.121,.571,.204],[.170,.638,.186],[.192,.755,.164]],.005,goma,caucho);
  tube(b,[.106,.550,.213],[.117,.562,.208],.0075,8,{color:zinc,metal:.31});
  // Tapa pequeña bronce junto al extremo del cigüeñal.
  pieza(b, [[.030,.362],[.044,.426],[.093,.466],[.147,.457],[.179,.401],[.174,.343],
    [.124,.318],[.068,.317]],.156,.182,.006,bronce);
  torno(b,[.108,.389,.179],[0,0,1],[[.055,0],[.052,.012],[.042,.023],[.034,.025],[.001,.025]],laton);
  estampado(b,'CP3',.109,.389,.2045,.0075,bronce);
  for (const [x,y] of [[.047,.360],[.057,.425],[.135,.450],[.169,.399],[.151,.342],[.075,.326]]) {
    tube(b,[x,y,.175],[x,y,.193],.0086,16,{color:bronce,metal});
    perno(b,x,y,.194,1,.0052);
  }
  // Alternador a la izquierda con filete perimetral oscuro, nervios y tornillos independientes.
  const alternador = [.082,.411,-.147];
  torno(b,alternador,[0,0,-1],[[.107,0],[.111,.008],[.107,.023],[.093,.034],[.065,.042],[.001,.043]],bloque);
  torno(b,alternador,[0,0,-1],[[.066,.041],[.064,.044],[.060,.0445]],carbon);
  for (let i=0;i<9;i++) {
    const a = i * dosPi / 9;
    perno(b,.082 + .103*Math.cos(a),.411 + .103*Math.sin(a),-.159,-1,.0055);
  }
  pieza(b, [[-.200,.503],[-.106,.515],[-.061,.454],[-.090,.382],[-.183,.354],[-.230,.398]],
    -.171,-.140,.008,carbon);
  const filtro = [.203,.326,-.042];
  torno(b,filtro,[.98,-.19,0],[[.040,0],[.044,.006],[.044,.045],[.039,.052],[.001,.052]],negro);
  pieza(b,[[.167,.385],[.215,.402],[.262,.382],[.274,.338],[.242,.299],[.192,.296],[.153,.326]],
    .089,.135,.005,basalto);
  torno(b,[.216,.351,.134],[0,0,1],[[.042,0],[.043,.006],[.037,.016],[.020,.022],[.001,.022]],hierro);
  for(const [x,y] of [[.182,.374],[.250,.368],[.239,.318],[.183,.325]]) perno(b,x,y,.144,1,.0051);
  tubo(b,[[.227,.363,.124],[.252,.375,.137],[.264,.415,.154],[.254,.464,.170],
    [.270,.500,.172],[.303,.511,.170],[.328,.535,.171]],.016,goma,caucho,32,14);
  tube(b,[.260,.425,.158],[.258,.436,.162],.018,20,{color:zinc,metal:.31});
}

function radiador(b) {
  // Frente inclinado, con una leve curvatura en planta. Las láminas corren a lo ancho.
  const punto = (u,v,relieve=0) => [.348+.072*v+.013*(1-u*u)+relieve, .559+.210*v, .185*u];
  addGrid(b,24,16,(i,j)=>punto(i/12-1,j/16),{color:negro,mirror:false,out:[1,-.3,0]});
  for (let i=0; i<=35; i++) {
    const v=i/35;
    addGrid(b,12,2,(j,k)=>punto(j/6-1,v+(k-1)*.005,k===1?.0035:.0005),
      {color:(_u, k) => k === .5 ? zinc : hierro, mirror:false, out:[1,-.2,0], metal});
  }
  for(const u of [-.98,-.60,-.20,.20,.60,.98]) {
    const a=punto(u,0,.004), c=punto(u,1,.004);
    tube(b,a,c,Math.abs(u)>.9?.006:.0016,5,{color:carbon,metal});
  }
  for(const v of [0,1]) tubo(b,[-1,-.5,0,.5,1].map(u=>punto(u,v)),.007,estructura,metal,18,8);
  for(const lado of [-1,1]) {
    const z=lado*.182;
    pieza(b,[[.319,.572],[.347,.560],[.419,.766],[.402,.780],[.369,.773]],z-.008,z+.008,.004,carbon);
  }
  tubo(b,[[.360,.593,.170],[.331,.546,.168],[.287,.509,.155],[.242,.530,.125]],.018,goma,caucho);
  tubo(b,[[.378,.714,-.177],[.322,.713,-.174],[.266,.672,-.164],[.227,.654,-.152]],.017,goma,caucho);
  tube(b,[.320,.537,.165],[.311,.530,.164],.0195,16,{color:zinc,metal});
}

function chasis(b) {
  // La mitad inferior de la caja del filtro alimenta las tres mariposas. Desde el lateral
  // se ve detrás del paso del bastidor y continúa hasta el compartimento de la batería.
  pieza(b,[[-.422,.765],[-.367,.741],[-.216,.729],[-.130,.752],[-.065,.797],[.013,.843],[.152,.833],[.148,.792],
    [.090,.736],[-.031,.671],[-.144,.625],[-.219,.637],[-.309,.692]],-.095,.095,.012,carbon,{acabado:caucho});
  pieza(b,[[-.382,.744],[-.356,.746],[-.232,.736],[-.134,.754],[-.065,.801],[.001,.843],[.143,.832],
    [.147,.816],[.023,.816],[-.128,.737],[-.210,.715],[-.335,.724]],-.100,.100,.006,basalto,{acabado:caucho});
  pieza(b,[[-.537,.811],[-.474,.798],[-.368,.746],[-.345,.719],[-.405,.707],[-.516,.758]],-.082,.083,.007,negro,{acabado:caucho});
  for (const s of [-1,1]) {
    const z=s*.109;
    tubo(b,[[-.430,.779,z],[-.317,.730,z],[-.232,.706,z],[-.123,.698,z],
      [-.047,.718,z],[.061,.739,z],[.116,.756,z]],.008,goma,caucho);
    for (const [x,y] of [[-.304,.733],[-.143,.702],[-.017,.721]]) {
      tube(b,[x-.003,y+.002,z],[x+.004,y+.002,z],.009,12,{color:basalto,metal:caucho});
    }
    tube(b,[-.060,.661,s*.103],[-.060,.661,s*.119],.014,20,{color:hierro,metal});
    perno(b,-.060,.661,s*.119,s,.007);
  }
  // Dos vigas fundidas: cada costado rodea el extremo de la culata y lleva su propio hueco triangular.
  const viga = [[-.261,.624],[-.212,.685],[-.031,.751],[.160,.832],[.348,.912],[.433,.940],
    [.453,.913],[.433,.853],[.373,.823],[.313,.733],[.286,.608],[.245,.582],
    [.216,.608],[.224,.720],[.203,.771],[.150,.780],[.102,.748],[.078,.647],
    [.056,.598],[-.009,.598],[-.177,.615],[-.241,.600]];
  const ventana = [[-.154,.640],[-.117,.653],[.047,.721],[.112,.747],[.085,.690],
    [.057,.633],[.027,.630],[-.111,.632]];
  pieza(b,viga,.119,.157,.008,estructura,{espejo:true,huecos:[ventana]});
  const lomo=curve([[-.236,.641],[-.203,.673],[-.057,.735],[.073,.788],[.214,.849],[.351,.907],[.414,.927]]);
  addGrid(b,36,6,(i,j)=>{
    const t=i/36, x=-.236+.650*t, u=j/6, amplitud = .2+.8*Math.sin(Math.PI*t)**.55;
    return [x,lomo(x)-u*.041*amplitud,.154+amplitud*(.005+.009*Math.sin(u*Math.PI))];
  },{color:estructura,metal,mirror:true,out:[-.15,.40,1]});
  const trasera = [[-.249,.635],[-.195,.622],[-.151,.603],[-.173,.536],[-.215,.455],
    [-.231,.389],[-.273,.389],[-.279,.442],[-.252,.532],[-.286,.574]];
  pieza(b,trasera,.084,.122,.007,estructura,{espejo:true});
  for(const signo of [-1,1]) {
    for(const [x,y] of [[.240,.611],[.045,.617],[-.215,.624],[-.248,.419],[.355,.847]]) {
      const z=signo*(x===-.248?.128:.166);
      perno(b,x,y,z,signo,.010,x===.045?negro:zinc);
    }
    tubo(b,[[-.25,.608,signo*.111],[-.332,.683,signo*.115],[-.504,.818,signo*.103],[-.753,.906,signo*.074]],.018,estructura);
    tubo(b,[[-.33,.679,signo*.114],[-.458,.692,signo*.118],[-.676,.826,signo*.090],[-.754,.907,signo*.075]],.012,carbon);
    perno(b,-.330,.684,signo*.132,signo,.0085);
  }
  tube(b,[.438,.844,0],[.395,.955,0],.043,20,{color:estructura,metal});
  tube(b,[-.216,.635,-.119],[-.216,.635,.119],.025,16,{color:estructura,metal});
}

function escape(b) {
  const colores=[[.16,aceroFrio],[.23,color('#a09985')],[.34,aceroCaliente],
    [.47,color('#9b9483')],[.55,color('#756f66')],[.60,color('#756a65')],[.66,color('#6b5e51')]];
  const canales=[0,1,2].map(k=>curve(colores.map(([y,c])=>[y,c[k]])));
  for(const [i,z] of [-.099,0,.099].entries()) {
    const x=.261 + (i===1?.004:0), zBajo=z*.71;
    tube(b,[x-.010,.659,z],[x+.021,.649,z],.030,20,{color:basalto,metal});
    tube(b,[x+.008,.653,z],[x+.017,.650,z],.032,20,{color:bronce,metal});
    tubo(b,[[x+.012,.655,z],[.300,.635,z],[.323,.575,z+.010],[.328+.012*i,.479,z+.016],
      [.316+.013*i,.338,z+.020],[.286+.007*i,.250,z+.018],[.227,.198,zBajo],
      [.136,.174,zBajo*.81],[.044,.174,zBajo*.56]], .0195,
      (_x,y)=>canales.map(c=>c(y+(i-1)*.008)),.32,50,19);
    for(const dz of [-.029,.029]) tube(b,[x+.01,.664,z+dz],[x+.02,.662,z+dz],.0046,6,{color:zinc,metal:.31});
  }
  tube(b,[.208,.198,.061],[.203,.216,.073],.008,6,{color:zinc,metal:.31});
  tube(b,[.203,.216,.073],[.200,.230,.080],.0055,12,{color:basalto,metal});
  tubo(b,[[.200,.229,.080],[.192,.254,.092],[.153,.278,.107],[.131,.303,.113]],.0028,goma,caucho);
  // Colector y cámara de expansión de chapa soldada situados bajo el cárter.
  fundicionLongitudinal(b,[[-.398,.212,.258,-.056,.073],[-.345,.177,.287,-.083,.108],
    [-.227,.149,.275,-.101,.122],[-.122,.143,.249,-.102,.117],[-.033,.146,.223,-.087,.096],
    [.047,.154,.205,-.072,.071],[.083,.162,.197,-.060,.058]],color('#797970'),32);
  tubo(b,[[-.359,.224,.101],[-.271,.203,.121],[-.180,.197,.122],[-.073,.185,.108],
    [.025,.179,.080],[.082,.179,.058]],.0027,color('#8b8072'),.32);
  tubo(b,[[-.111,.148,-.069],[-.111,.144,-.015],[-.111,.148,.077],[-.111,.165,.109],
    [-.111,.197,.117],[-.111,.229,.103]],.0028,color('#6c6762'),.32);
  // Boquilla ovoide corta: labio del escudo, embutición interior y boca negra abierta orientada atrás y afuera.
  const origen=[-.298,.219,.058], eje=v3([-.66,.33,.70]).normalize();
  const vertical=new THREE.Vector3(0,1,0).addScaledVector(eje,-eje.y).normalize();
  const lateral=new THREE.Vector3().crossVectors(eje,vertical).normalize();
  const punto=(d,w,h,a)=>v3(origen).addScaledVector(eje,d)
    .addScaledVector(vertical,h*Math.cos(a)).addScaledVector(lateral,w*Math.sin(a)).toArray();
  const anillos=[
    [0,.044,.041],[.035,.061,.050],[.099,.077,.058],[.149,.077,.057],
    [.173,.069,.051],[.179,.062,.046],[.177,.053,.038],[.165,.050,.035],[.124,.045,.029]
  ];
  for(let k=1;k<anillos.length;k++){
    const [a,c]=[anillos[k-1],anillos[k]], segmentos=40;
    for(let i=0;i<segmentos;i++) {
      const angulo=(i+.5)*dosPi/segmentos;
      const normal=v3(punto(c[0],c[1],c[2],angulo)).sub(v3(origen).addScaledVector(eje,c[0]));
      if(k>=6) normal.multiplyScalar(-1).addScaledVector(eje,.15);
      addGrid(b,1,1,(u,v)=>punto(...(u?c:a), (i+v)*dosPi/segmentos),
        {out:normal.toArray(),color:k>=8?negro:k===7?carbon:k===1?zinc:k===5?pulido:aluminio,
          metal:k>=7?metal:.32,mirror:false});
    }
  }
  const centro=b.v(...v3(origen).addScaledVector(eje,.123).toArray(),...eje.toArray(),undefined,undefined,...negro,caucho);
  const borde=Array.from({length:40},(_,i)=>b.v(...punto(.124,.045,.029,i*dosPi/40),...eje.toArray(),undefined,undefined,...negro,caucho));
  for(let i=0;i<40;i++) b.tri(centro,borde[i],borde[(i+1)%40]);
}

function trenTrasero(b) {
  fundicionLongitudinal(b,[[-.760,.298,.334,.087,.126],[-.706,.298,.357,.082,.128],
    [-.610,.313,.397,.075,.134],[-.481,.343,.475,.070,.145],[-.402,.378,.501,.065,.148],
    [-.324,.390,.480,.063,.136],[-.239,.391,.442,.068,.122]],estructura);
  fundicionLongitudinal(b,[[-.755,.300,.329,-.127,-.090],[-.690,.299,.350,-.130,-.088],
    [-.592,.321,.377,-.134,-.078],[-.453,.347,.423,-.143,-.067],
    [-.330,.377,.450,-.135,-.063],[-.239,.390,.444,-.123,-.068]],estructura);
  tubo(b,[[-.591,.343,.106],[-.599,.372,.140],[-.554,.414,.137],[-.458,.468,.141],
    [-.389,.489,.137],[-.313,.470,.130],[-.261,.464,.118],[-.222,.493,.107]],.0042,goma,caucho,30,8);
  for(const [x,y,z] of [[-.545,.421,.138],[-.385,.489,.137]]) {
    tubo(b,[[x-.004,y-.004,z-.006],[x-.003,y+.004,z+.003],[x+.004,y+.004,z+.004],
      [x+.005,y-.004,z-.003]],.0018,zinc);
  }
  tube(b,[-.240,.413,-.132],[-.240,.413,.137],.035,26,{color:basalto,metal});
  for(const lado of [-1,1]){
    const z=lado*.137;
    pieza(b,[[-.759,.302],[-.742,.332],[-.691,.334],[-.689,.299]],z-.003,z+.003,.002,zinc);
    perno(b,-.72,.315,z+lado*.003,lado,.014);
    perno(b,-.240,.413,z,lado,.015,aluminio);
  }
  // Amortiguador único casi horizontal, entre la traviesa alta y el balancín del basculante.
  const a=v3([-.112,.647,0]), c=v3([-.417,.551,0]), eje=c.clone().sub(a).normalize();
  const ortogonal=new THREE.Vector3(0,0,1), radial=new THREE.Vector3().crossVectors(eje,ortogonal).normalize();
  const posicion=t=>a.clone().lerp(c,t).toArray();
  tube(b,posicion(.04),posicion(.57),.025,20,{color:carbon,metal});
  tube(b,posicion(.52),posicion(.97),.010,18,{color:pulido,metal:.31});
  for (const t of [.17,.23,.80]) tube(b,posicion(t),posicion(t+.032),.041,24,{color:zinc,metal});
  const espira=Array.from({length:120},(_,i)=>{
    const t=i/119, angulo=t*dosPi*7;
    return a.clone().lerp(c,.235+t*.563).addScaledVector(ortogonal,.032*Math.cos(angulo))
      .addScaledVector(radial,.032*Math.sin(angulo)).toArray();
  });
  tubo(b,espira,.0058,color('#737775'),metal,148,8);
  tubo(b,[[-.443,.448,0],[-.419,.511,0],[-.418,.552,0]],.016,estructura);
  for(const [x,y] of [[-.417,.551],[-.112,.647]]) tube(b,[x,y,-.047],[x,y,.047],.012,14,{color:zinc,metal});
}

// Vista desde el costado: los extremos abrazan los dos remaches, la cintura deja libres los rodillos.
function placaCadena(b, inicio, fin, z, tono) {
  const t=fin.clone().sub(inicio).normalize(), n=new THREE.Vector2(-t.y,t.x);
  const medio=inicio.clone().lerp(fin,.5), ancho=.0037, largo=inicio.distanceTo(fin)/2;
  const contorno=[[-largo,ancho],[-largo-ancho*.75,ancho*.70],[-largo-ancho,0],
    [-largo-ancho*.75,-ancho*.70],[-largo,-ancho],[0,-ancho*.66],[largo,-ancho],
    [largo+ancho*.75,-ancho*.70],[largo+ancho,0],[largo+ancho*.75,ancho*.70],[largo,ancho],[0,ancho*.66]];
  const puntos=contorno.map(([x,y])=>medio.clone().addScaledVector(t,x).addScaledVector(n,y));
  for(const lado of [-1,1]){
    const plano=z+lado*.0008;
    const centro=b.v(medio.x,medio.y,plano,0,0,lado,undefined,undefined,...tono,metal);
    const borde=puntos.map(p=>b.v(p.x,p.y,plano,0,0,lado,undefined,undefined,...tono,metal));
    for(let i=0;i<borde.length;i++){
      const sig=(i+1)%borde.length;
      if(lado>0) b.tri(centro,borde[i],borde[sig]);
      else b.tri(centro,borde[sig],borde[i]);
    }
  }
  puntos.forEach((a,i)=>{
    const c=puntos[(i+1)%puntos.length], dir=c.clone().sub(a).normalize();
    const vertices=[[a,-1],[c,-1],[c,1],[a,1]].map(([p,lado])=>
      b.v(p.x,p.y,z+lado*.0008,dir.y,-dir.x,0,undefined,undefined,...tono,metal));
    b.quad(...vertices);
  });
}

function transmision(b) {
  // Las dos ramas se continúan en los arcos de los piñones. Se alternan las placas interiores y exteriores.
  const trasero=new THREE.Vector2(-.72,.315), delantero=new THREE.Vector2(-.204,.410);
  const delta=delantero.clone().sub(trasero), distancia=delta.length(), rumbo=Math.atan2(delta.y,delta.x);
  const superior=rumbo+Math.acos((.109-.047)/distancia), inferior=2*rumbo-superior;
  const enArco=(centro,r,theta)=>centro.clone().add(new THREE.Vector2(Math.cos(theta)*r,Math.sin(theta)*r));
  const arribaTras=enArco(trasero,.109,superior), arribaDel=enArco(delantero,.047,superior);
  const abajoTras=enArco(trasero,.109,inferior), abajoDel=enArco(delantero,.047,inferior);
  const recta=arribaDel.distanceTo(arribaTras), giroDel=superior-inferior, giroTras=dosPi-giroDel;
  const arcoDel=.047*giroDel, arcoTras=.109*giroTras, largo=2*recta+arcoDel+arcoTras;
  const paso=d=>{
    if(d<recta) return arribaTras.clone().lerp(arribaDel,d/recta);
    d-=recta;
    if(d<arcoDel) return enArco(delantero,.047,superior-d/.047);
    d-=arcoDel;
    if(d<recta) return abajoDel.clone().lerp(abajoTras,d/recta);
    return enArco(trasero,.109,inferior-(d-recta)/.109);
  };
  const cuenta=2*Math.round(largo/.015875/2);
  for(let i=0;i<cuenta;i++){
    const a=paso(largo*i/cuenta), c=paso(largo*((i+1)%cuenta)/cuenta);
    tube(b,[a.x,a.y,-.109],[a.x,a.y,-.101],.0036,9,{color:aluminio,metal});
    for(const lado of [-1,1]){
      const z=-.105+lado*(i%2?.0052:.0034);
      placaCadena(b,a,c,z,i%2?laton:carbon);
    }
  }
}

function mandos(b) {
  const soporte=[[-.326,.500],[-.286,.528],[-.214,.494],[-.208,.455],[-.281,.429],
    [-.236,.414],[-.203,.419],[-.204,.385],[-.317,.383],[-.357,.411],[-.352,.457]];
  const calado=[[-.320,.463],[-.288,.481],[-.245,.470],[-.291,.448],[-.325,.440]];
  pieza(b,soporte,.142,.154,.004,aluminio,{espejo:true,huecos:[calado]});
  for(const signo of [-1,1]){
    const z=signo*.158;
    perno(b,-.220,.461,z,signo,.010);
    perno(b,-.286,.498,z,signo,.006);
    const x=-.326, y=.415;
    tube(b,[x,y,z],[x,y,z+signo*.082],.011,16,{color:aluminio,metal});
    for(let i=0;i<12;i++){
      const z1=z+signo*(.012+i*.0058);
      tube(b,[x,y,z1],[x,y,z1+signo*.0028],.013,12,{color:zinc,metal});
    }
    tubo(b,[[-.48,.788,z*.66],[-.557,.678,z*.80],[-.600,.644,z*.98]],.009,estructura);
    tubo(b,[[-.600,.644,z*.98],[-.506,.663,z*.88],[-.404,.731,z*.72]],.008,estructura);
    tube(b,[-.596,.647,z],[-.632,.694,z+signo*.038],.011,12,{color:aluminio,metal});
  }
  tubo(b,[[-.28,.415,.164],[-.257,.369,.168],[-.210,.359,.181],[-.173,.361,.185]],.0075,aluminio);
  tube(b,[-.175,.360,.177],[-.175,.360,.213],.009,12,{color:zinc,metal});
  tubo(b,[[-.284,.424,-.159],[-.259,.384,-.175],[-.181,.378,-.178]],.0066,zinc);
  tube(b,[-.183,.379,-.174],[-.183,.379,-.208],.008,14,{color:goma,metal:caucho});
  tubo(b,[[-.27,.426,-.152],[-.247,.461,-.146],[-.178,.514,-.141]],.0032,aluminio);
  tube(b,[-.251,.459,-.148],[-.231,.480,-.147],.0063,12,{color:carbon,metal});
  // Pata lateral y su muelle de retorno.
  tubo(b,[[-.262,.362,-.118],[-.286,.315,-.136],[-.368,.162,-.178],[-.429,.024,-.199]],.009,carbon);
  pieza(b,[[-.453,.012],[-.443,.008],[-.400,.013],[-.407,.021],[-.440,.024]],-.220,-.182,.002,carbon);
}

export function mecanicaMT09(b) {
  motor(b);
  radiador(b);
  chasis(b);
  escape(b);
  trenTrasero(b);
  transmision(b);
  mandos(b);
}
