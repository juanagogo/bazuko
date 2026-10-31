// Local, reproducible QA entry point. Does not read or write the saved game.
import {Game} from '/src/core/game.js';
import {LoadingScreen} from '/src/ui/LoadingScreen.js';
import {DEFAULT_LOOK} from '/src/character/look.js';
let seed=12345;Math.random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
const loading=new LoadingScreen(),panel=document.createElement('aside');
panel.style.cssText='position:fixed;top:4px;left:26%;z-index:10000;background:#10202fee;color:white;padding:8px;font:12px monospace;max-width:650px;max-height:40vh;overflow:auto';
const status=document.createElement('pre');status.id='validation-result';panel.append(status);document.body.append(panel);
function button(label,action){const b=document.createElement('button');b.textContent=label;b.onclick=action;panel.append(b);return b;}
try{
 const game=new Game(document.getElementById('game-canvas'));game.save.load=()=>null;game.save.save=()=>{};
 await game._applyLook({...DEFAULT_LOOK,nombre:'Prueba'});
 game.renderer.setQuality('alta',false);game.renderer.resolution.setLimit(1);game.renderer.instance.setPixelRatio(1);game.renderer.resolution.sample=()=>false;
 await game.start(loading);game.profiler.enabled=true;
 const results=[],load=game.renderer.startupStats;
 const report=()=>status.textContent=JSON.stringify({seed:12345,load,results},null,1);
 report();
 button('Medir giro 360',()=>{
  if(game.paused||game.driving.car)return;
  game.performanceHUD.metrics.reset();game.profiler.reset();game.renderer.diagnostics.maxRenderMs=0;
  const start=performance.now(),yaw=game.cameraRig.yaw,programs=game.renderer.diagnostics.programs,pipelines=game.renderer.diagnostics.pipelines;
  function rotate(now){const t=Math.min(1,(now-start)/6000);game.cameraRig.yaw=yaw+t*Math.PI*2;
   if(t<1){status.textContent='Midiendo giro '+Math.round(t*100)+'%';requestAnimationFrame(rotate);}
   else{results.push({type:'giro',hidden:document.hidden,visibility:document.visibilityState,maxFrameMs:game.performanceHUD.metrics.maxFrameMs,...game.performanceHUD.metrics.recentStats(),newPrograms:game.renderer.diagnostics.programs-programs,newPipelines:game.renderer.diagnostics.pipelines-pipelines,maxRenderCPU:game.renderer.diagnostics.maxRenderMs,...game.getPerformanceReport().graphics});report();}
  }requestAnimationFrame(rotate);
 });
 button('Cambiar cámara',()=>game._toggleCamera());
 button('Ir a estacionado',()=>{
  if(game.driving.car)return;
  const car=game.cars.find(c=>c.controller==='parked');if(!car)return;
  const angle=car.group.rotation.y;game.player.position.copy(car.position);game.player.position.x+=Math.sin(angle)*(car.width/2+.8);game.player.position.z+=Math.cos(angle)*(car.width/2+.8);game.player.root.position.copy(game.player.position);game.cameraRig._snap=true;
 });
 button('F entrar/salir',()=>{game.input.pressedThisFrame.add('KeyF');requestAnimationFrame(()=>{status.textContent=game.driving.car?'Conduciendo: usa W/S, A/D, B y F':'A pie';});});
 button('Pausa',()=>{game.menu.isOpen?game.menu.close():document.getElementById('pause-toggle').click();});
}catch(error){loading.error(error);status.textContent=error.stack;}
