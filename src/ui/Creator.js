// src/ui/Creator.js — portado de rebusque; la vista previa y las opciones son del personaje realista
import * as THREE from 'three';
import { PALETTES, COLOR_NAMES, NAME_IDEAS, WEAR_LEVELS, ACCESSORIES, normalizeLook, randomLook, cleanName } from '../character/look.js';
import { STREET_PRESETS, applyStreetPreset } from '../character/presets.js';
import { garmentAllowed } from '../character/archetypes.js';
import { createRealisticCharacter, loadCatalog, optionsFor, normalizeReal, randomReal } from '../character/RealisticCharacter.js';
import { ORIGINS } from '../data/origins.js';
import { el } from './dom.js';
import { icon, setIcon } from './icons.js';
import { LETRA } from './letra.js';
import { marcaQuieta } from './LoadingScreen.js';

const $ = (id) => document.getElementById(id);

const TABS = [
  { id: 'identidad', label: 'Nombre', focus: 'body' },
  { id: 'estilo', label: 'Estilo', focus: 'body' },
  { id: 'cuerpo', label: 'Cuerpo', focus: 'body' },
  { id: 'pelo', label: 'Pelo', focus: 'face' },
  { id: 'cara', label: 'Barba', focus: 'face' },
  { id: 'ropa', label: 'Ropa', focus: 'body' },
];

const SEXOS = [{ id: 'hombre', label: 'Hombre' }, { id: 'mujer', label: 'Mujer' }];
const EDADES = [{ id: 'joven', label: 'Joven' }, { id: 'adulto', label: 'Adulto' }, { id: 'mayor', label: 'Mayor' }];
const NOMBRES_DE_GRUPO = { sexo: 'Sexo', edad: 'Edad', pelo: 'Corte', barba: 'Barba', ropa: 'Ropa', calzado: 'Calzado', cabeza: 'Cabeza', origen: '¿Cómo llegó a la calle?', desgaste: 'Desgaste' };
const LETRA_NOMBRE = { mayor: 40, menor: 16 };

/** Mide cuánto se puede dejar la letra del nombre para que quepa entero, sin cortarlo: 16 W tienen que verse. */
export function letraParaNombre(texto, ancho, medir, { mayor, menor } = LETRA_NOMBRE) {
  const base = medir(texto || 'Ej: Jairo, Luz Dary…', mayor);
  if (base <= ancho) return mayor;
  return Math.max(menor, Math.floor(mayor * ancho / base));
}

/** La sombra del personaje, a marcador: rayas dentro de un óvalo, sobre el cartón. No se mueve, no cuesta luces. */
function sombraDibujada() {
  const lienzo = document.createElement('canvas');
  lienzo.width = 512; lienzo.height = 256;
  const c = lienzo.getContext('2d');
  c.strokeStyle = '#14110C';
  c.lineCap = 'round';
  c.lineWidth = 9;
  c.beginPath();
  for (let x = -120, i = 0; x < 640; x += 24, i++) {
    const dentro = (y) => Math.max(0, 1 - ((x + (128 - y) * .55 - 256) / 236) ** 2 - ((y - 128) / 116) ** 2);
    let ini = null, fin = null;
    for (let y = 8; y <= 248; y += 4) if (dentro(y) > 0) { ini ??= y; fin = y; }
    if (ini === null) continue;
    const corre = (i * 37 % 11) - 5; // la mano no empareja las puntas
    c.moveTo(x + (128 - ini - corre) * .55, ini + corre);
    c.lineTo(x + (128 - fin + corre) * .55, fin - corre);
  }
  c.stroke();
  const textura = new THREE.CanvasTexture(lienzo);
  textura.colorSpace = THREE.SRGBColorSpace;
  const sombra = new THREE.Mesh(new THREE.PlaneGeometry(1.5, .75), new THREE.MeshBasicMaterial({ map: textura, transparent: true, opacity: .82, toneMapped: false, depthWrite: false }));
  sombra.rotation.x = -Math.PI / 2;
  sombra.position.set(.12, .002, .02);
  return sombra;
}

