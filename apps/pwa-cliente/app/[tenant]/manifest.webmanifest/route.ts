import { NextResponse } from 'next/server'
import { getNegocio } from '@/lib/api-servidor'
import { manifestDeNegocio } from '@/lib/manifest-tenants'

/**
 * Manifest Web App POR TENANT: `GET /<slug>/manifest.webmanifest`.
 *
 * Devuelve el manifest del negocio de ESE slug (nombre, colores del local e iconos
 * del local). Si el slug no existe o no se puede resolver, NO devuelve 404: cae al
 * generico de Clubio, porque el navegador pide el manifest SIEMPRE y un 404 lo deja
 * sin app instalable.
 *
 * Se revalida junto con `getNegocio` (30s): el branding cambia poco.
 */
export const revalidate = 30

export async function GET(
  _request: Request,
  { params }: { params: { tenant: string } },
): Promise<NextResponse> {
  const negocio = await getNegocio(params.tenant)
  const manifest = manifestDeNegocio(params.tenant, negocio)

  return new NextResponse(JSON.stringify(manifest), {
    status: 200,
    headers: {
      'Content-Type': 'application/manifest+json; charset=utf-8',
      'Cache-Control': 'public, max-age=0, s-maxage=30, stale-while-revalidate=300',
    },
  })
}
