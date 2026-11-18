// Medidas de suavidad de una animación muestreada cuadro a cuadro. Sin Three ni DOM: se usa en Node
// (tiras.mjs, pruebas) y en el navegador (pruebas E2E).
//
// Tirón: el salto de velocidad angular de un hueso entre dos cuadros seguidos. Con los cuaterniones
// locales q0, q1, q2 de tres cuadros, w1 = giro(q0→q1)/dt y w2 = giro(q1→q2)/dt (vectores de rotación
// en el marco del hueso); el tirón del cuadro 2 es |w2 − w1| en rad/s. Un movimiento continuo cambia
// de velocidad poco a poco; una pose que «salta» lo hace de golpe.
//
// Patinaje: la velocidad horizontal en el mundo del pie que debería estar plantado (en el piso, a ras
// del suelo y el más bajo de los dos), en m/s.

const conjugar = ([x, y, z, w]) => [-x, -y, -z, w];
const multiplicar = ([ax, ay, az, aw], [bx, by, bz, bw]) => [
  aw * bx + ax * bw + ay * bz - az * by,
  aw * by - ax * bz + ay * bw + az * bx,
  aw * bz + ax * by - ay * bx + az * bw,
  aw * bw - ax * bx - ay * by - az * bz
];

/** Vector de rotación (eje · ángulo, rad) que lleva de `a` a `b`, por el camino corto. */
export function giroEntre(a, b) {
  let [x, y, z, w] = multiplicar(conjugar(a), b);
  if (w < 0) { x = -x; y = -y; z = -z; w = -w; }
  const s = Math.hypot(x, y, z);
  if (s < 1e-9) return [2 * x, 2 * y, 2 * z];
  const angulo = 2 * Math.atan2(s, w);
  return [x / s * angulo, y / s * angulo, z / s * angulo];
}

const percentil = (valores, p) => {
  if (!valores.length) return 0;
  const orden = [...valores].sort((a, b) => a - b);
  return orden[Math.min(orden.length - 1, Math.floor(p * (orden.length - 1) + .5))];
};
const redondear = (valor, cifras = 2) => Number.isFinite(valor) ? +valor.toFixed(cifras) : valor;

/**
 * `cuadros`: [{ dt, huesos: { nombre: [x, y, z, w] } }]. Devuelve por hueso el tirón máximo, el p95,
 * cuántos cuadros pasan de `umbral` y en qué cuadro está el peor; y el resumen de todos.
 */
export function analizarTirones(cuadros, { umbral = 8, desde = 0, hasta = Infinity } = {}) {
  const nombres = Object.keys(cuadros.find(c => c?.huesos)?.huesos ?? {});
  const porHueso = {};
  let peor = { valor: 0, hueso: null, cuadro: -1 }, total = 0;
  const todos = [];
  for (const nombre of nombres) {
    const saltos = [];
    let previo = null, maximo = 0, donde = -1, encima = 0;
    for (let i = 1; i < cuadros.length; i++) {
      const a = cuadros[i - 1]?.huesos?.[nombre], b = cuadros[i]?.huesos?.[nombre];
      const dt = cuadros[i].dt;
      if (!a || !b || !(dt > 0)) { previo = null; continue; }
      const giro = giroEntre(a, b);
      const w = [giro[0] / dt, giro[1] / dt, giro[2] / dt];
      if (previo && i >= desde && i <= hasta) {
        const salto = Math.hypot(w[0] - previo[0], w[1] - previo[1], w[2] - previo[2]);
        saltos.push(salto);
        todos.push(salto);
        if (salto > maximo) { maximo = salto; donde = i; }
        if (salto > umbral) encima++;
      }
      previo = w;
    }
    porHueso[nombre] = { max: redondear(maximo), p95: redondear(percentil(saltos, .95)), encima, cuadro: donde };
    total += encima;
    if (maximo > peor.valor) peor = { valor: redondear(maximo), hueso: nombre, cuadro: donde };
  }
  return { umbral, porHueso, encima: total, peor, p95: redondear(percentil(todos, .95)), p99: redondear(percentil(todos, .99)) };
}

