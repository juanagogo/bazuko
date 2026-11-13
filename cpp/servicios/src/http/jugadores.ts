// GET /jugadores/{nombre}: el perfil publico de otro jugador, buscado por nombre exacto (sin sugerencias).
// Lo que sale lo arma perfilPublico desde la lista blanca; quien lo bloqueo a uno no aparece (404, igual que si no existiera).
import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { ok, error, cuentaDe } from '../comun/respuestas';
import { Almacen, almacenDynamo } from '../comun/almacen';
import { perfilPublico } from '../comun/publico';

type Evento = Pick<APIGatewayProxyEventV2WithJWTAuthorizer, 'requestContext' | 'pathParameters'>;

export function crearManejador(almacen: Almacen) {
  return async (event: Evento): Promise<APIGatewayProxyStructuredResultV2> => {
    const cuenta = cuentaDe(event);
    if (!cuenta) return error('no_permitido');
    const nombre = event.pathParameters?.nombre ?? '';
    if (!/^[A-Za-z0-9]{3,16}$/.test(nombre)) return error('nombre_invalido');
    try {
      if (!(await almacen.dentroDelLimite(cuenta, 'buscar', 60, 60))) return error('limite');
      const otro = await almacen.perfilPorNombre(nombre.toLowerCase());
      if (!otro || otro.borrado) return error('no_encontrado');
      const otraCuenta = String(otro.cuenta);
      const esUnoMismo = otraCuenta === cuenta;
      if (!esUnoMismo) {
        const suLado = await almacen.amistad(otraCuenta, cuenta);
        if (suLado?.estado === 'bloqueado') return error('no_encontrado');
      }
      const miLado = esUnoMismo ? undefined : await almacen.amistad(cuenta, otraCuenta);
      const esAmigo = miLado?.estado === 'amigos';
      return ok(perfilPublico(otro, await almacen.estadisticas(otraCuenta), await almacen.presencia(otraCuenta), { esAmigo, esUnoMismo }));
    } catch {
      return error('interno');
    }
  };
}

export const handler = crearManejador(almacenDynamo());
