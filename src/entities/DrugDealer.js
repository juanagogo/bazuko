// src/entities/DrugDealer.js
// El dealer y su esquina de la olla: lo que queda de un muro, la puerta de lata tirada, el guacal de la mercancía,
// el rescoldo de una caneca y la bombilla. El hombre es un peatón como los demás de la calle, en su modelo liviano.
import * as THREE from 'three';
import { COLORS } from '../utils/constants.js';
import { ITEMS, LOOT_SUBSTANCE, dealerPrice, dealerOffer } from '../data/items.js';
import { DEFAULT_LOOK } from '../character/look.js';
import { createRealisticCharacter } from '../character/RealisticCharacter.js';
import { Piezas, banquito, guacal, materialDePuesto } from './puestoPiezas.js';

// La bombilla y las brasas comparten material: de día quedan apagadas y de noche brillan.
const BRILLO_DE_DIA = 0x5b5660, BRILLO_DE_NOCHE = 0xf0d6ff;
const LUZ_DE_NOCHE = 4;

// Cotas del puesto, en metros desde el centro del círculo. El frente mira a +z.
const SUELO = 0.04;            // la tierra de la olla
const MURO_Z = -1.05;          // eje del muro largo
const GRUESO = 0.26;
const CARA = MURO_Z + GRUESO / 2; // cara del muro que da al puesto
const MURO_ALTO = 1.2;         // nada macizo pasa de aquí: detrás se sigue viendo a quien pase
const CUERPO = [-0.42, -0.5];  // dónde pisa el hombre (x, z)
const GIRO = 0.16;             // y cuánto se abre hacia la calle
// El cable va de un palo en la esquina a la punta del poste, con su comba.
const ESQUINA = [-2.0, 2.78, -1.0], PUNTA = [2.28, 3.25, 1.1];
const cable = t => [ESQUINA[0] + (PUNTA[0] - ESQUINA[0]) * t, ESQUINA[1] + (PUNTA[1] - 0.15 - ESQUINA[1]) * t - Math.sin(t * Math.PI) * 0.34, ESQUINA[2] + (PUNTA[2] - ESQUINA[2]) * t];
const FOCO = cable(0.38);
const FOGON = [1.85, 0.62];

// Cómo va vestido: buzo y pantalón oscuros, gorro de lana y tenis. El morado va aparte, en el pañuelo.
const APARIENCIA = {
  ...DEFAULT_LOOK, nombre: 'El dealer', piel: 3, peloColor: 0, desgaste: 1, accesorios: [],
  real: {
    sexo: 'hombre', edad: 'adulto', pelo: 'calvo', barba: 'ninguna', ropa: 'buzo', calzado: 'tenis', cabeza: 'gorro-lana', desgaste: 1,
    tonos: { arriba: '#26272d', abajo: '#2d3140', patron: 'liso', patronColor: '#2d3140', calzado: '#3d3d3f' }
  }
};
const GORRO = '#2b2c33';
const POSTURA = { speed: 0, stance: 'brazos-cruzados' };
const PASO_DE_ANIMACION = 1 / 30;
// Como a los peatones: lejos no se dibuja (con un margen para que no parpadee en el borde), más allá de 40 m
// la pose queda congelada, y fuera de cuadro ni se dibuja ni se anima.
const VER_HASTA = 60, MARGEN_DE_VISTA = 4, ANIMAR_HASTA = 40;
// El hombre no se mueve de su sitio: esta esfera, en metros del puesto, lo envuelve de sobra en cualquier pose.
const ENVOLVENTE = new THREE.Sphere(new THREE.Vector3(CUERPO[0], 1.0, CUERPO[1]), 1.6);

