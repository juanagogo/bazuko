// GET /clasificacion/{tabla}?desde=N&cuantos=10|50|100 (FR-016): filas {puesto, nombre, valor}, el cursor de la pagina siguiente y el puesto propio.
// Solo salen nombre y valor: nunca la cuenta ni el resto de la fila. El cursor es un numero (cuantas filas saltar), no una clave de la tabla.
import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { ok, error, cuentaDe } from '../comun/respuestas';
import { Almacen, almacenDynamo } from '../comun/almacen';
import { TABLAS_CLASIFICACION } from '../reglas/partidas';

type Evento = Pick<APIGatewayProxyEventV2WithJWTAuthorizer, 'requestContext' | 'pathParameters' | 'queryStringParameters'>;

export const MAX_DESDE = 5000;   // la tabla global se recorre por paginas hasta aqui

export function crearManejador(almacen: Almacen) {
  return async (event: Evento): Promise<APIGatewayProxyStructuredResultV2> => {
    const cuenta = cuentaDe(event);
    if (!cuenta) return error('no_permitido');
    const tabla = event.pathParameters?.tabla ?? '';
    if (!(TABLAS_CLASIFICACION as readonly string[]).includes(tabla)) return error('pedido_invalido');
    const cuantos = Number(event.queryStringParameters?.cuantos ?? 10);
    if (![10, 50, 100].includes(cuantos)) return error('pedido_invalido');
    const textoDesde = event.queryStringParameters?.desde ?? '0';
    if (!/^\d{1,5}$/.test(textoDesde)) return error('pedido_invalido');
    const desde = Number(textoDesde);
    if (desde > MAX_DESDE) return error('pedido_invalido');
    try {
      if (!(await almacen.dentroDelLimite(cuenta, 'clasificacion', 60, 60))) return error('limite');
      const filas = await almacen.mejores(tabla, desde + cuantos + 1);
      const pagina = filas.slice(desde, desde + cuantos).map((f, i) => ({ puesto: desde + i + 1, nombre: f.nombre, valor: Math.floor(f.valor) }));
      const haySiguiente = filas.length > desde + cuantos && desde + cuantos <= MAX_DESDE;
      const mias = await almacen.estadisticas(cuenta);
      const miValor = mias ? Math.floor(Number(mias[tabla] ?? 0)) : null;
      const yo = miValor === null || mias?.tabla !== 'T' ? null : { puesto: (await almacen.cuantosSobre(tabla, miValor)) + 1, valor: miValor };
      return ok({ filas: pagina, siguiente: haySiguiente ? desde + cuantos : null, yo });
    } catch {
      return error('interno');
    }
  };
}

export const handler = crearManejador(almacenDynamo());
