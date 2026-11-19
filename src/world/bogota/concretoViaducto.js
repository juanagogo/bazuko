import * as THREE from 'three';

// Concreto gastado del viaducto y del Metro: un solo lienzo pintado al arrancar, partido en columnas.
// A lo largo (V) se repite cada 8 m; a lo ancho (U) cada pieza usa su columna:
//   canto izquierdo | losa de abajo | canto derecho | pilar limpio | pilar con carteles | barrera | tapa | liso
// Las piezas no cambian de material ni de malla: solo reescriben sus UV hacia su columna.

const ANCHO = 1024, ALTO = 512, PERIODO = 8;
const columna = (a, b, margen = 2) => [(a + margen) / ANCHO, (b - margen) / ANCHO];
const C = {
  cantoIzq: [2 / ANCHO, 64 / ANCHO], losa: [64 / ANCHO, 704 / ANCHO], cantoDer: [704 / ANCHO, 766 / ANCHO],
  pilarA: columna(768, 832), pilarB: columna(832, 896), pilar: columna(768, 896),
  barrera: columna(896, 944), tapa: columna(944, 960), liso: columna(960, 1024)
};
const en = ([a, b], t) => a + (b - a) * t;
const alto = v => .004 + v * .992;

/** Azar propio: lo pintado no depende del azar de la ciudad. */
export function azarPropio(semilla) {
  let a = semilla >>> 0;
  return () => {
    a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/** Three sortea un identificador por textura: las de aquí nacen sin gastar el azar de la ciudad. */
export function sinGastarAzar(semilla, crear) {
  const delJuego = Math.random;
  Math.random = azarPropio(semilla);
  try { return crear(); } catch { return null; } finally { Math.random = delJuego; }
}

export function lienzo(ancho, altura) {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = ancho; canvas.height = altura;
  const ctx = canvas.getContext('2d');
  return ctx ? { canvas, ctx } : null;
}

function mancha(ctx, x, y, rx, ry, color, alfa) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, Math.max(rx, ry));
  g.addColorStop(0, `rgba(${color},${alfa})`); g.addColorStop(.6, `rgba(${color},${alfa * .55})`); g.addColorStop(1, `rgba(${color},0)`);
  ctx.save(); ctx.translate(x, y); ctx.scale(rx / Math.max(rx, ry), ry / Math.max(rx, ry)); ctx.translate(-x, -y);
  ctx.fillStyle = g; ctx.fillRect(x - Math.max(rx, ry), y - Math.max(rx, ry), Math.max(rx, ry) * 2, Math.max(rx, ry) * 2);
  ctx.restore();
}

function veteado(ctx, rnd, x0, x1, cuantas) {
  for (let i = 0; i < cuantas; i++) {
    const w = 6 + rnd() * 38, h = 6 + rnd() * 44, claro = rnd() < .5;
    ctx.fillStyle = claro ? `rgba(214,212,200,${.03 + rnd() * .05})` : `rgba(58,58,52,${.03 + rnd() * .06})`;
    ctx.fillRect(x0 + rnd() * (x1 - x0 - w), rnd() * ALTO - h / 2, w, h);
  }
}

