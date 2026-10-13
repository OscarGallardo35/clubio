import { Plan } from '@prisma/client';

/**
 * CATALOGO de features del motor de planes.
 *
 * Es la METADATA de cada feature (clave tecnica, etiqueta legible y una descripcion corta).
 * Las claves son EXACTAMENTE las que ya usa el sistema y NO se inventa ninguna:
 *  - las booleanas son las que aparecen en `@RequiereFeature(...)` de los controllers;
 *  - las numericas son las de `RECURSO_A_FEATURE` de `plan.service.ts` (1:1 con el enum
 *    `RecursoLimitado`).
 * La referencia de los valores por plan es `prisma/seed.ts` (`seedPlanFeatures`), pero el
 * `planesIncluidos` NO se hardcodea: se calcula en vivo contra `PlanFeature` (fuente unica
 * de verdad del motor). Aca solo vive lo que no cambia: clave, etiqueta y descripcion.
 */

/** `booleana` = on/off (`habilitada`); `limite` = cupo numerico (`limite`, null = ilimitado). */
export type TipoFeatureCatalogo = 'booleana' | 'limite';

export interface DefinicionFeatureCatalogo {
  clave: string;
  etiqueta: string;
  descripcion?: string;
  tipo: TipoFeatureCatalogo;
}

export const CATALOGO_FEATURES: DefinicionFeatureCatalogo[] = [
  // ---- Booleanas (on/off) ----
  { clave: 'fidelizacion', tipo: 'booleana', etiqueta: 'Fidelizacion', descripcion: 'Programa de sellos/puntos y tarjeta del cliente.' },
  { clave: 'resenas', tipo: 'booleana', etiqueta: 'Resenas', descripcion: 'Pedido de resena al cliente despues de la visita.' },
  { clave: 'menu', tipo: 'booleana', etiqueta: 'Carta / menu digital', descripcion: 'Carta publica del local y pedidos de mesa.' },
  { clave: 'pedidos', tipo: 'booleana', etiqueta: 'Pedidos', descripcion: 'Pedidos online (delivery, take away, mesa, mostrador).' },
  { clave: 'modificadores', tipo: 'booleana', etiqueta: 'Modificadores', descripcion: 'Grupos de opciones y adicionales de la carta.' },
  { clave: 'upsell', tipo: 'booleana', etiqueta: 'Upsell', descripcion: 'Sugerencias automaticas de productos en el pedido.' },
  { clave: 'push', tipo: 'booleana', etiqueta: 'Notificaciones push', descripcion: 'Campanas push a los clientes del local.' },
  { clave: 'crm', tipo: 'booleana', etiqueta: 'CRM de clientes', descripcion: 'Listado, busqueda y segmentacion de clientes.' },
  { clave: 'delivery', tipo: 'booleana', etiqueta: 'Delivery', descripcion: 'Envio de pedidos a domicilio.' },
  { clave: 'turnos', tipo: 'booleana', etiqueta: 'Turnos', descripcion: 'Reserva de turnos por parte del cliente.' },
  { clave: 'checkin', tipo: 'booleana', etiqueta: 'Check-in', descripcion: 'Check-in del cliente en el local.' },
  { clave: 'asignacion_pedidos', tipo: 'booleana', etiqueta: 'Asignacion de pedidos', descripcion: 'Reparto automatico de pedidos al staff del local.' },
  { clave: 'google_business', tipo: 'booleana', etiqueta: 'Google Business', descripcion: 'Integracion con el perfil de Google del local.' },

  // ---- Limites numericos (null = ilimitado) ----
  { clave: 'clientes', tipo: 'limite', etiqueta: 'Limite de clientes', descripcion: 'Clientes acumulados que admite el local.' },
  { clave: 'empleados', tipo: 'limite', etiqueta: 'Limite de empleados', descripcion: 'Empleados activos que admite el local.' },
  { clave: 'sucursales', tipo: 'limite', etiqueta: 'Limite de sucursales', descripcion: 'Sucursales que admite el local.' },
  { clave: 'items_carta', tipo: 'limite', etiqueta: 'Limite de items de carta', descripcion: 'Items de carta que admite el local.' },
  { clave: 'pedidos_mes', tipo: 'limite', etiqueta: 'Limite de pedidos por mes', descripcion: 'Pedidos que admite el local por mes.' },
  { clave: 'campanas_push_mes', tipo: 'limite', etiqueta: 'Limite de campanas push por mes', descripcion: 'Campanas push que admite el local por mes.' },
];

/** Claves validas del catalogo (para validar un `PATCH .../plan`). */
export const CLAVES_FEATURES = new Set(CATALOGO_FEATURES.map((f) => f.clave));

/** Los 3 planes, en orden de menor a mayor. */
export const PLANES_ORDEN: Plan[] = [Plan.FREE, Plan.BASIC, Plan.PRO];
