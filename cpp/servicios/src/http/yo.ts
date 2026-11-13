// GET /yo, PUT /yo y DELETE /yo: el perfil propio. La cuenta sale siempre del token (cuentaDe); no hay forma de nombrar otra.
// El perfil se crea la primera vez que se pide, con el nombre de la cuenta en Cognito (claim `username` del token de acceso).
import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { ok, error, cuentaDe } from '../comun/respuestas';
import { Almacen, almacenDynamo } from '../comun/almacen';
import { perfilPropio, revisarCambios } from '../reglas/perfil';

type Evento = Pick<APIGatewayProxyEventV2WithJWTAuthorizer, 'requestContext' | 'body' | 'isBase64Encoded'>;

function nombreDe(event: Evento): string | null {
  const claims = (event.requestContext as any)?.authorizer?.jwt?.claims;
  const nombre = claims?.username ?? claims?.['cognito:username'];
  return typeof nombre === 'string' && /^[A-Za-z0-9]{3,16}$/.test(nombre) ? nombre : null;
}

export function crearManejador(almacen: Almacen, ahora = () => Math.floor(Date.now() / 1000)) {
  return async (event: Evento): Promise<APIGatewayProxyStructuredResultV2> => {
    const cuenta = cuentaDe(event);
    if (!cuenta) return error('no_permitido');
    const metodo = (event.requestContext as any)?.http?.method;
    try {
      if (metodo === 'DELETE') {
        await almacen.borrarCuenta(cuenta);
        return { statusCode: 204, headers: { 'cache-control': 'no-store' } };
      }
      let perfil = await almacen.perfil(cuenta);
      if (!perfil) {
        const nombre = nombreDe(event);
        if (!nombre) return error('nombre_invalido');
        perfil = { cuenta, nombre, nombreMin: nombre.toLowerCase(), visibilidad: 'todos', creado: ahora() };
        if (!(await almacen.crearPerfil(perfil))) perfil = (await almacen.perfil(cuenta)) ?? perfil;
      }
      if (metodo === 'PUT') {
        if (!(await almacen.dentroDelLimite(cuenta, 'perfil', 30, 60))) return error('limite');
        let cuerpo: unknown;
        try {
          const texto = event.isBase64Encoded ? Buffer.from(event.body ?? '', 'base64').toString('utf8') : (event.body ?? '');
          if (texto.length > 4096) return error('pedido_invalido');
          cuerpo = JSON.parse(texto);
        } catch { return error('pedido_invalido'); }
        const cambios = revisarCambios(cuerpo);
        if (cambios === 'invalido') return error('pedido_invalido');
        perfil = { ...perfil, ...cambios };
        await almacen.guardarPerfil(perfil);
      } else if (metodo !== 'GET') return error('pedido_invalido');
      return ok(perfilPropio(perfil, await almacen.estadisticas(cuenta)));
    } catch {
      return error('interno');   // sin detalles: nunca se devuelve ni se registra el pedido
    }
  };
}

export const handler = crearManejador(almacenDynamo());
