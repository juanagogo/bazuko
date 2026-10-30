import {el} from './dom.js';
import {DEBUG_SYSTEMS} from '../core/DebugSystems.js';
import {NEEDS} from '../systems/StatsSystem.js';

// Perfiles de luz de Slop para revisar la ciudad sin cambiar el reloj guardado.
const TIME_PROFILES=[['golden','🌇 Golden hour'],['midday','☀️ Mediodía'],['blue-hour','🌆 Blue hour'],['night','🌙 Noche'],[null,'🕒 Reloj']];

export class DeveloperPanel {
 constructor(game){
  this.game=game;this.opened=false;this.controls=new Map();
  this.button=el('button',{id:'dev-button',type:'button',text:'DEV','aria-controls':'developer-panel','aria-expanded':'false',onclick:()=>this.toggle()});
  this.status=el('p',{class:'dev-status',role:'status'});this.metrics=el('pre',{class:'dev-metrics','aria-live':'off'});
  this.content=el('div',{class:'dev-content'});
  for(const [key,label] of Object.entries(DEBUG_SYSTEMS)){
   const input=el('input',{type:'checkbox',checked:true,'data-system':key});
   input.addEventListener('change',async()=>{try{await game.debugSystems.setEnabled(key,input.checked);this.status.textContent='';}catch(error){this.status.textContent=error.message;}finally{this.refresh();}});
   this.controls.set(key,input);this.content.append(el('label',{class:'dev-toggle'},input,el('span',{text:label})));
  }
  this.timeButtons=TIME_PROFILES.map(([id,label])=>{const button=el('button',{type:'button',text:label,'data-profile':id??'clock',onclick:()=>{game.sceneMgr?.setTimeProfile?.(id);this.refresh();}});return button;});
  if(game.sceneMgr?.setTimeProfile)this.content.append(el('p',{class:'dev-section',text:'Hora del día'}),el('div',{class:'dev-actions dev-time'},...this.timeButtons));
  this.rainButton=el('button',{type:'button',text:'🌧️ Lluvia','aria-pressed':'false',onclick:()=>{const w=game.weather;if(!w?.forceRain)return;w.forceRain(!w.isRaining);this.refresh();}});
  this.needsButton=el('button',{type:'button',text:'🍞 Reiniciar necesidades',onclick:()=>{for(const need of NEEDS)game.stats[need]=100;this.status.textContent='Hambre, sed y demás necesidades al 100 %.';}});
  this.content.append(el('p',{class:'dev-section',text:'Atajos'}),el('div',{class:'dev-actions'},this.rainButton,this.needsButton));
  this.command=el('input',{type:'text',class:'dev-command',placeholder:'/carro taxi · /carro lista','aria-label':'Comando de desarrollo',autocomplete:'off',spellcheck:'false',list:'dev-car-names'});
  this.carNames=el('datalist',{id:'dev-car-names'},...(game.carSpawnNames?.()??[]).map(name=>el('option',{value:'/carro '+name})));
  this.command.addEventListener('keydown',e=>{if(e.code!=='Enter'&&e.code!=='NumpadEnter')return;e.preventDefault();this.runCommand(this.command.value);});
  this.content.append(el('p',{class:'dev-section',text:'Comando · carros'}),el('div',{class:'dev-actions'},this.command,this.carNames,el('button',{type:'button',text:'Crear',onclick:()=>this.runCommand(this.command.value)})));
  this.lock=el('input',{type:'checkbox',checked:true});this.lock.addEventListener('change',()=>{game.renderer.adaptiveLocked=this.lock.checked?true:this.previousAdaptive;});
  this.resetButton=el('button',{type:'button',text:'Activar todo',onclick:async()=>{try{await game.debugSystems.reset();this.status.textContent='';}catch(error){this.status.textContent=error.message;}}});
  this.content.append(el('label',{class:'dev-toggle'},this.lock,el('span',{text:'Bloquear adaptación automática'})),this.metrics,
   el('div',{class:'dev-actions'},el('button',{type:'button',text:'Reiniciar medición',onclick:()=>game.performanceHUD.metrics.reset()}),this.resetButton),el('p',{class:'dev-hint',text:'Sin guardar cambios. La hora de prueba no cambia el reloj de la partida; «Reloj» vuelve a la hora real. El clima sigue controlando la lluvia.'}),this.status);
  this.fold=el('button',{type:'button',text:'−','aria-label':'Plegar panel','aria-expanded':'true',onclick:()=>{this.content.hidden=!this.content.hidden;this.fold.textContent=this.content.hidden?'+':'−';this.fold.setAttribute('aria-expanded',String(!this.content.hidden));}});
  this.panel=el('aside',{id:'developer-panel',hidden:true,'aria-label':'Herramientas de desarrollo'},el('header',{},el('strong',{text:'Desarrollo · sesión'}),this.fold,el('button',{type:'button',text:'×','aria-label':'Cerrar desarrollo',onclick:()=>this.close()})),this.content);
  document.body.append(this.button,this.panel);
  this.key=e=>{
   if(e.code==='F2'){e.preventDefault();e.stopImmediatePropagation();if(!e.repeat)this.toggle();}
   else if(this.opened&&e.code==='Escape'){e.preventDefault();e.stopImmediatePropagation();this.close();}
   else if(this.opened&&e.target!==this.command)e.stopImmediatePropagation();
  };
  window.addEventListener('keydown',this.key,true);
  this.unsubscribe=game.debugSystems.subscribe(()=>this.refresh());this.timer=setInterval(()=>this.tick(),250);this.tick();
 }
 runCommand(text){const g=this.game;if(!g.spawnCarAhead)return;try{this.status.textContent=g.spawnCarAhead(text);}catch(error){this.status.textContent=error.message;}}
 toggle(){this.opened?this.close():this.open();}
 open(){const g=this.game;if(this.opened||!g._running||g.paused||g.isSleeping||g._deathPending||g.qualityChanging)return;
  this.opened=true;this.previousAdaptive=g.renderer.adaptiveLocked;this.previousInputLock=g.input.locked;
  g.renderer.adaptiveLocked=true;this.lock.checked=true;g.input.keys={};g.input.endFrame();g.input.locked=true;g.cameraRig.releaseControls();
  if(document.pointerLockElement)document.exitPointerLock?.();this.panel.hidden=false;this.button.setAttribute('aria-expanded','true');this.refresh();this.fold.focus();
 }
 close(){if(!this.opened)return;const g=this.game;this.opened=false;this.panel.hidden=true;g.renderer.adaptiveLocked=this.previousAdaptive;g.input.locked=this.previousInputLock;g.input.keys={};g.input.endFrame();this.button.setAttribute('aria-expanded','false');this.button.focus();}
 refresh(){for(const [key,input] of this.controls){input.checked=this.game.debugSystems.isEnabled(key);input.disabled=this.game.debugSystems.pending.has(key);}
  if(this.game.debugSystems.pending.size)this.status.textContent='Preparando cambio gráfico…';
  else if(this.status.textContent==='Preparando cambio gráfico…')this.status.textContent='';
  this.resetButton.disabled=this.game.debugSystems.pending.size>0;
  this.rainButton?.setAttribute('aria-pressed',String(!!this.game.weather?.isRaining));
  const override=this.game.sceneMgr?._timeProfileOverride??null;
  for(const button of this.timeButtons??[]){const id=button.getAttribute('data-profile'),active=(id==='clock'?null:id)===override;button.setAttribute('aria-pressed',String(active));}
 }
 tick(){const g=this.game;this.button.disabled=!g._running||g._loading;if(this.opened&&(g.paused||g.isSleeping||g._deathPending))this.close();if(!this.opened)return;
  const m=g.performanceHUD.metrics,info=g.renderer.instance.info.render,counts=g.debugSystems.counts();
  this.metrics.textContent=`FPS ${m.current.toFixed(1)} · p95 ${m.recentStats().p95.toFixed(1)} ms\nDibujos ${info.drawCalls??info.calls} · triángulos ${info.triangles}\nCalidad ${g.renderer.effectiveQuality} · resolución ${g.renderer.instance.getPixelRatio().toFixed(2)}×\n`+Object.entries(counts).map(([key,n])=>`${DEBUG_SYSTEMS[key]}: ${n.active}/${n.total}`).join('\n');
 }
 dispose(){this.close();clearInterval(this.timer);this.unsubscribe?.();window.removeEventListener('keydown',this.key,true);this.button.remove();this.panel.remove();}
}
