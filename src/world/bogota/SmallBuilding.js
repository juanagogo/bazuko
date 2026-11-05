import * as THREE from 'three';
import { BRICK_TILE } from './textures.js';

export const SMALL_BUILDING = Object.freeze({ x: 75, z: 125, width: 12, depth: 12, floors: 5, height: 16.6 });

export function paintSmallBuilding(map) {
  for(let z=60;z<=65;z++) for(let x=35;x<=40;x++) map[z][x]='smallBuilding';
}

/** Edificio de cinco pisos, con zócalo, ventanales y azotea rematada. */
export function buildSmallBuilding({ brickTextures = {} } = {}) {
  const group=new THREE.Group();group.name='Edificio de cinco pisos junto a Colpatria';
  const brick=new THREE.MeshStandardMaterial({map:brickTextures.map,bumpMap:brickTextures.bumpMap,roughnessMap:brickTextures.roughnessMap,bumpScale:.045,color:'#ffffff',roughness:.95});
  const plaster=new THREE.MeshStandardMaterial({color:'#d5cab5',roughness:.9});
  const dark=new THREE.MeshStandardMaterial({color:'#263c45',roughness:.4,metalness:.15});
  const concrete=new THREE.MeshStandardMaterial({color:'#767b79',roughness:.9});
  const frame=new THREE.MeshStandardMaterial({color:'#c4c4b9',roughness:.65});
  const box=(w,h,d,x,y,z,material,name='')=>{
    const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material);
    if(material===brick) {
      const uv=mesh.geometry.attributes.uv;
      for(let i=0;i<uv.count;i++) {
        const face=Math.floor(i/4),horizontal=face<2?d:w,vertical=face===2||face===3?d:h;
        uv.setXY(i,uv.getX(i)*horizontal/BRICK_TILE.w,uv.getY(i)*vertical/BRICK_TILE.h);
      }
      uv.needsUpdate=true;
    }
    mesh.position.set(x,y,z);mesh.name=name;mesh.castShadow=mesh.receiveShadow=true;group.add(mesh);
  };
  const {x,z,width:w,depth:d,floors}=SMALL_BUILDING;
  const storey=3.2,roof=floors*storey;
  box(w,roof,d,x,roof/2,z,brick,'Cuerpo de cinco pisos');
  box(w+.04,.45,d+.04,x,.225,z,concrete,'Zócalo');
  for(let floor=1;floor<floors;floor++) box(w+.08,.22,d+.08,x,floor*storey,z,plaster,'Cornisa entre pisos');
  box(w+.1,.22,d+.1,x,roof+.1,z,concrete,'Azotea');
  for(const side of [-1,1]) {
    box(.25,.36,d,x+side*(w/2-.14),roof+.42,z,plaster);
    box(w,.36,.25,x,roof+.42,z+side*(d/2-.14),plaster);
    for(let floor=0;floor<floors;floor++) {
      const y=1.8+floor*storey;
      for(const offset of [-3.8,0,3.8]) {
        if(!(side===-1&&offset===0&&floor===0)) {
          box(2.05,1.85,.1,x+offset,y,z+side*(d/2+.03),frame);
          box(1.82,1.62,.12,x+offset,y,z+side*(d/2+.08),dark,'Ventana');
          box(.06,1.7,.14,x+offset,y,z+side*(d/2+.1),frame);
        }
        box(.1,1.85,2.05,x+side*(w/2+.03),y,z+offset,frame);
        box(.12,1.62,1.82,x+side*(w/2+.08),y,z+offset,dark,'Ventana lateral');
      }
    }
  }
  box(1.9,2.7,.14,x,1.35,z-d/2-.06,plaster,'Marco de entrada');
  box(1.6,2.5,.16,x,1.25,z-d/2-.12,dark,'Puerta');
  box(.08,.3,.08,x+.57,1.25,z-d/2-.24,frame,'Manija');
  return group;
}