const PIEL = '#8a5a3b', PIEL_SOMBRA = '#6f4630', BUZO = '#303237', BUZO_CLARO = '#3e4046', JEAN = '#333a48', TENIS = '#c4bfb2';
const REVOQUE = '#6f6858', REVOQUE_SUCIO = '#635c4f', LADRILLO = '#74432f', LADRILLO_OSCURO = '#613828';
const LATA = '#3b4046', LATA_OSCURA = '#25282c', OXIDO = '#5d3b29', HOLLIN = '#221d1a';

/** La figura que se ve mientras llega el modelo: de pie contra el muro, con las manos en el bolsillo del buzo. */
function armarCuerpo(k) {
  // Pierna de apoyo y la que dobla contra el muro.
  k.tramo([-0.11, 0.09, 0.10], [-0.11, 0.50, 0.03], 0.15, 0.16, JEAN);
  k.tramo([-0.11, 0.50, 0.03], [-0.10, 0.93, -0.10], 0.17, 0.18, JEAN);
  k.caja(0.12, 0.09, 0.28, TENIS, [-0.11, 0.045, 0.15]);
  k.tramo([0.10, 0.93, -0.10], [0.12, 0.56, 0.20], 0.17, 0.18, JEAN);
  k.tramo([0.12, 0.56, 0.20], [0.12, 0.38, -0.22], 0.15, 0.16, JEAN);
  k.caja(0.12, 0.28, 0.09, TENIS, [0.12, 0.30, -0.30]);
  // Cadera y tronco, echados hacia atrás.
  k.caja(0.36, 0.2, 0.24, JEAN, [0, 0.95, -0.11]);
  k.tramo([0, 0.98, -0.12], [0, 1.50, -0.22], 0.46, 0.27, BUZO);
  k.caja(0.3, 0.14, 0.08, BUZO_CLARO, [0, 1.07, 0.03], [-0.19, 0, 0]);
  k.caja(0.4, 0.09, 0.22, BUZO_CLARO, [0, 1.51, -0.25]);
  // Brazos: del hombro al codo y del codo al bolsillo.
  for (const lado of [-1, 1]) {
    k.tramo([lado * 0.27, 1.44, -0.2], [lado * 0.3, 1.15, -0.13], 0.12, 0.13, BUZO);
    k.tramo([lado * 0.3, 1.15, -0.13], [lado * 0.11, 1.06, 0.04], 0.11, 0.12, BUZO);
  }
  // Cabeza: cara con cejas y nariz, gorro oscuro y el pañuelo morado al cuello.
  k.en([0, 1.52, -0.2], [0, 0.3, 0], () => {
    k.caja(0.11, 0.08, 0.11, PIEL_SOMBRA, [0, 0.02, 0.01]);
    k.caja(0.18, 0.22, 0.2, PIEL, [0, 0.14, 0.03]);
    k.caja(0.16, 0.022, 0.02, '#1b1410', [0, 0.185, 0.135]);
    k.caja(0.035, 0.07, 0.035, PIEL_SOMBRA, [0, 0.14, 0.14]);
    k.caja(0.08, 0.014, 0.02, PIEL_SOMBRA, [0, 0.075, 0.133]);
    k.caja(0.2, 0.1, 0.22, '#1f2024', [0, 0.25, 0.02]);
    k.caja(0.21, 0.04, 0.23, '#2a2b30', [0, 0.215, 0.02]);
    k.caja(0.2, 0.06, 0.2, COLORS.DEALER, [0, -0.005, 0.015]);
    k.caja(0.13, 0.1, 0.02, COLORS.DEALER, [0, -0.06, 0.105], [0, 0, Math.PI / 4]);
  });
}

/** Hiladas de ladrillo a la vista: dos tonos y una sí y otra no salida un centímetro. */
function hiladas(cuantas, poner) {
  const alto = 0.13;
  for (let i = 0; i < cuantas; i++) poner(i, alto * (i + 0.5), alto, i % 3 === 1 ? LADRILLO_OSCURO : LADRILLO, i % 2 ? 0.02 : 0);
}