function pintar(ctx, rnd) {
  ctx.fillStyle = '#a6a59c'; ctx.fillRect(0, 0, ANCHO, ALTO);
  // Todo se dibuja tres veces (arriba, en su sitio y abajo) para que el lienzo empate al repetirse a lo largo.
  const pasos = [];
  // Cada pasada repite los mismos sorteos: por eso cada capa lleva su semilla.
  const capa = (x0, x1, dibujar) => {
    const semilla = Math.floor(rnd() * 0xffffffff);
    pasos.push((fondo) => { ctx.save(); ctx.beginPath(); ctx.rect(x0, -ALTO, x1 - x0, ALTO * 3); ctx.clip(); dibujar(azarPropio(semilla), fondo); ctx.restore(); });
  };

  // --- Losa de abajo (14 m de ancho): vigas, formaleta, junta de dilatación con gotera, humedad y sal.
  capa(64, 704, (rnd, fondo) => {
    if (fondo) { ctx.fillStyle = '#a2a198'; ctx.fillRect(64, 0, 640, ALTO); }
    veteado(ctx, rnd, 64, 704, 520);
    for (const centro of [.14, .38, .62, .86]) {
      const x = 64 + 640 * centro;
      ctx.fillStyle = 'rgba(190,188,178,.22)'; ctx.fillRect(x - 27, 0, 54, ALTO);
      ctx.fillStyle = 'rgba(20,20,18,.34)'; ctx.fillRect(x - 30, 0, 4, ALTO);
      ctx.fillStyle = 'rgba(20,20,18,.2)'; ctx.fillRect(x + 27, 0, 3, ALTO);
      ctx.fillStyle = 'rgba(230,228,216,.16)'; ctx.fillRect(x - 26, 0, 2, ALTO);
    }
    for (let i = 0; i < 6; i++) {
      const y = Math.round((i + .5) * ALTO / 6);
      ctx.fillStyle = 'rgba(40,40,36,.3)'; ctx.fillRect(64, y, 640, 1);
      ctx.fillStyle = 'rgba(225,223,212,.14)'; ctx.fillRect(64, y + 1, 640, 1);
    }
    for (let i = 0; i < 16; i++) mancha(ctx, 64 + rnd() * 640, rnd() * ALTO, 18 + rnd() * 60, 14 + rnd() * 50, '70,78,66', .16 + rnd() * .16);
    for (let i = 0; i < 9; i++) mancha(ctx, 64 + rnd() * 640, rnd() * ALTO, 8 + rnd() * 26, 6 + rnd() * 18, '222,220,208', .14 + rnd() * .14);
    // Desagües cerca de los bordes: aureola oscura con corazón de óxido.
    for (const y of [128, 384]) for (const x of [64 + 26, 704 - 26]) {
      mancha(ctx, x, y, 26, 34, '48,50,44', .42); mancha(ctx, x, y, 9, 12, '122,90,60', .5);
    }
    // Junta de dilatación en el empate, con lo que escurre a los lados.
    for (let i = 0; i < 26; i++) {
      const x = 64 + rnd() * 640;
      mancha(ctx, x, (rnd() - .5) * 26, 10 + rnd() * 30, 8 + rnd() * 26, '44,46,40', .2 + rnd() * .22);
      if (rnd() < .4) mancha(ctx, x + 8, (rnd() - .5) * 40, 6 + rnd() * 14, 5 + rnd() * 10, '226,224,212', .22);
    }
    ctx.fillStyle = 'rgba(18,18,16,.72)'; ctx.fillRect(64, -2, 640, 4);
    // El agua le da la vuelta al borde y ensucia la orilla de la losa.
    for (const [x, dir] of [[64, 1], [704, -1]]) {
      const g = ctx.createLinearGradient(x, 0, x + dir * 34, 0);
      g.addColorStop(0, 'rgba(40,42,36,.5)'); g.addColorStop(1, 'rgba(40,42,36,0)');
      ctx.fillStyle = g; ctx.fillRect(Math.min(x, x + dir * 34), 0, 34, ALTO);
    }
  });

  // --- Cantos del tablero: el borde de arriba queda afuera del lienzo; los chorreones bajan hacia la losa.
  for (const [x0, arriba, dir] of [[0, 0, 1], [704, 768, -1]]) capa(x0, x0 + 64, (rnd, fondo) => {
    if (fondo) { ctx.fillStyle = '#aeada3'; ctx.fillRect(x0, 0, 64, ALTO); }
    veteado(ctx, rnd, x0, x0 + 64, 60);
    for (let i = 0; i < 46; i++) {
      const y = rnd() * ALTO, largo = 18 + rnd() * 46, grueso = 2 + rnd() * 6;
      const g = ctx.createLinearGradient(arriba, 0, arriba + dir * largo, 0);
      const fuerza = .16 + rnd() * .3;
      g.addColorStop(0, `rgba(46,44,40,${fuerza})`); g.addColorStop(1, 'rgba(46,44,40,0)');
      ctx.fillStyle = g; ctx.fillRect(Math.min(arriba, arriba + dir * largo), y, largo, grueso);
    }
    for (let i = 0; i < 4; i++) { ctx.fillStyle = 'rgba(36,36,32,.34)'; ctx.fillRect(x0, Math.round(i * ALTO / 4), 64, 2); }
    ctx.fillStyle = 'rgba(232,230,218,.3)'; ctx.fillRect(dir > 0 ? arriba : arriba - 5, 0, 5, ALTO);
    ctx.fillStyle = 'rgba(30,30,26,.42)'; ctx.fillRect(dir > 0 ? x0 + 57 : x0, 0, 7, ALTO);
  });

  // El fondo solo se pinta en su sitio y antes que las copias de arriba y de abajo: si no, taparía lo que asoma de ellas.
  pasos.forEach(paso => { for (const dy of [0, -ALTO, ALTO]) { ctx.save(); ctx.translate(0, dy); paso(dy === 0); ctx.restore(); } });

  // --- Pilares (no se repiten a lo alto): arriba del lienzo es la cabeza, abajo el pie.
  ctx.save(); ctx.beginPath(); ctx.rect(768, 0, 128, ALTO); ctx.clip();
  ctx.fillStyle = '#a8a79e'; ctx.fillRect(768, 0, 128, ALTO);
  veteado(ctx, rnd, 768, 896, 150);
  for (let i = 1; i < 6; i++) {
    const y = Math.round(i * ALTO / 6);
    ctx.fillStyle = 'rgba(36,36,32,.36)'; ctx.fillRect(768, y, 128, 2);
    ctx.fillStyle = 'rgba(228,226,214,.16)'; ctx.fillRect(768, y + 2, 128, 1);
  }
  ctx.fillStyle = 'rgba(30,30,28,.55)';
  for (let i = 0; i < 6; i++) for (const x of [784, 816, 848, 880]) {
    ctx.beginPath(); ctx.arc(x, (i + .5) * ALTO / 6, 2.2, 0, Math.PI * 2); ctx.fill();
  }
  for (let i = 0; i < 13; i++) {
    const x = 770 + rnd() * 122, largo = 50 + rnd() * 260, grueso = 3 + rnd() * 9, fuerza = .18 + rnd() * .28;
    const g = ctx.createLinearGradient(0, 0, 0, largo);
    g.addColorStop(0, `rgba(44,42,38,${fuerza})`); g.addColorStop(1, 'rgba(44,42,38,0)');
    ctx.fillStyle = g; ctx.fillRect(x, 0, grueso, largo);
  }
  for (let i = 0; i < 5; i++) mancha(ctx, 768 + rnd() * 128, 90 + rnd() * 260, 14 + rnd() * 24, 20 + rnd() * 50, '70,78,66', .2 + rnd() * .14);
  for (let i = 0; i < 3; i++) mancha(ctx, 768 + rnd() * 128, 60 + rnd() * 200, 8 + rnd() * 12, 14 + rnd() * 26, '122,90,60', .2);
  // Restos de carteles pegados y arrancados, sin letras, solo en la mitad derecha.
  for (const [x, y, w, h, tono] of [[838, 352, 30, 44, '205,198,176'], [866, 366, 24, 34, '188,180,160'], [846, 404, 36, 30, '176,150,132']]) {
    ctx.fillStyle = `rgba(${tono},.62)`; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = 'rgba(60,58,52,.22)';
    for (let k = 0; k < 4; k++) ctx.fillRect(x + 3, y + 6 + k * 7, w * (.4 + rnd() * .5), 2);
    ctx.fillStyle = '#a8a79e';
    for (let k = 0; k < 5; k++) ctx.fillRect(x + rnd() * w - 4, y + (rnd() < .5 ? -2 : h - 6), 6 + rnd() * 10, 5 + rnd() * 8);
  }
  const hollin = ctx.createLinearGradient(0, ALTO - 150, 0, ALTO);
  hollin.addColorStop(0, 'rgba(47,45,42,0)'); hollin.addColorStop(.6, 'rgba(47,45,42,.38)'); hollin.addColorStop(1, 'rgba(40,36,32,.7)');
  ctx.fillStyle = hollin; ctx.fillRect(768, ALTO - 150, 128, 150);
  for (let i = 0; i < 40; i++) { ctx.fillStyle = `rgba(74,62,50,${.1 + rnd() * .2})`; ctx.fillRect(768 + rnd() * 128, ALTO - rnd() * 46, 2 + rnd() * 7, 3 + rnd() * 12); }
  ctx.restore();

  // --- Barrera (48 px de pie a cabeza), su tapa y el concreto liso de barandas y vigas: se repiten a lo largo.
  const franja = (x0, x1, base, juntas, chorreones) => {
    ctx.save(); ctx.beginPath(); ctx.rect(x0, 0, x1 - x0, ALTO); ctx.clip();
    ctx.fillStyle = base; ctx.fillRect(x0, 0, x1 - x0, ALTO);
    for (let i = 0; i < 70; i++) {
      ctx.fillStyle = rnd() < .5 ? `rgba(214,212,200,${.04 + rnd() * .06})` : `rgba(58,58,52,${.04 + rnd() * .07})`;
      ctx.fillRect(x0 + rnd() * (x1 - x0), rnd() * ALTO, 3 + rnd() * 12, 6 + rnd() * 30);
    }
    const pie = ctx.createLinearGradient(x0, 0, x0 + (x1 - x0) * .45, 0);
    pie.addColorStop(0, 'rgba(44,40,36,.5)'); pie.addColorStop(1, 'rgba(44,40,36,0)');
    ctx.fillStyle = pie; ctx.fillRect(x0, 0, x1 - x0, ALTO);
    for (let i = 0; i < chorreones; i++) {
      const y = rnd() * ALTO, largo = (x1 - x0) * (.25 + rnd() * .6), g = ctx.createLinearGradient(x1, 0, x1 - largo, 0);
      g.addColorStop(0, `rgba(46,44,40,${.14 + rnd() * .22})`); g.addColorStop(1, 'rgba(46,44,40,0)');
      ctx.fillStyle = g; ctx.fillRect(x1 - largo, y, largo, 2 + rnd() * 5);
    }
    ctx.fillStyle = 'rgba(232,230,218,.26)'; ctx.fillRect(x1 - 4, 0, 4, ALTO);
    for (let i = 0; i < juntas; i++) { ctx.fillStyle = 'rgba(30,30,26,.5)'; ctx.fillRect(x0, Math.round(i * ALTO / juntas), x1 - x0, 2); }
    ctx.restore();
  };
  franja(896, 944, '#adaca2', 4, 34);
  ctx.fillStyle = '#b3b2a8'; ctx.fillRect(944, 0, 16, ALTO);
  for (let i = 0; i < 60; i++) { ctx.fillStyle = `rgba(52,52,46,${.08 + rnd() * .14})`; ctx.fillRect(944 + rnd() * 14, rnd() * ALTO, 2 + rnd() * 3, 2 + rnd() * 8); }
  franja(960, 1024, '#a9a89e', 2, 22);
}

