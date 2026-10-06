'use client'

import Link from 'next/link';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Separator, buttonVariants } from '@repo/ui';
import { useEmpleado } from '@/hooks/useEmpleado';

/** Quien soy, donde trabajo, con que plan, y como salir. */
export default function PerfilPage() {
  const { empleado, negocio, sucursal, tipo, logout } = useEmpleado();

  const features = Object.entries(negocio?.features ?? {}).filter(([, v]) => v?.habilitada);

  return (
    <main className="space-y-4 p-4">
      <h1 className="text-xl font-semibold">Mi perfil</h1>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{empleado?.nombre ?? 'Sin sesion'}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Rol</span>
            <Badge variant="secondary">{empleado?.rol ?? '-'}</Badge>
            {tipo === 'DUENO' ? <Badge>Dueno</Badge> : null}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Sucursal activa</span>
            <span>{sucursal?.nombre ?? '-'}</span>
          </div>
          {empleado?.accesoMultiSucursal ? (
            <p className="text-xs text-muted-foreground">
              Tenes acceso a todas las sucursales. Para cambiar de sucursal hay que volver a ingresar
              (el cambio en caliente llega post-MVP).
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Plan del local</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">{negocio?.nombre ?? '-'}</span>
            <Badge variant="outline">{negocio?.plan ?? '-'}</Badge>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {features.length === 0 ? (
              <span className="text-xs text-muted-foreground">Sin features habilitadas.</span>
            ) : (
              features.map(([clave, v]) => (
                <Badge key={clave} variant="outline" className="text-[11px]">
                  {clave}
                  {typeof v?.limite === 'number' ? ` (${v.limite})` : ''}
                </Badge>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Carta</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>Prender/apagar items y cambiar precios. Vive aca y no es una tab.</p>
          <Link href="/carta" className={buttonVariants({ variant: 'outline', className: 'min-h-12 w-full' })}>
            Abrir la carta
          </Link>
        </CardContent>
      </Card>

      <Separator />
      <Button variant="destructive" className="min-h-12 w-full" onClick={() => void logout()}>
        Cerrar sesion
      </Button>
    </main>
  );
}
