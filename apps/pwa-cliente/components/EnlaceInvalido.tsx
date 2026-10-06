import Link from 'next/link'
import { buttonVariants } from '@repo/ui'
import { cn } from '@repo/ui'

/** Se muestra cuando el [tenant] de la URL no existe o el negocio esta inactivo. */
export function EnlaceInvalido({ tenant }: { tenant: string }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-2xl font-bold">Este enlace no es válido</h1>
      <p className="text-muted-foreground">
        No encontramos el local <span className="font-medium">{tenant}</span>. Pedile ayuda al
        personal para escanear el QR correcto.
      </p>
      <Link href="/" className={cn(buttonVariants({ size: 'lg' }))}>
        Volver al inicio
      </Link>
    </main>
  )
}
