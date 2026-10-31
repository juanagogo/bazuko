// MRT + SSR arrangement adapted from Slop New York 1b54e165 (MIT).
import * as THREE from 'three/webgpu';
import {pass,mrt,output,normalView,positionView,metalness,roughness,vec2,smoothstep,vec4} from 'three/tsl';
import {ssr} from 'three/addons/tsl/display/SSRNode.js';
import {createPostProcessing} from './PostProcessing.js';
import {GRAPHICS_PROFILES} from '../core/GraphicsQuality.js';
import {withFrameTransforms} from './FrameTransforms.js';
export class VisualPipeline {
  constructor(renderer,scene,camera,quality,overlay,sharedScenePass=null,effectsEnabled=true){
    this.renderer=renderer;this.scene=scene;this.ownsScenePass=!sharedScenePass;this.scenePass=sharedScenePass??pass(scene,camera);this.quality=quality;
    let reflections=vec4(0);
    if(!sharedScenePass){
      const fade=smoothstep(220,100,positionView.z.negate());
      const targets=mrt({output,normal:normalView,metalRough:vec2(roughness.lessThan(.75).select(metalness.mul(fade),0),roughness)});
      targets.setBlendMode('normal',new THREE.BlendMode(THREE.MaterialBlending));targets.setBlendMode('metalRough',new THREE.BlendMode(THREE.MaterialBlending));
      this.scenePass.setMRT(targets);
    }
    if(effectsEnabled&&quality==='alta'){
      const properties=this.scenePass.getTextureNode('metalRough');
      this.ssr=ssr(this.scenePass.getTextureNode('output'),this.scenePass.getTextureNode('depth'),this.scenePass.getTextureNode('normal'),{metalnessNode:properties.r,roughnessNode:properties.g,camera});
      this.ssr.resolutionScale=.5;this.ssr.blurQuality=1;this.ssr.maxDistance.value=24;this.ssr.thickness.value=.4;this.ssr.quality.value=.25;this.ssr.binaryRefine=true;this.ssr.intensity.value=.45;this.ssr.screenEdgeFadeBlack=true;
      reflections=this.ssr.mul(properties.r.greaterThan(0).select(smoothstep(.75,.55,properties.g),0));
    }
    // Paint the silhouette into the scene target with the world's original depth, before grading.
    if(!sharedScenePass){
    const update=this.scenePass.updateBefore.bind(this.scenePass);
    this.scenePass.updateBefore=frame=>{update(frame);if(!overlay)return;const target=renderer.getRenderTarget(),targets=renderer.getMRT();try{renderer.setRenderTarget(this.scenePass.renderTarget);renderer.setMRT(this.scenePass.getMRT());overlay();}finally{renderer.setRenderTarget(target);renderer.setMRT(targets);}};
    }
    // Preserve the sky/sun glow when adaptive quality drops; reduce its cost, not its intensity.
    const profile=GRAPHICS_PROFILES[quality]??GRAPHICS_PROFILES.alta;
    this.grade=createPostProcessing(renderer,this.scenePass.getTextureNode('output'),reflections,effectsEnabled&&profile.bloom,profile.bloomResolution);
    this.pipeline=new THREE.RenderPipeline(renderer,this.grade.outputNode);
  }
  render(hour=12){this.grade.update(hour);withFrameTransforms(this.scene,()=>this.pipeline.render());}
  dispose(){this.pipeline.dispose();if(this.ownsScenePass)this.scenePass.dispose();this.ssr?.dispose();this.grade.bloomPass.dispose();}
}
