import { Quaternion, Vector3 } from 'three';

const EJE_X = { x: 1, y: 0, z: 0 };
const EJE_Z = { x: 0, y: 0, z: 1 };
const EJE_Y = { x: 0, y: 1, z: 0 };
const giroLateral = new Quaternion(), giroMundial = new Quaternion();
const centroRueda = new Vector3(), ejeRueda = new Vector3(), arriba = new Vector3();

export function huellaRuedas(carro) {
  const modelo = carro.vehicle;
  const asientos = modelo?.asientosRuedas?.();
  const semieje = (modelo?.wheelbase ?? carro.length * .60) / 2;
  return Array.from({ length: 4 }, (_, i) => {
    const rueda = modelo?.wheels?.[i], pivote = rueda?.parent;
    const x = asientos?.[i]?.[0] ?? pivote?.position.x ?? (i < 2 ? semieje : -semieje);
    const z = asientos?.[i]?.[1] ?? pivote?.position.z ?? ((i % 2 ? 1 : -1) * carro.width * .43);
    return { x, z, radio: rueda?.userData.radius ?? modelo?.wheelRadius ?? .32, perfil: modelo?.perfilRueda };
  });
}

export function alturaPorTrayecto(suelo, x, z, nivel, dx, dz) {
  const pasos = Math.max(1, Math.ceil(Math.hypot(dx, dz) / .5));
  for (let i = 1; i <= pasos; i++) {
    const altura = suelo(x + dx * i / pasos, z + dz * i / pasos, nivel);
    if (Number.isFinite(altura)) nivel = altura;
  }
  return nivel;
}

/** Altura que sostiene la rueda entera cuando parte de su banda queda sobre otra superficie. */
export function alturaBanda(suelo, rueda, x, z, piso, eje, vertical = EJE_Y) {
  let cota = piso;
  if (rueda.perfil) {
    const lado = Math.sign(rueda.z);
    for (const aro of rueda.perfil) {
      const offset = aro.z * lado;
      const y = suelo(x + eje.x * offset + vertical.x * aro.despeje, z + eje.z * offset + vertical.z * aro.despeje, piso);
      if (Number.isFinite(y)) cota = Math.max(cota, y - eje.y * offset - vertical.y * aro.despeje);
    }
  }
  return cota;
}

export function poseDeApoyo(carro, suelo, nivel, ruedas, pose = { rotacion: new Quaternion() }, giro = 0) {
  const { x, z } = carro.position, h = carro.group.rotation.y;
  const c = Math.cos(h), s = Math.sin(h);
  const alturaCentral = suelo(x, z, nivel);
  if (Number.isFinite(alturaCentral)) nivel = alturaCentral;
  for (let i = 0; i < ruedas.length; i++) {
    const rueda = ruedas[i];
    const dx = rueda.x * c + rueda.z * s, dz = -rueda.x * s + rueda.z * c;
    const piso = alturaPorTrayecto(suelo, x, z, nivel, dx, dz);
    const rumbo = i < 2 ? h + giro : h;
    rueda.cota = alturaBanda(suelo, rueda, x + dx, z + dz, piso, ejeRueda.set(Math.sin(rumbo), 0, Math.cos(rumbo)));
  }
  const [delIzq, delDer, trasIzq, trasDer] = ruedas;
  const pendienteX = (delIzq.cota + delDer.cota - trasIzq.cota - trasDer.cota) /
    (delIzq.x + delDer.x - trasIzq.x - trasDer.x);
  const pendienteZ = (delDer.cota + trasDer.cota - delIzq.cota - trasIzq.cota) /
    (delDer.z + trasDer.z - delIzq.z - trasIzq.z);
  const cabeceo = Math.atan(pendienteX), ladeo = -Math.atan(pendienteZ * Math.cos(cabeceo));
  const rotacion = pose.rotacion.setFromAxisAngle(EJE_Z, cabeceo)
    .multiply(giroLateral.setFromAxisAngle(EJE_X, ladeo));
  giroMundial.setFromAxisAngle(EJE_Y, h).multiply(rotacion);
  arriba.set(0, 1, 0).applyQuaternion(giroMundial);
  let altura = 0;
  for (let i = 0; i < ruedas.length; i++) {
    const rueda = ruedas[i];
    rueda.alturaModelo = rueda.cota;
    if (rotacion.w !== 1) {
      // En la rampa la banda toca la calzada siguiendo la normal del chasis: el contacto se desplaza también en X/Z.
      centroRueda.set(rueda.x, 0, rueda.z).applyQuaternion(giroMundial);
      const px = x + centroRueda.x, pz = z + centroRueda.z, piso = suelo(px, pz, rueda.cota);
      const direccion = i < 2 ? giro : 0;
      ejeRueda.set(Math.sin(direccion), 0, Math.cos(direccion)).applyQuaternion(giroMundial);
      rueda.alturaModelo = alturaBanda(suelo, rueda, px, pz, Number.isFinite(piso) ? piso : rueda.cota, ejeRueda, arriba) - centroRueda.y;
    }
    altura += rueda.alturaModelo;
  }
  pose.altura = altura / 4;
  pose.nivel = nivel;
  return pose;
}

export function apoyarModelo(carro, pose, ruedas) {
  const grupo = carro.vehicle?.group;
  if (grupo) {
    if (pose.rotacion.w === 1) grupo.rotation.set(0, 0, 0);
    else grupo.quaternion.copy(pose.rotacion);
    grupo.position.y = (carro._puesto?.liftFlat ?? 0) + pose.altura - carro.position.y;
    if (ruedas && carro.vehicle.wheels?.length) {
      const vertical = centroRueda.set(0, 1, 0).applyQuaternion(pose.rotacion).y;
      for (let i = 0; i < ruedas.length; i++) {
        const { alturaModelo, radio } = ruedas[i];
        carro.vehicle.wheels[i].parent.position.y = radio + (alturaModelo - pose.altura) / vertical;
      }
    }
  }
}

export function apoyarCarroAlBajar(carro, suelo, nivel = carro.position.y) {
  const pose = poseDeApoyo(carro, suelo, nivel, huellaRuedas(carro));
  carro.position.y = pose.nivel;
  apoyarModelo(carro, pose);
}
