// Funciones utilitarias compartidas
import { EtiquetaCliente } from '@repo/types'

/**
 * Formatea un número de teléfono con prefijo internacional
 * @param telefono Número de teléfono a formatear
 * @param pais Código de país (ej: 'AR', 'US')
 * @returns Teléfono formateado
 */
export function formatearTelefono(telefono: string, pais: string = 'AR'): string {
  // Limpiar el teléfono (solo números)
  const soloNumeros = telefono.replace(/\D/g, '')
  
  if (pais === 'AR') {
    // Argentina: +54 9 11 1234-5678
    if (soloNumeros.length === 10) {
      return `+54 9 ${soloNumeros.slice(0, 2)} ${soloNumeros.slice(2, 6)}-${soloNumeros.slice(6)}`
    }
  }
  
  // Formato genérico internacional
  return `+${soloNumeros}`
}

/**
 * Enmascara un número de teléfono mostrando solo los últimos dígitos
 * @param telefono Número de teléfono a enmascarar
 * @returns Teléfono enmascarado
 */
export function enmascararTelefono(telefono: string): string {
  const soloNumeros = telefono.replace(/\D/g, '')
  if (soloNumeros.length < 8) return '***-****'
  
  const ultimos4 = soloNumeros.slice(-4)
  return `+*** ****-**${ultimos4}`
}

/**
 * Formatea un precio con moneda local
 * @param monto Monto a formatear
 * @param moneda Código de moneda (ej: 'ARS', 'USD')
 * @returns Precio formateado
 */
export function formatearPrecio(monto: number, moneda: string = 'ARS'): string {
  const formatter = new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: moneda,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  })
  return formatter.format(monto)
}

/**
 * Formatea una fecha en tiempo relativo (hace X tiempo)
 * @param fecha Fecha a formatear
 * @returns Texto relativo
 */
export function formatearFechaRelativa(fecha: Date | string): string {
  const date = typeof fecha === 'string' ? new Date(fecha) : fecha
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / (1000 * 60))
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  
  if (diffMins < 1) return 'ahora mismo'
  if (diffMins < 60) return `hace ${diffMins} min${diffMins !== 1 ? 's' : ''}`
  if (diffHours < 24) return `hace ${diffHours} hora${diffHours !== 1 ? 's' : ''}`
  if (diffDays < 7) return `hace ${diffDays} día${diffDays !== 1 ? 's' : ''}`
  
  // Más de una semana: mostrar fecha completa
  return date.toLocaleDateString('es-AR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  })
}

/**
 * Calcula el progreso de sellos/puntos para un cliente
 * @param actuales Sellos/puntos actuales
 * @param total Sellos/puntos totales necesarios
 * @returns Objeto con progreso
 */
export function calcularProgresoSellos(
  actuales: number,
  total: number
): { porcentaje: number; faltantes: number; completado: boolean } {
  const porcentaje = total > 0 ? Math.min(100, Math.round((actuales / total) * 100)) : 0
  const faltantes = Math.max(0, total - actuales)
  const completado = actuales >= total
  
  return { porcentaje, faltantes, completado }
}

/**
 * Genera un ID de dispositivo único para PWA
 * @returns UUID v4
 */
export function generarDeviceId(): string {
  return crypto.randomUUID()
}

/**
 * Genera un mensaje de WhatsApp reemplazando variables
 * @param plantilla Plantilla con variables {nombre}, {negocio}, etc.
 * @param datos Objeto con valores para las variables
 * @returns Mensaje con variables reemplazadas
 */
export function generarMensajeWhatsApp(plantilla: string, datos: Record<string, string>): string {
  let mensaje = plantilla
  for (const [key, value] of Object.entries(datos)) {
    mensaje = mensaje.replace(new RegExp(`\{${key}\}`, 'g'), value)
  }
  return mensaje
}

/**
 * Convierte una clave VAPID pública de base64 a Uint8Array
 * @param base64 Clave pública en base64
 * @returns Uint8Array para Web Push API
 */
export function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const base64Url = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64Url)
  const outputArray = new Uint8Array(rawData.length)
  
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}

/**
 * Extrae el slug del subdominio de una URL
 * @param hostname Hostname completo (ej: 'bar-slug.dominio.com')
 * @returns Slug del negocio o null
 */
