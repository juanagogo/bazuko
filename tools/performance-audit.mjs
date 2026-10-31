/** Production audit; cold = fresh HTTP cache, not cleared GPU driver cache.
 * AUDIT_ROOT can point to an archived baseline checkout with an existing dist/.
 */
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const url = process.env.AUDIT_URL ?? 'http://127.0.0.1:5190';
const label = process.env.AUDIT_LABEL ?? 'current';
const runs = Number(process.env.AUDIT_RUNS ?? 1);
const dir = `test-results/performance-${label}`;
const profileStartup = process.env.AUDIT_PROFILE_STARTUP === '1';
await mkdir(dir, { recursive: true });
let preview, browser;
const results = [];

async function startProfile(context, page) {
  const session = await context.newCDPSession(page);
  await session.send('Profiler.enable');
  await session.send('Profiler.start');
  return session;
}
async function stopProfile(session, path) {
  if (!session) return;
  const { profile } = await session.send('Profiler.stop');
  await writeFile(path, JSON.stringify(profile));
  await session.detach();
}

try {
  try { await fetch(url); }
  catch {
    const args = ['node_modules/vite/bin/vite.js', 'preview'];
    if (process.env.AUDIT_ROOT) args.push(process.env.AUDIT_ROOT);
    args.push('--host', '127.0.0.1', '--port', '5190', '--strictPort');
    preview = spawn(process.execPath, args, { stdio: 'ignore', windowsHide: true });
    let ready = false;
    for (let n = 0; n < 100; n++) {
      try { await fetch(url); ready = true; break; }
      catch { await new Promise(resolve => setTimeout(resolve, 100)); }
    }
    if (!ready) throw new Error('No responde el servidor de producción');
  }
  browser = await chromium.launch({
    channel: 'msedge', headless: true,
    args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'],
  });
  for (let run = 0; run < runs; run++) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    await context.addInitScript(() => {
      let seed = 44117;
      Math.random = () => ((seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 4294967296);
      localStorage.clear();
      localStorage.setItem('bazuko.webgpu.graphics_quality', 'alta');
      // Includes frames immediately after controls are released, before CDP round trips.
      window.__auditFirstFrames = [];
      let started, previous;
      const sample = now => {
        if (window.__bazukoPerf?.game._running) {
          started ??= now;
          if (previous !== undefined) window.__auditFirstFrames.push(now - previous);
          previous = now;
          if (now - started > 6000) return;
        }
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    const page = await context.newPage();
    let errors = [], stages = [];
    page.on('pageerror', error => errors.push({ type: 'page', text: error.message }));
    page.on('console', message => {
      if (message.type() === 'error') errors.push({ type: 'console', text: message.text(), url: message.location().url });
      if (message.text().startsWith('[WebGPU]')) stages.push({ t: Date.now(), message: message.text() });
    });
    for (const cache of ['cold', 'warm']) {
      errors = []; stages = [];
      await page.goto(`${url}/?perf`, { waitUntil: 'commit' });
      await page.locator('#creator-done').waitFor({ state: 'visible', timeout: 120000 });
      await page.locator('#cr-name').fill('Auditoria');
      const turnSession = profileStartup ? await startProfile(context, page) : null;
      const started = Date.now();
      await page.locator('#creator-done').click();
      await page.waitForFunction(() => globalThis.__bazukoPerf?.game._running, null, { timeout: 180000 });
      const loadingMs = Date.now() - started;
      const startup = await page.evaluate(() => {
        const p = __bazukoPerf, g = p.game;
        p.lockQuality(); g.profiler.enabled = true; g.profiler.reset(); g._setCameraView('third-person');
        return g.renderer.startupStats;
      });
      const firstTurn = await page.evaluate(async () => ({
        ...await __bazukoPerf.turn(4), cpu: __bazukoPerf.game.profiler.report(),
      }));
      await stopProfile(turnSession, `${dir}/${run}-${cache}-startup-turn.cpuprofile`);
      const profiles = [];
      for (const profile of ['midday', 'golden', 'night']) {
        profiles.push(await page.evaluate(async profile => {
          const p = __bazukoPerf, g = p.game;
          p.timeProfile(profile); await p.idle(.5); g.profiler.reset();
          const on = await p.idle(3), gpu = await p.gpu(1), cpu = g.profiler.report(), breakdown = p.breakdown(8);
          await g.debugSystems.setEnabled('shadows', false); await p.idle(.3);
          const off = await p.idle(3), offGpu = await p.gpu(1);
          await g.debugSystems.setEnabled('shadows', true);
          return { profile, on, gpu, cpu, breakdown, off, offGpu };
        }, profile));
      }
      const driveSession = await startProfile(context, page);
      const travel = await page.evaluate(async () => {
        const p = __bazukoPerf, g = p.game;
        p.timeProfile('golden'); g.profiler.reset();
        const car = g.cars[0];
        g.player.position.copy(car.position); g.player.isStunned = false;
        const entered = g.driving.enter(car);
        if (!entered) throw new Error('No entra al carro');
        car.position.set(92, 0, 20); car.group.rotation.y = -Math.PI / 2;
        g.cameraRig.driving = true; g.cameraRig.yaw = Math.PI; g.input.keys.KeyW = true;
        const start = car.position.toArray(), first = await p.idle(16);
        g.input.keys.KeyW = false;
        const end = car.position.toArray(), cpu = g.profiler.report();
        g.driving.cancel();
        return { entered, start, end, first, cpu, completed: end[2] >= 135 && Math.abs(end[0] - 92) < 2 };
      });
      await stopProfile(driveSession, `${dir}/${run}-${cache}.cpuprofile`);
      const initialFrames = await page.evaluate(() => window.__auditFirstFrames);
      const result = { run, cache, loadingMs, startup, stages, firstTurn, initialFrames, profiles, travel,
        errors: [...errors], report: await page.evaluate(() => __bazukoPerf.report()) };
      results.push(result);
      await writeFile(`${dir}/results.json`, JSON.stringify(results, null, 2));
      console.log(JSON.stringify({ run, cache, loadingMs, turnMax: firstTurn.max,
        initialMax: Math.max(...initialFrames), driveMax: travel.first.max, driveMean: travel.first.meanMs }));
      if (process.env.AUDIT_SCREENSHOTS === '1' && run === 0 && cache === 'warm') {
        for (const view of ['third-person', 'isometric']) for (const time of ['golden', 'night']) {
          await page.evaluate(async ({ view, time }) => {
            const p = __bazukoPerf; p.game._setCameraView(view); p.timeProfile(time); await p.idle(1);
          }, { view, time });
          await page.screenshot({ path: `${dir}/${view}-${time}.png` });
        }
      }
    }
    await context.close();
  }
} finally {
  await browser?.close();
  preview?.kill();
}
