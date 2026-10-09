import type { Metadata, Viewport } from 'next'
import { BrandingProvider } from '@/components/BrandingProvider'
import { SucursalProvider } from '@/components/SucursalProvider'
import { getNegocio } from '@/lib/api-servidor'
import { iconosDeTenant, manifestDeTenant } from '@/lib/manifest-tenants'
import { COLOR_PRIMARIO_DEFECTO } from '@/lib/constants'
import { EnlaceInvalido } from '@/components/EnlaceInvalido'
import { BottomNav } from '@/components/carta/BottomNav'
import { BannerPedidoActivo } from '@/components/checkout/BannerPedidoActivo'

/**
 * Metadata POR TENANT. El layout raiz declara manifest/iconos genericos de Clubio;
 * aca se pisan con los del local para que al INSTALAR la PWA desde el negocio el
 * nombre, el color y el icono de la pantalla de inicio sean los del local y no "Clubio".
 *
 * `manifest` sale SIEMPRE como `/<slug>/manifest.webmanifest`: asi resuelve igual
 * entrando por path que por subdominio (el middleware no reescribe lo que ya trae el
 * slug; ver `manifestDeTenant`).
 *
 * Si el slug no resuelve (negocio inexistente/inactivo) NO se fuerza el manifest del
 * tenant: se hereda el generico del layout raiz (fallback, nunca 404).
 */
export async function generateMetadata({
  params,
}: {
  params: { tenant: string }
}): Promise<Metadata> {
  const negocio = await getNegocio(params.tenant)
  const iconos = iconosDeTenant(params.tenant)

  if (!negocio) {
    return { icons: { icon: iconos.icon192, apple: iconos.apple } }
  }

  const nombre = negocio.nombre
  return {
    title: `${nombre} — Club`,
    manifest: manifestDeTenant(params.tenant),
    icons: { icon: iconos.icon192, apple: iconos.apple },
    // `capable`/`statusBarStyle` se repiten a proposito: el objeto se REEMPLAZA
    // entero (no se mergea) y no se pueden perder los del layout raiz.
    appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: nombre },
  }
}

/** theme-color del navegador con el color del local (el layout raiz usa el generico). */
export async function generateViewport({
  params,
}: {
  params: { tenant: string }
}): Promise<Viewport> {
  const negocio = await getNegocio(params.tenant)
  return {
    themeColor: negocio?.colorPrimario || COLOR_PRIMARIO_DEFECTO,
    width: 'device-width',
    initialScale: 1,
    viewportFit: 'cover',
  }
}

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
