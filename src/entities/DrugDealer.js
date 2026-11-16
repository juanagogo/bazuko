// src/entities/DrugDealer.js
// El dealer y su esquina de la olla: un tramo de muro con puerta de lata, el guacal de la mercancía, el fogón y la bombilla.
import * as THREE from 'three';
import { COLORS } from '../utils/constants.js';
import { ITEMS, LOOT_SUBSTANCE, dealerPrice, dealerOffer } from '../data/items.js';
import { Piezas, banquito, guacal, materialDePuesto } from './puestoPiezas.js';

const BOMBILLA_APAGADA = 0x5b5660, BOMBILLA_PRENDIDA = 0xe6c2ff;
const LUZ_DE_NOCHE = 4, FUEGO_DE_DIA = 0.5, FUEGO_DE_NOCHE = 1;

// Cotas del puesto, en metros desde el centro del círculo. El frente mira a +z.
const SUELO = 0.04;            // la tierra de la olla
const MURO_Z = -1.05;          // eje del muro largo
const GRUESO = 0.26;
const CARA = MURO_Z + GRUESO / 2; // cara del muro que da al puesto
const CUERPO = [-0.42, -0.55];  // dónde pisa el hombre (x, z)
const GIRO = 0.16;              // y cuánto se abre hacia la calle
// El cable va de la esquina alta del muro a la punta del poste, con su comba.
const ESQUINA = [-2.0, 2.78, -0.63], PUNTA = [2.28, 3.25, 1.1];
const cable = t => [ESQUINA[0] + (PUNTA[0] - ESQUINA[0]) * t, ESQUINA[1] + (PUNTA[1] - 0.15 - ESQUINA[1]) * t - Math.sin(t * Math.PI) * 0.34, ESQUINA[2] + (PUNTA[2] - ESQUINA[2]) * t];
const FOCO = cable(0.38);
const FOGON = [1.85, 0.62];

const PIEL = '#7b5238', BUZO = '#303237', BUZO_CLARO = '#3e4046', JEAN = '#333a48', TENIS = '#c4bfb2';
const REVOQUE = '#6f6858', REVOQUE_SUCIO = '#635c4f', MUGRE = '#514a40', ZOCALO = '#45413c', LADRILLO = '#74432f', LADRILLO_OSCURO = '#613828';
const LATA = '#3b4046', LATA_OSCURA = '#25282c', OXIDO = '#5d3b29', HOLLIN = '#221d1a';

/** El hombre de la esquina: recostado en el muro, un pie contra la pared y las manos en el bolsillo del buzo. */
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
  for (const x of [-0.045, 0.05]) k.caja(0.012, 0.17, 0.012, '#b9b4a8', [x, 1.36, -0.045], [-0.19, 0, x]);
  // Brazos: del hombro al codo y del codo al bolsillo.
  for (const lado of [-1, 1]) {
    k.tramo([lado * 0.27, 1.44, -0.2], [lado * 0.3, 1.15, -0.13], 0.12, 0.13, BUZO);
    k.tramo([lado * 0.3, 1.15, -0.13], [lado * 0.11, 1.06, 0.04], 0.11, 0.12, BUZO);
  }
}

/** Cabeza con capucha y gorra; el origen es el cuello, para que gire sobre él. */
function armarCabeza(k) {
  k.caja(0.11, 0.08, 0.11, PIEL, [0, 0.02, 0.01]);
  k.caja(0.19, 0.23, 0.21, PIEL, [0, 0.13, 0.04]);
  k.caja(0.27, 0.3, 0.25, BUZO, [0, 0.14, -0.02]);
  k.caja(0.23, 0.2, 0.1, BUZO, [0, 0.12, -0.17], [0.35, 0, 0]);
  k.caja(0.2, 0.05, 0.03, COLORS.DEALER, [0, 0.245, 0.12]);
  k.caja(0.19, 0.018, 0.13, COLORS.DEALER, [0, 0.21, 0.19], [0.3, 0, 0]);
}

/** Hiladas de ladrillo a la vista: dos tonos y una sí y otra no salida un centímetro. */
function hiladas(cuantas, poner) {
  const alto = 0.13;
  for (let i = 0; i < cuantas; i++) poner(i, alto * (i + 0.5), alto, i % 3 === 1 ? LADRILLO_OSCURO : LADRILLO, i % 2 ? 0.02 : 0);
}

