/**
 * Envelope UNICO de los listados de la API: { data, total, page, pageSize }.
 *
 * NOTA: se define aca (y no se importa de @repo/types) a proposito.
 * Importar TS fuente de otro paquete del monorepo hace que tsc incluya esos
 * archivos en el program y suba el rootDir inferido a la raiz del monorepo,
 * desplazando la salida a dist/apps/backend/... y rompiendo `node dist/main.js`.
 * @repo/types queda para el FRONTEND; el backend mantiene su propio contrato.
 * (Deben coincidir: @repo/types exporta la misma forma como PaginatedResponse.)
 */
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PaginationQuery {
  page?: number | string;
  pageSize?: number | string;
  /** alias aceptado por compatibilidad */
  limit?: number | string;
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
}

/** Normaliza page/pageSize de un query string. */
export function getPagination(q: PaginationQuery, maxPageSize = 100): PaginationMeta {
  const page = Math.max(1, Number(q.page) || 1);
  const raw = Number(q.pageSize ?? q.limit) || 20;
  const pageSize = Math.min(maxPageSize, Math.max(1, raw));
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

/** Envuelve datos + total en el formato unico { data, total, page, pageSize }. */
export function paginar<T>(data: T[], total: number, page: number, pageSize: number): PaginatedResponse<T> {
  return { data, total, page, pageSize };
}
