// src/ui/Creator.js — portado de rebusque; la vista previa y las opciones son del personaje realista
import * as THREE from 'three';
import { PALETTES, COLOR_NAMES, NAME_IDEAS, WEAR_LEVELS, ACCESSORIES, normalizeLook, randomLook, cleanName } from '../character/look.js';
import { STREET_PRESETS, applyStreetPreset } from '../character/presets.js';
import { createRealisticCharacter, loadCatalog, optionsFor, normalizeReal, randomReal } from '../character/RealisticCharacter.js';
import { ORIGINS } from '../data/origins.js';
import { el } from './dom.js';
import { icon, setIcon } from './icons.js';

const $ = (id) => document.getElementById(id);

const TABS = [
  { id: 'identidad', label: 'Nombre', ic: 'idcard', focus: 'body' },
  { id: 'estilo', label: 'Estilo', ic: 'sparkles', focus: 'body' },
  { id: 'cuerpo', label: 'Cuerpo', ic: 'body', focus: 'body' },
  { id: 'pelo', label: 'Pelo', ic: 'scissors', focus: 'face' },
  { id: 'cara', label: 'Barba', ic: 'eye', focus: 'face' },
  { id: 'ropa', label: 'Ropa', ic: 'shirt', focus: 'body' },
];

const SEXOS = [{ id: 'hombre', label: 'Hombre' }, { id: 'mujer', label: 'Mujer' }];
const EDADES = [{ id: 'joven', label: 'Joven' }, { id: 'adulto', label: 'Adulto' }, { id: 'mayor', label: 'Mayor' }];

/**
 * Editor "Crea tu personaje": vista 3D propia (se gira arrastrando, la cámara
 * se acerca a la cara en Cara/Pelo/Accesorios) y opciones por categoría.
 */
