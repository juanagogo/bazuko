import { Vector3 } from 'three';
import { hasClearCombatLine } from './CombatGeometry.js';
import { seesPerson, sightRange } from '../entities/npc/perception.js';
import { pathClear, solidAt } from '../entities/npc/room.js';
import { LOW_STANCES } from '../character/archetypes.js';

export const DEATH_WITNESS = {
  hearing: 12, shelter: 7, quiet: 3, reach: 1.45, aidSeconds: 5, maxWait: 35, lifetime: 55, checkEvery: .25,
};

const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const alive = npc => !!npc?.position && !npc.isDead && !npc._disposed && !npc.koState;
const fighting = actor => !actor?.isDead && (actor?.isAttacking || actor?.melee?.active || actor?._counter);
const sidewalk = (npc, at) => npc.navigation?.isSidewalkAt?.(at) !== false;
const mobile = npc => !npc.isVendor && !npc.fijo && !LOW_STANCES.has(npc.stance);
const nextToBody = (npc, body, collisions) => Math.abs(npc.position.y - body.y) <= .6
  && distance(npc.position, body) <= DEATH_WITNESS.reach && sidewalk(npc, npc.position)
  && hasClearCombatLine({ from: npc.position, to: body, collisions });

/** Un sitio al lado del cuerpo y una ruta por la que de verdad se puede andar hasta él. */
function routeToBody(npc, body, collisions) {
  const angle = Math.atan2(npc.position.z - body.z, npc.position.x - body.x);
  for (const turn of [0, Math.PI / 2, -Math.PI / 2, Math.PI]) {
    const x = body.x + Math.cos(angle + turn), z = body.z + Math.sin(angle + turn);
    const goal = new Vector3(x, npc.groundHeight?.(x, z) ?? body.y, z);
    if (!npc.isWalkable?.(x, z) || !sidewalk(npc, goal) || Math.abs(goal.y - body.y) > .6
      || solidAt(collisions, x, goal.y, z) || !hasClearCombatLine({ from: goal, to: body, collisions })) continue;
    const route = npc.navigation?.routeTo ? npc.navigation.routeTo(npc.position, goal) : [goal];
    if (!route.length) continue;
    let prev = npc.position;
    const valid = route.every(point => {
      const clear = Math.abs(prev.y - point.y) <= .65
        && pathClear(npc, prev.x, prev.z, point.x - prev.x, point.z - prev.z)
        && hasClearCombatLine({ from: prev, to: point, collisions });
      prev = point;
      return clear;
    });
    if (valid) return route;
  }
  return null;
}

/** Un incidente por víctima. Las observaciones se toman en el instante de la caída; después sólo se descubre el cuerpo. */
export class DeathWitnesses {
  constructor(system) {
    this.system = system;
    this.incidents = [];
    this.seenDeaths = new WeakMap();
    this.discoverIn = 0;
  }

  get game() { return this.system.game; }
  get npcs() { return this.game.world?.active?.npcs ?? []; }
  get sight() { return sightRange(this.game.clock?.isNight, this.game.weather?.isRaining); }

  report({ victim, attacker = null, position = victim?.position, wasAggressor = false, attackId = null } = {}) {
    if (!victim || !position || victim._disposed || victim.bodyReleased || victim.emergencyReported || this.incidents.some(s => s.victim === victim)) return 0;
    if (this.seenDeaths.has(victim) && this.seenDeaths.get(victim) === attackId) return 0;
    this.seenDeaths.set(victim, attackId);
    if (attacker === this.game.player) this.system._cancelFightAbout(victim);
    // Dos víctimas del mismo golpe conservan sus testigos y comparten el aviso a emergencias.
    const nearby = this.incidents.find(s => attacker && s.attacker === attacker && s.age < 1
      && s.attackId === attackId && distance(position, s.position) < 6);
    const scene = this._open(victim, attacker, position, wasAggressor, attackId, nearby?.group);
    const pairs = [];
    for (const npc of this.npcs) {
      const partner = npc?.talk?.partner;
      if (partner) pairs.push([npc, partner]); // percibir la caída puede terminar la charla para ambos
      this._notice(scene, npc, true);
    }
    for (const [first, second] of pairs) this._leaveTogether(scene, first, second);
    return scene.observers.size;
  }

