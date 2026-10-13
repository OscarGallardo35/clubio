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
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  toast,
} from '@repo/ui';
import type { DataTableColumn } from '@repo/ui';
import { superadminApi } from '@/lib/api';
import { normalizarError } from '@/lib/errores';
import { empleadosDeLista } from '@/lib/normalizar';
import { ROLES } from '@/types/api';
import type { EmpleadoLocal, RolEmpleado } from '@/types/api';

/** Como entra el empleado. Los dos caminos son excluyentes en el alta. */
type ViaAcceso = 'pin' | 'password';

/**
 * Empleados del local.
 *
 * Dos cosas que la pantalla NO puede asumir:
 * 1. El backend guarda `pinHash`/`passwordHash` y NUNCA los devuelve: de un empleado ya
 *    creado solo se sabe si tiene PIN, no cual es. Por eso la edicion NO muestra credenciales
 *    (a lo sumo deja cargar una password nueva) y el alta las pide una sola vez.
 * 2. La password se tipea en un `<input type="password">` y no se puede volver a leer: si el
 *    operador edita sin cargarla, el campo vacio significa "no la cambies" (el body no la
 *    incluye), no "borrala".
 */
export function TabEmpleados({ negocioId }: { negocioId: string }) {
  const [empleados, setEmpleados] = React.useState<EmpleadoLocal[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [creando, setCreando] = React.useState(false);
  const [editando, setEditando] = React.useState<EmpleadoLocal | null>(null);
  const [aEliminar, setAEliminar] = React.useState<EmpleadoLocal | null>(null);
  const [borrando, setBorrando] = React.useState(false);

  const cargar = React.useCallback(async () => {
    try {
      const r = await superadminApi.empleados(negocioId);
      setEmpleados(empleadosDeLista(r));
      setError(null);
    } catch (e) {
      const { status, mensaje } = normalizarError(e);
      if (status !== 401) setError(mensaje);
      setEmpleados([]);
    }
  }, [negocioId]);

  React.useEffect(() => {
    void cargar();
  }, [cargar]);

  const lista = React.useMemo(() => empleados ?? [], [empleados]);

  const eliminar = React.useCallback(async () => {
    if (!aEliminar) return;
    setBorrando(true);
    try {
      await superadminApi.eliminarEmpleado(negocioId, aEliminar.id);
      toast.success(`${aEliminar.nombre} quedo fuera del local`);
      setAEliminar(null);
      await cargar();
    } catch (e) {
      toast.error(`No se pudo eliminar ${aEliminar.nombre}. ${normalizarError(e).mensaje}`);
    } finally {
      setBorrando(false);
    }
  }, [aEliminar, negocioId, cargar]);

  const columnas: DataTableColumn<EmpleadoLocal>[] = React.useMemo(
    () => [
      {
        key: 'nombre',
        header: 'Empleado',
        render: (e) => (
          <div className="min-w-0">
            <p className="truncate font-medium">{e.nombre}</p>
            {e.email ? <p className="truncate text-xs text-muted-foreground">{e.email}</p> : null}
          </div>
        ),
      },
      {
        key: 'rol',
        header: 'Rol',
        render: (e) => (
          <Badge variant="outline" className="whitespace-nowrap">
            {e.rol}
          </Badge>
        ),
      },
      {
        key: 'acceso',
        header: 'Entra con',
        render: (e) => (
          <span className="text-sm text-muted-foreground">
            {e.tienePin ? 'PIN' : e.email ? 'Email y password' : 'Sin credencial'}
          </span>
        ),
      },
      {
        key: 'acciones',
        header: '',
        className: 'w-10',
        render: (e) => (
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={`Acciones de ${e.nombre}`}
              className="rounded-lg px-2 py-1 text-lg leading-none text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              ⋯
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setEditando(e)}>Editar</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => setAEliminar(e)}
                className="text-destructive focus:text-destructive"
              >
                Eliminar
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    [],
  );

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Empleados</h2>
          <p className="text-sm text-muted-foreground">
            {empleados === null ? 'Cargando...' : `${lista.length} en el local`}
          </p>
        </div>
        <Button onClick={() => setCreando(true)}>+ Nuevo empleado</Button>
      </header>

      {error ? (
        <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <DataTable
        data={lista}
        columns={columnas}
        loading={empleados === null && !error}
        rowKey={(e) => e.id}
        empty="Todavia no hay empleados. Crea el primero, o provisioná el local para que venga con los de la plantilla."
      />

      <p className="text-xs text-muted-foreground">
        El <strong>PIN</strong> es para que el empleado entre desde el celular del local
        (staff.clubio.lat). El <strong>email y password</strong> son para el panel del dueno.
        Ninguna de las dos credenciales se puede volver a ver despues de crearla.
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
                ? 'La password no se muestra: si el empleado la perdio, carga una nueva aca.'
                : 'Elegi como va a entrar: con PIN (celular del local) o con email y password.'}
            </DialogDescription>
          </DialogHeader>
          <FormularioEmpleado
            key={editando?.id ?? 'nuevo'}
            negocioId={negocioId}
            empleado={editando}
            onTerminar={async () => {
              setCreando(false);
              setEditando(null);
              await cargar();
            }}
            onCancelar={() => {
              setCreando(false);
              setEditando(null);
            }}
          />
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={aEliminar !== null}
        onOpenChange={(abierto) => {
          if (!abierto) setAEliminar(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar a {aEliminar?.nombre}?</AlertDialogTitle>
            <AlertDialogDescription>
              Sale del local y no puede volver a entrar con su PIN ni con su password.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void eliminar()}
              disabled={borrando}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {borrando ? 'Eliminando...' : 'Eliminar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** 6 digitos con `crypto` (el backend acepta de 4 a 8). */
function generarPin(): string {
  const bytes = new Uint32Array(1);
  let n: number;
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
    // Con noUncheckedIndexedAccess `bytes[0]` es `number | undefined`.
    n = bytes[0] ?? 0;
  } else {
    n = Math.floor(Math.random() * 1_000_000_000);
  }
  return String(100_000 + (n % 900_000));
}

/** Alta y edicion comparten formulario: `empleado` null = alta. */
function FormularioEmpleado({
  negocioId,
  empleado,
  onTerminar,
  onCancelar,
}: {
  negocioId: string;
  empleado: EmpleadoLocal | null;
  onTerminar: () => void | Promise<void>;
  onCancelar: () => void;
}) {
  const [nombre, setNombre] = React.useState(empleado?.nombre ?? '');
  const [rol, setRol] = React.useState<RolEmpleado>(empleado?.rol ?? 'ENCARGADO');
  const [via, setVia] = React.useState<ViaAcceso>(empleado?.email ? 'password' : 'pin');
  const [email, setEmail] = React.useState(empleado?.email ?? '');
  const [password, setPassword] = React.useState('');
  const [pin, setPin] = React.useState(() => generarPin());
  const [activo, setActivo] = React.useState(empleado?.activo ?? true);
  const [guardando, setGuardando] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const editando = empleado !== null;
  const pinValido = /^\d{4,8}$/.test(pin);
  const emailValido = /.+@.+\..+/.test(email.trim());
  // En el ALTA la credencial es obligatoria; en la EDICION la password vacia significa
  // "no la toques" (y el body no la manda).
  const credencialOk = editando
    ? true
    : via === 'pin'
      ? pinValido
      : emailValido && password.length >= 6;
  const puedeGuardar = nombre.trim().length >= 2 && credencialOk && !guardando;

  async function guardar(evento: React.FormEvent) {
    evento.preventDefault();
    if (!puedeGuardar) return;
    setGuardando(true);
    setError(null);
    try {
      if (editando) {
        await superadminApi.actualizarEmpleado(negocioId, empleado.id, {
          nombre: nombre.trim(),
          rol,
          activo,
          ...(email.trim() !== '' ? { email: email.trim() } : {}),
          // La password solo viaja si el operador escribio una nueva.
          ...(password !== '' ? { password } : {}),
        });
        toast.success('Empleado actualizado');
      } else {
        await superadminApi.crearEmpleado(negocioId, {
          nombre: nombre.trim(),
          rol,
          ...(via === 'pin'
            ? { pin }
            : { email: email.trim(), password }),
        });
        toast.success(`${nombre.trim()} quedo creado`);
      }
      await onTerminar();
    } catch (e) {
      const { status, mensaje } = normalizarError(e);
      setError(
        status === 409
          ? via === 'pin'
            ? `${mensaje} Ese PIN ya lo usa otro empleado: genera otro.`
            : `${mensaje} Puede que ese email ya este en uso.`
          : mensaje,
      );
    } finally {
      setGuardando(false);
    }
  }

  return (
    <form onSubmit={guardar} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="emp-nombre">Nombre</Label>
        <Input
          id="emp-nombre"
          value={nombre}
          onChange={(e) => setNombre(e.target.value.slice(0, 120))}
          placeholder="Maria Encargada"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="emp-rol">Rol</Label>
        <Select value={rol} onValueChange={(v) => setRol(v as RolEmpleado)}>
          <SelectTrigger id="emp-rol">
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

      {!editando ? (
        <fieldset className="space-y-3 rounded-xl border p-4">
          <legend className="px-1 text-sm font-medium">Como entra</legend>
          <RadioGroup
            value={via}
            onValueChange={(v) => setVia(v as ViaAcceso)}
            className="gap-3"
            aria-label="Como entra el empleado"
          >
            <label htmlFor="via-pin" className="flex items-center gap-2 text-sm">
              <RadioGroupItem id="via-pin" value="pin" />
              PIN (celular del local)
            </label>
            <label htmlFor="via-password" className="flex items-center gap-2 text-sm">
              <RadioGroupItem id="via-password" value="password" />
              Email y password (panel del dueno)
            </label>
          </RadioGroup>
        </fieldset>
      ) : null}

      {via === 'pin' && !editando ? (
        <div className="space-y-2">
          <Label htmlFor="emp-pin">PIN de ingreso (4 a 8 digitos)</Label>
          <div className="flex gap-2">
            <Input
              id="emp-pin"
              type="password"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
              inputMode="numeric"
              autoComplete="new-password"
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

      {via === 'password' || editando ? (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="emp-email">Email</Label>
            <Input
              id="emp-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value.slice(0, 120))}
              autoCapitalize="none"
              spellCheck={false}
              placeholder="empleado@local.com"
              required={via === 'password' && !editando}
            />
            {via === 'password' && !emailValido && email !== '' ? (
              <p role="alert" className="text-xs text-destructive">
                Ese email no parece valido.
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="emp-password">
              {editando ? 'Password nueva (opcional)' : 'Password'}
            </Label>
            <Input
              id="emp-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              placeholder={editando ? 'Dejala vacia para no cambiarla' : '••••••••'}
              required={via === 'password' && !editando}
            />
            <p className="text-xs text-muted-foreground">
              {editando
                ? 'Se guarda hasheada y no se puede volver a ver. Vacia = no se toca.'
                : 'Se muestra mientras la escribis y despues no se puede volver a leer.'}
            </p>
          </div>
        </div>
      ) : null}

      {editando ? (
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="emp-activo">Activo</Label>
          <Switch id="emp-activo" checked={activo} onCheckedChange={setActivo} />
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
          {guardando ? 'Guardando...' : editando ? 'Guardar cambios' : 'Crear empleado'}
        </Button>
      </DialogFooter>
    </form>
  );
}
