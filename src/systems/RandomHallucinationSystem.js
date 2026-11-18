// src/systems/RandomHallucinationSystem.js
// Sistema de alucinaciones aleatorias: delirios visuales, auditivos y sensoriales
// que ocurren espontáneamente mientras se recorren las calles de Bogotá.
import * as THREE from 'three';

const FRASES_ALUCINACION = [
  'Alguien viene caminando detrás de mí...',
  'Sentí que una sombra me rozó el hombro.',
  'Ese poste de luz me está vigilando.',
  'Oigo murmullos entre los árboles...',
  'Me pareció ver una cara en la ventana vacía.',
  'Pasos apurados doblando la esquina...',
  'Una figura me miró desde el callejón y desapareció.'
];

const _forward = new THREE.Vector3();
const _toTarget = new THREE.Vector3();

export class RandomHallucinationSystem {
  constructor(scene, player = null, stats = null, audio = null, world = null) {
    this.scene = scene;
    this.player = player;
    this.stats = stats;
    this.audio = audio;
    this.world = world;

    // Temporizador para la siguiente alucinación aleatoria (entre 45 y 85 segundos)
    this.timer = 30 + Math.random() * 40;
    this.active = false;
    this.current = null; // { type, duration, mesh, ... }
    this.lastType = null;
  }

  /**
   * Dispara una alucinación aleatoria o de tipo específico.
   * Tipos: 'sombra' | 'voces' | 'espejismo' | 'sirena' | 'vertigo'
   */
  trigger(type = null) {
    const types = ['sombra', 'voces', 'espejismo', 'sirena', 'vertigo'];
    const chosen = type ?? types.filter((t) => t !== this.lastType)[Math.floor(Math.random() * (types.length - 1))];
    this.lastType = chosen;

    switch (chosen) {
      case 'sombra':
        this._startSombra();
        break;
      case 'voces':
        this._startVoces();
        break;
      case 'espejismo':
        this._startEspejismo();
        break;
      case 'sirena':
        this._startSirena();
        break;
      case 'vertigo':
        this._startVertigo();
        break;
    }
  }

