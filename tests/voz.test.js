// La voz del juego: el cartón habla en primera persona; la calle y el sistema, de usted. Esta prueba lee TODOS los textos
// del juego, no una muestra: si alguien escribe un tuteo nuevo, un punto medio o una marca, se cae aquí.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { cadenasDelJuego } from '../tools/fuente/textos.mjs';
import { ORIGINS } from '../src/data/origins.js';
import { BRANCHES, TALENTS } from '../src/data/talents.js';
import { WEATHER_TYPES } from '../src/world/Climate.js';
import { PICTOS } from '../src/ui/pictos.js';
import { DIBUJOS } from '../src/ui/fuentes/dibujos.js';
import { conComa, conSigno } from '../src/utils/numeros.js';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const leer = (rel) => fs.readFileSync(`${RAIZ}${rel}`, 'utf8');
// La nota del desarrollador y lo que gritan los matones no se corrigen: no son de esta voz.
const CADENAS = cadenasDelJuego(RAIZ, { excluir: ['src/sala', 'src/ui/DeveloperNote.js', 'src/entities/SquadMember.js'] })
  .filter(({ texto }) => !/\b(?:uniform|attribute|varying)\b|#include/.test(texto)); // GLSL

// Las únicas frases de tú, todas pedidas tal cual por el diseño: la calle le habla al personaje en los momentos duros.
const FRASES_DE_TU = ['Se cansaron de perseguirte', 'Te tienen fichado', 'TE CASCARON', 'Te cascaron', 'Te atrapó la Policía', 'Te mató la limpieza social'];
// Una «Haz» que no es un verbo: el haz de luz del faro, que nombra una pieza en 3D.
const NO_SON_VERBO = ['Haz sobre el pavimento'];

const PALABRA_DE_TU = /(?:^|[^\p{L}])(te|tu|tus|ti|tú|contigo|tuyo|tuya|tuyos|tuyas|tienes|puedes|estás|llevas|traes|sabes|quieres|vas|debes|necesitas|eres|haces|sigues|pierdes|cobras|vendes|compras|haz|pon|ven|ten|ponle|dale|hazle|acércate|aléjate|cúrate|escóndete|oye)(?![\p{L}])/iu;
// Órdenes de tú al empezar una frase. No están «vende», «compra», «arma», «carga», «toca» o «junta», que también son otra cosa.
const ORDEN_DE_TU = /(?:^|[,.:!¡?¿]\s*|\n|\so\s)(busca|vuelve|termina|elige|arrastra|presiona|pulsa|oprime|revisa|tira|pide|come|bebe|descansa|usa|cierra|crea|corre|escapa|camina|guarda|duerme|cuida|escoge|huye|aprende|recuerda|evita|mantén|piensa|pega|roba|fabrica|cambia|entra)(?![\p{L}])/iu;

const tutea = (texto) => {
  let limpio = texto;
  for (const frase of [...FRASES_DE_TU, ...NO_SON_VERBO]) limpio = limpio.split(frase).join('');
  return PALABRA_DE_TU.test(limpio) || ORDEN_DE_TU.test(limpio);
};

test('el detector de tuteo atrapa lo que debe y no se confunde con el usted ni con la primera persona', () => {
  for (const malo of ['Te faltan 4 materiales', '¡Corre! Vienen', 'Busca la orilla', 'Sin plata: pide limosna', 'Desde $ 1.200, pide limosna', 'Venda algo o pide limosna', 'Llevas: Pan', 'No tienes sarna', 'Arrastra para girar', 'Dale pilas', 'Es tu historia', 'Haz clic en el mapa', 'Salud baja. Bebe agua.']) {
    assert.ok(tutea(malo), malo);
  }
  for (const bueno of ['Me faltan 4 materiales', '¡Córrale!', 'Busco la orilla', 'Sin plata: pida limosna', 'Llevo: Pan', 'No tengo sarna', 'Arrastre para girar', 'Le puse pilas', 'Otra noche. Mi historia.', 'Haga clic en el mapa', 'Porción de papa con sal.', 'Te tienen fichado', 'Vende siempre. Compra reciclaje']) {
    assert.ok(!tutea(bueno), bueno);
  }
});

test('ningún texto del juego tutea, salvo las frases que pide el diseño', () => {
  const malos = CADENAS.filter(({ texto }) => tutea(texto)).map(({ texto, donde }) => `${donde}: ${texto.trim().slice(0, 90)}`);
  assert.deepEqual(malos, []);
});

test('cada excepción de tuteo sigue viva: si una frase se va, se quita de la lista', () => {
  const todo = CADENAS.map(({ texto }) => texto).join('\n');
  for (const frase of FRASES_DE_TU) assert.ok(todo.includes(frase), frase);
});

test('los puntos medios quedan solo en lo impreso de la ciudad y como separador interno de los avisos', () => {
  const impreso = (donde) => /^src\/(world|entities\/(SellPoint|Shop)\.js)/.test(donde);
  // `[E] Recoger · [Q] Algo`: HUD los parte en piezas y el punto no llega a verse.
  const separador = (texto, donde) => /^\s*\[/.test(texto) || texto.trim() === '·';
  const malos = CADENAS
    .filter(({ texto, donde }) => /[·∙•]/.test(texto) && !impreso(donde) && !separador(texto, donde))
    .map(({ texto, donde }) => `${donde}: ${texto.trim().slice(0, 90)}`);
  assert.deepEqual(malos, []);
});

test('un solo signo de menos y coma decimal en lo que se lee', () => {
  const conPalabra = (t) => /\p{L}{3}/u.test(t) && !/[{};]/.test(t);
  assert.deepEqual(CADENAS.filter(({ texto }) => conPalabra(texto) && /(?:^|[\s(:])-\d/.test(texto)).map((c) => c.texto), []);
  assert.deepEqual(CADENAS.filter(({ texto, donde }) => !donde.startsWith('src/world') && /\d\.\d+\s?(?:FM|AM|MHz|km|kg)\b/.test(texto)).map((c) => c.texto), []);
  assert.equal(conSigno(5), '+5');
  assert.equal(conSigno(-30), '−30');
  assert.equal(conComa(5.9), '5,9');
  assert.equal(conComa(12.5, 2), '12,50', 'con decimales fijos');
});

test('los orígenes: la historia no explica el efecto, y ids y efectos no cambian', () => {
  assert.deepEqual(Object.fromEntries(Object.entries(ORIGINS).map(([id, o]) => [id, o.effects])), {
    reciclador: { extraLoot: 1 },
    desplazado: { diseaseResist: 0.7 },
    migrante: { begMult: 1.3 },
    endeudado: { sellMult: 1.15 },
  });
  for (const [id, origen] of Object.entries(ORIGINS)) {
    assert.ok(origen.relato && origen.efecto, `${id} lleva relato y efecto separados`);
    assert.equal(origen.desc, undefined, id);
    assert.doesNotMatch(`${origen.name} ${origen.relato} ${origen.efecto}`, /labia|Reciclador|reciclar/i, id);
    assert.doesNotMatch(origen.relato, /\d|%|más|menos/, `${id}: la historia no da cifras ni ventajas`);
    assert.match(origen.efecto, /\d|un objeto/, `${id}: el efecto dice cuánto`);
  }
});

test('el creador muestra relato y efecto en líneas distintas', () => {
  const creador = leer('src/ui/Creator.js');
  assert.match(creador, /\.relato/);
  assert.match(creador, /\.efecto/);
  assert.match(creador, /cr-efecto/);
});

test('las mañas: lo aprendido en la calle, sin jerga de juego ni experiencia a la vista; ids, efectos y costos no cambian', () => {
  const MANAS = Object.values(TALENTS);
  assert.deepEqual(MANAS.map(({ id, branch, cost, effects }) => [id, branch, cost, effects]), [
    ['collector1', 'recoleccion', 1, { rareChanceMult: 1.25 }],
    ['collector2', 'recoleccion', 1, { maxWeightBonus: 10 }],
    ['collector3', 'recoleccion', 2, { sortValueMult: 1.5, sortDiseaseMult: 0.8 }],
    ['surv1', 'supervivencia', 1, { decayMult: 0.7 }],
    ['surv2', 'supervivencia', 1, { diseaseResist: 0.6 }],
    ['surv3', 'supervivencia', 2, { mentalDecayMult: 0.5 }],
    ['crime1', 'crimen', 1, { stealCaughtMult: 0.8 }],
    ['crime2', 'crimen', 1, { substancePriceMult: 1.3 }],
    ['crime3', 'crimen', 2, { xpMult: 1.5 }],
  ]);
  const texto = [...MANAS.flatMap((t) => [t.name, t.desc]), ...Object.values(BRANCHES).map((b) => b.name)].join(' | ');
  assert.doesNotMatch(texto, /\bXP\b|experiencia|Ojo de Águila|Hierro|Acero|Rey de|Recolección|Supervivencia|Crimen|capacidad|\bdrop\b/i);
  for (const t of MANAS) {
    assert.ok(!/\p{Lu}/u.test(t.name.slice(1)), `${t.name}: como se dice, no como título`);
    assert.match(t.desc, /(?:^|\s)(?:me|aprendí|acomodo|aprendo|escogiendo)(?!\p{L})/iu, `${t.id} habla en primera persona`);
  }
  assert.ok(CADENAS.every(({ texto: t, donde }) => !/\bXP\b/.test(t) || donde.includes('debug')), 'XP no se ve en ninguna parte');
});

test('sin marcas ni equipos de verdad en los textos', () => {
  const prohibidas = /KLAN|Radioactiva|Rock en tu Idioma|Supermercado D69|Millonarios|Santa Fe|Toyota|\bNissan\b|\bChevrolet\b|Caracol|Blu Radio|Olímpica|Tropicana|La Mega/i;
  const malos = CADENAS.filter(({ texto, donde }) => prohibidas.test(texto) && !/^src\/world\/bogota\/GasStation/.test(donde)).map(({ texto, donde }) => `${donde}: ${texto.trim().slice(0, 80)}`);
  assert.deepEqual(malos, []);
  assert.doesNotMatch(leer('src/world/bogota/D69Store.js'), /title: 'D69'|name: '[^']*D69/);
  assert.doesNotMatch(leer('src/world/bogota/textures.js'), /KLAN/);
});

test('el arte de carga no trae el logo del carro: es el archivo limpio, no otro', () => {
  const huella = createHash('sha256').update(fs.readFileSync(`${RAIZ}public/images/pantalla-carga/personaje_pantalla_carga_4.webp`)).digest('hex');
  assert.notEqual(huella, '40e882215321f75d9a764bfc7100293096eb76fa96be995a70bf3bc8906038ae', 'es el archivo con el logo');
  assert.equal(huella, 'f81142ef24f8e1f9d139915e34b365142ab1e470c19826710b309329be6df3fb');
});

test('palabras de aquí: nada de las que suenan a sistema o a otro país', () => {
  const ajenas = /Ratón|Mayús|Refresco|Botella PET|Modelo liviano|Haz del destino|Proyectil biológico|\bZoom\b|labia|mojón|cagada/;
  const malos = CADENAS.filter(({ texto, donde }) => ajenas.test(texto) && !donde.startsWith('src/world')).map(({ texto, donde }) => `${donde}: ${texto.trim().slice(0, 80)}`);
  assert.deepEqual(malos, []);
});

test('el clima se dice con una palabra, la misma en todos los anchos', () => {
  const palabras = Object.values(WEATHER_TYPES).flatMap((w) => [w.label, w.nightLabel].filter(Boolean));
  // «Medio nublado» lo pide el diseño tal cual; es la única de dos palabras.
  for (const palabra of palabras) if (palabra !== 'Medio nublado') assert.doesNotMatch(palabra, /\s/, palabra);
  assert.doesNotMatch(leer('src/ui/HUD.js'), /CLIMA_CORTO/);
  assert.doesNotMatch(leer('index.html'), /clima__corta/);
  assert.doesNotMatch(leer('src/ui/css/hud.css'), /clima__corta/);
});

test('una marca, un significado: la ayuda dice ayuda, y la intoxicación no comparte cara con la gripe', () => {
  assert.match(leer('src/ui/ControlsHelp.js'), /textContent = 'Ayuda'/);
  assert.notEqual(PICTOS['🤢'], PICTOS['🤧']);
  assert.ok(DIBUJOS.nauseas, 'su dibujo existe en la letra');
  assert.notEqual(PICTOS['🦠'], PICTOS['☀']);
});

test('el popó dice el botón de quien juega, no una X fija', () => {
  assert.match(leer('src/ui/HUD.js'), /teclaVisible\('X'\)[^\n]*Lanzar popó/);
});

test('la tabla de la voz está en el documento de identidad', () => {
  const doc = leer('docs/identidad-visual.md');
  assert.match(doc, /\| Quién habla \|/);
  for (const frase of FRASES_DE_TU.filter((f) => f !== 'TE CASCARON')) assert.ok(doc.includes(frase), frase);
});
