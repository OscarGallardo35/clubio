import { z } from 'zod'
import { cuidSchema } from './lib/cuid'

export { cuidSchema }

// Re-exports de tipos
export type LoginEmpleadoInput = z.infer<typeof loginEmpleadoSchema>
export type LoginDuenoInput = z.infer<typeof loginDuenoSchema>
export type Verificar2FAInput = z.infer<typeof verificar2FASchema>
export type RegistrarClienteInput = z.infer<typeof registrarClienteSchema>
export type RecuperarClienteInput = z.infer<typeof recuperarClienteSchema>
export type CambiarPasswordInput = z.infer<typeof cambiarPasswordSchema>
export type SolicitarVisitaInput = z.infer<typeof solicitarVisitaSchema>
export type AprobarVisitaInput = z.infer<typeof aprobarVisitaSchema>
export type RechazarVisitaInput = z.infer<typeof rechazarVisitaSchema>
export type RegaloManualInput = z.infer<typeof regaloManualSchema>
export type ActualizarClienteInput = z.infer<typeof actualizarClienteSchema>
export type CrearClienteManualInput = z.infer<typeof crearClienteManualSchema>
export type FiltrarClientesInput = z.infer<typeof filtrarClientesSchema>
export type CrearItemCartaInput = z.infer<typeof crearItemCartaSchema>
export type ActualizarItemCartaInput = z.infer<typeof actualizarItemCartaSchema>
export type ReordenarCartaInput = z.infer<typeof reordenarCartaSchema>
export type EnviarPromocionInput = z.infer<typeof enviarPromocionSchema>
export type SuscripcionPushInput = z.infer<typeof suscripcionPushSchema>
export type CrearPedidoDeliveryInput = z.infer<typeof crearPedidoDeliverySchema>
export type ActualizarEstadoPedidoInput = z.infer<typeof actualizarEstadoPedidoSchema>
export type ActualizarConfiguracionInput = z.infer<typeof actualizarConfiguracionSchema>

/**
 * Valores de enums, copiados de apps/backend/prisma/schema.prisma (fuente de verdad).
 *
 * Por que listas y no z.nativeEnum() de @repo/types: importar el package desde aca
 * mete sus fuentes en el programa de tsc y rompe con TS6059 (rootDir), que es el
 * trabajo pendiente del grafo de packages. Con listas + `check:validators` la
 * sincronizacion con el schema queda verificada por comando, no por convencion.
 *
 * Estas SI son columnas del schema.
 */
export const ETIQUETAS_CLIENTE = ['NUEVO', 'REGULAR', 'VIP', 'INACTIVO'] as const
export const ESTADOS_PEDIDO = [
  'PENDIENTE', 'CONFIRMADO', 'EN_PREPARACION', 'LISTO', 'ENVIADO', 'ENTREGADO', 'CANCELADO', 'RECHAZADO',
] as const
export const MODOS_FIDELIZACION = ['SOLO_VISITAS', 'SOLO_PUNTOS', 'HIBRIDO'] as const
export const CANALES_CAMPANA = ['PUSH', 'WHATSAPP', 'AMBOS'] as const

/** Estos NO son columnas del schema: son opciones de entrada de la app. */
export const DESTINATARIOS_CAMPANA = ['TODOS', 'ETIQUETA', 'INDIVIDUAL'] as const

// Esquemas de autenticación
export const loginEmpleadoSchema = z.object({
  email: z.string().email('Email inválido'),
  pin: z.string().min(4, 'PIN debe tener al menos 4 dígitos').max(6, 'PIN máximo 6 dígitos')
})

export const loginDuenoSchema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(6, 'Contraseña mínimo 6 caracteres')
})

export const verificar2FASchema = z.object({
  token: z.string().min(6, 'Token 2FA inválido'),
  rememberDevice: z.boolean().optional().default(false)
})

export const registrarClienteSchema = z.object({
  nombre: z.string().min(2, 'Nombre mínimo 2 caracteres').max(100, 'Nombre máximo 100 caracteres'),
  telefono: z.string().min(8, 'Teléfono inválido').max(20, 'Teléfono muy largo'),
  email: z.string().email('Email inválido').optional(),
  fechaNacimiento: z.string().datetime({ offset: true }).optional()
})

export const recuperarClienteSchema = z.object({
  telefono: z.string().min(8, 'Teléfono inválido').max(20, 'Teléfono muy largo')
})

export const cambiarPasswordSchema = z.object({
  currentPassword: z.string().min(6, 'Contraseña actual mínimo 6 caracteres'),
  newPassword: z.string().min(8, 'Nueva contraseña mínimo 8 caracteres')
    .regex(/[A-Z]/, 'Debe contener al menos una mayúscula')
    .regex(/[a-z]/, 'Debe contener al menos una minúscula')
    .regex(/[0-9]/, 'Debe contener al menos un número')
})

// Esquemas de visitas
/**
 * Espeja SolicitarVisitaDto del backend (apps/backend/src/visitas/dto).
 * El cliente sale del JWT, no del body: aca NO va clienteId, y tipo/metodo no
 * existen en la API.
 */
export const solicitarVisitaSchema = z.object({
  sucursalId: cuidSchema.optional(),
  sucursalSlug: z.string().max(60, 'Slug de sucursal máximo 60 caracteres').optional(),
  origen: z.string().max(40, 'Origen máximo 40 caracteres').optional()
})

export const aprobarVisitaSchema = z.object({
  visitaId: cuidSchema,
  empleadoId: cuidSchema,
  observaciones: z.string().max(500, 'Observaciones máximo 500 caracteres').optional()
})

export const rechazarVisitaSchema = z.object({
  visitaId: cuidSchema,
  empleadoId: cuidSchema,
  motivo: z.string().min(5, 'Motivo mínimo 5 caracteres').max(200, 'Motivo máximo 200 caracteres')
})