/**
 * `cuadros`: [{ dt, enSuelo, suelo, pies: { izq: [x, y, z], der: [x, y, z] } }] con la punta del pie en
 * el mundo. Los clips no apoyan los dos pies a la misma altura ni a la misma en cada postura, así que
 * cada pie tiene un piso local: la altura mínima de su punta en los cuadros en el suelo a ±`vecinos`
 * cuadros. Un pie está plantado si el cuerpo está en el suelo, su punta queda a menos de `margen` sobre
 * ese piso en este cuadro y en el anterior, casi no sube ni baja (< 1 cm por cuadro) y es el más bajo de
 * los dos respecto a su piso (1 cm de tolerancia). Devuelve la velocidad horizontal de esos pies.
 */
export function analizarPatinaje(cuadros, { margen = .03, vecinos = 40, desde = 0, hasta = Infinity } = {}) {
  const velocidades = [];
  let maximo = 0, donde = -1;
  const altura = (c, lado) => c.pies[lado][1] - (c.suelo ?? 0);
  const piso = (i, lado) => {
    let minimo = Infinity;
    for (let j = Math.max(0, i - vecinos); j <= Math.min(cuadros.length - 1, i + vecinos); j++) {
      if (cuadros[j]?.enSuelo && cuadros[j].pies) minimo = Math.min(minimo, altura(cuadros[j], lado));
    }
    return minimo;
  };
  for (let i = Math.max(1, desde); i < Math.min(cuadros.length, hasta + 1); i++) {
    const a = cuadros[i - 1], b = cuadros[i];
    if (!a?.pies || !b?.pies || !(b.dt > 0) || !a.enSuelo || !b.enSuelo) continue;
    const pisos = { izq: piso(i, 'izq'), der: piso(i, 'der') };
    const alturas = ['izq', 'der'].map(lado => altura(b, lado) - pisos[lado]);
    const bajo = Math.min(...alturas);
    ['izq', 'der'].forEach((lado, k) => {
      const sobre = alturas[k], antes = altura(a, lado) - pisos[lado];
      if (sobre > margen || antes > margen || sobre > bajo + .01 || Math.abs(sobre - antes) > .01) return;
      const v = Math.hypot(b.pies[lado][0] - a.pies[lado][0], b.pies[lado][2] - a.pies[lado][2]) / b.dt;
      velocidades.push(v);
      if (v > maximo) { maximo = v; donde = i; }
    });
  }
  const media = velocidades.length ? velocidades.reduce((s, v) => s + v, 0) / velocidades.length : 0;
  return { muestras: velocidades.length, media: redondear(media), p95: redondear(percentil(velocidades, .95)), max: redondear(maximo), cuadro: donde };
}

/** Altura máxima de la raíz física sobre la de partida, y tiempo en el aire. */
export function analizarSalto(cuadros) {
  const inicio = cuadros.findIndex(c => c.enSuelo === false);
  if (inicio < 0) return { despega: false };
  const base = cuadros[Math.max(0, inicio - 1)].y;
  let apice = -Infinity, fin = cuadros.length - 1;
  for (let i = inicio; i < cuadros.length; i++) {
    apice = Math.max(apice, cuadros[i].y - base);
    if (cuadros[i].enSuelo) { fin = i; break; }
  }
  const aire = cuadros.slice(inicio, fin).reduce((s, c) => s + c.dt, 0);
  return { despega: true, cuadroDespegue: inicio, cuadroAterrizaje: fin, apice: redondear(apice, 3), aire: redondear(aire, 3) };
}

// Mentón, coronilla, centro de la mano y punta de los dedos del modelo realista respecto a la articulación de
// la cabeza, como fracción de la altura de esa articulación de pie (1,484 m en el modelo sin escalar).
const CABEZA_MODELO = 1.484, MENTON = -.025, CORONILLA = .202, MANO = .09, DEDOS = .18;
const restar = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const punto = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unitario = a => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const grados = (a, b) => Math.acos(Math.max(-1, Math.min(1, punto(a, b)))) * 180 / Math.PI;

/**
 * Brazos cuadro a cuadro, de los cuadros con `mundo` (banco.js), en el marco del cuerpo (adelante, afuera y
 * arriba según el rumbo): `hombro` es el ángulo del brazo con la vertical (0 colgando, 90 horizontal, 180
 * arriba), `flexion` y `apertura` lo mismo visto de perfil y de frente, `codo` el ángulo entre brazo y
 * antebrazo (0 estirado), y `muneca`, `mano` y `dedos` la altura sobre el mentón en cm. `lateral` es la
 * distancia del centro de la mano al plano medio del cuerpo (por el medio de los hombros, de costado según el
 * rumbo), positiva de su lado y negativa si cruzó al otro, y `codoFuera` cuánto sale el codo hacia afuera del
 * hombro, los dos en cm. `giro` es lo que giraron el brazo y el antebrazo respecto al tronco (cadera a cuello)
 * desde el cuadro anterior, en grados. `cabeza`: altura de la articulación de la cabeza de pie, que da la
 * escala del modelo.
 */
