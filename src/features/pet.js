// src/features/pet.js
import * as THREE from 'three';
import { Dog, DOG_STORAGE_KEY } from '../entities/Dog.js';

export const CONFIG = {
  followDist: 1.8,
  teleportDist: 22.0,
  lerpSpeed: 4.5,
  barkCooldown: 6.0,
  storageKey: DOG_STORAGE_KEY,
  defaultName: 'El Chato',
  defaultColor: '#965a28',
  defaultAccessory: 'bufanda',
  defaultSize: 1.0
};

export const COAT_PRESETS = Object.freeze([
  { label: 'Criollo Dorado', color: '#965a28' },
  { label: 'Negro Azabache', color: '#2b2623' },
  { label: 'Miel Callejero', color: '#c98a4b' },
  { label: 'Chocolate', color: '#5c3317' },
  { label: 'Gris Cenizo', color: '#70757a' }
]);

export class Pet {
  /**
   * Construye el gestor de personalización y comportamiento canino.
   * Si se vincula a una instancia de `Dog` (El Chato) mediante `attachDog(dog)`,
   * actúa directamente sobre ese perro único en la escena sin duplicar mallas 3D.
   */
  constructor(scene, player = null, dog = null) {
    this.scene = scene;
    this.player = player;
    this.dog = null;
    this.state = 'idle';
    this.time = 0;
    this.barkTimer = 0;
    this.position = (player?.position?.clone() ?? new THREE.Vector3(12, 0, 12)).add(new THREE.Vector3(1, 0, 1));
    this.group = new THREE.Group();
    this.group.position.copy(this.position);

    this._loadConfig();

    if (dog) {
      this.attachDog(dog);
    } else {
      // Modo autónomo (usado en pruebas aisladas de Pet sin instancia previa de Dog)
      this._standaloneDog = new Dog(null, this.position);
      this.group = this._standaloneDog.group;
      this._buildMesh();
      if (scene) scene.add(this.group);
    }

    this._buildCustomizationModal();
  }

  /**
   * Vincula este controlador al perro principal del mundo (`Dog` / El Chato)
   * y elimina cualquier malla autónoma duplicada de la escena.
   */
  attachDog(dog) {
    if (!dog) return;
    if (this._standaloneDog) {
      if (this.scene && this._standaloneDog.group) {
        this.scene.remove(this._standaloneDog.group);
      }
      this._standaloneDog.destroy();
      this._standaloneDog = null;
    }
    this.dog = dog;
    this.group = dog.group;
    this.position = dog.position;
    dog.applyCustomization({
      nombre: this.nombre,
      color: this.color,
      accesorio: this.accesorio,
      tamano: this.tamano
    });
  }

  _loadConfig() {
    let saved = null;
    try {
      const data = typeof localStorage !== 'undefined' ? localStorage.getItem(CONFIG.storageKey) : null;
      if (data) saved = JSON.parse(data);
    } catch { /* sin almacenamiento */ }
    this.nombre = saved?.nombre ?? CONFIG.defaultName;
    this.color = saved?.color ?? CONFIG.defaultColor;
    this.accesorio = saved?.accesorio ?? CONFIG.defaultAccessory;
    this.tamano = Number(saved?.tamano ?? CONFIG.defaultSize);
  }

