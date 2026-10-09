import type { DatosEjemploPlantilla } from '@/types/api'

/**
 * Reemplaza las variables {{var}} de una plantilla con los datos de ejemplo.
 *
 * Es un espejo del reemplazo del backend (`GET /push/plantillas/ejemplo` trae los
 * datos de un cliente REAL del negocio). Vive aca para que la lista de plantillas y
 * la vista de disparos muestren exactamente el mismo texto.
 */
export function renderizarPlantilla(
  texto: string,
  datos: DatosEjemploPlantilla | null,
): string {
  const vars: Record<string, string> = datos
    ? {
        nombre: datos.nombre,
        negocio: datos.negocio,
        premio: datos.premio,
        actuales: String(datos.actuales),
        meta: String(datos.meta),
        faltantes: String(datos.faltantes),
        numero: datos.numero,
      }
    : {}
  return texto.replace(/\{\{\s*([a-zA-Z]+)\s*\}\}/g, (_t, clave: string) => vars[clave] ?? `{{${clave}}}`)
}
