// src/systems/DailyMissionSystem.js
// Sistema de misiones diarias y recompensas: 3 objetivos renovables cada 24 horas (al iniciar nuevo día).
import { cop } from '../utils/money.js';

export const MISSION_TEMPLATES = [
  {
    type: 'reciclar',
    title: 'Jornada de reciclaje',
    desc: 'Recoja 4 bolsas o canecas de basura por la ciudad.',
    target: 4,
    icon: 'recycle',
    reward: { dinero: 3000, xp: 30, animo: 10 }
  },
  {
    type: 'vender',
    title: 'El rebusque en El Progreso',
    desc: 'Venda material reciclable y gane al menos $2.000.',
    target: 2000,
    icon: 'coins',
    reward: { dinero: 2000, xp: 25, animo: 15 }
  },
  {
    type: 'comedor',
    title: 'Almuerzo solidario',
    desc: 'Visite el Comedor Comunitario y reciba la ración diaria.',
    target: 1,
    icon: 'food',
    reward: { dinero: 1500, xp: 30, animo: 20 }
  },
  {
    type: 'perro',
    title: 'Compañero fiel',
    desc: 'Atienda a El Chato (dele comida o acarícielo).',
    target: 1,
    icon: 'dog',
    reward: { dinero: 1000, xp: 25, animo: 20 }
  },
  {
    type: 'ropa',
    title: 'Cambio de pinta',
    desc: 'Cámbiese de ropa para protegerse del clima frío.',
    target: 1,
    icon: 'shirt',
    reward: { dinero: 1500, xp: 20, animo: 15 }
  },
  {
    type: 'fogata',
    title: 'Al calor de la candela',
    desc: 'Caliéntese las manos en una fogata de El Cartucho.',
    target: 1,
    icon: 'flame',
    reward: { dinero: 1200, xp: 20, animo: 15 }
  },
  {
    type: 'limosna',
    title: 'La moneda de la suerte',
    desc: 'Pida limosna con éxito 2 veces.',
    target: 2,
    icon: 'hand',
    reward: { dinero: 2000, xp: 25, animo: 15 }
  },
  {
    type: 'crafteo',
    title: 'Artesano de la calle',
    desc: 'Fabrique un objeto útil en la mesa de trabajo.',
    target: 1,
    icon: 'hammer',
    reward: { dinero: 2500, xp: 35, animo: 10 }
  },
  {
    type: 'noche',
    title: 'Pasar la noche',
    desc: 'Sobreviva la noche o descanse en el cambuche.',
    target: 1,
    icon: 'tent',
    reward: { dinero: 2500, xp: 30, animo: 20 }
  }
];

export class DailyMissionSystem {
  constructor(game = null) {
    this.game = game;
    this.currentDay = 1;
    this.missions = [];
    this._listeners = [];

    this._setupListeners();
  }

  _setupListeners() {
    if (typeof window === 'undefined') return;

    const onPickup = () => this.reportProgress('reciclar', 1);
    const onSell = (e) => this.reportProgress('vender', e.detail?.earned ?? 1000);
    const onComedor = () => this.reportProgress('comedor', 1);
    const onDog = () => this.reportProgress('perro', 1);
    const onLook = () => this.reportProgress('ropa', 1);
    const onFire = () => this.reportProgress('fogata', 1);
    const onBeg = (e) => { if (e.detail?.success) this.reportProgress('limosna', 1); };
    const onCraft = () => this.reportProgress('crafteo', 1);
    const onSleep = () => this.reportProgress('noche', 1);

    window.addEventListener('pickup', onPickup);
    window.addEventListener('sell', onSell);
    window.addEventListener('comedor-served', onComedor);
    window.addEventListener('dog-interacted', onDog);
    window.addEventListener('look-changed', onLook);
    window.addEventListener('fire-warmed', onFire);
    window.addEventListener('beg-result', onBeg);
    window.addEventListener('craft', onCraft);
    window.addEventListener('sleep-end', onSleep);

    this._listeners = [
      ['pickup', onPickup],
      ['sell', onSell],
      ['comedor-served', onComedor],
      ['dog-interacted', onDog],
      ['look-changed', onLook],
      ['fire-warmed', onFire],
      ['beg-result', onBeg],
      ['craft', onCraft],
      ['sleep-end', onSleep],
    ];
  }

  dispose() {
    if (typeof window === 'undefined') return;
    for (const [event, fn] of this._listeners) {
      window.removeEventListener(event, fn);
    }
    this._listeners = [];
  }