/** Lo que queda de una casa caída: un muro en ele que no pasa del pecho, con el escombro al pie y la puerta tirada. */
function armarMuro(k) {
  // Muro largo, hilada por hilada: cada tramo se quedó a otra altura y las puntas bajan en escalera.
  const perfil = x => {
    const u = (x + 2) / 4;
    const base = 0.62 + 0.5 * Math.sin(u * Math.PI) + 0.12 * Math.sin(u * 17) - (u > 0.42 && u < 0.6 ? 0.3 : 0);
    return Math.min(MURO_ALTO, Math.max(0.26, base));
  };
  hiladas(9, (i, y, alto, color, sale) => {
    let desde = null;
    for (let x = -2; x <= 2.21; x += 0.2) {
      const queda = x < 2.19 && perfil(x + 0.1) >= y + alto / 2;
      if (queda && desde == null) desde = x;
      if (!queda && desde != null) {
        const a = desde + (i % 2 ? 0.06 : 0), b = x - (i % 2 ? 0 : 0.05);
        k.caja(b - a, alto, GRUESO + sale, color, [(a + b) / 2, y, MURO_Z]);
        desde = null;
      }
    }
  });
  // El retorno de la esquina, que baja hacia la calle.
  hiladas(8, (i, y, alto, color, sale) => {
    const z1 = 0.55 - 1.25 * Math.pow(y / 1.05, 1.3) + (i % 2 ? 0.06 : -0.03);
    if (z1 > -0.85) k.caja(GRUESO + sale, alto, z1 + 0.92, color, [-2.0, y, (z1 - 0.92) / 2]);
  });
  // Paños de revoque que aguantaron por la cara del puesto.
  for (const [x0, x1, alto, color] of [[-1.85, -0.85, 0.78, REVOQUE], [-0.85, -0.3, 0.62, REVOQUE_SUCIO], [0.55, 1.5, 0.7, REVOQUE]]) {
    k.caja(x1 - x0, alto, 0.03, color, [(x0 + x1) / 2, alto / 2, CARA + 0.012]);
  }
  // El rayón morado de la olla.
  const y0 = 0.36, trazo = [[-1.72, 0], [-1.6, 0.3], [-1.48, 0.02], [-1.36, 0.32], [-1.24, 0.04], [-1.16, 0.24]];
  for (let i = 0; i + 1 < trazo.length; i++) {
    k.tramo([trazo[i][0], y0 + trazo[i][1], CARA + 0.035], [trazo[i + 1][0], y0 + trazo[i + 1][1], CARA + 0.035], 0.045, 0.012, COLORS.DEALER);
  }
  // Escombro al pie, por delante y por detrás.
  const pedazos = [
    [2.3, -0.7, 0.6], [2.55, -1.0, 1.2], [-2.1, 1.0, 0.3], [-1.75, 0.85, 1.3], [-0.1, -1.38, 0.5], [0.35, -1.5, -0.7],
    [-1.2, -1.42, 0.2], [1.5, -1.45, 1.0]
  ];
  for (const [x, z, giro] of pedazos) k.caja(0.24, 0.1, 0.12, giro > 0.45 ? LADRILLO : LADRILLO_OSCURO, [x, SUELO + 0.05, z], [0, giro, 0]);
  for (const [x, z, r, color] of [[0.15, -1.48, 0.42, '#5b5146'], [-1.6, -1.5, 0.3, '#5b5146'], [2.35, -0.95, 0.36, '#57493c'], [-2.45, -0.3, 0.28, '#57493c']]) {
    k.pieza(new THREE.ConeGeometry(r, r * 0.45, 6), color, [x, SUELO + r * 0.2, z], [0, x, 0]);
  }
  // Varillas de la columna de la esquina: delgadas, dobladas, lo único del muro que sube.
  for (const [x, z, alto, cae] of [[-2.05, -1.1, 0.75, 0.1], [-1.93, -0.98, 0.5, -0.14]]) k.tramo([x, 0.9, z], [x + cae, 1.0 + alto, z + cae / 2], 0.022, 0.022, '#4a2e22');
  // La puerta de lata con su rejilla, zafada y recostada de lado contra el muro.
  k.en([1.02, SUELO, CARA + 0.36], [-0.36, 0, 0], () => {
    k.caja(2.0, 0.92, 0.04, LATA_OSCURA, [0, 0.46, 0]);
    k.caja(1.9, 0.82, 0.04, LATA, [0, 0.46, 0.015]);
    for (const x of [-0.45, 0.82]) k.caja(0.03, 0.82, 0.02, LATA_OSCURA, [x, 0.46, 0.04]);
    k.caja(0.24, 0.4, 0.02, LATA_OSCURA, [0.42, 0.46, 0.04]);
    for (const dy of [-0.12, -0.04, 0.04, 0.12]) k.caja(0.2, 0.022, 0.03, '#8b9096', [0.42, 0.46 + dy, 0.05]);
    k.caja(0.05, 0.14, 0.05, '#8b9096', [-0.06, 0.8, 0.05]);
  });
}

