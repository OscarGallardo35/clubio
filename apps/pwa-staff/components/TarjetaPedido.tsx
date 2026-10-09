'use client'

import Link from 'next/link';
import { useTenant } from '@/hooks/useTenant';
import { rutaDe } from '@/lib/tenant';
import { Badge, Card, CardContent } from '@repo/ui';
import { AccionesPedido } from '@/components/AccionesPedido';
import {
  COLOR_ESTADO,
  ETIQUETA_ESTADO,
  ETIQUETA_TIPO,
  horaCorta,
} from '@/lib/pedidos-maquina';
import type { PedidoStaff } from '@/types/api';

/**
 * Una fila de la lista de pedidos.
 *
 * El numero y el cliente son un <Link> al detalle; los botones quedan FUERA del
 * link (no se anidan elementos interactivos).
 */
export function TarjetaPedido({
  pedido,
  puedeTomar,
  empleadoId,
  onCambio,
}: {
  pedido: PedidoStaff;
  puedeTomar: boolean;
  empleadoId: string | null;
  onCambio: () => void | Promise<void>;
}) {
  const tenant = useTenant();

  const tomadoPorOtro = Boolean(pedido.empleadoAsignadoId) && pedido.empleadoAsignadoId !== empleadoId;

  return (
    <Card>
      <CardContent className="space-y-3 pt-4">
        <Link href={rutaDe(tenant, `/pedidos/${pedido.id}`)} className="block">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="flex items-center gap-2 font-medium">
                <span>#{pedido.numeroAtendiente ?? '--'}</span>
                <span className="text-xs font-normal text-muted-foreground">
                  {ETIQUETA_TIPO[pedido.tipo]}
                </span>
              </p>
              <p className="truncate text-sm text-muted-foreground">
                {pedido.nombreCliente}
                {pedido.mesa ? ` · mesa ${pedido.mesa}` : ''}
              </p>
              <p className="text-xs text-muted-foreground">
                {horaCorta(pedido.creadoEn)}
                {pedido.sucursal?.nombre ? ` · ${pedido.sucursal.nombre}` : ''}
              </p>
            </div>
            <Badge variant="outline" className={COLOR_ESTADO[pedido.estado]}>
              {ETIQUETA_ESTADO[pedido.estado]}
            </Badge>
          </div>

          <div className="mt-2 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              {Array.isArray(pedido.items) ? `${pedido.items.length} item(s)` : ''}
            </span>
            <span className="font-semibold">${pedido.total.toFixed(2)}</span>
          </div>
        </Link>

        {tomadoPorOtro ? (
          <p className="text-xs text-muted-foreground">
            Tomado por {pedido.empleadoAsignado?.nombre ?? 'otro empleado'}
          </p>
        ) : null}

        <AccionesPedido
          pedido={pedido}
          puedeTomar={puedeTomar}
          empleadoId={empleadoId}
          onCambio={onCambio}
        />
      </CardContent>
    </Card>
  );
}
