// src/ui/streetMenus.js
// Las ventanas de la vida de calle: la estación (pagar o colarse y a dónde), el hogar de paso (sus reglas
// antes de entrar), la caleta del cambuche (guardar y sacar) y la fama en la pestaña Estado.
// Cada ventana dice antes de actuar lo que va a pasar: precio, riesgo, lo que se entrega y lo que se gana.
import { ITEMS, itemIcon } from '../data/items.js';
import { cop } from '../utils/money.js';
import { el, button } from './dom.js';
import { icon } from './icons.js';
import { hora } from './formato.js';
import { PASAJE, sneakRisk, travelMinutes } from '../systems/Transit.js';
import { HOGAR, contraband, hasRoom, isOpen } from '../systems/Shelter.js';
import { CALETA_KG } from '../systems/Caleta.js';
import { FAMA, FAMA_GRUPOS, famaEfecto, famaNivel } from '../systems/Reputation.js';
import { freshnessLabel } from '../systems/Freshness.js';
import { usesLeft } from '../systems/WeaponWear.js';
import { CAMBUCHE } from '../data/cambuche.js';

const kilos = (n) => String(Math.round(n * 10) / 10).replace('.', ',');
const pct = (p) => `${Math.round(p * 100)} %`;
const moneyFoot = (game) => el('span', { class: 'menu__money' }, 'Plata: ', el('span', { text: cop(game.stats.dinero) }));

/** Una fila con dos verbos a la derecha. */
function rowTwo({ ic, name, desc, qty, buttons }) {
  return el('li', { class: 'row row--dos' },
    icon(ic, { size: 24 }),
    el('span', { class: 'row__name' }, name, desc ? el('span', { class: 'row__desc', text: desc }) : null),
    el('span', { class: 'row__qty', text: qty ?? '' }),
    el('span', { class: 'row__verbos' }, ...buttons));
}

/** La línea de estado de una fila del costal o la caleta: cuánto pesa, si se daña pronto, si el arma está gastada. */
function estadoDe(entry, now) {
  const item = ITEMS[entry.id];
  const partes = [`${kilos(item.weight * entry.qty)} kg`];
  const fresca = freshnessLabel(entry, now);
  if (fresca) partes.push(fresca);
  const usos = usesLeft(entry);
  if (usos !== null) partes.push(`le quedan ${usos} golpes`);
  return partes.join(', ');
}

// ---------- estación ----------

export function openTransit(game, target) {
  const street = game.street;
  const from = target?.stop;
  if (!street || !from) return;
  let modo = game.stats.dinero >= PASAJE ? 'pagar' : 'colarse';
  let pedir = false;

  const render = () => {
    const riesgo = sneakRisk(game.steal?.buscado ?? 0);
    const alcanza = game.stats.dinero >= PASAJE;
    const opcion = (id, titulo, detalle, disabled = false) => el('button', {
      type: 'button', class: `viaje-opcion${modo === id ? ' is-elegida' : ''}`, 'aria-pressed': String(modo === id), disabled,
      onclick: () => { modo = id; game.menu.refresh(); },
    }, el('strong', { text: titulo }), el('span', { text: detalle }));

    const destinos = street.stops.filter((s) => s !== target).map((s) => {
      const min = travelMinutes(from, s.stop);
      return el('li', { class: 'row' },
        icon('bus', { size: 24 }),
        el('span', { class: 'row__name' }, s.stop.name, el('span', { class: 'row__desc', text: `${s.stop.sistema}, ${min} min de viaje` })),
        el('span'),
        button(modo === 'pagar' ? `Ir: ${cop(PASAJE)}` : 'Ir colado', {
          primary: true,
          disabled: modo === 'pagar' && !alcanza,
          onClick: () => {
            game.menu.close();
            street.travel(from, s.stop, { modo, pedir });
          },
        }));
    });

    const body = el('div', { class: 'viaje' },
      el('p', { class: 'viaje__titulo', text: '¿Cómo entro?' }),
      el('div', { class: 'viaje-opciones', role: 'group', 'aria-label': 'Cómo entro' },
        opcion('pagar', `Pagar pasaje: ${cop(PASAJE)}`, alcanza ? 'Entro tranquilo.' : 'No me alcanza la plata.', !alcanza),
        opcion('colarse', 'Colarme por el torniquete', `Gratis. Me pillan ${pct(riesgo)} de las veces${(game.steal?.buscado ?? 0) > 0 ? ', más porque estoy fichado' : ''}: me sacan y quedo fichado.`)),
      el('button', {
        type: 'button', class: `viaje-pedir${pedir ? ' is-elegida' : ''}`, role: 'switch', 'aria-checked': String(pedir),
        onclick: () => { pedir = !pedir; game.menu.refresh(); },
      }, el('span', { class: 'viaje-pedir__caja' }, pedir ? icon('check', { size: 18 }) : null),
        el('span', { text: 'Pedir plata en el vagón. Con mal olor nadie da.' })),
      el('p', { class: 'viaje__titulo', text: '¿Para dónde?' }),
      destinos.length ? el('ul', { class: 'rows' }, destinos) : el('p', { class: 'empty', text: 'No hay otra estación abierta.' }));
    return { body, dato: [moneyFoot(game)] };
  };

  game.menu.open({ title: from.name, sub: `${from.sistema}. El viaje adelanta el reloj y El Chato me alcanza allá.`, ic: 'bus', render });
}