export const regaloManualSchema = z.object({
  clienteId: cuidSchema,
  sellosOtorgados: z.number().int().min(1, 'Mínimo 1 sello').max(100, 'Máximo 100 sellos'),
  motivo: z.string().max(200, 'Motivo máximo 200 caracteres')
})

// Esquemas de clientes
export const actualizarClienteSchema = z.object({
  nombre: z.string().min(2, 'Nombre mínimo 2 caracteres').max(100, 'Nombre máximo 100 caracteres').optional(),
  email: z.string().email('Email inválido').optional(),
  fechaNacimiento: z.string().datetime({ offset: true }).optional(),
  preferencias: z.record(z.any()).optional()
})

export const crearClienteManualSchema = z.object({
  nombre: z.string().min(2, 'Nombre mínimo 2 caracteres').max(100, 'Nombre máximo 100 caracteres'),
  telefono: z.string().min(8, 'Teléfono inválido').max(20, 'Teléfono muy largo'),
  email: z.string().email('Email inválido').optional(),
  fechaNacimiento: z.string().datetime({ offset: true }).optional(),
  sellosIniciales: z.number().int().min(0).max(100).optional().default(0)
})

export const filtrarClientesSchema = z.object({
  etiqueta: z.enum(ETIQUETAS_CLIENTE).optional(),
  activo: z.boolean().optional(),
  search: z.string().max(100, 'Búsqueda máximo 100 caracteres').optional(),
  page: z.number().int().min(1).optional().default(1),
  limit: z.number().int().min(1).max(100).optional().default(20)
})

// Esquemas de carta
export const crearItemCartaSchema = z.object({
  nombre: z.string().min(2, 'Nombre mínimo 2 caracteres').max(100, 'Nombre máximo 100 caracteres'),
  descripcion: z.string().max(500, 'Descripción máximo 500 caracteres').optional(),
  precio: z.number().min(0, 'Precio mínimo 0').max(1000000, 'Precio máximo 1,000,000'),
  categoria: z.string().min(1, 'Categoría requerida').max(50, 'Categoría máximo 50 caracteres'),
  imagenUrl: z.string().url('URL inválida').optional()
})

export const actualizarItemCartaSchema = z.object({
  nombre: z.string().min(2, 'Nombre mínimo 2 caracteres').max(100, 'Nombre máximo 100 caracteres').optional(),
  descripcion: z.string().max(500, 'Descripción máximo 500 caracteres').optional(),
  precio: z.number().min(0, 'Precio mínimo 0').max(1000000, 'Precio máximo 1,000,000').optional(),
  categoria: z.string().min(1, 'Categoría requerida').max(50, 'Categoría máximo 50 caracteres').optional(),
  imagenUrl: z.string().url('URL inválida').optional().or(z.literal('').transform(() => undefined)),
  activo: z.boolean().optional()
})

export const reordenarCartaSchema = z.object({
  items: z.array(z.object({
    id: cuidSchema,
    orden: z.number().int().min(0)
  })).min(1, 'Debe incluir al menos un item')
})

// Esquemas de marketing
export const enviarPromocionSchema = z.object({
  nombre: z.string().min(2, 'Nombre mínimo 2 caracteres').max(100, 'Nombre máximo 100 caracteres'),
  mensaje: z.string().min(10, 'Mensaje mínimo 10 caracteres').max(500, 'Mensaje máximo 500 caracteres'),
  canal: z.enum(CANALES_CAMPANA),
  destinatarios: z.enum(DESTINATARIOS_CAMPANA),
  filtroEtiqueta: z.enum(ETIQUETAS_CLIENTE).optional(),
  clienteIds: z.array(cuidSchema).optional(),
  programadaPara: z.string().datetime({ offset: true }).optional()
})

export const suscripcionPushSchema = z.object({
  endpoint: z.string().url('Endpoint inválido'),
  keys: z.object({
    p256dh: z.string(),
    auth: z.string()
  })
})

// Esquemas de delivery
export const crearPedidoDeliverySchema = z.object({
  items: z.array(z.object({
    itemId: cuidSchema,
    cantidad: z.number().int().min(1, 'Cantidad mínimo 1')
  })).min(1, 'Debe incluir al menos un item'),
  direccionEntrega: z.string().min(5, 'Dirección mínimo 5 caracteres').max(200, 'Dirección máximo 200 caracteres'),
  telefonoContacto: z.string().min(8, 'Teléfono inválido').max(20, 'Teléfono muy largo'),
  notas: z.string().max(500, 'Notas máximo 500 caracteres').optional()
})

export const actualizarEstadoPedidoSchema = z.object({
  estado: z.enum(ESTADOS_PEDIDO),
  estimadoMinutos: z.number().int().min(1).max(480).optional()
})

// Esquemas de configuración
export const actualizarConfiguracionSchema = z.object({
  modoFidelizacion: z.enum(MODOS_FIDELIZACION).optional(),
  sellosParaRegalo: z.number().int().min(1).max(100).optional(),
  puntosPorVisita: z.number().int().min(1).max(1000).optional(),
  visitasParaRegalo: z.number().int().min(1).max(100).optional(),
  regaloNombre: z.string().min(2, 'Nombre mínimo 2 caracteres').max(100, 'Nombre máximo 100 caracteres').optional(),
  regaloDescripcion: z.string().max(500, 'Descripción máximo 500 caracteres').optional(),
  regaloImagenUrl: z.string().url('URL inválida').optional(),
  permiteAutoAprobar: z.boolean().optional(),
  requiereVerificacionStaff: z.boolean().optional(),
  duracionSesionHoras: z.number().int().min(1).max(24).optional()
})