let atlas;
/** Textura compartida por el viaducto y el Metro; `null` si no hay lienzo (pruebas de node). */
export function concretoGastado() {
  if (atlas !== undefined) return atlas;
  atlas = sinGastarAzar(0x0c0c2e70, () => {
    const hoja = lienzo(ANCHO, ALTO);
    if (!hoja) return null;
    pintar(hoja.ctx, azarPropio(0x51ab1a));
    const textura = new THREE.CanvasTexture(hoja.canvas);
    textura.colorSpace = THREE.SRGBColorSpace;
    textura.wrapT = THREE.RepeatWrapping;
    textura.anisotropy = 4;
    textura.name = 'Concreto gastado del viaducto';
    return textura;
  });
  return atlas;
}

/** Le pone el concreto gastado a un material que ya existe; sin lienzo lo deja como estaba. */
export function vestirDeConcreto(material, tinte = '#ffffff') {
  const map = concretoGastado();
  if (!map) return material;
  material.map = map; material.color.set(tinte); material.needsUpdate = true;
  return material;
}

const porCara = (geometry, caras) => {
  const uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    const cara = caras[Math.floor(i / 4)];
    if (!cara) continue;
    const [u, v] = cara(uv.getX(i), uv.getY(i));
    uv.setXY(i, u, v);
  }
  uv.needsUpdate = true;
};

