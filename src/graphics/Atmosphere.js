// Sky/PMREM/SunLight arrangement adapted from Slop New York 1b54e165 (MIT).
import * as THREE from 'three/webgpu';
import {SkyMesh} from 'three/addons/objects/SkyMesh.js';
import {SunLight} from 'three/addons/lights/SunLight.js';
import {SunLightNode} from 'three/addons/lights/SunLightNode.js';
import {uniform,mix,vec4,float} from 'three/tsl';
import {cityUniforms} from './GraphicsState.js';
import {setShadowActive,setShadowResolution,shadowResolutionFor} from './ShadowState.js';
import {enableShadowProxyLayer} from './ShadowProxies.js';

// Time-of-day profiles adapted from Slop New York's lighting.js (MIT,
// revision 1b54e165ddc26b3e951d5614d56a88995da1da38). The Bogotá clock
// selects these continuously; they are profiles, not hard scene swaps.
const TIME_PROFILES = Object.freeze({
  golden: { id:'golden', label:'Golden hour', sunColor:'#ffca92', sunIntensity:3.8, ambient:1.05, sky:'#8b7892', fog:'#8f7d7b', night:0.08, wetness:0.36, clouds:.42 },
  midday: { id:'midday', label:'Midday', sunColor:'#fff5e8', sunIntensity:5.2, ambient:1.42, sky:'#a9c8e5', fog:'#9eb5c7', night:0, wetness:.10, clouds:.28 },
  'blue-hour': { id:'blue-hour', label:'Blue hour', sunColor:'#ff9466', sunIntensity:1.8, ambient:.72, sky:'#3d527f', fog:'#3b4562', night:.58, wetness:.50, clouds:.48 },
  night: { id:'night', label:'Night', sunColor:'#93b9ef', sunIntensity:.55, ambient:.48, sky:'#101b35', fog:'#101827', night:1, wetness:.62, clouds:.34 }
});
const PROFILE_KEYS = Object.freeze([
  [0,'night'], [5,'night'], [6.5,'blue-hour'], [8,'midday'], [16,'midday'],
  [18,'golden'], [19.5,'blue-hour'], [21,'night'], [24,'night']
]);
const PROFILE_HOURS = Object.freeze({ golden:18, midday:12, 'blue-hour':20, night:23 });
function profileAt(hour, wetness=0) {
  const h=((hour%24)+24)%24;
  let i=0; while(i<PROFILE_KEYS.length-2 && h>PROFILE_KEYS[i+1][0]) i++;
  const [ha,ka]=PROFILE_KEYS[i], [hb,kb]=PROFILE_KEYS[i+1];
  const a=TIME_PROFILES[ka], b=TIME_PROFILES[kb], t=THREE.MathUtils.clamp((h-ha)/(hb-ha),0,1);
  const lerp=(x,y)=>x+(y-x)*t;
  const color=(x,y)=>new THREE.Color(x).lerp(new THREE.Color(y),t);
  return { id:t<.5?a.id:b.id, label:t<.5?a.label:b.label, sunColor:color(a.sunColor,b.sunColor), sunIntensity:lerp(a.sunIntensity,b.sunIntensity), ambient:lerp(a.ambient,b.ambient), sky:color(a.sky,b.sky), fog:color(a.fog,b.fog), night:lerp(a.night,b.night), wetness:Math.max(wetness,lerp(a.wetness,b.wetness)), clouds:THREE.MathUtils.clamp(lerp(a.clouds,b.clouds)+wetness*.35,0,1), progress:t };
}
export function atmosphericState(hour,wetness=0){
  const p=profileAt(hour,wetness),day=1-p.night;
  const h=((hour%24)+24)%24,warm=Math.max(0,1-Math.min(Math.abs(h-6.5),Math.abs(h-18))/1.8);
  return {day,warm,night:p.night,clouds:p.clouds,sun:p.sunIntensity,ambient:p.ambient,profile:p.id,profileLabel:p.label};
}
export {TIME_PROFILES, profileAt};
export class Atmosphere {
  constructor(scene,renderer,ambient){
    this.scene=scene;this.renderer=renderer;this.ambient=ambient;this.envScene=new THREE.Scene();
    renderer.library.addLight(SunLightNode,SunLight);
    this.sun=new SunLight(0xffedce,4);this.sun.castShadow=true;this.sun.shadow.camera.far=140;this.sun.shadow.normalBias=.05;enableShadowProxyLayer(this.sun);
    scene.add(this.sun);
    this.sky=new SkyMesh();this.sky.name='Cielo atmosférico de Bogotá';this.sky.scale.setScalar(200000);this.sky.frustumCulled=false;
    this.sky.cloudScale.value=.00018;this.sky.cloudSpeed.value=.000015;this.sky.turbidity.value=8;this.sky.rayleigh.value=2.5;
    this.night=uniform(0);const raw=this.sky.material.colorNode;
    this.sky.material.colorNode=vec4(mix(raw.rgb.mul(.145),new THREE.Color('#0c172c'),this.night),float(1));
    scene.add(this.sky);this.pmrem=new THREE.PMREMGenerator(renderer);this.target=null;this.quality='alta';
  }
  update(hour,wetness=0,forceBake=false){
    const p=profileAt(hour,wetness);this.hour=hour;this.wetness=wetness;this.profile=p.id;this.profileLabel=p.label;
    const lightsOn = hour < 6 || hour >= 20;
    cityUniforms.lightsOn.value = lightsOn ? 1 : 0;
    this.night.value=p.night;cityUniforms.night.value=p.night;cityUniforms.uInteriorGlow.value=lightsOn ? 1.25 : 0;cityUniforms.wetness.value=wetness;cityUniforms.clouds.value=p.clouds;
    this.day=1-p.night;setShadowActive(this.sun,this.shadowsEnabled!==false&&this.debugShadowsEnabled!==false&&p.night<.95);
    this.sun.intensity=p.sunIntensity;this.sun.color.copy(p.sunColor);
    const angle=(hour-6)/24*Math.PI*2;this.sun.position.set(Math.cos(angle)*.7,Math.max(.18,Math.sin(angle)),.45).normalize();this.sun.updateMatrixWorld();
    this.ambient.intensity=p.ambient;this.ambient.color.copy(p.sky);this.ambient.groundColor.set('#846b52');
    this.sky.sunPosition.value.copy(this.sun.position);this.sky.cloudCoverage.value=p.clouds;this.sky.cloudDensity.value=.3+wetness*.35;
    this.scene.environmentIntensity=.3+(1-p.night)*.4;
    this.scene.background.copy(p.sky);this.scene.fog.color.copy(p.fog);
    this.scene.fog.near=35+(1-p.night)*30;this.scene.fog.far=(this.quality==='baja'?145:this.quality==='media'?200:280)*(1-wetness*.12);
    const bucket=Math.floor(hour*2)+Math.floor(wetness*4)*100,now=performance.now();
    if(this.bucket!==bucket&&(forceBake||this.bucket===undefined||now-(this.lastBakeAt??-Infinity)>=5000)){
      this.bucket=bucket;this.lastBakeAt=now;this.bake();
    }
  }
  updateProfile(profileId, wetness=0){
    const hour=PROFILE_HOURS[profileId];
    if(hour===undefined) return false;
    this.update(hour,wetness,this.profile!==profileId);
    this.profile=profileId;this.profileLabel=TIME_PROFILES[profileId].label;
    return true;
  }
  bake(){
    const started=performance.now();
    const position=this.sky.position.clone();this.sky.position.set(0,0,0);this.sky.showSunDisc.value=0;this.envScene.add(this.sky);
    try{this.target=this.pmrem.fromScene(this.envScene,0,.1,100,{renderTarget:this.target});this.scene.environment=this.target.texture;}
    finally{this.sky.showSunDisc.value=1;this.scene.add(this.sky);this.sky.position.copy(position);this.lastBakeMs=performance.now()-started;this.bakeCount=(this.bakeCount??0)+1;}
  }
  // La calidad efectiva (presión de FPS) no toca las sombras: solo la elección manual las quita.
  setQuality(level){this.quality=level;}
  setShadowQuality(level){this.shadowsEnabled=level!=='baja';setShadowActive(this.sun,this.shadowsEnabled&&this.debugShadowsEnabled!==false&&(this.day??0)>.05);return setShadowResolution(this.sun,shadowResolutionFor(level));}
  followTarget(position){this.sky.position.copy(position);}
  dispose(){this.sky.removeFromParent();this.sky.geometry.dispose();this.sky.material.dispose();this.sun.removeFromParent();this.sun.dispose();this.target?.dispose();this.pmrem.dispose();}
}
