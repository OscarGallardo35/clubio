'use client';

import * as React from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  DataTable,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
  toast,
} from '@repo/ui';
import type { DataTableColumn } from '@repo/ui';
import { cartaApi, itemsOverrideApi, sucursalConfigApi, sucursalesApi } from '@/lib/api';
import { normalizarError } from '@/lib/errores';
import type {
  CartaAdminRespuesta,
  ItemOverrideAdmin,
  SucursalAdmin,
} from '@/types/api';

/**
 * Sucursales.
 *
 * Tres cosas que la pantalla NO puede asumir (verificadas contra el backend):
 * 1. `DELETE /sucursales/:id` es un borrado REAL y destructivo: reasigna los empleados a la
 *    principal y CANCELA los pedidos activos. Sin `force=true` el backend responde 409 si la
 *    sucursal tiene movimiento; por eso el confirm tiene un segundo paso que lo explica.
 * 2. `activa: false` (PATCH) es lo reversible: la sucursal queda apagada pero no se borra. Es lo
 *    que ofrece el switch de la fila.
 * 3. El `slug` NO se puede cambiar: va en la URL que el cliente ya puede tener guardada. Solo se
 *    elige al crear (y se sugiere desde el nombre).
 */
export default function SucursalesPage() {
  const [sucursales, setSucursales] = React.useState<SucursalAdmin[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [creando, setCreando] = React.useState(false);
  const [editando, setEditando] = React.useState<SucursalAdmin | null>(null);
  const [configDe, setConfigDe] = React.useState<SucursalAdmin | null>(null);
  const [preciosDe, setPreciosDe] = React.useState<SucursalAdmin | null>(null);
  const [aPrincipal, setAPrincipal] = React.useState<SucursalAdmin | null>(null);
  const [aEliminar, setAEliminar] = React.useState<SucursalAdmin | null>(null);
  const [forzando, setForzando] = React.useState<SucursalAdmin | null>(null);
  const [ocupado, setOcupado] = React.useState(false);

  const refetch = React.useCallback(async () => {
    try {
      const r = await sucursalesApi.listar();
      setSucursales(r.data);
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
    if (error) toast.error('No pudimos traer las sucursales', { description: error });
  }, [error]);

  // Hooks siempre ARRIBA del primer return (React #310; ver TROUBLESHOOTING).
  const lista = sucursales ?? [];

  const alternarActiva = React.useCallback(async (s: SucursalAdmin, activa: boolean) => {
    setSucursales((prev) => reemplazar(prev, s.id, { activa }));
    try {
      await sucursalesApi.actualizar(s.id, { activa });
    } catch (e) {
      const { mensaje } = normalizarError(e);
      setSucursales((prev) => reemplazar(prev, s.id, { activa: s.activa }));
      toast.error(`No se pudo cambiar ${s.nombre}. ${mensaje}`);
    }
  }, []);

  const confirmarPrincipal = React.useCallback(async () => {
    if (!aPrincipal) return;
    setOcupado(true);
    try {
      await sucursalesApi.marcarPrincipal(aPrincipal.id);
      toast.success(`${aPrincipal.nombre} es la sucursal principal`);
      setAPrincipal(null);
      await refetch();
    } catch (e) {
      const { mensaje } = normalizarError(e);
      toast.error(`No se pudo marcar como principal. ${mensaje}`);
    } finally {
      setOcupado(false);
    }
  }, [aPrincipal, refetch]);

  const eliminar = React.useCallback(
    async (s: SucursalAdmin, force: boolean) => {
      setOcupado(true);
      try {
        const r = await sucursalesApi.eliminar(s.id, force);
        toast.success(`${s.nombre} quedo eliminada`, {
          description: `${r.empleadosReasignados ?? 0} empleado(s) reasignados, ${r.pedidosCancelados ?? 0} pedido(s) cancelados.`,
        });
        setAEliminar(null);
        setForzando(null);
        await refetch();
      } catch (e) {
        const { status, mensaje } = normalizarError(e);
        // 409 = tiene movimiento y el backend pide `force`. Se explica y se ofrece el segundo paso.
        if (status === 409) {
          setAEliminar(null);
          setForzando(s);
        } else {
          toast.error(`No se pudo eliminar ${s.nombre}. ${mensaje}`);
        }
      } finally {
        setOcupado(false);
      }
    },
    [refetch],
  );

  const columnas: DataTableColumn<SucursalAdmin>[] = React.useMemo(
    () => [
      {
        key: 'nombre',
        header: 'Sucursal',
        render: (s) => (
          <div className="min-w-0">
            <p className="flex items-center gap-2 truncate font-medium">
              {s.nombre}
              {s.esPrincipal ? <Badge>Principal</Badge> : null}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              /{s.slug}
              {s.direccion ? ` · ${s.direccion}` : ''}
            </p>
          </div>
        ),
      },
      {
        key: 'contacto',
        header: 'Contacto',
        render: (s) => (
          <div className="text-xs text-muted-foreground">
            <p>{s.telefono || '—'}</p>
            {s.numeroAtendiente ? <p>WhatsApp: {s.numeroAtendiente}</p> : null}
          </div>
        ),
      },
      {
        key: 'metricas',
        header: 'Este mes',
        className: 'whitespace-nowrap',
        render: (s) => (
          <div className="text-xs tabular-nums text-muted-foreground">
            <p>{s.pedidosDelMes} pedidos · {s.visitasDelMes} visitas</p>
            <p>{s.empleadosActivos} empleados · {s.clientesRegistrados} clientes</p>
          </div>
        ),
      },
      {
        key: 'config',
        header: 'Config',
        render: (s) =>
          s.tieneConfiguracionOverride ? (
            <Badge variant="outline">Propia</Badge>
          ) : (
            <span className="text-xs text-muted-foreground">Hereda</span>
          ),
      },
      {
        key: 'activa',
        header: 'Activa',
        render: (s) => (
          <div className="flex items-center gap-2">
            <Switch
              checked={s.activa}
              onCheckedChange={(v) => void alternarActiva(s, v)}
              aria-label={`Activa: ${s.nombre}`}
            />
            <span className="text-xs text-muted-foreground">{s.activa ? 'Si' : 'No'}</span>
          </div>
        ),
      },
      {
        key: 'acciones',
        header: '',
        className: 'w-10',
        render: (s) => (
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={`Acciones de ${s.nombre}`}
              className="rounded-lg px-2 py-1 text-lg leading-none text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              ⋯
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setEditando(s)}>Editar</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setConfigDe(s)}>Config de la sucursal</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setPreciosDe(s)}>Precios por sucursal</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setAPrincipal(s)} disabled={s.esPrincipal}>
                Marcar como principal
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => setAEliminar(s)}
                className="text-destructive focus:text-destructive"
              >
                Eliminar
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    [alternarActiva],
  );

  return (
    <section className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Sucursales</h1>
          <p className="text-sm text-muted-foreground">
            {sucursales === null
              ? 'Cargando...'
              : `${lista.filter((s) => s.activa).length} activas de ${lista.length}`}
          </p>
        </div>
        <Button onClick={() => setCreando(true)}>+ Nueva sucursal</Button>
      </header>

      <DataTable
        data={lista}
        columns={columnas}
        loading={sucursales === null && !error}
        rowKey={(s) => s.id}
        empty='Todavia no hay sucursales. Crea la primera con "+ Nueva sucursal".'
      />

      <p className="text-xs text-muted-foreground">
        Apagar el switch <strong>desactiva</strong> la sucursal (reversible: deja de verse en el
        cliente y en el staff). <strong>Eliminar</strong> es otra cosa: reasigna el personal a la
        principal y cancela los pedidos activos.
      </p>

      <Dialog
        open={creando || editando !== null}
        onOpenChange={(abierto) => {
          if (!abierto) {
            setCreando(false);
            setEditando(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editando ? 'Editar sucursal' : 'Nueva sucursal'}</DialogTitle>
            <DialogDescription>
              {editando
                ? 'El slug no se cambia: esta en la URL que ya usan tus clientes.'
                : 'El slug va en la URL del cliente (app.clubio.lat/tu-slug).'}
            </DialogDescription>
          </DialogHeader>
          <FormularioSucursal
            key={editando?.id ?? 'nueva'}
            sucursal={editando}
            hayPrincipal={lista.some((s) => s.esPrincipal)}
            onTerminar={async () => {
              setCreando(false);
              setEditando(null);
              await refetch();
            }}
            onCancelar={() => {
              setCreando(false);
              setEditando(null);
            }}
          />
        </DialogContent>
      </Dialog>

      <Dialog
        open={configDe !== null}
        onOpenChange={(abierto) => {
          if (!abierto) setConfigDe(null);
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Config de {configDe?.nombre}</DialogTitle>
            <DialogDescription>
              Lo que dejes vacio <strong>hereda</strong> la config del club. Guardar con un campo
              vacio borra ese override.
            </DialogDescription>
          </DialogHeader>
          {configDe ? <FormularioConfigSucursal sucursal={configDe} onCerrar={() => setConfigDe(null)} onGuardado={refetch} /> : null}
        </DialogContent>
      </Dialog>

      <Dialog
        open={preciosDe !== null}
        onOpenChange={(abierto) => {
          if (!abierto) setPreciosDe(null);
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Precios de {preciosDe?.nombre}</DialogTitle>
            <DialogDescription>
              El precio propio de esta sucursal para un item. Sin override, usa el precio del
              negocio.
            </DialogDescription>
          </DialogHeader>
          {preciosDe ? <FormularioPrecios sucursal={preciosDe} /> : null}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={aPrincipal !== null}
        onOpenChange={(abierto) => {
          if (!abierto) setAPrincipal(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Marcar {aPrincipal?.nombre} como principal?</AlertDialogTitle>
            <AlertDialogDescription>
              La principal es la que se usa por defecto cuando no se aclara la sucursal: solo puede
              haber una.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmarPrincipal()} disabled={ocupado}>
              {ocupado ? 'Marcando...' : 'Marcar principal'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={aEliminar !== null}
        onOpenChange={(abierto) => {
          if (!abierto) setAEliminar(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar {aEliminar?.nombre}?</AlertDialogTitle>
            <AlertDialogDescription>
              Si la sucursal tiene movimiento, el sistema te va a pedir una confirmacion extra
              (reasigna el personal a la principal y cancela los pedidos activos).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => aEliminar && void eliminar(aEliminar, false)}
              disabled={ocupado}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {ocupado ? 'Eliminando...' : 'Eliminar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={forzando !== null}
        onOpenChange={(abierto) => {
          if (!abierto) setForzando(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{forzando?.nombre} tiene movimiento</AlertDialogTitle>
            <AlertDialogDescription>
              Tiene pedidos o personal asignado. Si la eliminas: el personal pasa a la sucursal
              principal y los pedidos activos se <strong>cancelan</strong>.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => forzando && void eliminar(forzando, true)}
              disabled={ocupado}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {ocupado ? 'Eliminando...' : 'Eliminar igual'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function reemplazar(
  prev: SucursalAdmin[] | null,
  id: string,
  cambios: Partial<SucursalAdmin>,
): SucursalAdmin[] | null {
  if (!prev) return prev;
  return prev.map((s) => (s.id === id ? { ...s, ...cambios } : s));
}

/** El slug se sugiere desde el nombre y se muestra como se va a ver en la URL. */
function sugerirSlug(nombre: string): string {
  return nombre
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function FormularioSucursal({
  sucursal,
  hayPrincipal,
  onTerminar,
  onCancelar,
}: {
  sucursal: SucursalAdmin | null;
  hayPrincipal: boolean;
  onTerminar: () => void | Promise<void>;
  onCancelar: () => void;
}) {
  const [nombre, setNombre] = React.useState(sucursal?.nombre ?? '');
  const [slug, setSlug] = React.useState(sucursal?.slug ?? '');
  const [slugTocado, setSlugTocado] = React.useState(sucursal !== null);
  const [direccion, setDireccion] = React.useState(sucursal?.direccion ?? '');
  const [telefono, setTelefono] = React.useState(sucursal?.telefono ?? '');
  const [numeroAtendiente, setNumeroAtendiente] = React.useState(sucursal?.numeroAtendiente ?? '');
  const [esPrincipal, setEsPrincipal] = React.useState(sucursal?.esPrincipal ?? !hayPrincipal);
  const [guardando, setGuardando] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const slugValido = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
  const puedeGuardar = nombre.trim().length >= 2 && (sucursal !== null || slugValido) && !guardando;

  async function guardar(evento: React.FormEvent) {
    evento.preventDefault();
    if (!puedeGuardar) return;
    setGuardando(true);
    setError(null);
    try {
      if (sucursal) {
        await sucursalesApi.actualizar(sucursal.id, {
          nombre: nombre.trim(),
          direccion: direccion.trim() === '' ? undefined : direccion.trim(),
          telefono: telefono.trim() === '' ? undefined : telefono.trim(),
          numeroAtendiente: numeroAtendiente.trim() === '' ? undefined : numeroAtendiente.trim(),
        });
        toast.success('Sucursal actualizada');
      } else {
        await sucursalesApi.crear({
          nombre: nombre.trim(),
          slug,
          direccion: direccion.trim() === '' ? undefined : direccion.trim(),
          telefono: telefono.trim() === '' ? undefined : telefono.trim(),
          numeroAtendiente: numeroAtendiente.trim() === '' ? undefined : numeroAtendiente.trim(),
          esPrincipal,
        });
        toast.success('Sucursal creada');
      }
      await onTerminar();
    } catch (e) {
      const { status, mensaje } = normalizarError(e);
      setError(status === 409 ? `${mensaje} (¿ya existe una sucursal con ese slug?)` : mensaje);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <form onSubmit={guardar} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="nombre-suc">Nombre</Label>
        <Input
          id="nombre-suc"
          value={nombre}
          onChange={(e) => {
            const v = e.target.value.slice(0, 80);
            setNombre(v);
            if (!slugTocado) setSlug(sugerirSlug(v));
          }}
          placeholder="Bar Centro"
          required
        />
      </div>

      {sucursal === null ? (
        <div className="space-y-2">
          <Label htmlFor="slug-suc">Slug (URL)</Label>
          <Input
            id="slug-suc"
            value={slug}
            onChange={(e) => {
              setSlugTocado(true);
              setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 60));
            }}
            autoCapitalize="none"
            spellCheck={false}
            required
          />
          <p className="text-xs text-muted-foreground">
            app.clubio.lat/<strong>{slug || '...'}</strong> — no se puede cambiar despues.
          </p>
          {!slugValido && slug !== '' ? (
            <p role="alert" className="text-xs text-destructive">
              Solo minusculas, numeros y guiones (ej: bar-centro).
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="direccion">Direccion (opcional)</Label>
        <Input
          id="direccion"
          value={direccion}
          onChange={(e) => setDireccion(e.target.value.slice(0, 200))}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="telefono-suc">Telefono (opcional)</Label>
          <Input
            id="telefono-suc"
            value={telefono}
            onChange={(e) => setTelefono(e.target.value.slice(0, 40))}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="wa">WhatsApp que atiende (opcional)</Label>
          <Input
            id="wa"
            value={numeroAtendiente}
            onChange={(e) => setNumeroAtendiente(e.target.value.slice(0, 40))}
          />
        </div>
      </div>

      {sucursal === null && !hayPrincipal ? (
        <div className="flex items-center justify-between">
          <Label htmlFor="principal">Es la sucursal principal</Label>
          <Switch id="principal" checked={esPrincipal} onCheckedChange={setEsPrincipal} />
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancelar} disabled={guardando}>
          Cancelar
        </Button>
        <Button type="submit" disabled={!puedeGuardar}>
          {guardando ? 'Guardando...' : sucursal ? 'Guardar cambios' : 'Crear sucursal'}
        </Button>
      </DialogFooter>
    </form>
  );
}

/**
 * Los campos que una sucursal PUEDE overridear (los del `CAMPOS_OVERRIDE` del backend).
 * `null` = heredar. Los arrays de tipos de pedido / modos de pago quedan afuera a proposito.
 */
const CAMPOS_CONFIG = [
  { clave: 'premioTexto', etiqueta: 'Texto del premio', tipo: 'texto' },
  { clave: 'sellosParaPremio', etiqueta: 'Sellos para el premio', tipo: 'entero' },
  { clave: 'sellosBienvenida', etiqueta: 'Sellos de bienvenida', tipo: 'entero' },
  { clave: 'limiteVisitasPorDia', etiqueta: 'Limite de visitas por dia', tipo: 'entero' },
  { clave: 'horasMinimasEntreVisitas', etiqueta: 'Horas minimas entre visitas', tipo: 'entero' },
  { clave: 'costoEnvio', etiqueta: 'Costo de envio', tipo: 'numero' },
  { clave: 'pedidoMinimoDelivery', etiqueta: 'Pedido minimo de delivery', tipo: 'numero' },
  { clave: 'zonaEntrega', etiqueta: 'Zona de entrega', tipo: 'texto' },
  { clave: 'transferenciaAlias', etiqueta: 'Transferencia: alias', tipo: 'texto' },
  { clave: 'transferenciaCbu', etiqueta: 'Transferencia: CBU', tipo: 'texto' },
  { clave: 'transferenciaTitular', etiqueta: 'Transferencia: titular', tipo: 'texto' },
  { clave: 'transferenciaBanco', etiqueta: 'Transferencia: banco', tipo: 'texto' },
] as const;

function FormularioConfigSucursal({
  sucursal,
  onCerrar,
  onGuardado,
}: {
  sucursal: SucursalAdmin;
  onCerrar: () => void;
  onGuardado: () => void | Promise<void>;
}) {
  const [valores, setValores] = React.useState<Record<string, string> | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [guardando, setGuardando] = React.useState(false);

  React.useEffect(() => {
    let vivo = true;
    void (async () => {
      try {
        const ov = await sucursalConfigApi.obtener(sucursal.id);
        if (!vivo) return;
        const inicial: Record<string, string> = {};
        for (const c of CAMPOS_CONFIG) {
          const v = (ov as Record<string, unknown>)[c.clave];
          inicial[c.clave] = v === null || v === undefined ? '' : String(v);
        }
        setValores(inicial);
      } catch (e) {
        const { mensaje } = normalizarError(e);
        if (vivo) setError(mensaje);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [sucursal.id]);

  async function guardar(evento: React.FormEvent) {
    evento.preventDefault();
    if (!valores || guardando) return;
    setGuardando(true);
    setError(null);
    try {
      // Vacio = null = borra el override (hereda del club). Es lo que dice el texto del dialogo.
      const body: Record<string, string | number | null> = {};
      for (const c of CAMPOS_CONFIG) {
        const bruto = valores[c.clave]?.trim() ?? '';
        if (bruto === '') body[c.clave] = null;
        else if (c.tipo === 'texto') body[c.clave] = bruto;
        else {
          const n = Number(bruto.replace(',', '.'));
          body[c.clave] = Number.isFinite(n) ? n : null;
        }
      }
      await sucursalConfigApi.guardar(sucursal.id, body as never);
      toast.success(`Config de ${sucursal.nombre} guardada`);
      await onGuardado();
      onCerrar();
    } catch (e) {
      const { mensaje } = normalizarError(e);
      setError(mensaje);
    } finally {
      setGuardando(false);
    }
  }

  async function borrarOverride() {
    if (guardando) return;
    setGuardando(true);
    try {
      await sucursalConfigApi.borrar(sucursal.id);
      toast.success(`${sucursal.nombre} vuelve a heredar la config del club`);
      await onGuardado();
      onCerrar();
    } catch (e) {
      const { mensaje } = normalizarError(e);
      setError(mensaje);
    } finally {
      setGuardando(false);
    }
  }

  if (!valores) {
    return <p className="text-sm text-muted-foreground">{error ?? 'Cargando config...'}</p>;
  }

  return (
    <form onSubmit={guardar} className="space-y-4">
      <div className="grid max-h-[50vh] gap-4 overflow-y-auto pr-1 sm:grid-cols-2">
        {CAMPOS_CONFIG.map((c) => (
          <div key={c.clave} className="space-y-2">
            <Label htmlFor={`cfg-${c.clave}`}>{c.etiqueta}</Label>
            {c.clave === 'premioTexto' ? (
              <Textarea
                id={`cfg-${c.clave}`}
                value={valores[c.clave] ?? ''}
                onChange={(e) => setValores({ ...valores, [c.clave]: e.target.value })}
                placeholder="Hereda del club"
              />
            ) : (
              <Input
                id={`cfg-${c.clave}`}
                value={valores[c.clave] ?? ''}
                onChange={(e) => setValores({ ...valores, [c.clave]: e.target.value })}
                inputMode={c.tipo === 'texto' ? 'text' : 'decimal'}
                placeholder="Hereda del club"
              />
            )}
          </div>
        ))}
      </div>

      {error ? (
        <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <DialogFooter className="sm:justify-between">
        <Button type="button" variant="outline" onClick={() => void borrarOverride()} disabled={guardando}>
          Borrar override
        </Button>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onCerrar} disabled={guardando}>
            Cancelar
          </Button>
          <Button type="submit" disabled={guardando}>
            {guardando ? 'Guardando...' : 'Guardar'}
          </Button>
        </div>
      </DialogFooter>
    </form>
  );
}

/** Precios propios de la sucursal: lista los overrides y permite agregar/sacar. */
function FormularioPrecios({ sucursal }: { sucursal: SucursalAdmin }) {
  const [overrides, setOverrides] = React.useState<ItemOverrideAdmin[] | null>(null);
  const [carta, setCarta] = React.useState<CartaAdminRespuesta | null>(null);
  const [itemCartaId, setItemCartaId] = React.useState('');
  const [precio, setPrecio] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [guardando, setGuardando] = React.useState(false);

  const cargar = React.useCallback(async () => {
    try {
      const [o, c] = await Promise.all([
        itemsOverrideApi.listar(sucursal.id),
        cartaApi.admin(),
      ]);
      setOverrides(o.data);
      setCarta(c);
      setError(null);
    } catch (e) {
      const { mensaje } = normalizarError(e);
      setError(mensaje);
    }
  }, [sucursal.id]);

  React.useEffect(() => {
    void cargar();
  }, [cargar]);

  const items = React.useMemo(
    () => (carta?.categorias ?? []).flatMap((g) => g.items),
    [carta],
  );

  async function guardar(evento: React.FormEvent) {
    evento.preventDefault();
    if (itemCartaId === '' || guardando) return;
    const n = precio.trim() === '' ? null : Number(precio.replace(',', '.'));
    if (n !== null && !Number.isFinite(n)) {
      setError('El precio tiene que ser un numero.');
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      await itemsOverrideApi.guardar(sucursal.id, { itemCartaId, precio: n });
      toast.success(n === null ? 'Override borrado' : 'Precio propio guardado');
      setItemCartaId('');
      setPrecio('');
      await cargar();
    } catch (e) {
      const { mensaje } = normalizarError(e);
      setError(mensaje);
    } finally {
      setGuardando(false);
    }
  }

  async function quitar(itemId: string, nombre: string) {
    setGuardando(true);
    try {
      await itemsOverrideApi.eliminar(sucursal.id, itemId);
      toast.success(`${nombre} vuelve al precio del negocio`);
      await cargar();
    } catch (e) {
      const { mensaje } = normalizarError(e);
      toast.error(`No se pudo borrar el override. ${mensaje}`);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={guardar} className="flex flex-wrap items-end gap-3">
        <div className="min-w-[12rem] flex-1 space-y-2">
          <Label htmlFor="item-ov">Item de la carta</Label>
          <Select value={itemCartaId} onValueChange={setItemCartaId}>
            <SelectTrigger id="item-ov">
              <SelectValue placeholder="Elegi un item" />
            </SelectTrigger>
            <SelectContent>
              {items.map((i) => (
                <SelectItem key={i.id} value={i.id}>
                  {i.nombre} (${i.precio})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-32 space-y-2">
          <Label htmlFor="precio-ov">Precio aca</Label>
          <Input
            id="precio-ov"
            value={precio}
            onChange={(e) => setPrecio(e.target.value.replace(/[^0-9.,]/g, ''))}
            inputMode="decimal"
            placeholder="Sin cambio"
          />
        </div>
        <Button type="submit" disabled={itemCartaId === '' || guardando}>
          Guardar
        </Button>
      </form>

      <p className="text-xs text-muted-foreground">
        Dejar el precio vacio borra el override de ese item (vuelve al precio del negocio).
      </p>

      {error ? (
        <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {overrides === null ? (
        <p className="text-sm text-muted-foreground">Cargando overrides...</p>
      ) : overrides.length === 0 ? (
        <p className="rounded-xl border px-4 py-3 text-sm text-muted-foreground">
          Esta sucursal usa el precio del negocio para todos los items.
        </p>
      ) : (
        <ul className="divide-y rounded-xl border">
          {overrides.map((o) => (
            <li key={o.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{o.itemNombre}</p>
                <p className="text-xs text-muted-foreground">
                  {o.categoria} · negocio ${o.precioGlobal}
                  {o.precioOverride !== null ? ` · aca $${o.precioOverride}` : ' · sin precio propio'}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => void quitar(o.itemCartaId, o.itemNombre)}
                disabled={guardando}
              >
                Quitar
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
