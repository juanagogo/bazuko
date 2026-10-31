const sharedAssets=new Map();
export function tagAssetTextures(gltf){
  const parser=gltf.parser;if(!parser)return gltf;
  gltf.scene.traverse(object=>{for(const material of [object.material].flat().filter(Boolean))for(const value of Object.values(material)){
    if(!value?.isTexture)continue;
    const association=parser.associations.get(value),definition=parser.json.textures?.[association?.textures];
    const source=definition?.extensions?.EXT_texture_webp?.source??definition?.extensions?.EXT_texture_avif?.source??definition?.extensions?.KHR_texture_basisu?.source??definition?.source;
    const image=parser.json.images?.[source];
    if(image?.uri&&!image.uri.startsWith('data:'))value.userData.assetUrl=new URL((parser.options.path??'')+image.uri,'http://bazuko.invalid').pathname;
  }});return gltf;
}
export function textureAssetKey(t){
  if(!t.userData?.assetUrl)return null;
  return [t.userData.assetUrl,t.colorSpace,t.type,t.format,t.mapping,t.channel,t.wrapS,t.wrapT,t.magFilter,t.minFilter,t.anisotropy,t.flipY,t.premultiplyAlpha,t.generateMipmaps,t.repeat.x,t.repeat.y,t.offset.x,t.offset.y,t.center.x,t.center.y,t.rotation].join('|');
}
export function resizeTexture(t,maxSize=1024,makeCanvas=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c;}){
  const image=t.image;
  if(!image?.width||!image?.height||t.isRenderTargetTexture||t.isCompressedTexture||t.isDataTexture||t.isCubeTexture||t.isVideoTexture)return false;
  const ratio=Math.min(1,maxSize/Math.max(image.width,image.height));if(ratio===1)return false;
  const canvas=makeCanvas(Math.max(1,Math.round(image.width*ratio)),Math.max(1,Math.round(image.height*ratio)));
  const context=canvas.getContext('2d');context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high';context.drawImage(image,0,0,canvas.width,canvas.height);
  t.image=canvas;t.needsUpdate=true;return true;
}
export async function prepareSceneTextures(roots,{maxSize=1024,canvasMaxSize=512,makeCanvas,assets=sharedAssets,yieldTask=()=>new Promise(resolve=>setTimeout(resolve,0))}={}){
  const materials=new Set(),textures=new Set();
  for(const root of roots)root.traverse(o=>{for(const material of [o.material].flat().filter(Boolean))materials.add(material);});
  let resized=0,reused=0,processed=0;
  for(const material of materials)for(const [name,original] of Object.entries(material)){
    if(!original?.isTexture||original.isRenderTargetTexture)continue;
    const key=textureAssetKey(original);let texture=key?assets.get(key):null;
    if(texture&&texture!==original){material[name]=texture;reused++;}
    else {texture=original;if(key)assets.set(key,texture);}
    if(!textures.has(texture)){textures.add(texture);if(resizeTexture(texture,texture.isCanvasTexture?Math.min(canvasMaxSize,maxSize):maxSize,makeCanvas))resized++;if(++processed%8===0)await yieldTask();}
  }
  return {textures,resized,reused};
}
