'use client';

import * as React from 'react';
import { Skeleton } from '@repo/ui';
import { superadminApi } from '@/lib/api';
import { normalizarError } from '@/lib/errores';
import type { ResumenPlataforma } from '@/types/api';

/**
 * Resumen de la plataforma: las metricas basicas que devuelve
 * `GET /api/superadmin/resumen` (locales totales/activos/inactivos/con theme y cuantos
 * por plan). Es el dashboard del shell.
 */
export default function ResumenPage() {
  const [resumen, setResumen] = React.useState<ResumenPlataforma | null>(null);
  const [cargando, setCargando] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let vivo = true;
    void (async () => {
      try {
        const r = await superadminApi.resumen();
        if (vivo) {
          setResumen(r);
          setError(null);
        }
      } catch (e) {
        const { status, mensaje } = normalizarError(e);
        if (vivo && status !== 401) setError(mensaje);
      } finally {
        if (vivo) setCargando(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, []);

  return (
    <div className="flex w-full flex-col gap-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Resumen</h1>
        <p className="text-sm text-muted-foreground">Estado general de la plataforma.</p>
      </header>

      {error ? (
        <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {resumen === null && cargando ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : null}

      {resumen ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="kpis-plataforma">
            <Kpi etiqueta="Locales" valor={resumen.locales.total} />
            <Kpi etiqueta="Activos" valor={resumen.locales.activos} />
            <Kpi etiqueta="Inactivos" valor={resumen.locales.inactivos} />
            <Kpi etiqueta="Con theme" valor={resumen.locales.conTheme} />
          </div>

          <section className="space-y-2">
            <h2 className="text-sm font-medium text-muted-foreground">Locales por plan</h2>
            {resumen.porPlan.length === 0 ? (
              <p className="rounded-xl border bg-card px-4 py-6 text-sm text-muted-foreground">
                Todavia no hay locales.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {resumen.porPlan.map((p) => (
                  <li
                    key={p.plan}
                    className="flex items-center justify-between rounded-xl border bg-card px-4 py-3 text-sm"
                  >
                    <span className="font-medium">{p.plan}</span>
                    <span className="text-muted-foreground">{p.total}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}

function Kpi({ etiqueta, valor }: { etiqueta: string; valor: number }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{etiqueta}</p>
      <p className="mt-1 text-2xl font-semibold">{valor}</p>
    </div>
  );
}
