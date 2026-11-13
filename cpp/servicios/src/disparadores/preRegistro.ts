// Disparador "Pre sign-up" de Cognito: el servidor vuelve a revisar el nombre aunque alguien llame a Cognito sin el juego (FR-003).
// Cognito no le pasa la contrasena al disparador; la regla de largo minimo la impone la politica del grupo de usuarios.
import type { PreSignUpTriggerEvent } from 'aws-lambda';
import { revisarNombre } from '../reglas/nombres';

const MENSAJES: Record<string, string> = {
  corto: 'nombre_corto',
  largo: 'nombre_largo',
  caracteres: 'nombre_caracteres',
  prohibido: 'nombre_prohibido',
};

export const handler = async (event: PreSignUpTriggerEvent): Promise<PreSignUpTriggerEvent> => {
  const falla = revisarNombre(event.userName);
  if (falla) throw new Error(MENSAJES[falla]);   // Cognito devuelve UserLambdaValidationException con este texto; nunca se registra el pedido completo
  event.response.autoConfirmUser = true;        // sin correo no hay nada que confirmar; el correo se verifica aparte (FR-008a)
  event.response.autoVerifyEmail = false;
  event.response.autoVerifyPhone = false;
  return event;
};
