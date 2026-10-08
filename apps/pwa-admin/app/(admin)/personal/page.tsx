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
  toast,
} from '@repo/ui';
import type { DataTableColumn } from '@repo/ui';
import { empleadosApi, sucursalesApi } from '@/lib/api';
import { useDueno } from '@/hooks/useDueno';
import { normalizarError } from '@/lib/errores';
import type { EmpleadoAdmin, RolEmpleado, SucursalAdmin } from '@/types/api';

/** Los literales, copiados del enum de Prisma (`RolEmpleado`); no los del pedido. */
const ROLES: RolEmpleado[] = ['DUENO', 'ENCARGADO', 'CAJERO', 'MESERO', 'DELIVERY', 'EMPLEADO'];

/**
 * Personal del local.
 *
 * Tres cosas que la pantalla NO puede asumir (verificadas contra el backend):
 * 1. `DELETE /empleados/:id` es un SOFT DELETE (`activo:false` + `eliminadoEn`) y **borra las
 *    sesiones** del empleado: desaparece del listado (que filtra `eliminadoEn: null`). No es un
 *    simple apagado, y por eso pide confirmacion.
 * 2. El PIN solo se ve UNA vez: el backend guarda `pinHash` y nunca lo devuelve. El dueno tiene
 *    que copiarlo del dialogo (por eso el flujo de reset muestra el PIN y no cierra solo).
 * 3. `POST /empleados` con un PIN ya usado por otro empleado del negocio da 409 (`exigirPinLibre`):
 *    el error se muestra tal cual.
 */
