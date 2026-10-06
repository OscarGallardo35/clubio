'use client'

/**
 * Card de un item de la carta: foto cuadrada, nombre, precio y etiquetas.
 *
 * Va en un grid de 2 columnas (ver CartaDigital): con la foto cuadrada entran dos por fila sin
 * que el texto quede apretado.
 *
 * El precio se muestra con `precio` (el efectivo de la sucursal). Cuando hay override por
 * sucursal se marca, para que nadie reporte "el precio esta mal" cuando en realidad es el de
 * otra sucursal.
 */
import { Badge, Card } from '@repo/ui'
import { ImagenOptimizada } from '@repo/ui'
import { formatearPrecio } from '@repo/utils'

export interface ItemDeCarta {
  id: string
  nombre: string
  descripcion?: string | null | undefined
  precio: number
  precioBase?: number | undefined
  tieneOverride?: boolean | undefined
  disponible: boolean
  etiquetas?: string[] | undefined
  fotoUrl?: string | null | undefined
}

export interface ItemCartaCardProps {
  item: ItemDeCarta
  /** true en las primeras cards visibles: baja el lazy loading de la imagen. */
  prioridad?: boolean | undefined
  /** Color de marca para el placeholder cuando el item no tiene foto. */
  colorMarca?: string | undefined
  onElegir: (item: ItemDeCarta) => void
}

export function ItemCartaCard({ item, prioridad = false, colorMarca, onElegir }: ItemCartaCardProps) {
  const agotado = item.disponible === false

  return (
    <Card className="overflow-hidden p-0" data-agotado={agotado ? '' : undefined}>
      {/* Card es un div: el area tocable va en un button propio (a11y + teclado). */}
      <button
        type="button"
        onClick={() => onElegir(item)}
        disabled={agotado}
        aria-label={agotado ? `${item.nombre} (agotado)` : `Agregar ${item.nombre}`}
        className="flex w-full flex-col text-left transition active:scale-[0.99] disabled:opacity-60"
      >
      <div className="relative">
        <ImagenOptimizada
          src={item.fotoUrl}
          alt={item.nombre}
          tipo="item"
          aspectRatio={1}
          priority={prioridad}
          placeholderColor={colorMarca}
        />
        {agotado ? (
          <span className="absolute left-2 top-2 rounded-full bg-black/70 px-2 py-1 text-xs font-medium text-white">
            Agotado
          </span>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col gap-1 p-3">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-medium leading-tight">{item.nombre}</h3>
          <span className="shrink-0 font-semibold">{formatearPrecio(item.precio)}</span>
        </div>

        {item.descripcion ? (
          <p className="line-clamp-2 text-sm text-muted-foreground">{item.descripcion}</p>
        ) : null}

        {(item.etiquetas?.length ?? 0) > 0 || item.tieneOverride ? (
          <div className="mt-1 flex flex-wrap gap-1">
            {item.tieneOverride ? <Badge variant="secondary">Precio de esta sucursal</Badge> : null}
            {(item.etiquetas ?? []).map((e) => (
              <Badge key={e} variant="outline">
                {e}
              </Badge>
            ))}
          </div>
        ) : null}
      </div>
      </button>
    </Card>
  )
}
