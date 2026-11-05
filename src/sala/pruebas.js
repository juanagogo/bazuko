// src/sala/pruebas.js
// Pruebas de la sala. Cada una monta solo lo que necesita sobre `sala` (ver Sala.js) y devuelve
// sus botones. Para agregar una: una entrada más en PRUEBAS; se abre con sala.html?prueba=<id>.
//
//   { id, nombre, descripcion, async montar(sala) → { acciones: [{ texto, hacer }], estado?() } }
import * as THREE from 'three';
import { Npc } from '../entities/Npc.js';
import { Car } from '../entities/Car.js';
import { CAR_MODEL_IDS } from '../world/bogota/vehicles.js';
import { makeParkedMotos } from '../world/bogota/motos.js';
import { WEAPONS } from '../data/weapons.js';
import { SUBSTANCE_EFFECTS } from '../data/substanceEffects.js';
import { SMOKABLES } from '../character/smoking.js';
import { LimpiezaSocialSystem, straightRoute } from '../systems/LimpiezaSocialSystem.js';
import { createRealisticCharacter } from '../character/RealisticCharacter.js';
import { STANCE_NAMES } from '../character/stances.js';
import { ARCHETYPES } from '../character/archetypes.js';
import { GAIT_FAMILIES } from '../character/gaitFamilies.js';

const toast = (text) => window.dispatchEvent(new CustomEvent('toast', { detail: { text, type: 'info' } }));

/** Peatones quietos en semicírculo delante del jugador (para golpear o mirar) */
function ringOfNpcs(sala, count, radius) {
  for (let i = 0; i < count; i++) {
    const a = Math.PI * (i + 0.5) / count - Math.PI / 2;
    const npc = new Npc(sala.scene, new THREE.Vector3(Math.sin(a) * radius, 0, Math.cos(a) * radius), { gastada: true, wander: 0, facing: a + Math.PI });
    sala.npcs.push(npc);
  }
}

// Quienes se quedan en su sitio, con lo que hacen allí.
const FIJOS = [
  { arquetipo: 'habitante', stance: 'dormido' }, { arquetipo: 'habitante', stance: 'sentado' }, { arquetipo: 'habitante', stance: 'acurrucado' },
  { arquetipo: 'habitante', stance: 'pedir' }, { arquetipo: 'abuelo', stance: 'banca' }, { arquetipo: 'senora', stance: 'banca' },
  { arquetipo: 'oficinista', stance: 'hablar' }, { arquetipo: 'estudiante', stance: 'hablar' }, { arquetipo: 'vendedor', stance: 'atender' }
];

