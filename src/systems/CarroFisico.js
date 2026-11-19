import { Quaternion, Vector3 } from 'three';
import { CARJACK } from './CarjackSystem.js';
import { alturaPorTrayecto, apoyarCarroAlBajar, huellaRuedas, poseDeApoyo } from './apoyoCarro.js';
import { EntornoCarroFisico, GRUPO_CHASIS, GRUPO_SOLIDO, RAYO_RUEDA } from './EntornoCarroFisico.js';

export const PASO_FISICO = 1 / 60;
export const MAX_PASOS = 6;
const MASA = 1150;
const GRAVEDAD = 9.81;
const ALTURA_MASA = .50;
const REPOSO = .27;
const RIGIDEZ = 34;
const AGARRE = 2.4;
const VERTICAL = { x: 0, y: 1, z: 0 };
const CERO = { x: 0, y: 0, z: 0 };
const IDENTIDAD = { x: 0, y: 0, z: 0, w: 1 };
const limitar = (n, min, max) => Math.max(min, Math.min(max, n));
let preparacion;

export function prepararCarroFisico() {
  preparacion ??= import('@dimforge/rapier3d-compat').then(async ({ default: rapier }) => {
    await rapier.init();
    return sistema => new CarroFisico(rapier, sistema);
  });
  return preparacion;
}

class CarroFisico {
  constructor(rapier, sistema) {
    this.sistema = sistema;
    this.carro = sistema.car;
    this.mundo = new rapier.World({ x: 0, y: -GRAVEDAD, z: 0 });
    this.mundo.timestep = PASO_FISICO;
    this.mundo.maxCcdSubsteps = 4;
    try {
      this.entorno = new EntornoCarroFisico(rapier, this.mundo, sistema);
      this.obstaculos = this.entorno.obstaculos;
      this.suelo = (x, z, y) => this.entorno.altura(x, z, y);
      const { x, y, z } = this.carro.position;
      this.nivel = this.suelo(x, z, y);
      this.entorno.actualizar(x, z, y);
      this.rotacion = new Quaternion().setFromAxisAngle(VERTICAL, this.carro.group.rotation.y);
      this.rotacionAnterior = new Quaternion();
      this.relativa = new Quaternion();
      this.centro = new Vector3();
      this.centroAnterior = new Vector3();
      this.pie = new Vector3();
      this.frente = new Vector3();
      this.lineal = new Vector3();
      this.ruedas = huellaRuedas(this.carro);
      for (const rueda of this.ruedas) {
        rueda.alturaAnclaje = rueda.radio + REPOSO - GRAVEDAD / (4 * RIGIDEZ);
        rueda.anclaje = new Vector3(rueda.x, rueda.alturaAnclaje - ALTURA_MASA, rueda.z);
      }
      const apoyo = poseDeApoyo(this.carro, this.suelo, this.nivel, this.ruedas);
      this.rotacion.multiply(apoyo.rotacion);
      this.centro.set(0, ALTURA_MASA, 0).applyQuaternion(this.rotacion).add(this.carro.position);
      this.centro.y += apoyo.altura - y;
      this.entorno.actualizarRuedas(this.ruedas, this.centro, this.rotacion);
      // La primera consulta de las ruedas necesita que las superficies ya estén en el índice.
      this.mundo.step();
      this._crearChasis(rapier, sistema.speed);
      this._crearRuedas();
      this.acumulado = 0;
      this.volcado = 0;
      this.giro = 0;
      this.inmovil = false;
      this.estado = { velocidad: sistema.speed, distancia: 0, giro: 0, golpe: 0, agua: false };
    } catch (error) {
      this.mundo.free();
      throw error;
    }
  }

  _crearChasis(rapier, velocidad) {
    const largo = this.carro.length, ancho = this.carro.width, alto = 1.14;
    const inercia = { x: MASA * (ancho ** 2 + alto ** 2) / 12,
      y: MASA * (largo ** 2 + ancho ** 2) / 12, z: MASA * (largo ** 2 + alto ** 2) / 12 };
    const rumbo = this.carro.group.rotation.y;
    const { x, y, z } = this.centro;
    const cuerpo = rapier.RigidBodyDesc.dynamic().setTranslation(x, y, z)
      .setRotation(this.rotacion).setLinvel(Math.cos(rumbo) * velocidad, 0, -Math.sin(rumbo) * velocidad)
      .setAdditionalMassProperties(MASA, CERO, inercia, IDENTIDAD).setAngularDamping(.38).setCcdEnabled(true);
    this.chasis = this.mundo.createRigidBody(cuerpo);
    const borde = .065;
    const caja = rapier.ColliderDesc.roundCuboid(largo / 2 - borde, alto / 2 - borde, ancho / 2 - borde, borde)
      .setTranslation(0, .31, 0).setDensity(0).setRestitution(.16).setFriction(.26).setCollisionGroups(GRUPO_CHASIS);
    this.caja = this.mundo.createCollider(caja, this.chasis);
    this.chasis.recomputeMassPropertiesFromColliders();
    this.vehiculo = this.mundo.createVehicleController(this.chasis);
    this.vehiculo.indexUpAxis = 1;
    this.vehiculo.setIndexForwardAxis = 0;
  }