  /** Inicializa o genera las misiones del día */
  init(day = 1) {
    this.currentDay = day;
    if (!this.missions || this.missions.length === 0) {
      this.missions = this.generateMissions(day);
    }
  }

  /** Genera 3 misiones diarias con rotación según el número de día */
  generateMissions(day) {
    const total = MISSION_TEMPLATES.length;
    const selected = [];
    const usedTypes = new Set();

    // Selección pseudo-aleatoria pero determinista para cada día
    let seed = (day * 7 + 13) % total;
    for (let step = 0; step < total && selected.length < 3; step++) {
      const idx = (seed + step * 3) % total;
      const t = MISSION_TEMPLATES[idx];
      if (!usedTypes.has(t.type)) {
        usedTypes.add(t.type);
        selected.push({
          id: `${t.type}_d${day}`,
          type: t.type,
          title: t.title,
          desc: t.desc,
          target: t.target,
          progress: 0,
          completed: false,
          claimed: false,
          icon: t.icon,
          reward: { ...t.reward }
        });
      }
    }
    return selected;
  }

  /** Notifica avance en misiones del tipo especificado */
  reportProgress(type, amount = 1) {
    if (!this.missions || this.missions.length === 0) return;
    let changed = false;

    for (const m of this.missions) {
      if (m.type === type && !m.completed) {
        m.progress = Math.min(m.target, m.progress + amount);
        changed = true;
        if (m.progress >= m.target) {
          m.completed = true;
          this._onMissionCompleted(m);
        }
      }
    }

    if (changed && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('missions-updated', { detail: { missions: this.missions } }));
    }
  }

  _onMissionCompleted(mission) {
    mission.claimed = true;
    const stats = this.game?.stats;
    const reward = mission.reward;

    if (stats) {
      if (reward.dinero) stats.dinero = (stats.dinero ?? 0) + reward.dinero;
      if (reward.xp) stats.addXP?.(reward.xp, this.game.talents);
      if (reward.animo) stats.animo = Math.min(100, (stats.animo ?? 0) + reward.animo);
    }

    this.game?.audio?.play?.('treasure');

    if (typeof window !== 'undefined') {
      const rewardText = reward.dinero ? ` +${cop(reward.dinero)}` : '';
      window.dispatchEvent(new CustomEvent('toast', {
        detail: {
          text: `¡Misión cumplida: ${mission.title}! Recompensa:${rewardText}`,
          type: 'rare'
        }
      }));
      window.dispatchEvent(new CustomEvent('mission-completed', { detail: { mission } }));
    }
  }

  /** Reclamar recompensa si no fue reclamada */
  claimReward(missionId) {
    const m = this.missions.find(x => x.id === missionId);
    if (!m || !m.completed || m.claimed) return false;
    this._onMissionCompleted(m);
    return true;
  }

  /** Comprueba cambio de día cada 24 horas de juego */
  update(dt, clock) {
    if (!clock) return;
    const day = clock.day ?? 1;
    if (day !== this.currentDay) {
      this.currentDay = day;
      this.missions = this.generateMissions(day);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('daily-missions-reset', { detail: { day, missions: this.missions } }));
        window.dispatchEvent(new CustomEvent('toast', {
          detail: { text: `Nuevas misiones diarias del Día ${day}`, type: 'info' }
        }));
        window.dispatchEvent(new CustomEvent('missions-updated', { detail: { missions: this.missions } }));
      }
    }
  }

  /** Texto corto para la barra de misión del HUD */
  get activeMissionText() {
    if (!this.missions || this.missions.length === 0) return null;
    const pending = this.missions.find(m => !m.completed);
    if (pending) {
      const prog = pending.target > 1 ? ` (${pending.progress}/${pending.target})` : '';
      return `MISIÓN: ${pending.title.toUpperCase()}${prog} por ${cop(pending.reward.dinero)}`;
    }
    return 'MISIONES DEL DÍA COMPLETADAS';
  }

  serialize() {
    return {
      currentDay: this.currentDay,
      missions: this.missions.map(m => ({ ...m }))
    };
  }

  deserialize(data) {
    if (!data) return;
    if (Number.isInteger(data.currentDay)) this.currentDay = data.currentDay;
    if (Array.isArray(data.missions) && data.missions.length > 0) {
      this.missions = data.missions.map(m => ({ ...m }));
    } else {
      this.missions = this.generateMissions(this.currentDay);
    }
  }
}
