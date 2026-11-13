// Nombres de las tablas (los pone la pila en variables de entorno) y el cliente de DynamoDB compartido.
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

export const TABLAS = {
  perfiles: process.env.TABLA_PERFILES ?? 'Perfiles',
  estadisticas: process.env.TABLA_ESTADISTICAS ?? 'Estadisticas',
  amistades: process.env.TABLA_AMISTADES ?? 'Amistades',
  conexiones: process.env.TABLA_CONEXIONES ?? 'Conexiones',
  presencia: process.env.TABLA_PRESENCIA ?? 'Presencia',
  mensajes: process.env.TABLA_MENSAJES ?? 'Mensajes',
  pendientes: process.env.TABLA_PENDIENTES ?? 'Pendientes',
  partidas: process.env.TABLA_PARTIDAS ?? 'Partidas',
  limites: process.env.TABLA_LIMITES ?? 'Limites',
};

let cliente: DynamoDBDocumentClient | undefined;
export function db(): DynamoDBDocumentClient {
  cliente ??= DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
  return cliente;
}
