import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { Box3, Ray, Scene, Vector3 } from 'three';
import { Car } from '../../src/entities/Car.js';
import { CARJACK, CarjackSystem } from '../../src/systems/CarjackSystem.js';
import { CollisionSystem } from '../../src/systems/CollisionSystem.js';

const PASO = 1 / 60;
const MODELO = 'sedanNoventero';
const RECTO = { acelerador: 1, direccion: 0, frenoMano: false };
const FRENO = { ...RECTO, acelerador: -1 };
const REPOSO = { ...RECTO, acelerador: 0 };
const redondear = valor => Number(valor.toFixed(3));
const caja = (x0, z0, x1, z1) => new Box3(new Vector3(x0, 0, z0), new Vector3(x1, 2, z1));
let atravesoAlgunaCaja = false;

async function conCarro(cajas, medir) {
  const colisiones = new CollisionSystem();
  colisiones.colliders.push(...cajas.map(box => ({ box })));
  const sistema = new CarjackSystem({ collisions: colisiones, world: { active: { getGroundHeight: () => 0 } } }, { fisica: true });
  const carro = new Car(new Scene(), new Vector3(), 0, { kind: 'carro', model: MODELO, variant: 3 });
  try {
    sistema.enter({ car: carro });
    const fisica = await sistema.fisicaLista;
    assert.ok(fisica, 'Rapier debe estar al volante para medirlo');
    const rayo = new Ray(), fin = new Vector3(), contacto = new Vector3();
    const anterior = new Vector3().copy(fisica.chasis.translation());
    function paso(mando, dt = PASO, tiempos) {
      const inicio = tiempos && performance.now();
      const estado = fisica.avanzar(dt, mando);
      if (tiempos) tiempos.push(performance.now() - inicio);
      sistema.speed = estado.velocidad;
      fin.copy(fisica.chasis.translation());
      const longitud2 = fin.distanceToSquared(anterior);
      if (longitud2 > 0 && cajas.length && !atravesoAlgunaCaja) {
        rayo.origin.copy(anterior);
        rayo.direction.subVectors(fin, anterior).normalize();
        atravesoAlgunaCaja = cajas.some(box => box.containsPoint(fin) ||
          (rayo.intersectBox(box, contacto) && contacto.distanceToSquared(anterior) <= longitud2));
      }
      anterior.copy(fin);
      return estado;
    }
    for (let i = 0; i < 60; i++) paso(REPOSO);
    return medir({ carro, sistema, fisica, paso });
  } finally {
    sistema.reset();
    carro.dispose();
  }
}

function hastaVelocidad(pista, objetivo) {
  for (let i = 1; i <= 600; i++) {
    if (pista.paso(RECTO).velocidad >= objetivo - .001) return i * PASO;
  }
  throw new Error(`No llegó a ${objetivo} m/s en 10 s. Terminó a ${pista.sistema.speed} m/s.`);
}

function medirRecta(pista) {
  const segundos = hastaVelocidad(pista, CARJACK.maxSpeed);
  let metros = 0;
  for (let i = 0; i < 600; i++) {
    const antes = pista.sistema.speed;
    const { x, z } = pista.carro.position;
    const despues = pista.paso(FRENO).velocidad;
    const tramo = Math.hypot(pista.carro.position.x - x, pista.carro.position.z - z);
    if (despues <= 0) {
      metros += tramo * antes / (antes - despues);
      return { segundosDeCeroAlTope: redondear(segundos), metrosDeFrenadoDesdeElTope: redondear(metros) };
    }
    metros += tramo;
  }
  throw new Error('El freno de servicio no detuvo el carro en 10 s.');
}

function medirGiro(pista) {
  const objetivo = 30 / 3.6;
  hastaVelocidad(pista, objetivo);
  const mando = { ...RECTO, direccion: 1 };
  const velocidad = () => pista.fisica.chasis.linvel();
  let v = velocidad(), rumbo = Math.atan2(-v.z, v.x);

  function recorrerArco(objetivoRad) {
    let arco = 0, metros = 0;
    for (let i = 1; i <= 3600; i++) {
      mando.acelerador = Math.hypot(v.x, v.z) < objetivo ? 1 : 0;
      const { x, z } = pista.carro.position;
      pista.paso(mando);
      v = velocidad();
      const siguiente = Math.atan2(-v.z, v.x);
      arco += Math.atan2(Math.sin(siguiente - rumbo), Math.cos(siguiente - rumbo));
      rumbo = siguiente;
      metros += Math.hypot(pista.carro.position.x - x, pista.carro.position.z - z);
      if (Math.abs(arco) >= objetivoRad) return { arco: Math.abs(arco), metros, segundos: i * PASO };
    }
    throw new Error('Con toda la dirección el carro no completó el arco en un minuto.');
  }

  recorrerArco(Math.PI); // Asentar la dirección antes de medir una vuelta completa.
  const { arco, metros, segundos } = recorrerArco(2 * Math.PI);
  const kmh = metros / segundos * 3.6;
  assert.ok(Math.abs(kmh - 30) < 1, `La vuelta de 30 km/h se hizo a ${kmh} km/h.`);
  return { radioDeGiroA30KmhMetros: redondear(metros / arco), velocidadMediaDelGiroKmh: redondear(kmh) };
}

