// src/utils/constants.js

// Mundo
export const TILE_SIZE = 2;
export const DISTRICT_SIZE = 40; // columnas (eje X) en tiles; patrón 8k+8 (antes 32)
// Avenida TransMilenio (recta, a lo largo de X): [carril normal][TM][zona verde][TM][carril normal]
// Carriles en tiles de 2 u: normal 2 (4 u) | TM 2 (4 u) | zona verde 4 (8 u) | TM 2 | normal 2 => 12 tiles = 24 u
export const AVENUE_N_TILES = 2;
export const AVENUE_TM_TILES = 2;
export const AVENUE_G_TILES = 4;
export const AVENUE_WIDTH = 2 * (AVENUE_N_TILES + AVENUE_TM_TILES) + AVENUE_G_TILES; // 12 tiles = 24 u
// Dos avenidas TM perpendiculares: una a lo largo de X (reemplaza una calle horizontal) y otra a lo largo
// de Z (reemplaza una calle vertical); cada una suma (AVENUE_WIDTH - 2) tiles sobre el patrón cuadrado.
export const WORLD_COLS = DISTRICT_SIZE + (AVENUE_WIDTH - 2); // 50
export const WORLD_ROWS = DISTRICT_SIZE + (AVENUE_WIDTH - 2); // 50
// Tamaño del mundo en unidades (el tile 0 y el último son el muro perimetral)
export const WORLD_W = WORLD_COLS * TILE_SIZE;
export const WORLD_D = WORLD_ROWS * TILE_SIZE;
// Borde interior de los muros (límite jugable)
export const WORLD_MIN_X = TILE_SIZE - TILE_SIZE / 2;                    // 1
export const WORLD_MAX_X = (WORLD_COLS - 1) * TILE_SIZE - TILE_SIZE / 2; // 97
export const WORLD_MIN_Z = TILE_SIZE - TILE_SIZE / 2;                    // 1
export const WORLD_MAX_Z = (WORLD_ROWS - 1) * TILE_SIZE - TILE_SIZE / 2; // 97 (WORLD_ROWS = 50)

// Jugador
export const PLAYER_RADIUS = 0.4;
export const PLAYER_SPEED_WALK = 3;
export const PLAYER_SPEED_RUN = 6;

// Interacción
export const INTERACT_RANGE = 1.8;

// Boost
export const BOOST_DURATION = 8;       // segundos
export const BOOST_ENERGY_COST = 10;   // energía inicial
export const BOOST_HEALTH_DRAIN = 3;   // salud por segundo
export const BOOST_MIN_HEALTH = 5;     // no activar/cancelar si salud <= esto

// Inventario
export const INVENTORY_MAX_WEIGHT = 20;
export const INVENTORY_SLOTS = 20;      // casillas de la cuadrícula
export const HOTBAR_SLOTS = 5;           // acceso rápido (teclas 1-5)

// Pickup
export const PICKUP_COOLDOWN = 20;     // segundos hasta que revive la basura

// === Selección de basura ===
export const SORT_BASE_TIME = 1.5;     // segundos para seleccionar (mejor calidad)
export const SORT_QUALITY_MULT = 1.5;  // mult de valor al seleccionar bien

// === Enfermedades ===
export const DISEASE_BASE_CHANCE = 0.12;   // probabilidad base al recoger basura
export const DISEASE_SORT_MULT = 1.8;      // +probabilidad al seleccionar (más contacto)
export const DISEASE_HEALTH_DRAIN = 1.2;   // salud/seg por enfermedad activa
export const DISEASE_MENTAL_DRAIN = 0.8;   // salud mental/seg por enfermedad
export const DISEASE_DURATION = 45;        // segundos que dura una enfermedad

// === Salud mental ===
export const MENTAL_DECAY = 0.15;          // por segundo
export const MENTAL_DECAY_NIGHT = 0.35;    // por segundo de noche
export const MENTAL_DECAY_SICK = 0.25;     // extra por enfermedad
export const MENTAL_DECAY_HUNGER = 0.2;    // extra si hambre < 20
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
export const STEAL_CAUGHT_MONEY = 10;      // dinero perdido al ser atrapado
export const CAR_COOLDOWN = 40;            // segundos hasta que revive el auto

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


// ===== Decay de necesidades (unidades por segundo) =====
export const DECAY = {
  hambre:  0.35,
  sed:     0.50,
  energia: 0.20,
  higiene: 0.10,   // ~10 min reales para vaciarse
  animo:   0.08    // ~20 min reales para vaciarse
};

// ===== Umbrales de efectos =====
export const STAT_THRESHOLDS = {
  higieneEnfermedad: 30,    // higiene < 30 → +50% prob. de enfermedad
  higieneRechazo:    20,    // higiene < 20 → NPCs rechazan (futuro)
  animoVelocidad:    30,    // ánimo < 30 → velocidad -20%
  animoVision:       50,    // ánimo < 50 → desaturación
  animoCritico:      10     // ánimo < 10 → alucinaciones (futuro)
};

// ===== Recuperación de stats =====
export const RECOVERY = {
  higienePorJabon:  40,     // jabón sube 40 de higiene
  animoPorDormir:   20,     // dormir bien sube 20 de ánimo
  animoPorCafe:     15,
  animoPorComida:   5
};

// ===== Silueta "rayos X" (src/core/XRay.js) =====
export const XRAY_ENABLED = true;          // interruptor global del efecto
export const XRAY_COLOR = 0x00e5ff;        // silueta del jugador (cian)
export const XRAY_COLOR_INTERACT = 0xffd23f; // silueta de interactuables ocultos (amarillo)
export const XRAY_RANGE = 18;              // alcance maximo de siluetas de interactuables
export const XRAY_MAX_INTERACT = 10;       // maximo de interactuables con silueta a la vez
