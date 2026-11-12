// src/story/LosReyesStory.js
// Historia y misiones episódicas tributo a la telenovela colombiana «Los Reyes» (RCN).
// Adapta la trama costumbrista de Beto Reyes y su familia en Bogotá:
// desde la Plaza de Mercado y el rescate de Doña Mercedes Rubio en el Viaducto de la 26,
// pasando por el trasteo a Rosales, la junta en Torre Colpatria,
// el debut musical de Hilda en la Zona T, hasta el gran sancocho familiar en la piscina.

export const REYES_CHAPTERS = [
  {
    id: 'capitulo_1',
    numero: 1,
    titulo: 'El Salto del Viaducto',
    descripcion: 'Beto Reyes reparte frutas y verduras por Bogotá hasta que el destino se cruza en el viaducto de la 26.',
    pasos: [
      {
        id: 'mercado',
        texto: 'TOCA RECOGER EL PEDIDO EN LA PLAZA DE MERCADO',
        meta: 'Recoge el encargo de plátano y yuca en la Plaza de Mercado.',
        target: { name: 'Plaza de Mercado', x: 331, z: 171, radio: 16 },
        dialogoInicio: '¡A la fija! Toca ir a la Plaza de Mercado a recoger el pedido mañanero.',
        dialogoCompletado: '¡Listo el mercado! Doña Mercedes Rubio encargó la entrega urgente cerca al viaducto de la 26.',
        recompensaDinero: 50000,
        xp: 150
      },
      {
        id: 'viaducto',
        texto: '¡PILAS! AUXILIAR A DOÑA MERCEDES EN EL VIADUCTO DE LA 26',
        meta: 'Llega al Viaducto de la Calle 26 para auxiliar a Doña Mercedes Rubio.',
        target: { name: 'Viaducto Calle 26 / Metro L1', x: 75, z: 193, radio: 18 },
        dialogoInicio: '¡Dios mío! Algo pasa en el viaducto de la 26, se ve una multitud…',
        dialogoCompletado: '¡Beto salvó a Doña Mercedes Rubio! En gratitud, lo nombra Presidente del Grupo GER y le cede su mansión.',
        recompensaDinero: 500000,
        xp: 300,
        bulletinId: 'reyes-mercedes-salvada'
      }
    ]
  },
  {
    id: 'capitulo_2',
    numero: 2,
    titulo: 'Trasteo a Rosales (Zona G)',
    descripcion: 'La familia Reyes empaca las ollas, las gallinas y se muda a la exclusiva mansión en Rosales.',
    pasos: [
      {
        id: 'mansion_llegada',
        texto: 'LLEVAR EL TRASTEO A LA MANSIÓN EN ROSALES (ZONA G)',
        meta: 'Dirígete a la Mansión Reyes en Rosales (Calle 72 con Carrera 4).',
        target: { name: 'Mansión Reyes (Rosales / Zona G)', x: 295, z: 115, radio: 16 },
        dialogoInicio: '¡Empaquen todo en la chiva! Nos vamos pa Rosales a estrenar la mansión.',
        dialogoCompletado: 'Don Emilio Iriarte sale furioso: «¡Piltrafa! ¡Atorrante! ¿Qué hace esta chusma con una chiva en mi barrio?!»',
        recompensaDinero: 800000,
        xp: 350,
        bulletinId: 'reyes-escandalo-rosales'
      }
    ]
  },
  {
    id: 'capitulo_3',
    numero: 3,
    titulo: 'Junta Directiva en Torre Colpatria',
    descripcion: 'Beto asume su cargo de presidente en el rascacielos y pone orden con sabiduría popular.',
    pasos: [
      {
        id: 'colpatria_ger',
        texto: 'PRESIDIR LA JUNTA DE GER EN TORRE COLPATRIA (CLL 26)',
        meta: 'Llega a la sede corporativa del Grupo GER en la Torre Colpatria.',
        target: { name: 'Sede Grupo GER (Torre Colpatria)', x: 235, z: 156, radio: 16 },
        dialogoInicio: 'Hoy es mi primera junta como Presidente de GER. A ponerse la mejor camisa de domingo.',
        dialogoCompletado: 'Beto rechaza el contrato tramposo de Iriarte y reparte empanadas y fritanga en la junta.',
        recompensaDinero: 2000000,
        xp: 500,
        bulletinId: 'reyes-presidencia-ger'
      }
    ]
  },
  {
    id: 'capitulo_4',
    numero: 4,
    titulo: 'El Debut de Hilda en la Zona T',
    descripcion: 'Hilda Reyes estrena su éxito de tecnocarrilera en las terrazas más exclusivas de la Zona T.',
    pasos: [
      {
        id: 'concierto_hilda',
        texto: 'LLEVAR A HILDA AL SHOW EN LA ZONA T (CALLE 82)',
        meta: 'Acompaña a Hilda a la tarima de la Zona Rosa / Zona T.',
        target: { name: 'Tarima Zona T (Calle 82)', x: 22, z: 75, radio: 16 },
        dialogoInicio: '¡Hildita va a cantar en vivo! Todo Rosales y Chapinero van a escuchar a la Gata Montesa.',
        dialogoCompletado: '¡Éxito rotundo! El público corea «Yo soy la gata montesa» y Laisa causa sensación en las terrazas.',
        recompensaDinero: 1500000,
        xp: 450,
        bulletinId: 'reyes-hilda-gata'
      }
    ]
  },
  {
    id: 'capitulo_5',
    numero: 5,
    titulo: 'El Gran Sancocho de la Victoria',
    descripcion: 'La familia Reyes celebra su consagración con un sancocho monumental en la piscina de la mansión.',
    pasos: [
      {
        id: 'sancocho_mansion',
        texto: 'CELEBRAR EL SANCOCHO EN LA MANSIÓN DE ROSALES',
        meta: 'Regresa a la Mansión de Rosales para el gran banquete familiar con piscina.',
        target: { name: 'Mansión Reyes (Rosales / Zona G)', x: 295, z: 115, radio: 16 },
        dialogoInicio: '¡Prendan la leña al lado de la piscina! Sancocho de gallina para celebrar la victoria de la familia.',
        dialogoCompletado: '¡Triunfo total de Los Reyes! Hasta Don Emilio Iriarte terminó bailando con Laisa. ¡Bogotá a sus pies!',
        recompensaDinero: 5000000,
        xp: 1000,
        bulletinId: 'reyes-laisa-sensacion'
      }
    ]
  }
];