/** Peatones reales de cada arquetipo: una fila que anda en el sitio y otra con quienes se quedan fijos. */
function peatones(sala) {
  const opciones = { lod: false, andando: false, lluvia: false, higiene: 100 };
  const gente = [];
  const jugador = new THREE.Vector3(0, 0, 40);
  let turno = 0;
  const montar = async () => {
    const mio = ++turno;
    for (const { npc } of gente.splice(0)) npc.dispose();
    const crear = (x, z, facing, datos, fijo) => {
      const npc = new Npc(sala.scene, new THREE.Vector3(x, 0, z), {
        arquetipo: datos.arquetipo, facing, wander: 0, isWalkable: () => false,
        ...(fijo ? { fijo: { stance: datos.stance } } : {})
      });
      gente.push({ npc, ...datos });
      return npc.ready;
    };
    const fila = Object.keys(ARCHETYPES);
    await Promise.all([
      ...fila.flatMap((arquetipo, i) => [crear((i - (fila.length - 1) / 2) * 1.5, 3.5, Math.PI, { arquetipo }, false),
        crear((i - (fila.length - 1) / 2) * 1.5, 5.5, Math.PI, { arquetipo }, false)]),
      ...FIJOS.map((datos, i) => crear((i - (FIJOS.length - 1) / 2) * 1.5, 8, Math.PI, datos, true))
    ]);
    if (mio !== turno) return;
    for (const { npc } of gente) {
      await npc.preload();
      if (mio !== turno) return;
      npc._show(opciones.lod ? npc.lodChar : npc.fullChar);
    }
  };
  // Un jugador lejos para que nadie se fije en él; los modelos los escoge la prueba, no la distancia.
  sala.updaters.add((dt) => {
    const ctx = { player: jugador, isRaining: opciones.lluvia, hygiene: opciones.higiene };
    for (const { npc, stance } of gente) {
      if (!npc.character) continue;
      npc.moving = opciones.andando && !stance;
      npc._updateConduct(dt, ctx);
      const pose = npc.moving || !stance ? npc._stanceNow() : stance;
      npc._updateHeld(pose);
      npc.character.update(dt, {
        speed: npc.moving ? npc._paceNow() / 1.08 : 0, stance: pose, style: npc.style, action: stance ? null : npc.action
      });
    }
  });
  return montar().then(() => ({
    acciones: [
      { texto: 'Otra tanda', hacer: () => montar() },
      { texto: 'Completo / liviano', hacer: () => {
        opciones.lod = !opciones.lod;
        for (const { npc } of gente) if (npc.lodChar && npc.fullChar) npc._show(opciones.lod ? npc.lodChar : npc.fullChar);
      } },
      { texto: 'Quietos / andando', hacer: () => { opciones.andando = !opciones.andando; } },
      { texto: 'Lluvia', hacer: () => { opciones.lluvia = !opciones.lluvia; } },
      { texto: 'Jugador sucio / limpio', hacer: () => {
        opciones.higiene = opciones.higiene < 30 ? 100 : 10;
        jugador.z = opciones.higiene < 30 ? 6 : 40; // cerca, para que lo huelan
      } },
      { texto: 'Postura de parada', hacer: () => { for (const { npc, stance } of gente) if (!stance) npc.stance = npc.person.paradas ? Object.keys(npc.person.paradas)[Math.floor(Math.random() * Object.keys(npc.person.paradas).length)] : null; } }
    ],
    estado: () => `${opciones.lod ? 'liviano' : 'completo'}, ${opciones.andando ? 'andando' : 'quietos'}${opciones.lluvia ? ', con lluvia' : ''}${opciones.higiene < 30 ? ', jugador sucio' : ''}\n${Object.keys(ARCHETYPES).join(' · ')}`
  }));
}

function fumar(sala) {
  const p = sala.player;
  return {
    acciones: [
      ...Object.entries(SMOKABLES).map(([id, s]) => ({
        texto: `${s.emoji} Prender ${s.name}`,
        hacer: () => { p.stopSmoking(); p.startSmoking(id); toast(`${s.emoji} Prendiste un ${s.name}`); }
      })),
      { texto: '💨 Basuco', hacer: () => { if (p.startBasuco()) toast('💨 Prendiste la pipa'); } },
      { texto: '⏩ Calada ya', hacer: () => { if (p.smoking) p.smoking.nextPuff = 0; } },
      { texto: '⏭ Casi se acaba', hacer: () => { if (p.smoking) p.smoking.left = 5; } },
      { texto: 'Apagar', hacer: () => p.stopSmoking() },
      { texto: '😌 Calmar', hacer: () => sala.calm() }
    ],
    estado: () => [
      p.smoking
        ? `${p.smoking.kind}: quedan ${Math.ceil(p.smoking.left)} s\npróxima calada en ${Math.max(0, p.smoking.nextPuff).toFixed(1)} s${p.smoking.puff != null ? `\ncalada t=${p.smoking.puff.toFixed(2)}` : ''}`
        : 'sin fumar',
      p.basuco ? `basuco t=${p.basuco.t.toFixed(1)}` : '',
      sala.psychosis.induced ? `paranoia: ${Math.ceil(sala.psychosis.induced.left)} s  sombras: ${sala.psychosis.shadowPeople.length}` : ''
    ].filter(Boolean).join('\n')
  };
}

// Personas de la prueba de posturas: un cuerpo y una ropa de cada tipo.
const CUERPOS = [
  { sexo: 'hombre', edad: 'adulto', pelo: 'corto', barba: 'ninguna', ropa: 'chaqueta', calzado: 'tenis' },
  { sexo: 'mujer', edad: 'joven', pelo: 'cola', barba: 'ninguna', ropa: 'blusa', calzado: 'zapatos' },
  { sexo: 'hombre', edad: 'mayor', pelo: 'calvo', barba: 'bigote', ropa: 'saco', calzado: 'zapatos', cabeza: 'boina' },
  { sexo: 'mujer', edad: 'mayor', pelo: 'melena', barba: 'ninguna', ropa: 'sudadera', calzado: 'zapatos' },
  { sexo: 'hombre', edad: 'joven', pelo: 'rapado', barba: 'ninguna', ropa: 'camiseta', calzado: 'tenis' }
];