  _crearRuedas() {
    for (let i = 0; i < this.ruedas.length; i++) {
      const { anclaje, radio } = this.ruedas[i];
      this.vehiculo.addWheel(anclaje, { x: 0, y: -1, z: 0 }, { x: 0, y: 0, z: 1 }, REPOSO, radio);
      this.vehiculo.setWheelMaxSuspensionTravel(i, .22);
      this.vehiculo.setWheelSuspensionStiffness(i, RIGIDEZ);
      this.vehiculo.setWheelSuspensionCompression(i, 3.2);
      this.vehiculo.setWheelSuspensionRelaxation(i, 4.3);
      this.vehiculo.setWheelMaxSuspensionForce(i, 14500);
      this.vehiculo.setWheelFrictionSlip(i, AGARRE);
      this.vehiculo.setWheelSideFrictionStiffness(i, 1);
    }
  }

  _leerPose() {
    this.chasis.rotation(this.rotacion);
    this.chasis.translation(this.centro);
    this.pie.set(0, -ALTURA_MASA, 0).applyQuaternion(this.rotacion).add(this.centro);
    this.frente.set(1, 0, 0).applyQuaternion(this.rotacion);
    this.frente.y = 0;
    if (this.frente.lengthSq() > 1e-6) this.frente.normalize();
    else {
      const h = this.carro.group.rotation.y;
      this.frente.set(Math.cos(h), 0, -Math.sin(h));
    }
  }

  _limitarVelocidad() {
    this.chasis.linvel(this.lineal);
    const velocidad = this.lineal.dot(this.frente);
    const acotada = limitar(velocidad, -CARJACK.reverseSpeed, CARJACK.maxSpeed);
    if (velocidad !== acotada) {
      this.lineal.addScaledVector(this.frente, acotada - velocidad);
      this.chasis.setLinvel(this.lineal, true);
    }
    return acotada;
  }

  _mandos({ acelerador, direccion, frenoMano }, velocidad) {
    const giroMax = .49 - .15 * Math.min(Math.abs(velocidad) / CARJACK.maxSpeed, 1);
    this.giro += limitar(direccion * giroMax - this.giro, -2.5 * PASO_FISICO, 2.5 * PASO_FISICO);
    const invierte = acelerador * velocidad < 0 && Math.abs(velocidad) > .22;
    const empuje = (acelerador < 0 ? CARJACK.acceleration * .7 : CARJACK.acceleration) * acelerador;
    const motor = invierte || frenoMano ? 0 : empuje * MASA / 4;
    const freno = invierte ? CARJACK.braking * Math.abs(acelerador) : acelerador ? 0 : CARJACK.drag;
    const impulso = MASA * PASO_FISICO / 4;
    for (let i = 0; i < 4; i++) {
      const delante = i < 2;
      if (delante) this.vehiculo.setWheelSteering(i, this.giro);
      this.vehiculo.setWheelEngineForce(i, motor);
      this.vehiculo.setWheelBrake(i, impulso * (frenoMano && !delante ? CARJACK.handbrake * 2 : freno));
      if (!delante) {
        this.vehiculo.setWheelSideFrictionStiffness(i, frenoMano ? .30 : 1);
        this.vehiculo.setWheelFrictionSlip(i, frenoMano ? 1.65 : AGARRE);
      }
    }
    // El controlador por rayos carece de fricción estática longitudinal en una pendiente.
    // El freno de estacionamiento retiene X/Z únicamente al detenerse; los muelles siguen libres.
    const reposar = (!acelerador || frenoMano) && Math.hypot(this.lineal.x, this.lineal.z) < .16 &&
      this.vehiculo.wheelIsInContact(0) && this.vehiculo.wheelIsInContact(3);
    if (reposar !== this.inmovil) {
      this.inmovil = reposar;
      if (reposar) this.chasis.setLinvel({ x: 0, y: this.lineal.y, z: 0 }, true);
      this.chasis.setEnabledTranslations(!reposar, true, !reposar, true);
    }
    if (acelerador && !frenoMano) this.chasis.wakeUp();
  }

  _lago(x, z, sentido) {
    const alcance = this.carro.length / 2 * sentido;
    const fx = this.frente.x * alcance, fz = this.frente.z * alcance;
    const apoyo = alturaPorTrayecto(this.suelo, this.pie.x, this.pie.z, this.nivel, fx, fz);
    const profundidad = this.sistema._waterDepth(this.pie.x + fx, this.pie.z + fz, apoyo, apoyo);
    if (profundidad <= CARJACK.maxWade) return false;
    const anterior = alturaPorTrayecto(this.suelo, x, z, this.nivel, fx, fz);
    return profundidad >= this.sistema._waterDepth(x + fx, z + fz, anterior, anterior);
  }

