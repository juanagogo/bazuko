// src/ui/MirrorCinematic.js
// Mini cinemática cómica al robar un retrovisor: barras negras, cámara cerca
// que gira alrededor del carro y un rótulo de «video de vecino» con REC.
// El aspecto vive en src/ui/css/hud.css.

export const MIRROR_CINEMATIC = {
  duration: 2.6,
  cooldown: 20,        // no repetir en cada robo seguido
  distance: 3.2,
  pitch: 0.12,
  orbit: 1.1           // radianes que gira la cámara durante la toma
};

export const MIRROR_CAPTIONS = [
  '¡Ñeeerooo, el espejooo!',
  'Grabado por una vecina desde el balcón',
  'Y así, señores, desaparece un retrovisor',
  'El dueño todavía no se ha dado cuenta',
  'Nivel de habilidad: experto',
  'Bogotá, un martes cualquiera'
];

export class MirrorCinematic {
  constructor(game, { random = Math.random } = {}) {
    this.game = game;
    this.random = random;
    this.active = false;
    this.time = 0;
    this.cooldown = 0;
    this._saved = null;
    this._dom = null;
    this._buildUI();
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('steal', (e) => {
        if (e.detail?.mirror && !e.detail.caught) this.play(e.detail.car);
      });
    }
  }

  _buildUI() {
    if (typeof document === 'undefined' || !document.createElement) return;
    const root = document.createElement('div');
    root.id = 'mirror-cinematic';
    root.hidden = true;
    root.innerHTML = '<i class="mc-barra mc-arriba"></i><i class="mc-barra mc-abajo"></i>' +
      '<b class="mc-rec">REC</b><b class="mc-hora"></b><p class="mc-rotulo"></p>';
    document.body?.appendChild(root);
    this._dom = { root, clock: root.querySelector('.mc-hora'), caption: root.querySelector('.mc-rotulo') };
  }

  play(car = null) {
    if (this.active || this.cooldown > 0 || this.game.carjack?.driving) return false;
    const rig = this.game.cameraRig;
    this.active = true;
    this.time = 0;
    this.cooldown = MIRROR_CINEMATIC.cooldown;
    if (rig) {
      // Recién bajado del carro la cámara aún regresa: se restaura la distancia a pie, no una a medio camino.
      const walking = this.game.carjack?.takeCameraReturn?.();
      this._saved = { yaw: rig.yaw, pitch: rig.pitch, distance: walking ?? rig.distance };
      // Arranca mirando de costado hacia el carro, como quien graba desde el andén.
      if (car?.position && this.game.player?.position) {
        const dx = this.game.player.position.x - car.position.x, dz = this.game.player.position.z - car.position.z;
        rig.yaw = Math.atan2(dx, dz) + 0.6;
      }
      rig.distance = MIRROR_CINEMATIC.distance;
      rig.pitch = MIRROR_CINEMATIC.pitch;
    }
    this.game.player?.playAction?.('buscar', 0.8);
    if (this._dom) {
      const caption = MIRROR_CAPTIONS[Math.min(MIRROR_CAPTIONS.length - 1, Math.floor(this.random() * MIRROR_CAPTIONS.length))];
      this._dom.caption.textContent = caption;
      const hour = this.game.clock?.hour ?? 15;
      const h = Math.floor(hour) % 24, m = Math.floor((hour % 1) * 60);
      this._dom.clock.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      this._dom.root.hidden = false;
      requestAnimationFrameSafe(() => this._dom.root.classList.add('is-rodando'));
    }
    return true;
  }

  update(dt) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (!this.active) return;
    this.time += dt;
    const rig = this.game.cameraRig;
    if (rig && this.game.carjack?.driving) { this.stop(); return; }
    if (rig) {
      rig.yaw += (MIRROR_CINEMATIC.orbit / MIRROR_CINEMATIC.duration) * dt;
      // Pequeño temblor de cámara en mano.
      rig.pitch = MIRROR_CINEMATIC.pitch + Math.sin(this.time * 17) * 0.008;
    }
    if (this.time >= MIRROR_CINEMATIC.duration) this.stop();
  }

  stop() {
    const rig = this.game.cameraRig;
    if (rig && this._saved) {
      rig.pitch = this._saved.pitch;
      rig.distance = this._saved.distance;
    }
    this._saved = null;
    this.active = false;
    if (this._dom) {
      this._dom.root.classList.remove('is-rodando');
      this._dom.root.hidden = true;
    }
  }
}

function requestAnimationFrameSafe(fn) {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(fn); else fn();
}
