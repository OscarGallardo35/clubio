'use client';

import * as React from 'react';
import { Input, Label, Skeleton } from '@repo/ui';
import { superadminApi } from '@/lib/api';
import { normalizarError } from '@/lib/errores';
import type { LocalPlataforma } from '@/types/api';

/**
 * Listado de locales de la plataforma (READ-ONLY en esta fase).
 *
 * Es la pantalla que prueba que el cableado y la sesion funcionan: si se ven los
 * locales REALES (que-lomitos, bar-la-esquina), la cookie host-only, el guard y el
 * endpoint de scope global estan bien. La escritura (crear el demo con nombre, colores,
 * carta, empleados y dueno) es la fase siguiente.
 *
 * El buscador pega al backend (`?search=`), no filtra en memoria: la plataforma puede
 * tener cientos de locales. Va con debounce de 300ms para no disparar una request por
 * tecla.
 */
export default function LocalesPage() {
  const [busqueda, setBusqueda] = React.useState('');
  const [termino, setTermino] = React.useState('');
  const [locales, setLocales] = React.useState<LocalPlataforma[] | null>(null);
  const [total, setTotal] = React.useState(0);
  const [cargando, setCargando] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  // Debounce del buscador.
  React.useEffect(() => {
    const t = setTimeout(() => setTermino(busqueda.trim()), 300);
    return () => clearTimeout(t);
  }, [busqueda]);

  const cargar = React.useCallback(async () => {
    setCargando(true);
    try {
      const r = await superadminApi.locales(termino ? { search: termino } : {});
      setLocales(r.data);
      setTotal(r.total);
      setError(null);
    } catch (e) {
      const { status, mensaje } = normalizarError(e);
      // El 401 lo maneja el layout (useSuperAdmin manda al login): aca no se pisa.
      if (status !== 401) setError(mensaje);
    } finally {
      setCargando(false);
    }
  }, [termino]);

  React.useEffect(() => {
    void cargar();
  }, [cargar]);

  const filtrando = termino.length > 0;

  return (
    <div className="flex w-full flex-col gap-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Locales</h1>
        <p className="text-sm text-muted-foreground">
          Todos los locales de la plataforma (sin filtro de tenant).
        </p>
      </header>

      <div className="w-full max-w-md space-y-2">
        <Label htmlFor="busqueda">Buscar</Label>
        <Input
          id="busqueda"
          name="busqueda"
          type="search"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Nombre o slug (ej: lomitos)"
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      {error ? (
        <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {locales === null && cargando ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : null}

      {locales !== null ? (
        <>
          <p className="text-sm text-muted-foreground" data-testid="conteo-locales">
            {total} {total === 1 ? 'local' : 'locales'}
            {filtrando ? ` para "${termino}"` : ''}
          </p>

          {locales.length === 0 ? (
            <p className="rounded-xl border bg-card px-4 py-6 text-sm text-muted-foreground">
              No hay locales que coincidan.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {locales.map((l) => (
                <li key={l.id} className="rounded-xl border bg-card p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{l.nombre}</p>
                      <p className="truncate text-xs text-muted-foreground">/{l.slug}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="rounded-full border px-2 py-0.5 text-xs font-medium">
                        {l.plan}
                      </span>
                      <span
                        className={
                          l.activo
                            ? 'rounded-full border border-emerald-600/40 px-2 py-0.5 text-xs text-emerald-700'
                            : 'rounded-full border px-2 py-0.5 text-xs text-muted-foreground'
                        }
                      >
                        {l.activo ? 'activo' : 'inactivo'}
                      </span>
                      {l.tieneTheme ? (
                        <span className="rounded-full border px-2 py-0.5 text-xs">theme</span>
                      ) : null}
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>{l.sucursales} sucursales</span>
                    <span>{l.empleados} empleados</span>
                    <span>{l.clientes} clientes</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}
    </div>
  );
}
