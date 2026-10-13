'use client';

import * as React from 'react';
import Link from 'next/link';
import { Badge, Button, Input, Label, Skeleton, buttonVariants } from '@repo/ui';
import { superadminApi } from '@/lib/api';
import { normalizarError } from '@/lib/errores';
import { FabricaDemo } from '@/components/locales/FabricaDemo';
import type { LocalPlataforma } from '@/types/api';

/**
 * "Crear demo": la pantalla destacada del panel.
 *
 * Dos pasos, no mas: elegir el local y provisionarlo. La fabrica (elegir plantilla, ver que
 * va a crear, un boton grande, y al terminar los links para mostrar) vive en `FabricaDemo`,
 * que es la MISMA que usa el boton "Provisionar" de la lista de locales: un solo flujo, dos
 * puertas de entrada.
 *
 * Si el local todavia no existe, el atajo es "Nuevo local" (que a su vez encadena la fabrica).
 */
export default function CrearDemoPage() {
  const [busqueda, setBusqueda] = React.useState('');
  const [termino, setTermino] = React.useState('');
  const [locales, setLocales] = React.useState<LocalPlataforma[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [elegido, setElegido] = React.useState<{ id: string; nombre: string; slug: string } | null>(
    null,
  );

  React.useEffect(() => {
    const t = setTimeout(() => setTermino(busqueda.trim()), 300);
    return () => clearTimeout(t);
  }, [busqueda]);

  const cargar = React.useCallback(async () => {
    try {
      const r = await superadminApi.locales(termino ? { search: termino } : {});
      setLocales(r.data);
      setError(null);
    } catch (e) {
      const { status, mensaje } = normalizarError(e);
      if (status !== 401) setError(mensaje);
    }
  }, [termino]);

  React.useEffect(() => {
    void cargar();
  }, [cargar]);

  return (
    <div className="flex w-full flex-col gap-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Crear demo</h1>
        <p className="text-sm text-muted-foreground">
          Deja un local listo para mostrar: club, carta, personal y un cliente con sellos.
        </p>
      </header>

      {elegido ? (
        <section className="space-y-5 rounded-2xl border bg-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Local elegido</p>
              <p className="truncate font-medium">{elegido.nombre}</p>
              <p className="break-all text-xs text-muted-foreground">/{elegido.slug}</p>
            </div>
            <div className="flex gap-2">
              <Link
                href={`/locales/${encodeURIComponent(elegido.id)}`}
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
              >
                Ver el local
              </Link>
              <Button variant="outline" size="sm" onClick={() => setElegido(null)}>
                Cambiar de local
              </Button>
            </div>
          </div>

          <FabricaDemo
            local={elegido}
            onProvisionado={cargar}
            onListo={cargar}
            etiquetaVolver="Volver"
            onVolver={() => setElegido(null)}
          />
        </section>
      ) : (
        <section className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="w-full max-w-xs space-y-2">
              <Label htmlFor="buscar-local-demo">1. Elegi el local</Label>
              <Input
                id="buscar-local-demo"
                type="search"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Nombre o slug"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <Link href="/locales" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
              + Nuevo local
            </Link>
          </div>

          {error ? (
            <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </p>
          ) : null}

          {locales === null ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : locales.length === 0 ? (
            <p className="rounded-xl border bg-card px-4 py-6 text-sm text-muted-foreground">
              No hay locales que coincidan. Crea uno con <strong>+ Nuevo local</strong>.
            </p>
          ) : (
            <ul className="flex flex-col gap-2" data-testid="lista-locales-demo">
              {locales.map((l) => (
                <li key={l.id}>
                  <button
                    type="button"
                    onClick={() => setElegido({ id: l.id, nombre: l.nombre, slug: l.slug })}
                    className="flex w-full flex-wrap items-center justify-between gap-2 rounded-xl border bg-card p-4 text-left transition-colors hover:bg-accent/50"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{l.nombre}</span>
                      <span className="block truncate text-xs text-muted-foreground">/{l.slug}</span>
                    </span>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline">{l.plan}</Badge>
                      {l.activo ? (
                        <Badge variant="success">activo</Badge>
                      ) : (
                        <Badge variant="secondary">inactivo</Badge>
                      )}
                      {l.tieneTheme ? <Badge variant="outline">theme</Badge> : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
