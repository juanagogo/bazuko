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
import { PolvoGolpes } from '../systems/PolvoGolpes.js';
import { SangreGolpes } from '../systems/SangreGolpes.js';
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
  return Promise.all(sala.npcs.map(npc => npc.preload()));
}

function armasDePrueba(sala, ids = Object.keys(WEAPONS)) {
  return ids.map(id => ({ texto: WEAPONS[id].name, hacer: () => sala.player.equipWeapon(id) }));
}

function prepararCombate(sala) {
  const polvo = new PolvoGolpes(sala.scene);
  const sangre = new SangreGolpes(sala.scene, sala.world, sala.player);
  sala.player.polvoGolpes = polvo;
  sala.sangre = sangre;
  // El cruce de un brazo con otro personaje no debe pintarlo como si estuviera tras una pared.
  sala.silhouetteTest = () => false;
  window.addEventListener('pagehide', e => {
    if (!e.persisted) { sangre.dispose(); polvo.dispose(); }
  });
}

function iluminarCamioneta(sala, squad) {
  // Un farol lateral enfría el borde del uniforme junto al carro. La luz cae antes del fondo de la sala.
  const luz = new THREE.SpotLight(0xd9e3ef, 150, 15, Math.PI / 3, .85);
  luz.name = 'luz-sala-camioneta';
  const parada = new THREE.Vector3(7, 0, 0), rumbo = new THREE.Vector3();
  sala.scene.add(luz, luz.target);
  sala.beforeRender.add(() => {
    if (squad.route) squad.route.sample(squad.stopAt, parada, rumbo);
    luz.position.set(parada.x - 4.7, parada.y + 4.2, parada.z + 3.8);
    luz.target.position.set(parada.x - 1.4, parada.y + 1.1, parada.z);
    luz.intensity = 150 * (1 - sala.scene.userData.environmentDay);
  });
}

function ocultaLaCamioneta(sala, suv) {
  // Caja de la parte opaca del carro. Un ocupante entre la cámara y el jugador deja ver sus materiales reales.
  const carro = new THREE.Box3(new THREE.Vector3(-suv.length / 2, .28, -suv.width / 2),
    new THREE.Vector3(suv.length / 2, 1.42, suv.width / 2));
  const caja = new THREE.Box3(), rayo = new THREE.Ray(), torso = new THREE.Vector3(), cruce = new THREE.Vector3();
  return camera => {
    if (!suv.group.visible) return false;
    torso.copy(sala.player.position);
    torso.y += 1.1;
    rayo.origin.copy(camera.position);
    rayo.direction.subVectors(torso, rayo.origin).normalize();
    caja.copy(carro).applyMatrix4(suv.group.matrixWorld);
    return rayo.intersectBox(caja, cruce) !== null && cruce.distanceToSquared(rayo.origin) < torso.distanceToSquared(rayo.origin);
  };
}

function estadoJugador(sala) {
  const { attack, weapon } = sala.player;
  const estado = `${weapon.name} · Salud ${Math.round(sala.stats.salud)} · Energía ${Math.round(sala.stats.energia)}`;
  if (!attack) return estado;
  return `${estado}\nGolpe ${attack.step + 1} · ${FASES_GOLPE[attack.phase]}`;
}

