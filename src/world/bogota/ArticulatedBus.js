import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const ARTICULATED_BUS_SIZE = Object.freeze({ length: 18.2, width: 2.52 });
export const BUS_DOOR_SECONDS = .55;
const WHEEL_RADIUS = .48;
const FONT = {
  A:['01110','10001','10001','11111','10001','10001','10001'], B:['11110','10001','10001','11110','10001','10001','11110'],
  C:['01111','10000','10000','10000','10000','10000','01111'], D:['11110','10001','10001','10001','10001','10001','11110'],
  E:['11111','10000','10000','11110','10000','10000','11111'], G:['01111','10000','10000','10111','10001','10001','01111'],
  I:['111','010','010','010','010','010','111'], K:['10001','10010','10100','11000','10100','10010','10001'],
  L:['10000','10000','10000','10000','10000','10000','11111'], M:['10001','11011','10101','10101','10001','10001','10001'], N:['10001','11001','11001','10101','10011','10011','10001'],
  O:['01110','10001','10001','10001','10001','10001','01110'], P:['11110','10001','10001','11110','10000','10000','10000'],
  R:['11110','10001','10001','11110','10100','10010','10001'], S:['01111','10000','10000','01110','00001','00001','11110'],
  T:['11111','00100','00100','00100','00100','00100','00100'], U:['10001','10001','10001','10001','10001','10001','01110'],
  0:['01110','10001','10011','10101','11001','10001','01110'], 1:['00100','01100','00100','00100','00100','00100','01110'],
  2:['01110','10001','00001','00010','00100','01000','11111'], 3:['11110','00001','00001','01110','00001','00001','11110'],
  4:['00010','00110','01010','10010','11111','00010','00010'], 8:['01110','10001','10001','01110','10001','10001','01110']
};

function geometryBatch(group) {
  const buckets = new Map();
  const matrix = new THREE.Matrix4(), quaternion = new THREE.Quaternion();
  const add = (geometry, material, position = [0,0,0], rotation = [0,0,0]) => {
    if (material.vertexColors && !geometry.hasAttribute('color')) tintGlass(geometry);
    quaternion.setFromEuler(new THREE.Euler(...rotation));
    matrix.compose(new THREE.Vector3(...position), quaternion, new THREE.Vector3(1,1,1));
    geometry.applyMatrix4(matrix);
    if (!buckets.has(material)) buckets.set(material, []);
    buckets.get(material).push(geometry);
  };
  return {
    add,
    box(material, size, position, rotation) { add(new THREE.BoxGeometry(...size,1,material.vertexColors ? 3 : 1,1), material, position, rotation); },
    plane(material, w, h, position, rotation) { add(new THREE.PlaneGeometry(w,h), material, position, rotation); },
    finish(name) {
      const meshes = [];
      for (const [material, geometries] of buckets) {
        // RoundedBoxGeometry no tiene índice; homogeneizar antes de fusionar.
        const indexed = geometries.map(geometry => {
          if (!geometry.index) geometry.setIndex(Array.from({length:geometry.attributes.position.count}, (_,i)=>i));
          return geometry;
        });
        const geometry = mergeGeometries(indexed);
        geometries.forEach(g => g.dispose());
        geometry.computeBoundingBox(); geometry.computeBoundingSphere();
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = name; mesh.castShadow = mesh.receiveShadow = true;
        group.add(mesh); meshes.push(mesh);
      }
      return meshes;
    }
  };
}

function tintGlass(geometry, solidColor = null) {
  const positions=geometry.attributes.position,colors=[];
  geometry.computeBoundingBox();
  const bounds=geometry.boundingBox,height=Math.max(.001,bounds.max.y-bounds.min.y);
  const lower=new THREE.Color('#263d4b'),upper=new THREE.Color('#8ba3ae'),cloud=new THREE.Color('#b1bdc1');
  const tint=new THREE.Color();
  for(let i=0;i<positions.count;i++) {
    const t=(positions.getY(i)-bounds.min.y)/height;
    if(solidColor)tint.set(solidColor);
    else {
      // El vidrio opaco conserva el coste de ordenación y refleja un cielo
      // suave en color por vértice, incluso sin un cubemap de entorno.
      tint.copy(lower).lerp(upper,t);
      tint.lerp(cloud,Math.exp(-Math.pow((t-.76)/.18,2))*.18);
    }
    colors.push(tint.r,tint.g,tint.b);
  }
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  return geometry;
}