/** Lo que hay alrededor: guacal volteado con la mercancía, banquito, la caneca del rescoldo, poste, cable y manchas. */
function armarSitio(k) {
  // Guacal volteado con la mercancía: termo de tinto, frasco de pegante, caja de pastillas y unas papeletas.
  guacal(k, [0.42, SUELO, -0.2], 0.18);
  k.en([0.42, SUELO, -0.2], [0, 0.18, 0], () => {
    k.tubo(0.055, 0.06, 0.26, 8, '#6b2f2a', [-0.17, 0.65, -0.06]);
    k.tubo(0.035, 0.05, 0.05, 8, '#d8d4c8', [-0.17, 0.805, -0.06]);
    k.tubo(0.045, 0.045, 0.13, 8, '#c9a23a', [0.04, 0.585, 0.1]);
    k.tubo(0.02, 0.03, 0.04, 6, '#7a2a22', [0.04, 0.67, 0.1]);
    k.caja(0.17, 0.06, 0.11, '#e8e6df', [0.2, 0.55, -0.08], [0, 0.4, 0]);
    for (const [x, z] of [[0.05, -0.1]]) k.caja(0.05, 0.012, 0.035, '#e8e6df', [x, 0.526, z], [0, x * 9, 0]);
  });
  // Banquito de vigilar, en el rincón, con un cartón debajo.
  banquito(k, [-1.45, SUELO, -0.4], 0.5);
  k.caja(0.95, 0.012, 0.7, '#8a6f4a', [-1.4, SUELO + 0.012, -0.35], [0, 0.3, 0]);
  // Media caneca sobre ladrillos, tiznada, con leña a medio quemar: queda el rescoldo, no una fogata.
  const [fx, fz] = FOGON;
  for (const a of [0.4, 2.5, 4.6]) k.caja(0.22, 0.1, 0.11, LADRILLO_OSCURO, [fx + Math.cos(a) * 0.2, SUELO + 0.05, fz + Math.sin(a) * 0.2], [0, -a, 0]);
  k.tubo(0.3, 0.27, 0.5, 10, OXIDO, [fx, SUELO + 0.35, fz], [0, 0, 0], true);
  k.tubo(0.305, 0.3, 0.09, 10, HOLLIN, [fx, SUELO + 0.565, fz], [0, 0, 0], true);
  k.disco(0.28, 10, HOLLIN, [fx, SUELO + 0.47, fz]);
  k.tubo(0.27, 0.27, 0.02, 10, '#3d2a20', [fx, SUELO + 0.11, fz]);
  for (const [x, y, z, rot] of [[-0.1, 0.53, 0.05, [0.3, 0.4, 1.2]], [0.12, 0.52, -0.08, [1.25, 0.2, 0.3]]]) k.caja(0.05, 0.42, 0.05, '#2a1e16', [fx + x, SUELO + y, fz + z], rot);
  // Poste viejo y palo de la esquina que sostienen el cable; de él cuelgan la bombilla y un par de tenis.
  k.tramo([2.35, SUELO, 1.15], PUNTA, 0.11, 0.11, '#4a3b2c');
  k.caja(0.5, 0.07, 0.05, '#4a3b2c', [2.2, 3.0, 1.1], [0, 0.5, 0]);
  k.tramo([-2.08, SUELO, -1.02], [ESQUINA[0], ESQUINA[1] + 0.06, ESQUINA[2]], 0.07, 0.07, '#54432f');
  const cortes = [0, 0.18, 0.38, 0.56, 0.74, 0.88, 1];
  for (let i = 0; i + 1 < cortes.length; i++) k.tramo(cable(cortes[i]), cable(cortes[i + 1]), 0.022, 0.022, '#17171a');
  k.tramo(FOCO, [FOCO[0], FOCO[1] - 0.3, FOCO[2]], 0.014, 0.014, '#17171a');
  k.tubo(0.035, 0.045, 0.07, 6, '#2b2b2e', [FOCO[0], FOCO[1] - 0.33, FOCO[2]]);
  const nudo = cable(0.74);
  for (const [dx, largo, giro] of [[-0.07, 0.34, 0.5], [0.08, 0.5, -0.4]]) {
    k.tramo(nudo, [nudo[0] + dx, nudo[1] - largo, nudo[2]], 0.01, 0.01, '#d8d4c8');
    k.en([nudo[0] + dx, nudo[1] - largo - 0.09, nudo[2]], [0.2, giro, 1.3], () => {
      k.caja(0.22, 0.045, 0.075, TENIS, [0, 0, 0]);
      k.caja(0.09, 0.1, 0.07, TENIS, [-0.065, 0.07, 0]);
      k.caja(0.05, 0.035, 0.072, COLORS.DEALER, [-0.085, 0.1, 0]);
    });
  }
  // Suelo: tizne de la caneca, humedad al pie del muro, la sombra de quien se para ahí todo el día y basura menuda.
  const y = SUELO + 0.022;
  k.disco(0.5, 11, '#3b3229', [fx + 0.05, y, fz + 0.05], [1.15, 0.9], 0.4);
  k.disco(0.3, 9, '#2e2722', [fx - 0.05, y + 0.003, fz + 0.12], [1.1, 0.8], 1.3);
  k.disco(0.45, 10, '#55493a', [-0.6, y, -0.62], [2.3, 0.45], 0);
  k.disco(0.3, 10, '#40372d', [CUERPO[0], y + 0.004, CUERPO[1] + 0.03], [1.1, 0.85], GIRO);
  k.tubo(0.035, 0.04, 0.2, 6, '#2f4a35', [-0.95, SUELO + 0.04, -0.72], [Math.PI / 2, 0, 0.7]);
  k.caja(0.3, 0.012, 0.22, '#8a6f4a', [0.3, SUELO + 0.012, 0.75], [0, 0.8, 0]);
}

