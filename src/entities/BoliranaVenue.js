import { BOLIRANA_LOCATION as L } from '../world/bogota/BoliranaLocation.js';
import * as T from 'three';
import { signMesh } from '../utils/signs.js';
export class BoliranaVenue {
  constructor(scene, district) {
    const groundHeight = district.getGroundHeight(L.x, L.z);
    this.kind = 'bolirana';
    this.title = 'El Rumbiadero';
    this.position = new T.Vector3(L.x, groundHeight, L.z);
    this.group = new T.Group();
    this.group.position.set(L.faceX, groundHeight, L.faceZ);
    this.group.rotation.y = L.yaw;
    scene.add(this.group);
    const box = (w, h, d, x, y, z, color, emissive = false) => {
      const m = new T.Mesh(
        new T.BoxGeometry(w, h, d),
        new T.MeshLambertMaterial({
          color,
          emissive: emissive ? color : 0,
          emissiveIntensity: emissive ? 0.7 : 0
        })
      );
      m.position.set(x, y, z);
      this.group.add(m);
    };
    // Fachada delgada sobre la pared existente.
    box(3.8, 3.7, 0.035, 0, 1.85, 0, 0x30213e);
    box(1.5, 2.65, 0.12, 0, 1.35, 0.2, 0x100e1e);
    for (const x of [-0.85, 0.85])
      box(0.08, 2.8, 0.15, x, 1.4, 0.3, 0xf052aa, true);
    box(1.8, 0.08, 0.15, 0, 2.8, 0.3, 0xb9ed83, true);
    const sign = signMesh(
      {
        title: 'EL RUMBIADERO',
        sub: 'BOLIRANA · ENTRADA',
        bg: '#281b35',
        fg: '#ffe4a0'
      },
      3.8
    );
    sign.position.set(0, 3.4, 0.3);
    this.group.add(sign);
  }
  dispose() {
    this.group.removeFromParent();
    this.group.traverse((o) => {
      o.geometry?.dispose();
      o.material?.map?.dispose();
      o.material?.dispose();
    });
  }
}