  _startSombra() {
    if (!this.scene || !this.player?.position) return;
    const playerPos = this.player.position;

    // Aparece en el rabillo del ojo (a 11-15 metros, en ángulo lateral)
    const angle = Math.random() * Math.PI * 2;
    const dist = 11 + Math.random() * 5;
    const x = playerPos.x + Math.cos(angle) * dist;
    const z = playerPos.z + Math.sin(angle) * dist;
    const y = this.world?.active?.getGroundHeight?.(x, z) ?? playerPos.y;

    const group = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: 0x08080c, transparent: true, opacity: 0.85 });
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });

    // Cabeza y ojos
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 6, 6), mat);
    head.position.y = 1.55;
    const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.025, 4, 4), eyeMat);
    eyeL.position.set(-0.06, 1.57, 0.16);
    const eyeR = new THREE.Mesh(new THREE.SphereGeometry(0.025, 4, 4), eyeMat);
    eyeR.position.set(0.06, 1.57, 0.16);
    group.add(head, eyeL, eyeR);

    // Torso encorvado
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.22, 0.8, 6), mat);
    torso.position.y = 1.05;
    group.add(torso);

    // Manto vaporoso
    const robe = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.8, 6), mat);
    robe.position.y = 0.4;
    robe.rotation.x = Math.PI;
    group.add(robe);

    group.position.set(x, y, z);
    this.scene.add(group);

    this.current = {
      type: 'sombra',
      group,
      duration: 5.0,
      dissolving: false,
      stared: 0
    };
    this.active = true;
  }

  _startVoces() {
    this.audio?.playPsychosisWhisper?.();
    const frase = FRASES_ALUCINACION[Math.floor(Math.random() * FRASES_ALUCINACION.length)];
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('toast', { detail: { text: frase, type: 'warn' } }));
    }
    if (this.player) {
      this.player.paranoia = 0.5;
    }
    this.current = {
      type: 'voces',
      duration: 3.5
    };
    this.active = true;
  }

  _startEspejismo() {
    if (!this.scene || !this.player?.position) return;
    const playerPos = this.player.position;
    const rot = this.player.root?.rotation?.y ?? 0;

    // Aparece en la dirección hacia donde mira el jugador, unos 9 a 13 metros adelante
    const forwardX = Math.sin(rot);
    const forwardZ = Math.cos(rot);
    const dist = 9 + Math.random() * 4;
    const x = playerPos.x + forwardX * dist + (Math.random() - 0.5) * 2;
    const z = playerPos.z + forwardZ * dist + (Math.random() - 0.5) * 2;
    const y = (this.world?.active?.getGroundHeight?.(x, z) ?? playerPos.y) + 0.05;

    const group = new THREE.Group();
    // Billete / fajo de billetes brillante
    const billMat = new THREE.MeshBasicMaterial({ color: 0x22c55e });
    const bill = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.02, 0.16), billMat);
    group.add(bill);

    // Aura dorada pulsante
    const glowMat = new THREE.MeshBasicMaterial({ color: 0xfacc15, transparent: true, opacity: 0.6 });
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.22, 6, 6), glowMat);
    group.add(glow);

    group.position.set(x, y, z);
    this.scene.add(group);

    this.current = {
      type: 'espejismo',
      group,
      duration: 12.0
    };
    this.active = true;
  }

  _startSirena() {
    this.audio?.playHeartbeat?.(0.8);
    this.audio?.playPsychosisWhisper?.();
    if (this.player) {
      this.player.paranoia = 0.7;
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('toast', {
        detail: { text: 'Sentí pasos y una sirena lejana... pero la calle está sola.', type: 'warn' }
      }));
    }
    this.current = {
      type: 'sirena',
      duration: 3.0
    };
    this.active = true;
  }

  _startVertigo() {
    this.current = {
      type: 'vertigo',
      duration: 2.8,
      elapsed: 0
    };
    this.active = true;
  }

  update(dt, player = this.player, cameraRig = null, clock = null, stats = this.stats) {
    this.player = player ?? this.player;
    this.stats = stats ?? this.stats;

    // Actualizar alucinación activa
    if (this.current) {
      const c = this.current;
      c.duration -= dt;

      if (c.type === 'sombra' && c.group && player?.position) {
        c.group.lookAt(player.position.x, c.group.position.y + 1.2, player.position.z);
        const dist = c.group.position.distanceTo(player.position);

        // Si el jugador la mira directamente a la cara o se acerca a menos de 4 metros, se esfuma
        if (cameraRig?.camera) {
          cameraRig.camera.getWorldDirection(_forward);
          _toTarget.copy(c.group.position).sub(cameraRig.camera.position).normalize();
          if (_toTarget.dot(_forward) > 0.98) c.stared = (c.stared || 0) + dt;
        }

        if (dist < 4.0 || c.stared > 0.6 || c.duration <= 0) {
          c.dissolving = true;
        }

        if (c.dissolving) {
          c.group.position.y += dt * 0.5;
          let faded = true;
          c.group.traverse((o) => {
            if (o.material && o.material.opacity !== undefined) {
              o.material.opacity = Math.max(0, o.material.opacity - dt * 3.5);
              if (o.material.opacity > 0.05) faded = false;
            }
          });
          if (faded) {
            this._cleanupCurrent();
          }
        }
      } else if (c.type === 'espejismo' && c.group && player?.position) {
        const dist = c.group.position.distanceTo(player.position);
        if (dist < 2.4 || c.duration <= 0) {
          // Desaparece con un desengaño
          if (dist < 2.4 && typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('toast', {
              detail: { text: 'Era solo una ilusión... no hay nada ahí.', type: 'info' }
            }));
          }
          this._cleanupCurrent();
        }
      } else if (c.type === 'vertigo' && cameraRig?.camera) {
        c.elapsed = (c.elapsed || 0) + dt;
        // Oscilación suave < 0.5 Hz: pulso sinusoidal
        const wave = Math.sin((c.elapsed / 2.8) * Math.PI);
        cameraRig.camera.fov = (cameraRig.baseFov ?? 55) + wave * 4.0;
        cameraRig.camera.updateProjectionMatrix();

        if (c.duration <= 0) {
          cameraRig.camera.fov = cameraRig.baseFov ?? 55;
          cameraRig.camera.updateProjectionMatrix();
          this._cleanupCurrent();
        }
      } else if (c.duration <= 0) {
        this._cleanupCurrent();
      }
      return;
    }

    // Temporizador para la próxima alucinación espontánea
    this.timer -= dt;
    if (this.timer <= 0) {
      // Ajuste de probabilidad según la situación del personaje
      const isNight = !!clock?.isNight;
      const lowAnimo = (this.stats?.animo ?? 100) < 40;
      const cold = !!this.stats?.isFreezing;
      const hungry = (this.stats?.hambre ?? 100) < 25;

      // Más frecuente de noche o en malas condiciones de supervivencia
      let factor = 1.0;
      if (isNight) factor *= 1.4;
      if (lowAnimo) factor *= 1.3;
      if (cold || hungry) factor *= 1.2;

      this.trigger();
      this.timer = (40 + Math.random() * 45) / factor;
    }
  }

  _cleanupCurrent() {
    if (this.current?.group) {
      this.scene?.remove(this.current.group);
      this.current.group.traverse((o) => {
        o.geometry?.dispose?.();
        o.material?.dispose?.();
      });
    }
    if (this.player && this.player.paranoia > 0 && !this.stats?.inWithdrawal) {
      this.player.paranoia = 0;
    }
    this.current = null;
    this.active = false;
  }

  dispose() {
    this._cleanupCurrent();
  }
}