/** Filas de gente, una por postura, con el modelo y el paso que se elijan. */
function posturas(sala) {
  const opciones = { cuerpo: 0, lod: false, andar: 'normal', speed: 0, ko: 0, cayendo: false };
  const gente = [];
  let turno = 0;
  const montar = async () => {
    const mio = ++turno;
    for (const { char, holder } of gente.splice(0)) { char.dispose(); holder.removeFromParent(); }
    const creados = await Promise.all(STANCE_NAMES.map(stance => createRealisticCharacter(
      { piel: 2, peloColor: 0, desgaste: 0, real: CUERPOS[opciones.cuerpo] },
      { lod: opciones.lod, andar: opciones.andar }
    ).then(char => ({ char, stance }))));
    if (mio !== turno) { for (const { char } of creados) char.dispose(); return; }
    creados.forEach(({ char, stance }, i) => {
      const holder = new THREE.Group();
      holder.position.set(((i % 9) - 4) * 1.5, 0, 3.5 + Math.floor(i / 9) * 2.4);
      holder.rotation.y = Math.PI;
      holder.add(char.group);
      sala.scene.add(holder);
      gente.push({ char, holder, stance });
    });
  };
  sala.updaters.add((dt) => {
    // Los tiempos de NPC_COMBAT: cae en .7 s y se para en 1,5 s.
    if (opciones.cayendo) opciones.ko = Math.min(1, opciones.ko + dt / .7);
    else opciones.ko = Math.max(0, opciones.ko - dt / 1.5);
    const lie = opciones.ko * opciones.ko * (3 - 2 * opciones.ko);
    for (const { char, stance } of gente) {
      char.update(dt, { speed: opciones.speed, stance: opciones.ko > 0 ? null : stance, ko: lie, koRising: !opciones.cayendo });
    }
  });
  const familias = Object.keys(GAIT_FAMILIES);
  return montar().then(() => ({
    acciones: [
      { texto: 'Otro cuerpo', hacer: () => { opciones.cuerpo = (opciones.cuerpo + 1) % CUERPOS.length; montar(); } },
      { texto: 'Completo / liviano', hacer: () => { opciones.lod = !opciones.lod; montar(); } },
      { texto: 'Otra familia de paso', hacer: () => { opciones.andar = familias[(familias.indexOf(opciones.andar) + 1) % familias.length]; montar(); } },
      { texto: 'Quietos / andando', hacer: () => { opciones.speed = opciones.speed ? 0 : 1; } },
      { texto: 'Caer / levantarse', hacer: () => { opciones.cayendo = !opciones.cayendo; } }
    ],
    estado: () => `${CUERPOS[opciones.cuerpo].sexo} ${CUERPOS[opciones.cuerpo].edad}, ${opciones.lod ? 'liviano' : 'completo'}, paso ${opciones.andar}\n${gente.map(({ stance }) => stance).join(' · ')}`
  }));
}