export function getSubdominio(hostname: string): string | null {
  const parts = hostname.split('.')
  if (parts.length >= 3) {
    return parts[0] ?? null // primer subdominio
  }
  return null
}

/**
 * Convierte texto a slug (URL-friendly)
 * @param texto Texto a convertir
 * @returns Slug
 */
export function slugify(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // eliminar acentos
    .replace(/[^a-z0-9\s-]/g, '') // eliminar caracteres especiales
    .replace(/\s+/g, '-') // reemplazar espacios con guiones
    .replace(/-+/g, '-') // eliminar guiones múltiples
    .trim()
}

/**
 * Obtiene la etiqueta adecuada para un cliente basado en su actividad
 * @param visitasTotales Número total de visitas
 * @param ultimaVisita Fecha de la última visita
 * @param sellosActuales Sellos actuales
 * @returns Etiqueta del cliente
 */
export function determinarEtiquetaCliente(
  visitasTotales: number,
  ultimaVisita?: Date,
  sellosActuales: number = 0
): EtiquetaCliente {
  const ahora = new Date()
  const diasSinVisita = ultimaVisita 
    ? Math.floor((ahora.getTime() - ultimaVisita.getTime()) / (1000 * 60 * 60 * 24))
    : Infinity
  
  if (diasSinVisita > 90) return EtiquetaCliente.INACTIVO
  if (visitasTotales >= 10 || sellosActuales >= 50) return EtiquetaCliente.VIP
  if (visitasTotales >= 3) return EtiquetaCliente.REGULAR
  return EtiquetaCliente.NUEVO
}

/**
 * Valida si un teléfono es válido para Argentina
 * @param telefono Número de teléfono
 * @returns true si es válido
 */
export function validarTelefonoAR(telefono: string): boolean {
  const soloNumeros = telefono.replace(/\D/g, '')
  return soloNumeros.length >= 8 && soloNumeros.length <= 13
}

/**
 * Genera un código de verificación aleatorio
 * @param longitud Longitud del código (default: 6)
 * @returns Código numérico
 */
export function generarCodigoVerificacion(longitud: number = 6): string {
  const min = Math.pow(10, longitud - 1)
  const max = Math.pow(10, longitud) - 1
  return Math.floor(Math.random() * (max - min + 1) + min).toString()
}

// --- fechas para la PWA (sin date-fns: Intl alcanza para lo que se muestra) ---

function aFecha(fecha: Date | string | number): Date | null {
  const d = fecha instanceof Date ? fecha : new Date(fecha)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Mismo dia del calendario (en la zona del dispositivo). */
export function esMismoDia(a: Date | string, b: Date | string = new Date()): boolean {
  const d1 = aFecha(a)
  const d2 = aFecha(b)
  if (!d1 || !d2) return false
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  )
}

/** "12 oct" — para listas donde el año se sobreentiende. */
export function formatearFechaCorta(fecha: Date | string): string {
  const d = aFecha(fecha)
  if (!d) return ''
  return d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' }).replace('.', '')
}

/** "19:30". */
export function formatearHora(fecha: Date | string): string {
  const d = aFecha(fecha)
  if (!d) return ''
  return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })
}

/**
 * "Hoy 19:30" / "Ayer 19:30" / "12 oct 19:30".
 * El caso "hoy" es el que mas se ve (la visita recien aprobada), asi que va
 * explicito en vez de "hace 3 horas".
 */
export function formatearDiaYHora(fecha: Date | string): string {
  const d = aFecha(fecha)
  if (!d) return ''
  const hora = formatearHora(d)
  if (esMismoDia(d)) return `Hoy ${hora}`

  const ayer = new Date()
  ayer.setDate(ayer.getDate() - 1)
  if (esMismoDia(d, ayer)) return `Ayer ${hora}`

  return `${formatearFechaCorta(d)} ${hora}`
}

/** true si la fecha cae dentro de las ultimas 24 horas. */
export function esUltimas24h(fecha: Date | string): boolean {
  const d = aFecha(fecha)
  if (!d) return false
  return Date.now() - d.getTime() < 24 * 60 * 60 * 1000
}

