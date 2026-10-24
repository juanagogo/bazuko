import { el, button } from './dom.js';

export function openDeveloperNote(game) {
  // Ocultar temporalmente esta sección mientras se reorganizan los créditos.
  const showCredits = false;
  const credits = [
    ['juanagogo / bazuko', 'Proyecto original y base del juego.', 'https://github.com/juanagogo/bazuko'],
    ['GrandaCoder / Vagabundo', 'Integración, mejoras y desarrollo de esta versión.', 'https://github.com/GrandaCoder/Vagabundo'],
    ['Cristianlv11 / bazuko', 'Radar, pausa, clima, cámara y El Chato.', 'https://github.com/Cristianlv11/bazuko'],
    ['Jonme-Mopri / bazuko', 'Pruebas de navegador y corrección de fabricación.', 'https://github.com/Jonme-Mopri/bazuko'],
    ['mreyeswilson / bazuko', 'Modelos, mobiliario urbano e ideas de inventario y cambuche.', 'https://github.com/mreyeswilson/bazuko'],
    ['Mindfront / MakeHuman Community', 'Gorro de lana (knitted hat 01), licencia CC-BY.', 'https://static.makehumancommunity.org/assets/assetpacks/hats03.html']
  ];
  game.menu.open({
    title: 'Nota del desarrollador',
    sub: 'Colaboración abierta',
    ic: 'info',
    render: () => ({
      body: el('div', { class: 'developer-note' },
        ...(showCredits ? [el('p', { text: 'Esta versión incluye código y aportes de las siguientes personas y repositorios. Gracias por compartir su trabajo:' }),
        el('ul', { class: 'developer-note__credits' }, credits.map(([name, contribution, url]) =>
          el('li', {}, el('a', { href: url, target: '_blank', rel: 'noopener noreferrer', text: name }), el('span', { text: contribution }))))] : []),
        el('div', { class: 'developer-note__request' },
          el('h3', { text: 'Hagamos visibles las tareas pendientes' }),
          el('p', { text: 'A quienes mantienen y colaboran en el proyecto: por favor, publiquen las funcionalidades que se deben desarrollar como issues abiertos al público, indicando qué se necesita y su estado. Así cualquiera podrá conocer las tareas, proponer ideas y colaborar sin duplicar esfuerzos.' }),
          el('a', { href: 'https://github.com/juanagogo/bazuko/issues', target: '_blank', rel: 'noopener noreferrer', text: 'Ver issues del proyecto original ↗' }))
      ),
      foot: [button('Continuar jugando', { primary: true, onClick: () => game.menu.close() })]
    })
  });
}
