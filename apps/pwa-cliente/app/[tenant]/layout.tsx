import { BrandingProvider } from '@/components/BrandingProvider'
import { SucursalProvider } from '@/components/SucursalProvider'
import { getNegocio } from '@/lib/api-servidor'
import { EnlaceInvalido } from '@/components/EnlaceInvalido'
import { BottomNav } from '@/components/carta/BottomNav'
import { BannerPedidoActivo } from '@/components/checkout/BannerPedidoActivo'

/**
 * Layout del tenant: es un Server Component ASYNC a proposito.
 *
 * Resuelve el negocio ANTES del primer render y se lo pasa al provider, asi el
 * HTML ya sale con los colores del local y no hay flash de "sin color" cuando el
 * cliente escanea el QR.
 */
export default async function TenantLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: { tenant: string }
}) {
  const negocio = await getNegocio(params.tenant)

  // Slug inexistente o negocio inactivo: mensaje util en vez de un 404 pelado.
  if (!negocio) return <EnlaceInvalido tenant={params.tenant} />

  return (
    <BrandingProvider negocioInicial={negocio} tenant={params.tenant}>
      <SucursalProvider>
        {/* padding-bottom para que el nav fijo no tape el final del contenido */}
        <div className="pb-20">{children}</div>
        {/* Dentro del BrandingProvider: BottomNav usa useBranding para saber si mostrar Carta. */}
        <BottomNav />
        {/* Vuelve al pedido en curso: se muestra solo si el store tiene linkToken. */}
        <BannerPedidoActivo slugNegocio={params.tenant} />
      </SucursalProvider>
    </BrandingProvider>
  )
}