export class LosReyesStory {
  constructor(game = null) {
    this.game = game;
    this.chapterIndex = 0;
    this.stepIndex = 0;
    this.completed = false;
    this.history = [];
    this._arrivalCooldown = 0;
  }

  get currentChapter() {
    if (this.completed || this.chapterIndex >= REYES_CHAPTERS.length) return null;
    return REYES_CHAPTERS[this.chapterIndex];
  }

  get currentStep() {
    const chapter = this.currentChapter;
    if (!chapter || this.stepIndex >= chapter.pasos.length) return null;
    return chapter.pasos[this.stepIndex];
  }

  /** Texto para el badge de misión en el HUD */
  currentMissionText() {
    if (this.completed) {
      return '¡TRIUNFO TOTAL! LA FAMILIA REYES CONQUISTÓ BOGOTÁ';
    }
    const step = this.currentStep;
    return step ? step.texto : null;
  }

  /** Coordenadas del objetivo actual para navegación y GPS */
  getCurrentWaypoint() {
    const step = this.currentStep;
    if (!step?.target) return null;
    return {
      name: step.target.name,
      x: step.target.x,
      z: step.target.z
    };
  }

  /**
   * Actualización periódica en el bucle principal.
   * Detecta llegada al objetivo y avanza la trama.
   */
  update(dt, playerPosition) {
    if (this._arrivalCooldown > 0) {
      this._arrivalCooldown = Math.max(0, this._arrivalCooldown - dt);
    }
    if (this.completed || !playerPosition) return;

    const step = this.currentStep;
    if (!step?.target) return;

    const dist = Math.hypot(playerPosition.x - step.target.x, playerPosition.z - step.target.z);
    if (dist <= (step.target.radio ?? 15) && this._arrivalCooldown === 0) {
      this.advanceStep();
    }
  }

  /** Avanza al siguiente paso o capítulo */
  advanceStep() {
    const chapter = this.currentChapter;
    const step = this.currentStep;
    if (!chapter || !step) return;

    this._arrivalCooldown = 2.5; // Evita doble disparo inmediato

    // 1. Recompensas
    if (step.recompensaDinero && this.game?.stats) {
      this.game.stats.dinero = (this.game.stats.dinero ?? 0) + step.recompensaDinero;
    }
    if (step.xp && this.game?.stats && this.game?.talents) {
      this.game.stats.addXP(step.xp, this.game.talents);
    }

    // 2. Notificaciones y audio
    if (this.game?.audio) {
      this.game.audio.play('treasure');
    }

    const toastMessage = `👑 [${chapter.titulo}] ${step.dialogoCompletado}`;
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('toast', {
        detail: { text: toastMessage, type: 'rare' }
      }));
    }

    // 3. Boletín de radio si aplica
    if (step.bulletinId && this.game?.radio) {
      this.game.radio.forceBulletin?.(step.bulletinId);
    }

    this.history.push({
      chapterId: chapter.id,
      stepId: step.id,
      completedAt: Date.now()
    });

    // 4. Progreso de paso / capítulo
    if (this.stepIndex + 1 < chapter.pasos.length) {
      this.stepIndex++;
    } else {
      if (this.chapterIndex + 1 < REYES_CHAPTERS.length) {
        this.chapterIndex++;
        this.stepIndex = 0;
        const nextChapter = this.currentChapter;
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('toast', {
            detail: { text: `📜 Capítulo ${nextChapter.numero}: ${nextChapter.titulo}`, type: 'info' }
          }));
        }
      } else {
        this.completed = true;
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('toast', {
            detail: { text: '🏆 ¡LOS REYES DE BOGOTÁ! Has completado la historia de Beto Reyes.', type: 'rare' }
          }));
        }
      }
    }

    // Actualiza destino GPS automáticamente al nuevo objetivo si está disponible
    const nextWp = this.getCurrentWaypoint();
    if (nextWp && this.game?.setGpsWaypoint) {
      this.game.setGpsWaypoint(nextWp, { silent: true });
    }
  }

  reset() {
    this.chapterIndex = 0;
    this.stepIndex = 0;
    this.completed = false;
    this.history = [];
    this._arrivalCooldown = 0;
  }

  serialize() {
    return {
      chapterIndex: this.chapterIndex,
      stepIndex: this.stepIndex,
      completed: this.completed,
      history: this.history
    };
  }

  deserialize(data) {
    if (!data || typeof data !== 'object') return;
    if (typeof data.chapterIndex === 'number') this.chapterIndex = Math.min(data.chapterIndex, REYES_CHAPTERS.length);
    if (typeof data.stepIndex === 'number') this.stepIndex = data.stepIndex;
    if (typeof data.completed === 'boolean') this.completed = data.completed;
    if (Array.isArray(data.history)) this.history = data.history;
  }
}
