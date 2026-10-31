import * as THREE from 'three';
import { createDroppedItemModel } from './droppedItemModel.js';

export const DROP_LIFETIME = 10;

/** Objeto exacto del inventario: nunca genera botín aleatorio ni reaparece. */
export class DroppedItem {
  constructor(scene, position, item, quantity) {
    this.scene = scene;
    this.kind = 'dropped-item';
    this.item = { ...item };
    this.quantity = quantity;
    this.remaining = DROP_LIFETIME;
    this.used = false;
    this.group = new THREE.Group();
    this.group.name = `soltado-${item.id}`;
    this.group.position.copy(position);
    this.model = createDroppedItemModel(item.id);
    this.group.add(this.model);
    const material = new THREE.MeshBasicMaterial({ color: 0xffd166, side: THREE.DoubleSide, transparent: true, opacity: .8, depthWrite: false });
    this.marker = new THREE.Mesh(new THREE.RingGeometry(.36, .4, 24), material);
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.position.y = .015;
    this.group.add(this.marker);
    if (globalThis.document?.createElement) {
      this.canvas = document.createElement('canvas');
      this.canvas.width = 512; this.canvas.height = 128;
      this.context = this.canvas.getContext('2d');
      this.texture = new THREE.CanvasTexture(this.canvas);
      this.texture.colorSpace = THREE.SRGBColorSpace;
      this.label = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.texture, depthWrite: false }));
      this.label.position.y = 2.05;
      this.label.scale.set(2, .5, 1);
      this.group.add(this.label);
      this.refreshLabel();
    }
    scene.add(this.group);
  }

  get position() { return this.group.position; }

  refreshLabel() {
    const ctx = this.context;
    if (!ctx) return;
    ctx.clearRect(0, 0, 512, 128);
    ctx.fillStyle = 'rgba(20,25,29,.9)'; ctx.fillRect(0, 0, 512, 128);
    ctx.textAlign = 'center'; ctx.fillStyle = '#fff3cf';
    let size = 34;
    const text = `${this.item.name}${this.quantity > 1 ? ` ×${this.quantity}` : ''}`;
    ctx.font = `bold ${size}px sans-serif`;
    while (ctx.measureText(text).width > 490 && size > 12) ctx.font = `bold ${--size}px sans-serif`;
    ctx.fillText(text, 256, 51);
    ctx.font = '27px sans-serif'; ctx.fillStyle = '#ffd166';
    ctx.fillText(`[E] Recoger · ${Math.ceil(this.remaining)} s`, 256, 100);
    this.texture.needsUpdate = true;
    this._shownSecond = Math.ceil(this.remaining);
  }

  update(dt, playerPosition) {
    if (this.used) return;
    this.remaining = Math.max(0, this.remaining - dt);
    if (this.label) this.label.visible = this.position.distanceToSquared(playerPosition) < 100;
    if (this._shownSecond !== Math.ceil(this.remaining)) this.refreshLabel();
    this.marker.material.opacity = this.remaining < 3 ? .35 + .45 * Math.abs(Math.sin(this.remaining * 8)) : .8;
  }

  dispose() {
    if (this.used) return;
    this.used = true;
    this.group.removeFromParent();
    const geometries = new Set(), materials = new Set();
    this.group.traverse(o => {
      if (o.geometry) geometries.add(o.geometry);
      if (o.material) materials.add(o.material);
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    this.texture?.dispose();
  }
}
