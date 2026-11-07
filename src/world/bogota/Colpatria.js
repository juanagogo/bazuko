import * as THREE from 'three';

export const COLPATRIA = Object.freeze({ x: 81, z: 168, width: 24, depth: 26, height: 112 });
export const COLPATRIA_ANNEX = Object.freeze({ x: 98, z: 168, width: 10, depth: 18, height: 22 });
export const BUS_DETOUR = Object.freeze({ z0: 80, z1: 260, offset: 44 });

export function bridgeCenter(z) {
  const {z0,z1,offset}=BUS_DETOUR;
  const t=THREE.MathUtils.clamp(z<154?(z-z0)/(154-z0):(z1-z)/(z1-182),0,1);
  const ease=t*t*t*(10+t*(-15+6*t));
  return 75+offset*ease;
}
export function bridgeNormal(z) {
  const dx=(bridgeCenter(z+.01)-bridgeCenter(z-.01))/.02;
  const scale=Math.hypot(1,dx);
  return {x:1/scale,z:-dx/scale};
}
// El eje nunca sale de X 75 a X 75 + offset: con el desplazamiento del carril, un punto más lejos
// que esto de la franja no está sobre el bus. Los llamadores lo usan para no buscar el carril.
export const BUS_AXIS_MIN_X = 75, BUS_AXIS_MAX_X = 75 + BUS_DETOUR.offset;

// La ciudad pregunta miles de veces por las mismas Z al construir suelo, viaducto y lago.
// Mismo resultado exacto: solo se guarda lo ya calculado, por carril.
const pathCache = new Map();
const PATH_CACHE_LIMIT = 8192;

// Los carriles son desplazamientos perpendiculares del mismo eje. Se invierte
// su Z para mantener el contrato de rutas expresadas en coordenadas del mundo.
export function busPathX(z,laneX=78.5) {
  if(z<=BUS_DETOUR.z0-5 || z>=BUS_DETOUR.z1+5) return laneX;
  let lane=pathCache.get(laneX);
  if(!lane) pathCache.set(laneX,lane=new Map());
  const cached=lane.get(z);
  if(cached!==undefined) return cached;
  if(lane.size>=PATH_CACHE_LIMIT) lane.clear();
  const x=searchPathX(z,laneX);
  lane.set(z,x);
  return x;
}
function searchPathX(z,laneX) {
  const offset=laneX-75;
  let lo=z-10,hi=z+10;
  for(let i=0;i<28;i++) {
    const t=(lo+hi)/2;
    if(t+bridgeNormal(t).z*offset<z)lo=t;else hi=t;
  }
  const t=(lo+hi)/2;
  return bridgeCenter(t)+bridgeNormal(t).x*offset;
}
export function busHeading(z,laneX=78.5) {
  const dx=busPathX(z-.01,laneX)-busPathX(z+.01,laneX),scale=Math.hypot(dx,.02);
  return {x:dx/scale,z:-.02/scale};
}
export function busLaneSpread() {return 0;}
export function southBusPathX(z,laneX=71.5) {return busPathX(z,laneX);}

export function paintColpatria(map) {
  // Reserva el volumen barrido por el bus completo, también en las curvas.
  for (let z = BUS_DETOUR.z0; z <= BUS_DETOUR.z1; z += .4) {
    const x = busPathX(z), h = busHeading(z);
    for (let along = -9.2; along <= 9.2; along += .8) for (let side = -3; side <= 3; side += .5) {
      const tx = Math.round((x + h.x * along - h.z * side) / 2);
      const tz = Math.round((z + h.z * along + h.x * side) / 2);
      if (map[tz][tx] !== 'road') map[tz][tx] = 'busway';
    }
  }
  for (let z = 78; z <= 90; z++) for (let x = 35; x <= 46; x++) map[z][x] = 'colpatria';
  for (let z = 80; z <= 88; z++) for (let x = 47; x <= 51; x++) map[z][x] = 'colpatriaAnnex';
}

