import {GraphicsDiagnostics} from './GraphicsDiagnostics.js';
import {prepareSceneTextures} from './TextureBudget.js';
import {collectShaderWarmupJobs,shaderCompilationBatches,compileShaderJobs,withoutFrustumCulling,withWarmupVariants} from './ShaderWarmup.js';
import {compileScenePass} from '../graphics/ScenePassPreparation.js';
import {installStableInstanceShaders} from '../graphics/StableInstanceShaders.js';
import {syncVehicleBatches,disposeVehicleBatches} from '../vehicles/VehicleBatches.js';
import {syncInstanceBatches,disposeInstanceBatches} from '../graphics/InstanceBatches.js';
import {StableClusteredLighting} from '../graphics/StableClusteredLighting.js';
import {VisualPipeline} from '../graphics/VisualPipeline.js';
import * as THREE from 'three/webgpu';
import { createWebGPURenderer,initializeWebGPU,WEBGPU_QUALITY_KEY } from './WebGPU.js';
import { PlayerSilhouette } from './PlayerSilhouette.js';
import { AdaptiveResolution } from './AdaptiveResolution.js';
import { FrustumCulling } from './FrustumCulling.js';
import { paintLoadingFrame } from '../ui/LoadingScreen.js';
import { GRAPHICS_PROFILES, effectiveQuality } from './GraphicsQuality.js';
import { installStableSkinningNames } from './StableSkinning.js';

installStableSkinningNames();

/** Entorno exterior urbano de Bogotá para reflejos PBR realistas en carros, asfalto y vidrios */
export class OutdoorUrbanEnvironment extends THREE.Scene {
  constructor() {
    super();
    this.name = 'OutdoorUrbanEnvironment';

    // Bóveda celeste con gradiente andino
    const skyGeo = new THREE.SphereGeometry(30, 24, 16);
    const skyMat = new THREE.MeshBasicMaterial({ color: 0x5682ad, side: THREE.BackSide });
    this.add(new THREE.Mesh(skyGeo, skyMat));

    // Bruma cálida en el horizonte urbano
    const horizGeo = new THREE.CylinderGeometry(29, 29, 12, 24, 1, true);
    const horizMat = new THREE.MeshBasicMaterial({ color: 0xd4b898, side: THREE.BackSide, transparent: true, opacity: 0.7 });
    const horiz = new THREE.Mesh(horizGeo, horizMat);
    horiz.position.y = 2;
    this.add(horiz);

    // Sol con alta intensidad para brillos especulares PBR en carrocerías y asfalto
    const sunPoint = new THREE.PointLight(0xfff5ea, 1200, 60, 1.8);
    sunPoint.position.set(16, 22, 12);
    this.add(sunPoint);

    // Suelo reflectante oscuro de asfalto bogotano
    const groundGeo = new THREE.PlaneGeometry(60, 60);
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x181a1d, roughness: 0.75 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.5;
    this.add(ground);

    // Siluetas de edificios para reflejos urbanos realistas en ventanas y vehículos
    const boxGeo = new THREE.BoxGeometry(6, 14, 6);
    const bMat = new THREE.MeshStandardMaterial({ color: 0x3a332d, roughness: 0.8 });
    for (const [bx, bz] of [[-14, 8], [15, -10], [-10, -14], [12, 12]]) {
      const b = new THREE.Mesh(boxGeo, bMat);
      b.position.set(bx, 6.5, bz);
      this.add(b);
    }
  }

  dispose() {
    this.traverse(o => {
      o.geometry?.dispose?.();
      o.material?.dispose?.();
    });
  }
}