/**
 * Prisma del tablero: cuatro vértices de arriba (ocultos bajo el asfalto) y cuatro de abajo, en el orden
 * izquierda-derecha del inicio y del final. Abajo va la losa; el canto sale de la franja pegada a ella.
 */
export function vestirTablero(geometry, z0, z1) {
  const uv = geometry.attributes.uv, u = [C.cantoIzq[0], C.cantoDer[1], C.cantoIzq[0], C.cantoDer[1], C.losa[0], C.losa[1], C.losa[0], C.losa[1]];
  for (let i = 0; i < 8; i++) uv.setXY(i, u[i], (i % 4 < 2 ? z0 : z1) / PERIODO);
  uv.needsUpdate = true;
}

/** Caja tendida a lo largo de su Z local (barrera del puente): costados sucios abajo y tapa clara. */
export function vestirBarrera(geometry, z0) {
  const lado = (u, v) => [en(C.barrera, v), (z0 + u) / PERIODO];
  porCara(geometry, [lado, lado, (u, v) => [en(C.tapa, u), (z0 + v) / PERIODO], lado, lado, lado]);
}

/** Pilar de caja: cada cara toma una de las dos mitades (limpia o con carteles), alternadas por pilar. */
export function vestirPilar(geometry, numero = 0) {
  const cara = n => (u, v) => [en((numero + n) % 2 ? C.pilarB : C.pilarA, u), alto(v)];
  const tapa = () => [en(C.liso, .7), .5];
  porCara(geometry, [cara(0), cara(1), tapa, tapa, cara(1), cara(0)]);
}

