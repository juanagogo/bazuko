// src/utils/constants.js

// Mundo
export const TILE_SIZE = 2;
export const DISTRICT_SIZE = 32; // 20x20 tiles
export const DAY_LENGTH_SECONDS = 60 * 60; // un día de juego = una hora real

// Jugador
export const PLAYER_RADIUS = 0.4;
export const PLAYER_SPEED_WALK = 3;
export const PLAYER_SPEED_RUN = 6;
export const CHARACTER_SCALE = 1.15; // modelo de rebusque (1,6 m) a la escala del mundo

// Interacción
export const INTERACT_RANGE = 1.8;

// Boost
export const BOOST_DURATION = 8;       // segundos
export const BOOST_ENERGY_COST = 10;   // energía inicial
export const BOOST_HEALTH_DRAIN = 3;   // salud por segundo
export const BOOST_MIN_HEALTH = 5;     // no activar/cancelar si salud <= esto

// Inventario
export const INVENTORY_MAX_WEIGHT = 20;

// Pickup
export const PICKUP_COOLDOWN = 20;     // segundos hasta que revive la basura

// === Selección de basura ===
export const SORT_BASE_TIME = 1.5;     // segundos para seleccionar (mejor calidad)
export const SORT_QUALITY_MULT = 1.5;  // mult de valor al seleccionar bien

// === Enfermedades ===
export const DISEASE_BASE_CHANCE = 0.12;   // probabilidad base al recoger basura
export const DISEASE_SORT_MULT = 1.8;      // +probabilidad al seleccionar (más contacto)
export const DISEASE_HEALTH_DRAIN = 0.12;  // salud/seg: una enfermedad deja margen para tratarse
export const DISEASE_MENTAL_DRAIN = 0.02;  // salud mental/seg por enfermedad
export const DISEASE_DURATION = 45;        // segundos que dura una enfermedad

// === Salud mental ===
export const MENTAL_DECAY_NIGHT = 100 / (6 * DAY_LENGTH_SECONDS);
export const MENTAL_RESTORE_SLEEP = 40;    // al dormir
export const MENTAL_RESTORE_SELL = 2;      // por venta
export const MENTAL_RESTORE_RARE = 8;      // al encontrar tesoro
export const MENTAL_LOW_THRESHOLD = 25;    // debajo de esto: debuffs
export const MENTAL_CRITICAL_THRESHOLD = 10; // debajo de esto: alucinaciones

// === Nivel / XP ===
export const XP_PER_LEVEL = 100;
export const XP_PICKUP = 3;
export const XP_SELL = 2;
export const XP_STEAL = 8;
export const XP_CRAFT = 10;
export const XP_BEG = 4;

// === Robo de retrovisores ===
export const STEAL_CAUGHT_CHANCE = 0.25;   // probabilidad de ser atrapado
export const STEAL_CAUGHT_PENALTY = 25;    // salud perdida al ser atrapado
export const STEAL_CAUGHT_MONEY = 5000;    // pesos perdidos al ser atrapado
export const CAR_COOLDOWN = 40;            // segundos hasta que revive el auto
export const POLICE_SIGHT_RANGE = 28;      // metros a los que una patrulla puede verte robar
export const POLICE_CLOSE_RANGE = 12;      // a esta distancia te ven aunque no miren de frente
export const POLICE_CHASE_SPEED = 7.5;     // más rápido que el sprint del jugador (6)
export const POLICE_CATCH_RANGE = 3;       // distancia para darte alcance
export const POLICE_GIVE_UP_RANGE = 55;    // si te alejas tanto, vuelven a patrullar
export const POLICE_CHASE_TIMEOUT = 40;    // segundos máximos de persecución

// === Venta de sustancias ===
export const SUBSTANCE_PRICE_MULT = 1.8;   // las sustancias se venden más caras de noche
export const SUBSTANCE_RISK_CHANCE = 0.15; // probabilidad de problema con la ley
// Removed duplicate SORT_BASE_TIME declaration to fix redeclaration error
// Colores del juego (estética Noir)
export const COLORS = {
  BG: 0x1a1a1d,
  FOG: 0x1a1a1d,
  ACCENT_AMBER: 0xc9a227,
  ACCENT_CYAN: 0x2ab7ca,
  ACCENT_GOLD: 0xffd166,
  ACCENT_RED: 0xc0392b,
  ACCENT_GREEN: 0x27ae60,
  ACCENT_PURPLE: 0x8e44ad,
  TRASH: 0x3a3a2a,
  BUILDING: 0x3a3a40,
  FLOOR: 0x2b2b30,
  CAR: 0x2c3e50,
  DEALER: 0x6c3483
};


// ===== Ritmo tranquilo: tiempos desde una barra llena, sin enfermedades ni talentos =====
// Agua: 90 min; comida: 120 min; energía: 90 min; higiene: 6 h reales.
// El ánimo y el vicio acompañan la exploración sin exigir atención cada pocos minutos.
export const DECAY = {
  hambre:  100 / (2 * DAY_LENGTH_SECONDS),
  sed:     100 / (1.5 * DAY_LENGTH_SECONDS),
  energia: 100 / (1.5 * DAY_LENGTH_SECONDS),
  higiene: 100 / (6 * DAY_LENGTH_SECONDS),
  animo:   100 / (3 * DAY_LENGTH_SECONDS),
  vicio:   60 / (2 * DAY_LENGTH_SECONDS) // 2 h desde el valor inicial 80 hasta abstinencia (20)
};

// Con una necesidad agotada y salud llena todavía hay 20–30 min para atenderla.
// Cansancio, suciedad, ánimo y abstinencia causan penalizaciones, no daño mortal pasivo.
export const SURVIVAL_DAMAGE = {
  hambre: 100 / (30 * 60),
  sed:    100 / (20 * 60)
};

// ===== Umbrales de efectos =====
export const STAT_THRESHOLDS = {
  higieneEnfermedad: 30,    // higiene < 30 → +50% prob. de enfermedad
  higieneRechazo:    20,    // higiene < 20 → NPCs rechazan (futuro)
  animoVelocidad:    30,    // ánimo < 30 → velocidad -20%
  animoVision:       50,    // ánimo < 50 → desaturación
  animoCritico:      10,    // ánimo < 10 → alucinaciones (futuro)
  vicioAbstinencia:  20,    // vicio < 20 → abstinencia: más lento y pierde salud
  abstinenciaAlta:   50,    // abstinencia >= 50% → alucinaciones visuales y paranoia
  abstinenciaCritica: 80    // abstinencia >= 80% → psicosis inducida severa
};

// ===== Abstinencia =====
export const WITHDRAWAL = {
  saludPorSeg:  0,          // la abstinencia afecta ánimo y velocidad, sin daño pasivo
  velocidad:    0.85,       // multiplicador de velocidad
  animoMult:    1.5,        // el ánimo baja más rápido
  vicioDormir:  10          // dormir no calma el vicio: baja esto
};

export const WITHDRAWAL_THRESHOLDS = {
  mild: 25,
  high: 50,
  critical: 80
};

// ===== Recuperación de stats =====
export const RECOVERY = {
  higienePorJabon:  40,     // jabón sube 40 de higiene
  animoPorDormir:   20,     // dormir bien sube 20 de ánimo
  animoPorCafe:     15,
  animoPorComida:   5
};
