'use client'

import * as React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  Badge, Button, Card, CardContent, CardHeader, CardTitle, Separator, Skeleton, buttonVariants, toast,
} from '@repo/ui';
import { AccionesPedido } from '@/components/AccionesPedido';
import { ItemsPedido, TotalesPedido } from '@/components/ItemsPedido';
import { TimelinePedido } from '@/components/TimelinePedido';
import { useEmpleado } from '@/hooks/useEmpleado';
import { usePedido } from '@/hooks/usePedido';
import {
  COLOR_ESTADO,
  ETIQUETA_ESTADO,
  ETIQUETA_PAGO,
  ETIQUETA_TIPO,
  hitosDelPedido,
  urlWhatsAppCliente,
} from '@/lib/pedidos-maquina';

/**
 * Detalle del pedido.
 *
 * Client component con `useParams` + `usePedido(id)`, igual que el seguimiento de la
 * PWA Cliente: el id sale de la URL y el estado del fetch, no de un store.
 */
export default function PedidoDetallePage() {
  const params = useParams<{ id?: string }>();
  const id = params?.id ?? '';
  const { empleado, negocio } = useEmpleado();
  const { pedido, estado, error, refetch } = usePedido(id);

  const configuracion = (negocio?.configuracion ?? {}) as { modoAsignacionPedidos?: string };
  const puedeTomar = configuracion.modoAsignacionPedidos === 'BROADCAST';

  React.useEffect(() => {
    if (error && estado === 'ok') toast.error(error);
  }, [error, estado]);

  if (estado === 'cargando') {
    return (
      <main className="space-y-3 p-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-24 w-full" />
      </main>
    );
  }

  if (estado === 'no-encontrado' || !pedido) {
    return (
      <main className="flex flex-col items-center gap-3 p-6 text-center">
        <p className="text-lg font-semibold">Ese pedido no esta disponible</p>
        <p className="text-sm text-muted-foreground">
          {error ?? 'Puede que sea de otra sucursal o que ya no exista.'}
        </p>
        <Link href="/pedidos" className={buttonVariants({ variant: 'outline', className: 'min-h-12' })}>
          Volver a la lista
        </Link>
      </main>
    );
  }

  if (estado === 'error') {
    return (
      <main className="flex flex-col items-center gap-3 p-6 text-center">
        <p className="font-medium">No pudimos traer el pedido</p>
        <p className="text-sm text-muted-foreground">{error}</p>
        <Button className="min-h-12" onClick={() => void refetch()}>
          Reintentar
        </Button>
      </main>
    );
  }

  const hitos = hitosDelPedido(pedido);
  // Lo manda el backend solo si el link del pedido sigue vivo (si no, `undefined`).
  const mensajeWa = pedido.mensajeWhatsApp;
  const linkWa = urlWhatsAppCliente(pedido.telefono, mensajeWa);
  const cancelado = pedido.estado === 'CANCELADO' || pedido.estado === 'RECHAZADO';

  return (
    <main className="space-y-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <Link href="/pedidos" className="text-sm text-muted-foreground underline">
          Volver a la lista
        </Link>
        <Badge variant="outline" className={COLOR_ESTADO[pedido.estado]}>
          {ETIQUETA_ESTADO[pedido.estado]}
        </Badge>
      </div>

      <header className="space-y-1">
        <h1 className="text-xl font-semibold">#{pedido.numeroAtendiente ?? '--'}</h1>
        <p className="text-sm text-muted-foreground">
          {ETIQUETA_TIPO[pedido.tipo]}
          {pedido.sucursal?.nombre ? ` · ${pedido.sucursal.nombre}` : ''}
        </p>
      </header>

      {cancelado ? (
        <div role="status" className="rounded-xl border border-red-300 bg-red-50 px-4 py-3">
          <p className="text-sm font-medium text-red-900">
            {pedido.estado === 'RECHAZADO' ? 'Pedido rechazado' : 'Pedido cancelado'}
          </p>
          <p className="text-sm text-red-800">
            {pedido.motivoRechazo ?? 'Sin motivo registrado.'}
          </p>
        </div>
      ) : null}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Estado</CardTitle>
        </CardHeader>
        <CardContent>
          <TimelinePedido hitos={hitos} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Cliente</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="font-medium">{pedido.nombreCliente}</p>
          <p className="text-muted-foreground">{pedido.telefono}</p>
          {pedido.direccion ? (
            <p className="text-muted-foreground">Direccion: {pedido.direccion}</p>
          ) : null}
          {pedido.mesa ? <p className="text-muted-foreground">Mesa {pedido.mesa}</p> : null}
          <p className="text-muted-foreground">Pago: {ETIQUETA_PAGO[pedido.modoPago]}</p>

          {linkWa ? (
            <a href={linkWa} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: 'outline', className: 'min-h-12 w-full' })}>
              Abrir WhatsApp al cliente
            </a>
          ) : null}
          {linkWa && !mensajeWa ? (
            <p className="text-xs text-muted-foreground">
              Sin mensaje pre-armado: el backend no lo manda en el detalle, asi que el chat abre vacio.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Items</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <ItemsPedido items={pedido.items} />
          <Separator />
          <TotalesPedido subtotal={pedido.subtotal} costoEnvio={pedido.costoEnvio} total={pedido.total} />
        </CardContent>
      </Card>

      {pedido.notas ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Notas del pedido</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">&quot;{pedido.notas}&quot;</p>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Acciones</CardTitle>
        </CardHeader>
        <CardContent>
          <AccionesPedido
            pedido={pedido}
            puedeTomar={puedeTomar}
            empleadoId={empleado?.id ?? null}
            onCambio={refetch}
          />
        </CardContent>
      </Card>
    </main>
  );
}
