import { NPC_CONVERSATIONS } from '../../data/npcConversations.js';
import { REPARTO, vozPara } from '../../data/vocesCalle.js';
import { STREET_VOICES } from '../../data/vocesDePaso.js';
import { azarDeVoces } from './azar.js';

const azarSuelto = azarDeVoces();
const vocesDeCharla = NPC_CONVERSATIONS.filter(escena => !escena.contexto?.parejaFija)
  .flatMap(escena => Object.values(escena.hablantes));
const vocesFijas = { vecina_parque: 'mujer', vecino_parque: 'hombre', nero_esquina: 'hombre' };
const RESERVA_MS = 12000, VECINDAD = 14;

export const npcSexo = npc => npc?.look?.real?.sexo ?? npc?.person?.sexo ?? npc?.person?.real?.sexo ?? null;
export const puedeHablar = npc => !!npc?.position && !npc._disposed && !npc.isDead && !npc.koState;

// Los dos papeles de Virginia y los dos de Charlee comparten un intérprete.
export const timbreDe = voz => REPARTO[voz]?.voiceId ?? voz;

function azarDelPersonaje(id) {
  let hash = 2166136261;
  for (const c of String(id)) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
  return azarDeVoces(hash);
}

export function vozParaConductor(id, kind, random = azarSuelto) {
  if (kind === 'buseta') return 'busetero';
  const r = id ? azarDelPersonaje(id)() : random();
  if (r < .3) return 'conductora';
  if (r < .5) return 'valentina_original';
  if (r < .85) return 'conductor';
  return 'roberto_original';
}

export const sexoDeConductor = voz => voz === 'conductora' || voz === 'valentina_original' ? 'mujer' : 'hombre';

/** La misma persona de la campaña recibe su elenco aun si cambia el orden de carga o el reloj. */
export function vozDePersona(npc, random = azarSuelto) {
  if (!npc || npc.voiceRole === 'protagonista') return null;
  const sexo = npcSexo(npc);
  if (sexo !== 'mujer' && sexo !== 'hombre') return null;
  if (vocesFijas[npc.voiceRole] === sexo) return npc.voiceRole;
  const real = npc.look?.real ?? npc.person?.real;
  const arquetipo = npc.person?.arquetipo ?? (npc.isVendor ? 'vendedor' : null);
  if (npc.stableId) {
    random = azarDelPersonaje(npc.stableId);
    // Repartir también las voces originales de calle y diálogo. Los oficios conservan su pregón.
    const eleccion = random();
    if (!npc.isVendor && arquetipo !== 'vendedor' && eleccion < .36) {
      const opciones = eleccion < .12 ? STREET_VOICES.filter(clip => clip.sexo === sexo)
        : vocesDeCharla.filter(papel => papel.sexo === sexo && papel.edad === real?.edad);
      if (opciones.length) return opciones[Math.floor(random() * opciones.length)].voz;
    }
  }
  return vozPara({ arquetipo, sexo, edad: real?.edad }, random);
}

export class RepartoVocal {
  constructor(random = azarSuelto, now = () => performance.now()) {
    this.random = random;
    this.now = now;
    this._recientes = new Map();
  }

  vozDe(npc) {
    if (!npc || npc.voiceRole === 'protagonista' || npc._voz === 'protagonista') return null;
    return npc._voz ??= vozDePersona(npc, this.random);
  }

  /** Mientras los dos están cerca se reconoce el timbre como el de quien acaba de hablar. */
  disponible(npc, voz) {
    if (!voz) return false;
    const reserva = this._recientes.get(timbreDe(voz));
    if (!reserva || reserva.npc === npc || reserva.hasta <= this.now() || !puedeHablar(reserva.npc)) return true;
    const a = npc.position, b = reserva.npc.position;
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) > VECINDAD;
  }

  registrar(npc, voz) {
    if (voz) this._recientes.set(timbreDe(voz), { npc, hasta: this.now() + RESERVA_MS });
  }

  limpiar() { this._recientes.clear(); }
}
