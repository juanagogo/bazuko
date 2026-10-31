import {Atmosphere,atmosphericState,TIME_PROFILES,profileAt} from '../src/graphics/Atmosphere.js';
import {GRAPHICS_PROFILES} from '../src/core/GraphicsQuality.js';
import {LocalLights} from '../src/core/LocalLights.js';
import * as THREE from 'three';
import test from 'node:test';
import assert from 'node:assert/strict';
import { isShadowActive } from '../src/graphics/ShadowState.js';
import { SceneManager } from '../src/core/Scene.js';
import { cityUniforms } from '../src/graphics/GraphicsState.js';

test('las luces siguen el horario visual aunque el reloj permanezca de noche',()=>{
 const scene=new SceneManager();scene._hour=22;
 assert.equal(scene.isVisualNight,true);
 for(const profile of ['golden','midday']){scene.setTimeProfile(profile);assert.equal(scene.isVisualNight,false);}
 for(const profile of ['blue-hour','night']){scene.setTimeProfile(profile);assert.equal(scene.isVisualNight,true);}
 scene.setTimeProfile(null);assert.equal(scene.isVisualNight,true);
 scene._hour=12;assert.equal(scene.isVisualNight,false);
 scene.sun.dispose();
});

test('los comercios y sus halos se apagan de día aunque actualicen su intensidad',()=>{
 const scene=new THREE.Scene(),lights=new LocalLights(scene);
 lights.setQuality('baja');
 const shop=new THREE.PointLight('white',3,7);scene.add(shop);
 const target=new THREE.Vector3();
 lights.update(0,target,()=>0,null,true);
 assert.ok(lights.pool.some(light=>light.intensity>0));
 assert.equal(lights.halos.mesh.count,1);
 for(const intensity of [3,2.6,5]){
  shop.intensity=intensity;
  lights.update(0,target,()=>0,null,false);
  assert.ok(lights.pool.every(light=>light.intensity===0));
  assert.equal(lights.halos.mesh.count,0);
 }
 lights.update(0,target,()=>0,null,true);
 assert.ok(lights.pool.some(light=>light.intensity>0));
 lights.dispose();
});
test('el clima y reloj producen transiciones continuas de luz y nubosidad',()=>{
 const night=atmosphericState(23,.8),day=atmosphericState(13,0);assert.equal(night.night,1);assert.equal(day.day,1);assert.ok(day.sun>night.sun);assert.ok(night.clouds>day.clouds);
 for(let h=0;h<24;h+=.01){const a=atmosphericState(h),b=atmosphericState(h+.001);assert.ok(Math.abs(a.sun-b.sun)<.02);}
});
test('el reloj expone los cuatro perfiles de Slop adaptados a Bogotá',()=>{
 assert.deepEqual(Object.keys(TIME_PROFILES),['golden','midday','blue-hour','night']);
 assert.equal(profileAt(13,0).id,'midday');
 assert.equal(profileAt(18,0).id,'golden');
 assert.equal(profileAt(20,0).id,'blue-hour');
 assert.equal(profileAt(23,0).id,'night');
 for(let h=0;h<24;h+=.05){const p=profileAt(h,.7);assert.ok(p.sunColor.isColor&&Number.isFinite(p.sunIntensity));assert.ok(p.clouds>=0&&p.clouds<=1);}
});
test('los perfiles WebGPU limitan luces y dejan SSR solo en alta',()=>{
 assert.deepEqual(['baja','media','alta'].map(q=>GRAPHICS_PROFILES[q].localLights),[16,48,96]);assert.equal(GRAPHICS_PROFILES.alta.ssr,true);assert.equal(GRAPHICS_PROFILES.media.ssr,false);
 for(const profile of Object.values(GRAPHICS_PROFILES))assert.equal(profile.bloom,true,'el resplandor del cielo permanece en todas las calidades');
 assert.equal(GRAPHICS_PROFILES.baja.bloomResolution,.25);assert.equal(GRAPHICS_PROFILES.media.bloomResolution,.5);
 const scene=new THREE.Scene(),lights=new LocalLights(scene);lights.setQuality('baja');const spot=new THREE.SpotLight('white',650,30);spot.position.set(2,1,0);spot.target.position.set(10,0,0);scene.add(spot,spot.target);lights.update(0,new THREE.Vector3());assert.ok(lights.spotPool.some(s=>s.intensity===650));assert.ok(lights.pool.every(s=>s.intensity===0));lights.dispose();
});

test('las sombras solares se pausan de noche y regresan de dia segun la calidad elegida sin cambiar castShadow',()=>{
 const scene=new THREE.Scene();scene.background=new THREE.Color();scene.fog=new THREE.Fog('black',1,100);
 const fake={scene,quality:'alta',sun:new THREE.DirectionalLight(),ambient:new THREE.HemisphereLight(),night:{value:0},sky:{sunPosition:{value:new THREE.Vector3()},cloudCoverage:{},cloudDensity:{}},bake(){}};
 Atmosphere.prototype.update.call(fake,22,.6);assert.equal(isShadowActive(fake.sun),false);assert.equal(fake.sun.castShadow,true);
 assert.equal(cityUniforms.lightsOn.value,1);
 Atmosphere.prototype.update.call(fake,12,0);assert.equal(isShadowActive(fake.sun),true);assert.equal(fake.sun.shadow.needsUpdate,true);
 assert.equal(cityUniforms.lightsOn.value,0);
 fake.quality='baja';Atmosphere.prototype.update.call(fake,12,0);assert.equal(isShadowActive(fake.sun),true,'la presión de FPS no quita las sombras');
 fake.shadowsEnabled=false;Atmosphere.prototype.update.call(fake,12,0);assert.equal(isShadowActive(fake.sun),false);assert.equal(fake.sun.castShadow,true);
});

test('seguir al jugador solo mueve el cielo, sin rehacer el entorno',()=>{
 const fake={sky:{position:new THREE.Vector3()}};Atmosphere.prototype.followTarget.call(fake,new THREE.Vector3(2,0,3));assert.equal(fake.sky.position.x,2);assert.equal(fake.bakeCount,undefined);
});

test('la humedad inicial no encadena bakes y un perfil manual sí renueva el entorno',()=>{
 const scene=new THREE.Scene();scene.background=new THREE.Color();scene.fog=new THREE.Fog('black',1,100);let bakes=0;
 const fake={scene,quality:'alta',sun:new THREE.DirectionalLight(),ambient:new THREE.HemisphereLight(),night:{value:0},sky:{sunPosition:{value:new THREE.Vector3()},cloudCoverage:{},cloudDensity:{}},bake(){bakes++;},update:Atmosphere.prototype.update};
 Atmosphere.prototype.update.call(fake,22,.6);Atmosphere.prototype.update.call(fake,22,.75);Atmosphere.prototype.update.call(fake,22,1);assert.equal(bakes,1);
 fake.lastBakeAt=-5001;Atmosphere.prototype.update.call(fake,22,1);assert.equal(bakes,2);
 Atmosphere.prototype.updateProfile.call(fake,'midday',0);assert.equal(bakes,3);assert.equal(fake.profile,'midday');
});
