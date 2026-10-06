import Link from 'next/link'
import { Badge, buttonVariants } from '@repo/ui'
import { cn } from '@repo/ui'

/**
 * Marcador de posicion del esqueleto: deja claro QUE va en cada ruta sin fingir
 * que ya esta implementado.
 */
export function Placeholder({ titulo, detalle }: { titulo: string; detalle: string }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-6">
      <Badge variant="secondary" className="w-fit">
        esqueleto
      </Badge>
      <h1 className="text-3xl font-bold">{titulo}</h1>
      <p className="text-muted-foreground">{detalle}</p>
      <Link href="/" className={cn(buttonVariants({ variant: 'outline' }), 'w-fit')}>
        Volver
      </Link>
    </main>
  )
}
