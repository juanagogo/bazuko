// tools/peatones/tiras.mjs
// Tiras de fotogramas de los peatones en el juego de verdad (herramienta de pruebas, no del juego): abre el juego con
// la GPU (Metal en Mac), arma cada escena con la gente y los carros que ya andan por Bogotá y guarda, cada tanto de
// tiempo de juego, el cuadro que se acaba de dibujar, recortado alrededor de lo que pasa, en una hoja de contactos.
// Debajo de cada cuadro va lo que piensan los que salen (nivel de alerta, reacción, si espera o huye).
//
//   BROWSER=none npx vite --host 127.0.0.1 --port <puerto> --strictPort &      # el servidor del árbol
//   node tools/peatones/tiras.mjs --url http://127.0.0.1:<puerto>/ --salida <carpeta> [--casos esquiva,cruce,escalada,corrillo]
//   (o TIRAS_URL=http://127.0.0.1:<puerto>/ en vez de --url)
//
// - esquiva: dos caminantes de frente por un andén recto, vistos de tres cuartos.
// - cruce: un caminante en el borde de un paso de cebra sin semáforo mientras se acerca un carro de verdad.
// - escalada: un testigo a 12 m del jugador; un grito, después un robo a la vista y después un golpe a 5 m: de
//   atento a recelo, a miedo y a huir.
// - corrillo: una pelea del jugador de 10 s en un sitio abierto con seis curiosos a 10 m, tres de cada lado, hasta
//   que se dispersan.
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const { chromium } = createRequire(path.join(process.cwd(), 'package.json'))('@playwright/test');

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const url = (opt('url', null) ?? process.env.TIRAS_URL ?? '').replace(/\/?$/, '/');
if (url === '/') { console.error('Falta --url (o TIRAS_URL): la dirección del Vite del árbol, p. ej. http://127.0.0.1:<puerto>/'); process.exit(2); }
const salida = path.resolve(opt('salida', 'work/peatones-tiras'));
const casos = opt('casos', 'esquiva,cruce,escalada,corrillo').split(',');
const log = (...a) => console.log(`[tiras ${new Date().toTimeString().slice(0, 8)}]`, ...a);

