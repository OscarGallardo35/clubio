'use client'

import { Button, buttonVariants } from '@repo/ui'
import { cn } from '@repo/ui'
import Link from 'next/link'

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-3xl font-bold">Algo salió mal</h1>
      <p className="text-muted-foreground">No pudimos cargar esta pantalla. Probá de nuevo.</p>
      <div className="flex gap-3">
        <Button onClick={reset}>Reintentar</Button>
        <Link href="/" className={cn(buttonVariants({ variant: 'outline' }))}>
          Ir al inicio
        </Link>
      </div>
    </main>
  )
}