function medirDerrape(pista) {
  hastaVelocidad(pista, CARJACK.maxSpeed);
  const curva = { ...RECTO, direccion: 1 };
  for (let i = 0; i < 12; i++) pista.paso(curva);
  const frenoMano = { ...curva, acelerador: 0, frenoMano: true };
  let maximo = 0, velocidadAlMaximo = 0;
  for (let i = 0; i < 90; i++) {
    pista.paso(frenoMano);
    const v = pista.fisica.chasis.linvel();
    const rapidez = Math.hypot(v.x, v.z);
    if (rapidez < 3) break;
    const h = pista.carro.group.rotation.y;
    const lateral = v.x * Math.sin(h) + v.z * Math.cos(h);
    const frontal = v.x * Math.cos(h) - v.z * Math.sin(h);
    const angulo = Math.abs(Math.atan2(lateral, frontal));
    if (angulo > maximo) { maximo = angulo; velocidadAlMaximo = rapidez; }
  }
  return { derrapeMaximoConFrenoDeManoGrados: redondear(maximo * 180 / Math.PI),
    velocidadEnElDerrapeMaximoKmh: redondear(velocidadAlMaximo * 3.6) };
}

const cajas = [];
for (const lado of [-1, 1]) {
  for (let fila = 0; fila < 10; fila++) {
    for (let columna = 0; columna < 10; columna++) {
      const x = (columna - 4.5) * 1.6, z = lado * (3 + 1.35 * fila);
      cajas.push(caja(x - .35, z - .35, x + .35, z + .35));
    }
  }
}
const milisegundosPorPaso = await conCarro(cajas, pista => {
  let mando = RECTO;
  const tiempos = [];
  for (let i = 0; i < 2100; i++) {
    if (pista.carro.position.x > 3) mando = FRENO;
    if (pista.carro.position.x < -3) mando = RECTO;
    pista.paso(mando, PASO, i < 300 ? undefined : tiempos);
    assert.equal(pista.fisica.obstaculos.size, cajas.length, 'Las 200 cajas deben estar presentes en cada paso');
  }
  tiempos.sort((a, b) => a - b);
  const mitad = tiempos.length / 2;
  return { cajasEstaticas: cajas.length, pasos: tiempos.length,
    mediana: redondear((tiempos[mitad - 1] + tiempos[mitad]) / 2),
    percentil95: redondear(tiempos[Math.ceil(tiempos.length * .95) - 1]) };
});

const limites = [caja(-15, -26, 65, -25.8), caja(-15, 25.8, 65, 26),
  caja(-15, -26, -14.8, 26), caja(64.8, -26, 65, 26)];
const recta = await conCarro(limites, medirRecta);
const giro = await conCarro(limites, medirGiro);
const derrape = await conCarro(limites, medirDerrape);
const muro = caja(45, -5, 45.2, 5);
for (const hz of [30, 144]) {
  await conCarro([muro], pista => {
    let masCerca = Infinity, velocidadDeLlegada = 0;
    for (let i = 0; i < 7 * hz; i++) {
      const estado = pista.paso(RECTO, 1 / hz);
      const distancia = muro.min.x - pista.carro.position.x - pista.carro.length / 2;
      masCerca = Math.min(masCerca, distancia);
      if (distancia > .5 && distancia < 4) velocidadDeLlegada = Math.max(velocidadDeLlegada, estado.velocidad);
    }
    assert.ok(masCerca < .5 && velocidadDeLlegada >= CARJACK.maxSpeed - .1,
      `La corrida a ${hz} Hz debe alcanzar el muro a velocidad tope.`);
  });
}

console.log(JSON.stringify({ modelo: MODELO, milisegundosPorPaso, ...recta, ...giro, ...derrape, atravesoAlgunaCaja }, null, 2));
