'use client'

/**
 * Navegacion de categorias de la carta. FILTRA (no hace scroll-spy): en el celular se toca la
 * categoria en vez de scrollear a ciegas.
 *
 * Con una sola categoria o con pocos items no se muestran tabs: una lista plana se lee mejor y
 * evita una barra que no aporta nada. En ese caso devuelve null y el que lo usa muestra todo.
 */
import { Tabs, TabsList, TabsTrigger } from '@repo/ui'

export interface CategoriaDeCarta {
  nombre: string
  /** Cuantos items tiene, para decidir si vale la pena mostrar tabs. */
  cantidad: number
}

export interface CategoriaTabsProps {
  categorias: CategoriaDeCarta[]
  activa: string | null
  onCambiar: (categoria: string) => void
  /** Debajo de esto no se muestran tabs (por defecto 5 items en total). */
  minimoParaTabs?: number
}

export function hayQueMostrarTabs(categorias: CategoriaDeCarta[], minimoParaTabs = 5): boolean {
  if (categorias.length <= 1) return false
  return categorias.reduce((acc, c) => acc + c.cantidad, 0) >= minimoParaTabs
}

export function CategoriaTabs({ categorias, activa, onCambiar, minimoParaTabs }: CategoriaTabsProps) {
  if (!hayQueMostrarTabs(categorias, minimoParaTabs)) return null

  const primera = categorias[0]?.nombre
  const actual = activa && categorias.some((c) => c.nombre === activa) ? activa : primera
  // Sin una categoria valida no hay tabs que mostrar (el tipo ademas lo exige).
  if (!actual) return null

  return (
    <Tabs value={actual} onValueChange={onCambiar}>
      <TabsList aria-label="Categorias de la carta">
        {categorias.map((c) => (
          <TabsTrigger key={c.nombre} value={c.nombre}>
            {c.nombre}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}
