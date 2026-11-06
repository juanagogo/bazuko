// src/ui/TrucosPanel.js
// La pestaña Trucos de la pausa y la marca que avisa que están prendidos.
import { el, button } from './dom.js';
import { choice, section, row } from './pauseParts.js';
import { HORAS_TRUCO, VELOCIDAD_NORMAL, VELOCIDAD_RAPIDA, DINERO_TRUCO } from '../core/trucos.js';
import { WEATHER_TYPES } from '../world/Climate.js';
import { cop } from '../utils/money.js';

/** Aviso permanente de que la partida no es la normal. */
export function montarMarcaTrucos(doc = globalThis.document) {
  if (doc.getElementById('trucos-marca')) return;
  const marca = el('div', { id: 'trucos-marca', class: 'trucos-marca', text: 'Trucos' });
  (doc.getElementById('app') ?? doc.body).append(marca);
}

export function trucosPanel(game) {
  const cheats = game.cheats;
  const refrescar = () => game.menu?.refresh?.();
  const accion = (label, onClick) => el('div', { class: 'pause-actions' }, button(label, { onClick }));
  const alternar = (label, on, set) => choice(label, on, () => { set(!on); refrescar(); });

  return el('div', {},
    el('p', { class: 'pause-hint', text: 'Modo de prueba: mientras esté prendido la partida no se guarda.' }),

    section('heart', 'Necesidades',
      row('Al máximo', el('div', { class: 'pause-segmented', role: 'group', 'aria-label': 'Necesidades al máximo' },
        alternar('Fijas', cheats.necesidades, (v) => cheats.setNecesidades(v)))),
      accion('Llenar todo', () => { cheats.llenarTodo(); refrescar(); })),

    section('coins', 'Plata',
      accion(`Dar ${cop(DINERO_TRUCO)}`, () => { cheats.darDinero(); refrescar(); })),

    section('backpack', 'Costal',
      accion('Todo el catálogo y los materiales', () => { cheats.darObjetos(); refrescar(); }),
      el('p', { class: 'pause-hint', text: 'Llena el costal sin construir ni mejorar el cambuche.' })),

    section('tent', 'Cambuche',
      accion('Construir y mejorar todo', () => { cheats.construirCambuche(); refrescar(); })),

    section('alert', 'Policía',
      row('Fichas', accion('Ponerlas en cero', () => { cheats.calmarPolicia(); refrescar(); })),
      row('Incógnito', el('div', { class: 'pause-segmented', role: 'group', 'aria-label': 'Invisible a la policía' },
        alternar('Invisible', cheats.invisible, (v) => cheats.setInvisible(v)))),
      row('Invulnerable', el('div', { class: 'pause-segmented', role: 'group', 'aria-label': 'Invulnerable' },
        alternar('Sin daño', cheats.invulnerable, (v) => cheats.setInvulnerable(v))))),

    section('clock', 'Reloj',
      row('Saltar a', el('div', { class: 'pause-segmented', role: 'group', 'aria-label': 'Saltar la hora' },
        HORAS_TRUCO.map(([hour, label]) => choice(label, false, () => { cheats.ponerHora(hour); refrescar(); })))),
      row('Velocidad', el('div', { class: 'pause-segmented', role: 'group', 'aria-label': 'Velocidad del tiempo' },
        choice('Normal', cheats.velocidad === VELOCIDAD_NORMAL, () => { cheats.setVelocidad(VELOCIDAD_NORMAL); refrescar(); }),
        choice('Rápido (10x)', cheats.velocidad === VELOCIDAD_RAPIDA, () => { cheats.setVelocidad(VELOCIDAD_RAPIDA); refrescar(); })))),

    section('rain', 'Clima',
      el('div', { class: 'pause-segmented', role: 'group', 'aria-label': 'Clima' },
        Object.entries(WEATHER_TYPES).map(([id, { label }]) => choice(label, game.weather?.weather === id,
          () => { cheats.ponerClima(id); refrescar(); })))),

    section('pin', 'Viaje',
      el('div', { class: 'pause-actions' }, cheats.destinos().map((destino) =>
        button(destino.name, { onClick: () => { cheats.teletransportar(destino); refrescar(); } })))));
}