export function brazosPorCuadro(cuadros, { cabeza = CABEZA_MODELO } = {}) {
  const escala = (cabeza || CABEZA_MODELO) / CABEZA_MODELO;
  const salida = [];
  let previo = null;
  for (const c of cuadros) {
    const w = c?.mundo;
    if (!w?.LeftArm || !w.RightArm || !w.Head) { previo = null; continue; }
    const rumbo = c.rumbo ?? 0;
    const adelante = [Math.sin(rumbo), 0, Math.cos(rumbo)], izquierda = [Math.cos(rumbo), 0, -Math.sin(rumbo)];
    const arribaT = unitario(restar(w.Neck ?? w.Head, w.Hips ?? [w.Head[0], w.Head[1] - 1, w.Head[2]]));
    const adelanteT = unitario(restar(adelante, arribaT.map(v => v * punto(adelante, arribaT))));
    const ladoT = [arribaT[1] * adelanteT[2] - arribaT[2] * adelanteT[1], arribaT[2] * adelanteT[0] - arribaT[0] * adelanteT[2], arribaT[0] * adelanteT[1] - arribaT[1] * adelanteT[0]];
    const menton = w.Head[1] + MENTON * escala;
    const medio = w.LeftArm.map((v, k) => (v + w.RightArm[k]) / 2);
    const fila = { i: c.i, dt: c.dt, enSuelo: c.enSuelo };
    for (const [lado, nombre, signo] of [['izq', 'Left', 1], ['der', 'Right', -1]]) {
      const hombro = w[`${nombre}Arm`], codo = w[`${nombre}ForeArm`], muneca = w[`${nombre}Hand`] ?? null;
      if (!codo) continue;
      const brazo = unitario(restar(codo, hombro)), ante = muneca ? unitario(restar(muneca, codo)) : null;
      const afuera = izquierda.map(v => v * signo);
      const deLado = p => punto(restar(p, medio), afuera);
      const abajo = -brazo[1];
      const datos = {
        hombro: +grados(brazo, [0, -1, 0]).toFixed(1),
        flexion: +(Math.atan2(punto(brazo, adelante), abajo) * 180 / Math.PI).toFixed(1),
        apertura: +(Math.atan2(punto(brazo, afuera), abajo) * 180 / Math.PI).toFixed(1),
        codo: ante ? +grados(brazo, ante).toFixed(1) : null,
        codoFuera: +(100 * (deLado(codo) - deLado(hombro))).toFixed(1)
      };
      if (muneca && ante) {
        datos.lateral = +(100 * deLado(muneca.map((v, k) => v + ante[k] * MANO * escala))).toFixed(1);
        datos.muneca = +(100 * (muneca[1] - menton)).toFixed(1);
        datos.mano = +(100 * (muneca[1] + ante[1] * MANO * escala - menton)).toFixed(1);
        datos.dedos = +(100 * (muneca[1] + ante[1] * DEDOS * escala - menton)).toFixed(1);
        datos.coronilla = +(100 * (muneca[1] + ante[1] * DEDOS * escala - w.Head[1] - CORONILLA * escala)).toFixed(1);
      }
      // Brazo y antebrazo en el marco del tronco, para el giro respecto al cuerpo.
      const enTronco = d => d && [punto(d, adelanteT), punto(d, ladoT), punto(d, arribaT)];
      datos._t = [enTronco(brazo), enTronco(ante)];
      const antes = previo?.[lado]?._t;
      datos.giro = antes ? +Math.max(grados(antes[0], datos._t[0]), antes[1] && datos._t[1] ? grados(antes[1], datos._t[1]) : 0).toFixed(2) : null;
      fila[lado] = datos;
    }
    salida.push(fila);
    previo = fila;
  }
  for (const fila of salida) for (const lado of ['izq', 'der']) if (fila[lado]) delete fila[lado]._t;
  return salida;
}

