// src/ui/PlayerOverhead.js
// Barra de selección de basura + iconos de enfermedad flotando sobre la cabeza del jugador.
import * as THREE from 'three';
import { SORT_BASE_TIME } from '../utils/constants.js';

const HEAD_HEIGHT = 2.1; // altura aprox. de la cabeza sobre el suelo
const MARGIN_PX = 8;     // separación entre el elemento y la cabeza

export class PlayerOverhead {
  constructor() {
    this.root = document.createElement('div');
    this.root.id = 'player-overhead';

    this.barEl = document.createElement('div');
    this.barEl.className = 'po-bar';
    this.fillEl = document.createElement('div');
    this.fillEl.className = 'po-fill';
    this.barEl.appendChild(this.fillEl);

    this.iconsEl = document.createElement('div');
    this.iconsEl.className = 'po-icons';

    // Barra arriba, iconos debajo (más cerca de la cabeza): no se solapan
    this.root.append(this.barEl, this.iconsEl);
    document.body.appendChild(this.root);

    this._v = new THREE.Vector3();
    this._barShown = false;
    this._done = false;
    this._rootShown = false;
    this._diseaseKey = '';
  }

  /**
   * Llamar cada frame DESPUÉS de renderer.render (la cámara ya tiene su matriz actualizada).
   * @param {{x:number,y:number,z:number}} playerPos
   * @param {THREE.Camera} camera
   * @param {HTMLCanvasElement} canvas
   * @param {object|null} sortingPickup pickup en selección o null
   * @param {object} diseases DiseaseSystem
   */
  update(playerPos, camera, canvas, sortingPickup, diseases) {
    // --- Barra de selección ---
    const sorting = !!(sortingPickup && sortingPickup.sorting);
    if (sorting !== this._barShown) {
      this._barShown = sorting;
      this.barEl.style.display = sorting ? 'block' : 'none';
      if (!sorting) { this._done = false; this.fillEl.classList.remove('done'); }
    }
    if (sorting) {
      const pct = Math.min(1, sortingPickup.sortProgress / SORT_BASE_TIME);
      this.fillEl.style.transform = `scaleX(${pct})`;
      const done = pct >= 1;
      if (done !== this._done) {
        this._done = done;
        this.fillEl.classList.toggle('done', done);
      }
    }

    // --- Iconos de enfermedad (DOM solo cuando cambia la lista) ---
    const key = Object.keys(diseases.active).join(',');
    if (key !== this._diseaseKey) {
      this._diseaseKey = key;
      this.iconsEl.textContent = '';
      if (key) {
        for (const d of diseases.list) {
          const s = document.createElement('span');
          s.className = `po-icon d-${d.id}`;
          s.textContent = d.emoji;
          s.title = d.name;
          this.iconsEl.appendChild(s);
        }
      }
    }

    // --- Visibilidad y posición ---
    const wantShown = sorting || key !== '';
    let visible = false;
    if (wantShown) {
      const v = this._v.set(playerPos.x, playerPos.y + HEAD_HEIGHT, playerPos.z).project(camera);
      // v.z > 1 => detrás de la cámara / fuera del frustum
      if (v.z < 1 && Math.abs(v.x) <= 1.05 && Math.abs(v.y) <= 1.05) {
        const x = (v.x * 0.5 + 0.5) * canvas.clientWidth;
        const y = (-v.y * 0.5 + 0.5) * canvas.clientHeight - MARGIN_PX;
        this.root.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -100%)`;
        visible = true;
      }
    }
    if (visible !== this._rootShown) {
      this._rootShown = visible;
      this.root.style.visibility = visible ? 'visible' : 'hidden';
    }
  }
}
