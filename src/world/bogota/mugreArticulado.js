/**
 * Mapa de mugre del articulado: un solo lienzo para todo el bus, sin repetirse. Cada costado, el techo y los dos extremos
 * tienen su zona; el mapa multiplica la pintura, así que el blanco la deja intacta.
 */
export const MUGRE_ANCHO = 1024, MUGRE_ALTO = 512;
const ZONAS = {
  izquierda: [0, 0, 1024, 192], derecha: [0, 192, 1024, 384],
  cola: [0, 384, 128, 512], frente: [128, 384, 256, 512], techo: [256, 384, 1024, 512]
};
// Holgura entre zonas: el mipmap no mezcla una con otra.
const HOLGURA = 3;
const LARGO = 11.1, ANCHO = 1.4, PISO = .4, ALTO = 3.15, ALTO_EXTREMO = 3.55;
// Borde de arriba de la defensa en los dos extremos.
export const DEFENSA = .572;
// Bajo el voladizo derecho de la cola, donde sale el escape.
export const ESCAPE = Object.freeze({ x: -.86, y: .36, z: -11 });

const limitar = (v, a, b) => Math.min(b, Math.max(a, v));
const enZona = (zona, fx, fy) => {
  const [x0, y0, x1, y1] = ZONAS[zona];
  return [x0 + HOLGURA + limitar(fx, 0, 1) * (x1 - x0 - 2 * HOLGURA), y1 - HOLGURA - limitar(fy, 0, 1) * (y1 - y0 - 2 * HOLGURA)];
};
const comoUv = ([x, y]) => [x / MUGRE_ANCHO, 1 - y / MUGRE_ALTO];

const enCostado = (s, z, y) => enZona(s > 0 ? 'izquierda' : 'derecha', (z + LARGO) / (2 * LARGO), (y - PISO) / ALTO);
const enTecho = (z, x) => enZona('techo', (z + LARGO) / (2 * LARGO), (x + ANCHO) / (2 * ANCHO));
const enExtremo = (cola, x, y) => enZona(cola ? 'cola' : 'frente', (x + ANCHO) / (2 * ANCHO), (y - PISO) / (ALTO_EXTREMO - PISO));

export const uvCostado = (p, s) => comoUv(enCostado(s, p[2], p[1]));
export const uvTecho = p => comoUv(enTecho(p[2], p[0]));
export const uvExtremo = (p, cola) => comoUv(enExtremo(cola, p[0], p[1]));

/** Los puntos del techo caen en una zona propia; el material los deja mates sin otra textura. */
export const TECHO_UV = Object.freeze({ u: comoUv([ZONAS.techo[0], 0])[0], v: comoUv([0, ZONAS.techo[1]])[1] });

/**
 * Pinta el mapa. `ventanas` trae los vanos de cada costado en Z ([z0, z1]) y `ruedas` el centro en Z de cada paso de rueda;
 * `aire` y `escotillas` son los equipos del techo (centro en Z).
 */