/** El tramo de muro en ele que queda de una casa caída, con su puerta de lata. */
function armarMuro(k) {
  // Muro largo: tres paños de revoque y, a la derecha, el ladrillo pelado que se fue cayendo en diente de sierra.
  for (const [x0, x1, alto, color] of [[-2.0, -0.9, 2.72, REVOQUE], [-0.9, 0.35, 2.6, REVOQUE_SUCIO], [0.35, 1.3, 2.64, REVOQUE]]) {
    k.caja(x1 - x0, alto, GRUESO, color, [(x0 + x1) / 2, alto / 2, MURO_Z]);
  }
  hiladas(19, (i, y, alto, color, sale) => {
    const x1 = 2.05 - 0.75 * Math.pow(y / 2.5, 1.4) + (i % 2 ? 0.07 : -0.03);
    k.caja(x1 - 1.3, alto, GRUESO + sale, color, [(1.3 + x1) / 2, y, MURO_Z]);
  });
  // El retorno de la esquina: revoque arriba y ladrillo roto hacia la calle.
  k.caja(GRUESO, 2.72, 0.85, REVOQUE_SUCIO, [-2.0, 1.36, -0.63]);
  hiladas(18, (i, y, alto, color, sale) => {
    const z1 = 0.78 - 0.98 * Math.pow(y / 2.4, 1.2) + (i % 2 ? 0.06 : -0.03);
    k.caja(GRUESO + sale, alto, z1 + 0.2, color, [-2.0, y, (z1 - 0.2) / 2]);
  });
  // Zócalo sucio, chorreones de agua y remiendos de ladrillo donde se cayó el revoque.
  k.caja(3.3, 0.42, 0.03, ZOCALO, [-0.35, 0.21, CARA]);
  k.caja(0.03, 0.42, 0.85, ZOCALO, [-1.88, 0.21, -0.52]);
  for (const [x, alto, ancho] of [[-1.72, 0.9, 0.16], [-0.62, 1.3, 0.12], [-0.48, 0.7, 0.2], [0.2, 0.55, 0.14], [1.22, 1.0, 0.1]]) {
    k.caja(ancho, alto, 0.012, MUGRE, [x, 2.6 - alto / 2, CARA + 0.004]);
  }
  for (const [x, y, w, h, color] of [[-1.45, 2.05, 0.55, 0.42, LADRILLO], [-1.3, 2.4, 0.36, 0.22, LADRILLO_OSCURO], [-0.2, 0.75, 0.42, 0.3, LADRILLO], [0.05, 2.32, 0.3, 0.2, LADRILLO_OSCURO], [1.16, 1.2, 0.24, 0.5, LADRILLO]]) {
    k.caja(w, h, 0.025, color, [x, y, CARA]);
  }
  // Ladrillos sueltos sobre el muro roto y caídos al pie.
  for (const [x, y, z, giro] of [[2.3, 0.09, -0.7, 0.6], [2.05, 0.09, -0.4, -0.4], [2.55, 0.09, -1.0, 1.2], [-2.1, 0.09, 1.0, 0.3], [-1.75, 0.09, 0.85, 1.3]]) {
    k.caja(0.24, 0.1, 0.12, LADRILLO, [x, y, z], [0, giro, 0]);
  }
  // Puerta de lata con marco, rejilla y pasador.
  const px = 0.83;
  k.caja(1.02, 2.14, 0.05, LATA_OSCURA, [px, 1.07, CARA]);
  k.caja(0.9, 2.05, 0.05, LATA, [px, 1.03, CARA + 0.02]);
  for (const y of [0.55, 1.05, 1.9]) k.caja(0.9, 0.03, 0.02, LATA_OSCURA, [px, y, CARA + 0.05]);
  k.caja(0.42, 0.24, 0.02, LATA_OSCURA, [px, 1.5, CARA + 0.05]);
  for (const dx of [-0.12, -0.04, 0.04, 0.12]) k.caja(0.022, 0.2, 0.03, '#8b9096', [px + dx, 1.5, CARA + 0.06]);
  k.caja(0.14, 0.05, 0.05, '#8b9096', [px + 0.34, 1.02, CARA + 0.06]);
  k.caja(0.3, 0.5, 0.012, OXIDO, [px - 0.22, 0.28, CARA + 0.05]);
  // Rayones: el garabato morado de la olla, palitos de cuentas y una chorreada.
  const y0 = 1.55, trazo = [[-1.75, 0], [-1.55, 0.42], [-1.4, 0.02], [-1.2, 0.46], [-1.05, 0.06], [-0.98, 0.34]];
  for (let i = 0; i + 1 < trazo.length; i++) {
    k.tramo([trazo[i][0], y0 + trazo[i][1], CARA + 0.02], [trazo[i + 1][0], y0 + trazo[i + 1][1], CARA + 0.02], 0.055, 0.012, COLORS.DEALER);
  }
  k.caja(0.04, 0.3, 0.012, COLORS.DEALER, [-1.4, 1.42, CARA + 0.02]);
  for (let i = 0; i < 4; i++) k.caja(0.025, 0.2, 0.012, '#2a2622', [-0.15 + i * 0.07, 1.62, CARA + 0.02]);
  k.tramo([-0.2, 1.54, CARA + 0.025], [0.11, 1.71, CARA + 0.025], 0.025, 0.012, '#2a2622');
  // Varillas de la columna de la esquina y un par de ladrillos que quedaron arriba.
  for (const [x, z, alto, cae] of [[-2.05, -1.1, 0.5, 0.08], [-1.93, -0.98, 0.38, -0.12]]) k.tramo([x, 2.7, z], [x + cae, 2.72 + alto, z + cae / 2], 0.022, 0.022, '#4a2e22');
  k.caja(0.24, 0.1, 0.12, LADRILLO, [-0.6, 2.65, MURO_Z], [0, 0.3, 0]);
  k.caja(0.24, 0.1, 0.12, LADRILLO_OSCURO, [0.95, 2.69, MURO_Z], [0, -0.2, 0]);
}

