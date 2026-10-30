import {createDrivingVisual} from '../vehicles/DrivingVisual.js';
import {vehicleBatches} from '../vehicles/VehicleBatches.js';
// src/entities/Car.js
import * as THREE from 'three';
import { COLORS, CAR_COOLDOWN } from '../utils/constants.js';
import { makeVehicle } from '../world/bogota/vehicles.js';
import { createVehicleVisual } from '../vehicles/VehicleVisuals.js';
import { VEHICLE_TYPES } from '../vehicles/VehicleTypes.js';

const SHIRTS = [0x8a2b2b, 0x2b4a8a, 0x3a3a3a, 0xc9b27a, 0x2f6b45, 0xe0e0e0];
const SKINS = [0xe0b08a, 0xc68a5e, 0x9a6440, 0x6e4529];

/** Conductor sentado: torso y cabeza simples, visibles por las ventanas sin cargar un personaje completo. */
function createSeatedDriver(height) {
  const group = new THREE.Group();
  group.name = 'Conductor';
  const shirt = new THREE.MeshStandardMaterial({ color: SHIRTS[Math.floor(Math.random() * SHIRTS.length)], roughness: .9 });
  const skin = new THREE.MeshStandardMaterial({ color: SKINS[Math.floor(Math.random() * SKINS.length)], roughness: .8 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(.26, .42, .38), shirt);
  torso.position.y = height - .62;
  const head = new THREE.Mesh(new THREE.SphereGeometry(.11, 10, 8), skin);
  head.position.y = height - .3;
  group.add(torso, head);
  // Frente hacia +X local; en Colombia se conduce desde el lado izquierdo (−Z).
  group.position.set(.05, 0, -.36);
  return group;
}

const CRIOLLOS = new Set(['zapatico', 'huevito', 'amigofiel']);

export class Car {
  constructor(scene, position, rotation = 0, { traffic = false, kind = null, variant = null, visualMode = 'slop', visualFactory = createVehicleVisual } = {}) {
    this.scene = scene;
    this.used = false;
    this.cooldown = 0;
    this.traffic = traffic;
    this.controller=traffic?'traffic':'parked';
    this.visualMode = visualMode;
    this._visualFactory = visualFactory;
    this._visualToken = 0;
    this.pursuit = false;

    this.group = new THREE.Group();
    this.group.position.copy(position);
    this.group.rotation.y = rotation;
    scene.add(this.group);

    // Particular, taxi o patrulla; la carrocería del donante usa el frente +X local.
    const resolvedKind = (variant?.startsWith('police')?'police':kind) ?? (Math.random() < 0.3 ? 'taxi' : 'carro');
    this.kind = resolvedKind;
    if (resolvedKind === 'police') variant ??= 'police_pickup';
    this._variant = variant;
    this.modelKind = (variant ?? (resolvedKind === 'taxi' ? 'taxi' : 'sedan')) === 'taxi' ? 'car2' : 'car1';
    this.visualSeed = Math.floor(Math.random() * 8);
    const v = makeVehicle(resolvedKind, this.visualSeed, { beams: false });
    this.vehicle = v;
    if (!traffic && v.beam) v.beam.visible = false;
    this.length = v.length;
    this.width = v.width;
    this.height = VEHICLE_TYPES[this.variant]?.height ?? 1.75;
    if (variant && VEHICLE_TYPES[variant]) {this.length=VEHICLE_TYPES[variant].length;this.width=VEHICLE_TYPES[variant].width;}
    v.group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.group.add(v.group);
    // Barra de luces propia de la patrulla, encima de cualquier carrocería (la del donante no la trae).
    if (resolvedKind === 'police') this._buildLightbar();

    // Faros físicos: el gestor global selecciona sus proxies según distancia y calidad.
    this.headlights=[];
    for(const side of [-1,1]){
      const light=new THREE.SpotLight('#fff3d6',0,30,.2,.85,2);light.position.set(this.length/2-.03,.65,side*.6);light.target.position.set(12,-.35,side*.65);light.castShadow=false;
      light.userData.dynamicLight=true;
      this.group.add(light,light.target);this.headlights.push(light);
    }

    // Retrovisores (lo que se roba): a los lados, en la base del parabrisas
    const mirrorMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.4, metalness: 0.4 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x9fb4c4, roughness: 0.05, metalness: 0.8 });
    this.mirrors = [];
    for (const side of [-1, 1]) {
      const m = new THREE.Group();
      const shell = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.13, 0.2), mirrorMat);
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.1), glassMat);
      glass.rotation.y = -Math.PI / 2;
      glass.position.x = -0.065;
      m.add(shell, glass);
      m.position.set(0.82, 1.02, side * (v.width / 2 + 0.1));
      this.group.add(m);
      this.mirrors.push(m);
    }

    // Marcador flotante
    const markerGeo = new THREE.RingGeometry(1.2, 1.5, 24);
    const markerMat = new THREE.MeshBasicMaterial({
      color: COLORS.ACCENT_RED,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.7
    });
    this.marker = new THREE.Mesh(markerGeo, markerMat);
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.position.y = 0.05;
    this.marker.visible = !traffic;
    this.group.add(this.marker);
    // Los estacionados dibujan su aro en el lote del banco de vehículos, como el tráfico su carrocería.
    if (!traffic && scene.isScene) this._releaseMarker = vehicleBatches(scene).addMarker(this.marker);

    // Solo los carros en circulación llevan conductor; los estacionados activan la alarma.
    this.driver = traffic ? createSeatedDriver(this.modelKind === 'car2' ? 1.45 : 1.62) : null;
    if (this.driver) this.group.add(this.driver);
  }

  /** Muestra u oculta al conductor sentado (se baja del carro o vuelve a subir). */
  setDriverInside(inside) {
    this.driverInside = inside;
    if (this.driver) this.driver.visible = inside && !this.driverHidden;
  }

  /** Punto junto a la puerta del conductor, en metros del mundo. */
  driverDoor(target = new THREE.Vector3()) {
    this.group.updateMatrixWorld();
    return target.set(.05, 0, -(this.width / 2 + .55)).applyMatrix4(this.group.matrixWorld).setY(this.group.position.y);
  }

  _buildLightbar() {
    const roof = (VEHICLE_TYPES[this.variant]?.height ?? 1.75) + .02, width = this.width;
    const bar = new THREE.Mesh(new THREE.BoxGeometry(.85, .1, width - .35), new THREE.MeshStandardMaterial({ color: '#101214', roughness: .4, metalness: .65 }));
    bar.position.set(-.2, roof, 0);
    const blue = new THREE.MeshBasicMaterial({ color: new THREE.Color('#1a6cff').multiplyScalar(3) });
    const red = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff1a2a').multiplyScalar(3) });
    const left = new THREE.Mesh(new THREE.BoxGeometry(.35, .1, .28), blue), right = new THREE.Mesh(new THREE.BoxGeometry(.35, .1, .28), red);
    left.position.set(-.2, roof + .06, .26); right.position.set(-.2, roof + .06, -.26);
    this.lightbar = new THREE.Group();
    this.lightbar.name = 'Barra de luces de patrulla';
    this.lightbar.add(bar, left, right);
    this.group.add(this.lightbar);
    this.policeLights = { blue, red };
  }

  get position() { return this.group.position; }
  get variant() { return this._variant ?? (this.modelKind === 'car2' ? 'taxi' : 'sedan'); }

  preloadModel() {
    // Los carros criollos estacionados (Zapatico, Huevito, Amigo Fiel) no existen en el donante: conservan su carrocería.
    if (!this._variant && CRIOLLOS.has(this.vehicle.model)) return this._modelPromise ??= Promise.resolve().then(()=>{if(!this.traffic&&!this._disposed)this.prepareDrivingVisual();});
    return this._modelPromise ??= this.setVisualMode(this.visualMode).then(()=>{if(!this.traffic&&!this._disposed)this.prepareDrivingVisual();});
  }

  async prepareVisualMode(mode) {
    if(!['actual','slop'].includes(mode))throw new Error('Representación de vehículo no válida');
    if(this._disposed)return {commit:()=>false,release(){}};
    const token=++this._visualToken;
    if(this.vehicle.mode===mode)return {commit:()=>true,release(){}};
    const next=await this._visualFactory(mode,{variant:this.variant,seed:this.visualSeed,length:this.length,width:this.width,scene:this.scene,mirrors:this.mirrors});
    next.mode=mode;
    let settled=false;
    const release=()=>{if(!settled){settled=true;next.dispose();}};
    return {release,commit:()=>{
      if(settled)return false;
      if(this._disposed||token!==this._visualToken){release();return false;}
      next.setNight?.(this._night);
      next.updateMotion?.(this._travelled??0,this._braking??false);
      this.group.add(next.group);
      const previous=this.vehicle;
      this.vehicle=next;this.visualMode=mode;
      this.importedModel=mode==='actual'?next.group:undefined;
      this.group.remove(previous.group);previous.dispose();next.activate?.();
      // Los vidrios del donante son oscuros: el conductor sentado no se vería y solo sumaría dibujos.
      this.driverHidden=true;if(this.driver)this.driver.visible=false;
      this.syncHeadlights();
      settled=true;return true;
    }};
  }

  async setVisualMode(mode) {
    const prepared=await this.prepareVisualMode(mode);
    return prepared.commit();
  }

  setNight(night) {
    if(this._night===!!night)return;
    this._night=!!night;this.vehicle.setNight?.(this._night);
    for(const light of this.headlights)light.intensity=this._night?650:0;
    // Carrocerías criollas: sus reflejos de faro solo se ven de noche (los faros reales son las luces de arriba).
    for(const flare of this.vehicle.flares??[])flare.visible=this._night;
  }

  /**
   * Robar retrovisores.
   * @param {number} caughtMult - mult de probabilidad de atrapar (talentos)
   * @returns { items, caught }
   */
  steal(caughtMult = 1) {
    // A una patrulla no se le roban los espejos.
    if (this.kind === 'police' || this.used || this.cooldown > 0) return null;

    const items = [];
    const mirrorCount = Math.random() < 0.5 ? 2 : 1;
    for (let i = 0; i < mirrorCount; i++) items.push('retrovisor');
    if (!this.traffic && Math.random() < 0.2) items.push('radio');

    const caughtChance = 0.25 * caughtMult;
    const caught = Math.random() < caughtChance;

    this.used = true;
    this.cooldown = CAR_COOLDOWN;
    this.mirrors.forEach((m) => (m.visible = false));
    this.marker.visible = false;

    return { items, caught };
  }

  update(dt) {
    if (this.cooldown > 0) {
      this.cooldown -= dt;
      if (this.cooldown <= 0) {
        this.used = false;
        this.mirrors.forEach((m) => (m.visible = true));
        this.marker.visible = !this.traffic;
      }
    }
    if (this.marker.visible) {
      this.marker.rotation.z += dt * 0.5;
    }
  }

  prepareDrivingVisual(){if(!this.drivingVisual){this.drivingVisual=createDrivingVisual(this);this.group.add(this.drivingVisual.group);}return this.drivingVisual;}
  setControlled(enabled){
    this.marker.visible=!enabled&&!this.traffic&&!this.used;
    this.vehicle.suspended=enabled;this.vehicle.group.visible=!enabled;
    if(this.drivingVisual)this.drivingVisual.group.visible=enabled;
    for(const mirror of this.mirrors)for(const child of mirror.children)child.visible=enabled||this.visualMode!=='slop';
    if(!enabled&&this.drivingVisual){this.drivingVisual.update(0,0,0,0);}
    this.syncHeadlights();
  }

  syncHeadlights(){
    const visual=this.controller==='player'?this.drivingVisual:this.vehicle;
    const frame=visual?.headlightFrame,spec=visual?.headlightSpec;
    if(frame&&spec){
      frame.updateWorldMatrix(true,false);
      this._headlightMatrix??=new THREE.Matrix4();this._headlightInverse??=new THREE.Matrix4();
      this._headlightMatrix.multiplyMatrices(this._headlightInverse.copy(this.group.matrixWorld).invert(),frame.matrixWorld);
    }
    this.headlights.forEach((light,i)=>{
      const side=i===0?-1:1;
      if(frame&&spec){
        light.position.set(side*spec.headlight[0],spec.headlight[1],spec.zFront+.02).applyMatrix4(this._headlightMatrix);
        light.target.position.set(side*spec.headlight[0],spec.headlight[1]-.8,spec.zFront+12).applyMatrix4(this._headlightMatrix);
      }else{
        light.position.set(this.length/2-.03,.65,side*.6);light.target.position.set(12,-.35,side*.65);
      }
    });
  }

  setPose(pitch,roll,heave=0){
    this.vehicle.setPose?.(pitch,roll,heave);
    if(!this.vehicle.setPose){this.vehicle.group.rotation.x=roll;this.vehicle.group.rotation.z=-pitch;this.vehicle.group.position.y=heave;}
    this.syncHeadlights();
  }
  setSteering(angle,signal=0){this.steerAngle=angle;this.turnSignal=signal;this.vehicle.setSteering?.(angle,signal);}

  animateDrive(distance, braking) {
    this._travelled=(this._travelled??0)+distance;
    this.vehicle.updateMotion?.(distance,braking);
    if(this.drivingVisual){const state=this.drivingVisual.material.userData.vehicleState;state.braking.value=braking?1:0;state.night.value=this._night?1:0;}
    const wasBraking=this._braking; this._braking=braking;
    for (const wheel of this.vehicle.wheels) wheel.rotation.z -= distance / 0.33;
    if (this.vehicle.tailMat && braking !== wasBraking) {
      this.vehicle.tailMat.color.set('#ff1a12').multiplyScalar(braking ? 3 : 1.4);
    }
    const lights = this.policeLights ?? this.vehicle.policeLights;
    if (lights) {
      const on = Math.floor(performance.now() / (this.pursuit ? 90 : 160)) % 2 === 0;
      lights.blue.color.set(on ? '#1a6cff' : '#061028').multiplyScalar(on ? 4 : 0.35);
      lights.red.color.set(on ? '#061028' : '#ff1a2a').multiplyScalar(on ? 0.35 : 4);
    }
  }

  dispose() {
    if(this._disposed)return;
    this._disposed = true;
    this._releaseMarker?.();
    this.drivingVisual?.dispose();
    this._visualToken++;
    this.scene.remove(this.group);
    for(const light of this.headlights)light.dispose();
    this.group.remove(this.vehicle.group);
    this.vehicle.dispose();
    const geometries = new Set(), materials = new Set();
    this.group.traverse((o) => {
      if (o.geometry) geometries.add(o.geometry);
      if (o.material) materials.add(o.material);
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
  }
}
