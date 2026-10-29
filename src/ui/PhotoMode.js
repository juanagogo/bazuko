import * as THREE from 'three';
import { el } from './dom.js';

const CAMERA_KEYS = ['mode', 'yaw', 'pitch', 'distance', 'baseFov', 'targetFov'];
const ORBIT_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);

/** Congela la partida y encuadra una fotografía con la cámara existente. */
export class PhotoMode {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.busy = false;
    this._frustum = new THREE.Frustum();
    this._projection = new THREE.Matrix4();
    this._npcBounds = new THREE.Sphere(new THREE.Vector3(), 1.4);
    this._build();
    this._onKey = event => this.handleKey(event);
    window.addEventListener('keydown', this._onKey, true);
  }

  _build() {
    this.launch = el('button', { id: 'photo-mode-open', type: 'button',
      'aria-label': 'Abrir modo foto (F2)', title: 'Modo foto (F2)', onclick: () => this.enter() }, 'Foto ', el('kbd', {}, 'F2'));
    document.getElementById('game-settings')?.append(this.launch);
    this.status = el('p', { class: 'photo-mode__status', role: 'status', 'aria-live': 'polite' }, 'La ciudad está en pausa.');
    this.captureButton = el('button', { type: 'button', class: 'photo-mode__capture', onclick: () => this.capture() }, 'Guardar foto');
    this.closeButton = el('button', { type: 'button', class: 'photo-mode__close', onclick: () => this.exit() }, 'Volver al juego ', el('kbd', {}, 'Esc'));
    const orbitButton = (label, text, dx, dy) => el('button', {
      type: 'button', 'aria-label': label, onclick: () => this.game.cameraRig.orbit(dx, dy)
    }, text);
    const zoomButton = (label, text, delta) => el('button', {
      type: 'button', 'aria-label': label, onclick: () => this.game.cameraRig.zoom(delta)
    }, text);
    this.root = el('section', { id: 'photo-mode', hidden: true, role: 'dialog', 'aria-modal': 'true',
      'aria-labelledby': 'photo-mode-title', 'aria-describedby': 'photo-mode-help' },
      el('div', { class: 'photo-mode__panel' },
        el('div', { class: 'photo-mode__head' },
          el('h2', { id: 'photo-mode-title' }, 'Una postal de Bogotá'), el('span', { class: 'photo-mode__badge' }, 'Modo foto')),
        el('p', { id: 'photo-mode-help' }, 'Arrastra sobre la ciudad o usa las flechas para girar. Acerca con la rueda.'),
        el('div', { class: 'photo-mode__tools', role: 'group', 'aria-label': 'Encuadre' },
          orbitButton('Girar a la izquierda', '←', -36, 0), orbitButton('Girar a la derecha', '→', 36, 0),
          orbitButton('Subir cámara', '↑', 0, 24), orbitButton('Bajar cámara', '↓', 0, -24),
          zoomButton('Acercar cámara', '+', -100), zoomButton('Alejar cámara', '−', 100)),
        this.status,
        el('div', { class: 'photo-mode__actions' }, this.captureButton, this.closeButton)));
    document.body.append(this.root);
  }

  _clearInput() {
    this.game.input.keys = {};
    this.game.input.endFrame();
  }

  enter() {
    const game = this.game;
    if (this.active || game.paused || game.isSleeping || !game._running || game.player.isRagdollActive || game.stats.salud <= 0) return false;
    this._previousFocus = document.activeElement;
    this._camera = Object.fromEntries(CAMERA_KEYS.map(key => [key, game.cameraRig[key]]));
    this._camera.fov = game.cameraRig.camera.fov;
    this._clearInput();
    game.cameraRig.releaseControls();
    this.active = true;
    game.cameraRig.mode = 'third-person';
    game.cameraRig.camera.userData.cameraMode = 'third-person';
    game.cameraRig._snap = true;
    this.update(0);
    game.audio.setPaused(true);
    game.radio?.setPaused(true);
    document.body.classList.add('is-photo-mode');
    this.root.hidden = false;
    this.status.textContent = 'La ciudad está en pausa. La foto se guarda sin interfaz.';
    this.captureButton.focus({ preventScroll: true });
    return true;
  }

  exit() {
    if (!this.active) return false;
    const game = this.game;
    this.active = false;
    this.root.hidden = true;
    document.body.classList.remove('is-photo-mode');
    for (const key of CAMERA_KEYS) game.cameraRig[key] = this._camera[key];
    game.cameraRig.camera.fov = this._camera.fov;
    game.cameraRig.camera.userData.cameraMode = this._camera.mode;
    game.cameraRig.camera.updateProjectionMatrix();
    game.cameraRig._snap = true;
    game.cameraRig.releaseControls();
    game.cameraRig.follow(game.player.position, 0, game.collisions);
    this._syncCameraView();
    this._clearInput();
    game.audio.setPaused(!!(game.paused || game.isSleeping || document.hidden));
    game.radio?.setPaused(!!(game.paused || game.isSleeping || document.hidden));
    (this._previousFocus?.isConnected ? this._previousFocus : this.launch)?.focus({ preventScroll: true });
    return true;
  }

  update(dt) {
    this.game.cameraRig.updateControls(dt, this.game.input);
    this.game.cameraRig.follow(this.game.player.position, dt, this.game.collisions, 0, false);
    this._syncCameraView();
  }

  _syncCameraView() {
    const district = this.game.world?.active;
    if (!district) return;
    const camera = this.game.cameraRig.camera;
    camera.updateMatrixWorld();
    // La geometría recortada en isométrica debe cerrarse también sin simular.
    district.buildingVisibility?.update(0, this.game.player.position, camera);
    this._frustum.setFromProjectionMatrix(this._projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const actors = [...(district.npcs ?? []),
      ...(this.game.roadRage?.preloadables ?? []).filter(npc => npc.active),
      ...(this.game.limpieza?.preloadables ?? []).filter(npc => npc.active)];
    for (const npc of actors) {
      // Mismo volumen de Npc.update. No llamar update(0): puede consumir animAcc,
      // elegir una ruta o emitir una frase aun sin transcurrir tiempo de juego.
      this._npcBounds.center.set(npc.position.x, npc.position.y + .9, npc.position.z);
      npc.root.visible = this._frustum.intersectsSphere(this._npcBounds);
    }
  }

  handleKey(event) {
    const typing = event.target?.closest?.('input, textarea, select, [contenteditable="true"]');
    if (event.code === 'F2' && !typing) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!event.repeat) this.active ? this.exit() : this.enter();
      return;
    }
    if (!this.active) return;
    if (event.code === 'Escape') {
      event._panelHandled = true;
      event.preventDefault();
      event.stopImmediatePropagation();
      this.exit();
    } else if (event.code === 'Tab') {
      const buttons = [...this.root.querySelectorAll('button:not([disabled])')];
      const current = buttons.indexOf(document.activeElement);
      const next = (current + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length;
      buttons[next]?.focus({ preventScroll: true });
      event.preventDefault();
      event.stopImmediatePropagation();
    } else if (!ORBIT_KEYS.has(event.code)) {
      // Los atajos de inventario, cámara, radio y acciones no cambian la partida.
      // Sin preventDefault: Enter/Espacio conservan la activación de los botones.
      event.stopImmediatePropagation();
    }
  }

  async capture() {
    if (!this.active || this.busy) return false;
    this.busy = true;
    this.captureButton.disabled = true;
    this.status.textContent = 'Preparando la foto…';
    try {
      // toBlob se invoca en el mismo turno que el render; no necesita conservar
      // el buffer WebGL entre cuadros ni aumentar el coste habitual del juego.
      this.game._renderFrame(performance.now(), false);
      const blob = await new Promise((resolve, reject) => this.game.canvas.toBlob(
        result => result ? resolve(result) : reject(new Error('La imagen no está disponible.')), 'image/png'));
      const url = URL.createObjectURL(blob);
      const link = el('a', { href: url, download: `Vagabundo-Bogota-${new Date().toISOString().replace(/[:.]/g, '-')}.png` });
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      this.status.textContent = 'Foto lista. Revisa las descargas del navegador.';
      return true;
    } catch (error) {
      this.status.textContent = 'No se pudo guardar la foto. Vuelve a intentarlo.';
      return false;
    } finally {
      this.busy = false;
      this.captureButton.disabled = false;
    }
  }
}