/** Lo que hay alrededor: guacal volteado con la mercancía, banquito, fogón de caneca, poste, cable y manchas. */
function armarSitio(k) {
  // Guacal volteado con la mercancía: termo de tinto, frasco de pegante, caja de pastillas y unas papeletas.
  guacal(k, [0.42, SUELO, -0.48], 0.18);
  k.en([0.42, SUELO, -0.48], [0, 0.18, 0], () => {
    k.tubo(0.055, 0.06, 0.26, 8, '#6b2f2a', [-0.17, 0.65, -0.06]);
    k.tubo(0.035, 0.05, 0.05, 8, '#d8d4c8', [-0.17, 0.805, -0.06]);
    k.tubo(0.045, 0.045, 0.13, 8, '#c9a23a', [0.04, 0.585, 0.1]);
    k.tubo(0.02, 0.03, 0.04, 6, '#7a2a22', [0.04, 0.67, 0.1]);
    k.caja(0.17, 0.06, 0.11, '#e8e6df', [0.2, 0.55, -0.08], [0, 0.4, 0]);
    for (const [x, z] of [[-0.02, -0.14], [0.05, -0.1], [0.22, 0.12]]) k.caja(0.05, 0.012, 0.035, '#e8e6df', [x, 0.526, z], [0, x * 9, 0]);
  });
  // Banquito de vigilar, en el rincón, con un cartón debajo.
  banquito(k, [-1.45, SUELO, -0.4], 0.5);
  k.caja(0.95, 0.012, 0.7, '#8a6f4a', [-1.4, SUELO + 0.012, -0.35], [0, 0.3, 0]);
  // Fogón: media caneca sobre ladrillos, tiznada arriba.
  const [fx, fz] = FOGON;
  for (const a of [0.4, 2.5, 4.6]) k.caja(0.22, 0.1, 0.11, LADRILLO_OSCURO, [fx + Math.cos(a) * 0.2, SUELO + 0.05, fz + Math.sin(a) * 0.2], [0, -a, 0]);
  k.tubo(0.3, 0.27, 0.5, 10, OXIDO, [fx, SUELO + 0.35, fz], [0, 0, 0], true);
  k.tubo(0.305, 0.3, 0.09, 10, HOLLIN, [fx, SUELO + 0.565, fz], [0, 0, 0], true);
  k.disco(0.28, 10, HOLLIN, [fx, SUELO + 0.5, fz]);
  k.tubo(0.27, 0.27, 0.02, 10, '#3d2a20', [fx, SUELO + 0.11, fz]);
  for (const [x, y, z, rot] of [[-0.1, 0.56, 0.05, [0.3, 0.4, 0.9]], [0.12, 0.55, -0.08, [1.1, 0.2, 0.3]]]) k.caja(0.05, 0.42, 0.05, '#3a2a1c', [fx + x, SUELO + y, fz + z], rot);
  // Poste viejo que sostiene el cable; de él cuelgan la bombilla y un par de tenis.
  k.tramo([2.35, SUELO, 1.15], PUNTA, 0.11, 0.11, '#4a3b2c');
  k.caja(0.5, 0.07, 0.05, '#4a3b2c', [2.2, 3.0, 1.1], [0, 0.5, 0]);
  const cortes = [0, 0.18, 0.38, 0.56, 0.74, 0.88, 1];
  for (let i = 0; i + 1 < cortes.length; i++) k.tramo(cable(cortes[i]), cable(cortes[i + 1]), 0.022, 0.022, '#17171a');
  k.tramo(FOCO, [FOCO[0], FOCO[1] - 0.3, FOCO[2]], 0.014, 0.014, '#17171a');
  k.tubo(0.035, 0.045, 0.07, 6, '#2b2b2e', [FOCO[0], FOCO[1] - 0.33, FOCO[2]]);
  const nudo = cable(0.74);
  for (const [dx, largo, giro] of [[-0.07, 0.34, 0.5], [0.08, 0.5, -0.4]]) {
    k.tramo(nudo, [nudo[0] + dx, nudo[1] - largo, nudo[2]], 0.01, 0.01, '#d8d4c8');
    k.en([nudo[0] + dx, nudo[1] - largo - 0.09, nudo[2]], [0.2, giro, 1.3], () => {
      k.caja(0.23, 0.022, 0.08, '#2a2a2c', [0, -0.03, 0]);
      k.caja(0.22, 0.045, 0.075, TENIS, [0, 0, 0]);
      k.caja(0.09, 0.1, 0.07, TENIS, [-0.065, 0.07, 0]);
      k.caja(0.05, 0.035, 0.072, COLORS.DEALER, [-0.085, 0.1, 0]);
    });
  }
  // Suelo: tizne del fogón, un charco, humedad al pie del muro y basura menuda.
  const y = SUELO + 0.022;
  k.disco(0.5, 11, '#3b3229', [fx + 0.05, y, fz + 0.05], [1.15, 0.9], 0.4);
  k.disco(0.3, 9, '#2e2722', [fx - 0.05, y + 0.003, fz + 0.12], [1.1, 0.8], 1.3);
  k.disco(0.36, 12, '#45474a', [0.8, y, 1.6], [1.5, 0.7], 0.3);
  k.disco(0.22, 10, '#45474a', [1.2, y, 1.75], [1.3, 0.8], 0.9);
  k.disco(0.45, 10, '#55493a', [-0.6, y, -0.62], [2.3, 0.45], 0);
  k.tubo(0.035, 0.04, 0.2, 6, '#2f4a35', [-0.95, SUELO + 0.04, -0.72], [Math.PI / 2, 0, 0.7]);
  k.tubo(0.035, 0.04, 0.2, 6, '#5a4a2a', [1.35, SUELO + 0.04, -0.6], [Math.PI / 2, 0, -0.5]);
  k.caja(0.3, 0.012, 0.22, '#8a6f4a', [0.3, SUELO + 0.012, 0.75], [0, 0.8, 0]);
}

