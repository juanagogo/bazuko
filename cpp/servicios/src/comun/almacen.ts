// Acceso a las tablas detras de una interfaz: las rutas la reciben y las pruebas les dan una en memoria.
import { BatchWriteCommand, DeleteCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { db, TABLAS } from './tablas';
import { dentroDelLimite } from './limites';

type Fila = Record<string, any>;

export interface Almacen {
  perfil(cuenta: string): Promise<Fila | undefined>;
  crearPerfil(fila: Fila): Promise<boolean>;   // false si ya existia (dos pedidos a la vez)
  guardarPerfil(fila: Fila): Promise<void>;
  perfilPorNombre(nombreMin: string): Promise<Fila | undefined>;
  estadisticas(cuenta: string): Promise<Fila | undefined>;
  presencia(cuenta: string): Promise<Fila | undefined>;
  amistad(cuenta: string, otra: string): Promise<Fila | undefined>;
  borrarCuenta(cuenta: string): Promise<void>;
  dentroDelLimite(cuenta: string, accion: string, maximo: number, ventanaSeg: number): Promise<boolean>;
  // Partidas: una fila por (sala, cuenta) con la marca desde la que aun no se le acredito nada
  enPartida(codigo: string, cuenta: string): Promise<Fila | undefined>;
  guardarEnPartida(fila: Fila): Promise<void>;
  moverMarca(codigo: string, cuenta: string, marcaAnterior: number, marcaNueva: number, contada: boolean): Promise<boolean>;   // false si otro informe la movio antes
  sumarEstadisticas(cuenta: string, nombre: string, suma: Record<string, number>, ahora: number): Promise<void>;
  // Clasificacion: filas de mayor a menor (las primeras `hasta`) y cuantos tienen mas que `valor`
  mejores(tabla: string, hasta: number): Promise<{ nombre: string; valor: number }[]>;
  cuantosSobre(tabla: string, valor: number): Promise<number>;
}

async function borrarEnLotes(tabla: string, claves: Fila[]) {
  for (let i = 0; i < claves.length; i += 25) {
    const lote = claves.slice(i, i + 25).map((Key) => ({ DeleteRequest: { Key } }));
    await db().send(new BatchWriteCommand({ RequestItems: { [tabla]: lote } }));
  }
}

async function todas(tabla: string, pk: string, valor: string): Promise<Fila[]> {
  const filas: Fila[] = [];
  let desde: Fila | undefined;
  do {
    const r = await db().send(new QueryCommand({ TableName: tabla, KeyConditionExpression: '#k = :v', ExpressionAttributeNames: { '#k': pk }, ExpressionAttributeValues: { ':v': valor }, ExclusiveStartKey: desde }));
    filas.push(...(r.Items ?? []));
    desde = r.LastEvaluatedKey;
  } while (desde);
  return filas;
}

export function almacenDynamo(): Almacen {
  return {
    async perfil(cuenta) { return (await db().send(new GetCommand({ TableName: TABLAS.perfiles, Key: { cuenta } }))).Item; },
    async crearPerfil(fila) {
      try {
        await db().send(new PutCommand({ TableName: TABLAS.perfiles, Item: fila, ConditionExpression: 'attribute_not_exists(cuenta)' }));
        return true;
      } catch (e: any) {
        if (e?.name === 'ConditionalCheckFailedException') return false;
        throw e;
      }
    },
    async guardarPerfil(fila) { await db().send(new PutCommand({ TableName: TABLAS.perfiles, Item: fila })); },
    async perfilPorNombre(nombreMin) {
      const r = await db().send(new QueryCommand({ TableName: TABLAS.perfiles, IndexName: 'porNombre', KeyConditionExpression: 'nombreMin = :n', ExpressionAttributeValues: { ':n': nombreMin }, Limit: 1 }));
      const clave = r.Items?.[0];
      return clave ? this.perfil(clave.cuenta) : undefined;   // el indice puede no traer todos los campos
    },
    async estadisticas(cuenta) { return (await db().send(new GetCommand({ TableName: TABLAS.estadisticas, Key: { cuenta } }))).Item; },
    async presencia(cuenta) { return (await db().send(new GetCommand({ TableName: TABLAS.presencia, Key: { cuenta } }))).Item; },
    async amistad(cuenta, otra) { return (await db().send(new GetCommand({ TableName: TABLAS.amistades, Key: { cuenta, otra } }))).Item; },
    async borrarCuenta(cuenta) {
      // amistades de los dos lados, mensajes pendientes, presencia, estadisticas y por ultimo el perfil (libera el nombre en el juego)
      const amistades = await todas(TABLAS.amistades, 'cuenta', cuenta);
      await borrarEnLotes(TABLAS.amistades, amistades.flatMap((f) => [{ cuenta, otra: f.otra }, { cuenta: f.otra, otra: cuenta }]));
      const pendientes = await todas(TABLAS.pendientes, 'cuenta', cuenta);
      await borrarEnLotes(TABLAS.pendientes, pendientes.map((f) => ({ cuenta, enviado: f.enviado })));
      await db().send(new DeleteCommand({ TableName: TABLAS.presencia, Key: { cuenta } }));
      await db().send(new DeleteCommand({ TableName: TABLAS.estadisticas, Key: { cuenta } }));
      await db().send(new DeleteCommand({ TableName: TABLAS.perfiles, Key: { cuenta } }));
    },
    dentroDelLimite(cuenta, accion, maximo, ventanaSeg) { return dentroDelLimite(cuenta, accion, maximo, ventanaSeg); },
    async enPartida(codigo, cuenta) { return (await db().send(new GetCommand({ TableName: TABLAS.partidas, Key: { partida: codigo, cuenta } }))).Item; },
    async guardarEnPartida(fila) { await db().send(new PutCommand({ TableName: TABLAS.partidas, Item: fila })); },
    async moverMarca(codigo, cuenta, marcaAnterior, marcaNueva, contada) {
      try {
        await db().send(new UpdateCommand({
          TableName: TABLAS.partidas, Key: { partida: codigo, cuenta },
          UpdateExpression: 'SET marca = :n, contada = :c', ConditionExpression: 'marca = :a',
          ExpressionAttributeValues: { ':n': marcaNueva, ':a': marcaAnterior, ':c': contada },
        }));
        return true;
      } catch (e: any) {
        if (e?.name === 'ConditionalCheckFailedException') return false;
        throw e;
      }
    },
    async sumarEstadisticas(cuenta, nombre, suma, ahora) {
      await db().send(new UpdateCommand({
        TableName: TABLAS.estadisticas, Key: { cuenta },
        UpdateExpression: 'SET nombre = :nombre, tabla = :t, actualizado = :ahora ADD partidas :partidas, dias :dias, plata :plata, peleas :peleas, muertes :muertes, tiempo :tiempo',
        ExpressionAttributeValues: {
          ':nombre': nombre, ':t': 'T', ':ahora': ahora,
          ':partidas': suma.partidas ?? 0, ':dias': suma.dias ?? 0, ':plata': suma.plata ?? 0, ':peleas': suma.peleas ?? 0, ':muertes': suma.muertes ?? 0, ':tiempo': suma.tiempo ?? 0,
        },
      }));
    },
    async mejores(tabla, hasta) {
      const filas: { nombre: string; valor: number }[] = [];
      let desde: Fila | undefined;
      do {
        const r = await db().send(new QueryCommand({
          TableName: TABLAS.estadisticas, IndexName: `por_${tabla}`, KeyConditionExpression: 'tabla = :t',
          ExpressionAttributeValues: { ':t': 'T' }, ScanIndexForward: false, Limit: Math.min(1000, hasta - filas.length), ExclusiveStartKey: desde,
        }));
        for (const f of r.Items ?? []) filas.push({ nombre: String(f.nombre ?? ''), valor: Number(f[tabla] ?? 0) });
        desde = r.LastEvaluatedKey;
      } while (desde && filas.length < hasta);
      return filas;
    },
    async cuantosSobre(tabla, valor) {
      let total = 0;
      let desde: Fila | undefined;
      do {
        const r = await db().send(new QueryCommand({
          TableName: TABLAS.estadisticas, IndexName: `por_${tabla}`, KeyConditionExpression: 'tabla = :t AND #v > :v',
          ExpressionAttributeNames: { '#v': tabla }, ExpressionAttributeValues: { ':t': 'T', ':v': valor }, Select: 'COUNT', ExclusiveStartKey: desde,
        }));
        total += r.Count ?? 0;
        desde = r.LastEvaluatedKey;
      } while (desde);
      return total;
    },
  };
}