export const PRUEBAS = [
  {
    id: 'personaje',
    nombre: 'Personaje y animaciones',
    descripcion: 'Compara las poses en el sitio. Movimiento libre permite caminar, saltar y golpear con los controles del juego.',
    montar(sala) {
      const p = sala.player;
      return {
        acciones: [
          ...['reposo', 'caminar', 'correr', 'buscar', 'pedir', 'comer', 'beber', 'saludo', 'cagar', 'lanzar', 'dormir', 'nadar', 'flotar'].map(name => ({
            texto: name === 'cagar' ? 'Agacharse' : name[0].toUpperCase() + name.slice(1),
            hacer: () => { sala.animationPreview.play(name); sala.cameraRig._snap = true; }
          })),
          { texto: 'Saltar', hacer: () => { sala.animationPreview.stop(); sala.input.pressedThisFrame.add('Space'); } },
          { texto: 'Golpear', hacer: () => { sala.animationPreview.stop(); p.punch(); } },
          { texto: 'Movimiento libre', hacer: () => sala.animationPreview.stop() }
        ],
        estado: () => sala.animationPreview.name ? `En el sitio · ${sala.animationPreview.name}` : 'Movimiento libre · WASD / Shift / Espacio / G'
      };
    }
  },
  {
    id: 'peatones',
    nombre: 'Peatones',
    descripcion: 'Una fila de cada arquetipo y otra de quienes se quedan fijos; con otra tanda, lluvia y modelo liviano.',
    montar: peatones
  },
  {
    id: 'posturas',
    nombre: 'Posturas del cuerpo',
    descripcion: 'Una persona por cada postura de la capa de cuerpo, en el modelo completo o en el liviano, con la familia de paso que se elija. Andando se ven las que siguen al caminar y las demás se retiran.',
    montar: posturas
  },
  {
    id: 'fumar',
    nombre: 'Fumar',
    descripcion: 'Cigarrillo, porro y basuco: caladas, humo y efectos. Sube la velocidad para no esperar 30 s.',
    montar: fumar
  },
  {
    id: 'pelea',
    nombre: 'Pelea',
    descripcion: 'Cinco peatones quietos para probar golpes, combos y armas (G o clic).',
    montar(sala) {
      ringOfNpcs(sala, 5, 3);
      const p = sala.player;
      return {
        acciones: [
          ...Object.entries(WEAPONS).map(([id, w]) => ({ texto: w.name, hacer: () => p.equipWeapon(id) })),
          { texto: '⚡ Energía llena', hacer: () => { sala.stats.energia = 100; } },
          { texto: 'Nuevos peatones', hacer: () => {
            for (const npc of sala.npcs) npc.dispose?.() ?? npc.root?.removeFromParent();
            sala.npcs.length = 0;
            ringOfNpcs(sala, 5, 3);
          } }
        ],
        estado: () => `arma: ${p.equippedWeapon}  energía: ${Math.round(sala.stats.energia)}\nbuscado: ${sala.steal.buscado}`
      };
    }
  },
  {
    id: 'efectos',
    nombre: 'Efectos de sustancias',
    descripcion: 'La imagen de cada sustancia sin tener que conseguirla. El basuco trae paranoia.',
    montar(sala) {
      // como en el juego: el evento dispara la imagen y, con el basuco, la paranoia
      const consume = (id) => window.dispatchEvent(new CustomEvent('substance-consumed', { detail: { id } }));
      return {
        acciones: [
          ...Object.keys(SUBSTANCE_EFFECTS).map((id) => ({ texto: id, hacer: () => consume(id) })),
          { texto: 'Terminar', hacer: () => sala.calm() }
        ]
      };
    }
  },
  {
    id: 'carros',
    nombre: 'Carros',
    descripcion: 'Un carro particular y una patrulla detenidos, con conductor, para revisar modelos y luces. Un parqueado vacío no enciende nada.',
    montar(sala) {
      const cars = [
        new Car(sala.scene, new THREE.Vector3(-3, 0, 4), Math.PI / 2, { traffic: true }),
        new Car(sala.scene, new THREE.Vector3(3, 0, 4), Math.PI / 2, { traffic: true, kind: 'police' })
      ];
      sala.updaters.add((dt) => { for (const c of cars) { c.update(dt); c.animateDrive(0, false, { dt, speed: 0 }); } });
      let night = false;
      return {
        acciones: [{ texto: '💡 Luces', hacer: () => { night = !night; for (const c of cars) c.setNight?.(night, false); } }]
      };
    }
  },
  {
    id: 'vehiculos',
    nombre: 'Flota',
    descripcion: 'Todos los modelos en fila, de día, con la cámara a la altura de los ojos. Pasa de modelo y elige una vista.',
    montar(sala) {
      const filas = [...CAR_MODEL_IDS.map(id => ({ id, kind: 'carro' })), { id: 'citadino', kind: 'taxi' }, { id: 'sedanPopular', kind: 'taxi' }, { id: 'sedanPopular', kind: 'police' }, { id: 'suv', kind: 'police' }];
      const cars = filas.map(({ id, kind }, i) => {
        const car = new Car(sala.scene, new THREE.Vector3(i * 9 - 40, 0, -8), 0, { kind, variant: 3 + i * 2, model: id, traffic: true });
        car.marker.visible = false;
        return { car, id, kind };
      });
      sala.scene.add(makeParkedMotos([0, 1, 2, 3].map(i => ({ x: -46 - i * 1.1, z: -8, rot: Math.PI / 2 + .22, seed: i * 3 }))));
      sala.setHour(11);
      // Piso de pavimento amplio: la fila entera se revisa sin la cuadrícula de la sala.
      sala.ground.scale.setScalar(6);
      sala.ground.material.color.set('#55565a');
      for (const objeto of sala.scene.children) if (objeto.isGridHelper) objeto.visible = false;
      if (sala.player?.root) sala.player.root.visible = false;
      // Con el HUD oculto la cámara queda en manos de la prueba: fijarla justo antes de dibujar evita pelear con la del jugador.
      const camara = { activa: false, pos: new THREE.Vector3(), mira: new THREE.Vector3() };
      sala.beforeRender?.add?.((camera) => {
        if (!camara.activa) return;
        camera.position.copy(camara.pos); camera.up.set(0, 1, 0); camera.lookAt(camara.mira); camera.updateMatrixWorld(true);
      });
      const ver = (indice, vista) => {
        const { car } = cars[indice], p = car.group.position, L = car.length, h = 1.55;
        const lejos = Math.max(L * .92, 3.7);
        const vistas = {
          frente: [lejos * .92, h, lejos * .72], cola: [-lejos * .92, h, lejos * .72], lado: [0, 1.0, lejos * 1.35],
          frenteRecto: [lejos * 1.2, 1.1, 0], colaRecta: [-lejos * 1.2, 1.1, 0], arriba: [lejos * .7, 6, lejos * .7], ladoIzq: [0, 1.0, -lejos * 1.35],
        };
        const [dx, dy, dz] = vistas[vista];
        camara.pos.set(p.x + dx, dy, p.z + dz); camara.mira.set(p.x, .85, p.z); camara.activa = true;
      };
      const verMotos = (dx = 3, dz = 2.6) => { camara.pos.set(-47.6 + dx, 1.35, -8 + dz); camara.mira.set(-47.6, .6, -8); camara.activa = true; };
      window.__flota = { cars, ver, verMotos, camara, filas };
      // Como un carro detenido del tráfico: barre si llueve, sin moverse del sitio.
      sala.updaters.add((dt) => { for (const { car } of cars) { car.update(dt); car.animateDrive(0, false, { dt, speed: 0 }); } });
      let noche = false, lluvia = false, actual = 0, vista = 'frente';
      const mostrar = () => ver(actual, vista);
      const clima = () => { sala.setHour(noche ? 22 : 11); for (const { car } of cars) car.setNight(noche, lluvia); };
      return {
        acciones: [
          { texto: '💡 Noche', hacer: () => { noche = !noche; clima(); } },
          { texto: '🌧 Lluvia', hacer: () => { lluvia = !lluvia; clima(); } },
          { texto: 'Modelo anterior', hacer: () => { actual = (actual + cars.length - 1) % cars.length; mostrar(); } },
          { texto: 'Modelo siguiente', hacer: () => { actual = (actual + 1) % cars.length; mostrar(); } },
          ...['frente', 'cola', 'lado'].map(nombre => ({ texto: nombre, hacer: () => { vista = nombre; mostrar(); } })),
        ],
        estado: () => `${filas[actual].id} · ${filas[actual].kind}\nvista: ${vista}`,
      };
    }
  },
  {
    id: 'limpieza',
    nombre: 'Limpieza social',
    descripcion: 'La camioneta negra llega por la calle de la derecha (x = 7) y se bajan los tres. Corre con Shift.',
    async montar(sala) {
      sala.setHour(22);
      const squad = new LimpiezaSocialSystem(sala.scene, { player: sala.player, stats: sala.stats, audio: sala.audio });
      squad.setup(null, [straightRoute(new THREE.Vector3(7, 0, -38), new THREE.Vector3(0, 0, 1), 76)]);
      await Promise.all(squad.preloadables.map((m) => m.preload()));
      sala.updaters.add((dt) => squad.update(dt, { camera: sala.cameraRig.camera }));
      sala.limpieza = squad;
      return {
        acciones: [
          { texto: '🚙 Que llegue', hacer: () => { if (!squad.trigger()) toast('Ya están aquí (o estás muy lejos de la calle)'); } },
          { texto: '❤️ Curar', hacer: () => { sala.stats.salud = 100; } },
          { texto: '⏹ Que se vayan', hacer: () => squad.reset() }
        ],
        estado: () => `estado: ${squad.state}  salud: ${Math.round(sala.stats.salud)}\n` +
          squad.members.map((m) => `${m.role}: ${m.state}`).join('\n')
      };
    }
  }
];
