// src/sala/main.js
// Arranque de sala.html: monta la prueba de ?prueba=<id> y el panel de botones.
import { Sala } from './Sala.js';
import { PRUEBAS } from './pruebas.js';
import { streetWetness } from '../character/streetMaterials.js';

const $ = (id) => document.getElementById(id);
const setText = (id, value) => { if ($(id).textContent !== value) $(id).textContent = value; };

function showError(error) {
  $('sala-error').textContent = `${error.message ?? error} Puedes recargar para reintentar.`;
  $('sala-error').hidden = false;
}

function button(text, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = text;
  b.addEventListener('click', async e => {
    try { await onClick(); } catch (error) { showError(error); }
    if (e.detail > 0) b.blur();
  });
  const keepActivation = e => { if (e.code === 'Space' || e.code === 'Enter') e.stopPropagation(); };
  b.addEventListener('keydown', keepActivation);
  b.addEventListener('keyup', keepActivation);
  return b;
}

/** Fila de botones excluyentes; marca el elegido */
function choice(container, options, current, onPick) {
  const row = document.createElement('div');
  row.className = 'sala-fila';
  for (const [value, text] of options) {
    const b = button(text, async () => {
      await onPick(value);
      for (const other of row.children) other.setAttribute('aria-pressed', String(other === b));
    });
    b.setAttribute('aria-pressed', String(value === current));
    row.append(b);
  }
  container.append(row);
}

function showToasts() {
  window.addEventListener('toast', (e) => {
    const el = document.createElement('div');
    el.textContent = e.detail?.text ?? '';
    $('sala-toasts').append(el);
    setTimeout(() => el.remove(), 3000);
  });
}

const params = new URLSearchParams(location.search);
const prueba = PRUEBAS.find((p) => p.id === params.get('prueba')) ?? PRUEBAS[0];
const animaciones = params.get('animaciones') === 'mixamo-preview' ? 'mixamo-preview' : 'default';
const modeloRealista = params.get('aspecto') === 'realista';
function navigateParam(name, value) {
  const url = new URL(location.href);
  if (value === 'default') url.searchParams.delete(name);
  else url.searchParams.set(name, value);
  location.href = url.href;
}

const select = $('sala-prueba');
for (const p of PRUEBAS) select.append(new Option(p.nombre, p.id, false, p === prueba));
select.addEventListener('change', () => navigateParam('prueba', select.value));
$('sala-banco').value = animaciones;
$('sala-banco').addEventListener('change', () => navigateParam('animaciones', $('sala-banco').value));
$('sala-descripcion').textContent = prueba.descripcion;
showToasts();

const sala = new Sala($('sala-canvas'), { animaciones });
sala.steal = { buscado: 0 };  // lo sube pelear con peatones
window.__sala = sala;

let modelo = 'realista';
try {
  // la sala recuerda su propio modelo; la primera vez arranca con el del juego
  const saved = localStorage.getItem('bazuko.sala.modelo') ?? localStorage.getItem('bazuko.modelo');
  modelo = saved === 'procedural' ? 'procedural' : 'realista';
} catch { /* sin almacenamiento */ }
// Un banco importado solo pertenece al modelo con esqueleto; una preferencia
// anterior por el liviano no debe hacerse pasar por una carga Mixamo correcta.
if (animaciones === 'mixamo-preview' || modeloRealista) modelo = 'realista';

// Ropa y piel mojadas: en el juego las moja el clima, aquí se ven de una vez.
$('sala-mojado').addEventListener('click', () => {
  streetWetness.value = streetWetness.value > .5 ? 0 : 1;
  $('sala-mojado').setAttribute('aria-pressed', String(streetWetness.value > .5));
  setText('sala-mojado', streetWetness.value > .5 ? 'Secar' : 'Mojar con lluvia');
});
function setPanelVisible(visible) {
  $('sala-panel').hidden = !visible;
  $('sala-panel-toggle').setAttribute('aria-expanded', String(visible));
  $('sala-panel-toggle').textContent = visible ? 'Ocultar controles' : 'Mostrar controles';
}
$('sala-panel-toggle').addEventListener('click', () => setPanelVisible($('sala-panel').hidden));
function inspectCharacter(detail) {
  sala.frameCharacter(detail);
  if (window.matchMedia('(max-width: 650px)').matches) {
    setPanelVisible(false);
    $('sala-panel-toggle').focus();
  }
}
$('sala-rostro').addEventListener('click', () => inspectCharacter(true));
$('sala-cuerpo').addEventListener('click', () => inspectCharacter(false));

