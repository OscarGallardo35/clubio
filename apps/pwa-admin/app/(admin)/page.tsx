'use client';

import * as React from 'react';
import { Badge, Progress, Skeleton, toast } from '@repo/ui';
import { estadisticasApi, usoApi, visitasApi } from '@/lib/api';
import { normalizarError } from '@/lib/errores';
import type { DashboardAdmin, UsoRecurso, VisitaPendiente } from '@/types/api';

/**
 * Dashboard.
 *
 * Tres cosas que decide la pantalla y conviene tener claras:
 * 1. Los agregados vienen hechos (`GET /estadisticas/dashboard` usa `groupBy` + un `date_trunc` y
 *    cachea en Redis): aca no se cuenta ni se suma nada.
 * 2. El "hoy" del backend es el dia del SERVIDOR, no el del navegador.
 * 3. El alcance de las solicitudes pendientes lo decide el backend (multi-sucursal o la propia):
 *    la pantalla no lo puede ampliar ni achicar.
 *
 * Sin libreria de charts (decision tomada): KPIs + barras de cuota.
 */
export default function DashboardPage() {
  const [datos, setDatos] = React.useState<DashboardAdmin | null>(null);
  const [uso, setUso] = React.useState<UsoRecurso[] | null>(null);
  const [pendientes, setPendientes] = React.useState<VisitaPendiente[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const refetch = React.useCallback(async () => {
    try {
      // Las tres en paralelo: son endpoints distintos y ninguna depende de la otra.
      const [d, u, p] = await Promise.all([
        estadisticasApi.dashboard(),
        usoApi.usoMensual(),
        visitasApi.pendientes(),
      ]);
      setDatos(d);
      setUso(u.data);
      setPendientes(p.data);
      setError(null);
    } catch (e) {
      const { status, mensaje } = normalizarError(e);
      if (status !== 401) setError(mensaje);
    }
  }, []);

  React.useEffect(() => {
    void refetch();
  }, [refetch]);

  React.useEffect(() => {
    if (error) toast.error('No pudimos traer el dashboard', { description: error });
  }, [error]);

  // Hooks siempre arriba del primer return (React #310; ver TROUBLESHOOTING).
  const k = datos?.kpis;
  const cargando = datos === null && !error;

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            {datos ? `Dia ${datos.fecha}` : 'Cargando...'}
            {datos?.cacheado ? ' · desde cache' : ''}
          </p>
        </div>
        <Badge variant="outline">Hoy</Badge>
      </header>

      {cargando ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      ) : null}

      {k ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <Kpi
            titulo="Visitas de hoy"
            valor={formato(k.visitasHoy)}
            abajo={`Ayer: ${formato(k.visitasAyer)}`}
            variacion={k.variacionVisitas}
          />
          <Kpi
            titulo="Clientes nuevos hoy"
            valor={formato(k.clientesNuevosHoy)}
            abajo={`Ayer: ${formato(k.clientesNuevosAyer)}`}
            variacion={k.variacionClientes}
          />
          <Kpi
            titulo="Sellos otorgados hoy"
            valor={formato(k.sellosOtorgadosHoy)}
            abajo={`Ayer: ${formato(k.sellosOtorgadosAyer)}`}
          />
          <Kpi titulo="Ticket promedio" valor={`$${k.ticketPromedio.toFixed(2)}`} abajo="Sobre las visitas de hoy" />
          <Kpi titulo="Puntos otorgados hoy" valor={formato(k.puntosOtorgadosHoy)} abajo="Programa de puntos" />
          <Kpi
            titulo="Solicitudes pendientes"
            valor={formato(k.solicitudesPendientes)}
            abajo={k.solicitudesPendientes > 0 ? 'Hay gente esperando' : 'Nadie esperando'}
          />
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border bg-card p-5">
          <h2 className="text-lg font-semibold">Por sucursal (hoy)</h2>
          {datos === null ? (
            <Skeleton className="mt-3 h-24 w-full" />
          ) : datos.porSucursal.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">Todavia no hay visitas hoy.</p>
          ) : (
            <ul className="mt-3 divide-y">
              {datos.porSucursal.map((s) => (
                <li key={s.sucursalId} className="flex items-center justify-between gap-3 py-2">
                  <span className="truncate font-medium">{s.nombre}</span>
                  <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                    {formato(s.visitas)} visitas · {formato(s.sellos)} sellos
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-2xl border bg-card p-5">
          <h2 className="text-lg font-semibold">Clientes por etiqueta</h2>
          {datos === null ? (
            <Skeleton className="mt-3 h-24 w-full" />
          ) : (
            <ul className="mt-3 flex flex-wrap gap-2">
              {datos.clientesPorEtiqueta.map((e) => (
                <li key={e.etiqueta}>
                  <Badge variant="outline">
                    {e.etiqueta}: {formato(e.total)}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="rounded-2xl border bg-card p-5">
        <h2 className="text-lg font-semibold">Cuotas del plan</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {uso && uso.length > 0 ? `Periodo ${uso[0]?.periodo ?? ''}` : 'Uso del periodo'}
        </p>
        {uso === null ? (
          <Skeleton className="mt-3 h-32 w-full" />
        ) : uso.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">Sin datos de uso para este periodo.</p>
        ) : (
          <ul className="mt-4 space-y-4">
            {uso.map((r) => (
              <li key={r.id} className="space-y-1.5">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="font-medium">{etiquetaRecurso(r.recurso)}</span>
                  <span className="tabular-nums text-muted-foreground">{textoCuota(r)}</span>
                </div>
                {tieneTope(r) ? (
                  <Progress
                    value={(r.cantidad / r.limiteBase) * 100}
                    className="h-2"
                    // Spread condicional: con `exactOptionalPropertyTypes`, pasar
                    // `indicatorClassName={undefined}` explicitamente no compila.
                    {...(r.excedente > 0 ? { indicatorClassName: 'bg-destructive' } : {})}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-2xl border bg-card p-5">
        <h2 className="text-lg font-semibold">Visitas esperando aprobacion</h2>
        {pendientes === null ? (
          <Skeleton className="mt-3 h-20 w-full" />
        ) : pendientes.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">Nadie esperando: la cola esta vacia.</p>
        ) : (
          <ul className="mt-3 divide-y">
            {pendientes.map((p) => (
              <li key={p.token} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{p.cliente.nombre ?? 'Cliente'}</p>
                  <p className="text-xs text-muted-foreground">
                    {p.cliente.telefonoEnmascarado}
                    {p.sucursal ? ` · ${p.sucursal.nombre}` : ''}
                  </p>
                </div>
                <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                  vence en {minutos(p.segundosRestantes)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Las visitas pendientes se aprueban desde la app del personal: aca solo se ven.
      </p>
    </section>
  );
}

/** Los recursos de `RECURSO_A_FEATURE`, con nombre para mostrar. */
const ETIQUETA_RECURSO: Record<string, string> = {
  CLIENTES: 'Clientes',
  EMPLEADOS: 'Empleados',
  SUCURSALES: 'Sucursales',
  ITEMS_CARTA: 'Items de carta',
  PEDIDOS_MES: 'Pedidos del mes',
  CAMPANAS_PUSH_MES: 'Campanas push del mes',
};

const etiquetaRecurso = (recurso: string) => ETIQUETA_RECURSO[recurso] ?? recurso;

/**
 * El plan PRO tiene recursos "sin tope" que se guardan con un numero enorme (999999) en vez de
 * `null`: mostrar "2 de 999999" seria ruido, no informacion.
 */
const SIN_TOPE = 100_000;
const tieneTope = (r: UsoRecurso) => r.limiteBase < SIN_TOPE;

function textoCuota(r: UsoRecurso): string {
  if (!tieneTope(r)) return `${formato(r.cantidad)} (sin tope)`;
  const base = `${formato(r.cantidad)} de ${formato(r.limiteBase)}`;
  return r.excedente > 0 ? `${base} — excedido por ${formato(r.excedente)}` : base;
}

function minutos(segundos: number): string {
  if (segundos <= 0) return '0 min';
  const m = Math.ceil(segundos / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

const formato = (n: number) => n.toLocaleString('es-AR');

function Kpi({
  titulo,
  valor,
  abajo,
  variacion,
}: {
  titulo: string;
  valor: string;
  abajo: string;
  variacion?: number | null;
}) {
  return (
    <div className="rounded-2xl border bg-card p-5">
      <p className="text-sm text-muted-foreground">{titulo}</p>
      <p className="mt-1 text-3xl font-semibold tabular-nums">{valor}</p>
      <div className="mt-1 flex items-center gap-2">
        <p className="text-xs text-muted-foreground">{abajo}</p>
        {variacion === null || variacion === undefined ? null : (
          <span
            className={
              variacion > 0
                ? 'text-xs font-medium text-emerald-600'
                : variacion < 0
                  ? 'text-xs font-medium text-destructive'
                  : 'text-xs text-muted-foreground'
            }
          >
            {variacion > 0 ? '+' : ''}
            {variacion}%
          </span>
        )}
      </div>
    </div>
  );
}