/** Bloque alto de caja (escaleras de la estación): cada costado muestra las dos mitades del pilar. */
export function vestirBloque(geometry) {
  const cara = (u, v) => [en(C.pilar, u), alto(v)], tapa = () => [en(C.liso, .7), .5];
  porCara(geometry, [cara, cara, tapa, tapa, cara, cara]);
}

/** Pila redonda: la columna del pilar va y vuelve cuatro veces alrededor, sin costura. */
export function vestirPilaRedonda(geometry, gajos = 16) {
  const uv = geometry.attributes.uv, tronco = (gajos + 1) * 2;
  for (let i = 0; i < uv.count; i++) {
    if (i >= tronco) { uv.setXY(i, en(C.liso, .7), .5); continue; }
    const t = uv.getX(i) * 4 % 2;
    uv.setXY(i, en(C.pilar, t <= 1 ? t : 2 - t), alto(uv.getY(i)));
  }
  uv.needsUpdate = true;
}

/** Viga, baranda, capitel o andén de caja: costados lisos con chorreones; por abajo, la losa si se pide. */
export function vestirCaja(geometry, ancho, largo, { losa = false } = {}) {
  const lado = tramo => (u, v) => [en(C.liso, v), u * tramo / PERIODO];
  const tapa = losa ? (u, v) => [en(C.losa, .04 + u * .92), v * largo / PERIODO] : (u, v) => [en(C.liso, .78), v * largo / PERIODO];
  porCara(geometry, [lado(largo), lado(largo), tapa, tapa, lado(ancho), lado(ancho)]);
}

let cubierta;
/** Cubierta de la estación: arcos y correas de acero, vidrio gris sucio, cumbrera y canales de zinc. */
export function cubiertaDeEstacion() {
  if (cubierta !== undefined) return cubierta;
  cubierta = sinGastarAzar(0x0c0b1e27, () => {
    const hoja = lienzo(256, 256);
    if (!hoja) return null;
    const { ctx, canvas } = hoja, rnd = azarPropio(0xe57ac1);
    ctx.clearRect(0, 0, 256, 256);
    // U recorre el arco (0 y 1 son los aleros); V, el largo de la estación.
    for (let fila = 0; fila < 8; fila++) for (let col = 0; col < 8; col++) {
      const x = col * 32, y = fila * 32, suerte = rnd();
      if (suerte < .07) ctx.fillStyle = 'rgba(141,144,147,.97)';           // lámina de zinc de remiendo
      else if (suerte < .16) ctx.fillStyle = 'rgba(176,170,146,.9)';       // policarbonato amarillento
      else { const t = 138 + Math.floor(rnd() * 26); ctx.fillStyle = `rgba(${t - 14},${t},${t + 4},${.34 + rnd() * .14})`; }
      ctx.fillRect(x, y, 32, 32);
      for (let k = 0; k < 3; k++) {
        const haciaAlero = col < 4 ? -1 : 1, largo = 8 + rnd() * 20, x0 = x + rnd() * 26, y0 = y + 3 + rnd() * 26;
        ctx.fillStyle = `rgba(62,62,54,${.12 + rnd() * .16})`; ctx.fillRect(haciaAlero < 0 ? x0 - largo : x0, y0, largo, 1 + rnd() * 2);
      }
    }
    for (const [x0, x1] of [[0, 96], [256, 160]]) {
      const g = ctx.createLinearGradient(x0, 0, x1, 0);
      g.addColorStop(0, 'rgba(58,58,50,.5)'); g.addColorStop(1, 'rgba(58,58,50,0)');
      ctx.fillStyle = g; ctx.fillRect(Math.min(x0, x1), 0, 96, 256);
    }
    ctx.fillStyle = '#5e6468';
    for (let i = 0; i <= 8; i++) { ctx.fillRect(0, Math.min(252, i * 32 - 2), 256, 4); ctx.fillRect(Math.min(253, i * 32 - 1), 0, 3, 256); }
    ctx.fillStyle = '#7d8286'; ctx.fillRect(118, 0, 20, 256);               // cumbrera
    ctx.fillStyle = '#62666a'; ctx.fillRect(0, 0, 12, 256); ctx.fillRect(244, 0, 12, 256); // canales
    for (let i = 0; i < 50; i++) { ctx.fillStyle = `rgba(40,40,36,${.1 + rnd() * .2})`; ctx.fillRect(rnd() < .5 ? rnd() * 12 : 244 + rnd() * 12, rnd() * 256, 2 + rnd() * 4, 4 + rnd() * 14); }
    const textura = new THREE.CanvasTexture(canvas);
    textura.colorSpace = THREE.SRGBColorSpace;
    textura.anisotropy = 4;
    textura.name = 'Cubierta de la estación del Metro';
    return textura;
  });
  return cubierta;
}

