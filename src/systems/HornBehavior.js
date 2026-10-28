// Decide cuándo y cómo pita cada conductor según lo que ocurre frente a él.
// La espera ante un rojo nunca provoca claxon; solo las obstrucciones, los arranques
// lentos, los cruces bloqueados y los frenazos repentinos. Ante alguien que bloquea
// teniendo el carro la vía, el conductor insiste hasta que el camino queda libre.

// Motivos en los que el conductor no se resigna: siguen mientras dure el bloqueo.
const PERSISTENT = new Set(['blocking', 'queue']);
// Motivos que no se aplazan aunque la calle ya esté sonando.
const DIRECT = new Set(['person', 'blocking', 'jaywalk']);

// Cada pulsación es [inicio, duración, fragmento]; `hold` mantiene el claxon el tiempo pedido.
const PATTERNS = {
  tap: random => [[0, .12 + random() * .08, 'honk']],
  double: random => { const length = .1 + random() * .05; return [[0, length, 'honk'], [length + .1 + random() * .06, length, 'honk']]; },
  normal: random => [[0, .32 + random() * .16, 'honk']],
  long: (_random, hold) => [[0, hold, 'hold']],
  // «Pi-pi-piiiii»: dos toques y el claxon sostenido.
  insist: (_random, hold) => [[0, .13, 'honk'], [.27, .13, 'honk'], [.54, hold, 'hold']]
};

/** Temperamento sesgado hacia la calma: pocos conductores son impacientes. */
export function createDriver(random, source = null) {
  const temper = source?.temper ?? random() ** 1.6;
  return {
    temper, patience: .7 + random() * .8, hornIndex: Math.floor(random() * 3),
    hornLevel: .38 + random() * .1, maxHonks: 1 + Math.floor(temper * 3.2),
    reason: null, waited: 0, calm: 0, honks: 0, cooldown: 0, reflex: null, seenBrakes: 0, jitter: 0
  };
}

/** Quién tiene la vía frente a una persona: sin dato, un carro detenido por otro motivo no la tiene. */
function personPriority(source) {
  return source.personPriority ?? (source.blockReason && source.blockReason !== 'person' ? 'pedestrian' : 'vehicle');
}

/** Motivo de impaciencia, siguiendo la cola hasta su cabeza. */
export function hornReason(source) {
  if (source.personBlocked) {
    // Quien maniobra para rodear está ocupado conduciendo.
    if (source.detour) return null;
    const pedestrian = source.personBlocker === 'pedestrian';
    // Con rojo el peatón está en su derecho; solo molesta quien se planta contra el parachoques.
    if (personPriority(source) === 'pedestrian') return pedestrian ? null : 'person';
    if (source.personStanding ?? !pedestrian) return 'blocking';
    // Cruzar por la cebra se tolera; atravesarse donde no hay paso, no tanto.
    return source.personOnCrosswalk === false ? 'jaywalk' : 'pedestrian';
  }
  if (!(source.speed < .3) || (source.blockReason !== 'car' && source.blockReason !== 'cross')) return null;
  let head = source;
  for (let i = 0; i < 16 && head.blockReason === 'car' && head.blocker; i++) head = head.blocker;
  // Toda la cola espera un semáforo: nadie tiene a quién pitar.
  if (head.blockReason === 'signal') return null;
  // La fila detenida por alguien que estorba al primero también protesta, cada uno a su ritmo.
  if (head.blockReason === 'person') return head.detour || personPriority(head) === 'pedestrian' ? null : 'queue';
  if (head.blockReason === 'cross') {
    // Ceder el paso a quien cruza es normal, y quien espera su propio semáforo no tiene la culpa;
    // un carro detenido sin motivo en mitad del cruce sí.
    const crossing = head.blocker;
    if (crossing?.blockReason === 'signal') return null;
    return (crossing?.speed ?? crossing?.car?.speed ?? 0) > .5 ? null : 'jam';
  }
  // La cabeza ya arrancó y este carro sigue quieto: se demora el de adelante.
  return head === source ? null : 'lag';
}

function threshold(driver, reason, source) {
  const calm = 1.4 - driver.temper * .8;
  if (reason === 'person') return driver.patience * calm;
  // Al jugador plantado se le pita pronto; un peatón detenido recibe algo más de margen.
  if (reason === 'blocking') return (driver.patience + (source.personBlocker === 'pedestrian' ? 1.5 : 0)) * calm;
  if (reason === 'jaywalk') return (.6 + driver.patience) * calm;
  // Un peatón casi siempre va cruzando: solo quien se demora recibe la pitada.
  if (reason === 'pedestrian') return (1.5 + driver.patience * 2) * calm;
  // En la fila no todos protestan, y quienes lo hacen no coinciden.
  if (reason === 'queue') return driver.temper > .15 ? (2.5 + driver.patience * 3 + driver.jitter) * (1.35 - driver.temper) : Infinity;
  if (reason === 'lag') return driver.temper > .45 ? 2.5 + driver.patience * 2.5 : Infinity;
  return driver.temper > .2 ? (6 + driver.patience * 6) * (1.3 - driver.temper) : Infinity;
}

