// src/entities/Shop.js
// Tienda La Esquinita: comida, remedios y materiales para el cambuche.
import * as THREE from 'three';
import { signMesh, signTexture } from '../utils/signs.js';
import { glowMaterial, followNight } from '../world/bogota/StoreGlow.js';
import { buildShopGeometry } from './shopModel.js';

// Letreros pintados a mano en los costados: crema, rojo y azul, como el resto de la caseta.
const HAND_PAINTED = { bg: '#f1e6c8', fg: '#b3261e', accent: '#1d4f91', w: 512, h: 256 };

export class Shop {
  constructor(scene, position) {
    this.scene = scene;
    this.kind = 'shop';

    this.group = new THREE.Group();
    this.group.position.copy(position);
    scene.add(this.group);

    // Caseta, mercancía, toldo y bombillos: una sola malla. Lo que brilla se enciende de noche.
    const body = new THREE.Mesh(buildShopGeometry(), glowMaterial(THREE.MeshLambertMaterial));
    body.name = 'Caseta La Esquinita';
    body.castShadow = body.receiveShadow = true;
    this.group.add(followNight(body, { day: .12 }));

    // Letrero sobre el techo
    const sign = signMesh({ title: 'LA ESQUINITA', sub: 'TIENDA · MISCELÁNEA' }, 2.6);
    sign.position.set(0, 3.14, -.04);
    this.group.add(sign);

    // Avisos de los costados
    const notice = (opts, x, yaw) => {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.1, .55),
        new THREE.MeshBasicMaterial({ map: signTexture({ ...HAND_PAINTED, ...opts }) }));
      mesh.position.set(x, 1.98, -.72);
      mesh.rotation.y = yaw;
      this.group.add(mesh);
    };
    notice({ title: 'HOY NO FÍO', sub: 'MAÑANA SÍ' }, 1.206, Math.PI / 2);
    notice({ title: 'MINUTOS', sub: 'RECARGAS · LLAMADAS' }, -1.206, -Math.PI / 2);

    // Luz cálida del local
    const light = new THREE.PointLight(0xffd9a0, 3, 7);
    light.position.set(0, 2, 0.4);
    this.group.add(light);
  }

  get position() { return this.group.position; }

  update() {}

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      o.geometry?.dispose?.();
      o.material?.map?.dispose?.();
      o.material?.dispose?.();
    });
  }
}