function seatSilhouette() {
  const shape=new THREE.Shape();
  shape.moveTo(-.15,-.16);shape.lineTo(.15,-.16);shape.lineTo(.15,.08);
  shape.quadraticCurveTo(.15,.16,.08,.16);shape.lineTo(-.08,.16);
  shape.quadraticCurveTo(-.15,.16,-.15,.08);shape.closePath();
  return tintGlass(new THREE.ShapeGeometry(shape,2),'#314b61');
}

// Rotulación vectorial compartida con los paneles, sin imágenes ni atlas que
// el distrito y el bus pudieran liberar dos veces al cerrar la ciudad.
function label(batch, text, { material, size, x = 0, y, z, face = 'front' }) {
  const width = text.length * size * 6;
  const rotation = face === 'front' ? [0,Math.PI,0] : face === 'rear' ? [0,0,0]
    : face === 'left' ? [0,-Math.PI/2,0] : [0,Math.PI/2,0];
  for (let letter = 0; letter < text.length; letter++) {
    const glyph = FONT[text[letter]];
    if (!glyph) continue;
    for (let row=0; row<7; row++) for(let col=0; col<glyph[row].length; col++) {
      if (glyph[row][col] !== '1') continue;
      const u = -width/2 + (letter*6+col+.5)*size, yy = y + (3-row)*size;
      const xx = face === 'front' ? x-u : face === 'rear' ? x+u : x;
      const zz = face === 'left' ? z+u : face === 'right' ? z-u : z;
      batch.plane(material, size*.84, size*.84, [xx,yy,zz], rotation);
    }
  }
}

