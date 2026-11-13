// Respuestas HTTP con codigos de error estables. Nunca se incluye el pedido, el token ni la pila de un error.
import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

export type CodigoError = 'nombre_invalido' | 'no_encontrado' | 'limite' | 'no_permitido' | 'datos_imposibles' | 'tope_amigos' | 'pedido_invalido' | 'interno';

const ESTADO: Record<CodigoError, number> = {
  nombre_invalido: 400, pedido_invalido: 400, datos_imposibles: 422, no_permitido: 403, no_encontrado: 404, limite: 429, tope_amigos: 409, interno: 500,
};

export function ok(cuerpo: unknown, estado = 200): APIGatewayProxyStructuredResultV2 {
  return { statusCode: estado, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }, body: JSON.stringify(cuerpo) };
}

export function error(codigo: CodigoError): APIGatewayProxyStructuredResultV2 {
  return { statusCode: ESTADO[codigo], headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }, body: JSON.stringify({ error: codigo }) };
}

// La cuenta sale siempre del token ya validado por el autorizador JWT, nunca del cuerpo ni de la ruta (FR-013)
export function cuentaDe(event: { requestContext?: any }): string | null {
  const sub = event.requestContext?.authorizer?.jwt?.claims?.sub;
  return typeof sub === 'string' && sub.length > 0 ? sub : null;
}