export default function PersonalPage() {
  const { dueno } = useDueno();
  const [empleados, setEmpleados] = React.useState<EmpleadoAdmin[] | null>(null);
  const [sucursales, setSucursales] = React.useState<SucursalAdmin[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [busqueda, setBusqueda] = React.useState('');
  const [filtroRol, setFiltroRol] = React.useState('todos');
  const [editando, setEditando] = React.useState<EmpleadoAdmin | null>(null);
  const [creando, setCreando] = React.useState(false);
  const [aResetear, setAResetear] = React.useState<EmpleadoAdmin | null>(null);
  const [aDesactivar, setADesactivar] = React.useState<EmpleadoAdmin | null>(null);
  const [desactivando, setDesactivando] = React.useState(false);

  const refetch = React.useCallback(async () => {
    try {
      // `pageSize: 100` (el maximo del backend): el admin quiere la lista entera, no la pagina 1.
      const [r, s] = await Promise.all([
        empleadosApi.listar({ pageSize: 100 }),
        sucursalesApi.misSucursales(),
      ]);
      setEmpleados(r.data);
      setSucursales(s.data);
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
    if (error) toast.error('No pudimos traer el personal', { description: error });
  }, [error]);

  // Todos los hooks ARRIBA del primer return (React #310; ver TROUBLESHOOTING).
  // `useMemo`: un `?? []` suelto crea un array nuevo en cada render y rompe las deps de abajo.
  const lista = React.useMemo(() => empleados ?? [], [empleados]);
  const q = busqueda.trim().toLowerCase();
  const visibles = React.useMemo(
    () =>
      lista.filter(
        (e) =>
          (filtroRol === 'todos' || e.rol === filtroRol) &&
          (q === '' || e.nombre.toLowerCase().includes(q) || (e.email ?? '').toLowerCase().includes(q)),
      ),
    [lista, filtroRol, q],
  );
  const activos = lista.filter((e) => e.activo).length;

  /** Toggle optimista de `activo` con rollback (el DELETE es otra cosa: eso es "Desactivar"). */
  const alternarActivo = React.useCallback(async (emp: EmpleadoAdmin, activo: boolean) => {
    setEmpleados((prev) => reemplazar(prev, emp.id, { activo }));
    try {
      await empleadosApi.actualizar(emp.id, { activo });
    } catch (e) {
      const { mensaje } = normalizarError(e);
      setEmpleados((prev) => reemplazar(prev, emp.id, { activo: emp.activo }));
      toast.error(`No se pudo cambiar ${emp.nombre}. ${mensaje}`);
    }
  }, []);

  const confirmarDesactivar = React.useCallback(async () => {
    if (!aDesactivar) return;
    setDesactivando(true);
    try {
      await empleadosApi.desactivar(aDesactivar.id);
      toast.success(`${aDesactivar.nombre} quedo fuera del local`, {
        description: 'Se borraron sus sesiones: no puede entrar más con ese PIN.',
      });
      setADesactivar(null);
      await refetch();
    } catch (e) {
      const { mensaje } = normalizarError(e);
      toast.error(`No se pudo desactivar ${aDesactivar.nombre}. ${mensaje}`);
    } finally {
      setDesactivando(false);
    }
  }, [aDesactivar, refetch]);

  const columnas: DataTableColumn<EmpleadoAdmin>[] = React.useMemo(
    () => [
      {
        key: 'nombre',
        header: 'Empleado',
        render: (e) => (
          <div className="min-w-0">
            <p className="truncate font-medium">
              {e.nombre}
              {e.id === dueno?.id ? <span className="ml-2 text-xs text-muted-foreground">(vos)</span> : null}
            </p>
            {e.email ? <p className="truncate text-xs text-muted-foreground">{e.email}</p> : null}
          </div>
        ),
      },
      {
        key: 'rol',
        header: 'Rol',
        render: (e) => <Badge variant="outline" className="whitespace-nowrap">{e.rol}</Badge>,
      },
      {
        key: 'sucursal',
        header: 'Sucursal',
        render: (e) => (
          <span className="text-sm text-muted-foreground">{e.sucursal?.nombre ?? '—'}</span>
        ),
      },
      {
        key: 'activo',
        header: 'Activo',
        render: (e) => (
          <div className="flex items-center gap-2">
            <Switch
              checked={e.activo}
              onCheckedChange={(v) => void alternarActivo(e, v)}
              aria-label={`Activo: ${e.nombre}`}
            />
            <span className="text-xs text-muted-foreground">{e.activo ? 'Si' : 'No'}</span>
          </div>
        ),
      },
      {
        key: 'ultimoAcceso',
        header: 'Ultimo ingreso',
        className: 'whitespace-nowrap',
        render: (e) => <FechaISO valor={e.ultimoAcceso} />,
      },
      {
        key: 'acciones',
        header: '',
        className: 'w-10',
        render: (e) => (
          // Trigger estilado directo: sin `asChild` (no hay @radix-ui/react-slot) un Button adentro
          // seria un <button> dentro de otro <button>.
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={`Acciones de ${e.nombre}`}
              className="rounded-lg px-2 py-1 text-lg leading-none text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              ⋯
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setEditando(e)}>Editar</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setAResetear(e)}>Reset PIN</DropdownMenuItem>
              {e.id === dueno?.id ? null : (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={() => setADesactivar(e)}
                    className="text-destructive focus:text-destructive"
                  >
                    Desactivar
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    [dueno?.id, alternarActivo],
  );

  return (
    <section className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Personal</h1>
          <p className="text-sm text-muted-foreground">
            {empleados === null ? 'Cargando...' : `${activos} de ${lista.length} activos`}
          </p>
        </div>
        <Button onClick={() => setCreando(true)} disabled={sucursales.length === 0}>
          + Nuevo empleado
        </Button>
      </header>

      {sucursales.length === 0 && empleados !== null ? (
        <p role="status" className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Necesitas al menos una sucursal para dar de alta personal.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar por nombre o email"
          autoCapitalize="none"
          className="max-w-xs"
        />
        <Select value={filtroRol} onValueChange={setFiltroRol}>
          <SelectTrigger className="w-48" aria-label="Filtrar por rol">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos los roles</SelectItem>
            {ROLES.map((r) => (
              <SelectItem key={r} value={r}>
                {r}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <DataTable
        data={visibles}
        columns={columnas}
        loading={empleados === null && !error}
        rowKey={(e) => e.id}
        empty={
          lista.length === 0
            ? 'Todavia no hay personal. Crea el primero con "+ Nuevo empleado".'
            : 'No hay empleados que coincidan con el filtro.'
        }
      />

      <p className="text-xs text-muted-foreground">
        Apagar el switch deja al empleado sin poder entrar, pero sigue en la lista. <strong>Desactivar</strong>{' '}
        lo saca del local y le borra las sesiones (no se puede deshacer desde aca).
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
            <DialogTitle>{editando ? 'Editar empleado' : 'Nuevo empleado'}</DialogTitle>
            <DialogDescription>
              {editando
                ? 'El PIN no se muestra aca: si lo perdio, usa "Reset PIN".'
                : 'El PIN se muestra una sola vez: copialo antes de cerrar.'}
            </DialogDescription>
          </DialogHeader>
          <FormularioEmpleado
            key={editando?.id ?? 'nuevo'}
            empleado={editando}
            sucursales={sucursales}
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
        open={aResetear !== null}
        onOpenChange={(abierto) => {
          if (!abierto) setAResetear(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset PIN de {aResetear?.nombre}</DialogTitle>
            <DialogDescription>
              El PIN viejo deja de funcionar apenas guardes. El nuevo se ve una sola vez.
            </DialogDescription>
          </DialogHeader>
          {aResetear ? <ResetPin empleado={aResetear} onCerrar={() => setAResetear(null)} /> : null}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={aDesactivar !== null}
        onOpenChange={(abierto) => {
          if (!abierto) setADesactivar(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desactivar a {aDesactivar?.nombre}?</AlertDialogTitle>
            <AlertDialogDescription>
              Sale del local y se le borran las sesiones: su PIN deja de servir. No se puede deshacer
              desde el panel.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void confirmarDesactivar()}
              disabled={desactivando}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {desactivando ? 'Desactivando...' : 'Desactivar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

/** Reemplaza un empleado del estado (el listado no viene agrupado). */
function reemplazar(
  prev: EmpleadoAdmin[] | null,
  id: string,
  cambios: Partial<EmpleadoAdmin>,
): EmpleadoAdmin[] | null {
  if (!prev) return prev;
  return prev.map((e) => (e.id === id ? { ...e, ...cambios } : e));
}

/** 6 digitos con `crypto` (el backend acepta de 4 a 8 y los guarda hasheados). */
function generarPin(): string {
  const bytes = new Uint32Array(1);
  let n: number;
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
    // `?? 0`: con noUncheckedIndexedAccess, `bytes[0]` es `number | undefined`.
    n = bytes[0] ?? 0;
  } else {
    n = Math.floor(Math.random() * 1_000_000_000);
  }
  return String(100_000 + (n % 900_000));
}

function FechaISO({ valor }: { valor: string | null }) {
  if (!valor) return <span className="text-sm text-muted-foreground">Nunca</span>;
  const d = new Date(valor);
  return <span className="text-sm tabular-nums">{d.toLocaleDateString('es-AR')} {d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}</span>;
}

/** Alta y edicion comparten formulario: `empleado` null = alta. */
function FormularioEmpleado({
  empleado,
  sucursales,
  onTerminar,
  onCancelar,
}: {
  empleado: EmpleadoAdmin | null;
  sucursales: SucursalAdmin[];
  onTerminar: () => void | Promise<void>;
  onCancelar: () => void;
}) {
  const [nombre, setNombre] = React.useState(empleado?.nombre ?? '');
  const [rol, setRol] = React.useState<RolEmpleado>(empleado?.rol ?? 'MESERO');
  const [sucursalId, setSucursalId] = React.useState(empleado?.sucursalId ?? sucursales[0]?.id ?? '');
  const [email, setEmail] = React.useState(empleado?.email ?? '');
  const [telefono, setTelefono] = React.useState(empleado?.telefono ?? '');
  const [accesoMultiSucursal, setAccesoMulti] = React.useState(empleado?.accesoMultiSucursal ?? false);
  const [pin, setPin] = React.useState(() => generarPin());
  const [activo, setActivo] = React.useState(empleado?.activo ?? true);
  const [guardando, setGuardando] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [creado, setCreado] = React.useState<{ nombre: string; pin: string } | null>(null);

  const pinValido = /^\d{4,8}$/.test(pin);
  const puedeGuardar =
    nombre.trim().length >= 2 && sucursalId !== '' && (!creandoPin() || pinValido) && !guardando;

  function creandoPin() {
    return empleado === null;
  }

  async function guardar(evento: React.FormEvent) {
    evento.preventDefault();
    if (!puedeGuardar) return;
    setGuardando(true);
    setError(null);
    try {
      if (empleado) {
        await empleadosApi.actualizar(empleado.id, {
          nombre: nombre.trim(),
          rol,
          sucursalId,
          email: email.trim() === '' ? undefined : email.trim(),
          telefono: telefono.trim() === '' ? undefined : telefono.trim(),
          accesoMultiSucursal,
          activo,
        });
        toast.success('Empleado actualizado');
        await onTerminar();
      } else {
        const body = {
          nombre: nombre.trim(),
          rol,
          sucursalId,
          pin,
          email: email.trim() === '' ? undefined : email.trim(),
          telefono: telefono.trim() === '' ? undefined : telefono.trim(),
          accesoMultiSucursal,
        };
        await empleadosApi.crear(body);
        // No cerramos: el PIN no se puede recuperar despues (el backend guarda el hash).
        setCreado({ nombre: nombre.trim(), pin });
      }
    } catch (e) {
      const { status, mensaje } = normalizarError(e);
      setError(
        status === 409
          ? `${mensaje} Ese PIN ya lo usa otro empleado: genera otro.`
          : mensaje,
      );
    } finally {
      setGuardando(false);
    }
  }

  if (creado) {
    return (
      <div className="space-y-4">
        <p className="text-sm">
          <strong>{creado.nombre}</strong> quedo creado. Este es su PIN para entrar en{' '}
          <code className="rounded bg-muted px-1">staff.clubio.lat</code>:
        </p>
        <PinCopiable pin={creado.pin} />
        <p role="alert" className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Copialo ahora: no se puede volver a ver. Si se pierde, hay que resetearlo.
        </p>
        <DialogFooter>
          <Button type="button" onClick={() => void onTerminar()}>
            Listo
          </Button>
        </DialogFooter>
      </div>
    );
  }

  return (
    <form onSubmit={guardar} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="nombre">Nombre</Label>
        <Input
          id="nombre"
          value={nombre}
          onChange={(e) => setNombre(e.target.value.slice(0, 120))}
          placeholder="Maria Encargada"
          required
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="rol">Rol</Label>
          <Select value={rol} onValueChange={(v) => setRol(v as RolEmpleado)}>
            <SelectTrigger id="rol">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROLES.map((r) => (
                <SelectItem key={r} value={r}>
                  {r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="sucursal">Sucursal</Label>
          <Select value={sucursalId} onValueChange={setSucursalId}>
            <SelectTrigger id="sucursal">
              <SelectValue placeholder="Elegi una sucursal" />
            </SelectTrigger>
            <SelectContent>
              {sucursales.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="email">Email (opcional)</Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value.slice(0, 120))}
            autoCapitalize="none"
            spellCheck={false}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="telefono">Telefono (opcional)</Label>
          <Input
            id="telefono"
            value={telefono}
            onChange={(e) => setTelefono(e.target.value.slice(0, 40))}
          />
        </div>
      </div>

      {creandoPin() ? (
        <div className="space-y-2">
          <Label htmlFor="pin">PIN de ingreso (4 a 8 digitos)</Label>
          <div className="flex gap-2">
            <Input
              id="pin"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
              inputMode="numeric"
              className="font-mono tracking-widest"
              required
            />
            <Button type="button" variant="outline" onClick={() => setPin(generarPin())}>
              Generar
            </Button>
          </div>
          {!pinValido && pin !== '' ? (
            <p role="alert" className="text-xs text-destructive">
              El PIN tiene que tener entre 4 y 8 digitos.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="flex items-center justify-between">
        <Label htmlFor="acceso-multi">Puede ver todas las sucursales</Label>
        <Switch id="acceso-multi" checked={accesoMultiSucursal} onCheckedChange={setAccesoMulti} />
      </div>

      {empleado ? (
        <div className="flex items-center justify-between">
          <Label htmlFor="activo">Activo</Label>
          <Switch id="activo" checked={activo} onCheckedChange={setActivo} />
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
          {guardando ? 'Guardando...' : empleado ? 'Guardar cambios' : 'Crear empleado'}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Reset de PIN: se elige (o genera) el nuevo y, al guardar, se muestra para copiar. */
function ResetPin({ empleado, onCerrar }: { empleado: EmpleadoAdmin; onCerrar: () => void }) {
  const [pin, setPin] = React.useState(() => generarPin());
  const [guardando, setGuardando] = React.useState(false);
  const [listo, setListo] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const pinValido = /^\d{4,8}$/.test(pin);

  async function guardar(evento: React.FormEvent) {
    evento.preventDefault();
    if (!pinValido || guardando) return;
    setGuardando(true);
    setError(null);
    try {
      await empleadosApi.resetPin(empleado.id, pin);
      setListo(true);
      toast.success(`PIN actualizado para ${empleado.nombre}`);
    } catch (e) {
      const { status, mensaje } = normalizarError(e);
      setError(status === 409 ? `${mensaje} Ese PIN ya lo usa otro empleado.` : mensaje);
    } finally {
      setGuardando(false);
    }
  }

  if (listo) {
    return (
      <div className="space-y-4">
        <p className="text-sm">
          El PIN viejo de <strong>{empleado.nombre}</strong> ya no sirve. Este es el nuevo:
        </p>
        <PinCopiable pin={pin} />
        <p role="alert" className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Copialo y pasaselo: no se vuelve a mostrar.
        </p>
        <DialogFooter>
          <Button type="button" onClick={onCerrar}>
            Listo
          </Button>
        </DialogFooter>
      </div>
    );
  }

  return (
    <form onSubmit={guardar} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="pin-nuevo">PIN nuevo (4 a 8 digitos)</Label>
        <div className="flex gap-2">
          <Input
            id="pin-nuevo"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
            inputMode="numeric"
            className="font-mono tracking-widest"
            required
          />
          <Button type="button" variant="outline" onClick={() => setPin(generarPin())}>
            Generar
          </Button>
        </div>
        {!pinValido && pin !== '' ? (
          <p role="alert" className="text-xs text-destructive">
            El PIN tiene que tener entre 4 y 8 digitos.
          </p>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCerrar} disabled={guardando}>
          Cancelar
        </Button>
        <Button type="submit" disabled={!pinValido || guardando}>
          {guardando ? 'Guardando...' : 'Resetear PIN'}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** El PIN en grande, con boton para copiar (es lo unico que el dueno se lleva de aca). */
function PinCopiable({ pin }: { pin: string }) {
  const [copiado, setCopiado] = React.useState(false);
  return (
    <div className="flex items-center gap-3">
      <output className="rounded-xl border bg-muted px-4 py-3 font-mono text-2xl tracking-[0.3em]" aria-label="PIN">
        {pin}
      </output>
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          void navigator.clipboard?.writeText(pin).then(
            () => {
              setCopiado(true);
              window.setTimeout(() => setCopiado(false), 2000);
            },
            () => setCopiado(false),
          );
        }}
      >
        {copiado ? 'Copiado' : 'Copiar'}
      </Button>
    </div>
  );
}