/** Lo que brilla solo: la bombilla y las brasas del fondo de la caneca. */
function armarBrillos() {
  const k = new Piezas();
  k.pieza(new THREE.SphereGeometry(0.075, 6, 4), '#ffffff', [FOCO[0], FOCO[1] - 0.42, FOCO[2]]);
  const [fx, fz] = FOGON, y = SUELO + 0.48;
  k.disco(0.2, 7, '#8a2a0c', [fx, y, fz], [1, 0.85], 0.4);
  for (const [x, z, r, color] of [[0.05, -0.03, 0.09, '#f07a1e'], [-0.08, 0.06, 0.06, '#f9a43a'], [0.1, 0.09, 0.045, '#e2601a'], [-0.04, -0.11, 0.05, '#f07a1e']]) {
    k.disco(r, 5, color, [fx + x, y + 0.006, fz + z], [1, 0.8], x * 9);
  }
  return k.malla(new THREE.MeshBasicMaterial({ vertexColors: true, color: BRILLO_DE_DIA, toneMapped: false }), { sombra: false });
}

/** Pañuelo morado al cuello: un aro y la punta caída sobre el pecho. */
function armarPanuelo() {
  const k = new Piezas();
  k.tubo(0.068, 0.082, 0.07, 8, COLORS.DEALER, [0, 0, 0], [0, 0, 0], true);
  k.pieza(new THREE.ConeGeometry(0.085, 0.15, 3), COLORS.DEALER, [0, -0.085, 0.072], [Math.PI, Math.PI / 6, 0], [1, 1, 0.3]);
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
  return k.malla(material, { sombra: false });
}