const FASES_GOLPE = { windup: 'preparación', active: 'contacto', recovery: 'recuperación' };
const ESTADO_CAMIONETA = { idle: 'en espera', arriving: 'llegando', stopped: 'detenida', out: 'ocupantes en la calle', leaving: 'alejándose' };
const ESTADO_OCUPANTE = { idle: 'a bordo', order: 'dando órdenes', chase: 'persiguiendo', windup: 'preparando el golpe',
  strike: 'golpeando', recover: 'recuperándose', return: 'volviendo', surrendered: 'rendido' };

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
    descripcion: 'Acércate con W a los peatones y golpea con G o clic izquierdo. Puedes repetir el combo con otra arma.',
    async montar(sala) {
      prepararCombate(sala);
      await ringOfNpcs(sala, 5, 3);
      sala.cameraRig.yaw = Math.PI;
      const ctx = { player: sala.player.position, camera: sala.cameraRig.camera };
      sala.updaters.add(dt => { for (const npc of sala.npcs) npc.update(dt, ctx); });
      return {
        acciones: [
          ...armasDePrueba(sala),
          { texto: '⚡ Energía llena', hacer: () => { sala.stats.energia = 100; } },
          { texto: 'Nuevos peatones', hacer: () => {
            for (const npc of sala.npcs) npc.dispose();
            sala.npcs.length = 0;
            sala.sangre.limpiar();
            sala.player.polvoGolpes.limpiar();
            return ringOfNpcs(sala, 5, 3);
          } }
        ],
        estado: () => [estadoJugador(sala), `Búsqueda · ${sala.steal.buscado}`,
          ...sala.npcs.map((npc, i) => `Peatón ${i + 1} · ${Math.round(npc.health)} PV${npc.isDead ? ' · fallecido' : npc.isKnockedOut ? ' · inconsciente' : ''}`)].join('\n')
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
    async montar(sala, params) {
      const { crearMT09 } = await import('../world/bogota/mt09.js');
      const filas = [...CAR_MODEL_IDS.map(id => ({ id, kind: id === 'buseta' ? 'buseta' : 'carro' })), { id: 'citadino', kind: 'taxi' }, { id: 'sedanPopular', kind: 'taxi' }, { id: 'sedanPopular', kind: 'police' }, { id: 'suv', kind: 'police' }];
      const cars = filas.map(({ id, kind }, i) => {
        const car = new Car(sala.scene, new THREE.Vector3(i * 9 - 40, 0, -8), 0, { kind, variant: 3 + i * 2, model: id, traffic: true });
        car.marker.visible = false;
        return { car, id, kind };
      });
      sala.scene.add(makeParkedMotos([0, 1, 2, 3].map(i => ({ x: -46 - i * 1.1, z: -8, rot: Math.PI / 2 + .22, seed: i * 3 }))));
      const mt09 = crearMT09();
      mt09.position.set(0, 0, 6);
      sala.scene.add(mt09);
      const modelos = cars.map(({ car, id, kind }) => ({
        posicion: car.group.position, titulo: `${id} · ${kind}`, distancia: Math.max(car.length * .92, 3.7), altura: .85
      }));
      const indiceMT09 = modelos.length;
      modelos.push({ posicion: mt09.position, titulo: mt09.name, distancia: 2.05, altura: .61 });
      sala.setHour(11);
      // Piso de pavimento amplio: la fila entera se revisa sin la cuadrícula de la sala.
      sala.ground.scale.setScalar(6);
      sala.ground.material.color.set('#55565a');
      for (const objeto of sala.scene.children) if (objeto.isGridHelper) objeto.visible = false;
      if (sala.player?.root) sala.player.root.visible = false;
      // Con el HUD oculto la cámara queda en manos de la prueba: fijarla justo antes de dibujar evita pelear con la del jugador.
      const camara = { activa: false, pos: new THREE.Vector3(), mira: new THREE.Vector3() };
      let indiceEncuadrado = -1, vistaEncuadrada, aspectoEncuadrado;
      const ver = (indice, vista) => {
        const { posicion: p, altura, distancia } = modelos[indice];
        const aspecto = sala.cameraRig?.camera.aspect || 1;
        indiceEncuadrado = indice; vistaEncuadrada = vista; aspectoEncuadrado = aspecto;
        const lejos = distancia / Math.min(1, aspecto);
        const vistas = {
          frente: [lejos * .92, 1.55, lejos * .72], cola: [-lejos * .92, 1.55, lejos * .72], lado: [0, 1, lejos * 1.35],
          frenteRecto: [lejos * 1.2, 1.1, 0], colaRecta: [-lejos * 1.2, 1.1, 0], arriba: [lejos * .7, 6, lejos * .7], ladoIzq: [0, 1, -lejos * 1.35],
        };
        const [dx, dy, dz] = vistas[vista];
        camara.pos.set(p.x + dx, p.y + dy * (altura / .85), p.z + dz);
        camara.mira.set(p.x, p.y + altura, p.z); camara.activa = true;
      };
      const verMotos = (dx = 3, dz = 2.6) => { indiceEncuadrado = -1; camara.pos.set(-47.6 + dx, 1.35, -8 + dz); camara.mira.set(-47.6, .6, -8); camara.activa = true; };
      sala.beforeRender?.add?.((camera) => {
        if (!camara.activa) return;
        if (indiceEncuadrado >= 0 && camera.aspect !== aspectoEncuadrado) ver(indiceEncuadrado, vistaEncuadrada);
        camera.position.copy(camara.pos); camera.up.set(0, 1, 0); camera.lookAt(camara.mira); camera.updateMatrixWorld(true);
      });
      window.__flota = { cars, ver, verMotos, camara, filas, mt09 };
      // Como un carro detenido del tráfico: barre si llueve, sin moverse del sitio.
      sala.updaters.add((dt) => { for (const { car } of cars) { car.update(dt); car.animateDrive(0, false, { dt, speed: 0 }); } });
      let noche = false, lluvia = false, actual = 0, vista = 'frente';
      const mostrar = () => ver(actual, vista);
      const verMT09 = () => { actual = indiceMT09; mostrar(); };
      const modeloPedido = params?.get('vehiculo'), tipoPedido = params?.get('tipo');
      const inicial = modeloPedido === 'mt09' ? indiceMT09
        : filas.findIndex(({ id, kind }) => id === modeloPedido && (!tipoPedido || kind === tipoPedido));
      if (inicial >= 0) { actual = inicial; mostrar(); }
      const clima = () => { sala.setHour(noche ? 22 : 11); for (const { car } of cars) car.setNight(noche, lluvia); };
      return {
        acciones: [
          { texto: '💡 Noche', hacer: () => { noche = !noche; clima(); } },
          { texto: '🌧 Lluvia', hacer: () => { lluvia = !lluvia; clima(); } },
          { texto: 'MT-09 V2', hacer: verMT09 },
          { texto: 'Modelo anterior', hacer: () => { actual = (actual + modelos.length - 1) % modelos.length; mostrar(); } },
          { texto: 'Modelo siguiente', hacer: () => { actual = (actual + 1) % modelos.length; mostrar(); } },
          ...['frente', 'cola', 'lado'].map(nombre => ({ texto: nombre, hacer: () => { vista = nombre; mostrar(); } })),
        ],
        estado: () => `${modelos[actual].titulo}\nvista: ${vista}`,
      };
    }
  },
  {
    id: 'limpieza',
    nombre: 'Limpieza social',
    descripcion: 'Llama a la camioneta para ensayar el encuentro. G o clic izquierdo golpea, WASD mueve y Shift permite correr.',
    async montar(sala) {
      prepararCombate(sala);
      sala.setHour(22);
      sala.player.root.rotation.y = Math.PI / 2; // mira hacia el carril, en el sentido de W al entrar
      const squad = new LimpiezaSocialSystem(sala.scene, { player: sala.player, stats: sala.stats, audio: sala.audio });
      squad.setup(null, [straightRoute(new THREE.Vector3(7, 0, -38), new THREE.Vector3(0, 0, 1), 76)], sala.npcs);
      iluminarCamioneta(sala, squad);
      sala.silhouetteTest = ocultaLaCamioneta(sala, squad.suv);
      await Promise.all(squad.preloadables.map((m) => m.preload()));
      sala.updaters.add((dt) => squad.update(dt, { camera: sala.cameraRig.camera }));
      sala.limpieza = squad;
      return {
        acciones: [
          { texto: '🚙 Que llegue', hacer: () => {
            if (squad.trigger()) return;
            if (squad.outcome === 'victoria') toast('El encuentro terminó. Puedes repetir la prueba.');
            else toast(squad.active ? 'La camioneta ya está en la sala.' : 'Acércate a la calle para llamar a la camioneta.');
          } },
          ...armasDePrueba(sala, ['punos', 'cuchillo']),
          { texto: '❤️ Curar', hacer: () => { sala.stats.salud = 100; } },
          { texto: '⏹ Que se vayan', hacer: () => squad.reset() },
          { texto: 'Repetir prueba', hacer: () => window.location.reload() }
        ],
        estado: () => [estadoJugador(sala), `Camioneta · ${ESTADO_CAMIONETA[squad.state] ?? squad.state}`,
          ...(squad.outcome ? [`Desenlace · ${squad.outcome}`] : []),
          ...squad.members.map((m, i) => `${m.isLeader ? 'Jefe' : 'Matón ' + i} · ${Math.round(m.health)} PV · ${m.isDead ? 'fallecido' : ESTADO_OCUPANTE[m.state] ?? m.state}`)].join('\n')
      };
    }
  }
];