/** Lo que corre dentro de la página: la captura de cuadros y la preparación de cada escena. */
function pageHelpers() {
  const game = window.__game;
  const T = window.__tiras = {
    job: null,
    install() {
      const renderer = game.renderer;
      if (renderer.__tiras) return;
      const canvas = renderer.instance?.domElement ?? renderer.domElement ?? [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0];
      const render = renderer.render.bind(renderer);
      renderer.render = (...a) => { render(...a); if (T.job) T.job.onRender(canvas); };
      renderer.__tiras = true;
    },
    city: () => game.world.active,
    walkers() {
      return T.city().npcs.filter(n => n.mind && !n.fijo && !n.isVendor && n.character && !n.koState && !(n.fleeTimer > 0));
    },
    putPlayer(x, z) {
      const player = game.player, y = T.city().getMovementGroundHeight(x, z, 0);
      player.position.set(x, y, z); player.root.position.copy(player.position);
      player.velocity.set(0, 0, 0); player.resetGrounding(); player.action = null;
    },
    camera(yaw, pitch, distance) { const rig = game.cameraRig; rig.yaw = yaw; rig.pitch = pitch; rig.distance = distance; },
    /** Cuánto brazo de cámara queda libre con ese giro (la misma cuenta que CameraRig: lo sólido lo acorta). */
    freeArm(yaw, pitch, distance) {
      const rig = game.cameraRig, look = game.player.position.clone().add(rig.lookOffset);
      const dir = look.clone().set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
      const ray = new rig._ray.constructor(look, dir), box = new rig._box.constructor(), hit = look.clone();
      const ex = look.x + dir.x * distance, ez = look.z + dir.z * distance;
      const near = game.collisions?.queryStatic?.(Math.min(look.x, ex) - .2, Math.min(look.z, ez) - .2, Math.max(look.x, ex) + .2, Math.max(look.z, ez) + .2) ?? [];
      let free = distance;
      for (const { box: b } of near) {
        box.copy(b).expandByScalar(.2);
        if (box.containsPoint(look)) return 0;
        if (ray.intersectBox(box, hit)) free = Math.min(free, look.distanceTo(hit) - .05);
      }
      return Math.max(0, free);
    },
    /** El giro más cercano a `prefer` con el brazo libre entero (o el más libre que haya). */
    clearYaw(prefer, pitch, distance) {
      let best = prefer, bestScore = -Infinity;
      for (let k = 0; k < 24; k++) {
        const yaw = prefer + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * Math.PI / 12;
        const score = Math.min(distance, T.freeArm(yaw, pitch, distance)) * 10 - Math.ceil(k / 2) * .01;
        if (score > bestScore) { bestScore = score; best = yaw; }
      }
      T.camera(best, pitch, distance);
      return { yaw: best, free: T.freeArm(best, pitch, distance) };
    },
    /** El THREE que ya cargó el juego (la dependencia que optimizó Vite), para lanzar rayos. */
    async three() {
      if (!T._three) {
        const url = performance.getEntriesByType('resource').map(e => e.name).find(n => /\/\.vite\/deps\/three\.js/.test(n));
        T._three = await import(/* @vite-ignore */ url ?? '/node_modules/three/build/three.module.js');
      }
      return T._three;
    },
    /** ¿Se ve `to` desde `from`? Nada dibujado en medio (la gente y la lluvia no cuentan). Antes, `await T.three()`. */
    sees(from, to) {
      const people = new Set([game.player.root, ...T.city().npcs.map(n => n.root)]);
      const dir = to.clone().sub(from), far = dir.length();
      const ray = new T._three.Raycaster(from, dir.normalize(), .1, Math.max(.2, far - .8));
      for (const hit of ray.intersectObject(game.sceneMgr.scene, true)) {
        if (hit.object.isPoints || hit.object.isLine || hit.object.isSprite) continue;
        let skip = false;
        for (let o = hit.object; o && !skip; o = o.parent) skip = !o.visible || people.has(o);
        if (!skip) return false;
      }
      return true;
    },
    /** Dónde queda la cámara con ese giro (con el brazo que deja lo sólido). */
    cameraAt(yaw, pitch, distance) {
      const look = game.player.position.clone().add(game.cameraRig.lookOffset), arm = T.freeArm(yaw, pitch, distance);
      return { arm, at: look.clone().add(look.clone().set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(arm)) };
    },
    /** Que la cámara mire hacia (x, z) desde detrás del jugador. */
    lookFromPlayer(x, z, pitch, distance) {
      const p = game.player.position;
      T.camera(Math.atan2(p.x - x, p.z - z), pitch, distance);
    },
    route(npc, points) {
      npc.route = points; npc.routeIndex = 0; npc.target = points[0]; npc.wait = 0;
      npc.stance = null; npc.action = null; npc.fleeTimer = 0; if (npc.person) npc.person.pausa = 0;
    },
    place(npc, x, z, yaw = null) {
      npc.position.set(x, T.city().getMovementGroundHeight(x, z, 0), z); npc.root.position.copy(npc.position);
      if (yaw !== null) npc.root.rotation.y = yaw;
    },
    /**
     * Captura cada `every` s de juego durante `seconds` (o hasta que `done()`), centrada en `focus()` (un punto del
     * mundo), con un recorte de `crop` del alto de la pantalla. `label()` escribe debajo de cada cuadro. Si hay
     * `begin()`, empieza (y cuenta el tiempo) desde que da true.
     */
    capture({ title, every, seconds, focus, label, crop = .5, columns = 6, done = () => false, onTick = () => {}, begin = null }) {
      return new Promise(resolve => {
        const city = T.city(), camera = game.cameraRig.camera, V = game.player.position.constructor, v = new V();
        const tiles = [], tileW = 320, tileH = 200, lines = 3, lineH = 13;
        let t0 = city.minds.time, next = t0, finished = false, started = !begin;
        const limit = city.minds.time + 60;
        T.job = {
          onRender(canvas) {
            if (finished) return;
            if (!started) {
              if (!begin() && city.minds.time < limit) return;
              started = true; t0 = next = city.minds.time;
            }
            const t = city.minds.time - t0;
            onTick(t);
            if (t > seconds || done(t)) { finished = true; T.job = null; resolve(sheet()); return; }
            if (city.minds.time + 1e-6 < next) return;
            next += every;
            const f = focus(t);
            v.set(f.x, f.y ?? game.player.position.y + .9, f.z).project(camera);
            const ch = canvas.height * crop, cw = ch * tileW / tileH;
            const cx = (v.x + 1) / 2 * canvas.width, cy = (1 - v.y) / 2 * canvas.height;
            const sx = Math.max(0, Math.min(canvas.width - cw, cx - cw / 2)), sy = Math.max(0, Math.min(canvas.height - ch, cy - ch / 2));
            const tile = document.createElement('canvas');
            tile.width = tileW; tile.height = tileH;
            tile.getContext('2d').drawImage(canvas, sx, sy, cw, ch, 0, 0, tileW, tileH);
            tiles.push({ tile, text: [`t ${t.toFixed(1)} s`, ...label(t)].slice(0, lines + 1) });
          }
        };
        function sheet() {
          const rows = Math.ceil(tiles.length / columns), cellH = tileH + (lines + 1) * lineH + 6;
          const out = document.createElement('canvas');
          out.width = columns * tileW; out.height = 26 + rows * cellH;
          const ctx = out.getContext('2d');
          ctx.fillStyle = '#1d1f22'; ctx.fillRect(0, 0, out.width, out.height);
          ctx.fillStyle = '#e8e2d4'; ctx.font = '15px monospace'; ctx.fillText(title, 6, 18);
          tiles.forEach(({ tile, text }, k) => {
            const dx = (k % columns) * tileW, dy = 26 + Math.floor(k / columns) * cellH;
            ctx.drawImage(tile, dx, dy);
            ctx.strokeStyle = '#000'; ctx.strokeRect(dx + .5, dy + .5, tileW - 1, tileH - 1);
            ctx.fillStyle = '#e8e2d4'; ctx.font = '11px monospace';
            text.forEach((line, i) => ctx.fillText(line, dx + 4, dy + tileH + 12 + i * lineH));
          });
          return { frames: tiles.length, png: out.toDataURL('image/png'), texts: tiles.map(t => t.text) };
        }
      });
    }
  };
  T.install();
}

