import {createRoadSurfaceMaterial} from './DonorSurfaces.js';
import * as THREE from 'three/webgpu';
import {texture,materialColor,materialEmissive,materialRoughness,materialMetalness,positionWorld,positionView,normalView,vec3,vec4,float,mix,smoothstep,sin,time,mx_noise_float,faceDirection} from 'three/tsl';
import {cityUniforms} from './GraphicsState.js';
import {facadeColor,facadeWindow,facadeGlow} from './FacadeNodes.js';
import {useInstanceStorage} from './InstanceStorage.js';

// Stable world-space microtexture: no geometry changes, random numbers or per-frame rebuilds.
const grain=mx_noise_float(positionWorld.mul(12));
const nightEmission=materialEmissive.mul(cityUniforms.lightsOn);
function heightNormal(height,scale){
  const x=positionView.dFdx().normalize(),y=positionView.dFdy().normalize();
  const r1=y.cross(normalView),r2=normalView.cross(x),det=x.dot(r1).mul(faceDirection);
  const gradient=det.sign().mul(r1.mul(height.dFdx()).add(r2.mul(height.dFdy()))).mul(scale);
  return det.abs().mul(normalView).sub(gradient).normalize();
}
export class SurfaceMaterials {
  constructor(){this.cache=new Map();this.resources=new Set();this.graphs=new Map();}
  convert(source,kind='surface'){
    if(!source||source.isNodeMaterial||!source.isMeshStandardMaterial)return source;
    if(this.cache.has(source))return this.cache.get(source);
    if(source.userData.proceduralFacade)kind='facade';
    const material=new THREE.MeshStandardNodeMaterial();material.copy(source);
    // NodeMaterial.copy does not transfer the alpha-test threshold from classic materials.
    material.alphaTest=source.alphaTest;
    if(source.userData.visibilityFade){material.alphaHash=true;material.transparent=false;material.depthWrite=true;material.userData.ditherFade=true;source.userData.ditherFade=true;}
    // Preserve live references used by weather, night windows and cutaway walls.
    material.color=source.color;material.emissive=source.emissive;
    // Static city lamps, windows and signs share the visual day/night switch.
    material.emissiveNode=nightEmission;
    if(kind==='facade')material.emissiveNode=facadeGlow;
    material.name=`${source.name||kind} · TSL Bogotá`;
    const graphKey=`${kind}:${!!source.map}:${!!source.emissiveMap}:${!!source.normalMap}:${!!source.bumpMap}`;
    const existing=this.graphs.get(graphKey);
    if(existing){for(const key of ['colorNode','roughnessNode','metalnessNode','normalNode'])material[key]=existing[key];}
    else{
    const base=materialColor.rgb;
    const facade=!!source.emissiveMap;
    let windowMask=float(0);
    if(facade){const luma=base.dot(vec3(.2126,.7152,.0722));windowMask=float(1).sub(smoothstep(.06,.22,luma)).mul(smoothstep(3,3.5,positionWorld.y));}
    // Existing textures already carry their grain/bump. Do not add a second noise graph per pixel.
    const needsMicro=!source.map&&!source.bumpMap&&kind!=='facade';
    const micro=needsMicro?mix(.95,1.04,grain.mul(.5).add(.5)):float(1);
    material.colorNode=vec4(base.mul(micro),materialColor.a);
    material.roughnessNode=mix(materialRoughness,.17,windowMask);
    material.metalnessNode=mix(materialMetalness,.32,windowMask);
    if(kind==='facade'){
      material.colorNode=facadeColor;material.roughnessNode=mix(.86,.22,facadeWindow);material.metalnessNode=mix(.02,.3,facadeWindow);
    }
    if(kind==='sidewalk'){
      const puddles=smoothstep(.15,.65,mx_noise_float(positionWorld.mul(.35))).mul(cityUniforms.wetness);
      material.colorNode=base.mul(mix(1,.72,puddles)).mul(micro);
      material.roughnessNode=mix(materialRoughness,kind==='sidewalk'?.32:.16,puddles);
      material.metalnessNode=mix(materialMetalness,.24,puddles);
    }
    if(kind==='road'||kind==='busway'){
      const road=this.road??=createRoadSurfaceMaterial();
      material.colorNode=kind==='busway'?road.colorNode.mul(vec3(1.3,.48,.42)):road.colorNode;
      material.roughnessNode=road.roughnessNode;material.metalnessNode=road.metalnessNode;material.normalNode=road.normalNode;
    }
    if(kind==='water'){
      const wave=sin(positionWorld.x.mul(2.8).add(time.mul(.65))).mul(.4).add(sin(positionWorld.z.mul(3.7).sub(time.mul(.45))).mul(.3));
      material.normalNode=heightNormal(wave,.12);material.roughnessNode=float(.17);material.metalnessNode=float(.32);
      material.colorNode=base.mul(.75).mul(wave.mul(.035).add(1));
    }else if(needsMicro&&!source.normalMap&&kind!=='road'&&kind!=='busway'){material.normalNode=heightNormal(grain,.018);}
      this.graphs.set(graphKey,Object.fromEntries(['colorNode','roughnessNode','metalnessNode','normalNode'].map(key=>[key,material[key]])));
    }
    material.userData.shaderFamily=`bogota-surface:${graphKey}`;
    for(const key of ['roughness','metalness','opacity','emissiveIntensity','transparent','depthWrite','visible','side']){
      Object.defineProperty(source,key,{configurable:true,get:()=>material[key],set:v=>{if(material[key]!==v){material[key]=v;if(['transparent','depthWrite','side'].includes(key))material.needsUpdate=true;}}});
    }
    source.addEventListener('dispose',()=>material.dispose());
    this.cache.set(source,material);this.resources.add(material);return material;
  }
  apply(root,kinds=new Map()){
    root.traverse(object=>{if(!object.isMesh)return;useInstanceStorage(object);const convert=m=>this.convert(m,kinds.get(m)??'surface');object.material=Array.isArray(object.material)?object.material.map(convert):convert(object.material);});
  }
  dispose(){for(const material of this.resources)material.dispose();this.road?.dispose();this.resources.clear();this.cache.clear();this.graphs.clear();}
}
