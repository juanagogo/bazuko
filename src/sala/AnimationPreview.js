// Visor en el sitio: evalúa los mismos modelos del juego, sin avanzar la partida.
export class AnimationPreview {
  constructor(player) { this.player = player; this.name = null; this.time = 0; this._timingCharacter = null; this._timing = null; }

  play(name) {
    this.stop();
    this.name = name;
    this.time = 0;
    this.player.position.set(0, 0, 0);
    this.player.root.position.copy(this.player.position);
    this.player.root.rotation.set(0, -Math.PI / 4, 0);
  }

  stop() {
    this.name = null;
    this.player.stopSmoking();
    this.player.stopBasuco();
    this.player.melee.cancel();
    this.player.action = null;
    this.player.actionTimer = 0;
    this.player.velocity.set(0, 0, 0);
    this.player.speed = 0;
    this.player.resetGrounding();
    this.player.root.rotation.x = this.player.root.rotation.z = 0;
  }

  update(dt) {
    if (!(dt > 0) || !this.name) return;
    this.time += dt;
    const p = this.player, name = this.name;
    if (p.character !== this._timingCharacter) {
      this._timingCharacter = p.character;
      this._timing = p.character.animationStatus;
    }
    const sourceCadence = this._timing?.profile === 'mixamo-preview';
    const sourceDuration = sourceCadence ? this._timing.durations?.[name] : null;
    const speed = name === 'caminar' ? p.speedWalk : name === 'correr' ? p.speedRun : name === 'nadar' ? 1.7 : 0;
    const swimming = name === 'nadar' || name === 'flotar';
    // Un gesto capturado de ocho segundos conserva sus ocho segundos. La escala
    // temporal de la sala sigue siendo el único control de cámara lenta/rápida.
    const duration = sourceDuration > 0 ? sourceDuration : name === 'lanzar' ? 1.1 : 3;
    const cycle = this.time % (duration + .8);
    const sustained = sourceCadence ? this._timing.loops?.[name] === true : name === 'dormir';
    const action = ['reposo', 'caminar', 'correr', 'nadar', 'flotar'].includes(name) ? null
      : sustained ? name : cycle < duration ? name : null;
    p.character.update(dt, {
      speed: speed / p.modelScale, running: name === 'correr', action,
      actionProgress: Math.min(1, cycle / duration), t: this.time,
      movement: { grounded: !swimming, swimming, surfaceY: 1.05, verticalVelocity: 0, airTime: 0, landing: 0,
        ...(sourceCadence ? { previewCadence: 'source' } : {}) }
    });
  }
}
