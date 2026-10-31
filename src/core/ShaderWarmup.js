import { Group } from 'three';

// Shader programs depend on layout and features, not material UUID, tint or texture identity.
const ignored=new Set(['id','uuid','name','version','userData','opacity','_listeners']);
const exactNumbers=new Set(['side','blending','blendSrc','blendDst','blendEquation','blendSrcAlpha','blendDstAlpha','blendEquationAlpha','depthFunc','stencilFunc','stencilFail','stencilZFail','stencilZPass']);
export function materialShaderKey(material){
  const values=[material.type,material.customProgramCacheKey?.()??'',material.clippingPlanes?.length??0];
  for(const key of Object.keys(material).sort()){
    if(ignored.has(key)||key.startsWith('_')||key.startsWith('is'))continue;
    const value=material[key];
    if(typeof value==='function')continue;
    if(value?.isTexture){values.push(key,[value.mapping,value.channel,value.colorSpace,value.format,value.type,value.magFilter,value.minFilter,value.wrapS,value.wrapT,value.wrapR,!!value.isCubeTexture,!!value.isDepthTexture,!!value.isData3DTexture].join(','));}
    else if(value?.isNode)values.push(key,value.getCacheKey());
    else if(value?.isColor)values.push(key,value.getHex()===0?'zero':'color');
    else if(typeof value==='number')values.push(key,exactNumbers.has(key)?value:Number(value!==0));
    else if(typeof value==='boolean'||typeof value==='string'||value===null)values.push(key,String(value));
  }
  return values.join('|');
}
export function collectShaderWarmupJobs(roots){
  const jobs=new Map();let objects=0;
  for(const root of roots)root.traverse(object=>{
    if(!object.material||!object.geometry||(!object.visible&&!object.userData.prepareWhileHidden))return;
    objects++;
    const materials=[object.material].flat(),geometry=object.geometry;
    const attributes=Object.entries(geometry.attributes).sort(([a],[b])=>a.localeCompare(b)).map(([key,a])=>`${key}:${a.itemSize}:${a.normalized}:${!!a.isInstancedBufferAttribute}:${a.array.constructor.name}`).join('|');
    const morphs=Object.entries(geometry.morphAttributes).map(([name,list])=>`${name}:${list.length}`).join('|');
    const key=materials.map(materialShaderKey).join(';')+attributes+`:${!!object.isSkinnedMesh}:${object.skeleton?.bones.length??0}:${!!object.isInstancedMesh}:${object.instanceMatrix?.isStorageInstancedBufferAttribute??false}:${!!object.receiveShadow}:${morphs}:${geometry.index?.array.constructor.name}`;
    if(!jobs.has(key))jobs.set(key,[]);
    if(!jobs.get(key).includes(object))jobs.get(key).push(object);
  });
  return {jobs:[...jobs.values()],objects};
}

/** Flat compilation views: keep real parents, world matrices, materials and every binding.
 * compileAsync traverses the target scene for lights on EACH call. Batching avoids doing
 * that once per mesh (thousands of full-city traversals), without skipping any object.
 */
export function shaderCompilationBatches(families, size = 64) {
  const batches = [];
  for (const family of families) for (let i = 0; i < family.length; i += size) {
    const batch = new Group();
    batch.matrixAutoUpdate = batch.matrixWorldAutoUpdate = false;
    batch.children = family.slice(i, i + size);
    batches.push(batch);
  }
  return batches;
}

/** Slop compiles every binding in a family, not only its first object. */
export async function withoutFrustumCulling(roots, run) {
  const saved=new Map();
  for(const root of roots)root.traverse(o=>{if(!saved.has(o)){saved.set(o,o.frustumCulled);o.frustumCulled=false;}});
  try{return await run();}finally{for(const [o,value] of saved)o.frustumCulled=value;}
}

/** LOD banks can be empty/hidden at spawn, yet needed a few metres away. Keep
 * their real buffers and bindings, prepare them without changing the chosen LOD.
 */
export async function withWarmupVariants(roots, run) {
  const saved = new Map();
  for (const root of roots) root.traverse(object => {
    if (!object.userData.prepareWhileHidden || saved.has(object)) return;
    saved.set(object, [object.visible, object.userData.preparingGraphics]);
    object.visible = true;
    object.userData.preparingGraphics = true;
  });
  try { return await run(); }
  finally { for (const [object, [visible, preparing]] of saved) {
    object.visible = visible;
    if (preparing === undefined) delete object.userData.preparingGraphics;
    else object.userData.preparingGraphics = preparing;
  } }
}
export async function compileShaderJobs(jobs,compile,{concurrency=4,onProgress=()=>{},yieldTask=()=>new Promise(resolve=>setTimeout(resolve,0))}={}){
  let next=0,done=0,failure;
  const worker=async()=>{while(!failure&&next<jobs.length){const object=jobs[next++];await yieldTask();if(failure)return;try{await compile(object);onProgress(++done,jobs.length);}catch(error){failure=error;}}};
  await Promise.all(Array.from({length:Math.min(concurrency,jobs.length)},worker));
  if(failure)throw failure;
}
