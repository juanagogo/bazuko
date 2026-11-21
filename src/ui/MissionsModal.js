// src/ui/MissionsModal.js
// Panel modal para consultar las misiones diarias de supervivencia en Bogotá.
import { el, button } from './dom.js';
import { cop } from '../utils/money.js';
import { DELIVERY_FINE, DELIVERY_STRIKE_LIMIT, DELIVERY_TIP } from '../systems/DeliverySystem.js';
import { cuentaAtras } from './formato.js';

function deliveryCard(game, switchRole) {
  const deliveries = game.deliveries;
  if (!deliveries) return null;
  const job = deliveries.job ?? deliveries.offer;
  const actions = [];
  let description;
  if (!deliveries.owned) {
    description = deliveries.suspended ? `Cuenta suspendida. Paga la multa de ${cop(DELIVERY_FINE)} en La Esquinita para recuperar el equipo.`
      : `Compra el maletín de Rappi en La Esquinita para empezar. ${deliveries.purchaseRequirements}`;
    actions.push(button('Marcar La Esquinita', { onClick: () => {
      if (deliveries.equipmentPoi) game.setGpsWaypoint(deliveries.equipmentPoi);
      game.menu.close();
    } }));
  } else if (!deliveries.ready) {
    description = deliveries.order ? 'Pedido en pausa. Ponte el maletín para retomarlo.' : 'Ponte el maletín para recibir pedidos.';
    actions.push(button('Poner maletín', { primary: true, onClick: () => switchRole('rappi') }));
  } else if (job) {
    const { shop, client } = job;
    description = deliveries.order?.pickedUp ? `Entrega pendiente en ${client.name}.`
      : `Recogida en ${shop.name} y entrega en ${client.name}.`;
    if (deliveries.order) {
      actions.push(button('Seguir pedido', { primary: true, onClick: () => { deliveries.markRoute(); game.menu.close(); } }),
        button('Cancelar pedido', { onClick: () => { deliveries.cancel(); game.menu.refresh(); } }));
      if (deliveries.order.pickedUp) actions.push(button('Quedarme con el pedido (+1 falta)', {
        onClick: () => { if (deliveries.keepOrder()) game.menu.refresh(); }
      }));
    } else {
      actions.push(button('Aceptar pedido', { primary: true, onClick: () => { if (deliveries.accept()) game.menu.close(); } }));
    }
  } else description = 'Ahora mismo no hay pedidos disponibles.';
  const left = deliveries.secondsLeft;
  const timer = left === null ? null : left > 0
    ? `${cuentaAtras(left)} para ganar ${cop(DELIVERY_TIP)} de propina.`
    : 'Plazo vencido. La entrega aún paga la tarifa base.';
  return el('section', { class: 'missions-card' },
    el('div', { class: 'missions-card-head' },
      el('strong', { class: 'missions-card-title', text: 'Pedidos de Rappi' }),
      deliveries.owned ? el('span', { class: 'missions-card-badge', text: `${deliveries.completed} entregados` }) : null),
    el('p', { class: 'missions-card-desc', text: description }),
    timer ? el('p', { class: 'missions-card-desc', text: timer }) : job && deliveries.ready
      ? el('p', { class: 'missions-card-desc', text: `Propina de ${cop(DELIVERY_TIP)} por entregar a tiempo. El plazo empieza al recoger.` }) : null,
    deliveries.owned ? el('p', { class: 'missions-card-desc', text: `${deliveries.strikes} de ${DELIVERY_STRIKE_LIMIT} faltas. A la tercera, pierde el equipo y debe pagar ${cop(DELIVERY_FINE)}.` }) : null,
    el('div', { class: 'missions-card-foot' },
      job && deliveries.ready ? el('span', { class: 'missions-card-reward', text: `+${cop(job.pay.cash)}` }) : null,
      ...actions));
}

export function openMissionsModal(game) {
  if (!game || game._deathPending || game._loading || game.isSleeping || game.player?.isStunned || game.creator?.isOpen) return;
  if (typeof document !== 'undefined' && document.pointerLockElement) {
    try { document.exitPointerLock(); } catch { /* sin pointer lock */ }
  }

  const missionsSys = game.dailyMissions;
  if (!missionsSys) return;
  const deliveries = game.deliveries;
  const roles = [['calle', 'Calle'], ['rappi', 'Rappi']];
  const activeRole = () => deliveries?.ready ? 'rappi' : 'calle';
  let selected = activeRole();

  const select = (id, refresh = false) => {
    if (selected !== id || refresh) {
      selected = id;
      game.menu.refresh();
      if (game.menu.bodyEl) game.menu.bodyEl.scrollTop = 0;
    }
    game.menu.tabsEl?.querySelector(`#mission-tab-${id}`)?.focus({ preventScroll: true });
  };
  const switchRole = (id) => {
    if (activeRole() === id || !deliveries.toggleGear('bag')) return;
    select(id, true);
  };

  const tabs = () => el('nav', { class: 'pause-tabs', role: 'tablist', 'aria-label': 'Roles de misión' },
    roles.map(([id, name], index) => {
      const shown = selected === id;
      return el('button', {
        id: `mission-tab-${id}`, type: 'button', role: 'tab', class: `pause-tab${shown ? ' is-active' : ''}`,
        tabindex: shown ? '0' : '-1', 'aria-controls': 'mission-role-panel', 'aria-selected': String(shown),
        onclick: () => select(id),
        onkeydown: event => {
          const next = { ArrowLeft: 1 - index, ArrowRight: 1 - index, Home: 0, End: 1 }[event.key];
          if (next === undefined) return;
          event.preventDefault();
          select(roles[next][0]);
        }
      }, el('span', { class: `pause-tab__palabra${shown ? ' elegido' : ''}`, text: name }));
    }));

  const renderDaily = () => {
    const missions = missionsSys.missions ?? [];
    const completedCount = missions.filter((m) => m.completed).length;
    const paused = activeRole() === 'rappi';

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
              text: isDone ? 'Completada' : paused ? 'En pausa' : 'En curso'
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

    return [paused ? el('p', { class: 'missions-summary-text', text: 'Las misiones de calle están en pausa mientras repartes.' }) : null,
      summaryText, missionCards];
  };

  const render = () => {
    const day = game.clock?.day ?? 1;
    const content = selected === 'rappi' ? [deliveryCard(game, switchRole)] : renderDaily();
    const body = el('section', { class: 'missions-modal-body', id: 'mission-role-panel',
      ...(deliveries ? { role: 'tabpanel', 'aria-labelledby': `mission-tab-${selected}` } : {}) }, content);
    const foot = [
      el('span', { class: 'menu__money', text: `Día ${day}` }),
      deliveries?.ready ? button('Volver a Calle', { onClick: () => switchRole('calle') }) : null,
      button('Cerrar', {
        primary: true,
        onClick: () => game.menu.close()
      })
    ];

    return { body, foot: foot.filter(Boolean), tabs: deliveries ? tabs() : null,
      dato: [el('span', { class: 'menu__money', text: `Día ${day}` })] };
  };

  game._missionsModalOpen = true;
  game.menu.open({
    title: 'Misiones del día',
    sub: deliveries ? 'Misiones de calle y pedidos de reparto.' : 'Supervivencia diaria en Bogotá: cumpla tareas para ganar plata, experiencia y ánimo.',
    ic: 'pin',
    render,
    onClose: () => {
      game._missionsModalOpen = false;
    }
  });
}
