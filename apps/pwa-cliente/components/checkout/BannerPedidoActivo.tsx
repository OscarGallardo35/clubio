'use client'

/**
 * Banner discreto para volver al pedido en curso. Se muestra en menu/club cuando el store tiene el
 * linkToken del ultimo pedido (lo deja PEDIDO_OK), asi el que cierra la PWA puede volver sin
 * acordarse de nada.
 */
import Link from 'next/link'
import { useCarritoStore } from '@/stores/carritoStore'

export function BannerPedidoActivo({ slugNegocio }: { slugNegocio: string }) {
  const linkToken = useCarritoStore((s) => s.pedido?.linkToken ?? null)
  if (!linkToken) return null

  return (
    <Link
      href={`/${slugNegocio}/pedido/${linkToken}`}
      className="fixed inset-x-4 z-50 flex min-h-12 items-center justify-between gap-3 rounded-full border bg-card px-4 text-sm shadow-lg"
      style={{ bottom: 'calc(env(safe-area-inset-bottom) + 4rem + 1rem)' }}
    >
      <span>Ver estado de tu pedido</span>
      <span aria-hidden>&rsaquo;</span>
    </Link>
  )
}
