import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
const dir='test-results/migration';await mkdir(dir,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--enable-unsafe-webgpu','--ignore-gpu-blocklist']});
try {
 const page=await browser.newPage({viewport:{width:1280,height:720}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!m.text().includes('404'))errors.push(m.text());});
 await page.goto('http://localhost:5190/?perf');await page.locator('#creator-done').waitFor({state:'visible',timeout:120000});await page.locator('#cr-name').fill('Validacion');await page.locator('#creator-done').click();
 await page.waitForFunction(()=>__bazukoPerf.game._running,{},{timeout:180000});
 await page.locator('#game-canvas').click({position:{x:640,y:360},force:true});
 const firstClick=await page.evaluate(()=>__bazukoPerf.idle(1));
 const report=await page.evaluate(async()=>{
  const p=__bazukoPerf,g=p.game;p.lockQuality();const variants=g.traffic.vehicles.reduce((r,v)=>(r[v.car.variant]=(r[v.car.variant]??0)+1,r),{});
  const day=p.timeProfile('midday');await p.idle(1);const daylightOff=g.localLights.pool.every(l=>l.intensity===0)&&g.localLights.spotPool.every(l=>l.intensity===0);
  const quality=[];for(const q of ['media','baja','alta'])quality.push(await p.quality(q,1));
  const textureMap=new Map();p.scene.traverse(o=>{for(const m of [o.material].flat().filter(Boolean))for(const v of Object.values(m))if(v?.isTexture){const i=v.image??v.source?.data;textureMap.set(v.uuid,{name:v.userData.assetUrl??v.name??'',width:i?.width??0,height:i?.height??0,estimateBytes:(i?.width??0)*(i?.height??0)*4*4/3});}});
  return {variants,daylightOff,quality,gpuMemory:g.renderer.instance.info.memory,textures:[...textureMap.values()].sort((a,b)=>b.estimateBytes-a.estimateBytes).slice(0,20),signals:g.world.active.signals.nodes.reduce((r,n)=>(r[n.control]=(r[n.control]??0)+1,r),{}),breakdown:p.breakdown()};
 });
 for(const profile of ['midday','night'])for(const mode of ['third','isometric']){
  await page.evaluate(async({profile,mode})=>{const p=__bazukoPerf,g=p.game;p.timeProfile(profile);g._setCameraView(mode==='third'?'third-person':'isometric');await p.idle(1);},{profile,mode});
  await page.screenshot({path:`${dir}/${profile}-${mode}.jpg`,type:'jpeg',quality:80});
 }
 report.firstClick=firstClick;report.errors=errors;await writeFile(`${dir}/validation.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 if(!report.daylightOff||errors.length)process.exitCode=1;
}finally{await browser.close();}