export class DrugDealer {
  constructor(scene, position) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.position.copy(position);
    this.scene.add(this.group);

    // El sitio entero, fundido en una sola malla.
    const material = materialDePuesto();
    const sitio = new Piezas();
    armarMuro(sitio);
    armarSitio(sitio);
    this.sitio = sitio.malla(material);
    this.sitio.name = 'Esquina del dealer';
    this.group.add(this.sitio);

    // La figura de mientras: se quita cuando llega el modelo de peatón.
    const figura = new Piezas();
    figura.en([CUERPO[0], SUELO, CUERPO[1]], [0, GIRO, 0], () => armarCuerpo(figura));
    this.figura = figura.malla(material);
    this.figura.name = 'Dealer';
    this.group.add(this.figura);
    this.persona = null;
    this.panuelo = null;

    // Bombilla pelada, colgada del cable, y el rescoldo de la caneca: de noche brillan.
    this.brillos = armarBrillos();
    this.brillos.name = 'Bombilla y brasas del dealer';
    this.group.add(this.brillos);

    // La luz morada de siempre, ahora en la bombilla.
    this.luz = new THREE.PointLight(0x9b59b6, 0, 9);
    this.luz.position.set(FOCO[0], FOCO[1] - 0.57, FOCO[2] + 0.1);
    this.group.add(this.luz);

    // Marcador
    const markerGeo = new THREE.RingGeometry(1.0, 1.3, 24);
    const markerMat = new THREE.MeshBasicMaterial({
      color: COLORS.ACCENT_PURPLE,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.8
    });

    this.marker = new THREE.Mesh(markerGeo, markerMat);
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.position.y = 0.05;
    this.group.add(this.marker);

