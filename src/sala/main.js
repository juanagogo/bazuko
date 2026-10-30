// src/sala/main.js
// Arranque de sala.html: monta la prueba de ?prueba=<id> y el panel de botones.
import { Sala } from './Sala.js';
import { PRUEBAS } from './pruebas.js';

const $ = (id) => document.getElementById(id);

function button(text, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = text;
  b.addEventListener('click', () => { onClick(); b.blur(); }); // sin foco: el espacio y las letras siguen moviendo
  return b;
}

/** Fila de botones excluyentes; marca el elegido */
function choice(container, options, current, onPick) {
  const row = document.createElement('div');
  row.className = 'sala-fila';
  for (const [value, text] of options) {
    const b = button(text, () => {
      for (const other of row.children) other.setAttribute('aria-pressed', String(other === b));
      onPick(value);
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

const select = $('sala-prueba');
for (const p of PRUEBAS) select.append(new Option(p.nombre, p.id, false, p === prueba));
select.addEventListener('change', () => { location.search = `?prueba=${select.value}`; });
$('sala-descripcion').textContent = prueba.descripcion;
showToasts();

const sala = new Sala($('sala-canvas'));
sala.steal = { buscado: 0 };  // lo sube pelear con peatones
window.__sala = sala;

let modelo = 'realista';
try {
  // la sala recuerda su propio modelo; la primera vez arranca con el del juego
  const saved = localStorage.getItem('bazuko.sala.modelo') ?? localStorage.getItem('bazuko.modelo');
  modelo = saved === 'procedural' ? 'procedural' : 'realista';
} catch { /* sin almacenamiento */ }
await sala.loadSavedLook();
await sala.setModel(modelo);
const montada = await prueba.montar(sala) ?? {};
sala.start();

const acciones = $('sala-acciones');
const row = document.createElement('div');
row.className = 'sala-fila';
for (const a of montada.acciones ?? []) row.append(button(a.texto, a.hacer));
acciones.append(row);

const generales = $('sala-generales');
choice(generales, [['realista', 'Realista'], ['procedural', 'Liviano']], modelo, (kind) => sala.setModel(kind));
choice(generales, [[1, 'x1'], [5, 'x5'], [30, 'x30']], 1, (k) => { sala.timeScale = k; });
choice(generales, [[13, '☀ Día'], [22, '🌙 Noche']], sala.hour, (h) => sala.setHour(h));
const extra = document.createElement('div');
extra.className = 'sala-fila';
extra.append(button('Volver al centro', () => sala.resetPlayer()));
generales.append(extra);

const estado = $('sala-estado');
setInterval(() => { estado.textContent = montada.estado?.() ?? ''; }, 200);