/** Patrón y, si el claxon se mantiene, cuántos segundos. */
function choosePattern(driver, reason, random) {
  const { temper, honks } = driver;
  const hold = seconds => ({ pattern: 'long', hold: seconds });
  if (reason === 'reflex') return temper > .7 && random() < .5 ? hold(.6 + random() * .4) : { pattern: temper > .4 ? 'double' : 'tap' };
  if (reason === 'lag') return { pattern: temper > .75 && random() < .4 ? 'double' : 'tap' };
  // Quien insiste pita cada vez más largo.
  const insistence = temper + honks * .35 + random() * .2;
  if (reason === 'blocking') {
    // El impaciente mantiene el claxon, y cada vez más tiempo; el tranquilo empieza con toques.
    if (insistence < .55) return { pattern: insistence > .45 ? 'double' : 'tap' };
    const seconds = Math.min(4.5, 1 + (insistence - .55) * 2 + random() * .8);
    return { pattern: random() < .3 ? 'insist' : 'long', hold: seconds };
  }
  if (reason === 'queue') return insistence > .75 ? hold(.8 + random() * 1.2) : { pattern: insistence > .45 ? 'double' : 'tap' };
  if (reason === 'jaywalk') return insistence > .65 ? hold(.9 + random() * .8) : { pattern: insistence > .4 ? 'normal' : 'double' };
  if (reason === 'person' || reason === 'pedestrian') return insistence > .95 ? hold(.8 + random() * .4) : { pattern: insistence > .55 ? 'double' : 'tap' };
  return insistence > .8 ? hold(1 + random()) : { pattern: insistence > .5 ? 'normal' : 'double' };
}

export function hornPresses(pattern, random, hold = 1) {
  return PATTERNS[pattern](random, hold);
}

/**
 * Avanza la espera del conductor y devuelve el claxon que decide tocar, si lo hay.
 * `crowded` indica que la calle ya suena: los impacientes no urgentes esperan un poco.
 */
export function updateDriver(driver, source, dt, random, crowded = false) {
  driver.cooldown = Math.max(0, driver.cooldown - dt);
  // Un frenazo por algo que se atraviesa provoca un toque reflejo, sin paciencia previa.
  const brakes = source.suddenBrakes ?? 0;
  if (brakes > driver.seenBrakes) {
    driver.seenBrakes = brakes;
    if (!driver.reflex && random() < .1 + .6 * driver.temper) driver.reflex = { delay: .2 + random() * .25 };
  }
  if (driver.reflex) {
    driver.reflex.delay -= dt;
    if (driver.reflex.delay <= 0) {
      driver.reflex = null;
      if (driver.cooldown < 1) return { reason: 'reflex', ...choosePattern(driver, 'reflex', random) };
    }
  }
  const reason = hornReason(source);
  if (!reason) {
    // Una pausa breve no cierra el incidente: quien ya pitó no vuelve a empezar de cero.
    driver.calm += dt;
    if (driver.calm > 1.5) { driver.reason = null; driver.waited = 0; driver.honks = 0; }
    return null;
  }
  driver.calm = 0;
  if (reason !== driver.reason) {
    // Pasar de protestar por un cruce a un bloqueo de la misma persona conserva la insistencia.
    const escalation = PERSISTENT.has(reason) && (driver.reason === 'pedestrian' || driver.reason === 'jaywalk');
    driver.reason = reason; driver.jitter = random() * 3;
    if (!escalation) { driver.waited = 0; driver.honks = 0; }
  }
  driver.waited += dt;
  const limit = PERSISTENT.has(reason) ? Infinity : reason === 'lag' || reason === 'pedestrian' ? 1 : reason === 'jaywalk' ? 2 : driver.maxHonks;
  if (driver.cooldown > 0 || driver.honks >= limit || driver.waited < threshold(driver, reason, source)) return null;
  if (crowded && !DIRECT.has(reason)) { driver.waited -= 1.5 + random() * 2; return null; }
  return { reason, ...choosePattern(driver, reason, random) };
}

/**
 * Registra la pitada: cada insistencia llega más tarde. En los bloqueos persistentes el
 * intervalo deja de crecer y el conductor sigue recordando que está esperando.
 */
export function commitHonk(driver, reason, random, hold = 0) {
  if (reason !== 'reflex') driver.honks++;
  const interval = (2.2 + random() * 2.8) * (1 + driver.honks * .6) * (1.3 - driver.temper * .6);
  const cap = (5 + (1 - driver.temper) * 9) * (reason === 'queue' ? 1.5 : 1);
  // La siguiente pitada no empieza antes de soltar la anterior.
  driver.cooldown = Math.max(hold + .8, PERSISTENT.has(reason) ? Math.min(interval, cap) : interval);
}