    this.isNight = false;
    this._animar = 0;
    this._destruido = false;
    this._distancia = 0;      // de la cámara al puesto, la última vez que la esquina entró en cuadro
    this._dibujado = false;   // si el hombre se dibujó desde el último update
    this._marcarDibujado = () => { this._dibujado = true; };
    // La esquina es estática y Three ya la descarta fuera de cuadro; cuando sí se dibuja, trae la cámara.
    this.sitio.onBeforeRender = (renderer, scene, camera) => this._mirar(camera);
    this.setNight(false);
    // En el juego el modelo se pide solo; sin navegador (pruebas) queda la figura hecha a mano.
    if (typeof document !== 'undefined') this.preloadModel();
  }

  /**
   * Trae al hombre de la esquina: el mismo cuerpo liviano de la gente de la calle. Si no llega, queda la figura de mientras.
   * `crear` existe para probarlo sin navegador.
   */
  preloadModel(crear = createRealisticCharacter) {
    return this._modelo ??= Promise.resolve()
      .then(() => crear(APARIENCIA, { lod: true }))
      .then((persona) => {
        if (this._destruido) { persona.dispose?.(); return; }
        this._ponerPersona(persona);
      })
      .catch((error) => { console.warn('[DrugDealer] no llegó el modelo; queda la figura de mientras', error); });
  }

  /** Con la cámara que está dibujando la esquina: de lejos, el hombre (o la figura de mientras) se apaga. */
  _mirar(camera) {
    const e = camera.matrixWorld.elements, p = this.group.position;
    this._distancia = Math.hypot(e[12] - p.x, e[13] - p.y, e[14] - p.z);
    const gente = this.persona?.group ?? this.figura;
    if (gente) gente.visible = this._distancia <= VER_HASTA + (gente.visible ? MARGEN_DE_VISTA : 0);
  }

  _ponerPersona(persona) {
    this.persona = persona;
    persona.group.position.set(CUERPO[0], SUELO, CUERPO[1]);
    persona.group.rotation.y = GIRO;
    persona.group.visible = this.figura.visible;
    this.group.add(persona.group);
    persona.update(1, POSTURA);
    persona.snapPose?.();
    persona.update(0, POSTURA);
    // El gorro de lana viene claro: aquí va oscuro, como el resto de la ropa.
    persona.group.traverse((o) => { if (o.isMesh && /hat/i.test(o.name)) o.material.color.set(GORRO); });
    this.group.remove(this.figura);
    this.figura.geometry.dispose();
    this.figura = null;
    // Las mallas con huesos vienen sin descarte por cuadro, porque la gente camina. Este no se mueve: cada una
    // lleva la esfera fija del hombre, en sus propias medidas, y avisa cuando se dibuja.
    this.group.updateWorldMatrix(true, true);
    const centro = this.group.localToWorld(ENVOLVENTE.center.clone());
    persona.group.traverse((o) => {
      if (!o.isSkinnedMesh) return;
      o.boundingSphere = new THREE.Sphere(o.worldToLocal(centro.clone()), ENVOLVENTE.radius / o.matrixWorld.getMaxScaleOnAxis());
      o.frustumCulled = true;
      o.onBeforeRender = this._marcarDibujado;
    });
    // El pañuelo se amarra al hueso del cuello y lo sigue.
    let cuello = null;
    persona.group.traverse((o) => { if (!cuello && o.isBone && /Neck$/i.test(o.name)) cuello = o; });
    if (!cuello) return;
    this.panuelo = armarPanuelo();
    this.panuelo.name = 'Pañuelo del dealer';
    cuello.getWorldPosition(this.panuelo.position);
    this.panuelo.position.y += 0.035;
    this.panuelo.rotation.y = GIRO;
    this.scene.add(this.panuelo);
    cuello.attach(this.panuelo);
  }

  get position() {
    return this.group.position;
  }

  /**
   * Vende durante la noche una sustancia del inventario (`itemId`) o, sin `itemId`, todas.
   * Paga `dealerOffer` por unidad, siempre menos de lo que él cobra (`dealerPrice`).
   * @param {InventorySystem} inventory
   * @param {boolean} isNight
   * @param {number} priceMult
   * @param {string|null} itemId
   */
  sellSubstances(inventory, isNight, priceMult = 1, itemId = null) {
    if (!isNight) {
      return { earned: 0, reason: 'day' };
    }

    if (!inventory?.items || typeof inventory.remove !== 'function') {
      return { earned: 0, reason: 'invalid_inventory' };
    }

    let total = 0;

    // Copia para evitar problemas si el inventario cambia al retirar objetos.
    const substances = inventory.items
      .filter((entry) => ITEMS[entry.id]?.substance && (!itemId || entry.id === itemId))
      .map((entry) => ({ id: entry.id, qty: entry.qty }));

    for (const substance of substances) {
      const item = ITEMS[substance.id];
      const qty = Number(substance.qty) || 0;

      if (!item || qty <= 0) continue;

      total += dealerOffer(item, priceMult) * qty;
      inventory.remove(substance.id, qty);
    }

    return {
      earned: Math.round(total),
      reason: null
    };
  }

  /**
   * Compra una sustancia al dealer (específica o aleatoria).
   * @param {InventorySystem} inventory
   * @param {object} stats
   * @param {string|null} specificItemId
   */
  buySubstance(inventory, stats, specificItemId = null) {
    if (
      !inventory ||
      !Array.isArray(inventory.items) ||
      typeof inventory.add !== 'function' ||
      !stats ||
      !Number.isFinite(stats.dinero)
    ) {
      return { bought: null, cost: 0, reason: 'invalid_data' };
    }

    let itemId = specificItemId;

    if (!itemId) {
      if (!Array.isArray(LOOT_SUBSTANCE) || LOOT_SUBSTANCE.length === 0) {
        return { bought: null, cost: 0, reason: 'empty_loot' };
      }

      // Selección aleatoria ponderada.
      const validLoot = LOOT_SUBSTANCE.filter(
        (entry) => ITEMS[entry.item] && entry.weight > 0
      );

      const totalWeight = validLoot.reduce(
        (sum, entry) => sum + entry.weight,
        0
      );

      if (totalWeight <= 0) {
        return { bought: null, cost: 0, reason: 'empty_loot' };
      }

      let random = Math.random() * totalWeight;
      itemId = validLoot[validLoot.length - 1].item;

      for (const entry of validLoot) {
        random -= entry.weight;

        if (random < 0) {
          itemId = entry.item;
          break;
        }
      }
    }

    const item = ITEMS[itemId];

    if (!item) {
      return { bought: null, cost: 0, reason: 'invalid_item' };
    }

    const cost = dealerPrice(item);

    if (stats.dinero < cost) {
      return { bought: null, cost, reason: 'insufficient_money' };
    }

    if (
      inventory.totalWeight + item.weight >
      inventory.maxWeight
    ) {
      return { bought: null, cost, reason: 'inventory_full' };
    }

    stats.dinero -= cost;
    inventory.add(item, 1);

    return {
      bought: item,
      cost,
      reason: null
    };
  }

  getProducts() {
    return [
      ITEMS.tintico,
      ITEMS.pegante,
      ITEMS.pastilla,
      ITEMS.basuco
    ];
  }

  update(dt) {
    if (this.marker) {
      this.marker.rotation.z += dt * 0.6;
    }

    // El hombre respira y cambia el peso a 30 cuadros por segundo: de cerca no se nota y cuesta la mitad.
    if (!this.persona) return;
    // Si no se dibujó en el cuadro anterior (fuera de cuadro o lejos) nadie ve sus huesos: la pose espera donde iba.
    const dibujado = this._dibujado;
    this._dibujado = false;
    if (!dibujado || this._distancia > ANIMAR_HASTA) { this._animar = 0; return; }
    this._animar += dt;
    if (this._animar < PASO_DE_ANIMACION) return;
    this.persona.update(this._animar, POSTURA);
    this._animar = 0;
  }

  setNight(isNight) {
    this.isNight = isNight;

    if (this.marker) {
      this.marker.material.opacity = isNight ? 0.9 : 0.3;
    }

    this.brillos.material.color.setHex(isNight ? BRILLO_DE_NOCHE : BRILLO_DE_DIA);
    this.luz.intensity = isNight ? LUZ_DE_NOCHE : 0;
  }

  dispose() {
    this._destruido = true;
    this.scene.remove(this.group);
    // El pañuelo es de aquí; el cuerpo y su ropa son del banco compartido y los suelta el propio personaje.
    if (this.panuelo) {
      this.panuelo.removeFromParent();
      this.panuelo.geometry.dispose();
      this.panuelo.material.dispose();
      this.panuelo = null;
    }
    this.persona?.dispose?.();
    this.persona = null;

    this.group.traverse((object) => {
      object.geometry?.dispose?.();

      if (Array.isArray(object.material)) {
        object.material.forEach((material) => material.dispose());
      } else {
        object.material?.dispose?.();
      }
    });
  }
}