  _saveConfig() {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(CONFIG.storageKey, JSON.stringify({
          nombre: this.nombre,
          color: this.color,
          accesorio: this.accesorio,
          tamano: this.tamano
        }));
      }
    } catch { /* sin almacenamiento */ }
  }

  _buildMesh() {
    const targetDog = this.dog ?? this._standaloneDog;
    if (targetDog) {
      targetDog.applyCustomization({
        nombre: this.nombre,
        color: this.color,
        accesorio: this.accesorio,
        tamano: this.tamano
      });
      this.body = targetDog.body;
      this.head = targetDog.head;
    }
  }

  update(dt, playerPos, npcs = []) {
    // Si está vinculado al Dog principal del juego, delega la alerta de NPCs sin duplicar movimiento
    if (this.dog) {
      this.time += dt;
      if (this.barkTimer > 0) this.barkTimer -= dt;
      if (this.dog.isFriend) {
        this._checkThreats(npcs);
      }
      this.state = this.dog.state;
      return;
    }

    if (!playerPos) return;
    this.time += dt;
    if (this.barkTimer > 0) this.barkTimer -= dt;
    const dist = this.position.distanceTo(playerPos);

    if (dist > CONFIG.teleportDist) {
      this.position.copy(playerPos).add(new THREE.Vector3(1, 0, 1));
      this.group.position.copy(this.position);
      this.state = 'idle';
      this._standaloneDog?._resetLegs?.();
      return;
    }

    if (dist > CONFIG.followDist) {
      this.state = 'follow';
      const target = playerPos.clone().addScaledVector(
        this.position.clone().sub(playerPos).normalize(),
        CONFIG.followDist
      );
      this.position.lerp(target, Math.min(1, CONFIG.lerpSpeed * dt));
      this.group.position.copy(this.position);
      this.group.lookAt(playerPos.x, this.group.position.y, playerPos.z);
      this._standaloneDog?._animateLegs?.(this.time * 14, 0.4);
    } else {
      this.state = 'idle';
      this._standaloneDog?._resetLegs?.();
    }

    if (this._standaloneDog?.tail) {
      this._standaloneDog.tail.rotation.z = Math.sin(this.time * 12) * 0.4;
    }

    this._checkThreats(npcs);
  }

  _checkThreats(npcs) {
    if (this.barkTimer > 0) return;
    const refPos = this.dog ? this.dog.position : this.position;
    for (const n of npcs) {
      if (n?.position && n.alerta > 0.6 && refPos.distanceTo(n.position) < 3.5) {
        this.state = 'alerta';
        if (this.dog) this.dog.state = 'alerta';
        this.barkTimer = CONFIG.barkCooldown;
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('toast', {
            detail: { text: `🐕 ¡${this.nombre} ladra alertando a un sospechoso!`, type: 'info' }
          }));
        }
        break;
      }
    }
  }

  getDistractionBonus() {
    if (this.dog && !this.dog.isFriend) return 0;
    return 0.10;
  }

  applyCustomization({ nombre, color, accesorio, tamano }) {
    if (nombre !== undefined) this.nombre = nombre.trim() || CONFIG.defaultName;
    if (color !== undefined) this.color = color;
    if (accesorio !== undefined) this.accesorio = accesorio;
    if (tamano !== undefined) this.tamano = Math.max(0.6, Math.min(1.6, Number(tamano)));
    this._saveConfig();
    this._buildMesh();
  }

  _buildCustomizationModal() {
    if (typeof document === 'undefined' || !document.body) return;
    let modal = document.getElementById('pet-customization-modal');
    if (modal) return;
    modal = document.createElement('div');
    modal.id = 'pet-customization-modal';
    modal.style.cssText = 'display:none;position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:340px;background:rgba(20,20,24,0.96);border:2px solid #e67e22;border-radius:10px;padding:18px;z-index:110;color:#eee;font-family:inherit;box-shadow:0 12px 32px rgba(0,0,0,0.85);';

    const presetButtonsHtml = COAT_PRESETS.map((p) =>
      `<button type="button" class="pet-preset-btn" data-color="${p.color}" title="${p.label}" style="width:28px;height:28px;border-radius:50%;background:${p.color};border:2px solid #555;cursor:pointer;"></button>`
    ).join('');

    modal.innerHTML = `
      <h3 style="margin:0 0 12px;color:#f39c12;text-align:center;font-size:16px;">🐕 Personalizar a tu Compañero</h3>
      <label style="display:block;font-size:12px;margin-bottom:4px;color:#ccc;">Nombre:</label>
      <input id="pet-name-input" type="text" maxlength="24" style="width:100%;margin-bottom:10px;padding:6px 8px;background:#111;color:#fff;border:1px solid #444;border-radius:4px;box-sizing:border-box;" />
      <label style="display:block;font-size:12px;margin-bottom:6px;color:#ccc;">Pelaje (tonos criollos o libre):</label>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
        <div id="pet-presets" style="display:flex;gap:6px;">${presetButtonsHtml}</div>
        <input id="pet-color-input" type="color" style="flex:1;height:30px;background:#111;border:1px solid #444;border-radius:4px;cursor:pointer;" />
      </div>
      <label style="display:block;font-size:12px;margin-bottom:4px;color:#ccc;">Accesorio:</label>
      <select id="pet-acc-select" style="width:100%;margin-bottom:10px;padding:6px 8px;background:#111;color:#fff;border:1px solid #444;border-radius:4px;">
        <option value="bufanda">Pañuelo rojo bogotano</option>
        <option value="collar">Collar azul con placa</option>
        <option value="gorra">Gorra bogotana</option>
        <option value="ninguno">Ninguno</option>
      </select>
      <label style="display:block;font-size:12px;margin-bottom:4px;color:#ccc;">Complexión / Tamaño: <span id="pet-size-val">1.0</span>x</label>
      <input id="pet-size-input" type="range" min="0.7" max="1.4" step="0.05" style="width:100%;margin-bottom:16px;" />
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
        <span style="font-size:11px;color:#999;">Esc o G para cerrar</span>
        <button id="pet-modal-close" type="button" style="padding:7px 16px;background:#e67e22;color:#fff;border:none;border-radius:5px;cursor:pointer;font-weight:bold;">Guardar</button>
      </div>
    `;
    document.body.appendChild(modal);

    const nameIn = modal.querySelector('#pet-name-input');
    const colorIn = modal.querySelector('#pet-color-input');
    const accSel = modal.querySelector('#pet-acc-select');
    const sizeIn = modal.querySelector('#pet-size-input');
    const sizeVal = modal.querySelector('#pet-size-val');
    const closeBtn = modal.querySelector('#pet-modal-close');

    const updateLive = () => {
      sizeVal.textContent = Number(sizeIn.value).toFixed(2);
      this.applyCustomization({
        nombre: nameIn.value,
        color: colorIn.value,
        accesorio: accSel.value,
        tamano: parseFloat(sizeIn.value)
      });
    };

    modal.querySelectorAll('.pet-preset-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        colorIn.value = btn.dataset.color;
        updateLive();
      });
    });

    nameIn.addEventListener('input', updateLive);
    colorIn.addEventListener('input', updateLive);
    accSel.addEventListener('change', updateLive);
    sizeIn.addEventListener('input', updateLive);

    closeBtn.addEventListener('click', () => this.closeCustomizationMenu());

    this._onKeyDown = (e) => {
      if (e.code === 'Escape' && modal.style.display === 'block') {
        e._panelHandled = true;
        this.closeCustomizationMenu();
      }
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this._onKeyDown);
    }
  }

  closeCustomizationMenu() {
    if (typeof document === 'undefined') return;
    const modal = document.getElementById('pet-customization-modal');
    if (modal) modal.style.display = 'none';
    if (typeof window !== 'undefined' && window.__game) {
      window.__game._petModalOpen = false;
    }
  }

  toggleCustomizationMenu() {
    if (typeof document === 'undefined') return;
    const modal = document.getElementById('pet-customization-modal');
    if (!modal) return;
    const isOpen = modal.style.display === 'block';
    if (isOpen) {
      this.closeCustomizationMenu();
    } else {
      window.__game?.cameraRig?.releaseControls?.();
      modal.querySelector('#pet-name-input').value = this.nombre;
      modal.querySelector('#pet-color-input').value = this.color;
      modal.querySelector('#pet-acc-select').value = this.accesorio;
      modal.querySelector('#pet-size-input').value = this.tamano;
      modal.querySelector('#pet-size-val').textContent = Number(this.tamano).toFixed(2);
      modal.style.display = 'block';
      if (typeof window !== 'undefined' && window.__game) {
        window.__game._petModalOpen = true;
      }
    }
  }

  dispose() {
    if (typeof window !== 'undefined' && this._onKeyDown) {
      window.removeEventListener('keydown', this._onKeyDown);
    }
    if (this._standaloneDog) {
      if (this.scene && this._standaloneDog.group) {
        this.scene.remove(this._standaloneDog.group);
      }
      this._standaloneDog.destroy();
      this._standaloneDog = null;
    }
  }
}
