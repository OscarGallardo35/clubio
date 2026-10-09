'use client'

import * as React from 'react';
import { Badge, Button, Skeleton, Tabs, TabsList, TabsTrigger, toast } from '@repo/ui';
import { TarjetaPedido } from '@/components/TarjetaPedido';
import { useEmpleado } from '@/hooks/useEmpleado';
import { usePedidosSocket } from '@/hooks/usePedidosSocket';
import { pedidosApi } from '@/lib/api';
import { normalizarError } from '@/lib/errores';
import { ETIQUETA_ESTADO } from '@/lib/pedidos-maquina';
import type { EstadoPedido, PedidoStaff } from '@/types/api';

/** '' = los activos (el backend filtra por ESTADOS_ACTIVOS cuando no se le pasa estado). */
const FILTROS: { valor: '' | EstadoPedido; etiqueta: string }[] = [
  { valor: '', etiqueta: 'Activos' },
  { valor: 'PENDIENTE', etiqueta: 'Pendientes' },
  { valor: 'CONFIRMADO', etiqueta: 'Confirmados' },
  { valor: 'EN_PREPARACION', etiqueta: 'Preparando' },
  { valor: 'LISTO', etiqueta: 'Listos' },
  { valor: 'ENVIADO', etiqueta: 'Enviados' },
];

const SONDEO_MS = 30_000;

/**
 * Lista de pedidos activos (QR #1).
 *
 * Mismo reparto que en visitas: el endpoint es la fuente de verdad y el WS solo
 * dispara un refetch (el payload del evento no trae el pedido entero, y mergear
 * payloads parciales es una fuente de bugs). Al (re)conectar se refetchea y, sin
 * WS vivo, se sondea cada 30s.
 */
export default function PedidosPage() {
  const { empleado, negocio } = useEmpleado();
  const { enVivo, cambios, conexiones } = usePedidosSocket();
  const [filtro, setFiltro] = React.useState<'' | EstadoPedido>('');
  const [lista, setLista] = React.useState<PedidoStaff[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const refetch = React.useCallback(async () => {
    try {
      const r = await pedidosApi.listar(filtro ? { estado: filtro } : {});
      setLista(r.data);
      setError(null);
    } catch (e) {
      const { status, mensaje } = normalizarError(e);
      if (status !== 401) setError(mensaje);
    }
  }, [filtro]);

  React.useEffect(() => {
    setLista(null);
    void refetch();
  }, [refetch]);

  React.useEffect(() => {
    if (cambios > 0 || conexiones > 0) void refetch();
  }, [cambios, conexiones, refetch]);

  React.useEffect(() => {
    if (enVivo) return undefined;
    const id = setInterval(() => void refetch(), SONDEO_MS);
    return () => clearInterval(id);
  }, [enVivo, refetch]);

  React.useEffect(() => {
    if (error) toast.error('No pudimos actualizar los pedidos', { description: error });
  }, [error]);

  // Gating por plan: el endpoint de ESTADO esta detras de @RequiereFeature('pedidos'),
  // asi que sin la feature la pantalla no sirve para nada: se dice y listo.
  const features = (negocio?.features ?? {}) as Record<string, { habilitada?: boolean } | undefined>;
  if (negocio && features.pedidos?.habilitada !== true) {
    return (
      <main className="flex flex-col items-center gap-2 p-6 text-center">
        <p className="font-medium">Tu plan no incluye pedidos digitales</p>
        <p className="text-sm text-muted-foreground">
          Pedile al dueno que active el modulo de pedidos para verlos aca.
        </p>
      </main>
    );
  }

  // Modo de asignacion: `tomar` da 400 si no es BROADCAST.
  const configuracion = (negocio?.configuracion ?? {}) as { modoAsignacionPedidos?: string };
  const puedeTomar = configuracion.modoAsignacionPedidos === 'BROADCAST';

  return (
    <main className="space-y-3 p-4">
      <header className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Pedidos</h1>
        <Badge variant={enVivo ? 'secondary' : 'outline'} className="text-[11px]">
          {enVivo ? 'En vivo' : 'Reconectando'}
        </Badge>
      </header>

      <Tabs value={filtro} onValueChange={(v) => setFiltro(v as '' | EstadoPedido)}>
        <TabsList className="flex w-max gap-1 overflow-x-auto">
          {FILTROS.map((f) => (
            <TabsTrigger key={f.valor || 'activos'} value={f.valor}>
              {f.etiqueta}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {lista === null && !error ? (
        <div className="space-y-3">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : error && lista === null ? (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <p className="font-medium">No pudimos traer los pedidos</p>
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button className="min-h-12" onClick={() => void refetch()}>
            Reintentar
          </Button>
        </div>
      ) : (lista ?? []).length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <p className="font-medium">
            {filtro ? `Sin pedidos en ${ETIQUETA_ESTADO[filtro].toLowerCase()}` : 'No hay pedidos activos'}
          </p>
          <p className="text-sm text-muted-foreground">Los pedidos nuevos aparecen aca solos.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {(lista ?? []).map((p) => (
            <li key={p.id}>
              <TarjetaPedido
                pedido={p}
                puedeTomar={puedeTomar}
                empleadoId={empleado?.id ?? null}
                onCambio={() => void refetch()}
              />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
