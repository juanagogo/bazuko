/** CPU submission timings, not GPU timings. Bounded and opt-in console output. */
export class GraphicsDiagnostics {
  constructor(){this.events=[];this.programs=0;this.pipelines=0;this.maxRenderMs=0;this.renderObjects=0;this.discarded=0;this.nodeBuilds=0;this.nodeBuildMs=0;}
  record(name,ms,details={}){this.sequence=(this.sequence??0)+1;this.events.push({sequence:this.sequence,name,ms:Math.round(ms*100)/100,t:Math.round(globalThis.performance?.now?.()??0),...details});if(this.events.length>128)this.events.shift();}
  attach(backend){
    this.restore??=[];
    for(const [method,counter] of [['createProgram','programs'],['createRenderPipeline','pipelines']]){
      if(typeof backend[method]!=='function')continue;
      const original=backend[method],stats=this;
      backend[method]=function(...args){const start=performance.now();try{return original.apply(this,args);}finally{stats[counter]++;const ms=performance.now()-start;if(ms>25)stats.record(method,ms);}};
      this.restore.push(()=>backend[method]=original);
    }
  }
  /**
   * Cuenta RenderObjects creados/descartados y estados de nodos construidos. Un cambio de clave
   * (sombras, castShadow, luces) descarta y reconstruye objetos aunque no cree programas nuevos.
   */
  attachRenderer(renderer){
    this.restore??=[];
    const objects=renderer?._objects,nodes=renderer?._nodes,stats=this;
    if(typeof objects?.createRenderObject==='function'){
      const create=objects.createRenderObject;
      objects.createRenderObject=function(...args){
        const renderObject=create.apply(this,args),onDispose=renderObject.onDispose;
        stats.renderObjects++;
        renderObject.onDispose=()=>{stats.discarded++;onDispose();};
        return renderObject;
      };
      this.restore.push(()=>objects.createRenderObject=create);
    }
    if(typeof nodes?.getForRender==='function'){
      const getForRender=nodes.getForRender;
      nodes.getForRender=function(renderObject,...args){
        if(this.get(renderObject).nodeBuilderState!==undefined)return getForRender.call(this,renderObject,...args);
        const start=performance.now();
        try{return getForRender.call(this,renderObject,...args);}finally{
          const ms=performance.now()-start;stats.nodeBuilds++;stats.nodeBuildMs+=ms;
          if(ms>15)stats.record('node-build',ms,{object:renderObject.object?.name,parent:renderObject.object?.parent?.name,material:renderObject.material?.name,camera:renderObject.camera?.type});
        }
      };
      this.restore.push(()=>nodes.getForRender=getForRender);
    }
  }
  snapshot(){return {programs:this.programs,pipelines:this.pipelines,renderObjects:this.renderObjects,discarded:this.discarded,nodeBuilds:this.nodeBuilds,nodeBuildMs:Math.round(this.nodeBuildMs)};}
  dispose(){for(const restore of this.restore??[])restore();this.restore=[];}
}