export function createCreator({ audio }) {
  const root = $('creator-modal');
  const canvas = $('creator-canvas');
  const panel = $('creator-panel');
  const tabsEl = $('creator-tabs');
  let renderer = null;
  let scene, camera, char = null, raf = 0;
  let catalog = null;
  let look = null;
  let initial = null;
  let tab = 'identidad';
  let resolver = null;
  let yaw = 0.35, yawVel = 0;
  let wave = 0;
  const camPos = new THREE.Vector3(0, 1.2, 4.2);
  const camLook = new THREE.Vector3(0, 0.8, 0);
  const FOCUS = {
    body: { pos: new THREE.Vector3(0, 1.2, 5.2), look: new THREE.Vector3(0, 0.95, 0) },
    face: { pos: new THREE.Vector3(0, 1.6, 1.5), look: new THREE.Vector3(0, 1.52, 0) },
  };

  function setupScene() {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
    scene.add(new THREE.HemisphereLight('#dfe8ff', '#5a4632', 1.3));
    const key = new THREE.DirectionalLight('#fff1dc', 2.6);
    key.position.set(2.5, 4, 3);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    const s = key.shadow.camera;
    s.left = -2; s.right = 2; s.top = 3; s.bottom = -1;
    scene.add(key);
    const rim = new THREE.DirectionalLight('#8fb4ff', 1.4);
    rim.position.set(-3, 2.5, -3);
    scene.add(rim);
    // pedestal: tapa de caneca / cartón redondo
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.95, 0.08, 40), new THREE.MeshLambertMaterial({ color: '#9a7449' }));
    disc.position.y = -0.04;
    disc.receiveShadow = true;
    scene.add(disc);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.92, 0.02, 6, 48), new THREE.MeshBasicMaterial({ color: '#f6c400' }));
    ring.rotation.x = Math.PI / 2;
    scene.add(ring);
    createRealisticCharacter(look).then((c) => {
      char = c;
      char.group.scale.setScalar(1);
      scene.add(char.group);
    });
  }

  function resize() {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(r.width, r.height, false);
    camera.aspect = r.width / r.height;
    camera.updateProjectionMatrix();
  }

  let last = 0;
  function loop(now) {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
    last = now;
    resize();
    yaw += yawVel * dt;
    yawVel *= Math.exp(-dt * 4);
    if (char) char.group.rotation.y = yaw;
    const f = FOCUS[TABS.find((t) => t.id === tab)?.focus ?? 'body'];
    camPos.lerp(f.pos, 1 - Math.exp(-dt * 6));
    camLook.lerp(f.look, 1 - Math.exp(-dt * 6));
    camera.position.copy(camPos);
    camera.lookAt(camLook);
    wave = Math.max(0, wave - dt);
    char?.update(dt, { speed: 0, t: now / 1000, action: wave > 0 ? 'saludo' : null });
    renderer.render(scene, camera);
  }

  // girar arrastrando
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, t: performance.now() };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const now = performance.now();
    yaw += dx * 0.012;
    yawVel = (dx * 0.012) / Math.max(0.016, (now - drag.t) / 1000);
    drag = { x: e.clientX, t: now };
  });
  const endDrag = () => (drag = null);
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  $('creator-rot-l').addEventListener('click', () => { yawVel = -5; });
  $('creator-rot-r').addEventListener('click', () => { yawVel = 5; });

  // ---------- controles ----------
  function apply(patch) {
    look = normalizeLook({ ...look, ...patch, v: 2 });
    look.real = normalizeReal(catalog, look.real);
    char?.setLook(look);
    audio?.ui?.();
    renderPanel();
  }

  /** Cambia una pieza realista (sexo, edad, pelo, barba, ropa, calzado) */
  const applyReal = (patch) => apply({ real: normalizeReal(catalog, { ...look.real, ...patch }) });

  function realChips(field, opts) {
    return el('div', { class: 'cr-chips', role: 'group', 'aria-label': field },
      opts.map((o) => el('button', {
        type: 'button',
        class: 'cr-chip',
        'aria-pressed': String(look.real[field] === o.id),
        onclick: () => applyReal({ [field]: o.id }),
      }, o.label)));
  }

  /** ¿La apariencia actual es este estilo de calle? (con sus piezas aún no exportadas ya corregidas) */
  const isPreset = (preset) => {
    const real = normalizeReal(catalog, preset.look.real);
    const same = (a = [], b = []) => a.length === b.length && a.every((id) => b.includes(id));
    return Object.entries(real).every(([part, id]) => look.real[part] === id)
      && same(preset.look.accesorios, look.accesorios)
      && ['piel', 'peloColor', 'desgaste'].every((k) => look[k] === preset.look[k]);
  };

  function accessoryChips() {
    return el('div', { class: 'cr-chips', role: 'group', 'aria-label': 'Accesorios' },
      ACCESSORIES.map((a) => {
        const on = look.accesorios.includes(a.id);
        return el('button', {
          type: 'button',
          class: 'cr-chip',
          'aria-pressed': String(on),
          onclick: () => apply({ accesorios: on ? look.accesorios.filter((id) => id !== a.id) : [...look.accesorios, a.id] }),
        }, a.label);
      }));
  }

  function presetChips() {
    return el('div', { class: 'cr-chips', role: 'group', 'aria-label': 'Estilo de calle' },
      STREET_PRESETS.map((preset) => el('button', {
        type: 'button',
        class: 'cr-chip',
        title: preset.desc,
        'aria-pressed': String(isPreset(preset)),
        onclick: () => { apply(applyStreetPreset(look, preset)); wave = 1.2; },
      }, preset.label)));
  }

  const section = (title, ...children) => el('section', { class: 'cr-section' }, el('h3', { class: 'cr-section__title', text: title }), ...children);

  function chips(field, opts) {
    return el('div', { class: 'cr-chips', role: 'group', 'aria-label': field },
      opts.map((o) => el('button', {
        type: 'button',
        class: 'cr-chip',
        'aria-pressed': String(look[field] === o.id),
        onclick: () => apply({ [field]: o.id }),
      }, o.label)));
  }

  function swatches(field, palette, label, names = []) {
    return el('div', { class: 'cr-swatches', role: 'group', 'aria-label': label },
      palette.map((c, i) => el('button', {
        type: 'button',
        class: 'swatch',
        style: `--c:${c}`,
        'aria-label': `${label}: ${names[i] ?? i + 1}`,
        title: names[i] ?? '',
        'aria-pressed': String(look[field] === i),
        onclick: () => apply({ [field]: i }),
      })));
  }

  function renderPanel() {
    const L = look;
    let body;
    switch (tab) {
      case 'identidad': {
        const input = el('input', {
          type: 'text',
          class: 'cr-input',
          id: 'cr-name',
          maxlength: '16',
          autocomplete: 'off',
          spellcheck: 'false',
          placeholder: 'Ej: Jairo, Luz Dary…',
          value: L.nombre,
        });
        input.addEventListener('input', () => { look.nombre = cleanName(input.value); });
        input.addEventListener('change', () => { input.value = look.nombre; });
        body = [
          section('Nombre',
            el('div', { class: 'cr-name' },
              input,
              el('button', {
                type: 'button',
                class: 'cr-icon-btn',
                'aria-label': 'Sugerir un nombre',
                onclick: () => {
                  look.nombre = NAME_IDEAS[Math.floor(Math.random() * NAME_IDEAS.length)];
                  input.value = look.nombre;
                  audio?.ui?.();
                },
              }, icon('dice', { size: 20 }))),
            el('p', { class: 'cr-help', text: 'Así te van a llamar en la cuadra. Máximo 16 letras.' })),
          section('¿Cómo llegaste a la calle?',
            chips('origen', Object.entries(ORIGINS).map(([id, o]) => ({ id, label: o.name }))),
            el('p', { class: 'cr-help', text: ORIGINS[L.origen]?.desc ?? '' })),
        ];
        break;
      }
      case 'estilo': {
        const active = STREET_PRESETS.find(isPreset);
        body = [
          section('Estilo de calle', presetChips(),
            el('p', { class: 'cr-help', text: active?.desc ?? 'Elige un estilo y ajústalo a tu gusto en las otras pestañas.' })),
          section('Desgaste', chips('desgaste', WEAR_LEVELS),
            el('p', { class: 'cr-help', text: 'Qué tanto se nota la calle en la ropa y la piel.' })),
        ];
        break;
      }
      case 'cuerpo':
        body = [
          section('Sexo', realChips('sexo', SEXOS)),
          section('Edad', realChips('edad', EDADES)),
          section('Piel', swatches('piel', PALETTES.piel, 'Tono de piel', COLOR_NAMES.piel)),
        ];
        break;
      case 'pelo':
        body = [
          section('Corte', realChips('pelo', optionsFor(catalog, 'pelo', L.real.sexo))),
          section('Color', swatches('peloColor', PALETTES.pelo, 'Color de pelo', COLOR_NAMES.pelo),
            el('p', { class: 'cr-help', text: 'Las cejas y la barba toman el color del pelo.' })),
        ];
        break;
      case 'cara':
        body = L.real.sexo === 'hombre'
          ? [section('Barba', realChips('barba', optionsFor(catalog, 'barba', 'hombre')))]
          : [section('Barba', el('p', { class: 'cr-help', text: 'No aplica para este personaje.' }))];
        break;
      case 'ropa': {
        const hats = optionsFor(catalog, 'cabeza', L.real.sexo);
        body = [
          section('Ropa', realChips('ropa', optionsFor(catalog, 'ropa', L.real.sexo))),
          section('Calzado', realChips('calzado', optionsFor(catalog, 'calzado', L.real.sexo))),
          hats.length > 1 && section('Cabeza', realChips('cabeza', hats)),
          section('Accesorios', accessoryChips()),
        ];
        break;
      }
      default:
        body = [];
    }
    const scroll = panel.scrollTop;
    panel.replaceChildren(...body.filter(Boolean));
    panel.scrollTop = scroll;
    tabsEl.querySelectorAll('.cr-tab').forEach((b) => {
      const on = b.dataset.tab === tab;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    });
  }

  tabsEl.replaceChildren(...TABS.map((t) => el('button', {
    type: 'button',
    class: 'cr-tab',
    role: 'tab',
    id: `cr-tab-${t.id}`,
    'data-tab': t.id,
    'aria-controls': 'creator-panel',
    onclick: () => { tab = t.id; panel.scrollTop = 0; renderPanel(); },
  }, icon(t.ic, { size: 20 }), el('span', { text: t.label }))));
  tabsEl.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const i = TABS.findIndex((t) => t.id === tab);
    const n = (i + (e.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length;
    tab = TABS[n].id;
    renderPanel();
    tabsEl.querySelector(`[data-tab="${tab}"]`)?.focus();
  });

  setIcon($('creator-close'), 'x');
  setIcon($('creator-rot-l'), 'rotl', { size: 20 });
  setIcon($('creator-rot-r'), 'rotr', { size: 20 });
  $('creator-random').prepend(icon('dice', { size: 18 }));
  $('creator-random').addEventListener('click', () => {
    look = randomLook({ ...look, nombre: look.nombre, origen: look.origen });
    look.real = randomReal(catalog);
    char?.setLook(look);
    wave = 1.2;
    audio?.ui?.();
    renderPanel();
  });

  function close(result) {
    cancelAnimationFrame(raf);
    root.hidden = true;
    const r = resolver;
    resolver = null;
    r?.(result);
  }
  $('creator-close').addEventListener('click', () => close(null));
  $('creator-done').addEventListener('click', () => {
    if (!look.nombre) {
      tab = 'identidad';
      renderPanel();
      const input = $('cr-name');
      input?.focus();
      input?.classList.add('is-error');
      $('creator-error').hidden = false;
      return;
    }
    close({ ...look });
  });
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(null); }
  });

  return {
    /** Abre el editor. Devuelve una promesa con la apariencia elegida (o null si se cancela). */
    async open(current, { doneLabel = 'Listo', onReady = () => {} } = {}) {
      window.__game?.cameraRig?.releaseControls?.();
      catalog ??= await loadCatalog();
      look = normalizeLook(current);
      look.real = normalizeReal(catalog, look.real);
      initial = { ...look };
      void initial;
      tab = look.nombre ? 'cuerpo' : 'identidad';
      if (!renderer) setupScene();
      else char?.setLook(look);
      yaw = 0.35;
      yawVel = 0;
      wave = 1.4;
      $('creator-done').textContent = doneLabel;
      $('creator-error').hidden = true;
      root.hidden = false;
      renderPanel();
      onReady();
      last = performance.now();
      raf = requestAnimationFrame(loop);
      tabsEl.querySelector(`[data-tab="${tab}"]`)?.focus({ preventScroll: true });
      return await new Promise((r) => { resolver = r; });
    },
    get isOpen() { return !root.hidden; },
  };
}
