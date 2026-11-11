// src/ui/TrucosPanel.js
// La pestaña Trucos de la pausa y la marca que avisa que están prendidos.
import { el, button } from './dom.js';
import { choice, section, row } from './pauseParts.js';
import { HORAS_TRUCO, VELOCIDAD_NORMAL, VELOCIDAD_RAPIDA, DINERO_TRUCO, ROPAS_TRUCO } from '../core/trucos.js';
import { WEATHER_TYPES } from '../world/Climate.js';
import { cop } from '../utils/money.js';

/** Aviso permanente de que la partida no es la normal. */
export function montarMarcaTrucos(doc = globalThis.document) {
  if (doc.getElementById('trucos-marca')) return;
  const marca = el('div', { id: 'trucos-marca', class: 'trucos-marca', text: 'Trucos' });
  (doc.getElementById('app') ?? doc.body).append(marca);
}

const PROTESTA_GENIOS = [[null, 'Al azar'], ['pacifica', 'Pacífica'], ['tensa', 'Tensa'], ['pelea', 'Pelea']];
const ROBOS = [['azar', 'Al azar'], ['pistola', 'Con pistola'], ['cuchillo', 'Con cuchillo'], ['choro', 'Choro pegao']];

export function trucosPanel(game) {
  const cheats = game.cheats;
  const refrescar = () => game.menu?.refresh?.();
  const grupo = (label, ...choices) => el('div', { class: 'pause-segmented', role: 'group', 'aria-label': label }, ...choices);
  const botones = (...buttons) => el('div', { class: 'pause-actions trucos-botones' }, ...buttons);
  const accion = (label, onClick) => button(label, { onClick: () => { onClick(); refrescar(); } });
  const nota = (text) => el('p', { class: 'trucos-nota', text });
  const sino = (label, on, set) => grupo(label, choice('Sí', on, () => { set(true); refrescar(); }), choice('No', !on, () => { set(false); refrescar(); }));

  return el('div', { class: 'trucos' },
    el('p', { class: 'pause-hint', text: 'Modo de prueba: mientras esté prendido la partida no se guarda.' }),

    el('div', { class: 'pause-settings' },
    el('div', { class: 'pause-settings__col' }, section('user', 'Jugador',
      row('Necesidades', botones(accion('Llenar ahora', () => cheats.llenarTodo())),
        nota('Hambre, sed, energía, higiene, ánimo y vicio al tope, una sola vez.')),
      row('Siempre llenas', sino('Necesidades siempre llenas', cheats.necesidades, (v) => cheats.setNecesidades(v)),
        nota('Mientras esté en Sí, las necesidades no bajan.')),
      row('Sin daño', sino('Sin daño', cheats.invulnerable, (v) => cheats.setInvulnerable(v)),
        nota('No pierde salud, no se muere ni lo arrestan.')),
      row('Plata', botones(accion(`Dar ${cop(DINERO_TRUCO)}`, () => cheats.darDinero()))),
      row('Costal', botones(accion('Llenarlo con todo', () => cheats.darObjetos())),
        nota('Todo el catálogo y los materiales, sin construir el cambuche.')),
      row('Ropa', botones(
        accion(`Dar ${ROPAS_TRUCO} mudas limpias`, () => cheats.darRopaLimpia()),
        accion('Abrir el ropero', () => cheats.abrirRopero())),
        nota('Las mudas se estrenan desde el costal: suben la higiene y el ánimo.')),
      row('Dormir', botones(accion('Echarse en un cartón', () => cheats.echarseEnCarton())),
        nota('Le pone un cartón en el costal y lo duerme encima.'))),

    section('alert', 'Policía',
      row('Fichas', botones(accion('Borrar lo buscado', () => cheats.calmarPolicia())),
        nota('Quita las fichas y termina la persecución.')),
      row('Invisible', sino('Invisible a la policía', cheats.invisible, (v) => cheats.setInvisible(v)),
        nota('Con Sí, las patrullas no lo detectan ni lo persiguen.')))),

    el('div', { class: 'pause-settings__col' }, section('flame', 'Eventos de la calle',
      row('Protesta',
        grupo('Clase de protesta',
          choice('Normal', cheats.protestaKind === 'normal', () => { cheats.setProtesta('normal', cheats.protestaGenio); refrescar(); }),
          choice('Paro de un día', cheats.protestaKind === 'paro', () => { cheats.setProtesta('paro', cheats.protestaGenio); refrescar(); }))),
      row('Ánimo', grupo('Ánimo de la protesta', PROTESTA_GENIOS.map(([id, label]) =>
        choice(label, cheats.protestaGenio === id, () => { cheats.setProtesta(cheats.protestaKind, id); refrescar(); })))),
      row('', botones(accion('Empezar protesta', () => cheats.empezarProtesta()), accion('Acabar protesta', () => cheats.acabarProtesta())),
        nota('Se arma en la calle, cerca. Acabar la manda a dispersarse.')),
      row('Robo en moto', botones(...ROBOS.map(([tipo, label]) => accion(label, () => cheats.robarEnMoto(tipo)))),
        nota('Llega una moto, las armadas en contravía. Con E entrega; también puede correr o defenderse.')),
      row('Choque', botones(accion('Chocar dos carros', () => cheats.choque())),
        nota('Choca por detrás al par de carros en fila más cercano.')),
      row('Conductor', botones(accion('Bajar uno furioso', () => cheats.furiaVial())),
        nota('El conductor del carro más cercano se baja a gritar y pelear. De noche hay pocos carros.')),
      row('Bocadillo', botones(accion('Soltar el gigante', () => cheats.bocadillo())),
        nota('Uno solo, cerca. Si ya hay uno suelto, no sale otro.')),
      row('Psicosis', botones(accion('Traer las sombras', () => cheats.psicosis()), accion('Calmarla', () => cheats.calmarPsicosis())),
        nota('Hombres sombra que lo persiguen y motos sombra que cruzan, hasta que se calme.')))),

    el('div', { class: 'pause-settings__col' }, section('map', 'Lugares',
      row('Ir a', botones(
        accion('Pared de ladrillo', () => cheats.irA('ladrillo')),
        accion('Refugio de chamber', () => cheats.irA('refugio'))),
        nota('La pared lo deja de frente a una fachada: con E raspa el ladrillo.')),
      row('Comedor', botones(
        accion('Ir al comedor', () => cheats.irAlComedor()),
        accion('Comer otra vez', () => cheats.comerOtraVez())),
        nota('Ir lo deja frente al mostrador. Comer otra vez borra la espera de 24 horas.')),
      row('Zonas', botones(...cheats.destinos().map((destino) => accion(destino.name, () => cheats.teletransportar(destino))))),
      row('Cambuche', botones(accion('Construir y mejorar todo', () => cheats.construirCambuche())))),

    section('clock', 'Tiempo y clima',
      row('Hora', grupo('Saltar la hora', HORAS_TRUCO.map(([hour, label]) => choice(label, false, () => { cheats.ponerHora(hour); refrescar(); })))),
      row('Velocidad', grupo('Velocidad del tiempo',
        choice('Normal', cheats.velocidad === VELOCIDAD_NORMAL, () => { cheats.setVelocidad(VELOCIDAD_NORMAL); refrescar(); }),
        choice('Rápido (10x)', cheats.velocidad === VELOCIDAD_RAPIDA, () => { cheats.setVelocidad(VELOCIDAD_RAPIDA); refrescar(); }))),
      row('Clima', grupo('Clima', Object.entries(WEATHER_TYPES).map(([id, { label }]) =>
        choice(label, game.weather?.weather === id, () => { cheats.ponerClima(id); refrescar(); }))))),

    section('check', 'Misiones',
      row('Del día', botones(
        accion('Completarlas', () => cheats.completarMisiones()),
        accion('Empezarlas de nuevo', () => cheats.reiniciarMisiones())),
        nota('Completarlas paga la recompensa de cada una. La lista se ve con J.'))))));
}
