/**
 * Numero de atencion (WhatsApp) que el cliente debe usar.
 *
 * Espeja EXACTAMENTE `SucursalResolverService.resolverNumeroAtendiente` del backend:
 *   - `negocio.numeroAtendiente` es el valor que el backend YA resolvio. Como la marca/negocio
 *     publico se pide SIN sucursal (el layout del tenant no la conoce), trae el del CLUB (o el de
 *     la sucursal solo si el club estuviera vacio).
 *   - Si el local activa `usarNumeroAtendienteDistinto` y la sucursal activa tiene su propio
 *     numero, ESE manda (con fallback al del local). Si no, manda el del local.
 *
 * Se calcula en el cliente (y no se lee `configuracion.numeroAtendiente`) porque ESE campo es el
 * valor CRUDO del club: usarlo pisaria el override por sucursal que ya resolvio el backend.
 *
 * IDEMPOTENTE: si `negocio.numeroAtendiente` ya viniera resuelto para la sucursal, el resultado no
 * cambia (la sucursal gana igual cuando el switch esta activo).
 */
import type { NegocioPublico, SucursalPublica } from '@/types/api'

export function numeroAtencionEfectivo(
  negocio: Pick<NegocioPublico, 'numeroAtendiente' | 'configuracion'> | null | undefined,
  sucursal: Pick<SucursalPublica, 'numeroAtendiente'> | null | undefined,
): string | null {
  const delLocal = negocio?.numeroAtendiente ?? null
  if (!sucursal) return delLocal

  const deLaSucursal = sucursal.numeroAtendiente ?? null
  if (negocio?.configuracion?.usarNumeroAtendienteDistinto === true) {
    return deLaSucursal ?? delLocal
  }
  return delLocal ?? deLaSucursal
}
