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
    const hasCarton = inventory.count('carton') > 0;
    const foot = [
      el('span', {
        class: 'menu__money',
        text: game.built.base
          ? 'Cambuche armado: duermes protegido de la intemperie.'
          : (hasCarton ? 'Puedes dormir improvisado sobre 1 cartón o armar la base con 8 cartones.' : 'Recolecta 8 cartones de la basura para armar la base o consigue 1 para dormir improvisado.')
      }),
      button('Cambiar ropa', {
        onClick: () => {
          game.menu.close();
          game.openWardrobe?.();
        }
      }),
      !game.built.base && hasCarton
        ? button('Dormir sobre 1 cartón', {
            primary: true,
            onClick: () => { game.menu.close(); game.sleep({ carton: true }); }
          })
        : button(night ? `Dormir hasta las ${hora(6)}` : 'Echar una siesta (3 h)', {
            primary: true,
            disabled: !game.built.base,
            onClick: () => { game.menu.close(); game.sleep(); }
          })
    ];
    return { body, foot };
  };
  game.menu.open({ title: 'Mi cambuche', sub: 'Mejora tu refugio con basura (8 cartones para la base) o duerme en cualquier lado con 1 cartón [K].', ic: 'tent', render });
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
            el('li', { text: '+3 min de Calor corporal contra el frío' }),
            el('li', { text: '+30 XP' })
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
            toast('Almorzaste en el Comedor Comunitario. ¡Dios le pague!', 'rare');
            game.menu.refresh();
          }
        }
      })
    ];
    return { body, foot };
  };

  game.menu.open({
    title: 'Comedor Comunitario',
    sub: 'Alcaldía Mayor de Bogotá · Integración Social. Ración caliente cada 24 horas.',
    ic: 'food',
    render
  });
}

export function openResidencia(game) {
  const PRECIO_PIEZA = 10000;
  const render = () => {
    const puedePagar = (game.stats?.dinero ?? 0) >= PRECIO_PIEZA;
    const descP = el('p', {
      class: 'menu__desc',
      text: 'Residencias El Carmen: Pieza individual con cama, cobija limpia y candado. Nadie le va a robar y no le da frío ni lo molesta la policía.'
    });
    const detalleEl = el('div', { class: 'comedor-box' },
      el('h4', { class: 'comedor-box__title', text: 'Noche de descanso seguro' }),
      el('ul', { class: 'comedor-box__beneficios' },
        el('li', { text: '+100% Energía al despertar' }),
        el('li', { text: '+100% Salud mental restaurada' }),
        el('li', { text: '+35 Salud recuperada' }),
        el('li', { text: '0% Riesgo de robo o asalto' }),
        el('li', { text: 'Protegido de la lluvia, el frío y la policía' })
      )
    );
    const body = el('div', { class: 'comedor-menu' }, descP, detalleEl);
    const foot = [
      moneyFoot(game),
      button(puedePagar ? `Pagar pieza (${cop(PRECIO_PIEZA)})` : 'Plata insuficiente', {
        primary: true,
        disabled: !puedePagar,
        onClick: () => {
          if ((game.stats?.dinero ?? 0) < PRECIO_PIEZA) return;
          game.stats.dinero -= PRECIO_PIEZA;
          game.menu.close();
          game.sleep({ residencia: true });
        }
      })
    ];
    return { body, foot };
  };

  game.menu.open({
    title: 'Residencias El Carmen',
    sub: 'Piezas por noche. Privacidad, descanso seguro y agua caliente.',
    ic: 'bed',
    render
  });
}

