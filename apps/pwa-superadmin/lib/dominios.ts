/**
 * Los hosts publicos de cada PWA. Viven aca y no sueltos en la pantalla porque son la
 * PROMESA que el operador le muestra al local: los tres links tienen que salir del mismo
 * lugar que los usa el resto del producto (la PWA Admin ya muestra `staff.clubio.lat/<slug>/login`).
 *
 * Sin `NEXT_PUBLIC_*`: son hosts de producto, no de entorno. Si algun dia el cliente pasa a
 * subdominio propio, este es el UNICO lugar a tocar.
 */
export const HOST_CLIENTE = 'app.clubio.lat';
export const HOST_STAFF = 'staff.clubio.lat';
export const HOST_ADMIN = 'admin.clubio.lat';

export interface LinkDemo {
  /** Etiqueta corta para la lista. */
  etiqueta: string;
  /** Para quien es (una linea). */
  para: string;
  /** URL completa (es lo que se copia). */
  url: string;
}

/** Los tres links que el operador le pasa al local cuando el demo queda listo. */
export function linksDeLocal(slug: string): LinkDemo[] {
  return [
    {
      etiqueta: 'Menu del cliente',
      para: 'Lo que abre el cliente al escanear el QR.',
      url: `https://${HOST_CLIENTE}/${slug}/menu`,
    },
    {
      etiqueta: 'Panel del personal',
      para: 'Donde el staff valida visitas y pedidos.',
      url: `https://${HOST_STAFF}/${slug}/login`,
    },
    {
      etiqueta: 'Panel del dueno',
      para: 'Donde el dueno ve su club y su carta.',
      url: `https://${HOST_ADMIN}/${slug}/login`,
    },
  ];
}

/** El link "sin protocolo" que se muestra en pantalla (mas corto y mas legible). */
export function linkCorto(url: string): string {
  return url.replace(/^https?:\/\//, '');
}