export class Renderer {
  constructor(canvas) {
    this.instance = createWebGPURenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      // Solo con ?perf: consultas de tiempo de GPU para repartir el cuadro entre CPU y GPU.
      trackTimestamp: globalThis.location?.search?.includes('perf') === true
    });
    this.resolution = new AdaptiveResolution(window.devicePixelRatio);
    this.instance.setPixelRatio(this.resolution.ratio);
    this.instance.setSize(window.innerWidth, window.innerHeight);
    this.instance.shadowMap.enabled = true;
    this.instance.shadowMap.type = THREE.PCFShadowMap;

    // Look realista: tone mapping fílmico
    this.instance.toneMapping = THREE.ACESFilmicToneMapping;
    this.instance.toneMappingExposure = 1.05;
    this.instance.outputColorSpace = THREE.SRGBColorSpace;
    this.silhouette = new PlayerSilhouette();
    this.culling = new FrustumCulling();
    this.diagnostics=new GraphicsDiagnostics();
    // El contador incluye las tres pasadas, no solo la última del personaje.
    this.instance.info.autoReset = false;

    this._resizeListener=()=>this._onResize();this._visibilityListener=()=>this.resolution.resetWindow();
    window.addEventListener('resize',this._resizeListener);document.addEventListener('visibilitychange',this._visibilityListener);
  }

  setQuality(level = 'alta', persist = true) {
    this.quality = ['baja', 'media', 'alta'].includes(level) ? level : 'alta';
    const limit = GRAPHICS_PROFILES[this.quality].pixelRatio;
    this.resolution.setLimit(Math.min(globalThis.window?.devicePixelRatio || 1, limit));
    this.instance.setPixelRatio(this.resolution.ratio);
    // shadowMap.enabled queda fijo: alternarlo reconstruye todos los RenderObject (ShadowState.js).
    try { if(persist)localStorage.setItem(WEBGPU_QUALITY_KEY, this.quality); } catch { /* sin almacenamiento */ }
  }

  get effectiveQuality() {
    const wanted=effectiveQuality(this.quality ?? 'alta',this.resolution?.pressure??0);
    if(!this.readyQualities||this.readyQualities.has(wanted))return wanted;
    return this.readyQualities.has('baja')?'baja':this.quality;
  }

  _onResize() {
    this.instance.setSize(window.innerWidth, window.innerHeight);
    if (this.composer) {
      this.composer.setSize(window.innerWidth, window.innerHeight);
    }
  }

  async prepare(scene, camera, extraModels = []) {
    const started=performance.now();
    console.info('[WebGPU] Preparando recursos');
    syncVehicleBatches(scene,camera);syncInstanceBatches(scene,camera);
    const budget=await prepareSceneTextures([scene,...extraModels]);
    const textures=budget.textures;this.textureStats={unique:textures.size,resized:budget.resized,reused:budget.reused,prepareMs:performance.now()-started};
    console.info('[WebGPU] Texturas únicas',this.textureStats);
    let uploaded = 0, lastYield = performance.now();
    for (const texture of textures) {
      this.instance.initTexture(texture);
      uploaded++;
      if (performance.now()-lastYield>32){this.onPrepareProgress?.(`Texturas WebGPU: ${uploaded}/${textures.size}`);await paintLoadingFrame();lastYield=performance.now();}
    }
    this.textureStats.uploadMs=performance.now()-started-this.textureStats.prepareMs;
    if(this.instance.backend?.isWebGPUBackend)return this._compileWebGPU(scene,camera,extraModels);
    let target,targets;
    if(this.instance.backend?.isWebGPUBackend){
      this._ensurePipeline(scene,camera);target=this.instance.getRenderTarget();targets=this.instance.getMRT();this.instance.setRenderTarget(this.pipeline.scenePass.renderTarget);this.instance.setMRT(this.pipeline.scenePass.getMRT());
    }
    try{await this.instance.compileAsync(scene, camera);
    // Referencias temporales: no cambia los padres ni el LOD visible de cada NPC.
    const models = new THREE.Group();
    models.children = extraModels;
    try { await this.instance.compileAsync(models, camera, scene); }
    finally { models.children = []; }
    }finally{if(this.instance.backend?.isWebGPUBackend){this.instance.setRenderTarget(target);this.instance.setMRT(targets);}}
  }

  async _compileWebGPU(scene,camera,extraModels){
    const started=performance.now();
    this._ensurePipeline(scene,camera);
    const visible=scene.visible;scene.visible=false;
    try{this.pipeline.render(this.hour??22);}finally{scene.visible=visible;}
    const renderer=this.instance,target=renderer.getRenderTarget(),targets=renderer.getMRT(),culled=[];
    const {jobs,objects}=collectShaderWarmupJobs([scene,...extraModels]);
    this.startupStats={shaderFamilies:jobs.length,preparedBindings:jobs.reduce((n,f)=>n+f.length,0),renderObjects:objects,textures:this.textureStats};
    console.info('[WebGPU] Familias gráficas',this.startupStats);
    this.onPrepareProgress?.(`Shaders TSL: 0/${jobs.length} familias`);
    renderer.setRenderTarget(this.pipeline.scenePass.renderTarget);renderer.setMRT(this.pipeline.scenePass.getMRT());
    scene.updateMatrixWorld();
    for(const root of extraModels)root.updateWorldMatrix(true,true);
    const batches=shaderCompilationBatches(jobs);
    this.startupStats.compileBatches=batches.length;
    for(const family of jobs)for(const object of family){culled.push([object,object.frustumCulled]);object.frustumCulled=false;}
    try{await withWarmupVariants([scene,...extraModels],()=>compileShaderJobs(batches,batch=>compileScenePass(renderer,batch,camera,scene),
      {concurrency:16,onProgress:(done,total)=>this.onPrepareProgress?.(`Shaders TSL: ${done}/${total} lotes`)}));}
    finally{for(const [object,value] of culled)object.frustumCulled=value;renderer.setRenderTarget(target);renderer.setMRT(targets);}
    this.startupStats.compileMs=performance.now()-started;
  }

  prepareDynamic(root,scene,camera,decorate=()=>{},isActive=()=>true){
    const prepare=async()=>{
      if(this._disposed||!isActive())return false;
      const budget=await prepareSceneTextures([root]);decorate(root);
      if(!isActive())return false;
      for(const texture of budget.textures)this.instance.initTexture(texture);
      this._ensurePipeline(scene,camera);
      const target=this.instance.getRenderTarget(),targets=this.instance.getMRT(),started=performance.now();
      this.compilingDynamic=true;
      // compileAsync construye los nodos después de su primer await y lee getMRT() en ese momento:
      // el destino MRT debe seguir puesto hasta que termine, o el shader sale con una sola salida
      // y el pipeline (creado con el contexto MRT) falla. render() restaura el estado normal en
      // los cuadros que caen en medio y vuelve a poner este al terminar.
      this._compileState={target:this.pipeline.scenePass.renderTarget,mrt:this.pipeline.scenePass.getMRT(),restoreTarget:target,restoreMRT:targets};
      try{
        this.instance.setRenderTarget(this._compileState.target);this.instance.setMRT(this._compileState.mrt);
        await withoutFrustumCulling([root],()=>compileScenePass(this.instance,root,camera,scene));
      }finally{
        this._compileState=null;
        this.instance.setRenderTarget(target);this.instance.setMRT(targets);this.compilingDynamic=false;
        this.diagnostics?.record('dynamic-compile',performance.now()-started);
      }
    };
    const pending=(this._dynamicQueue??Promise.resolve()).then(prepare);this._dynamicQueue=pending.catch(()=>{});return pending;
  }

  async initialize() {
    return this._initialization ??= initializeWebGPU(this.instance).then(()=>{
      this.instance.onDeviceLost=info=>this.onDeviceLost?.(info);
      this.diagnostics.attach(this.instance.backend);this.diagnostics.attachRenderer(this.instance);
      installStableInstanceShaders(this.instance);
      this.instance.lighting=new StableClusteredLighting(256,32,28,48);
      return this;
    });
  }

  async waitForGPU() {
    await this.instance.backend.device.queue.onSubmittedWorkDone();
  }

  prepareQuality(scene,camera,playerRoot,options){
    const pending=(this._dynamicQueue??Promise.resolve()).then(()=>{
      if(this._disposed)throw new Error('El renderizador ya se liberó');
      return this.warmup(scene,camera,playerRoot,options);
    });
    this._dynamicQueue=pending.catch(()=>{});return pending;
  }

  dispose() {
    this._disposed=true;this.diagnostics?.dispose();
    window.removeEventListener('resize',this._resizeListener);document.removeEventListener('visibilitychange',this._visibilityListener);this.silhouette.material.dispose();
    if(this._pipelineScene){disposeVehicleBatches(this._pipelineScene);disposeInstanceBatches(this._pipelineScene);}
    for(const pipeline of this._pipelines?.values()??[])pipeline.dispose();this._pipelines?.clear();this.environment?.dispose();this.instance.dispose();
  }

  _ensurePipeline(scene,camera,quality=this.effectiveQuality){
    this._pipelines??=new Map();
    if(this._pipelineScene!==scene||this._pipelineCamera!==camera){
      for(const p of this._pipelines.values())p.dispose();this._pipelines.clear();
      this._pipelineScene=scene;this._pipelineCamera=camera;
    }
    const key=`${quality}:${this.effectsEnabled!==false}`;
    if(!this._pipelines.has(key))this._pipelines.set(key,new VisualPipeline(this.instance,scene,camera,quality,()=>{
      if(this._overlayRoot&&this._overlayEnabled)this.silhouette.render(this.instance,scene,camera,this._overlayRoot,this.overlayLights);
    },this._pipelines.values().next().value?.scenePass,this.effectsEnabled!==false));
    this.pipeline=this._pipelines.get(key);
  }

  /**
   * Dibuja la escena completa en cada calidad con su estado real (`applyQuality`) y en cada vista
   * (`views`: tercera persona e isométrica), incluida la silueta, antes de ocultar la carga.
   */
  async warmup(scene,camera,playerRoot,{applyQuality=()=>{},views=[()=>'vista'],qualities=['baja','media','alta'],effectsEnabled=this.effectsEnabled}={}){
    const started=performance.now();this.culling.restore();
    const requested=this.effectiveQuality;
    const previousEffects=this.effectsEnabled;this.effectsEnabled=effectsEnabled;
    this._overlayRoot=playerRoot;this._overlayEnabled=true;
    try{
      await withWarmupVariants([scene],()=>withoutFrustumCulling([scene],async()=>{
        for(const quality of new Set(qualities)){
          applyQuality(quality);
          for(const view of views){
            const label=view();
            const passStarted=performance.now(),before=this.diagnostics?.snapshot();
            this.onPrepareProgress?.(`Preparando vista completa: ${quality} · ${label}`);
            this._ensurePipeline(scene,camera,quality);this.pipeline.render(this.hour??22);
            await this.waitForGPU();await paintLoadingFrame();
            (this.startupStats.warmupPasses??=[]).push({quality,view:label,ms:performance.now()-passStarted,before,after:this.diagnostics?.snapshot()});
          }
          (this.readyQualities??=new Set()).add(quality);
        }
      }));
    }finally{this.effectsEnabled=previousEffects;applyQuality(requested);this._ensurePipeline(scene,camera,requested);}
    this.startupStats.fullWarmupMs=performance.now()-started;
  }

  /** Trabajo gráfico que aparece al dibujar `views` ya calentadas; debería ser cero. */
  async verifyPrepared(scene,camera,playerRoot,shadowLights,views){
    const before=this.diagnostics.snapshot();
    for(const view of views){view();this.render(scene,camera,playerRoot,shadowLights);await this.waitForGPU();}
    const after=this.diagnostics.snapshot();
    const leftover=Object.fromEntries(Object.keys(after).map(key=>[key,after[key]-before[key]]));
    this.startupStats.verification=leftover;
    if(leftover.programs||leftover.pipelines||leftover.discarded)console.warn('[WebGPU] Trabajo pendiente tras el calentamiento',leftover);
    return leftover;
  }

  render(scene, camera, playerRoot = null, shadowLights = [], showSilhouette = true) {
    const renderStarted=performance.now(),programs=this.diagnostics?.programs??0,compiling=this._compileState;
    if(compiling){this.instance.setRenderTarget(compiling.restoreTarget);this.instance.setMRT(compiling.restoreMRT);}
    syncVehicleBatches(scene,camera);
    this.instance.info.reset();
    this.culling.apply(camera, shadowLights);
    // Después del descarte: los recogibles fuera de vista y sombra no entran en su lote.
    syncInstanceBatches(scene,camera);
    try {
      if(this.instance.backend?.isWebGPUBackend){
      this._ensurePipeline(scene,camera);
      this._overlayRoot=playerRoot;this._overlayEnabled=showSilhouette&&GRAPHICS_PROFILES[this.effectiveQuality].silhouette;
      this.pipeline.render(this.hour??22);
      } else {this.instance.render(scene,camera);}
      if (!this.pipeline && playerRoot && showSilhouette && GRAPHICS_PROFILES[this.effectiveQuality].silhouette) {
        this.silhouette.render(this.instance, scene, camera, playerRoot, this.overlayLights);
      }
    } finally {
      this.culling.restore();
      if(compiling&&this._compileState===compiling){this.instance.setRenderTarget(compiling.target);this.instance.setMRT(compiling.mrt);}
      const ms=performance.now()-renderStarted;
      if(this.diagnostics){this.diagnostics.maxRenderMs=Math.max(this.diagnostics.maxRenderMs,ms);if(ms>100)this.diagnostics.record('render',ms,{newPrograms:this.diagnostics.programs-programs,quality:this.effectiveQuality});}
    }
  }

  adaptResolution(frameMs) {
    // La sonda `?perf` puede fijar la calidad para medir sin cambios automáticos.
    if (this.adaptiveLocked) return;
    if (this.resolution.sample(frameMs)) {
      this.diagnostics?.record('resolution',frameMs,{ratio:this.resolution.ratio,pressure:this.resolution.pressure,quality:this.effectiveQuality});
      // Solo resolución: las sombras de la calidad efectiva se pausan en Atmosphere sin cambiar claves.
      if (this.instance.getPixelRatio() !== this.resolution.ratio) this.instance.setPixelRatio(this.resolution.ratio);
    }
  }
}