const LEVELS = ['calma', 'curiosidad', 'recelo', 'miedo']; // los de entities/npc/perception.js
const REACTIONS = ['-', 'retrocede', 'planta cara', 'mira quieto'];

const CASES = {
  async esquiva(page) {
    const ready = await page.evaluate(() => {
      const T = window.__tiras, game = window.__game, city = T.city(), nav = city.pedestrianNavigation, S = nav.tileSize;
      const ok = (x, z) => { const id = nav.grid[z]?.[x] ?? -1; return id >= 0 && !nav.nodes[id].crossing; };
      const px = Math.round(game.player.position.x / S), pz = Math.round(game.player.position.z / S);
      let lane = null;
      for (let r = 0; r < 40 && !lane; r++) for (let z = pz - r; z <= pz + r && !lane; z++) for (let x = px - r; x <= px + r && !lane; x++) {
        let run = true;
        for (let k = 0; k < 14 && run; k++) for (let w = -1; w <= 1 && run; w++) run = ok(x + k, z + w);
        if (run) lane = { x0: x * S, x1: (x + 13) * S, z: z * S };
      }
      if (!lane) return false;
      const { x0, x1, z } = lane, V = game.player.position.constructor;
      T.putPlayer((x0 + x1) / 2, z + 6);
      game.player.root.visible = false;
      T.camera(.7, .5, 6.5); // de tres cuartos: se ve cuánto se corre cada uno
      const [a, b] = T.walkers().slice(0, 2);
      const line = (from, to) => { const out = [], dir = Math.sign(to - from); for (let x = from + 2 * dir; dir > 0 ? x <= to : x >= to; x += 2 * dir) out.push(new V(x, city.getMovementGroundHeight(x, z, 0), z)); return out; };
      T.place(a, x0, z, Math.PI / 2); T.place(b, x1, z, -Math.PI / 2);
      T.route(a, line(x0, x1)); T.route(b, line(x1, x0));
      a.mind.side = 0; a.mind.pace = 1; b.mind.side = 0; b.mind.pace = 1;
      window.__pair = { a, b };
      return true;
    });
    if (!ready) return null;
    return page.evaluate(() => {
      const T = window.__tiras, { a, b } = window.__pair;
      return T.capture({
        title: 'esquiva: dos de frente por un andén recto, de tres cuartos (el jugador, oculto); desde 9 m entre los dos', every: .25, seconds: 14, crop: .45,
        begin: () => Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z) < 9,
        focus: () => ({ x: (a.position.x + b.position.x) / 2, z: a.position.z, y: a.position.y + .9 }),
        done: () => a.position.x > b.position.x + 3,
        label: () => [
          `entre ellos ${Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z).toFixed(2)} m`,
          `A lado ${a.mind.side.toFixed(2)} ritmo ${a.mind.pace.toFixed(2)}`,
          `B lado ${b.mind.side.toFixed(2)} ritmo ${b.mind.pace.toFixed(2)}`
        ]
      });
    });
  },

  async cruce(page) {
    for (let attempt = 0; attempt < 40; attempt++) {
      if (attempt) await page.waitForTimeout(500);
      const found = await page.evaluate(async () => {
        const { signalFor } = await import('/src/entities/npc/crossing.js');
        const T = window.__tiras, game = window.__game, city = T.city(), nav = city.pedestrianNavigation;
        const V = game.player.position.constructor, p = new V(), dir = new V(), d0 = new V();
        const nodeId = (x, z) => nav.grid[z]?.[x] ?? -1;
        for (const vehicle of game.traffic.vehicles) {
          if (vehicle.state === 'chase' || vehicle.rejoinTarget || vehicle.police || vehicle.speed < 5) continue;
          vehicle.route.sample(vehicle.distance, p, d0);
          // Que el carro llegue al paso en unos 3 a 6 s: el caminante alcanza a llegar al borde y le toca esperarlo.
          const lo = Math.max(14, vehicle.speed * 3), hi = Math.min(70, vehicle.speed * 6);
          for (let ahead = Math.ceil(lo); ahead <= hi; ahead++) {
            vehicle.route.sample(vehicle.distance + ahead, p, dir);
            if (dir.x * d0.x + dir.z * d0.z < .995) break;
            const id = nav.nodeAt(p.x, p.z), n = nav.nodes[id];
            if (!n?.crossing || n.underDeck) continue;
            const sx = Math.abs(dir.x) > Math.abs(dir.z) ? 0 : 1, sz = 1 - sx;
            const edge = sign => {
              const tiles = [];
              for (let k = 1; k < 14; k++) {
                const other = nodeId(n.x + sign * sx * k, n.z + sign * sz * k);
                if (other < 0) return null;
                if (!nav.nodes[other].crossing) return { curb: other, tiles };
                tiles.push(other);
              }
              return null;
            };
            const a = edge(-1), b = edge(1);
            if (!a || !b) continue;
            const ids = [a.curb, ...a.tiles.reverse(), id, ...b.tiles, b.curb];
            const A = nav._point(a.curb), B = nav._point(b.curb), length = Math.hypot(B.x - A.x, B.z - A.z);
            if (signalFor(city.signals, { ax: A.x, az: A.z, ux: (B.x - A.x) / length, uz: (B.z - A.z) / length, length }).axis >= 0) continue;
            let spot = null;
            for (const s of [4, -4, 5, -5]) {
              const pid = nodeId(nav.nodes[a.curb].x + sz * s, nav.nodes[a.curb].z + sx * s);
              if (pid >= 0 && !nav.nodes[pid].crossing) { spot = nav._point(pid); break; }
            }
            if (!spot) continue;
            T.putPlayer(spot.x, spot.z);
            game.player.root.visible = false;
            const walker = T.walkers()[0];
            const route = ids.map(k => nav._point(k));
            // Un paso antes del borde: llega andando y se le ve frenar.
            const back = nav._point(a.curb), ux = (B.x - A.x) / length, uz = (B.z - A.z) / length;
            T.place(walker, back.x - ux * 1.2, back.z - uz * 1.2, Math.atan2(ux, uz));
            T.route(walker, route);
            walker.mind.crossing.state = 0; walker.mind.crossing.target = null; walker.mind.crossing.waited = 0;
            // La cámara desde el andén del jugador, mirando hacia el borde (y el carro que viene detrás).
            T.lookFromPlayer(A.x, A.z, .32, 7);
            window.__cruce = { walker, vehicle, cross: { x: p.x, z: p.z, hx: dir.x, hz: dir.z }, A, B };
            return true;
          }
        }
        return false;
      });
      if (found) break;
      if (attempt === 39) return null;
    }
    return page.evaluate(() => {
      const T = window.__tiras, { walker, vehicle, cross, B } = window.__cruce, car = vehicle.car;
      const along = () => (car.position.x - cross.x) * cross.hx + (car.position.z - cross.z) * cross.hz;
      const STATE = ['andando', 'espera en el borde', 'cruzando'];
      return T.capture({
        title: 'cruce: un caminante llega al borde de una cebra sin semáforo con un carro de verdad acercándose', every: .4, seconds: 16, crop: .55,
        focus: () => {
          // Con el carro cerca, entre los dos.
          const d = Math.hypot(car.position.x - walker.position.x, car.position.z - walker.position.z);
          return d < 18 ? { x: (car.position.x + walker.position.x) / 2, z: (car.position.z + walker.position.z) / 2 } : { x: walker.position.x, z: walker.position.z };
        },
        done: () => Math.hypot(walker.position.x - B.x, walker.position.z - B.z) < .6,
        label: () => {
          const c = walker.mind.crossing, gaze = walker.mind.aware.gazeYaw ?? 0, sign = Math.sign(along());
          return [`${STATE[c.state] ?? c.state}${c.hurry ? ' (apura)' : ''} esperó ${(c.waited ?? 0).toFixed(1)} s`,
            `carro ${sign < 0 ? `a ${(-along()).toFixed(1)} m` : `pasó hace ${along().toFixed(1)} m`}, ${vehicle.speed.toFixed(1)} m/s`, `cabeza girada ${(gaze * 180 / Math.PI).toFixed(0)}°`];
        }
      });
    });
  },

  async escalada(page) {
    const ready = await page.evaluate(async () => {
      const T = window.__tiras, game = window.__game, city = T.city(), nav = city.pedestrianNavigation, S = nav.tileSize;
      const { TEMPERS } = await import('/src/entities/npc/temperament.js');
      const ok = (x, z) => { const id = nav.grid[z]?.[x] ?? -1; return id >= 0 && !nav.nodes[id].crossing && nav.nodes[id].main; };
      const px = Math.round(game.player.position.x / S), pz = Math.round(game.player.position.z / S);
      // Una franja de andén de 30 m por 10, sin calzada: el testigo tiene por dónde huir. Se prueban las más anchas,
      // hacia los dos lados, hasta que desde detrás del jugador se vea al testigo y el camino por donde huiría.
      await T.three();
      const spots = [];
      for (let z = pz - 40; z <= pz + 40; z += 2) for (let x = px - 40; x <= px + 40; x += 2) for (const side of [1, -1]) {
        if (!ok(x, z) || !ok(x + 7 * side, z)) continue;
        let count = 0;
        for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 14; dx++) if (ok(x + dx * side, z + dz)) count++;
        spots.push({ x: x * S, z: z * S, side, count });
      }
      spots.sort((a, b) => b.count - a.count);
      const V = game.player.position.constructor;
      let best = null;
      for (const spot of spots.slice(0, 30)) {
        T.putPlayer(spot.x, spot.z);
        const yaw = Math.atan2(-spot.side, 0), cam = T.cameraAt(yaw, .28, 6), y = game.player.position.y;
        if (cam.arm < 4.5) continue;
        if ([8, 14, 22].every(d => T.sees(cam.at, new V(spot.x + d * spot.side, y + 1.2, spot.z)))) { best = { ...spot, yaw }; break; }
      }
      if (!best) return false;
      T.putPlayer(best.x, best.z);
      const witness = T.walkers().sort((a, b) => a.position.distanceTo(game.player.position) - b.position.distanceTo(game.player.position))[0];
      T.place(witness, best.x + 14 * best.side, best.z, best.side > 0 ? -Math.PI / 2 : Math.PI / 2);
      witness.target = null; witness.route = []; witness.wait = 1e6; witness.stance = null; witness.action = null;
      witness.mind.temper = { ...witness.mind.temper, ...TEMPERS.curioso, tipo: 'curioso' };
      // Desde detrás del jugador, de cara al testigo: se le ve la cara, el paso atrás y la huida.
      T.camera(best.yaw, .28, 6);
      window.__escalada = { witness, at: { x: best.x, z: best.z }, side: best.side };
      return true;
    });
    if (!ready) return null;
    return page.evaluate(({ LEVELS, REACTIONS }) => {
      const T = window.__tiras, game = window.__game, city = T.city(), { witness, at, side } = window.__escalada;
      const minds = city.minds, agent = minds._playerAgent, steps = new Set();
      const once = (key, t, when, fn) => { if (t >= when && !steps.has(key)) { steps.add(key); fn(); } };
      // El jugador se le acerca andando (3 m/s): de 14 a 8 m entre 5 y 7 s y de 8 a 3 m entre 9 y 10,7 s.
      const walkTo = (t, t0, t1, d0, d1) => { if (t >= t0 && t <= t1) T.putPlayer(witness.position.x - side * (d0 + (d1 - d0) * (t - t0) / (t1 - t0)), at.z); };
      let note = '';
      return T.capture({
        title: 'escalada: un curioso a 14 m; un grito a 7 m de él (1 s), el jugador se acerca a 8 m y roba a la vista (7,5 s), llega a 3 m y pega (11 s)', every: .4, seconds: 22, crop: .5,
        focus: () => ({ x: witness.position.x, z: witness.position.z, y: witness.position.y + 1 }),
        onTick: t => {
          // Un grito a 7 m de él (alguien que no es el jugador): lo hace voltear a mirar.
          once('grito', t, 1, () => { minds.emit('grito', at.x + 7 * side, at.z + 3, 0, 1, null); note = 'grito'; });
          walkTo(t, 5, 7, 14, 8);
          once('robo', t, 7.5, () => { const p = game.player.position; minds.emit('robo', p.x, p.z, 0, .8, agent); note = 'robo a la vista'; });
          if (witness.fleeTimer <= 0 && witness.mind.aware.reaction === 0) walkTo(t, 9, 10.7, 8, 3);
          once('golpe', t, 11, () => { const p = game.player.position; minds.emit('golpe', p.x, p.z, 0, 1, agent); note = 'golpe'; });
        },
        label: () => {
          const a = witness.mind.aware, out = [`${LEVELS[a.level]} · ${REACTIONS[a.reaction] ?? a.reaction} · cabeza ${((a.gazeYaw ?? 0) * 180 / Math.PI).toFixed(0)}°`,
            `${witness.fleeTimer > 0 ? `huye${minds.time < a.lookBackUntil ? ', mira atrás' : ''}` : 'no huye'}, a ${Math.hypot(witness.position.x - game.player.position.x, witness.position.z - game.player.position.z).toFixed(1)} m`,
            note];
          note = '';
          return out;
        }
      });
    }, { LEVELS, REACTIONS });
  },

  async corrillo(page) {
    const ready = await page.evaluate(async () => {
      const T = window.__tiras, game = window.__game, city = T.city(), nav = city.pedestrianNavigation, S = nav.tileSize;
      const { TEMPERS } = await import('/src/entities/npc/temperament.js');
      const ok = (x, z) => { const id = nav.grid[z]?.[x] ?? -1; return id >= 0 && !nav.nodes[id].crossing && nav.nodes[id].main; };
      const px = Math.round(game.player.position.x / S), pz = Math.round(game.player.position.z / S);
      // Los sitios más abiertos, hasta uno donde desde arriba se vea al jugador y el anillo a 6 m (sin techo ni toldo).
      await T.three();
      const spots = [];
      for (let z = pz - 40; z <= pz + 40; z += 2) for (let x = px - 40; x <= px + 40; x += 2) {
        if (!ok(x, z)) continue;
        let count = 0;
        for (let dz = -6; dz <= 6; dz++) for (let dx = -6; dx <= 6; dx++) if (dx * dx + dz * dz <= 36 && ok(x + dx, z + dz)) count++;
        spots.push({ x: x * S, z: z * S, count });
      }
      spots.sort((a, b) => b.count - a.count);
      const V = game.player.position.constructor;
      let best = null;
      for (const spot of spots.slice(0, 20)) {
        T.putPlayer(spot.x, spot.z);
        const y = game.player.position.y;
        for (let k = 0; k < 8 && !best; k++) {
          const yaw = k * Math.PI / 4, cam = T.cameraAt(yaw, .62, 9);
          if (cam.arm < 8) continue;
          const targets = [[0, 0], [6, 0], [-6, 0], [0, 6], [0, -6]].map(([dx, dz]) => new V(spot.x + dx, y + 1, spot.z + dz));
          if (targets.every(p => T.sees(cam.at, p))) best = { ...spot, yaw };
        }
        if (best) break;
      }
      if (!best) return false;
      T.putPlayer(best.x, best.z);
      const p = game.player.position;
      // Seis curiosos a 10 m, tres a cada lado de la pelea según se ve desde la cámara (como el E2E).
      const people = T.walkers().sort((a, b) => a.position.distanceTo(p) - b.position.distanceTo(p)).slice(0, 6);
      const angles = [-.35, 0, .35, Math.PI - .35, Math.PI, Math.PI + .35].map(a => a + best.yaw + Math.PI / 2);
      people.forEach((npc, k) => {
        for (let tries = 0; tries < 24; tries++) {
          const a = angles[k] + (tries % 2 ? 1 : -1) * Math.ceil(tries / 2) * .06, x = p.x + Math.sin(a) * 10, z = p.z + Math.cos(a) * 10;
          const id = nav.nodeAt(x, z);
          if (id < 0 || nav.nodes[id].crossing || !nav.nodes[id].main) continue;
          T.place(npc, x, z, Math.atan2(p.x - x, p.z - z));
          npc.target = null; npc.route = []; npc.wait = 1e6; npc.stance = null; npc.action = null;
          npc.mind.temper = { ...npc.mind.temper, ...TEMPERS.curioso, tipo: 'curioso' };
          break;
        }
      });
      T.camera(best.yaw, .62, 9);
      window.__corrillo = { people };
      return true;
    });
    if (!ready) return null;
    return page.evaluate(() => {
      const T = window.__tiras, game = window.__game, city = T.city(), { people } = window.__corrillo;
      let last = -1, lastBlow = 0;
      return T.capture({
        title: 'corrillo: el jugador pelea 10 s (un golpe por segundo) con seis curiosos a 10 m, tres de cada lado; la escena dura 8 s tras el último golpe', every: 1, seconds: 30, crop: .95,
        focus: () => game.player.position,
        onTick: t => {
          if (t < 10 && t - last >= 1) { last = t; lastBlow = t; window.dispatchEvent(new CustomEvent('street-fight', { detail: { attacker: { position: game.player.position } } })); }
        },
        label: t => {
          const watching = people.filter(n => n.mind.aware.watching), inPlace = watching.filter(n => !n.target);
          const d = inPlace.map(n => Math.hypot(n.position.x - game.player.position.x, n.position.z - game.player.position.z));
          return [`mirando ${watching.length} (en su puesto ${inPlace.length})`, d.length ? `a ${Math.min(...d).toFixed(1)}-${Math.max(...d).toFixed(1)} m` : '',
            t < 10 ? 'pelea' : `${(t - lastBlow).toFixed(0)} s tras el último golpe`];
        }
      });
    });
  }
};

