'use client'

import * as React from 'react';
import { Badge, Card, CardContent, Skeleton, Button, toast } from '@repo/ui';
import { AccionesVisita } from '@/components/AccionesVisita';
import { CorregirMontoDialog } from '@/components/CorregirMontoDialog';
import { useVisitasSocket } from '@/hooks/useVisitasSocket';
import { configuracionApi, visitasApi } from '@/lib/api';
import { normalizarError } from '@/lib/errores';
import { formatearRestante, mergearPendiente, sinVencidos } from '@/lib/pendientes';
import type { ConfiguracionEfectivaStaff, VisitaAprobada, VisitaPendiente } from '@/types/api';

/**
 * Cola de visitas pendientes (QR #2).
 *
 * Reparto de responsabilidades, igual que en el resto del proyecto:
 * - `GET /visitas/pendientes` es la FUENTE DE VERDAD (sobrevive a un F5, que es
 *   justo lo que el WS solo no puede dar).
 * - El WS `visita:solicitada` ADELANTA el aviso: al llegar se pide `validar/:token`
 *   (el evento no trae los datos del cliente) y se prepende de forma idempotente.
 * - Al (re)conectar el socket se refetchea: recupera lo que paso mientras estabamos
 *   desconectados (heartbeat).
 * - Sin WS vivo, se sondea cada 30s.
 * - Los items vencidos salen de la vista por el tick local, no esperando al refetch.
 */
const SONDEO_MS = 30_000;

