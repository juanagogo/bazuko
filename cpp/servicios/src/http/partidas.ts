// POST /partidas/{codigo}/presente y POST /partidas/{codigo}/resultado (FR-017, FR-018).
// Cada cuenta dice ella misma que esta en la sala (con su token); el anfitrion manda lo que vio de cada uno, y solo se acredita
// a cuentas presentes y dentro de lo que cabe en el tiempo real que llevan desde su ultima marca. Un informe nunca acredita dos veces lo mismo.
import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { ok, error, cuentaDe } from '../comun/respuestas';
import { Almacen, almacenDynamo } from '../comun/almacen';
import { acreditable, codigoValido, MIN_PARA_CONTAR_SEG, REINICIO_SEG, revisarResultados } from '../reglas/partidas';

type Evento = Pick<APIGatewayProxyEventV2WithJWTAuthorizer, 'requestContext' | 'pathParameters' | 'body' | 'isBase64Encoded'>;

const VIDA_FILA_SEG = 7 * 24 * 3600;

function leerCuerpo(event: Evento): unknown {
  if (!event.body || event.body.length > 8192) return undefined;
  try {
    return JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body);
  } catch {
    return undefined;
  }
}

export function crearManejador(almacen: Almacen, reloj: () => number = () => Math.floor(Date.now() / 1000)) {
  return async (event: Evento): Promise<APIGatewayProxyStructuredResultV2> => {
    const cuenta = cuentaDe(event);
    if (!cuenta) return error('no_permitido');
    const codigo = event.pathParameters?.codigo;
    if (!codigoValido(codigo)) return error('pedido_invalido');
    const accion = event.pathParameters?.accion;
    const ahora = reloj();
    try {
      if (accion === 'presente') {
        if (!(await almacen.dentroDelLimite(cuenta, 'presente', 20, 3600))) return error('limite');
        const cuerpo = leerCuerpo(event) as Record<string, unknown> | undefined;
        const anfitrion = cuerpo?.anfitrion === true;
        const antes = await almacen.enPartida(codigo, cuenta);
        // entrar (o volver) reinicia el reloj de esa cuenta; volver tras media hora cuenta como otra partida
        const otraPartida = !antes || ahora - Number(antes.marca ?? 0) > REINICIO_SEG;
        await almacen.guardarEnPartida({
          partida: codigo, cuenta, marca: ahora, anfitrion: anfitrion || antes?.anfitrion === true,
          contada: otraPartida ? false : antes?.contada === true, vence: ahora + VIDA_FILA_SEG,
        });
        return ok({ presente: true });
      }

      if (accion === 'resultado') {
        if (!(await almacen.dentroDelLimite(cuenta, 'resultado', 4, 60))) return error('limite');
        const yo = await almacen.enPartida(codigo, cuenta);
        if (!yo || yo.anfitrion !== true) return error('no_permitido');   // solo quien dijo ser anfitrion y esta presente
        const jugadores = revisarResultados(leerCuerpo(event));
        if (!jugadores) return error('pedido_invalido');
        let acreditados = 0;
        for (const j of jugadores) {
          const perfil = await almacen.perfilPorNombre(j.nombre.toLowerCase());
          if (!perfil || perfil.borrado) continue;
          const otra = String(perfil.cuenta);
          const fila = await almacen.enPartida(codigo, otra);
          if (!fila) continue;                                             // no dijo que estaba en esta sala
          const marca = Number(fila.marca ?? 0);
          const segundos = ahora - marca;
          if (segundos <= 0) continue;
          const suma = acreditable(j, segundos);
          if (!suma) continue;                                             // valores imposibles: no cuenta nada de ese jugador
          const cuenta1 = fila.contada !== true && segundos >= MIN_PARA_CONTAR_SEG;
          if (!(await almacen.moverMarca(codigo, otra, marca, ahora, fila.contada === true || cuenta1))) continue;   // otro informe se adelanto
          await almacen.sumarEstadisticas(otra, String(perfil.nombre ?? j.nombre), { ...suma, partidas: cuenta1 ? 1 : 0 }, ahora);
          acreditados++;
        }
        return ok({ acreditados });
      }
      return error('no_encontrado');
    } catch {
      return error('interno');
    }
  };
}

export const handler = crearManejador(almacenDynamo());
