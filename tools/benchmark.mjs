// Production-only, deterministic benchmark. Reports are local artifacts, never save-game data.
import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
const url=process.env.BENCH_URL??'http://localhost:5190';
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--enable-unsafe-webgpu','--ignore-gpu-blocklist']});
const results=[];
try {
 for(let group=0;group<Number(process.env.BENCH_GROUPS??3);group++){
  const context=await browser.newContext({viewport:{width:1280,height:720},deviceScaleFactor:1});
  await context.addInitScript(()=>{let seed=44117;Math.random=()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/4294967296);localStorage.setItem('bazuko.webgpu.graphics_quality','alta');});
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error(e.message);});page.on('console',m=>{if(m.type()==='error'){errors.push(m.text());console.error(m.text().slice(0,1000));}});
  for(const cache of ['cold','warm']){
   await page.goto(url+'/?perf',{waitUntil:'commit'});
   await page.waitForFunction(()=>globalThis.__bazukoPerf?.game?._running||document.querySelector('#creator-done')?.offsetParent||document.querySelector('.loading-error'),{},{timeout:180000});
   if(await page.locator('#creator-done').isVisible()){await page.locator('#cr-name').fill('Medicion');await page.locator('#creator-done').click();}
   await page.waitForFunction(()=>globalThis.__bazukoPerf?.game?._running,{},{timeout:180000});
   const result=await page.evaluate(async()=>{const p=__bazukoPerf;p.lockQuality();return {startup:p.game.renderer.startupStats,report:p.report(),idle:await p.idle(3),turn:await p.turn(4),camera:await p.toggleCamera(2),resources:performance.getEntriesByType('resource').reduce((r,e)=>({transfer:r.transfer+e.transferSize,decoded:r.decoded+e.decodedBodySize}),{transfer:0,decoded:0})};});
   results.push({group,cache,...result,errors:[...errors]});
   await writeFile(process.env.BENCH_REPORT??'benchmark-report.json',JSON.stringify(results,null,2));
   console.log(group,cache,result.startup?.totalMs,result.turn);
  }
  await context.close();
 }
} finally {await browser.close();}
