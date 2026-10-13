/**
 * Slug de un local: la misma regla que usa la PWA Admin (y el backend) para el slug de la
 * sucursal. Se centraliza aca para que el wizard de "Nuevo local" y el formulario de edicion
 * no tengan cada uno su copia de la regex (si divergen, el backend responde 400 y el usuario
 * ve un error sin entender por que).
 *
 * Copiada de `apps/pwa-admin/app/[tenant]/(admin)/sucursales/page.tsx`.
 */
export const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** true solo si el slug es valido: minusculas, numeros y guiones simples, sin guion al borde. */
export function slugValido(slug: string): boolean {
  return SLUG_REGEX.test(slug);
}

/**
 * Sugiere un slug a partir del nombre: minusculas, sin acentos, separadores a guion.
 * Es solo una sugerencia editable; el slug final es el que tipea el operador.
 */
export function sugerirSlug(nombre: string): string {
  return nombre
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** Limpia lo que se tipea en el input del slug (evita que el operador escriba mayusculas o "ñ"). */
export function limpiarSlug(texto: string): string {
  return texto.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 60);
}