function frontSurface(y0,y1,width) {
  const p=[],uv=[],indices=[], nx=12, ny=3;
  for(let row=0;row<=ny;row++) for(let col=0;col<=nx;col++) {
    const x=(col/nx-.5)*width, y=y0+(y1-y0)*row/ny;
    const rake=THREE.MathUtils.clamp((y-1.25)/1.75,0,1)*.29;
    const z=-9.08 + .17*Math.pow(Math.abs(x)/(width/2),3) + rake;
    p.push(x,y,z); uv.push(col/nx,row/ny);
  }
  for(let row=0;row<ny;row++) for(let col=0;col<nx;col++) {
    const a=row*(nx+1)+col,b=a+1,c=a+nx+1,d=c+1;
    indices.push(a,c,b,b,c,d);
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(p,3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}

function roundedRing() {
  const path=(w,h,r)=>{
    const s=new THREE.Shape(), x=-w/2,y=-h/2;
    s.moveTo(x+r,y);s.lineTo(x+w-r,y);s.quadraticCurveTo(x+w,y,x+w,y+r);
    s.lineTo(x+w,y+h-r);s.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
    s.lineTo(x+r,y+h);s.quadraticCurveTo(x,y+h,x,y+h-r);
    s.lineTo(x,y+r);s.quadraticCurveTo(x,y,x+r,y);
    return s;
  };
  const shape=path(2.4,2.53,.2), hole=path(2.29,2.42,.15);
  shape.holes.push(hole);
  return new THREE.ExtrudeGeometry(shape,{depth:.035,bevelEnabled:false,curveSegments:2});
}

function wheelGeometry(rubber, rim) {
  const group=new THREE.Group(), batch=geometryBatch(group);
  batch.add(new THREE.CylinderGeometry(WHEEL_RADIUS,WHEEL_RADIUS,.29,20),rubber,[0,0,0],[0,0,Math.PI/2]);
  for(const side of [-1,1]) {
    batch.add(new THREE.CylinderGeometry(.29,.29,.013,16),rim,[side*.151,0,0],[0,0,Math.PI/2]);
    batch.add(new THREE.CylinderGeometry(.105,.105,.025,10),rim,[side*.167,0,0],[0,0,Math.PI/2]);
    for(let i=0;i<8;i++) {
      const a=i*Math.PI/4;
      batch.box(rubber,[.014,.095,.045],[side*.161,Math.cos(a)*.205,Math.sin(a)*.205],[a,0,0]);
    }
  }
  return batch.finish('Rueda').map(mesh=>({geometry:mesh.geometry,material:mesh.material}));
}

function doorGeometry(trim, glass, yellow) {
  const group=new THREE.Group(), batch=geometryBatch(group);
  batch.box(trim,[.019,1.98,.71],[0,0,0]);
  batch.box(glass,[.022,1.48,.56],[-.009,.16,0]);
  batch.box(trim,[.025,1.98,.026],[-.012,0,.34]);
  batch.box(trim,[.026,.035,.66],[-.012,.94,0]);
  batch.box(trim,[.026,.035,.66],[-.012,-.94,0]);
  batch.box(yellow,[.006,.58,.03],[-.021,.06,0],[.62,0,0]);
  batch.box(yellow,[.006,.57,.03],[-.021,.58,-.17]);
  batch.box(yellow,[.006,.57,.03],[-.021,-.46,.17]);
  return batch.finish('Hoja de puerta').map(mesh=>({geometry:mesh.geometry,material:mesh.material}));
}

/** Modelo administrado; frente −Z, puertas de estación −X y OBB constante. */
export function articulatedBus() {
  const group=new THREE.Group();group.name='Articulado rojo de Bogotá';
  group.userData.noMerge=true;group.userData.visualManaged=true;
  const standard=(color,opts={})=>new THREE.MeshStandardMaterial({color,roughness:.65,...opts});
  const paint=standard('#bb2c24',{roughness:.38,metalness:.28});
  const trim=standard('#333c3f',{roughness:.58,metalness:.28});
  const glass=standard('#ffffff',{roughness:.18,metalness:.08,vertexColors:true});
  const reflection=standard('#627d86',{roughness:.24,metalness:.45});
  const rubber=standard('#181d20',{roughness:.95});
  const rib=standard('#555d60',{roughness:.92});
  const metal=standard('#a5adae',{roughness:.42,metalness:.7});
  const white=standard('#e3ddd2',{roughness:.65});
  const yellow=standard('#d5b83c',{roughness:.68});
  const dirt=standard('#745c4e',{roughness:1});
  const plate=standard('#e5e5dc');
  const heads=standard('#f0e7ce',{emissive:'#fff1cf',emissiveIntensity:.35});
  const tails=standard('#ce251e',{emissive:'#ff2618',emissiveIntensity:.2});
  const leds=standard('#e6ad4c',{emissive:'#ffb83e',emissiveIntensity:.6});
  const batch=geometryBatch(group);

  // Caja redondeada detrás del frente inclinado; las juntas y faldones
  // separan las dos carrocerías sin girarlas fuera de la caja física.
  batch.add(new RoundedBoxGeometry(2.4,2.48,8.45,2,.22),paint,[0,1.88,-4.425]);
  batch.add(new RoundedBoxGeometry(2.4,2.48,8.1,2,.22),paint,[0,1.88,4.99]);
  batch.box(trim,[2.27,.22,17.6],[0,.63,0]);
  batch.add(frontSurface(.7,1.38,2.34),paint);
  batch.add(frontSurface(1.38,2.86,2.32),glass);
  batch.add(frontSurface(2.86,3.1,2.32),trim);
  const dashboard=frontSurface(1.43,1.64,2.32);
  const dashboardPositions=dashboard.attributes.position;
  for(let i=0;i<dashboardPositions.count;i++)dashboardPositions.setZ(i,dashboardPositions.getZ(i)-.006);
  batch.add(tintGlass(dashboard,'#25353f'),glass);
  for(const x of [-.77,-.36,.36,.77]) {
    const seat=seatSilhouette();
    batch.add(seat,glass,[x,1.82,-8.996],[0,Math.PI,0]);
  }
  // Parachoques en segmentos que siguen la curva del morro, sin ampliar
  // la envolvente del bus; espejos retraídos dentro de sus 2,52 metros.
  for(let i=-3;i<=3;i++) {
    const x=i*.3,curve=.17*Math.pow(Math.abs(x)/1.17,3);
    const slope=.51*x*Math.abs(x)/Math.pow(1.17,3);
    batch.box(trim,[.305,.11,.018],[x,.69,-9.081+curve],[0,-Math.atan(slope),0]);
  }
  // Reflejos discretos y soportes del parabrisas panorámico.
  for(const side of [-1,1]) {
    batch.box(reflection,[.035,1.1,.012],[side*.83,2.15,-8.899],[.16,0,side*-.18]);
    batch.box(trim,[.22,.035,.05],[side*.46,1.41,-9.06]);
    batch.box(trim,[.16,.035,.035],[side*1.13,2.46,-8.65]);
    batch.box(trim,[.07,.32,.19],[side*1.212,2.28,-8.65]);
    batch.plane(reflection,.052,.24,[side*1.212,2.28,-8.751],[0,Math.PI,0]);
  }
  const doorLocations=[-7.25,-3.1,2.25,6.4];
  for(const side of [-1,1]) {
    const x=side*1.204;
    for(const z of [-6.5,-1.42,6.55]) batch.add(new THREE.CircleGeometry(.585,20,0,Math.PI),rubber,
      [side*1.222,WHEEL_RADIUS,z],[0,side*Math.PI/2,0]);
    for(const z of [-7.7,-6.25,-4.8,-3.35,-1.9,1.8,3.25,4.7,6.15,7.6]) {
      if(side<0 && doorLocations.some(d=>Math.abs(d-z)<1.2)) continue;
      batch.box(trim,[.019,1.33,1.35],[x,2.29,z]);
      batch.box(glass,[.024,1.18,1.21],[side*1.218,2.29,z]);
      for(const offset of [-.3,.3])batch.add(seatSilhouette(),glass,[side*1.232,1.92,z+offset],[0,side*Math.PI/2,0]);
      batch.box(reflection,[.026,.055,.98],[side*1.222,2.62,z]);
      batch.box(metal,[.026,1.18,.025],[side*1.224,2.29,z+.25]);
    }
    for(const [z,length] of [[-4.4,8.35],[5,7.9]]) {
      batch.box(trim,[.018,1.39,length],[side*1.204,2.36,z]);
      batch.box(trim,[.028,.1,length],[side*1.217,1.54,z]);
      batch.box(white,[.029,.055,length],[side*1.219,1.47,z]);
      batch.box(yellow,[.029,.085,length],[side*1.219,.97,z]);
      batch.box(dirt,[.028,.07,length],[side*1.216,.76,z]);
      batch.box(trim,[.027,.018,length],[side*1.217,1.1,z]);
    }
    for(const z of [-5.4,-.7,4,8.25]) batch.box(trim,[.03,.55,.018],[side*1.218,1.08,z]);
    // Rejillas del motor: láminas físicas fusionadas al resto de paneles.
    for(let i=0;i<7;i++) batch.box(trim,[.025,.022,1.05],[side*1.22,.93+i*.055,8.2]);
    label(batch,'TRANSMILENIO',{material:white,size:.03,x:side*1.237,y:1.29,z:4.34,face:side<0?'left':'right'});
    label(batch,'TRANSMILENIO',{material:white,size:.03,x:side*1.237,y:1.29,z:-5.18,face:side<0?'left':'right'});
    label(batch,'BOGOTA',{material:white,size:.022,x:side*1.237,y:.82,z:-5.18,face:side<0?'left':'right'});
  }

  // Fuelle con huecos y costillas independientes en geometría, unido en lotes.
  batch.add(new RoundedBoxGeometry(2.27,2.41,1.2,1,.1),rubber,[0,1.86,.37]);
  for(let i=0;i<17;i++) batch.add(roundedRing(),i%2?rib:rubber,[0,1.86,-.19+i*.069]);
  batch.box(trim,[2.17,.09,1.22],[0,.68,.37]);
  // Climatizadores y conductos quedan por debajo de los 3,5 m del collider.
  for(const z of [-4.5,5.8]) {
    batch.add(new RoundedBoxGeometry(1.55,.27,1.9,1,.08),paint,[0,3.245,z]);
    for(let i=0;i<7;i++) batch.box(trim,[1.18,.012,.055],[0,3.385,z-.65+i*.2]);
  }
  for(const x of [-1.03,1.03]) batch.box(metal,[.055,.07,16.8],[x,3.11,0]);

  batch.box(trim,[2.26,.16,.1],[0,.77,9.04]);
  batch.box(glass,[1.95,.91,.026],[0,2.35,9.055]);
  batch.box(reflection,[1.72,.05,.03],[0,2.64,9.073]);
  for(const x of [-.91,.91]) {
    batch.box(heads,[.32,.18,.025],[x,.99,-9.063]);
    batch.box(trim,[.38,.25,.023],[x,.99,-9.045]);
    batch.box(tails,[.16,.55,.025],[x,1.24,9.067]);
    batch.box(leds,[.13,.16,.028],[x,1.57,9.067]);
  }
  batch.box(plate,[.56,.19,.018],[0,.9,9.064]);
  batch.box(plate,[.56,.19,.018],[0,.83,-9.079]);
  label(batch,'TNK823',{material:trim,size:.012,x:0,y:.9,z:9.077,face:'rear'});
  label(batch,'TNK823',{material:trim,size:.012,x:0,y:.83,z:-9.09});
  label(batch,'B14 PORTAL',{material:leds,size:.028,x:0,y:2.97,z:-8.81});
  label(batch,'B14',{material:leds,size:.025,x:0,y:2.93,z:9.074,face:'rear'});

  for(const z of doorLocations) {
    batch.box(rubber,[.02,2.08,1.49],[-1.231,1.77,z]);
    batch.box(metal,[.025,.06,1.56],[-1.242,.72,z]);
    batch.box(leds,[.026,.055,.12],[-1.243,2.87,z]);
  }
  batch.finish('Carrocería fusionada');

  const wheels=[], wheelMeshes=[];
  for(const z of [-6.5,-1.42,6.55]) for(const side of [-1,1]) {
    const pivot=new THREE.Group();pivot.name='Rueda de eje';pivot.position.set(side*1.066,WHEEL_RADIUS,z);
    group.add(pivot);wheels.push(pivot);
  }
  for(const {geometry,material} of wheelGeometry(rubber,paint)) {
    const mesh=new THREE.InstancedMesh(geometry,material,wheels.length);
    mesh.name='Neumáticos y rines instanciados';mesh.castShadow=mesh.receiveShadow=true;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);group.add(mesh);wheelMeshes.push(mesh);
  }
  const doors=[],leaves=[],doorMeshes=[];
  for(const z of doorLocations) {
    const door={centerZ:z,leaves:[]};
    for(const side of [-1,1]) {
      const pivot=new THREE.Group();pivot.name='Hoja corredera de estación';
      pivot.position.set(-1.235,1.77,z+side*.36);
      pivot.userData.closedZ=pivot.position.z;pivot.userData.slideSide=side;
      group.add(pivot);leaves.push(pivot);door.leaves.push(pivot);
    }
    doors.push(door);
  }
  for(const {geometry,material} of doorGeometry(rubber,glass,yellow)) {
    const mesh=new THREE.InstancedMesh(geometry,material,leaves.length);
    mesh.name='Puertas de estación instanciadas';mesh.castShadow=mesh.receiveShadow=true;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);group.add(mesh);doorMeshes.push(mesh);
  }
  const wipers=[];
  for(const side of [-1,1]) {
    const pivot=new THREE.Group();pivot.name='Limpiaparabrisas panorámico';
    pivot.position.set(side*.47,1.43,-9.075);
    pivot.userData.restAngle=side*.63;pivot.userData.sweepAngle=-side*1.15;
    pivot.rotation.set(.164,0,pivot.userData.restAngle);
    group.add(pivot);wipers.push(pivot);
  }
  const wiperBatch=geometryBatch(new THREE.Group());
  wiperBatch.box(trim,[.018,.62,.016],[0,.31,0]);
  wiperBatch.box(trim,[.032,.36,.019],[0,.69,-.006]);
  const wiperGeometry=wiperBatch.finish('Limpiaparabrisas')[0].geometry;
  const wiperMesh=new THREE.InstancedMesh(wiperGeometry,trim,wipers.length);
  wiperMesh.name='Limpiaparabrisas instanciados';wiperMesh.castShadow=true;
  wiperMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);group.add(wiperMesh);
  const sync=(pivots,meshes)=>{
    pivots.forEach((p,i)=>{p.updateMatrix();for(const mesh of meshes)mesh.setMatrixAt(i,p.matrix);});
    for(const mesh of meshes){mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingBox();mesh.computeBoundingSphere();}
  };
  let disposed=false, night=false, raining=false;
  const visuals={
    wheels,doors,wipers,wiperPhase:0,doorOpenFraction:0,braking:false,lights:{head:heads,tail:tails,destination:leds},
    setNight(value){night=!!value;heads.emissiveIntensity=night?1.8:.35;leds.emissiveIntensity=night?1:.6;this.setBraking(this.braking);},
    setWeather({isRaining=false}={}){raining=!!isRaining;paint.roughness=raining ? .27 : .38;glass.roughness=raining ? .14 : .18;},
    setBraking(value){this.braking=!!value;tails.emissiveIntensity=this.braking ? 1.65 : night ? .55 : .2;},
    update(dt,{distance=0,doorsOpen=false,braking=false}={}) {
      if(disposed||dt<=0)return;
      if(raining||this.wiperPhase>0) {
        const phase=this.wiperPhase+dt/1.35;
        this.wiperPhase=raining ? phase%1 : phase>=1 ? 0 : phase;
        const sweep=.5-.5*Math.cos(this.wiperPhase*Math.PI*2);
        for(const wiper of wipers)wiper.rotation.z=wiper.userData.restAngle+wiper.userData.sweepAngle*sweep;
        sync(wipers,[wiperMesh]);
      }
      if(distance!==0) {
        for(const wheel of wheels)wheel.rotation.x-=distance/WHEEL_RADIUS;
        sync(wheels,wheelMeshes);
      }
      const target=doorsOpen?1:0,step=dt/BUS_DOOR_SECONDS;
      const previous=this.doorOpenFraction;
      this.doorOpenFraction=THREE.MathUtils.clamp(target,previous-step,previous+step);
      if(previous!==this.doorOpenFraction) {
        for(const leaf of leaves)leaf.position.z=leaf.userData.closedZ+leaf.userData.slideSide*this.doorOpenFraction*.66;
        sync(leaves,doorMeshes);
      }
      this.setBraking(braking);
    },
    dispose(){
      if(disposed)return;disposed=true;
      const geometries=new Set(),materials=new Set();
      group.traverse(o=>{if(o.geometry)geometries.add(o.geometry);for(const m of [o.material].flat().filter(Boolean))materials.add(m);if(o.isInstancedMesh)o.dispose();});
      group.removeFromParent();group.clear();
      for(const g of geometries)g.dispose();for(const m of materials)m.dispose();
    }
  };
  sync(wheels,wheelMeshes);sync(leaves,doorMeshes);sync(wipers,[wiperMesh]);
  group.userData.wheels=wheels;group.userData.busVisuals=visuals;
  return group;
}
