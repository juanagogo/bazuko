import * as THREE from 'three';

const SLOT_W = 512, SLOT_H = 128, COLS = 4, ROWS = 16;

/**
 * Los rótulos de los locales salen de pocas combinaciones de nombre y color: en vez de una textura y
 * un material por rótulo (un dibujo cada uno), se pintan una vez en atlas compartidos y cada malla
 * apunta a su casilla con UV. Todos los rótulos de un atlas comparten material y se fusionan por chunk.
 */
export class ShopSignAtlas {
  constructor(createSign) {
    this.createSign = createSign;
    this.atlases = [];
    this.slots = new Map();
  }

  /** `{ material, uv: [u0, v0, u1, v1] }`; sin lienzo disponible (pruebas) cae a una textura propia. */
  get(spec) {
    const key = `${spec.title}|${spec.sub}|${spec.bg}|${spec.fg}`;
    if (this.slots.has(key)) return this.slots.get(key);
    const source = this.createSign({ ...spec, w: SLOT_W * 1.5, h: SLOT_H * 1.5 });
    if (!source) return null;
    let slot;
    if (typeof document === 'undefined' || !source.image?.getContext) {
      slot = { material: new THREE.MeshBasicMaterial({ map: source }), uv: [0, 0, 1, 1], own: true };
    } else {
      let atlas = this.atlases.at(-1);
      if (!atlas || atlas.used >= COLS * ROWS) atlas = this._createAtlas();
      const index = atlas.used++, px = (index % COLS) * SLOT_W, py = Math.floor(index / COLS) * SLOT_H;
      atlas.context.drawImage(source.image, px, py, SLOT_W, SLOT_H);
      atlas.texture.needsUpdate = true;
      source.dispose();
      const W = COLS * SLOT_W, H = ROWS * SLOT_H, inset = 1.5;
      slot = { material: atlas.material, uv: [(px + inset) / W, 1 - (py + SLOT_H - inset) / H, (px + SLOT_W - inset) / W, 1 - (py + inset) / H] };
    }
    this.slots.set(key, slot);
    return slot;
  }

  /** Plano de rótulo cuyas UV recorren solo la casilla del atlas. */
  mesh(spec, width) {
    const slot = this.get(spec);
    if (!slot) return null;
    const geometry = new THREE.PlaneGeometry(width, width / 4), uv = geometry.attributes.uv, [u0, v0, u1, v1] = slot.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
    return new THREE.Mesh(geometry, slot.material);
  }

  _createAtlas() {
    const canvas = document.createElement('canvas');
    canvas.width = COLS * SLOT_W;
    canvas.height = ROWS * SLOT_H;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    const atlas = { canvas, context: canvas.getContext('2d'), texture, material: new THREE.MeshBasicMaterial({ map: texture }), used: 0 };
    this.atlases.push(atlas);
    return atlas;
  }

  dispose() {
    for (const atlas of this.atlases) { atlas.texture.dispose(); atlas.material.dispose(); }
    for (const slot of this.slots.values()) if (slot.own) { slot.material.map?.dispose(); slot.material.dispose(); }
    this.atlases.length = 0;
    this.slots.clear();
  }
}
