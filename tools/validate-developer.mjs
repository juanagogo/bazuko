import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
await mkdir('test-results/developer',{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--enable-unsafe-webgpu','--ignore-gpu-blocklist']});
try{
const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto('http://localhost:5190/?perf');await page.locator('#creator-done').waitFor({state:'visible',timeout:120000});await page.locator('#cr-name').fill('Dev');await page.locator('#creator-done').click();await page.waitForFunction(()=>globalThis.__bazukoPerf?.game._running,null,{timeout:180000});
await page.keyboard.press('F2');await page.locator('#developer-panel').waitFor({state:'visible'});
assert.equal(await page.evaluate(()=>__bazukoPerf.game.paused),false);
const result=await page.evaluate(async()=>{const g=__bazukoPerf.game,d=g.debugSystems,old=g.cars[0],npc=g.world.active.npcs.find(n=>!n.isVendor),before=g.world.active.t;await new Promise(r=>setTimeout(r,600));const advances=g.world.active.t>before;
for(const key of ['cars','transit','pedestrians','pigeons','dog','vegetation','rain','lights','shadows'])await d.setEnabled(key,false);
return {advances,locked:g.input.locked,counts:d.counts(),carsSame:g.cars[0]===old,npcDisabled:npc.debugDisabled,lights:g.localLights.enabled,shadows:g.sceneMgr.atmosphere.debugShadowsEnabled};});
assert.ok(result.advances&&result.locked&&result.carsSame&&result.npcDisabled);assert.equal(result.lights,false);assert.equal(result.shadows,false);for(const c of Object.values(result.counts))assert.equal(c.active,0);
await page.screenshot({path:'test-results/developer/panel.png'});
await page.locator('[data-system="effects"]').click();await page.waitForFunction(()=>!__bazukoPerf.game.debugSystems.pending.size,null,{timeout:180000});assert.equal(await page.evaluate(()=>__bazukoPerf.game.renderer.effectsEnabled),false);
await page.getByRole('button',{name:'Activar todo',exact:true}).click();await page.waitForFunction(()=>Object.values(__bazukoPerf.game.debugSystems.state).every(Boolean)&&!__bazukoPerf.game.debugSystems.pending.size,null,{timeout:180000});
await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>__bazukoPerf.game.devPanel.opened),false);assert.equal(await page.evaluate(()=>__bazukoPerf.game.paused),false);assert.equal(await page.evaluate(()=>__bazukoPerf.game.input.locked),undefined);
await page.keyboard.press('F2');await page.getByRole('button',{name:'Plegar panel'}).click();assert.equal(await page.locator('.dev-content').isHidden(),true);await page.keyboard.press('F2');
for(const profile of ['midday','night'])for(const mode of ['third-person','isometric'])await page.evaluate(({profile,mode})=>{__bazukoPerf.timeProfile(profile);__bazukoPerf.game._setCameraView(mode);},{profile,mode});
result.errors=errors;assert.deepEqual(errors,[]);await writeFile('test-results/developer/report.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser.close();}