  _leaveTogether(scene, first, second) {
    const a = scene.observers.get(first), b = scene.observers.get(second);
    if (!a || !b || distance(first.position, second.position) > 3 || Math.abs(first.position.y - second.position.y) > 1.2) return;
    const fearful = a.temper === 'miedoso' ? a : b;
    const companion = fearful === a ? b : a, npc = companion.npc;
    if (fearful.temper !== 'miedoso' || !fearful.npc.fleeTimer || companion.temper !== 'indiferente'
      || !mobile(npc) || npc.deathResponse || npc.witnessing || npc.fleeTimer > 0) return;
    npc._fleeFrom?.(companion.attacker?.position ?? scene.position);
  }

  _open(victim, attacker, position, wasAggressor, attackId, group) {
    const scene = { victim, attacker, wasAggressor, attackId, position: new Vector3().copy(position),
      age: 0, checkIn: 0, quiet: 0, observers: new Map(), helper: null, aided: !!victim.emergencyAided, wasDead: !!victim.isDead,
      group: group ?? { caller: null, called: !!victim.emergencyReported } };
    this.incidents.push(scene);
    return scene;
  }

  /** Al volver a la calle se puede encontrar un cuerpo. Haber llegado después no revela al autor. */
  _discoverBodies(people) {
    for (const victim of people) {
      if (!victim?.isDead || victim.bodyReleased || victim._disposed || victim.emergencyReported && victim.emergencyAided) continue;
      if (this.incidents.some(s => s.victim === victim)) continue;
      if (!this.npcs.some(n => alive(n) && n.stance !== 'dormido' && seesPerson(n, victim.position, this.sight, this.game.collisions ?? n.collisions))) continue;
      this._open(victim, null, victim.position, false, null);
    }
  }

  _notice(scene, npc, atImpact) {
    if (!alive(npc) || npc === scene.victim || npc === scene.attacker || npc.stance === 'dormido') return;
    const known = scene.observers.get(npc);
    if (known?.victim) return;
    const body = atImpact ? scene.position : scene.victim.position;
    if (!body) return;
    const p = npc.position, dx = p.x - body.x, dy = p.y - body.y, dz = p.z - body.z;
    const heard = atImpact && dx * dx + dy * dy + dz * dz <= DEATH_WITNESS.hearing ** 2;
    const collisions = this.game.collisions ?? npc.collisions;
    const saw = seesPerson(npc, body, this.sight, collisions);
    if (!saw && (!heard || known)) return;
    const attacker = atImpact && saw && seesPerson(npc, scene.attacker?.position, this.sight, collisions) ? scene.attacker : null;
    const fact = known ?? { npc, temper: npc.mind?.temper?.tipo ?? (this.system.random() < .5 ? 'avisador' : 'miedoso'),
      heard: false, victim: null, attacker: null, triedCall: false, triedAid: false };
    fact.heard ||= heard;
    if (saw) fact.victim = scene.victim;
    if (attacker) fact.attacker = attacker;
    scene.observers.set(npc, fact);
    npc.mind?.leaveTalk?.();
    npc.talk?.leave?.();
    npc.mind?.aware?.noticeFall?.(body, fact.attacker, !!fact.attacker && fact.attacker === this.game.player && !scene.wasAggressor, saw);
    if (fact.temper === 'miedoso' && mobile(npc) && !npc.fleeTimer) npc._fleeFrom?.(attacker?.position ?? body);
    if (!scene.spoken && saw) {
      scene.spoken = true;
      this.system._decir(npc, atImpact ? 'alertaMuerte' : 'hallazgo');
    } else if (heard && !saw && !scene.heardSpoken) {
      scene.heardSpoken = true;
      npc.say?.('¿Oyó ese golpe?');
    }
  }

  /** Una pelea que continúa cerca del cuerpo retrasa a quien iba a arrimarse. */
  fightAt(at) {
    if (!at) return;
    for (const scene of this.incidents) if (Math.abs(at.y - scene.position.y) <= 1.2 && distance(at, scene.position) < DEATH_WITNESS.shelter) scene.quiet = 0;
  }

  _threat(scene, fact, at) {
    const actor = fact.attacker, collisions = this.game.collisions ?? fact.npc.collisions;
    const near = other => other?.position && !other.isDead && !other._disposed && other.active !== false
      && Math.abs(other.position.y - at.y) <= 1.2 && distance(other.position, at) < DEATH_WITNESS.shelter
      && hasClearCombatLine({ from: at, to: other.position, collisions });
    if (actor && near(actor) && (!scene.wasAggressor || fighting(actor))) return actor.position;
    for (const other of this.game.limpieza?.members ?? []) {
      if (near(other) && fighting(other) && seesPerson(fact.npc, other.position, this.sight, collisions)) return other.position;
    }
    if (fighting(scene.attacker) && near(scene.attacker) && seesPerson(fact.npc, scene.attacker.position, this.sight, collisions)) return scene.attacker.position;
    return null;
  }