  _enderezar() {
    const h = Math.atan2(-this.frente.z, this.frente.x);
    const x = this.centro.x, z = this.centro.z;
    const apoyo = this.sistema._ground(x, z, this.nivel);
    const y = Number.isFinite(apoyo) ? apoyo : this.centro.y - ALTURA_MASA;
    this.chasis.setRotation(this.relativa.setFromAxisAngle(VERTICAL, h), true);
    this.chasis.setTranslation({ x, y: y + ALTURA_MASA, z }, true);
    this.chasis.setLinvel(CERO, true);
    this.chasis.setAngvel(CERO, true);
    this.volcado = 0;
    this._leerPose();
  }

  _paso(mandos) {
    this._leerPose();
    this.centroAnterior.copy(this.centro);
    this.rotacionAnterior.copy(this.rotacion);
    const { x, z } = this.pie;
    this.nivel = this.suelo(x, z, this.nivel);
    this.entorno.actualizar(x, z, this.nivel);
    this._mandos(mandos, this._limitarVelocidad());
    this.entorno.actualizarRuedas(this.ruedas, this.centro, this.rotacion, this.giro);
    if (!this.chasis.isSleeping()) this.vehiculo.updateVehicle(PASO_FISICO, undefined, RAYO_RUEDA);
    this._limitarVelocidad();
    const rapidez = Math.hypot(this.lineal.x, this.lineal.z);
    this.mundo.step();
    this._leerPose();
    let velocidad = this._limitarVelocidad();
    const dx = this.pie.x - x, dz = this.pie.z - z;
    const distancia = dx * this.frente.x + dz * this.frente.z;
    if (dx * dx + dz * dz > 1e-10 && this._lago(x, z, Math.sign(distancia) || 1)) {
      this.chasis.setTranslation(this.centroAnterior, true);
      this.chasis.setRotation(this.rotacionAnterior, true);
      this.chasis.setLinvel({ x: 0, y: this.lineal.y, z: 0 }, true);
      this.chasis.setAngvel(CERO, true);
      this._leerPose();
      this.estado.agua = true;
      velocidad = 0;
    } else {
      this.estado.distancia += distancia;
      const perdida = rapidez - Math.hypot(this.lineal.x, this.lineal.z);
      if (perdida > this.estado.golpe && perdida > .1) {
        this.mundo.contactPairsWith(this.caja, otro => {
          if (otro.collisionGroups() === GRUPO_SOLIDO) this.estado.golpe = perdida;
        });
      }
    }
    const vertical = 1 - 2 * (this.rotacion.x ** 2 + this.rotacion.z ** 2);
    this.volcado = vertical < .42 ? this.volcado + PASO_FISICO : 0;
    if (this.volcado > .65) { this._enderezar(); velocidad = 0; }
    this.estado.velocidad = velocidad;
    this.estado.giro = this.giro;
  }

  _mostrar() {
    const carro = this.carro;
    const rumbo = Math.atan2(-this.frente.z, this.frente.x);
    carro.position.copy(this.pie);
    carro.group.rotation.y = rumbo;
    const modelo = carro.vehicle;
    if (modelo?.group) {
      this.relativa.setFromAxisAngle(VERTICAL, -rumbo).multiply(this.rotacion);
      modelo.group.quaternion.copy(this.relativa);
      // La raíz ya lleva la altura de los muelles. El apoyo de la entrada no se suma de nuevo.
      modelo.group.position.y = carro._puesto?.liftFlat ?? 0;
    }
    for (let i = 0; i < (modelo?.wheels?.length ?? 0) && i < 4; i++) {
      const pivote = modelo.wheels[i].parent;
      if (pivote) pivote.position.y = this.ruedas[i].alturaAnclaje - this.vehiculo.wheelSuspensionLength(i);
    }
  }

  avanzar(dt, mandos) {
    const estado = this.estado;
    estado.distancia = 0; estado.golpe = 0; estado.agua = false;
    if (!(dt > 0) || !this.mundo) return estado;
    this.acumulado = Math.min(this.acumulado + dt, PASO_FISICO * MAX_PASOS);
    let pasos = 0;
    while (this.acumulado + 1e-10 >= PASO_FISICO && pasos < MAX_PASOS) {
      this.acumulado = Math.max(0, this.acumulado - PASO_FISICO);
      this._paso(mandos);
      pasos++;
    }
    if (pasos) this._mostrar();
    return estado;
  }

  liberar() {
    if (!this.mundo) return;
    const carro = this.carro;
    apoyarCarroAlBajar(carro, this.suelo, this.nivel);
    const modelo = carro.vehicle;
    for (const rueda of modelo?.wheels ?? []) {
      if (rueda.parent) rueda.parent.position.y = rueda.userData.radius ?? modelo.wheelRadius ?? .32;
    }
    this.mundo.free();
    this.obstaculos.clear();
    this.vehiculo = this.chasis = this.caja = this.entorno = this.mundo = null;
  }
}
