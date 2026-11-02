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
  const list = target?.items ? SHOP_ITEMS.filter((s) => target.items.includes(s.item)) : SHOP_ITEMS;
  const render = () => {
    const body = el('ul', { class: 'rows' }, list.map((s) => {
      const it = s.upgrade ? null : ITEMS[s.item];
      const qty = s.qty ?? 1;
      const owned = s.upgrade && game.costal;
      const heavy = it && inventory.totalWeight + it.weight * qty > inventory.maxWeight;
      const cant = stats.dinero < s.price || owned || heavy;
      const desc = owned ? 'Ya lo tengo.' : heavy ? 'No me cabe en el costal.' : s.desc ?? describe(it);
      return el('li', { class: 'row' },
        icon(s.icon ?? itemIcon(s.item), { size: 24 }),
        el('span', { class: 'row__name' }, s.label ?? it.name, el('span', { class: 'row__desc', text: desc })),
        el('span', { class: 'row__price', text: cop(s.price) }),
        button('Comprar', {
          disabled: cant,
          onClick: () => {
            stats.dinero -= s.price;
            if (s.upgrade) game.costal = true;
            else inventory.add(it, qty);
            game.audio.play('pickup');
            toast(`Compré ${s.label ?? it.name}`);
            game.menu.refresh();
          }
        })
      );
    }));
    return { body, dato: [moneyFoot(game), el('span', { class: 'menu__money', text: `Carga ${kilos(inventory.totalWeight.toFixed(1))} de ${kilos(inventory.maxWeight)} kg` })] };
  };
  game.menu.open(target?.items
    ? { title: target.title, sub: 'Venta ambulante: lo justo para el día.', ic: 'bag', render }
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

export function openCambuche(game) {
  const { inventory } = game;
  const render = () => {
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
      button(night ? `Dormir hasta las ${hora(6)}` : 'Echar una siesta (3 h)', {
        primary: true,
        disabled: !game.built.base,
        onClick: () => { game.menu.close(); game.sleep(); }
      })
    ];
    return { body, foot };
  };
  game.menu.open({ title: 'Mi cambuche', sub: 'Los materiales salen de la basura de toda la ciudad: hay para todas las mejoras.', ic: 'tent', render });
}

function reqLine(inventory, req) {
  return el('span', { class: 'req' }, Object.entries(req).map(([id, q]) => {
    const n = inventory.count(id);
    return el('span', { class: n >= q ? 'req__ok' : 'req__no tachado', title: itemRarityLabel(id), text: `${nameOf(id)} ${Math.min(n, q)} de ${q}` });
  }));
}
