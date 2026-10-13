/**
 * Lecturas de las respuestas del backend de plataforma.
 *
 * El contrato del backend (congelado con este panel) no devuelve siempre "el local pelado":
 *  - `GET /locales/:negocioId`      -> `{ local, configuracion, sucursales, contadores }`
 *  - `POST /locales`                -> el local suelto
 *  - `PATCH /locales/:negocioId`    -> el local suelto
 *  - `GET /locales/:id/carta`       -> `{ negocioId, total, items, categorias }`
 *  - `GET /locales/:id/empleados`   -> `{ total, data }`
 *
 * Estas funciones traducen eso a la forma que consume la UI, tolerando tambien las variantes
 * (envoltorios con otro nombre, conteos anidados) para que un cambio de forma no deje la
 * pantalla mostrando listas vacias como si el local no tuviera nada.
 *
 * Todas son puras (sin React).
 */
import type { TenantTheme } from '@repo/types';
import type {
  ContadoresLocal,
  EmpleadoLocal,
  ItemCartaLocal,
  LocalDetalle,
  ModoFidelizacion,
} from '@/types/api';

const esObjeto = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Numero seguro: `null` cuando el valor no es un numero util (los objetos NO son numeros). */
function numero(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

const MODOS: ModoFidelizacion[] = ['SOLO_VISITAS', 'SOLO_PUNTOS', 'HIBRIDO'];

function modoFidelizacion(v: unknown): ModoFidelizacion {
  return typeof v === 'string' && (MODOS as string[]).includes(v)
    ? (v as ModoFidelizacion)
    : 'SOLO_VISITAS';
}

/** Las claves donde el backend puede envolver el local. */
const CLAVES_ANIDADO = ['local', 'negocio', 'data', 'detalle', 'resultado'] as const;

/**
 * Saca el local del body y le PEGA los hermanos que le corresponden.
 *
 * El detalle viene como `{ local, configuracion, contadores, sucursales }`: si solo se
 * devolviera `local`, la pestana Configuracion veria un local sin configuracion (y mostraria
 * "no tiene configuracion cargada" para un local que si la tiene) y el Resumen perderia los
 * contadores. Por eso los hermanos se fusionan en el nivel del local.
 */
export function desenvolverLocal(raw: unknown): LocalDetalle {
  const o = esObjeto(raw) ? raw : {};

  const anidado = CLAVES_ANIDADO.map((k) => o[k]).find(
    (hijo) => esObjeto(hijo) && typeof hijo.id === 'string',
  );

  if (esObjeto(anidado)) {
    const fusionado: Record<string, unknown> = { ...anidado };
    for (const clave of ['configuracion', 'theme', 'contadores', 'sucursales', 'tieneTheme']) {
      if (fusionado[clave] === undefined && o[clave] !== undefined) fusionado[clave] = o[clave];
    }
    return normalizarLocalDetalle(fusionado);
  }

  return normalizarLocalDetalle(o);
}

/** Normaliza el detalle de un local, con defaults seguros para los campos que falten. */
export function normalizarLocalDetalle(raw: unknown): LocalDetalle {
  const o = esObjeto(raw) ? raw : {};
  const cfgCruda = esObjeto(o.configuracion) ? o.configuracion : esObjeto(o.config) ? o.config : null;
  const cont = esObjeto(o.contadores) ? o.contadores : esObjeto(o._count) ? o._count : null;

  // WhatsApp del local: la fuente real es `ConfiguracionClub.numeroAtendiente`; el local puede
  // no traerlo. Se aceptan las dos.
  const numeroAtendiente =
    typeof o.numeroAtendiente === 'string'
      ? o.numeroAtendiente
      : typeof cfgCruda?.numeroAtendiente === 'string'
        ? cfgCruda.numeroAtendiente
        : null;

  return {
    id: String(o.id ?? ''),
    nombre: String(o.nombre ?? ''),
    slug: String(o.slug ?? ''),
    plan: (o.plan === 'BASIC' || o.plan === 'PRO' ? o.plan : 'FREE') as LocalDetalle['plan'],
    activo: o.activo !== false,
    colorPrimario: typeof o.colorPrimario === 'string' ? o.colorPrimario : '#E11D48',
    colorSecundario: typeof o.colorSecundario === 'string' ? o.colorSecundario : '#111827',
    telefono: typeof o.telefono === 'string' ? o.telefono : null,
    email: typeof o.email === 'string' ? o.email : null,
    numeroAtendiente,
    creadoEn: typeof o.creadoEn === 'string' ? o.creadoEn : null,
    tieneTheme: o.tieneTheme === true || esObjeto(o.theme),
    // Cast explicito a `TenantTheme` (no a `LocalDetalle['theme']`, que arrastra `undefined`
    // por ser propiedad opcional, y con exactOptionalPropertyTypes eso no asigna).
    theme: esObjeto(o.theme) ? (o.theme as unknown as TenantTheme) : null,
    configuracion: cfgCruda
      ? {
          ...cfgCruda,
          modoFidelizacion: modoFidelizacion(cfgCruda.modoFidelizacion),
          sellosParaPremio: numero(cfgCruda.sellosParaPremio) ?? 6,
          premioTexto: typeof cfgCruda.premioTexto === 'string' ? cfgCruda.premioTexto : 'Un premio gratis',
        }
      : null,
    contadores: {
      itemsCarta: cont ? numero(cont.itemsCarta ?? cont.items) : null,
      empleados: cont ? numero(cont.empleados ?? cont.totalEmpleados) : null,
      clientes: cont ? numero(cont.clientes) : null,
      visitas: cont ? numero(cont.visitas) : null,
      pedidos: cont ? numero(cont.pedidos) : null,
      sucursales: cont
        ? numero(cont.sucursales)
        : Array.isArray(o.sucursales)
          ? o.sucursales.length
          : null,
    },
  };
}

/** Los items de la carta, vengan como `items` o como `categorias: [{ items }]`. */
export function itemsDeCarta(raw: unknown): ItemCartaLocal[] {
  let crudos: unknown[] = [];
  if (Array.isArray(raw)) crudos = raw;
  else if (esObjeto(raw)) {
    if (Array.isArray(raw.items)) crudos = raw.items;
    else if (Array.isArray(raw.data)) crudos = raw.data;
    else if (Array.isArray(raw.categorias)) {
      crudos = raw.categorias.flatMap((g) => (esObjeto(g) && Array.isArray(g.items) ? g.items : []));
    }
  }

  return crudos.filter(esObjeto).map((i) => ({
    ...i,
    id: String(i.id ?? ''),
    nombre: String(i.nombre ?? ''),
    precio:
      typeof i.precio === 'number' || typeof i.precio === 'string' ? (i.precio as number | string) : 0,
    descripcion: typeof i.descripcion === 'string' ? i.descripcion : null,
    disponible: i.disponible !== false,
    // El contrato lo llama "grupo/categoria"; el modelo, `categoria`.
    categoria:
      typeof i.categoria === 'string'
        ? i.categoria
        : typeof i.grupo === 'string'
          ? i.grupo
          : 'General',
    orden: numero(i.orden) ?? 0,
  }));
}

/** Los empleados, vengan como `data`, `items` o `empleados`. */
export function empleadosDeLista(raw: unknown): EmpleadoLocal[] {
  let crudos: unknown[] = [];
  if (Array.isArray(raw)) crudos = raw;
  else if (esObjeto(raw)) {
    if (Array.isArray(raw.data)) crudos = raw.data;
    else if (Array.isArray(raw.items)) crudos = raw.items;
    else if (Array.isArray(raw.empleados)) crudos = raw.empleados;
  }

  return crudos.filter(esObjeto).map((e) => ({
    ...e,
    id: String(e.id ?? ''),
    nombre: String(e.nombre ?? ''),
    rol: (typeof e.rol === 'string' ? e.rol : 'EMPLEADO') as EmpleadoLocal['rol'],
    email: typeof e.email === 'string' ? e.email : null,
    // El backend no devuelve el hash: expone `tienePin`.
    tienePin: e.tienePin === true,
    activo: e.activo !== false,
    creadoEn: typeof e.creadoEn === 'string' ? e.creadoEn : null,
  }));
}

/** Conteo de un campo que puede venir suelto o como objeto `{ total, creados, actualizados }`. */
function totalDe(v: unknown): number | null {
  if (esObjeto(v)) return numero(v.total ?? v.creados);
  return numero(v);
}

export interface CreadoEnProvision {
  itemsCarta: number | null;
  empleados: number | null;
  clientes: number | null;
}

/**
 * Los numeros REALES de la provision, tal como los devuelve `POST .../provisionar`:
 * `{ items: { creados, actualizados, total }, empleados: {...}, clientes, clienteDemo }`.
 * Nunca se estiman: si el backend no los manda, van en `null` y la UI lo dice.
 */
export function creadoDeProvision(raw: unknown): CreadoEnProvision {
  const o = esObjeto(raw) ? raw : {};
  const clienteDemo = esObjeto(o.clienteDemo) ? o.clienteDemo : null;
  return {
    itemsCarta: totalDe(o.items),
    empleados: totalDe(o.empleados),
    clientes: numero(o.clientes) ?? (clienteDemo ? 1 : null),
  };
}

export interface BorradosEnReset {
  visitas: number | null;
  pedidos: number | null;
  clientes: number | null;
  tarjetas: number | null;
}

/** Lo que borro el reset de demo (`POST .../reset-demo` -> `{ borrados: {...} }`). */
export function borradosDeReset(raw: unknown): BorradosEnReset {
  const o = esObjeto(raw) ? raw : {};
  const b = esObjeto(o.borrados) ? o.borrados : o;
  return {
    visitas: numero(b.visitas),
    pedidos: numero(b.pedidos),
    clientes: numero(b.clientes),
    tarjetas: numero(b.tarjetas),
  };
}

export type { ContadoresLocal };
