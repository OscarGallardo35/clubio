import Link from 'next/link'
import { buttonVariants, cn } from '@repo/ui'

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-3xl font-bold">No encontramos esta página</h1>
      <p className="text-muted-foreground">Revisá el enlace o escaneá de nuevo el QR del local.</p>
      <Link href="/" className={cn(buttonVariants({ size: 'lg' }))}>
        Ir al inicio
      </Link>
    </main>
  )
}
