import * as THREE from 'three';

export class SceneManager {
  constructor() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1a1d); // gris muy oscuro

    // Niebla Noir: oculta el final del mundo
    this.scene.fog = new THREE.Fog(0x1a1a1d, 30, 120);

    // Luz ambiental fría (brutalismo)
    this.ambient = new THREE.HemisphereLight(0x556070, 0x0a0a0a, 0.6);
    this.scene.add(this.ambient);

    // Sol / luna (direccional)
    this.sun = new THREE.DirectionalLight(0xffe4b5, 1.0);
    this.sun.position.set(50, 80, 30);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    // Frustum de sombra ajustado al area alrededor del jugador (la luz lo sigue en followShadow):
    // 1024 px sobre ~70 m en vez de 200 m => ~3x mas nitidez al mismo coste.
    this._sunOffset = new THREE.Vector3(50, 80, 30);
    this.sun.shadow.camera.near = 20;
    this.sun.shadow.camera.far = 200;
    this.sun.shadow.camera.left = -35;
    this.sun.shadow.camera.right = 35;
    this.sun.shadow.camera.top = 35;
    this.sun.shadow.camera.bottom = -35;
    this.sun.shadow.camera.updateProjectionMatrix();
    this.scene.add(this.sun);

    this.sun.target.position.set(0, 0, 0);
    this.scene.add(this.sun.target);

    // Paleta día/noche
    this.nightLevel = 0;
    this._todHour = NaN;   // cache de setTimeOfDay
    this._todLamp = 0;
    this._skyDay = new THREE.Color(0x9fc3dc);
    this._skyNight = new THREE.Color(0x0b0b10);
    this._skyDusk = new THREE.Color(0xc2693a);
    this._sunDay = new THREE.Color(0xfff2d6);
    this._sunNight = new THREE.Color(0x6a7fb0);
    this._ambDay = new THREE.Color(0xbcd4ea);
    this._ambNight = new THREE.Color(0x556070);
  }

  /**
   * Nivel de oscuridad 0..1 según la hora (0–24). Fuente única para toda la iluminación.
   * Día pleno 7:30–18:00 → 0 | atardecer 18:00–21:00 | noche 21:00–05:00 → 1 | amanecer 05:00–07:30
   */
  static nightLevel(hour) {
    const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    const h = ((hour % 24) + 24) % 24;
    if (h < 12) return 1 - ss(5, 7.5, h);
    return ss(18, 21, h);
  }

  /** Nivel (0..1) para luces artificiales: se encienden cuando ya oscureció bastante */
  static lampLevel(night) {
    const t = Math.min(1, Math.max(0, (night - 0.3) / 0.5));
    return t * t * (3 - 2 * t);
  }

  /** Ajusta color/intensidad según hora del día (0–24). Devuelve nivel de luces artificiales. */
  setTimeOfDay(hour) {
    // El ciclo es lento (1 min de juego = 1 s): recalcular colores solo si la hora cambio de verdad
    if (Math.abs(hour - this._todHour) < 0.004) return this._todLamp;
    this._todHour = hour;
    const n = SceneManager.nightLevel(hour);
    const d = 1 - n;
    this.nightLevel = n;
    this.sun.intensity = 0.15 + d * 1.35;
    this.ambient.intensity = 0.15 + d * 0.95;
    this.sun.color.copy(this._sunNight).lerp(this._sunDay, d);
    this.ambient.color.copy(this._ambNight).lerp(this._ambDay, d);
    // Fondo/niebla: noche oscura → cielo claro de día (ligero tinte cálido en el crepúsculo)
    this.scene.background.copy(this._skyNight).lerp(this._skyDay, d);
    if (n > 0 && n < 1) this.scene.background.lerp(this._skyDusk, Math.sin(n * Math.PI) * 0.35);
    this.scene.fog.color.copy(this.scene.background);
    this._todLamp = SceneManager.lampLevel(n);
    return this._todLamp;
  }

  /** Mueve la luz direccional (y su sombra) para que cubra el area del jugador */
  followShadow(pos) {
    this.sun.target.position.copy(pos);
    this.sun.position.copy(pos).add(this._sunOffset);
    this.sun.target.updateMatrixWorld();
  }

    /** Ajusta el color de fondo/fog según ánimo */
  applyMentalState(desaturation) {
    // desaturation: 0 = normal, 1 = gris total
    if (desaturation <= 0) return;

    // Mezcla el color actual del fondo hacia gris
    const bg = this.scene.background;
    const fog = this.scene.fog?.color;
    if (!bg) return;

    const r = bg.r, g = bg.g, b = bg.b;
    const gray = (r + g + b) / 3;

    bg.setRGB(
      r * (1 - desaturation) + gray * desaturation,
      g * (1 - desaturation) + gray * desaturation,
      b * (1 - desaturation) + gray * desaturation
    );

    if (fog) fog.copy(bg);
  }
}