/** Conjunto estilizado: torre ancha, zócalo acristalado y volumen comercial gris. */
export function buildColpatria({ createSign = null } = {}) {
  const group = new THREE.Group(); group.name = 'Torre Colpatria';
  const stone = new THREE.MeshStandardMaterial({ color: '#c1beb0', roughness: .87 });
  const grey = new THREE.MeshStandardMaterial({ color: '#a9aaa5', roughness: .95 });
  const glass = new THREE.MeshStandardMaterial({ color: '#26353b', roughness: .32, metalness: .28 });
  const frame = new THREE.MeshStandardMaterial({ color: '#505b60', roughness: .65 });
  const box = (w, h, d, x, y, z, material, name = '') => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z); mesh.name = name;
    mesh.castShadow = mesh.receiveShadow = true; group.add(mesh); return mesh;
  };
  const { x, z, width: w, depth: d, height } = COLPATRIA;
  box(w, height - 2, d, x, (height - 2) / 2, z, glass, 'Cuerpo de la torre');
  box(w - 1.5, 2, d - 1.5, x, height - 1, z, stone, 'Coronación');
  const lights = ['#e52a32', '#134bff', '#ffcc32'].map(color => new THREE.MeshStandardMaterial({
    color, emissive: color, emissiveIntensity: 1.8, roughness: .5
  }));
  for (const side of [-1, 1]) {
    for (let i = 0; i <= 8; i++) {
      const fx = x - w / 2 + .4 + i * (w - .8) / 8;
      box(.72, 110, .48, fx, 55, z + side * d / 2, stone, 'Costilla vertical');
      for (const [index, y, h] of [[0, 25, 38], [1, 58, 28], [2, 91, 38]])
        box(.11, h, .04, fx, y, z + side * (d / 2 + .25), lights[index]);
    }
    for (let i = 0; i <= 9; i++) {
      const fz = z - d / 2 + .4 + i * (d - .8) / 9;
      box(.48, 110, .72, x + side * w / 2, 55, fz, stone, 'Costilla vertical');
      for (const [index, y, h] of [[0, 25, 38], [1, 58, 28], [2, 91, 38]])
        box(.04, h, .11, x + side * (w / 2 + .25), y, fz, lights[index]);
    }
    // Travesaños entre pisos: proporcionan escala al vidrio, incluso desde la calle.
    for (let y = 5; y < 110; y += 3) {
      box(w, .16, .05, x, y, z + side * (d / 2 + .03), frame);
      box(.05, .16, d, x + side * (w / 2 + .03), y, z, frame);
    }
  }
  // Acceso vidriado a escala peatonal y marquesina fina sobre la entrada norte.
  box(7, .25, 1.1, x, 4.3, z - d / 2 - .3, stone, 'Marquesina de acceso');
  for (const offset of [-2, 0, 2]) box(.09, 3.8, .08, x + offset, 1.9, z - d / 2 - .08, frame);
  const a = COLPATRIA_ANNEX;
  box(a.width, a.height, a.depth, a.x, a.height / 2, a.z, glass, 'Edificio anexo gris');
  // El bloque ciego superior deja una planta comercial acristalada bajo columnas.
  box(a.width + .1, 17, a.depth + .1, a.x, 13.5, a.z, grey, 'Paneles grises del anexo');
  box(a.width + .25, .4, a.depth + .25, a.x, 22, a.z, stone);
  for (const fz of [160, 164, 168, 172, 176]) {
    box(.6, 5, .6, 103.15, 2.5, fz, stone, 'Columna del anexo');
    box(.06, 16.5, .08, 103.08, 13.4, fz, frame, 'Junta vertical');
  }
  for (const fx of [94, 98, 102]) box(.6, 5, .6, fx, 2.5, 158.85, stone, 'Columna del anexo');
  box(.15, .3, 18.4, 103.18, 3.55, a.z, stone);
  if (createSign) {
    const sign = (title, sub, x, y, z, yaw, width) => {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, width / 4), new THREE.MeshBasicMaterial({
        map: createSign({ title, sub, bg: '#a9aaa5', fg: '#273137', border: false, w: 768, h: 192 })
      }));
      mesh.position.set(x, y, z); mesh.rotation.y = yaw; group.add(mesh);
    };
    sign('TORRE COLPATRIA', 'ACCESO PRINCIPAL', 81, 4.8, 154.91, Math.PI, 8);
    sign('TORRE COLPATRIA', 'EDIFICIO ANEXO', 103.16, 6.5, 173, Math.PI / 2, 7);
    sign('LOCALES', 'CAFÉ · SERVICIOS', 103.19, 3.9, 165, Math.PI / 2, 6);
  }
  group.userData.lightMaterials = lights;
  return group;
}
