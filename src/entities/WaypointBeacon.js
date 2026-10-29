// src/entities/WaypointBeacon.js
// Haz vertical y anillo en el suelo sobre el destino del GPS. Solo materiales básicos, sin luces.
import * as THREE from 'three';

const BEAM_HEIGHT = 36;

export class WaypointBeacon {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'Destino del GPS';
    this.group.visible = false;

    // Gradiente vertical en la textura: intenso en la base y desvanecido arriba.
    const beamMaterial = new THREE.MeshBasicMaterial({
      color: 0xf6c400, transparent: true, opacity: .42, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    });
    const beamGeometry = new THREE.CylinderGeometry(.55, .55, BEAM_HEIGHT, 16, 6, true);
    beamGeometry.translate(0, BEAM_HEIGHT / 2, 0);
    const colors = [];
    const pos = beamGeometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const fade = 1 - pos.getY(i) / BEAM_HEIGHT;
      colors.push(fade, fade, fade);
    }
    beamGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    beamMaterial.vertexColors = true;
    this.beam = new THREE.Mesh(beamGeometry, beamMaterial);
    this.beam.renderOrder = 5;
    this.group.add(this.beam);

    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(1.1, 1.45, 32),
      new THREE.MeshBasicMaterial({ color: 0xf6c400, transparent: true, opacity: .85, depthWrite: false, side: THREE.DoubleSide })
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = .08;
    this.group.add(this.ring);

    scene.add(this.group);
    this._t = 0;
  }

  /** Coloca el haz o lo oculta si `waypoint` es null. */
  set(waypoint, groundY = 0) {
    this.group.visible = !!waypoint;
    if (waypoint) this.group.position.set(waypoint.x, groundY, waypoint.z);
  }

  update(dt, playerPos) {
    if (!this.group.visible) return;
    this._t += dt;
    const pulse = .5 + .5 * Math.sin(this._t * 3);
    this.ring.scale.setScalar(1 + pulse * .25);
    // Cerca del destino el haz se atenúa para no tapar al jugador.
    const d = playerPos ? Math.hypot(playerPos.x - this.group.position.x, playerPos.z - this.group.position.z) : 99;
    this.beam.material.opacity = (.28 + pulse * .14) * Math.min(1, Math.max(.25, (d - 3) / 12));
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
  }
}