  _choose(scene, role) {
    let choice = null, atScene = scene, lowest = Infinity;
    const possible = role === 'avisar' ? this.incidents.filter(s => s.group === scene.group) : [scene];
    for (const nearby of possible) for (const fact of nearby.observers.values()) {
      const n = fact.npc;
      if (!fact.victim || !alive(n) || !this.npcs.includes(n) || n.deathResponse || n.witnessing || n.fleeTimer > 0 || n._hitReactionRemaining > 0 || !mobile(n)) continue;
      if (fact.retryAt > nearby.age || distance(n.position, nearby.position) > 24) continue;
      if (role === 'avisar' ? fact.temper !== 'avisador' || fact.triedCall
        : (fact.temper !== 'bravo' && fact.temper !== 'curioso') || fact.triedAid) continue;
      let score = distance(n.position, nearby.position);
      if (role === 'avisar') {
        if (!fact.attacker) score += 50;
        else if (nearby.wasAggressor) score += 25;
      }
      if (score < lowest) { choice = fact; atScene = nearby; lowest = score; }
    }
    if (!choice) return null;
    const npc = choice.npc;
    npc.deathResponse = role;
    npc.mind?.leaveTalk?.();
    npc.talk?.leave?.();
    return { scene: atScene, fact: choice, npc, started: atScene.age, fled: false, route: null, mode: 'esperar' };
  }

  _release(job, cancelFlight = false) {
    if (!job || job.released) return;
    job.released = true;
    const { npc, scene } = job;
    if (npc.witnessing === 'auxiliar' || (npc.witnessing === 'llamar' && job.mode === 'llamando')) {
      this.system._voces()?.cortarTestigo?.(npc, npc.witnessing === 'llamar' ? 'auxilio' : 'hallazgo');
      npc.stopWitness?.();
    }
    if (cancelFlight && job.fled && alive(npc) && !(npc._hitReactionRemaining > 0)) this._stopFlight(job);
    if (job.route && npc.route === job.route) { npc.route = []; npc.target = null; npc.wait = 0; }
    if (scene.group.caller === job) scene.group.caller = null;
    if (scene.helper === job) scene.helper = null;
    npc.deathResponse = null;
  }

  _stopFlight(job) {
    const { npc } = job;
    npc.fleeTimer = 0;
    npc._endFleeRoute?.();
    if (npc._cowering) npc._stopCowering?.();
    job.fled = false;
  }

  _work(job) {
    const { scene, fact, npc } = job, body = scene.victim.position;
    const collisions = this.game.collisions ?? npc.collisions;
    if (!alive(npc) || !this.npcs.includes(npc) || npc._hitReactionRemaining > 0 || (!job.fled && npc.fleeTimer > 0)) {
      this._release(job); return;
    }
    if (job.mode === 'esperar' && scene.age - job.started > DEATH_WITNESS.maxWait) {
      fact.retryAt = scene.age + 8;
      this._release(job); return;
    }
    const caller = npc.deathResponse === 'avisar';
    const threat = this._threat(scene, fact, npc.position);
    const danger = threat ?? (scene.quiet < DEATH_WITNESS.quiet && distance(npc.position, body) < DEATH_WITNESS.shelter ? scene.position : null);
    if (danger || !sidewalk(npc, npc.position) && caller) {
      if (!job.fled || !npc.fleeTimer) {
        npc._fleeFrom?.(danger ?? body); job.fled = true; job.route = null;
      }
      if (job.mode === 'llamando' || job.mode === 'atendiendo') this._release(job);
      return;
    }
    if (job.fled) this._stopFlight(job);
    if (job.mode === 'llamando') return;
    if (job.mode === 'atendiendo') {
      if (npc.witnessing !== 'auxiliar') {
        if (npc._witnessFinished) {
          scene.aided = scene.victim.emergencyAided = true;
          globalThis.window?.dispatchEvent?.(new CustomEvent('population-changed'));
        }
        this._release(job);
      }
      return;
    }
    if (caller) {
      if (this.system.calls.length || !npc.witness?.('llamar', this.system.callSeconds, body)) return;
      job.mode = 'llamando';
      fact.triedCall = true;
      this.system.calls.push({ npc, kind: 'muerte', position: scene.position, job, left: this.system.callSeconds + 1 });
      this.system._decir(npc, 'auxilio');
      return;
    }
    if (scene.quiet < DEATH_WITNESS.quiet || scene.victim.deathSettled === false || this._threat(scene, fact, body)) {
      if (job.route === npc.route) npc.route = [];
      job.route = null; npc.target = null; npc.wait = .6;
      return;
    }
    if (nextToBody(npc, body, collisions)) {
      if (npc.witness?.('auxiliar', DEATH_WITNESS.aidSeconds, body)) {
        fact.triedAid = true; job.mode = 'atendiendo';
        this.system._decir(npc, 'hallazgo');
      }
      return;
    }
    if (job.route && npc.target && job.route === npc.route) return;
    const route = routeToBody(npc, body, collisions);
    if (!route || job.route) { fact.triedAid = true; this._release(job); return; }
    job.route = route; npc.route = route; npc.routeIndex = 0; npc.target = route[0];
    npc.wait = 0; npc.stance = null; npc.action = null;
  }

