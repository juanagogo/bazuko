import * as THREE from 'three';
import { createBuildingShell } from './BuildingVisibility.js';

const hash=(x,z)=>((Math.imul(x+17,73856093)^Math.imul(z+31,19349663))>>>0);
const FLOOR_SEQUENCE=[3,5,8,12,4,18,6,24,10,30,7,16];
export const URBAN_DESIGNS=['ladrillo-balcones','concreto-bandas','marcos-verticales','torre-retranqueada','esquina-acristalada'];

/** Solo sustituye solares de casas genéricas; nunca calles, ruinas o hitos. */
export function planUrbanBuildings(map) {
  const lots=[],occupied=new Set();
  for(let z=3;z<map.length-6;z+=3) for(let x=3;x<map[0].length-6;x+=3) {
    const seed=hash(x,z);
    if(seed%100>54)continue;
    let size=6;
    const fits=n=>Array.from({length:n*n},(_,i)=>[x+i%n,z+Math.floor(i/n)]).every(([tx,tz])=>map[tz]?.[tx]==='building'&&!occupied.has(`${tx},${tz}`));
    if(!fits(size)){size=4;if(!fits(size))continue;}
    // Evitar torres adosadas: una franja libre de otras sustituciones en cada lote.
    if(lots.some(p=>x<=p.tileX+p.tiles+2&&x+size+2>=p.tileX&&z<=p.tileZ+p.tiles+2&&z+size+2>=p.tileZ))continue;
    let floors=FLOOR_SEQUENCE[lots.length%FLOOR_SEQUENCE.length];
    if(size<6&&floors>12)floors=8+seed%5;
    const plan={tileX:x,tileZ:z,tiles:size,x:x*2+size-1,z:z*2+size-1,width:size*2,depth:size*2,floors,height:floors*3.2,design:URBAN_DESIGNS[lots.length%URBAN_DESIGNS.length],seed};
    lots.push(plan);
    for(let dz=0;dz<size;dz++)for(let dx=0;dx<size;dx++)occupied.add(`${x+dx},${z+dz}`);
  }
  const towerSites=lots.filter(p=>p.tiles>=6).sort((a,b)=>a.seed-b.seed);
  for(let i=0;i<Math.min(towerSites.length,4);i++){const p=towerSites[i];p.floors=[30,24,18,12][i];p.height=p.floors*3.2;}
  return lots;
}

function tiledBox(w,h,d,unitW=6,unitH=9.6) {
  const geometry=new THREE.BoxGeometry(w,h,d),uv=geometry.attributes.uv;
  for(let i=0;i<uv.count;i++) {
    const face=Math.floor(i/4);
    uv.setXY(i,uv.getX(i)*(face<2?d:w)/unitW,uv.getY(i)*(face===2||face===3?d:h)/unitH);
  }
  return geometry;
}

/** Fachadas y detalles comparten materiales y se ocultan junto a cada pared. */
export function buildUrbanBuilding(plan,palette) {
  const {x,z,width:w,depth:d,height:h,design}=plan;
  const material=palette.facades[URBAN_DESIGNS.indexOf(design)];
  const setback=design==='torre-retranqueada'&&plan.floors>=8;
  const bodyHeight=setback?h-6.4:h;
  const shell=createBuildingShell(tiledBox(w,bodyHeight,d),[material,material,palette.roof,palette.roof,material,material],{
    x,z,height:bodyHeight,interiorMaterial:palette.interior
  });
  shell.root.name=`Edificio ${plan.floors} pisos · ${design}`;
  shell.root.userData.urbanBuilding={...plan};
  shell.height=h;
  const add=(parent,w,h,d,x,y,z,mat,name)=>{
    const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);mesh.position.set(x,y,z);mesh.name=name;
    mesh.castShadow=mesh.receiveShadow=true;parent.add(mesh);return mesh;
  };
  for(const [face,length,depth] of [[0,d,w],[1,d,w],[4,w,d],[5,w,d]]) {
    const wall=shell.walls.get(face),side=face===0||face===4?1:-1;
    const detail=(a,y,width,height,projection,mat,name)=>{
      if(face<2)return add(wall,projection,height,width,side*(depth/2-.06),y,a,mat,name);
      return add(wall,width,height,projection,a,y,side*(depth/2-.06),mat,name);
    };
    // Zócalo y dintel comercial conservan la escala de los barrios existentes.
    detail(0,.3,length,.6,.12,palette.concrete,'Zócalo');
    detail(0,3.05,length,.18,.16,palette.trim,'Dintel');
    if(design==='marcos-verticales'||design==='esquina-acristalada') {
      for(const a of [-.35,0,.35])detail(a*length,bodyHeight/2,.2,bodyHeight,.22,palette.trim,'Marco vertical');
      if(design==='esquina-acristalada') {
        for(const side of [-1,1]) detail(side*length*.41,(bodyHeight+3.2)/2,length*.15,bodyHeight-3.2,.18,palette.glass,'Franja acristalada de esquina');
      }
    } else {
      const step=design==='concreto-bandas'?1:3;
      for(let floor=2;floor<Math.floor(bodyHeight/3.2);floor+=step) {
        detail(0,floor*3.2,length-.2,.16,.22,palette.trim,'Banda entre pisos');
        if(design==='ladrillo-balcones')detail(0,floor*3.2+.65,length*.6,.65,.3,palette.rail,'Antepecho de balcón');
      }
    }
    // Narrow inset piers vary the facade rhythm without widening the building or adding collisions.
    const rhythm=2+(plan.seed%3);
    for(let bay=1;bay<rhythm;bay++)detail((bay/rhythm-.5)*length,(bodyHeight+3.2)/2,.09,bodyHeight-3.2,.08,palette.trim,'Junta vertical de fachada');
    detail(0,bodyHeight-.28,length-.16,.16,.12,palette.concrete,'Cornisa interior');
    // Entrada y vitrina oscura: no repetir persianas en los pisos superiores.
    detail(0,1.4,Math.min(2.6,length*.32),2.4,.2,palette.glass,'Entrada');
  }
  if(setback) {
    const top=new THREE.Mesh(tiledBox(w*.76,6.4,d*.76),material);
    top.position.set(0,bodyHeight+3.2,0);top.castShadow=top.receiveShadow=true;shell.roof.add(top);
    add(shell.roof,w*.8,.2,d*.8,0,h-.1,0,palette.trim,'Cornisa de coronación');
  } else add(shell.roof,w-.2,.3,d-.2,0,h-.15,0,palette.trim,'Remate de azotea');
  return shell;
}
