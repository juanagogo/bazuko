// Limite de acciones por cuenta en una ventana de tiempo (chat, solicitudes, resultados), con un contador que vence solo.
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { db, TABLAS } from './tablas';

export async function dentroDelLimite(cuenta: string, accion: string, maximo: number, ventanaSeg: number, ahora = Date.now()): Promise<boolean> {
  const ventana = Math.floor(ahora / 1000 / ventanaSeg);
  const salida = await db().send(new UpdateCommand({
    TableName: TABLAS.limites,
    Key: { clave: `${cuenta}#${accion}#${ventana}` },
    UpdateExpression: 'ADD cuenta_veces :uno SET vence = if_not_exists(vence, :vence)',
    ExpressionAttributeValues: { ':uno': 1, ':vence': (ventana + 1) * ventanaSeg + 60 },
    ReturnValues: 'UPDATED_NEW',
  }));
  return Number(salida.Attributes?.cuenta_veces ?? 0) <= maximo;
}
