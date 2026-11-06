// src/systems/castigoPendiente.js
// El arresto y la muerte abren su pantalla y cobran al pulsar Continuar. Mientras la pantalla está abierta el guardado
// solo no escribe nada, así que cerrar la pestaña ahí volvía al último guardado, con la plata y el costal enteros.
// Ahora, al abrirse la pantalla, se guarda una vez la partida con una marca de lo que falta cobrar
// (`castigoPendiente`), y al cargar una partida con esa marca se cobra lo mismo que habría cobrado Continuar.
// Cobrar aquí y en Continuar usa las mismas funciones: lo que se pierde no puede ser distinto por haber recargado.
import { ITEMS } from '../data/items.js';
import { castigoDeArresto, CALABOZO_HAMBRE, CALABOZO_PISO, CALABOZO_SED } from '../data/arresto.js';
import { NEEDS } from './StatsSystem.js';

/** Lo que la Policía decomisa: con nivel bajo, solo el vicio; con nivel alto, todo el costal. */
export function decomisoDeArresto(items, castigo) {
  if (castigo?.todoElCostal !== false) return items ?? [];
  return (items ?? []).filter((it) => ITEMS[it.id]?.substance);
}

/**
 * Lo que pierde quien cae preso: el decomiso, toda la plata del bolsillo, el carro y, con nivel 3, horas de calabozo.
 * `alVolante` es para la partida guardada en la plana: al cargarla el carro ya no está en sus manos sino estacionado.
 */
export function cobrarArresto(game, castigo, { alVolante = false } = {}) {
  if (castigo.todoElCostal) game.inventory.clear();
  else for (const it of decomisoDeArresto(game.inventory.items, castigo)) game.inventory.remove?.(it.id, it.qty);
  game.stats.dinero = 0;
  // El carro robado queda donde lo cogieron: ya no es suyo.
  game.carjack?.reset?.({ perdido: true });
  if (alVolante) game.carjack?.perderRobado?.();
  if (castigo.horas && typeof game.clock?.hour === 'number') {
    game.clock.hour += castigo.horas;
    while (game.clock.hour >= 24) { game.clock.hour -= 24; game.clock.day = (game.clock.day ?? 0) + 1; }
    // En el calabozo no hay comida: baja, pero sin dejarlo al borde de morirse al salir.
    game.stats.hambre = Math.min(game.stats.hambre, Math.max(CALABOZO_PISO, game.stats.hambre - CALABOZO_HAMBRE));
    game.stats.sed = Math.min(game.stats.sed, Math.max(CALABOZO_PISO, game.stats.sed - CALABOZO_SED));
  }
}

/** Lo que se pierde al morir: la primera mitad de las pilas del costal y lo que no cabe sin la zorra. Se recupera. */
export function cobrarMuerte(game) {
  const half = Math.floor(game.inventory.items.length / 2);
  for (let i = 0; i < half; i++) {
    const it = game.inventory.items[0];
    if (it) game.inventory.remove(it.id, it.qty);
  }
  game.zorraCtl?.alMorir();
  // Recuperar todas las necesidades evita seguir recibiendo daño al reaparecer.
  for (const need of NEEDS) game.stats[need] = Math.max(60, game.stats[need]);
  game.diseases?.cureAll?.();
}

/** La marca que va en la partida mientras hay una pantalla de arresto o de muerte abierta; null si no hay ninguna. */
export function castigoPendiente(game) {
  if (game._arrestPending) {
    const marca = { tipo: 'arresto', nivel: (game._arrestCastigo ?? castigoDeArresto(0)).nivel };
    // Lo cogieron manejando: la partida guarda el carro (aún es `stolen`), pero ese carro ya está perdido.
    if (game.carjack?.car) marca.alVolante = true;
    return marca;
  }
  if (game._deathPending) return { tipo: 'muerte' };
  return null;
}

/** La marca leída de una partida, o null si no hay o no se entiende. */
export function leerCastigoPendiente(dato) {
  if (!dato || typeof dato !== 'object') return null;
  if (dato.tipo === 'muerte') return { tipo: 'muerte' };
  if (dato.tipo === 'arresto') {
    const marca = { tipo: 'arresto', nivel: castigoDeArresto(dato.nivel).nivel };
    if (dato.alVolante === true) marca.alVolante = true;
    return marca;
  }
  return null;
}

/** Al cargar: cobra lo que la partida guardada dejó pendiente. Devuelve si cobró algo. */
export function cobrarCastigoGuardado(game, dato) {
  const pendiente = leerCastigoPendiente(dato);
  if (!pendiente) return false;
  if (pendiente.tipo === 'arresto') cobrarArresto(game, castigoDeArresto(pendiente.nivel), { alVolante: !!pendiente.alVolante });
  else {
    cobrarMuerte(game);
    game.carjack?.reset?.();
  }
  return true;
}

/**
 * Guarda una vez, al abrirse la pantalla, con la marca puesta (`Game._estado` la incluye). Se salta la guarda del
 * guardado solo a propósito: lo que queda escrito es la partida con el castigo por cobrar, no la de antes.
 */
export function guardarConCastigo(game) {
  if (!game.save || !game._save) return false;
  try { return game._save() !== false; } catch (error) {
    console.warn('[Partida] No se pudo guardar el castigo pendiente.', error);
    return false;
  }
}
