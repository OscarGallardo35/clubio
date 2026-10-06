import { BrandingProvider } from '@/components/BrandingProvider'
import { SucursalProvider } from '@/components/SucursalProvider'
import { getNegocio } from '@/lib/api-servidor'
import { EnlaceInvalido } from '@/components/EnlaceInvalido'

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
      <SucursalProvider>{children}</SucursalProvider>
    </BrandingProvider>
  )
}
