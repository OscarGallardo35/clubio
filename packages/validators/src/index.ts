import { z } from 'zod'
import type * as Types from '@repo/types'

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
export const solicitarVisitaSchema = z.object({
  clienteId: z.string().uuid('ID de cliente inválido'),
  tipo: z.enum(['QR_CLUB', 'QR_MENU', 'MANUAL']),
  metodo: z.enum(['QR', 'MANUAL', 'PROMOCION'])
})

export const aprobarVisitaSchema = z.object({
  visitaId: z.string().uuid('ID de visita inválido'),
  empleadoId: z.string().uuid('ID de empleado inválido'),
  observaciones: z.string().max(500, 'Observaciones máximo 500 caracteres').optional()
})

export const rechazarVisitaSchema = z.object({
  visitaId: z.string().uuid('ID de visita inválido'),
  empleadoId: z.string().uuid('ID de empleado inválido'),
  motivo: z.string().min(5, 'Motivo mínimo 5 caracteres').max(200, 'Motivo máximo 200 caracteres')
})

export const regaloManualSchema = z.object({
  clienteId: z.string().uuid('ID de cliente inválido'),
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
  etiqueta: z.enum(['NUEVO', 'RECURRENTE', 'VIP', 'INACTIVO']).optional(),
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
    id: z.string().uuid('ID de item inválido'),
    orden: z.number().int().min(0)
  })).min(1, 'Debe incluir al menos un item')
})

// Esquemas de marketing
export const enviarPromocionSchema = z.object({
  nombre: z.string().min(2, 'Nombre mínimo 2 caracteres').max(100, 'Nombre máximo 100 caracteres'),
  mensaje: z.string().min(10, 'Mensaje mínimo 10 caracteres').max(500, 'Mensaje máximo 500 caracteres'),
  canal: z.enum(['PUSH', 'WHATSAPP', 'EMAIL', 'IN_APP']),
  destinatarios: z.enum(['TODOS', 'ETIQUETA', 'INDIVIDUAL']),
  filtroEtiqueta: z.enum(['NUEVO', 'RECURRENTE', 'VIP', 'INACTIVO']).optional(),
  clienteIds: z.array(z.string().uuid('ID de cliente inválido')).optional(),
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
    itemId: z.string().uuid('ID de item inválido'),
    cantidad: z.number().int().min(1, 'Cantidad mínimo 1')
  })).min(1, 'Debe incluir al menos un item'),
  direccionEntrega: z.string().min(5, 'Dirección mínimo 5 caracteres').max(200, 'Dirección máximo 200 caracteres'),
  telefonoContacto: z.string().min(8, 'Teléfono inválido').max(20, 'Teléfono muy largo'),
  notas: z.string().max(500, 'Notas máximo 500 caracteres').optional()
})

export const actualizarEstadoPedidoSchema = z.object({
  estado: z.enum(['PENDIENTE', 'CONFIRMADO', 'EN_PREPARACION', 'LISTO', 'ENTREGADO', 'CANCELADO']),
  estimadoMinutos: z.number().int().min(1).max(480).optional()
})

// Esquemas de configuración
export const actualizarConfiguracionSchema = z.object({
  modoFidelizacion: z.enum(['SELLOS', 'PUNTOS', 'VISITAS']).optional(),
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

// Exportar todos los esquemas
export {
  loginEmpleadoSchema,
  loginDuenoSchema,
  verificar2FASchema,
  registrarClienteSchema,
  recuperarClienteSchema,
  cambiarPasswordSchema,
  solicitarVisitaSchema,
  aprobarVisitaSchema,
  rechazarVisitaSchema,
  regaloManualSchema,
  actualizarClienteSchema,
  crearClienteManualSchema,
  filtrarClientesSchema,
  crearItemCartaSchema,
  actualizarItemCartaSchema,
  reordenarCartaSchema,
  enviarPromocionSchema,
  suscripcionPushSchema,
  crearPedidoDeliverySchema,
  actualizarEstadoPedidoSchema,
  actualizarConfiguracionSchema
}
