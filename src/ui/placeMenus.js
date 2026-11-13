// src/ui/placeMenus.js
// Menús de los lugares: Recicladora El Progreso, Tienda La Esquinita y el cambuche.
import { ITEMS, SHOP_ITEMS, isForSale, itemIcon, itemRarityLabel } from '../data/items.js';
import { CAMBUCHE } from '../data/cambuche.js';
import { hora } from './formato.js';
import { diseaseName } from '../data/diseases.js';
import { originEffect } from '../data/origins.js';
import { XP_SELL } from '../utils/constants.js';
import { cop } from '../utils/money.js';
import { conSigno } from '../utils/numeros.js';
import { el, button } from './dom.js';
import { icon } from './icons.js';
import { rowEl } from './Menu.js';
import { shelterPreview } from './ShelterPreview.js';
import { caletaPanel } from './streetMenus.js';
import { avisoDeFama, famaNivel } from '../systems/Reputation.js';

const toast = (text, type = 'info') => window.dispatchEvent(new CustomEvent('toast', { detail: { text, type } }));
const moneyFoot = (game) => el('span', { class: 'menu__money' }, 'Plata: ', el('span', { text: cop(game.stats.dinero) }));
const kilos = (n) => String(n).replace('.', ',');
const nameOf = (id) => ITEMS[id]?.name ?? id;

export function openRecycler(game) {
  const { inventory, stats } = game;
  const mult = (game.interaction.boostActive ? 1.2 : 1) * originEffect(game.look?.origen, 'sellMult');

  const render = () => {
    const sellable = inventory.items.filter((i) => isForSale(ITEMS[i.id] ?? i, game.player?.equippedWeapon));
    const total = Math.round(sellable.reduce((a, i) => a + i.value * i.qty * mult, 0));
    const body = sellable.length
      ? el('ul', { class: 'rows' }, sellable.map((i) => rowEl({
          ic: itemIcon(i.id),
          name: i.name,
          desc: `${cop(i.value * mult)} c/u`,
          qty: `× ${i.qty}`,
          price: cop(i.value * i.qty * mult)
        })))
      : el('p', { class: 'empty', text: 'No llevo nada para vender. En las bolsas de basura hay latas, botellas, cartón, chatarra y, con suerte, cobre.' });
    const foot = [
      moneyFoot(game),
      button(total ? `Vender todo: ${cop(total)}` : 'Vender todo', {
        primary: true,
        disabled: !total,
        onClick: () => {
          for (const i of sellable) inventory.remove(i.id, i.qty);
          stats.dinero += total;
          stats.addXP(XP_SELL, game.talents);
          game.audio.play('sell');
          window.dispatchEvent(new CustomEvent('sell', { detail: { earned: total } }));
          game.menu.refresh();
        }
      })
    ];
    return { body, foot, dato: [moneyFoot(game)] };
  };

  game.menu.open({ title: 'Recicladora El Progreso', sub: 'Pagan de contado. Comida, remedios y sustancias no se reciben; el arma que llevo en la mano no se vende.', ic: 'recycle', render });
}

