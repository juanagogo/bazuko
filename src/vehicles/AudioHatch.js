import * as THREE from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {part} from './donor/vehicles.js';
import {buildCarGeometry as donorGeometry,buildSteerableWheelGeo} from './donor/cars.js';
// Diseño propio: compacto cinco puertas, cajuela permanentemente abierta.
export function buildAudioHatch(spec,wheels=true){
 const pieces=[];
 const add=(g,id,x,y,z)=>{g.translate(x,y,z);pieces.push(part(g,id));};
 const box=(id,w,h,d,x,y,z,r=.05)=>add(new RoundedBoxGeometry(w,h,d,2,r),id,x,y,z);
 // Carrocería loft, pasos de rueda y cabina curva del mismo generador del tráfico.
 const source=donorGeometry(spec,wheels,true),base=source.index?source.toNonIndexed():source.clone();
 const a=base.attributes.position,keep=[];
 for(let i=0;i<a.count;i+=3){let remove=true;for(let j=0;j<3;j++){const k=i+j;if(!(a.getZ(k)<-2.19&&Math.abs(a.getX(k))<.78&&a.getY(k)>.56))remove=false;}if(!remove)keep.push(i,i+1,i+2);}
 const shell=new THREE.BufferGeometry();for(const [name,attr] of Object.entries(base.attributes)){const values=new attr.array.constructor(keep.length*attr.itemSize);for(let i=0;i<keep.length;i++)for(let j=0;j<attr.itemSize;j++)values[i*attr.itemSize+j]=attr.array[keep[i]*attr.itemSize+j];shell.setAttribute(name,new THREE.BufferAttribute(values,attr.itemSize));}
 shell.setIndex(Array.from({length:keep.length},(_,i)=>i));pieces.push(shell);source.dispose();base.dispose();
 const shellCount=pieces.length;
 // Interior y baffle turquesa orientados al exterior del baúl.
 box(4,1.4,.83,.16,0,.93,-1.62);box(11,1.33,.78,.055,0,.93,-1.73,.025);
 for(const x of [-.43,.43])for(const [y,r] of [[.87,.225]]){
  const g=new THREE.CylinderGeometry(r,r*.9,.065,24);g.rotateX(Math.PI/2);add(g,12,x,y,-1.79);
  add(new THREE.TorusGeometry(r,.018,6,24),3,x,y,-1.83);
 }
 for(const x of [-.48,-.16,.16,.48]){const g=new THREE.CylinderGeometry(.105,.105,.05,20);g.rotateX(Math.PI/2);add(g,12,x,1.23,-1.79);add(new THREE.TorusGeometry(.105,.012,6,20),3,x,1.23,-1.825);}
 box(4,.30,.16,.065,0,1.13,-1.79);box(3,.29,.12,.065,0,.90,-1.79);box(4,1.15,.18,.08,0,.57,-1.78);
 // Tapa elevada: bisagra posterior del techo, panel inclinado abierto.
 const hatch=new RoundedBoxGeometry(1.48,.07,.85,2,.025);hatch.rotateX(.95);add(hatch,0,0,1.94,-1.34);
 const glass=new RoundedBoxGeometry(1.27,.025,.62,2,.02);glass.rotateX(.95);add(glass,1,0,1.98,-1.35);
 for(const x of [-.61,.61]){const strut=new THREE.CylinderGeometry(.012,.012,.62,6);strut.rotateX(-.5);add(strut,3,x,1.56,-1.54);}
 for(let i=shellCount;i<pieces.length;i++)pieces[i].scale(1.15,1.10,1.43).translate(0,0,-.25);
 // Revestimiento opaco en coordenadas nativas: corta la vista hacia la calle.
 // Volúmenes cerrados aportan caras interiores sin cambiar el culling de toda la carrocería.
 box(4,1.64,1.12,.07,0,1.11,-1.94,.02); // respaldo detrás del equipo
 box(4,1.65,.07,.86,0,.57,-2.34,.02); // piso del baúl
 for(const side of [-1,1])box(4,.07,1.10,.77,side*.80,1.10,-2.31,.02);
 box(4,1.60,.06,.63,0,1.66,-2.22,.02); // cielo interior
 const merged=mergeGeometries(pieces);pieces.forEach(g=>g.dispose());merged.computeBoundingBox();return merged;
}


