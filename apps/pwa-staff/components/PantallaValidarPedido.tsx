'use client';

import * as React from 'react';
import { useTenant } from '@/hooks/useTenant';
import { rutaDe } from '@/lib/tenant';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Skeleton, buttonVariants } from '@repo/ui';
import { pedidosApi } from '@/lib/api';
import { normalizarError } from '@/lib/errores';

type Estado = 'cargando' | 'sin-token' | 'no-sirve' | 'vencido' | 'error';

/**
 * Pantalla que abre el STAFF desde el link que le manda el cliente por WhatsApp
 * (`/validar-pedido?ref=TOKEN`).
 *
 * El `linkToken` es la credencial publica del pedido (la misma que usa el cliente para
 * seguir su pedido), asi que el GET publico alcanza para saber DE QUE pedido se trata.
 * Resuelto el id, se entra al detalle real (`/pedidos/[id]`), que es donde viven las
 * acciones del local (confirmar, rechazar, tomar) y donde el estado se refresca por WS.
 *
 * Antes el mensaje apuntaba a `staff.clubio.lat/pedido/<token>` —una ruta que no existe
 * en esta PWA— y el staff comia un "This page could not be found".
 *
 * 410 no es un error generico: el link vencio (4 h) pero el PEDIDO sigue existiendo, asi
 * que se lo manda a la lista de activos en vez de ofrecerle reintentar.
 */
export function PantallaValidarPedido({ tokenRef }: { tokenRef: string }) {
  const tenant = useTenant();

  const router = useRouter();
  const [estado, setEstado] = React.useState<Estado>(tokenRef ? 'cargando' : 'sin-token');
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!tokenRef) return;
    let vivo = true;

    void (async () => {
      try {
        const pedido = await pedidosApi.porLink(tokenRef);
        if (vivo) router.replace(rutaDe(tenant, `/pedidos/${pedido.id}`));
      } catch (e) {
        if (!vivo) return;
        const { status, mensaje } = normalizarError(e);
        setError(mensaje);
        if (status === 404) setEstado('no-sirve');
        else if (status === 410) setEstado('vencido');
        else setEstado('error');
      }
    })();

    return () => {
      vivo = false;
    };
  }, [tokenRef, router, tenant]);

  if (estado === 'cargando') {
    return (
      <main className="space-y-3 p-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-40 w-full" />
      </main>
    );
  }

  if (estado === 'sin-token') {
    return <Aviso titulo="Falta el codigo del pedido" detalle="El link no trae el parametro ?ref=." />;
  }
  if (estado === 'no-sirve') {
    return <Aviso titulo="Este link ya no sirve" detalle={error ?? 'El pedido no existe o es de otro negocio.'} />;
  }
  if (estado === 'vencido') {
    return (
      <Aviso
        titulo="El link del pedido vencio"
        detalle="Pasaron mas de 4 h desde que se creo. El pedido sigue en la lista: abrilo desde ahi."
      />
    );
  }
  return <Aviso titulo="No se pudo abrir el pedido" detalle={error ?? 'Revisa tu conexion e intenta de nuevo.'} />;
}

function Aviso({ titulo, detalle }: { titulo: string; detalle: string }) {
  const tenant = useTenant();
  return (
    <main className="flex flex-col items-center gap-3 p-6 text-center">
      <p className="text-lg font-semibold">{titulo}</p>
      <p className="text-sm text-muted-foreground">{detalle}</p>
      <Link href={rutaDe(tenant, '/pedidos')} className={buttonVariants({ variant: 'outline', className: 'min-h-12' })}>
        Ver pedidos activos
      </Link>
    </main>
  );
}