/** Tienda La Esquinita, o un vendedor ambulante si `target` trae { title, items } */
export function openShop(game, target = null) {
  const { inventory, stats } = game;
  // Las chazas son de la calle: cobran según la fama, fían a los conocidos y cobran lo fiado.
  const chaza = !!target?.items;
  const fama = chaza ? game.street?.fama : null;
  const list = chaza ? SHOP_ITEMS.filter((s) => target.items.includes(s.item)) : SHOP_ITEMS;
  if (fama?.deuda > 0) {
    const pagado = fama.payDebt(stats);
    if (pagado > 0) toast(fama.deuda > 0 ? `Aboné ${cop(pagado)} al fiado. Todavía debo ${cop(fama.deuda)}.` : `Pagué el fiado: ${cop(pagado)}.`, 'sell');
  }
  const priceOf = (s) => fama ? Math.round(s.price * fama.priceMult() / 100) * 100 : s.price;
  const render = () => {
    const body = el('ul', { class: 'rows' }, list.map((s) => {
      const it = s.upgrade ? null : ITEMS[s.item];
      const qty = s.qty ?? 1;
      const price = priceOf(s);
      const owned = s.upgrade && game.costal;
      const heavy = it && inventory.totalWeight + it.weight * qty > inventory.maxWeight;
      const short = stats.dinero < price;
      const fiado = !!fama && short && !owned && !heavy && fama.canCredit(price);
      const cant = (short && !fiado) || owned || heavy;
      const desc = owned ? 'Ya lo tengo.' : heavy ? 'No me cabe en el costal.' : fiado ? 'No me alcanza, pero me lo fían.' : s.desc ?? describe(it);
      return el('li', { class: 'row' },
        icon(s.icon ?? itemIcon(s.item), { size: 24 }),
        el('span', { class: 'row__name' }, s.label ?? it.name, el('span', { class: 'row__desc', text: desc })),
        el('span', { class: 'row__price', text: cop(price) }),
        button(fiado ? 'Fiado' : 'Comprar', {
          disabled: cant,
          onClick: () => {
            if (fiado) fama.credit(price, game.totalGameHours);
            else stats.dinero -= price;
            if (s.upgrade) game.costal = true;
            else inventory.add(it, qty);
            game.audio.play('pickup');
            if (fama) for (const cambio of fama.apply('comprarChaza')) toast(avisoDeFama(cambio), 'rare');
            toast(fiado ? `Me fiaron ${s.label ?? it.name}. Debo ${cop(fama.deuda)}: lo pago la próxima vez que compre.` : `Compré ${s.label ?? it.name}`);
            game.menu.refresh();
          }
        })
      );
    }));
    const nivel = fama ? famaNivel(fama.chazas) : null;
    const nota = nivel === 'mala' ? 'Me cobran más: no me tienen confianza.' : nivel === 'muyBuena' ? 'Me rebajan: me tienen aprecio.' : null;
    const dato = [moneyFoot(game), el('span', { class: 'menu__money', text: `Carga ${kilos(inventory.totalWeight.toFixed(1))} de ${kilos(inventory.maxWeight)} kg` })];
    if (fama?.deuda > 0) dato.push(el('span', { class: 'menu__money', text: `Debo ${cop(fama.deuda)}` }));
    return { body, dato, foot: nota ? [el('span', { class: 'menu__money', text: nota })] : [] };
  };
  game.menu.open(chaza
    ? { title: target.title, sub: 'Venta ambulante: lo justo para el día. A los conocidos les fían.', ic: 'bag', render }
    : { title: 'Tienda La Esquinita', sub: 'Doña Rosa fía, pero solo a los conocidos.', ic: 'store', render });
}

/** Texto corto con los efectos de un objeto consumible */
function describe(it) {
  if (!it) return '';

  const names = { hambre: 'hambre', sed: 'sed', energia: 'energía', salud: 'salud', higiene: 'higiene', animo: 'ánimo', vicio: 'vicio' };
  const parts = [];
  if (it.consumable) parts.push(`+${it.amount} ${names[it.consumable]}`);
  for (const k of Object.keys(names)) {
    if (k !== it.consumable && it[k]) parts.push(`${conSigno(it[k])} ${names[k]}`);
  }
  if (it.calor) parts.push(`+${Math.round(it.calor / 60)} min de calor`);
  if (it.cure) parts.push(`Cura: ${diseaseName(it.cure)}`);
  return parts.join(', ');
}