await mkdir(salida, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] });
const summary = {};
try {
  for (const name of casos) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => localStorage.clear());
    log('cargando', url, name);
    await page.goto(url, { waitUntil: 'commit' });
    await page.locator('#creator-modal').waitFor({ state: 'visible', timeout: 120_000 });
    await page.locator('#cr-name').fill('Peatones tiras');
    await page.locator('#creator-done').click();
    await page.locator('#loading-screen').waitFor({ state: 'hidden', timeout: 120_000 });
    await page.getByRole('button', { name: 'Continuar jugando', exact: true }).click();
    await page.waitForFunction(() => window.__game && !window.__game.paused && !!window.__game.world.active.minds, null, { timeout: 60_000 });
    // De día, el perro lejos (El Chato se mete en todo) y unos segundos para que la calle se mueva.
    await page.evaluate(() => {
      const game = window.__game, dog = game.dog;
      game.clock.hour = 12;
      if (dog) { dog.home?.set?.(dog.home.x + 25, dog.home.y, dog.home.z + 25); dog.position.x += 25; dog.position.z += 25; dog._wanderTarget = null; }
    });
    await page.waitForTimeout(3000);
    await page.evaluate(pageHelpers);
    const result = await CASES[name](page);
    if (!result) { log(name, 'no se pudo armar la escena'); summary[name] = null; await page.close(); continue; }
    await writeFile(path.join(salida, `tira-${name}.png`), Buffer.from(result.png.split(',')[1], 'base64'));
    summary[name] = { cuadros: result.frames, textos: result.texts, errores: errors };
    log(name, `${result.frames} cuadros`, errors.length ? `errores: ${errors.join(' | ')}` : '');
    await page.close();
  }
} finally {
  await browser.close();
}
await writeFile(path.join(salida, 'tiras.json'), JSON.stringify(summary, null, 2));
process.exit(0);