/** Llama de pocas caras: el color va en los vértices y no recibe luz, así alumbra sola. */
function armarLlama() {
  const k = new Piezas();
  k.pieza(new THREE.ConeGeometry(0.12, 0.44, 5), '#f2661c', [0.02, 0.22, 0], [0.08, 0, -0.06]);
  k.pieza(new THREE.ConeGeometry(0.1, 0.32, 4), '#f58a26', [-0.12, 0.16, 0.05], [0.15, 0.5, 0.25]);
  k.pieza(new THREE.ConeGeometry(0.09, 0.27, 4), '#f2661c', [0.13, 0.13, -0.06], [-0.2, 0.2, -0.3]);
  k.pieza(new THREE.ConeGeometry(0.07, 0.24, 4), '#f7b84a', [0.01, 0.14, 0.03], [0, 0.7, 0]);
  k.disco(0.25, 8, '#a8340f', [0, 0.012, 0]);
  k.disco(0.12, 6, '#e2601a', [0.05, 0.016, -0.03]);
  return k.malla(new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }), { sombra: false });
}

export class DrugDealer {
  constructor(scene, position) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.position.copy(position);
    this.scene.add(this.group);

    // El sitio y el cuerpo, fundidos en una sola malla.
    const material = materialDePuesto();
    const sitio = new Piezas();
    armarMuro(sitio);
    armarSitio(sitio);
    sitio.en([CUERPO[0], SUELO, CUERPO[1]], [0, GIRO, 0], () => armarCuerpo(sitio));
    this.sitio = sitio.malla(material);
    this.sitio.name = 'Esquina del dealer';
    this.group.add(this.sitio);