export function openCambuche(game, tab = 'armar') {
  const { inventory } = game;
  let solapa = tab;
  const solapas = () => el('nav', { class: 'pause-tabs lugar-tabs', role: 'tablist', 'aria-label': 'Secciones del cambuche' },
    [['armar', 'Armar y dormir'], ['caleta', 'Caleta']].map(([id, label]) => el('button', {
      type: 'button', role: 'tab', class: `pause-tab${id === solapa ? ' is-active' : ''}`,
      'aria-selected': id === solapa ? 'true' : 'false',
      onclick: () => { solapa = id; game.menu.refresh(); },
    }, el('span', { class: `pause-tab__palabra${id === solapa ? ' elegido' : ''}`, text: label }))));
  const render = () => {
    if (solapa === 'caleta') {
      return { body: caletaPanel(game), tabs: solapas(), foot: [el('span', { class: 'menu__money', text: 'Lo que dejo aquí me espera.' })] };
    }
    const rows = el('ul', { class: 'rows' }, CAMBUCHE.map((p) => {
      const done = !!game.built[p.id];
      const locked = p.needs && !game.built[p.needs];
      const ok = Object.entries(p.req).every(([id, q]) => inventory.count(id) >= q);
      return el('li', { class: `row row--build ${done ? 'is-done' : ''} ${locked ? 'is-locked' : ''}` },
        icon(locked ? 'lock' : p.icon, { size: 24 }),
        el('span', { class: 'row__name' }, p.name,
          el('span', { class: 'row__desc', text: locked ? 'Primero armo la base.' : p.desc }),
          done || locked ? null : reqLine(inventory, p.req)),
        done ? el('span', { class: 'row__qty chulo', text: 'Hecho' }) : button('Armar', {
          disabled: locked || !ok,
          onClick: () => {
            for (const [id, q] of Object.entries(p.req)) inventory.remove(id, q);
            game.built[p.id] = true;
            game.cambuche.setBuilt(game.built);
            game.audio.play('treasure');
            toast(`Armé: ${p.name}`, 'rare');
            game.menu.refresh();
          }
        })
      );
    }));
    const body = el('div', { class: 'shelter-menu' }, shelterPreview(game), rows);
    const night = game.clock.isNight;
    const foot = [
      el('span', { class: 'menu__money', text: game.built.base ? 'Dormir guarda la partida.' : 'Sin base no se puede dormir.' }),
      button('Cambiar ropa', {
        onClick: () => {
          game.menu.close();
          game.openWardrobe?.();
        }
      }),
      button(night ? `Dormir hasta las ${hora(6)}` : 'Echar una siesta (3 h)', {
        primary: true,
        disabled: !game.built.base,
        onClick: () => { game.menu.close(); game.sleep(); }
      })
    ];
    return { body, foot, tabs: solapas() };
  };
  game.menu.open({ title: 'Mi cambuche', sub: 'Los materiales salen de la basura de toda la ciudad: hay para todas las mejoras.', ic: 'tent', render });
}

export function openComedor(game) {
  const render = () => {
    const available = game?.isComedorAvailable ? game.isComedorAvailable() : true;
    const rem = game?.getComedorRemainingHours ? game.getComedorRemainingHours() : 0;
    const descP = el('p', {
      class: 'menu__desc',
      text: 'La Secretaría de Integración Social ofrece un plato de comida caliente y sustanciosa cada 24 horas para habitantes de calle y personas en situación de vulnerabilidad.'
    });

    const platoEl = available
      ? el('div', { class: 'comedor-box' },
          el('h4', { class: 'comedor-box__title', text: 'Menú del día: Sancocho con seco y jugo' }),
          el('p', { class: 'comedor-box__sub', text: 'Sancocho con carne, papa y plátano, porción de arroz con tajada y aguapanela con limón.' }),
          el('ul', { class: 'comedor-box__beneficios' },
            el('li', { text: '+80 Hambre (satisface el apetito)' }),
            el('li', { text: '+60 Sed (hidratación completa)' }),
            el('li', { text: '+25 Ánimo y +25 Energía' }),
            el('li', { text: '+3 min de Calor corporal contra el frío' })
          ))
      : el('div', { class: 'comedor-box is-waiting' },
          el('h4', { class: 'comedor-box__title', text: 'Ración de hoy ya entregada' }),
          el('p', { class: 'comedor-box__sub', text: `El servicio es una vez cada 24 horas por persona. Próximo turno en aproximadamente ${rem} ${rem === 1 ? 'hora' : 'horas'}.` })
        );

    const body = el('div', { class: 'comedor-menu' }, descP, platoEl);
    const foot = [
      el('span', { class: 'menu__money', text: available ? 'Servicio gratuito' : `Espera: ${rem} h` }),
      button(available ? 'Recibir almuerzo' : `Vuelva en ${rem} h`, {
        primary: true,
        disabled: !available,
        onClick: () => {
          if (game?.serveComedor?.()) {
            toast('Almorcé en el Comedor Comunitario. ¡Dios le pague!', 'rare');
            game.menu.refresh();
          }
        }
      })
    ];
    return { body, foot };
  };

  game.menu.open({
    title: 'Comedor Comunitario',
    sub: 'Alcaldía Mayor de Bogotá, Integración Social. Ración caliente cada 24 horas.',
    ic: 'food',
    render
  });
}

function reqLine(inventory, req) {
  return el('span', { class: 'req' }, Object.entries(req).map(([id, q]) => {
    const n = inventory.count(id);
    return el('span', { class: n >= q ? 'req__ok' : 'req__no tachado', title: itemRarityLabel(id), text: `${nameOf(id)} ${Math.min(n, q)} de ${q}` });
  }));
}