let polisombra;
/** Polisombra de obra: tela verde tejida que cuelga entre parales de madera, quemada por el sol, con barro y rotos. */
export function polisombraDeObra() {
  if (polisombra !== undefined) return polisombra;
  polisombra = sinGastarAzar(0x0c0b5a3b, () => {
    const hoja = lienzo(512, 64);
    if (!hoja) return null;
    const { ctx, canvas } = hoja, rnd = azarPropio(0x9017a5);
    ctx.clearRect(0, 0, 512, 64);
    for (let tramo = 0; tramo < 8; tramo++) {
      const caida = 3 + rnd() * 6, tono = rnd();
      ctx.fillStyle = `rgb(${26 + Math.floor(tono * 16)},${74 + Math.floor(tono * 22)},${50 + Math.floor(tono * 14)})`;
      for (let x = 0; x < 64; x++) {
        const cuelga = Math.sin(Math.PI * x / 63) * caida;
        ctx.fillRect(tramo * 64 + x, 4 + cuelga, 1, 60 - cuelga);
      }
    }
    ctx.globalCompositeOperation = 'source-atop';
    for (let y = 4; y < 64; y += 2) { ctx.fillStyle = 'rgba(0,0,0,.12)'; ctx.fillRect(0, y, 512, 1); }
    for (let i = 0; i < 46; i++) {
      ctx.fillStyle = rnd() < .6 ? `rgba(128,150,118,${.08 + rnd() * .12})` : `rgba(14,30,20,${.1 + rnd() * .14})`;
      ctx.fillRect(rnd() * 512, rnd() * 64, 10 + rnd() * 46, 6 + rnd() * 26);
    }
    const barro = ctx.createLinearGradient(0, 44, 0, 64);
    barro.addColorStop(0, 'rgba(92,76,56,0)'); barro.addColorStop(1, 'rgba(92,76,56,.62)');
    ctx.fillStyle = barro; ctx.fillRect(0, 44, 512, 20);
    ctx.globalCompositeOperation = 'source-over';
    for (let i = 0; i < 7; i++) ctx.clearRect(rnd() * 500, 8 + rnd() * 44, 3 + rnd() * 9, 4 + rnd() * 12);
    ctx.fillStyle = '#4b3c2b';
    for (let tramo = 0; tramo <= 8; tramo++) ctx.fillRect(Math.min(509, Math.max(0, tramo * 64 - 1)), 0, 3, 64);
    const textura = new THREE.CanvasTexture(canvas);
    textura.colorSpace = THREE.SRGBColorSpace;
    textura.anisotropy = 4;
    textura.name = 'Polisombra de obra';
    return textura;
  });
  return polisombra;
}