// ---------- hogar de paso ----------

export function openHogar(game) {
  const street = game.street;
  if (!street) return;
  const render = () => {
    const { hour, day } = game.clock;
    const abierto = isOpen(hour), cupo = hasRoom(day);
    const { sustancias, armas } = contraband(game.inventory, game.player?.equippedWeapon);
    const regla = (ok, texto, detalle = null) => el('li', { class: `hogar-regla${ok ? ' is-ok' : ' is-no'}` },
      el('span', { class: 'hogar-regla__marca' }, icon(ok ? 'check' : 'x', { size: 20 })),
      el('span', {}, el('strong', { text: texto }), detalle ? el('span', { class: 'row__desc', text: detalle }) : null));
    const body = el('div', { class: 'hogar' },
      el('ul', { class: 'hogar-reglas' },
        regla(abierto, `Se entra de ${hora(HOGAR.abre)} a ${hora(HOGAR.cierra)}`, abierto ? 'Ahora están recibiendo.' : `Ahora son las ${hora(hour)}.`),
        regla(cupo, cupo ? 'Hoy hay cupo' : 'Hoy no hay cupo', cupo ? null : 'Mañana puede haber. El cambuche sigue ahí.'),
        regla(!sustancias.length, sustancias.length ? `Entrego: ${sustancias.map((s) => `${s.name} ×${s.qty}`).join(', ')}` : 'No llevo sustancias',
          sustancias.length ? 'Las sustancias no se devuelven. Puedo dejarlas antes en la caleta.' : null),
        regla(true, armas.length ? `Dejo en la portería: ${armas.map((a) => a.name).join(', ')}` : 'No llevo armas',
          armas.length ? 'Me las devuelven al salir.' : null)),
      el('p', { class: 'viaje__titulo', text: 'Lo que da una noche aquí' }),
      el('ul', { class: 'comedor-box__beneficios' },
        el('li', { text: `+${HOGAR.energia} de energía y +${HOGAR.salud} de salud` }),
        el('li', { text: `Ducha: la higiene queda en ${HOGAR.higiene} o más` }),
        el('li', { text: `Comida caliente: +${HOGAR.hambre} de hambre y de sed` }),
        el('li', { text: 'Nadie me roba mientras duermo' }),
        el('li', { text: `Adentro no se consume: el vicio baja ${HOGAR.vicio}` })));
    // Con la tomba encima no se entra a dormir (ver Game.sleep y StreetLife.hogarBlocked).
    const motivo = game.traffic?.inPursuit ? 'Con la tomba encima no puedo dormir' : !abierto ? 'Cerrado a esta hora' : !cupo ? 'Sin cupo esta noche' : null;
    const foot = [
      el('span', { class: 'menu__money', text: motivo ?? `Salgo a las ${hora(6)}, bañado.` }),
      button(motivo ? motivo : `Entrar y dormir hasta las ${hora(6)}`, {
        primary: true, disabled: !!motivo,
        onClick: () => { game.menu.close(); street.enterHogar(); },
      }),
    ];
    return { body, foot };
  };
  game.menu.open({ title: 'Hogar de paso', sub: 'Integración Social. Una noche bajo techo, con reglas.', ic: 'bed', render });
}

// ---------- caleta ----------