export function pintarMugreArticulado(ctx, w, h, { ventanas, ruedas, aire, escotillas }) {
  let semilla = 4821;
  const azar = () => (semilla = (semilla * 16807) % 2147483647) / 2147483647;
  const metros = (zona, m) => m / (2 * LARGO) * (ZONAS[zona][2] - ZONAS[zona][0]);
  const pxPorMetroY = (ZONAS.izquierda[3] - ZONAS.izquierda[1] - 2 * HOLGURA) / ALTO;
  const recortar = (zona, dibujar) => {
    const [x0, y0, x1, y1] = ZONAS[zona];
    ctx.save(); ctx.beginPath(); ctx.rect(x0, y0, x1 - x0, y1 - y0); ctx.clip(); dibujar(); ctx.restore();
  };
  const mancha = (x, y, rx, ry, color, alfa) => {
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, `rgba(${color},${alfa})`); g.addColorStop(.55, `rgba(${color},${alfa * .45})`); g.addColorStop(1, `rgba(${color},0)`);
    ctx.save(); ctx.translate(x, y); ctx.scale(Math.max(rx, .5), Math.max(ry, .5)); ctx.fillStyle = g; ctx.fillRect(-1, -1, 2, 2); ctx.restore();
  };
  const chorreon = (x, y, largo, ancho, color, alfa) => {
    const g = ctx.createLinearGradient(0, y, 0, y + largo);
    g.addColorStop(0, `rgba(${color},${alfa})`); g.addColorStop(.35, `rgba(${color},${alfa * .7})`); g.addColorStop(1, `rgba(${color},0)`);
    ctx.fillStyle = g;
    // Un chorreón no baja recto: se tuerce un pelo y se adelgaza.
    ctx.beginPath(); ctx.moveTo(x - ancho / 2, y); ctx.lineTo(x + ancho / 2, y);
    const torcido = (azar() - .5) * ancho * 1.5;
    ctx.lineTo(x + torcido + ancho * .2, y + largo); ctx.lineTo(x + torcido - ancho * .2, y + largo); ctx.closePath(); ctx.fill();
  };
  const BARRO = '86,68,50', HOLLIN = '22,21,20', AGUA = '58,54,50', POLVO = '104,96,86';
  // La defensa sale clara del color por vértice: aquí se oscurece entera menos los raspones.
  const defensa = cola => {
    const [xa, ya] = enExtremo(cola, -1.34, DEFENSA), [xb, yb] = enExtremo(cola, 1.34, PISO);
    ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.fillRect(xa, ya, xb - xa, yb - ya);
    for (let i = 0; i < 16; i++) {
      const [x, y] = enExtremo(cola, (azar() - .5) * 2.3, PISO + .03 + azar() * (DEFENSA - PISO - .05));
      ctx.fillStyle = `rgba(255,255,255,${.35 + azar() * .45})`;
      ctx.fillRect(x, y, 3 + azar() * 12, 1);
    }
  };

  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);

  for (const [zona, s] of [['izquierda', 1], ['derecha', -1]]) recortar(zona, () => {
    const [x0, y0, x1, y1] = ZONAS[zona];
    const [, suelo] = enCostado(s, 0, PISO), [, cintura] = enCostado(s, 0, 1.45), [, canal] = enCostado(s, 0, 3.03), [, ventana] = enCostado(s, 0, 1.56);
    // El tercio bajo lleva el polvo de la troncal: barro abajo y una película que se apaga hacia la ventana.
    const barro = ctx.createLinearGradient(0, suelo, 0, cintura);
    barro.addColorStop(0, `rgba(${BARRO},.68)`); barro.addColorStop(.3, `rgba(${BARRO},.36)`); barro.addColorStop(.7, `rgba(${POLVO},.12)`); barro.addColorStop(1, `rgba(${POLVO},0)`);
    ctx.fillStyle = barro; ctx.fillRect(x0, cintura, x1 - x0, y1 - cintura);
    // Detrás de cada rueda, el abanico de agua sucia que levanta la llanta.
    for (const c of ruedas) {
      const [rx, ry] = enCostado(s, c - .55, .62);
      mancha(rx, ry, metros(zona, 1.6), pxPorMetroY * .55, BARRO, .5);
      mancha(rx - metros(zona, .9), ry + pxPorMetroY * .12, metros(zona, 1.1), pxPorMetroY * .4, BARRO, .32);
    }
    for (let i = 0; i < 1400; i++) {
      const x = x0 + azar() * (x1 - x0), y = suelo - Math.pow(azar(), 2.4) * (suelo - cintura);
      ctx.fillStyle = `rgba(${BARRO},${.06 + azar() * .16})`;
      ctx.fillRect(x, y, 1 + azar() * 2.5, 1 + azar() * 2);
    }
    // Chorreones bajo las ventanas: el agua baja por las esquinas del vano y por el centro.
    for (const [a, b] of ventanas[s > 0 ? 'izquierda' : 'derecha']) {
      for (const z of [a + .06, b - .06, a + (b - a) * (.3 + azar() * .4), a + (b - a) * azar()]) {
        const [x] = enCostado(s, z, 1.5);
        chorreon(x, ventana, pxPorMetroY * (.25 + azar() * .45), 3 + azar() * 4, AGUA, .3 + azar() * .2);
      }
    }
    // Y desde la canal del techo, sobre el friso y los pilares.
    for (let z = -LARGO + .2; z < LARGO; z += .25 + azar() * .55) {
      const [x] = enCostado(s, z, 3);
      chorreon(x, canal, pxPorMetroY * (.12 + azar() * .5), 2 + azar() * 3, AGUA, .2 + azar() * .2);
    }
    // Hollín de la cola: el escape sale atrás a la derecha y el remolino ennegrece los últimos metros de los dos costados.
    const [colaX] = enCostado(s, -LARGO, 1), [hastaX] = enCostado(s, -8.6, 1);
    const hollin = ctx.createLinearGradient(colaX, 0, hastaX, 0);
    const fuerza = s < 0 ? 1 : .6;
    hollin.addColorStop(0, `rgba(${HOLLIN},${.42 * fuerza})`); hollin.addColorStop(.35, `rgba(${HOLLIN},${.18 * fuerza})`); hollin.addColorStop(1, `rgba(${HOLLIN},0)`);
    ctx.fillStyle = hollin; ctx.fillRect(colaX, y0, hastaX - colaX, y1 - y0);
    if (s < 0) {
      const [ex, ey] = enCostado(s, ESCAPE.z + .3, ESCAPE.y + .1);
      mancha(ex, ey, metros(zona, 1.4), pxPorMetroY * .9, HOLLIN, .6);
    }
    // Polvo en parches a media altura: rompe la igualdad del color.
    for (let i = 0; i < 70; i++) {
      const x = x0 + azar() * (x1 - x0), y = y0 + azar() * (y1 - y0), r = 10 + azar() * 40;
      mancha(x, y, r * 1.6, r, POLVO, .03 + azar() * .05);
    }
  });

  recortar('techo', () => {
    const [x0, y0, x1, y1] = ZONAS.techo;
    // Percudido parejo, más gris hacia las orillas por donde corre el agua.
    ctx.fillStyle = 'rgba(150,144,134,.42)'; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    for (const borde of [-1.25, 1.25]) {
      const [, y] = enTecho(0, borde);
      const g = ctx.createLinearGradient(0, y - 10, 0, y + 10);
      g.addColorStop(0, `rgba(${AGUA},0)`); g.addColorStop(.5, `rgba(${AGUA},.4)`); g.addColorStop(1, `rgba(${AGUA},0)`);
      ctx.fillStyle = g; ctx.fillRect(x0, y - 10, x1 - x0, 20);
    }
    // Marcas largas del agua estancada.
    for (let i = 0; i < 90; i++) {
      const [x, y] = enTecho(-LARGO + azar() * 2 * LARGO, (azar() - .5) * 2.4);
      ctx.fillStyle = `rgba(${AGUA},${.05 + azar() * .1})`;
      ctx.fillRect(x, y, 6 + azar() * 60, 1 + azar() * 2.5);
    }
    for (let i = 0; i < 60; i++) {
      const [x, y] = enTecho(-LARGO + azar() * 2 * LARGO, (azar() - .5) * 2.5);
      mancha(x, y, 8 + azar() * 30, 4 + azar() * 12, POLVO, .08 + azar() * .1);
    }
    // El equipo de aire y las escotillas juntan mugre alrededor y encima, entre las rejillas.
    for (const z of aire) {
      const [cx, cy] = enTecho(z, 0);
      mancha(cx, cy, metros('techo', 1.9), 60, HOLLIN, .26);
      for (let i = 0; i < 40; i++) {
        const [x, y] = enTecho(z + (azar() - .5) * 2.6, (azar() - .5) * 2);
        mancha(x, y, 3 + azar() * 10, 2 + azar() * 5, BARRO, .1 + azar() * .18);
      }
    }
    for (const z of escotillas) {
      const [cx, cy] = enTecho(z, 0);
      mancha(cx, cy, metros('techo', .7), 26, HOLLIN, .3);
    }
    // Los últimos metros sobre el motor van ennegrecidos.
    const [colaX] = enTecho(-LARGO, 0), [hastaX] = enTecho(-8.4, 0);
    const g = ctx.createLinearGradient(colaX, 0, hastaX, 0);
    g.addColorStop(0, `rgba(${HOLLIN},.45)`); g.addColorStop(1, `rgba(${HOLLIN},0)`);
    ctx.fillStyle = g; ctx.fillRect(colaX, y0, hastaX - colaX, y1 - y0);
  });

  recortar('cola', () => {
    const [x0, y0, x1, y1] = ZONAS.cola;
    defensa(true);
    // Película de hollín que el remolino deja en toda la tapa, más densa abajo.
    const [, arriba] = enExtremo(true, 0, ALTO_EXTREMO), [, abajo] = enExtremo(true, 0, PISO);
    const pelicula = ctx.createLinearGradient(0, abajo, 0, arriba);
    pelicula.addColorStop(0, `rgba(${HOLLIN},.4)`); pelicula.addColorStop(.4, `rgba(${HOLLIN},.2)`); pelicula.addColorStop(1, `rgba(${HOLLIN},.1)`);
    ctx.fillStyle = pelicula; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    const [ex, ey] = enExtremo(true, ESCAPE.x, ESCAPE.y + .14);
    mancha(ex, ey, 34, 30, HOLLIN, .62);
    mancha(ex + 8, ey - 22, 26, 34, HOLLIN, .35);
    // Grasa alrededor de la rejilla del motor.
    const [gx, gy] = enExtremo(true, 0, 1.12);
    mancha(gx, gy, 44, 16, HOLLIN, .32);
    for (let i = 0; i < 26; i++) {
      const [x, y] = enExtremo(true, (azar() - .5) * 2.6, 2.9 + azar() * .3);
      chorreon(x, y, 8 + azar() * 30, 1 + azar() * 2, HOLLIN, .14 + azar() * .14);
    }
    for (let i = 0; i < 260; i++) {
      const [x, y] = enExtremo(true, (azar() - .5) * 2.7, PISO + Math.pow(azar(), 2) * .9);
      ctx.fillStyle = `rgba(${BARRO},${.08 + azar() * .16})`; ctx.fillRect(x, y, 1 + azar() * 2, 1 + azar() * 2);
    }
  });

  recortar('frente', () => {
    const [x0, , x1] = ZONAS.frente;
    defensa(false);
    const [, abajo] = enExtremo(false, 0, PISO), [, medio] = enExtremo(false, 0, 1.1);
    const polvo = ctx.createLinearGradient(0, abajo, 0, medio);
    polvo.addColorStop(0, `rgba(${BARRO},.42)`); polvo.addColorStop(1, `rgba(${POLVO},0)`);
    ctx.fillStyle = polvo; ctx.fillRect(x0, medio, x1 - x0, abajo - medio);
    for (let i = 0; i < 180; i++) {
      const [x, y] = enExtremo(false, (azar() - .5) * 2.7, PISO + Math.pow(azar(), 1.6) * .8);
      ctx.fillStyle = `rgba(${HOLLIN},${.06 + azar() * .12})`; ctx.fillRect(x, y, 1 + azar() * 1.5, 1 + azar() * 1.5);
    }
    for (let i = 0; i < 16; i++) {
      const [x, y] = enExtremo(false, (azar() - .5) * 2.6, 3 + azar() * .2);
      chorreon(x, y, 6 + azar() * 22, 1 + azar() * 2, AGUA, .12 + azar() * .12);
    }
  });
}
