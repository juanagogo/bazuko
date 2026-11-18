// src/ui/MissionsModal.js
// Panel modal para consultar las misiones diarias de supervivencia en Bogotá.
import { el, button } from './dom.js';
import { icon } from './icons.js';
import { cop } from '../utils/money.js';

export function openMissionsModal(game) {
  if (!game || game._deathPending || game._loading || game.isSleeping || game.player?.isStunned || game.creator?.isOpen) return;
  if (typeof document !== 'undefined' && document.pointerLockElement) {
    try { document.exitPointerLock(); } catch { /* sin pointer lock */ }
  }

  const missionsSys = game.dailyMissions;
  if (!missionsSys) return;

  const render = () => {
    const missions = missionsSys.missions ?? [];
    const day = game.clock?.day ?? 1;
    const completedCount = missions.filter((m) => m.completed).length;

    const summaryText = el('p', {
      class: 'missions-summary-text',
      text: `${completedCount} de ${missions.length} misiones completadas hoy. Se renuevan cada medianoche.`
    });

    const missionCards = missions.length
      ? el('div', { class: 'missions-cards-grid' }, missions.map((m) => {
          const isDone = m.completed;
          const pct = Math.round(Math.min(1, (m.progress || 0) / (m.target || 1)) * 100);

          const head = el('div', { class: 'missions-card-head' },
            el('strong', { class: 'missions-card-title', text: m.title }),
            el('span', {
              class: `missions-card-badge${isDone ? ' chulo' : ''}`,
              text: isDone ? 'Completada' : 'En curso'
            })
          );

          const desc = el('p', { class: 'missions-card-desc', text: m.desc });

          const bar = el('div', { class: 'pause-meter' },
            el('div', { class: 'pause-meter__fill masa', style: `width:${pct}%` })
          );

          const foot = el('div', { class: 'missions-card-foot' },
            el('span', { class: 'missions-card-prog cifra', text: `${m.progress} de ${m.target} (${pct} %)` }),
            el('span', { class: 'missions-card-reward', text: `+${cop(m.reward?.dinero ?? 0)} y +${m.reward?.animo ?? 0} de ánimo` })
          );

          return el('div', { class: `missions-card${isDone ? ' is-done' : ''}` }, head, desc, bar, foot);
        }))
      : el('p', { class: 'empty', text: 'No hay misiones disponibles por hoy.' });

    const body = el('div', { class: 'missions-modal-body' }, summaryText, missionCards);

    const foot = [
      el('span', { class: 'menu__money', text: `Día ${day}` }),
      button('Cerrar', {
        primary: true,
        onClick: () => game.menu.close()
      })
    ];

    return { body, foot, dato: [el('span', { class: 'menu__money', text: `Día ${day}` })] };
  };

  game._missionsModalOpen = true;
  game.menu.open({
    title: 'Misiones del día',
    sub: 'Supervivencia diaria en Bogotá: cumpla tareas para ganar plata, experiencia y ánimo.',
    ic: 'pin',
    render,
    onClose: () => {
      game._missionsModalOpen = false;
    }
  });
}
