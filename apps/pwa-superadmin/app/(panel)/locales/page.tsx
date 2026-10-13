'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  buttonVariants,
  toast,
} from '@repo/ui';
import { superadminApi } from '@/lib/api';
import { normalizarError } from '@/lib/errores';
import { FormularioLocal } from '@/components/locales/FormularioLocal';
import { FabricaDemo } from '@/components/locales/FabricaDemo';
import { PLANES } from '@/types/api';
import type { LocalPlataforma, PlanLocal } from '@/types/api';

/** Un local con lo minimo para la fabrica (sirve para el recien creado y para una fila). */
interface LocalParaProvisionar {
  id: string;
  nombre: string;
  slug: string;
}

/**
 * Locales de la plataforma: listado + alta + las acciones de cada fila.
 *
 * El buscador y los filtros pegan al backend (`?search=&plan=&activo=`), no filtran en
 * memoria: la plataforma puede tener cientos de locales. Va con debounce de 300ms para no
 * disparar una request por tecla.
 *
 * La cadena IMPORTANTE es "Nuevo local" -> "Crear demo": al crear, el backend devuelve el
 * local real y el wizard encadena la fabrica con ese id. Es el camino que el operador hace
 * para vender: crear el local y dejarlo listo sin buscar nada en la lista.
 */
export default function LocalesPage() {
  const [busqueda, setBusqueda] = React.useState('');
  const [termino, setTermino] = React.useState('');
  const [plan, setPlan] = React.useState<'todos' | PlanLocal>('todos');
  const [activo, setActivo] = React.useState<'todos' | 'true' | 'false'>('todos');

  const [locales, setLocales] = React.useState<LocalPlataforma[] | null>(null);
  const [total, setTotal] = React.useState(0);
  const [cargando, setCargando] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const [creando, setCreando] = React.useState(false);
  const [editando, setEditando] = React.useState<LocalPlataforma | null>(null);
  const [fabricando, setFabricando] = React.useState<LocalParaProvisionar | null>(null);

  // Debounce del buscador.
  React.useEffect(() => {
    const t = setTimeout(() => setTermino(busqueda.trim()), 300);
    return () => clearTimeout(t);
  }, [busqueda]);

  const cargar = React.useCallback(async () => {
    setCargando(true);
    try {
      const r = await superadminApi.locales({
        ...(termino ? { search: termino } : {}),
        ...(plan !== 'todos' ? { plan } : {}),
        ...(activo !== 'todos' ? { activo } : {}),
      });
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
  }, [termino, plan, activo]);

  React.useEffect(() => {
    void cargar();
  }, [cargar]);

  const filtrando = termino.length > 0 || plan !== 'todos' || activo !== 'todos';

  return (
    <div className="flex w-full flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Locales</h1>
          <p className="text-sm text-muted-foreground">
            Todos los locales de la plataforma (sin filtro de tenant).
          </p>
        </div>
        <Button onClick={() => setCreando(true)}>+ Nuevo local</Button>
      </header>

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full max-w-xs space-y-2">
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

        <div className="space-y-2">
          <Label htmlFor="filtro-plan">Plan</Label>
          <Select value={plan} onValueChange={(v) => setPlan(v as 'todos' | PlanLocal)}>
            <SelectTrigger id="filtro-plan" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos los planes</SelectItem>
              {PLANES.map((p) => (
                <SelectItem key={p} value={p}>
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="filtro-activo">Estado</Label>
          <Select value={activo} onValueChange={(v) => setActivo(v as 'todos' | 'true' | 'false')}>
            <SelectTrigger id="filtro-activo" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              <SelectItem value="true">Activos</SelectItem>
              <SelectItem value="false">Inactivos</SelectItem>
            </SelectContent>
          </Select>
        </div>
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
            {filtrando ? ' con los filtros aplicados' : ''}
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
                      <Badge variant="outline">{l.plan}</Badge>
                      {l.activo ? (
                        <Badge variant="success">activo</Badge>
                      ) : (
                        <Badge variant="secondary">inactivo</Badge>
                      )}
                      {l.tieneTheme ? <Badge variant="outline">theme</Badge> : null}
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>{l.sucursales} sucursales</span>
                    <span>{l.empleados} empleados</span>
                    <span>{l.clientes} clientes</span>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {/* Abrir = el detalle (5 pestanas). Provisionar = la fabrica. Editar = datos base. */}
                    <Link
                      href={`/locales/${encodeURIComponent(l.id)}`}
                      className={buttonVariants({ variant: 'default', size: 'sm' })}
                    >
                      Abrir
                    </Link>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setFabricando({ id: l.id, nombre: l.nombre, slug: l.slug })}
                    >
                      Provisionar
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setEditando(l)}>
                      Editar
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}

      {/* Alta: wizard de 2 pasos. Al terminar, encadena la fabrica con el local recien creado. */}
      <Dialog
        open={creando}
        onOpenChange={(abierto) => {
          if (!abierto) setCreando(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nuevo local</DialogTitle>
            <DialogDescription>
              Se crea el local y su sucursal principal. Despues podes dejarlo listo para la demo
              con una plantilla.
            </DialogDescription>
          </DialogHeader>
          <FormularioLocal
            local={null}
            onCreado={(nuevo) => {
              setCreando(false);
              setFabricando(nuevo);
              toast.message('Podes dejarlo listo para la demo');
              void cargar();
            }}
            onCancelar={() => setCreando(false)}
          />
        </DialogContent>
      </Dialog>

      <Dialog
        open={editando !== null}
        onOpenChange={(abierto) => {
          if (!abierto) setEditando(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar local</DialogTitle>
            <DialogDescription>
              El slug no se cambia: ya esta en la URL y en el QR que el local repartio.
            </DialogDescription>
          </DialogHeader>
          {editando ? (
            <FormularioLocal
              key={editando.id}
              local={{
                id: editando.id,
                nombre: editando.nombre,
                slug: editando.slug,
                plan: editando.plan,
                numeroAtendiente: null,
              }}
              onGuardado={async () => {
                setEditando(null);
                await cargar();
              }}
              onCancelar={() => setEditando(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        open={fabricando !== null}
        onOpenChange={(abierto) => {
          if (!abierto) setFabricando(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Crear demo de {fabricando?.nombre}</DialogTitle>
            <DialogDescription>
              Deja el local listo para mostrar: club, carta, personal y un cliente demo.
            </DialogDescription>
          </DialogHeader>
          {fabricando ? (
            <FabricaDemo
              local={fabricando}
              onProvisionado={cargar}
              onListo={async () => {
                setFabricando(null);
                await cargar();
              }}
              onVolver={() => setFabricando(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