/**
 * Resumen de los brazos entre los cuadros `desde` y `hasta`: lo más alto que llegan la muñeca, el centro
 * de la mano y la punta de los dedos sobre el mentón (y los dedos sobre la coronilla), el hombro y el codo
 * extremos, la mayor diferencia entre los dos hombros, la racha más larga de cuadros con los dos brazos
 * quietos respecto al tronco (menos de `quieto` grados por cuadro) y el mayor giro de un cuadro. `juntas` es
 * la menor separación entre los centros de las manos de costado y `centro` la mano que más se acerca al plano
 * medio, en cm.
 */
export function analizarBrazos(cuadros, { desde = 0, hasta = Infinity, cabeza, quieto = .5 } = {}) {
  const filas = brazosPorCuadro(cuadros, { cabeza }).filter(f => f.i >= desde && f.i <= hasta && f.izq && f.der);
  const max = (campo, lados = ['izq', 'der']) => {
    let mejor = { valor: -Infinity, cuadro: -1, lado: null };
    for (const f of filas) for (const lado of lados) {
      const v = f[lado][campo];
      if (Number.isFinite(v) && v > mejor.valor) mejor = { valor: v, cuadro: f.i, lado };
    }
    return mejor;
  };
  const min = campo => {
    let mejor = Infinity;
    for (const f of filas) for (const lado of ['izq', 'der']) if (Number.isFinite(f[lado][campo])) mejor = Math.min(mejor, f[lado][campo]);
    return mejor;
  };
  let diferencia = 0, racha = 0, congelados = 0, desdeRacha = -1, congeladosDesde = -1;
  let juntas = { valor: Infinity, cuadro: -1 }, centro = { valor: Infinity, cuadro: -1, lado: null };
  for (const f of filas) {
    diferencia = Math.max(diferencia, Math.abs(f.izq.hombro - f.der.hombro));
    if (Number.isFinite(f.izq.lateral) && Number.isFinite(f.der.lateral)) {
      const sep = f.izq.lateral + f.der.lateral;
      if (sep < juntas.valor) juntas = { valor: redondear(sep, 1), cuadro: f.i };
      for (const lado of ['izq', 'der']) if (f[lado].lateral < centro.valor) centro = { valor: f[lado].lateral, cuadro: f.i, lado };
    }
    const quietos = f.izq.giro !== null && f.der.giro !== null && f.izq.giro < quieto && f.der.giro < quieto;
    if (quietos) { if (!racha) desdeRacha = f.i; racha++; } else racha = 0;
    if (racha > congelados) { congelados = racha; congeladosDesde = desdeRacha; }
  }
  return {
    cuadros: filas.length,
    muneca: max('muneca'), mano: max('mano'), dedos: max('dedos'), coronilla: max('coronilla'),
    hombro: { max: max('hombro').valor, min: min('hombro') }, codo: { max: max('codo').valor, min: min('codo') },
    diferencia: redondear(diferencia, 1), congelados, congeladosDesde, giro: max('giro'), juntas, centro
  };
}

/**
 * Tronco cuadro a cuadro (grados): `inclinacion` de la cadera al cuello respecto a la vertical, de perfil y
 * positiva hacia delante, y `pecho`, el giro de la línea de las clavículas alrededor de la vertical respecto al
 * rumbo, positivo con el hombro izquierdo adelante. Sin clavículas en el esqueleto, `pecho` es null.
 */
export function troncoPorCuadro(cuadros) {
  const salida = [];
  for (const c of cuadros) {
    const w = c?.mundo;
    if (!w?.Hips || !w.Neck) continue;
    const rumbo = c.rumbo ?? 0;
    const adelante = [Math.sin(rumbo), 0, Math.cos(rumbo)], izquierda = [Math.cos(rumbo), 0, -Math.sin(rumbo)];
    const t = restar(w.Neck, w.Hips);
    const linea = w.LeftShoulder && w.RightShoulder ? restar(w.LeftShoulder, w.RightShoulder) : null;
    salida.push({
      i: c.i, enSuelo: c.enSuelo, vy: c.vy,
      inclinacion: +(Math.atan2(punto(t, adelante), t[1]) * 180 / Math.PI).toFixed(1),
      pecho: linea ? +(Math.atan2(punto(linea, adelante), punto(linea, izquierda)) * 180 / Math.PI).toFixed(1) : null
    });
  }
  return salida;
}