const CLIP_LABELS = { idle: 'Reposo', walk: 'Caminar', run: 'Correr', buscar: 'Buscar', pedir: 'Pedir', comer: 'Comer', beber: 'Beber', saludo: 'Saludo', cagar: 'Agacharse', lanzar: 'Lanzar', dormir: 'Dormir' };
const CLIP_BY_LABEL = Object.fromEntries(Object.entries(CLIP_LABELS).map(([key, label]) => [label, key]));
const PREVIEW_CLIPS = { reposo: 'idle', caminar: 'walk', correr: 'run' };
const actionButtons = [];
function updateAnimationStatus() {
  const character = sala.player.character;
  const status = character.animationStatus;
  const imported = status?.profile === 'mixamo-preview';
  const source = imported ? 'Mixamo + Blender' : status ? 'Actual · andares horneados, ActionForge y poses procedurales' : 'Actual · modelo liviano procedural';
  setText('sala-banco-estado', imported ? `${source} · ${status.clips.length} clips cargados` : source);
  $('sala-banco-estado').dataset.profile = status?.profile ?? 'procedural';
  $('sala-banco-estado').dataset.source = status?.source ?? '';
  setText('sala-clips', imported ? `Clips: ${status.clips.map(name => CLIP_LABELS[name] ?? name).join(', ')}.` : '');
  for (const b of actionButtons) {
    const missing = imported && b.dataset.clip && !status.clips.includes(b.dataset.clip);
    b.disabled = !!missing;
    b.title = missing ? 'Este banco todavía no contiene este clip.' : '';
  }
  const active = sala.animationPreview.name;
  if (imported && CLIP_LABELS[PREVIEW_CLIPS[active] ?? active] && !status.clips.includes(PREVIEW_CLIPS[active] ?? active)) sala.animationPreview.stop();
  const name = sala.animationPreview.name ?? sala.player.action;
  const clip = PREVIEW_CLIPS[name] ?? name;
  const label = CLIP_LABELS[clip] ?? (name ? name[0].toUpperCase() + name.slice(1) : '');
  setText('sala-pose-fuente', imported && name
    ? `${status.clips.includes(clip) ? 'Clip Mixamo' : 'Pose procedural actual'} · ${label}` : '');
}

async function boot() {
  await sala.loadSavedLook();
  await sala.setModel(modelo);
  const montada = await prueba.montar(sala) ?? {};
  sala.start();

  const acciones = $('sala-acciones');
  const row = document.createElement('div');
  row.className = 'sala-fila';
  for (const a of montada.acciones ?? []) {
    const b = button(a.texto, () => { a.hacer(); updateAnimationStatus(); });
    if (prueba.id === 'personaje' && CLIP_BY_LABEL[a.texto]) b.dataset.clip = CLIP_BY_LABEL[a.texto];
    actionButtons.push(b); row.append(b);
  }
  acciones.append(row);

  const generales = $('sala-generales');
  choice(generales, [['realista', 'Realista'], ['procedural', 'Liviano']], modelo, async kind => {
    await sala.setModel(kind);
    $('sala-error').hidden = true;
    updateAnimationStatus();
  });
  choice(generales, [[.25, '0,25×'], [.5, '0,5×'], [1, '1×'], [5, '5×'], [30, '30×']], 1, (k) => { sala.timeScale = k; });
  choice(generales, [[13, '☀ Día'], [22, '🌙 Noche']], sala.hour, (h) => sala.setHour(h));
  const extra = document.createElement('div');
  extra.className = 'sala-fila';
  const pause = button('Pausar', () => {
    sala.paused = !sala.paused;
    pause.textContent = sala.paused ? 'Continuar' : 'Pausar';
    pause.setAttribute('aria-pressed', String(sala.paused));
  });
  pause.setAttribute('aria-pressed', 'false');
  extra.append(pause, button('Un fotograma', () => {
    sala.paused = true; sala.stepRequested = true;
    pause.textContent = 'Continuar'; pause.setAttribute('aria-pressed', 'true');
  }));
  extra.append(button('Volver al centro', () => sala.resetPlayer()));
  generales.append(extra);

  const estado = $('sala-estado');
  updateAnimationStatus();
  setInterval(() => { estado.textContent = montada.estado?.() ?? ''; updateAnimationStatus(); }, 200);
}

try {
  await boot();
} catch (error) {
  $('sala-banco-estado').textContent = 'No se pudo cargar el personaje con el banco seleccionado.';
  $('sala-banco-estado').dataset.profile = 'error';
  sala.player.character.group.visible = false;
  showError(error);
  sala.start();
}
