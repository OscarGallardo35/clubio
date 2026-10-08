'use client'

import * as React from 'react'
import { cn } from '../lib/utils'
import { Skeleton } from './skeleton'

/**
 * DataTable — la tabla del admin.
 *
 * Alcance a proposito: columnas, filas, estado vacio y estado de carga. **Sin sorting ni
 * filtrado propios**: la API ya filtra y pagina (los listados devuelven `{ data, total, page }`),
 * asi que duplicar esa logica en el cliente seria tener dos verdades. **Sin paginacion
 * interna**: la maneja la pantalla, que es la que sabe que pagina esta mirando.
 *
 * El markup es una `<table>` de verdad (no `div`s con role): andamiaje para lectores de pantalla
 * y para el navegador. En mobile se scrollea en horizontal; si una tabla necesita mas de ~4
 * columnas conviene otra vista antes que forzarla.
 *
 * `onRowClick` agrega `role="button"` + `tabIndex=0` + Enter/Espacio: una fila clickeable tiene
 * que ser alcanzable con el teclado, no solo con el mouse.
 */
export interface DataTableColumn<T> {
  /** Clave del campo de la fila, o un id propio si la columna se dibuja con `render`. */
  key: string
  header: React.ReactNode
  /** Dibuja la celda a mano (badges, acciones, formato). Sin esto se muestra el valor crudo. */
  render?: (fila: T) => React.ReactNode
  className?: string
}

export interface DataTableProps<T> {
  data: T[]
  columns: DataTableColumn<T>[]
  /** Mientras carga: filas de skeleton. Gana sobre `data`. */
  loading?: boolean
  /** Mensaje del estado vacio. */
  empty?: React.ReactNode
  onRowClick?: (fila: T) => void
  /** Cuantas filas de skeleton mostrar (default 4). */
  filasCargando?: number
  /** Clave estable por fila (recomendado: el id). Sin esto se usa el indice. */
  rowKey?: (fila: T, indice: number) => string
  className?: string
}

const FILAS_CARGA = 4

function celdaPorDefecto<T>(fila: T, columna: DataTableColumn<T>): React.ReactNode {
  const valor = (fila as Record<string, unknown>)[columna.key]
  if (valor === null || valor === undefined || valor === '') return '—'
  if (typeof valor === 'string' || typeof valor === 'number') return valor
  if (typeof valor === 'boolean') return valor ? 'Si' : 'No'
  return '—'
}

export function DataTable<T>({
  data,
  columns,
  loading = false,
  empty,
  onRowClick,
  filasCargando = FILAS_CARGA,
  rowKey,
  className,
}: DataTableProps<T>) {
  return (
    <div className={cn('w-full overflow-x-auto rounded-2xl border', className)}>
      <table className="w-full caption-bottom text-sm">
        <thead className="bg-muted/50">
          <tr className="border-b">
            {columns.map((columna) => (
              <th
                key={columna.key}
                scope="col"
                className={cn('px-4 py-3 text-left font-medium text-muted-foreground', columna.className)}
              >
                {columna.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            // `data-carga` es para las aserciones SSR (mismo criterio que `data-desborda` en TabsList).
            Array.from({ length: filasCargando }, (_, i) => (
              <tr key={`carga-${i}`} data-carga className="border-b last:border-0">
                {columns.map((columna) => (
                  <td key={columna.key} className="px-4 py-3">
                    <Skeleton className="h-4 w-full" />
                  </td>
                ))}
              </tr>
            ))
          ) : data.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-10 text-center text-muted-foreground">
                {empty ?? 'No hay datos para mostrar.'}
              </td>
            </tr>
          ) : (
            data.map((fila, indice) => (
              <tr
                key={rowKey ? rowKey(fila, indice) : indice}
                className={cn('border-b last:border-0', onRowClick && 'cursor-pointer hover:bg-accent/50')}
                {...(onRowClick
                  ? {
                      role: 'button',
                      tabIndex: 0,
                      onClick: () => onRowClick(fila),
                      onKeyDown: (evento: React.KeyboardEvent<HTMLTableRowElement>) => {
                        if (evento.key === 'Enter' || evento.key === ' ') {
                          evento.preventDefault()
                          onRowClick(fila)
                        }
                      },
                    }
                  : {})}
              >
                {columns.map((columna) => (
                  <td key={columna.key} className={cn('px-4 py-3', columna.className)}>
                    {columna.render ? columna.render(fila) : celdaPorDefecto(fila, columna)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