    const cabeza = new Piezas();
    armarCabeza(cabeza);
    this.cabeza = cabeza.malla(material);
    this.cabeza.name = 'Cabeza del dealer';
    // El cuello queda a 1,52 m, 20 cm detrás de donde pisa: la cabeza es otra malla para que mire a los lados.
    this.cabeza.position.set(CUERPO[0] - Math.sin(GIRO) * 0.2, SUELO + 1.52, CUERPO[1] - Math.cos(GIRO) * 0.2);
    this.group.add(this.cabeza);

    // Fogón: la llama titila; de día queda en brasa.
    this.llama = armarLlama();
    this.llama.name = 'Llama del fogón';
    this.llama.position.set(FOGON[0], SUELO + 0.5, FOGON[1]);
    this.group.add(this.llama);

    // Bombilla pelada, colgada del cable, y la rendija de la puerta: de noche se encienden.
    const luces = new Piezas();
    const foco = [FOCO[0], FOCO[1] - 0.42, FOCO[2]];
    luces.pieza(new THREE.SphereGeometry(0.075, 6, 4), '#ffffff', foco);
    luces.caja(0.36, 0.05, 0.01, '#ffffff', [0.83, 1.5, CARA + 0.047]);
    this.bombilla = luces.malla(new THREE.MeshBasicMaterial({ vertexColors: true, color: BOMBILLA_APAGADA, toneMapped: false }), { sombra: false });
    this.bombilla.name = 'Bombilla del dealer';
    this.group.add(this.bombilla);

    // La luz morada de siempre, ahora en la bombilla.
    this.luz = new THREE.PointLight(0x9b59b6, 0, 9);
    this.luz.position.set(foco[0], foco[1] - 0.15, foco[2] + 0.1);
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
    this._t = 0;
    this._fuego = FUEGO_DE_DIA;
    this.setNight(false);
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

    this._t += dt;
    const t = this._t;
    // La llama crece y se encoge a saltos cortos; al cambiar la hora pasa de brasa a fuego en un par de segundos.
    this._fuego += ((this.isNight ? FUEGO_DE_NOCHE : FUEGO_DE_DIA) - this._fuego) * Math.min(1, dt * 1.5);
    const alto = this._fuego * (1 + Math.sin(t * 13.7) * 0.1 + Math.sin(t * 23.1) * 0.06);
    const ancho = (0.7 + this._fuego * 0.3) * (1 + Math.sin(t * 9.3 + 1) * 0.07);
    this.llama.scale.set(ancho, alto, ancho);
    this.llama.rotation.y = t * 1.3;
    // Vigila: mira despacio a un lado y al otro de la calle.
    this.cabeza.rotation.y = GIRO + Math.sin(t * 0.45) * 0.5 + Math.sin(t * 0.17) * 0.2;
  }

  setNight(isNight) {
    this.isNight = isNight;

    if (this.marker) {
      this.marker.material.opacity = isNight ? 0.9 : 0.3;
    }

    this.bombilla.material.color.setHex(isNight ? BOMBILLA_PRENDIDA : BOMBILLA_APAGADA);
    this.luz.intensity = isNight ? LUZ_DE_NOCHE : 0;
  }

  dispose() {
    this.scene.remove(this.group);

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