export function playBurdelAnimation(game, precioServicio = 20000) {
  if (game._cutsceneActive || typeof document === 'undefined') return;
  game._cutsceneActive = true;
  game.audio?.play?.('pickup');

  // Contenedor pantalla completa de la cinemática
  const overlay = document.createElement('div');
  overlay.id = 'burdel-cutscene';
  Object.assign(overlay.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '99999',
    background: 'radial-gradient(circle at center, #1b0714 0%, #0a0307 70%, #000000 100%)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px',
    color: '#f8f8f8',
    fontFamily: "'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    opacity: '0',
    transition: 'opacity 0.7s ease',
    pointerEvents: 'all',
    userSelect: 'none'
  });

  const contentBox = document.createElement('div');
  Object.assign(contentBox.style, {
    maxWidth: '560px',
    textAlign: 'center',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '18px'
  });

  // Título Neón Rojo
  const neonTitle = document.createElement('h2');
  neonTitle.textContent = 'ZONA ROJA - HABITACIÓN RESERVADA';
  Object.assign(neonTitle.style, {
    margin: '0',
    fontSize: 'clamp(24px, 4vw, 36px)',
    fontWeight: '900',
    letterSpacing: '2px',
    color: '#ff2a6d',
    textShadow: '0 0 12px rgba(255, 42, 109, 0.9), 0 0 28px rgba(255, 42, 109, 0.6)',
    textTransform: 'uppercase'
  });

  // Línea luminosa de neón
  const neonBar = document.createElement('div');
  Object.assign(neonBar.style, {
    width: '120px',
    height: '3px',
    backgroundColor: '#ff2a6d',
    boxShadow: '0 0 10px #ff2a6d, 0 0 20px #ff2a6d',
    borderRadius: '2px'
  });

  // Texto narrativo
  const textNarrative = document.createElement('p');
  textNarrative.textContent = 'Cruza la cortina de terciopelo rojo, dejando atrás el asfalto helado de la Carrera 10...';
  Object.assign(textNarrative.style, {
    fontSize: 'clamp(17px, 2.4vw, 21px)',
    lineHeight: '1.45',
    color: '#e2e8f0',
    minHeight: '60px',
    margin: '0',
    transition: 'opacity 0.4s ease'
  });

  contentBox.appendChild(neonTitle);
  contentBox.appendChild(neonBar);
  contentBox.appendChild(textNarrative);
  overlay.appendChild(contentBox);
  document.body.appendChild(overlay);

  // Fade-in
  requestAnimationFrame(() => {
    overlay.style.opacity = '1';
  });

  // Compás 2 (2.0s): música, calor y avance de hora
  setTimeout(() => {
    textNarrative.style.opacity = '0';
    setTimeout(() => {
      textNarrative.innerHTML = 'Entre luces tenues y música de cantina, se toma un trago caliente.<br><span style="color:#f6ad55; font-size: 0.92em;">Un rato de intimidad y calor para olvidar la dureza de la calle bogotana...</span>';
      textNarrative.style.opacity = '1';

      if (game.clock && game.sceneMgr) {
        game.clock.hour = (game.clock.hour + 1.5) % 24;
        game.sceneMgr.setTimeOfDay(game.clock.hour, game.weather, game.clock.day);
        game.sceneMgr.followTarget(game.player.position, game.clock.hour);
      }
    }, 400);
  }, 2000);

  // Compás 3 (4.2s): resolución (robo o satisfacción)
  setTimeout(() => {
    const isRobbed = Math.random() < 0.20;
    textNarrative.style.opacity = '0';

    setTimeout(() => {
      if (isRobbed) {
        const robado = Math.min(game.stats?.dinero ?? 0, Math.floor(10000 + Math.random() * 20000));
        if (game.stats) game.stats.dinero = Math.max(0, game.stats.dinero - robado);
        neonTitle.style.color = '#ef4444';
        neonTitle.style.textShadow = '0 0 12px #ef4444';
        textNarrative.innerHTML = `<strong style="color: #f87171; font-size: 1.05em;">¡Emboscada al salir por el callejón!</strong><br>Dos tipos con chuzo lo acorralaron y le esculcaron los bolsillos. Perdió ${cop(robado)}.`;
        game.audio?.play?.('empty');
      } else {
        if (game.stats) {
          game.stats.energia = Math.min(100, (game.stats.energia || 0) + 40);
          game.stats.saludMental = Math.min(100, (game.stats.saludMental || 0) + 20);
          game.stats.hambre = Math.max(0, (game.stats.hambre || 0) - 25);
          game.stats.sed = Math.max(0, (game.stats.sed || 0) - 25);
        }
        neonTitle.style.color = '#38bdf8';
        neonTitle.style.textShadow = '0 0 12px #38bdf8';
        textNarrative.innerHTML = '<strong style="color: #38bdf8; font-size: 1.05em;">Servicio cumplido.</strong><br>Sale descansado y aliviado al andén, aunque con el cuerpo pidiendo comida y agua.';
        game.audio?.play?.('treasure');
      }
      textNarrative.style.opacity = '1';
    }, 400);
  }, 4200);

  // Compás 4 (6.3s): fade out y retorno
  setTimeout(() => {
    overlay.style.opacity = '0';
    setTimeout(() => {
      overlay.remove();
      game._cutsceneActive = false;
      game._save();
    }, 700);
  }, 6300);
}

export function openProstibulo(game) {
  const PRECIO_SERVICIO = 20000;
  const render = () => {
    const puedePagar = (game.stats?.dinero ?? 0) >= PRECIO_SERVICIO;
    const descP = el('p', {
      class: 'menu__desc',
      text: 'Callejón de la 19. Entre luces rojas y música de cantina, un rato de desahogo en la noche bogotana.'
    });
    const detalleEl = el('div', { class: 'comedor-box' },
      el('h4', { class: 'comedor-box__title', text: 'Servicio en la habitación' }),
      el('ul', { class: 'comedor-box__beneficios' },
        el('li', { text: '+40 Energía (desahogo y descanso)' }),
        el('li', { text: '+20 Ánimo y salud mental' }),
        el('li', { text: 'Baja 25 de hambre y 25 de sed por desgaste físico' }),
        el('li', { text: 'Peligro: 20% riesgo de emboscada o robo en el callejón' })
      )
    );
    const body = el('div', { class: 'comedor-menu' }, descP, detalleEl);
    const foot = [
      moneyFoot(game),
      button(puedePagar ? `Contratar servicio (${cop(PRECIO_SERVICIO)})` : 'Plata insuficiente', {
        primary: true,
        disabled: !puedePagar,
        onClick: () => {
          if ((game.stats?.dinero ?? 0) < PRECIO_SERVICIO) return;
          game.stats.dinero -= PRECIO_SERVICIO;
          game.menu.close();
          playBurdelAnimation(game, PRECIO_SERVICIO);
        }
      })
    ];
    return { body, foot };
  };

  game.menu.open({
    title: 'Callejón Rojo - Zona de Tolerancia',
    sub: 'Noche, luces de neón y compañía en el centro.',
    ic: 'star',
    render
  });
}

function reqLine(inventory, req) {
  return el('span', { class: 'req' }, Object.entries(req).map(([id, q]) => {
    const n = inventory.count(id);
    return el('span', { class: n >= q ? 'req__ok' : 'req__no tachado', title: itemRarityLabel(id), text: `${nameOf(id)} ${Math.min(n, q)} de ${q}` });
  }));
}
