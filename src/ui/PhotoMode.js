import * as THREE from 'three';
import { el } from './dom.js';
import { icon } from './icons.js';

const CAMERA_KEYS = ['mode', 'yaw', 'pitch', 'distance', 'baseFov', 'targetFov'];
const ORBIT_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);
const EN_PAUSA = 'La ciudad está en pausa.';

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
    this.status = el('p', { class: 'photo-mode__status', role: 'status', 'aria-live': 'polite' }, EN_PAUSA);
    this.captureButton = el('button', { type: 'button', class: 'cinta cinta--verbo photo-mode__capture', onclick: () => this.capture() }, 'Guardar foto');
    this.closeButton = el('button', { type: 'button', class: 'cinta photo-mode__close', 'aria-label': 'Volver al juego', onclick: () => this.exit() },
      el('span', {}, 'Volver'), el('span', { class: 'photo-mode__largo' }, ' al juego'), el('kbd', {}, 'Esc'));
    this.hideButton = el('button', { type: 'button', class: 'cinta photo-mode__hide', 'aria-label': 'Esconder controles (H)', onclick: () => this.setClean(true) },
      icon('eye', { size: 20 }), el('span', { class: 'photo-mode__largo' }, 'Esconder'), el('kbd', {}, 'H'));
    this.showButton = el('button', { type: 'button', class: 'cinta photo-mode__show', hidden: true, 'aria-label': 'Mostrar controles (H)', title: 'Mostrar controles (H)', onclick: () => this.setClean(false) },
      icon('eye', { size: 20 }));
    const orbitButton = (label, text, dx, dy) => el('button', {
      type: 'button', class: 'cinta', 'aria-label': label, onclick: () => this.game.cameraRig.orbit(dx, dy)
    }, text);
    const zoomButton = (label, text, delta) => el('button', {
      type: 'button', class: 'cinta', 'aria-label': label, onclick: () => this.game.cameraRig.zoom(delta)
    }, text);
    this.panel = el('div', { class: 'carton corte-b photo-mode__panel' },
      el('div', { class: 'photo-mode__head' },
        el('h2', { id: 'photo-mode-title' }, 'Una foto de Bogotá'),
        el('p', { id: 'photo-mode-help' }, 'Arrastrar o flechas: girar. Rueda: acercar.'),
        this.status),
      el('div', { class: 'photo-mode__tools', role: 'group', 'aria-label': 'Encuadre' },
        orbitButton('Girar a la izquierda', '←', -36, 0), orbitButton('Girar a la derecha', '→', 36, 0),
        orbitButton('Subir cámara', '↑', 0, 24), orbitButton('Bajar cámara', '↓', 0, -24),
        zoomButton('Acercar cámara', '+', -100), zoomButton('Alejar cámara', '−', 100)),
      el('div', { class: 'photo-mode__actions' }, this.hideButton, this.captureButton, this.closeButton));
    this.root = el('section', { id: 'photo-mode', hidden: true, role: 'dialog', 'aria-modal': 'true',
      'aria-labelledby': 'photo-mode-title', 'aria-describedby': 'photo-mode-help' }, this.panel, this.showButton);
    document.body.append(this.root);
  }

  /** Los controles se quitan de encima para mirar el encuadre; nunca salen en la foto, con o sin esconderlos. */
  setClean(clean) {
    if (!this.active || this.clean === clean) return;
    this.clean = clean;
    this.root.classList[clean ? 'add' : 'remove']('is-limpio');
    this.panel.hidden = clean;
    this.showButton.hidden = !clean;
    (clean ? this.showButton : this.hideButton).focus({ preventScroll: true });
  }

  /** Lo que el juego pinta dentro del mundo para orientar: en la foto solo va la ciudad. */
  _worldMarks() {
    const game = this.game;
    return [
      game.gpsBeacon?.group, game.dealer?.marker, game.craftingStation?.marker, game.cambuche?.marker,
      ...(game.pickups ?? []).flatMap((pickup) => [pickup.marker, pickup.aura, pickup.sortBarBg, pickup.sortBarFill]),
      ...(game.cars ?? []).map((car) => car.marker),
    ].filter(Boolean);
  }

  _hideWorldMarks() {
    this._marks = this._worldMarks().map((mark) => [mark, mark.visible]);
    for (const [mark] of this._marks) mark.visible = false;
  }

  _restoreWorldMarks() {
    for (const [mark, visible] of this._marks ?? []) mark.visible = visible;
    this._marks = null;
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
    this._say(EN_PAUSA);
    this.clean = false;
    this.panel.hidden = false;
    this.showButton.hidden = true;
    this.root.classList.remove('is-limpio');
    this._hideWorldMarks();
    this.captureButton.focus({ preventScroll: true });
    return true;
  }

  exit() {
    if (!this.active) return false;
    const game = this.game;
    this.active = false;
    this.root.hidden = true;
    document.body.classList.remove('is-photo-mode');
    this._restoreWorldMarks();
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
    // Una foto se mira con calma: en ella, todos los postes completos.
    district.signals?.updateDetail(camera.position, false);
    const actors = [...(district.npcs ?? []),
      ...(this.game.roadRage?.preloadables ?? []).filter(npc => npc.active),
      ...(this.game.limpieza?.preloadables ?? []).filter(npc => npc.active)];
    for (const npc of actors) {
      // Mismo volumen de Npc.update. No llamar update(0): puede consumir animAcc,
      // elegir una ruta o emitir una frase aun sin transcurrir tiempo de juego.
      this._npcBounds.center.set(npc.position.x, npc.position.y + .9, npc.position.z);
      npc.root.visible = this._frustum.intersectsSphere(this._npcBounds);
      npc.root.matrixWorldAutoUpdate = true; // uno oculto en baja vuelve a salir donde está
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
    if (event.code === 'KeyH') {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!event.repeat) this.setClean(!this.clean);
    } else if (event.code === 'Escape') {
      event._panelHandled = true;
      event.preventDefault();
      event.stopImmediatePropagation();
      this.exit();
    } else if (event.code === 'Tab') {
      const buttons = [...this.root.querySelectorAll('button:not([disabled])')].filter((button) => this.clean ? button === this.showButton : button !== this.showButton);
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

  /** Pausa es lo normal y no hace falta verlo en un celular; lo demás sí se muestra. */
  _say(text) {
    this.status.textContent = text;
    this.status.classList[text === EN_PAUSA ? 'remove' : 'add']('is-aviso');
  }

  async capture() {
    if (!this.active || this.busy) return false;
    this.busy = true;
    this.captureButton.disabled = true;
    this._say('Preparando la foto…');
    try {
      // toBlob se invoca en el mismo turno que el render; no necesita conservar
      // el buffer WebGL entre cuadros ni aumentar el coste habitual del juego.
      this.game._renderFrame(performance.now(), false);
      const blob = await new Promise((resolve, reject) => this.game.canvas.toBlob(
        result => result ? resolve(result) : reject(new Error('La imagen no está disponible.')), 'image/png'));
      const url = URL.createObjectURL(blob);
      const link = el('a', { href: url, download: `Bazuko-Bogota-${new Date().toISOString().replace(/[:.]/g, '-')}.png` });
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      this._say('Foto lista. Está en las descargas del navegador.');
      return true;
    } catch (error) {
      this._say('No se pudo guardar la foto. Vuelva a intentarlo.');
      return false;
    } finally {
      this.busy = false;
      this.captureButton.disabled = false;
    }
  }
}
