'use client'

import * as React from 'react';
import Link from 'next/link';
import { Badge, Card, CardContent, CardHeader, CardTitle, Skeleton, buttonVariants } from '@repo/ui';
import { AccionesVisita } from '@/components/AccionesVisita';
import { visitasApi } from '@/lib/api';
import { normalizarError } from '@/lib/errores';
import type { VisitaValidable } from '@/types/api';

type Estado = 'cargando' | 'ok' | 'sin-token' | 'no-sirve' | 'otra-sucursal' | 'error' | 'hecho';

/**
 * Pantalla de validacion por token (el link del WhatsApp).
 *
 * Los estados del TOKEN se muestran tal como los devuelve el backend
 * (VALIDO/USADO/EXPIRADO) y no se inventa un estado nuevo por cada error HTTP:
 * 404 y 403 son cosas distintas y se dicen distinto.
 */
export function PantallaValidar({ tokenRef }: { tokenRef: string }) {
  const [estado, setEstado] = React.useState<Estado>(tokenRef ? 'cargando' : 'sin-token');
  const [visita, setVisita] = React.useState<VisitaValidable | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [resultado, setResultado] = React.useState<'aprobada' | 'rechazada' | null>(null);

  const cargar = React.useCallback(async () => {
    if (!tokenRef) return;
    setEstado('cargando');
    try {
      const r = await visitasApi.validar(tokenRef);
      setVisita(r);
      setEstado(r.estado === 'VALIDO' ? 'ok' : 'hecho');
    } catch (e) {
      const { status, mensaje } = normalizarError(e);
      setError(mensaje);
      if (status === 404) setEstado('no-sirve');
      else if (status === 403) setEstado('otra-sucursal');
      else setEstado('error');
    }
  }, [tokenRef]);

  React.useEffect(() => {
    void cargar();
  }, [cargar]);

  if (estado === 'cargando') {
    return (
      <main className="space-y-4 p-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-40 w-full" />
      </main>
    );
  }

  if (estado === 'sin-token') return <Aviso titulo="Falta el token" detalle="El link no trae el parametro ?ref=." />;
  if (estado === 'no-sirve') return <Aviso titulo="Este link ya no sirve" detalle={error ?? 'La solicitud no existe o fue eliminada.'} />;
  if (estado === 'otra-sucursal') return <Aviso titulo="Es de otra sucursal" detalle={error ?? 'Esta visita pertenece a una sucursal que no es la tuya.'} />;
  if (estado === 'error') {
    return (
      <main className="flex flex-col items-center gap-3 p-6 text-center">
        <p className="font-medium">No pudimos leer la solicitud</p>
        <p className="text-sm text-muted-foreground">{error}</p>
        <button type="button" className={buttonVariants({ className: 'min-h-12' })} onClick={() => void cargar()}>
          Reintentar
        </button>
      </main>
    );
  }

  if (resultado) {
    return (
      <main className="flex flex-col items-center gap-4 p-6 text-center">
        <p className="text-lg font-semibold">
          {resultado === 'aprobada' ? 'Visita aprobada' : 'Visita rechazada'}
        </p>
        <p className="text-sm text-muted-foreground">
          {resultado === 'aprobada'
            ? 'El cliente ya ve el sello en su tarjeta.'
            : 'El cliente va a ver el motivo que escribiste.'}
        </p>
        <Link href="/visitas" className={buttonVariants({ className: 'min-h-12' })}>
          Ir a visitas
        </Link>
      </main>
    );
  }

  // Token ya usado o vencido (el backend lo dice con `estado`).
  if (estado === 'hecho') {
    const expirado = visita?.estado === 'EXPIRADO';
    return (
      <main className="space-y-4 p-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              {expirado ? 'La solicitud expiro' : 'Esta solicitud ya fue usada'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm text-muted-foreground">
            <p>Cliente: {visita?.cliente.nombre ?? '-'}</p>
            <p>
              {expirado
                ? 'Los pedidos de visita duran 5 minutos: pedile al cliente que genere uno nuevo.'
                : 'Ya se aprobo o rechazo desde otro dispositivo.'}
            </p>
          </CardContent>
        </Card>
        <Link href="/visitas" className={buttonVariants({ variant: 'outline', className: 'min-h-12 w-full' })}>
          Ir a visitas
        </Link>
      </main>
    );
  }

  const minutosRestantes = visita ? Math.max(0, Math.round((new Date(visita.expiraEn).getTime() - Date.now()) / 60000)) : 0;

  return (
    <main className="space-y-4 p-4">
      <h1 className="text-xl font-semibold">Validar visita</h1>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{visita?.cliente.nombre ?? 'Cliente'}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="text-muted-foreground">{visita?.cliente.telefono}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{visita?.cliente.sellosActuales ?? 0} sellos</Badge>
            <Badge variant="outline">{visita?.cliente.totalVisitas ?? 0} visitas</Badge>
            {visita?.cliente.etiqueta ? <Badge variant="outline">{visita.cliente.etiqueta}</Badge> : null}
          </div>
          <p className="text-xs text-muted-foreground">
            Sucursal {visita?.sucursal?.nombre ?? '-'} · el pedido vence en {minutosRestantes} min
          </p>
        </CardContent>
      </Card>

      <AccionesVisita
        token={tokenRef}
        onAprobada={() => setResultado('aprobada')}
        onRechazada={() => setResultado('rechazada')}
      />
    </main>
  );
}

function Aviso({ titulo, detalle }: { titulo: string; detalle: string }) {
  return (
    <main className="flex flex-col items-center gap-3 p-6 text-center">
      <p className="text-lg font-semibold">{titulo}</p>
      <p className="text-sm text-muted-foreground">{detalle}</p>
      <Link href="/visitas" className={buttonVariants({ variant: 'outline', className: 'min-h-12' })}>
        Ir a visitas
      </Link>
    </main>
  );
}