  update(dt) {
    if ((this.discoverIn -= dt) <= 0) {
      this.discoverIn = 1;
      this._discoverBodies(this.npcs);
      if (this.game.limpieza?.members) this._discoverBodies(this.game.limpieza.members);
      const officers = this.game.policeFoot?.officers, drivers = this.game.roadRage?.fallenDrivers;
      if (officers) this._discoverBodies(officers);
      if (drivers) this._discoverBodies(drivers);
    }
    for (let i = this.incidents.length - 1; i >= 0; i--) {
      const scene = this.incidents[i];
      scene.age += dt; scene.quiet += dt;
      if (scene.victim._disposed || scene.victim.bodyReleased || (scene.aided && scene.group.called && !scene.helper)
        || (!scene.victim.isDead && (scene.wasDead || scene.age > DEATH_WITNESS.lifetime))) {
        this._end(scene); this.incidents.splice(i, 1); continue;
      }
      if ((scene.checkIn -= dt) > 0) continue;
      scene.checkIn = DEATH_WITNESS.checkEvery;
      for (const npc of this.npcs) this._notice(scene, npc, false);
      const group = scene.group;
      if (!group.called && !group.caller && !this.system.calls.some(call => call.deathGroup === group)) group.caller = this._choose(scene, 'avisar');
      if (group.caller?.scene === scene) this._work(group.caller);
      if (!scene.aided && !scene.helper) scene.helper = this._choose(scene, 'auxiliar');
      if (scene.helper) this._work(scene.helper);
    }
  }

  finishCall(job, completed) {
    const { scene, fact, npc } = job;
    const reached = completed && !job.released && !scene.group.called && scene.group.caller === job;
    this._release(job);
    if (reached) this._complete(scene.group, npc, fact.victim);
  }

  /** Un solo barrido puede herir a un civil y matar a otro participante. La patrulla recibe un solo despacho. */
  finishFightCall(call) {
    const group = call.deathGroup;
    if (group.called) return;
    this._release(group.caller, true);
    this._complete(group, call.npc, null, { victim: call.injured, attacker: this.game.player, position: call.position.clone() });
  }

  _complete(group, npc, victim, injury = null) {
    group.called = true;
    const reports = [];
    let identifiedCrime = null;
    for (const near of this.incidents) {
      if (near.group !== group) continue;
      const saw = near.observers.get(npc);
      if (!saw?.victim) continue;
      saw.victim.emergencyReported = true;
      const report = { victim: saw.victim, attacker: saw.attacker, position: near.position.clone() };
      reports.push(report);
      if (saw.attacker && saw.attacker === this.game.player && !near.wasAggressor) identifiedCrime = report;
    }
    if (identifiedCrime) this.system._callCompleted({ kind: 'muerte', position: identifiedCrime.position });
    else if (injury) this.system._callCompleted({ kind: 'pelea', position: injury.position });
    else this.system._toast('Un testigo pidió ayuda en el 123', 'info');
    if (!reports.length) return;
    const subject = identifiedCrime ?? reports.find(r => r.victim === victim) ?? reports[0];
    const detail = { ...subject, npc, reports, injury, accusedPlayer: !!(identifiedCrime || injury) };
    globalThis.window?.dispatchEvent?.(new CustomEvent('npc-emergency-call', { detail }));
  }

  _end(scene) {
    this._release(scene.helper, true);
    if (scene.group.caller?.scene === scene) this._release(scene.group.caller, true);
  }

  reset() {
    for (const scene of this.incidents) this._end(scene);
    this.incidents.length = 0;
    this.seenDeaths = new WeakMap();
    this.discoverIn = 0;
  }
}
