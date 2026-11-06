import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { FRASES, REPARTO } from '../src/data/vocesCalle.js';
import { GESTO_POR_CATEGORIA, REUSO } from '../src/data/vocesReuso.js';
import { PRIORIDAD_CANAL, PRIORIDAD_VOZ } from '../src/systems/voces/prioridad.js';
import { LIMITE } from '../src/systems/voces/Vocalizador.js';
import { DIRECTOR } from '../src/systems/voces/VoiceDirector.js';
import { GESTO_HABLAR } from '../src/character/gestoHablar.js';

// docs/voces.md solo dice lo que se puede comprobar: aquí se comprueba.
const raiz = new URL('../', import.meta.url);
const doc = readFileSync(new URL('docs/voces.md', raiz), 'utf8');
const filas = encabezado => {
  const parte = doc.split(`## ${encabezado}`)[1]?.split('\n## ')[0] ?? '';
  return parte.split('\n').filter(l => l.startsWith('| ') && !l.startsWith('| ---')).slice(1).map(l => l.split('|').slice(1, -1).map(c => c.trim()));
};
const ids = celda => [...celda.matchAll(/`([^`]+)`/g)].map(m => m[1]);

test('las cifras del reparto y de las frases son las del código', () => {
  const papeles = Object.keys(REPARTO), voces = new Set(Object.values(REPARTO).map(r => r.voiceId));
  assert.match(doc, new RegExp(`${papeles.length} papeles y ${voces.size} voces distintas`));
  assert.match(doc, new RegExp(`\`FRASES\` tiene ${FRASES.length} frases`));
  const mp3 = readdirSync(new URL('public/audio/voces/', raiz)).filter(f => f.endsWith('.mp3'));
  assert.equal(mp3.length, FRASES.length, 'un mp3 por frase');
  assert.match(readFileSync(new URL('src/data/vocesCalle.js', raiz), 'utf8'), /-16 LUFS/);
  const tabla = filas('Reparto');
  assert.deepEqual(tabla.map(([papel]) => papel.replace(/`/g, '')), papeles);
  for (const [papel, sexo, actor] of tabla) {
    const r = REPARTO[papel.replace(/`/g, '')];
    assert.equal(sexo, r.sexo, papel);
    assert.equal(actor, r.actor, papel);
  }
});

test('los archivos y las pruebas que nombra existen', () => {
  for (const [, celda] of filas('Dónde está cada cosa')) for (const path of ids(celda)) assert.ok(existsSync(new URL(path, raiz)), path);
  for (const path of doc.matchAll(/`(tests\/[^`]+\.js)`/g)) assert.ok(existsSync(new URL(path[1], raiz)), path[1]);
});

test('la tabla de pesos es PRIORIDAD_VOZ y PRIORIDAD_CANAL', () => {
  const tabla = filas('Una sola voz grabada a la vez');
  const vistos = {};
  for (const [peso, celda] of tabla) for (const category of ids(celda)) vistos[category] = Number(peso);
  assert.deepEqual(vistos, { ...PRIORIDAD_VOZ });
  assert.match(doc, new RegExp(`carro\\s+${PRIORIDAD_CANAL.carro}, una sin peso dicho ${PRIORIDAD_CANAL.sinPeso}, el reclamo del conductor ${PRIORIDAD_CANAL.reclamo} y la frase de la calle ${PRIORIDAD_CANAL.calle}`));
});

test('la tabla de reuso es REUSO', () => {
  const tabla = filas('Frases que ya había, en situaciones nuevas');
  const vistos = Object.fromEntries(tabla.map(([categoria, celda]) => [ids(categoria)[0], ids(celda)]));
  const esperado = Object.fromEntries(Object.entries(REUSO).map(([category, lista]) => [category, [...new Set(lista)]]));
  assert.deepEqual(vistos, esperado);
});

test('los gestos, los límites y las distancias son los del código', () => {
  const tabla = filas('Gestos sin palabras');
  for (const [gesto, cuando] of tabla) {
    const esperadas = Object.entries(GESTO_POR_CATEGORIA).filter(([, g]) => g === ids(gesto)[0]).map(([c]) => c);
    for (const category of esperadas) assert.ok(ids(cuando).includes(category), `${category} → ${gesto}`);
  }
  assert.equal(LIMITE.reactivos, 2); assert.equal(LIMITE.ambiente, 1); assert.equal(LIMITE.porPersonaMs, 1200);
  assert.match(doc, /dos reacciones y un sonido de ambiente a la vez, y 1,2 s entre gesto/);
  assert.match(doc, new RegExp(`hasta ${String(GESTO_HABLAR.amplitud).replace('.', ',')} rad.*a\\s+menos de ${GESTO_HABLAR.cerca} m`, 's'));
  assert.match(doc, new RegExp(`menos de ${DIRECTOR.limosna.alcance} m que no sea vendedor`));
  assert.match(doc, new RegExp(`Una vez cada ${DIRECTOR.tienda.espera} s`));
  assert.match(doc, new RegExp(`a menos de ${DIRECTOR.atropello.alcance} m: \`witnessRunOver\``));
  assert.match(doc, new RegExp(`Patrulla a menos de ${DIRECTOR.tomba.patrulla} m`));
  assert.match(doc, new RegExp(`a menos de ${DIRECTOR.precarga.alcance} m\\) empieza a cargar`));
});