/** El contenido de la solapa Caleta del cambuche. `refresh` vuelve a pintar la ventana. */
export function caletaPanel(game) {
  const { inventory, built } = game;
  const caleta = game.street?.caleta;
  const now = game.totalGameHours;
  if (!caleta) return el('p', { class: 'empty', text: 'No hay caleta.' });
  const cap = caleta.capacity(built);
  if (!cap) {
    return el('div', { class: 'caleta' },
      el('p', { class: 'empty', text: 'Primero armo la base: la caleta va escondida debajo del cartón.' }));
  }
  const usado = caleta.weight;
  const refresh = () => game.menu.refresh();
  const mover = (fn, id, qty, verbo) => {
    const n = fn(id, qty);
    if (n > 0) game.audio?.play?.('pickup');
    else {
      game.audio?.play?.('empty');
      window.dispatchEvent(new CustomEvent('toast', { detail: { text: verbo === 'guardar' ? 'Eso ya no cabe en la caleta.' : 'Eso no me cabe en el costal.', type: 'warn' } }));
    }
    refresh();
  };
  const guardar = (id, qty) => mover((i, q) => caleta.store(inventory, i, q, built), id, qty, 'guardar');
  const sacar = (id, qty) => mover((i, q) => caleta.take(inventory, i, q), id, qty, 'sacar');

  const enMano = game.player?.equippedWeapon;
  const costal = inventory.items.filter((e) => ITEMS[e.id] && !(ITEMS[e.id].weapon && ITEMS[e.id].weapon === enMano));
  const filaCostal = (e) => {
    const cabe = caleta.room(e.id, built);
    return rowTwo({
      ic: itemIcon(e.id), name: e.name, qty: `× ${e.qty}`, desc: cabe > 0 ? estadoDe(e, now) : `${estadoDe(e, now)}. No cabe.`,
      buttons: [
        button('Guardar 1', { disabled: cabe < 1, onClick: () => guardar(e.id, 1) }),
        button('Todo', { disabled: cabe < 1 || e.qty < 2, onClick: () => guardar(e.id, e.qty) }),
      ],
    });
  };
  const filaCaleta = (e) => rowTwo({
    ic: itemIcon(e.id), name: ITEMS[e.id].name, qty: `× ${e.qty}`, desc: estadoDe(e, now),
    buttons: [
      button('Sacar 1', { onClick: () => sacar(e.id, 1) }),
      button('Todo', { disabled: e.qty < 2, onClick: () => sacar(e.id, e.qty) }),
    ],
  });
  const siguiente = CAMBUCHE.find((p) => !built[p.id] && CALETA_KG[p.id]);
  return el('div', { class: 'caleta' },
    el('div', { class: 'caleta__cabeza' },
      el('span', { class: 'caleta__carga' }, el('strong', { text: `${kilos(usado)} de ${cap} kg` }), ' guardados'),
      el('div', { class: 'pause-meter', role: 'meter', 'aria-label': 'Carga de la caleta', 'aria-valuemin': '0', 'aria-valuemax': String(cap), 'aria-valuenow': String(usado) },
        el('div', { class: 'pause-meter__fill masa', style: `width:${Math.min(100, usado / cap * 100)}%` }))),
    el('p', { class: 'caleta__nota', text: `Lo que dejo aquí no se pierde si me muero o me coge la Policía. ${built.paredes ? 'Con paredes, nadie la encuentra.' : 'Sin paredes, si me roban de noche pueden encontrarla.'}${siguiente ? ` Con ${siguiente.name.toLowerCase()} caben ${CALETA_KG[siguiente.id]} kg más.` : ''} La comida se daña igual.` }),
    el('div', { class: 'caleta__columnas' },
      el('section', { 'aria-label': 'En el costal' },
        el('p', { class: 'viaje__titulo', text: 'En el costal' }),
        costal.length ? el('ul', { class: 'rows' }, costal.map(filaCostal)) : el('p', { class: 'empty', text: 'El costal está vacío.' })),
      el('section', { 'aria-label': 'En la caleta' },
        el('p', { class: 'viaje__titulo', text: 'En la caleta' }),
        caleta.items.length ? el('ul', { class: 'rows' }, caleta.items.map(filaCaleta)) : el('p', { class: 'empty', text: 'Vacía. Lo que guarde aparece aquí.' }))));
}

// ---------- fama, en la pestaña Estado ----------

export function famaSection(game, sectionTitle) {
  const fama = game.street?.fama;
  if (!fama) return null;
  const now = game.totalGameHours;
  const fila = (grupo) => {
    const valor = Math.round(fama[grupo]);
    const nivel = famaNivel(valor);
    const cls = nivel === 'mala' ? 'is-critical' : nivel === 'normal' ? 'is-ok' : 'is-ok fama--buena';
    return el('li', { class: `pause-need fama ${cls}` },
      el('span', { class: 'pause-need__label' }, icon(grupo === 'calle' ? 'fogata' : 'chaza', { size: 20 }), el('span', { text: FAMA_GRUPOS[grupo].nombre })),
      el('div', { class: 'pause-meter' }, el('div', { class: 'pause-meter__fill masa', style: `width:${valor}%` })),
      el('span', { class: 'pause-need__value cifra', text: `${valor}` }),
      el('span', { class: 'fama__efecto', text: famaEfecto(grupo, valor) }));
  };
  const horas = fama.debtHoursLeft(now);
  return el('div', { class: 'pause-section pause-section--fama' },
    sectionTitle('persona', 'Mi fama en la calle'),
    el('ul', { class: 'pause-needs' }, fila('calle'), fila('chazas')),
    fama.deuda > 0 ? el('p', { class: 'fama__deuda', text: `Le debo ${cop(fama.deuda)} a los de las chazas. Pago al comprar otra vez${horas !== null ? `; me quedan ${Math.ceil(horas)} h` : ''}.` }) : null,
    el('p', { class: 'fama__ayuda', text: `Compartir comida en la fogata y cuidar carros sube. Robar o pelear cerca de ellos baja. Desde ${FAMA.buena} me avisan y me fían.` }));
}