/**
 * Editor "Crea tu personaje": vista 3D propia (se gira arrastrando, la cámara
 * se acerca a la cara en Cara/Pelo/Accesorios) y opciones por categoría.
 */
export function createCreator({ audio }) {
  const root = $('creator-modal');
  const canvas = $('creator-canvas');
  const panel = $('creator-panel');
  const tabsEl = $('creator-tabs');
  const espera = $('creator-wait');
  const error = $('creator-error');
  let volverA = null;
  let renderer = null;
  let scene, camera, char = null, raf = 0;
  let catalog = null;
  let look = null;
  let tab = 'identidad';
  let resolver = null;
  let yaw = 0.35, yawVel = 0;
  let wave = 0;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const viewport = { width: 0, height: 0, pixelRatio: 0 };
  const camPos = new THREE.Vector3(0, 1.2, 4.2);
  const camLook = new THREE.Vector3(0, 0.8, 0);
  const FOCUS = {
    body: { pos: new THREE.Vector3(0, 1.1, 3.9), look: new THREE.Vector3(0, 0.86, 0) },
    face: { pos: new THREE.Vector3(0, 1.6, 1.5), look: new THREE.Vector3(0, 1.52, 0) },
  };

  function setupScene() {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
    // Luz pareja de cartón: el personaje se para sobre la pieza, no en una ventana a otro lugar.
    scene.add(new THREE.HemisphereLight('#fff1d8', '#7d5f38', 2.1));
    const key = new THREE.DirectionalLight('#fff0d6', 2.3);
    key.position.set(2.2, 4, 3.4);
    scene.add(key);
    const rim = new THREE.DirectionalLight('#ffe3b8', .9);
    rim.position.set(-3, 2.5, -2);
    scene.add(rim);
    scene.add(sombraDibujada());
    const lookInicial = look;
    createRealisticCharacter(look).then((c) => {
      char = c;
      char.group.scale.setScalar(1);
      scene.add(char.group);
      if (look !== lookInicial) char.setLook(look);
    }).catch((causa) => {
      console.error('[Creador]', causa);
      espera.textContent = 'No se pudo mostrar el personaje. Se puede seguir igual.';
      return false;
    }).then((seguir) => {
      if (seguir !== false) espera.hidden = true;
    });
  }

  function resize() {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const width = Math.round(r.width), height = Math.round(r.height);
    const pixelRatio = Math.min(1.75, window.devicePixelRatio || 1);
    if (viewport.width === width && viewport.height === height && viewport.pixelRatio === pixelRatio) return;
    Object.assign(viewport, { width, height, pixelRatio });
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    ajustarNombre();
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
    const cameraBlend = reducedMotion.matches ? 1 : 1 - Math.exp(-dt * 6);
    camPos.lerp(f.pos, cameraBlend);
    camLook.lerp(f.look, cameraBlend);
    camera.position.copy(camPos);
    camera.lookAt(camLook);
    wave = Math.max(0, wave - dt);
    char?.update(reducedMotion.matches ? 0 : dt, { speed: 0, t: reducedMotion.matches ? 0 : now / 1000, action: !reducedMotion.matches && wave > 0 ? 'saludo' : null });
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
    yawVel = reducedMotion.matches ? 0 : (dx * 0.012) / Math.max(0.016, (now - drag.t) / 1000);
    drag = { x: e.clientX, t: now };
  });
  const endDrag = () => (drag = null);
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  const rotate = (direction) => {
    if (reducedMotion.matches) yaw += direction * Math.PI / 4;
    else yawVel = direction * 5;
  };
  $('creator-rot-l').addEventListener('click', () => rotate(-1));
  $('creator-rot-r').addEventListener('click', () => rotate(1));

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

  /** Elegir es círculo rojo a mano; `clave` deja volver a este botón después de redibujar el panel. */
  const chip = (clave, label, on, onclick, title = null) => el('button', {
    type: 'button',
    class: on ? 'cr-chip elegido' : 'cr-chip',
    'data-clave': clave,
    title,
    'aria-pressed': String(on),
    onclick,
  }, label);

  function realChips(field, opts) {
    return el('div', { class: 'cr-chips', role: 'group', 'aria-label': NOMBRES_DE_GRUPO[field] ?? field },
      opts.map((o) => chip(`${field}:${o.id}`, o.label, look.real[field] === o.id, () => applyReal({ [field]: o.id }))));
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
        return chip(`accesorio:${a.id}`, a.label, on, () => apply({ accesorios: on ? look.accesorios.filter((id) => id !== a.id) : [...look.accesorios, a.id] }));
      }));
  }

  function presetChips() {
    return el('div', { class: 'cr-chips', role: 'group', 'aria-label': 'Estilo de calle' },
      STREET_PRESETS.map((preset) => chip(`estilo:${preset.label}`, preset.label, isPreset(preset), () => { apply(applyStreetPreset(look, preset)); wave = 1.2; }, preset.desc)));
  }

  const section = (title, ...children) => el('section', { class: 'cr-section' }, el('h3', { class: 'cr-section__title', text: title }), ...children);

  function chips(field, opts) {
    return el('div', { class: 'cr-chips', role: 'group', 'aria-label': NOMBRES_DE_GRUPO[field] ?? field },
      opts.map((o) => chip(`${field}:${o.id}`, o.label, look[field] === o.id, () => apply({ [field]: o.id }))));
  }

  function swatches(field, palette, label, names = []) {
    return el('div', { class: 'cr-swatches', role: 'group', 'aria-label': label },
      palette.map((c, i) => el('button', {
        type: 'button',
        class: look[field] === i ? 'swatch elegido' : 'swatch',
        'data-clave': `${field}:${i}`,
        style: `--c:${c}`,
        'aria-label': `${label}: ${names[i] ?? i + 1}`,
        title: names[i] ?? '',
        'aria-pressed': String(look[field] === i),
        onclick: () => apply({ [field]: i }),
      })));
  }

  /** La letra del nombre baja lo justo para que quepa: 16 W no se cortan. */
  function ajustarNombre() {
    const input = $('cr-name');
    if (!input?.clientWidth) return;
    const ctx = (ajustarNombre.ctx ??= document.createElement('canvas').getContext('2d'));
    const medir = (texto, px) => { ctx.font = `800 ${px}px ${LETRA}`; return ctx.measureText(texto).width; };
    input.style.fontSize = `${letraParaNombre(input.value, input.clientWidth - 8, medir)}px`;
  }

  function limpiarError() {
    error.hidden = true;
    const input = $('cr-name');
    input?.classList.remove('is-error');
    input?.removeAttribute('aria-invalid');
    input?.removeAttribute('aria-describedby');
  }

  function renderPanel() {
    const L = look;
    const foco = document.activeElement;
    const volver = panel.contains(foco) ? foco.dataset.clave : null;
    let body;
    switch (tab) {
      case 'identidad': {
        const input = el('input', {
          type: 'text',
          class: 'cr-input',
          id: 'cr-name',
          'aria-label': 'Nombre del personaje',
          maxlength: '16',
          autocomplete: 'off',
          spellcheck: 'false',
          placeholder: 'Ej: Jairo, Luz Dary…',
          value: L.nombre,
        });
        input.addEventListener('input', () => {
          look.nombre = cleanName(input.value);
          if (look.nombre) limpiarError();
          ajustarNombre();
        });
        input.addEventListener('change', () => { input.value = look.nombre; });
        body = [
          section('Así me van a decir en la cuadra',
            el('div', { class: 'cr-name' },
              input,
              el('button', {
                type: 'button',
                class: 'cinta cr-icon-btn',
                'aria-label': 'Sugerir un nombre',
                onclick: () => {
                  look.nombre = NAME_IDEAS[Math.floor(Math.random() * NAME_IDEAS.length)];
                  input.value = look.nombre;
                  limpiarError();
                  ajustarNombre();
                  audio?.ui?.();
                },
              }, icon('dice', { size: 20 }))),
            el('p', { class: 'cr-help', text: 'Máximo 16 letras.' })),
          section('¿Cómo llegó a la calle?',
            chips('origen', Object.entries(ORIGINS).map(([id, o]) => ({ id, label: o.name }))),
            el('p', { class: 'cr-help', text: ORIGINS[L.origen]?.relato ?? '' }),
            el('p', { class: 'cr-help cr-efecto', text: ORIGINS[L.origen]?.efecto ?? '' })),
        ];
        break;
      }
      case 'estilo': {
        const active = STREET_PRESETS.find(isPreset);
        body = [
          section('Estilo de calle', presetChips(),
            el('p', { class: 'cr-help', text: active?.desc ?? 'Elija un estilo y ajústelo a su gusto en las otras pestañas.' })),
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
          section('Ropa', realChips('ropa', optionsFor(catalog, 'ropa', L.real.sexo).filter((o) => garmentAllowed(o.id, L.real.edad)))),
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
    // Redibujar no puede botar el foco de quien usa teclado o mando.
    if (volver) panel.querySelector(`[data-clave="${volver}"]`)?.focus({ preventScroll: true });
    tabsEl.querySelectorAll('.cr-tab').forEach((b) => {
      const on = b.dataset.tab === tab;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      b.firstElementChild.classList.toggle('elegido', on);
    });
    panel.setAttribute('aria-labelledby', `cr-tab-${tab}`);
    ajustarNombre();
  }

  tabsEl.replaceChildren(...TABS.map((t) => el('button', {
    type: 'button',
    class: 'cr-tab',
    role: 'tab',
    id: `cr-tab-${t.id}`,
    'data-tab': t.id,
    'aria-controls': 'creator-panel',
    onclick: () => { tab = t.id; panel.scrollTop = 0; renderPanel(); },
  }, el('span', { text: t.label }))));
  tabsEl.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const i = TABS.findIndex((t) => t.id === tab);
    const n = (i + (e.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length;
    tab = TABS[n].id;
    panel.scrollTop = 0;
    renderPanel();
    tabsEl.querySelector(`[data-tab="${tab}"]`)?.focus();
  });

  root.querySelector('.creator__marca').innerHTML = marcaQuieta();
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
    if (volverA?.isConnected) volverA.focus?.({ preventScroll: true });
    volverA = null;
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
      input?.setAttribute('aria-invalid', 'true');
      input?.setAttribute('aria-describedby', 'creator-error');
      error.hidden = false;
      return;
    }
    close({ ...look });
  });
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(null); return; }
    if (e.key !== 'Tab') return;
    // Es un diálogo: el foco no se sale a lo que está debajo.
    const botones = [...root.querySelectorAll('button:not([disabled]), input, [tabindex="0"]')].filter((b) => b.offsetParent !== null && b.tabIndex >= 0);
    const primero = botones[0], ultimo = botones[botones.length - 1];
    if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo.focus(); }
    else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus(); }
  });

  return {
    /** Abre el editor. Devuelve una promesa con la apariencia elegida (o null si se cancela). */
    async open(current, { doneLabel = 'Listo', onReady = () => {} } = {}) {
      window.__game?.cameraRig?.releaseControls?.();
      volverA = document.activeElement;
      catalog ??= await loadCatalog();
      look = normalizeLook(current);
      look.real = normalizeReal(catalog, look.real);
      tab = look.nombre ? 'cuerpo' : 'identidad';
      if (!renderer) setupScene();
      else char?.setLook(look);
      yaw = 0.35;
      yawVel = 0;
      wave = 1.4;
      $('creator-done').textContent = doneLabel;
      error.hidden = true;
      root.hidden = false;
      renderPanel();
      onReady();
      last = performance.now();
      raf = requestAnimationFrame(loop);
      // Sin nombre, con teclado, se escribe de una; en el celular no se abre el teclado sin que lo pidan.
      const paraEscribir = tab === 'identidad' && window.matchMedia('(pointer: fine)').matches ? $('cr-name') : null;
      (paraEscribir ?? tabsEl.querySelector(`[data-tab="${tab}"]`))?.focus({ preventScroll: true });
      return await new Promise((r) => { resolver = r; });
    },
    get isOpen() { return !root.hidden; },
  };
}
