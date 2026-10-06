import { createSocket } from '@repo/api-client';
import { WS_URL } from '@/lib/api';

/**
 * Socket de la PWA Staff (namespace /visitas).
 *
 * El handshake se autentica con el token EN MEMORIA (`auth.token`): la cookie es
 * HttpOnly y el gateway NO la lee para el staff — su resolucion de token es
 * auth.token -> ?token= -> Authorization -> cookie del CLIENTE. O sea que sin el
 * token en memoria el socket del staff no autentica. (Un token de cliente NUNCA
 * pasa por aca: el guard valida el claim `tipo`.)
 *
 * El servidor mete al socket en las salas que corresponden (su sucursal, o todas
 * si tiene accesoMultiSucursal, y la de duenos si el rol es DUENO): no hay que
 * unirse a mano.
 */
export function crearSocketStaff(token: string | null) {
  return createSocket({
    url: `${WS_URL}/visitas`,
    ...(token ? { auth: { token } } : {}),
  });
}

export const EVENTOS_VISITA = {
  solicitada: 'visita:solicitada',
  conectado: 'conectado',
} as const;