export default function VisitasPage() {
  const { enVivo, ultimaSolicitada, conexiones } = useVisitasSocket();
  const [lista, setLista] = React.useState<VisitaPendiente[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [cargadoEn, setCargadoEn] = React.useState(() => Date.now());
  const [tick, setTick] = React.useState(0);
  const [config, setConfig] = React.useState<ConfiguracionEfectivaStaff | null>(null);
  // Fase 3b: lo que YO aprobe hoy (con monto y puntos), para poder corregir el consumo.
  const [aprobadas, setAprobadas] = React.useState<VisitaAprobada[] | null>(null);
  const [aCorregir, setACorregir] = React.useState<VisitaAprobada | null>(null);

  // La config del club decide si la fila pide el monto del consumo y como se calcula el preview.
  // Se pide UNA vez por pantalla (no por fila). Si falla, la fila degrada a "solo sello": es mejor
  // aprobar sin monto que no poder aprobar.
  React.useEffect(() => {
    let vivo = true;
    void (async () => {
      try {
        const c = await configuracionApi.efectiva();
        if (vivo) setConfig(c);
      } catch {
        // sin config se aprueba igual (1 sello)
      }
    })();
    return () => {
      vivo = false;
    };
  }, []);

  const refetch = React.useCallback(async () => {
    try {
      const r = await visitasApi.pendientes();
      setLista(r.data);
      setCargadoEn(Date.now());
      setError(null);
    } catch (e) {
      const { status, mensaje } = normalizarError(e);
      // 401 = sin sesion: lo maneja useEmpleado (no es un error de la lista).
      if (status !== 401) setError(mensaje);
    }
  }, []);

  // Fuente de verdad al montar.
  React.useEffect(() => {
    void refetch();
  }, [refetch]);

  /**
   * "Aprobadas hoy" (`GET /visitas/mis-aprobaciones`): NO es la cola de pendientes, son las visitas
   * que ESE empleado ya aprobo hoy. Se pide aparte para que un fallo suyo no rompa la cola.
   */
  const refetchAprobadas = React.useCallback(async () => {
    try {
      const r = await visitasApi.misAprobaciones();
      setAprobadas(r.data);
    } catch (e) {
      const { status } = normalizarError(e);
      if (status !== 401) setAprobadas([]);
    }
  }, []);

  React.useEffect(() => {
    void refetchAprobadas();
  }, [refetchAprobadas]);

  // Heartbeat: al conectar (y al RECONECTAR) se recupera lo perdido.
  React.useEffect(() => {
    if (conexiones > 0) void refetch();
  }, [conexiones, refetch]);

  // Sondeo de respaldo SOLO si el WS no esta vivo (con WS, el evento alcanza).
  React.useEffect(() => {
    if (enVivo) return undefined;
    const id = setInterval(() => void refetch(), SONDEO_MS);
    return () => clearInterval(id);
  }, [enVivo, refetch]);

  // Adelanto por WS: se completa con validar/:token (el evento no trae cliente).
  React.useEffect(() => {
    if (!ultimaSolicitada) return;
    const { token } = ultimaSolicitada;
    let vivo = true;
    void (async () => {
      try {
        const v = await visitasApi.validar(token);
        if (!vivo || v.estado !== 'VALIDO') return;
        const item: VisitaPendiente = {
          token: v.token,
          expiraEn: v.expiraEn,
          segundosRestantes: Math.max(0, Math.round((new Date(v.expiraEn).getTime() - Date.now()) / 1000)),
          cliente: {
            id: v.cliente.id,
            nombre: v.cliente.nombre,
            telefonoEnmascarado: v.cliente.telefono,
          },
          sucursal: v.sucursal,
        };
        setLista((actual) => mergearPendiente(actual ?? [], item));
        setCargadoEn(Date.now());
      } catch {
        // Si el token ya no sirve (aprobado/vencido en otro dispositivo), el
        // proximo refetch lo saca: no se rompe la pantalla por esto.
        void refetch();
      }
    })();
    return () => {
      vivo = false;
    };
  }, [ultimaSolicitada, refetch]);

  // Tick local: cuenta regresiva y limpieza de vencidos sin depender del server.
  React.useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const transcurrido = Math.max(0, (Date.now() - cargadoEn) / 1000);
  const visibles = React.useMemo(
    () => sinVencidos(lista ?? [], transcurrido),
    [lista, transcurrido, tick],
  );

  React.useEffect(() => {
    if (error) toast.error('No pudimos actualizar la lista', { description: error });
  }, [error]);

  if (lista === null && !error) {
    return (
      <main className="space-y-3 p-4">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
      </main>
    );
  }

  if (error && lista === null) {
    return (
      <main className="flex flex-col items-center gap-3 p-6 text-center">
        <p className="font-medium">No pudimos traer las visitas</p>
        <p className="text-sm text-muted-foreground">{error}</p>
        <Button className="min-h-12" onClick={() => void refetch()}>
          Reintentar
        </Button>
      </main>
    );
  }

  return (
    <main className="space-y-3 p-4">
      <header className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Visitas pendientes</h1>
        <Badge variant={enVivo ? 'secondary' : 'outline'} className="text-[11px]">
          {enVivo ? 'En vivo' : 'Reconectando'}
        </Badge>
      </header>

      {visibles.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <p className="font-medium">Todo al dia</p>
          <p className="text-sm text-muted-foreground">
            No hay pedidos de visita esperando. Aparecen aca solos.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {visibles.map((p) => (
            <li key={p.token}>
              <TarjetaPendiente
                pendiente={p}
                transcurrido={transcurrido}
                config={config}
                onResuelta={() => {
                  setLista((actual) => (actual ?? []).filter((x) => x.token !== p.token));
                  // Una aprobacion recien hecha tiene que aparecer en "Aprobadas hoy".
                  void refetchAprobadas();
                }}
              />
            </li>
          ))}
        </ul>
      )}

      <section className="space-y-3 pt-2">
        <h2 className="text-base font-semibold">Aprobadas hoy</h2>
        {aprobadas === null ? (
          <Skeleton className="h-16 w-full" />
        ) : aprobadas.length === 0 ? (
          <p className="text-sm text-muted-foreground">Todavia no aprobaste visitas hoy.</p>
        ) : (
          <ul className="space-y-2">
            {aprobadas.map((v) => (
              <li key={v.id}>
                <Card>
                  <CardContent className="flex items-center justify-between gap-3 pt-4">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{v.cliente?.nombre ?? 'Cliente'}</p>
                      <p className="text-xs text-muted-foreground">
                        {v.montoConsumido === null
                          ? 'Sin monto'
                          : `$${v.montoConsumido.toLocaleString('es-AR')}`}{' '}
                        · {v.puntosOtorgados} puntos · +{v.sellosOtorgados} sello
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      className="min-h-10 shrink-0"
                      onClick={() => setACorregir(v)}
                    >
                      Corregir monto
                    </Button>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <CorregirMontoDialog
        visita={aCorregir}
        abierto={aCorregir !== null}
        onCerrar={() => setACorregir(null)}
        onCorregido={() => void refetchAprobadas()}
      />
    </main>
  );
}

function TarjetaPendiente({
  pendiente,
  transcurrido,
  config,
  onResuelta,
}: {
  pendiente: VisitaPendiente;
  transcurrido: number;
  config: ConfiguracionEfectivaStaff | null;
  onResuelta: () => void;
}) {
  const restante = Math.max(0, Math.floor(pendiente.segundosRestantes - transcurrido));
  const porVencer = restante <= 60;

  return (
    <Card>
      <CardContent className="space-y-3 pt-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-medium">{pendiente.cliente.nombre}</p>
            <p className="text-sm text-muted-foreground">{pendiente.cliente.telefonoEnmascarado}</p>
          </div>
          <Badge variant={porVencer ? 'destructive' : 'outline'} className="text-[11px]">
            {formatearRestante(restante)}
          </Badge>
        </div>

        <p className="text-xs text-muted-foreground">
          {pendiente.sucursal?.nombre ?? 'Sin sucursal'} · pedido hace un momento
        </p>

        <AccionesVisita
          token={pendiente.token}
          config={config}
          onAprobada={onResuelta}
          onRechazada={onResuelta}
        />
      </CardContent>
    </Card>
  );
}
