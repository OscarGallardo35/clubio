'use client'

/**
 * Elegir las opciones de un item antes de agregarlo al carrito.
 *
 * Presentacional a proposito: recibe los grupos ya resueltos (los trae el cache) y avisa con
 * `onAgregar`. NO toca el store: el `despachar({ tipo: 'AGREGAR_ITEM' })` lo hace CartaDigital.
 *
 * Los controles son nativos y no los de @repo/ui: RadioGroup es un stub (`crearStub`: renderiza
 * null y avisa en dev) y Checkbox/Textarea son cascaras de una linea sin props, asi que no
 * aceptan `checked`/`onChange`. El typecheck no lo caza porque las firmas parecen correctas.
 */
import * as React from 'react'
import { BottomSheet, Button } from '@repo/ui'
import { formatearPrecio } from '@repo/utils'
import {
  alternarSeleccion,
  armarItemProvisional,
  elegidosDesde,
  gruposObligatoriosFaltantes,
  recortarNotas,
  seleccionVacia,
  MAX_NOTAS,
} from '@/lib/modificadores-seleccion'
import type { SeleccionPorGrupo } from '@/lib/modificadores-seleccion'
import { precioUnitario, validarModificadores } from '@/lib/carrito-maquina'
import type { ModificadorElegido } from '@/lib/carrito-maquina'
import type { GrupoModificadorPublico } from '@/lib/modificadores-cache'

export interface ItemParaModal {
  id: string
  nombre: string
  precio: number
  fotoUrl?: string | null | undefined
  grupos: GrupoModificadorPublico[]
}

export interface ModalModificadoresProps {
  item: ItemParaModal
  abierto: boolean
  onCerrar: () => void
  /** Recibe la forma interna del carrito: el borde de la API la convierte a opcionIds. */
  onAgregar: (modificadores: ModificadorElegido[], notas: string) => void
  /** Se propaga por prop (no se lee el hook adentro) para poder testear el render. */
  reducedMotion?: boolean | undefined
}

export function ModalModificadores({
  item,
  abierto,
  onCerrar,
  onAgregar,
  reducedMotion,
}: ModalModificadoresProps) {
  const [seleccion, setSeleccion] = React.useState<SeleccionPorGrupo>(() => seleccionVacia())
  const [notas, setNotas] = React.useState('')

  // Al abrir (o si cambia el item) se arranca de cero: la seleccion es de esta apertura.
  React.useEffect(() => {
    if (abierto) {
      setSeleccion(seleccionVacia())
      setNotas('')
    }
  }, [abierto, item.id])

  const elegidos = elegidosDesde(item.grupos, seleccion)
  const errores = validarModificadores(item.grupos, elegidos)
  const faltantes = gruposObligatoriosFaltantes(item.grupos, seleccion)
  const provisional = armarItemProvisional(item, seleccion, notas, item.grupos)
  const total = precioUnitario(provisional)
  const puedeAgregar = errores.length === 0

  const agregar = () => {
    if (!puedeAgregar) return
    onAgregar(elegidos, recortarNotas(notas))
    onCerrar()
  }

  return (
    <BottomSheet
      abierto={abierto}
      onCerrar={onCerrar}
      titulo={item.nombre}
      altura="completa"
      reducedMotion={reducedMotion}
    >
      <div className="flex max-h-[70vh] flex-col gap-5 overflow-y-auto px-1 pb-2">
        {item.grupos.map((grupo) => {
          const elegidas = seleccion[grupo.id] ?? []
          return (
            <fieldset key={grupo.id} className="flex flex-col gap-1">
              <legend className="mb-1 font-medium">
                {grupo.nombre}
                {grupo.obligatorio ? <span className="text-muted-foreground"> (obligatorio)</span> : null}
              </legend>
              {grupo.descripcion ? (
                <p className="-mt-1 mb-1 text-sm text-muted-foreground">{grupo.descripcion}</p>
              ) : null}

              {grupo.opciones.map((opcion) => {
                const marcada = elegidas.includes(opcion.id)
                const sinStock = opcion.disponible === false
                return (
                  <label
                    key={opcion.id}
                    /* min-h-12 = 48px: el minimo tocable que pide el proyecto. */
                    className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-lg px-2 ${
                      marcada ? 'bg-muted' : ''
                    } ${sinStock ? 'opacity-50' : ''}`}
                  >
                    <input
                      type={grupo.tipo === 'UNICA_SELECCION' ? 'radio' : 'checkbox'}
                      name={grupo.id}
                      checked={marcada}
                      disabled={sinStock}
                      onChange={() => setSeleccion((s) => alternarSeleccion(item.grupos, s, grupo.id, opcion.id))}
                      className="size-5 shrink-0 accent-[var(--color-primary)]"
                    />
                    <span className="flex-1 text-sm">{opcion.nombre}</span>
                    {opcion.precioExtra > 0 ? (
                      <span className="shrink-0 text-sm text-muted-foreground">
                        +{formatearPrecio(opcion.precioExtra)}
                      </span>
                    ) : null}
                  </label>
                )
              })}
            </fieldset>
          )
        })}

        <div className="flex flex-col gap-1">
          <label htmlFor="notas-item" className="font-medium">
            Notas <span className="font-normal text-muted-foreground">(opcional)</span>
          </label>
          <textarea
            id="notas-item"
            value={notas}
            onChange={(e) => setNotas(recortarNotas(e.target.value))}
            maxLength={MAX_NOTAS}
            rows={2}
            placeholder="Sin cebolla, punto jugoso..."
            className="w-full resize-none rounded-lg border bg-background p-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <span className="self-end text-xs text-muted-foreground">
            {notas.length} / {MAX_NOTAS}
          </span>
        </div>
      </div>

      <div className="sticky bottom-0 mt-2 flex flex-col gap-2 border-t bg-background pt-3">
        {faltantes.length > 0 ? (
          <p className="text-sm text-muted-foreground">Te falta elegir: {faltantes.join(', ')}</p>
        ) : null}
        {errores.length > 0 ? <p className="text-sm text-destructive">{errores[0]}</p> : null}
        <Button
          type="button"
          onClick={agregar}
          disabled={!puedeAgregar}
          className="min-h-12 w-full"
          aria-label={`Agregar ${item.nombre} al carrito por ${formatearPrecio(total)}`}
        >
          Agregar al carrito ({formatearPrecio(total)})
        </Button>
      </div>
    </BottomSheet>
  )
}
