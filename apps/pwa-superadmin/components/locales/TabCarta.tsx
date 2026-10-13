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
  SubirImagen,
  Switch,
  Textarea,
  toast,
} from '@repo/ui';
import type { DataTableColumn } from '@repo/ui';
import { superadminApi } from '@/lib/api';
import { normalizarError } from '@/lib/errores';
import { itemsDeCarta } from '@/lib/normalizar';
import type { ItemCartaLocal } from '@/types/api';

/**
 * Carta del local, desde el panel de plataforma.
 *
 * Es el mismo listado que ve el dueno en su admin, pero acotado a lo que el operador necesita
 * para dejar el demo presentable: alta, edicion, disponibilidad y baja. Nada de orden ni de
 * fotos (eso es del flujo de carga del local).
 *
 * El precio llega como string ("1500.00"): es un Decimal de Prisma serializado. Se normaliza
 * al mostrar y al editar, no se confia en `Number()` implicito.
 */
export function TabCarta({ negocioId }: { negocioId: string }) {
  const [items, setItems] = React.useState<ItemCartaLocal[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busqueda, setBusqueda] = React.useState('');
  const [creando, setCreando] = React.useState(false);
  const [editando, setEditando] = React.useState<ItemCartaLocal | null>(null);
  const [aEliminar, setAEliminar] = React.useState<ItemCartaLocal | null>(null);
  const [borrando, setBorrando] = React.useState(false);

  const cargar = React.useCallback(async () => {
    try {
      const r = await superadminApi.carta(negocioId);
      setItems(itemsDeCarta(r));
      setError(null);
    } catch (e) {
      const { status, mensaje } = normalizarError(e);
      if (status !== 401) setError(mensaje);
      setItems([]);
    }
  }, [negocioId]);

  React.useEffect(() => {
    void cargar();
  }, [cargar]);

  const lista = React.useMemo(() => items ?? [], [items]);
  const q = busqueda.trim().toLowerCase();
  const visibles = React.useMemo(
    () =>
      lista.filter(
        (i) =>
          q === '' ||
          i.nombre.toLowerCase().includes(q) ||
          i.categoria.toLowerCase().includes(q),
      ),
    [lista, q],
  );
  const categorias = React.useMemo(
    () => Array.from(new Set(lista.map((i) => i.categoria))).filter((c) => c !== ''),
    [lista],
  );

  /** Toggle optimista con rollback: si el PATCH falla, el switch vuelve solo. */
  const alternar = React.useCallback(
    async (item: ItemCartaLocal, disponible: boolean) => {
      setItems((prev) =>
        prev ? prev.map((i) => (i.id === item.id ? { ...i, disponible } : i)) : prev,
      );
      try {
        await superadminApi.actualizarItem(negocioId, item.id, { disponible });
      } catch (e) {
        setItems((prev) =>
          prev ? prev.map((i) => (i.id === item.id ? { ...i, disponible: item.disponible } : i)) : prev,
        );
        toast.error(`No se pudo cambiar ${item.nombre}. ${normalizarError(e).mensaje}`);
      }
    },
    [negocioId],
  );

  const eliminar = React.useCallback(async () => {
    if (!aEliminar) return;
    setBorrando(true);
    try {
      await superadminApi.eliminarItem(negocioId, aEliminar.id);
      toast.success(`Se elimino ${aEliminar.nombre}`);
      setAEliminar(null);
      await cargar();
    } catch (e) {
      toast.error(`No se pudo eliminar ${aEliminar.nombre}. ${normalizarError(e).mensaje}`);
    } finally {
      setBorrando(false);
    }
  }, [aEliminar, negocioId, cargar]);

  const columnas: DataTableColumn<ItemCartaLocal>[] = React.useMemo(
    () => [
      {
        key: 'nombre',
        header: 'Item',
        render: (i) => (
          <div className="flex min-w-0 items-center gap-3">
            <Miniatura fotoUrl={i.fotoUrl ?? null} nombre={i.nombre} />
            <div className="min-w-0">
              <p className="truncate font-medium">{i.nombre}</p>
              {i.descripcion ? (
                <p className="truncate text-xs text-muted-foreground">{i.descripcion}</p>
              ) : null}
            </div>
          </div>
        ),
      },
      {
        key: 'categoria',
        header: 'Grupo',
        render: (i) => (
          <Badge variant="outline" className="whitespace-nowrap">
            {i.categoria}
          </Badge>
        ),
      },
      {
        key: 'precio',
        header: 'Precio',
        className: 'whitespace-nowrap',
        render: (i) => <span className="tabular-nums">${precioTexto(i.precio)}</span>,
      },
      {
        key: 'disponible',
        header: 'Disponible',
        render: (i) => (
          <div className="flex items-center gap-2">
            <Switch
              checked={i.disponible}
              onCheckedChange={(v) => void alternar(i, v)}
              aria-label={`Disponibilidad de ${i.nombre}`}
            />
            <span className="text-xs text-muted-foreground">{i.disponible ? 'Si' : 'No'}</span>
          </div>
        ),
      },
      {
        key: 'acciones',
        header: '',
        className: 'w-10',
        render: (i) => (
          // Se estila el TRIGGER y no un Button adentro: sin `asChild` (no hay
          // @radix-ui/react-slot) un <button> dentro de otro <button> es HTML invalido.
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={`Acciones de ${i.nombre}`}
              className="rounded-lg px-2 py-1 text-lg leading-none text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              ⋯
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setEditando(i)}>Editar</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => setAEliminar(i)}
                className="text-destructive focus:text-destructive"
              >
                Eliminar
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    [alternar],
  );

  const disponibles = lista.filter((i) => i.disponible).length;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Carta</h2>
          <p className="text-sm text-muted-foreground">
            {items === null
              ? 'Cargando...'
              : `${disponibles} de ${lista.length} items disponibles`}
          </p>
        </div>
        <Button onClick={() => setCreando(true)}>+ Nuevo item</Button>
      </header>

      {error ? (
        <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <Input
        value={busqueda}
        onChange={(e) => setBusqueda(e.target.value)}
        placeholder="Buscar por nombre o grupo"
        autoCapitalize="none"
        className="max-w-xs"
        aria-label="Buscar en la carta"
      />

      <DataTable
        data={visibles}
        columns={columnas}
        loading={items === null && !error}
        rowKey={(i) => i.id}
        empty={
          lista.length === 0
            ? 'La carta esta vacia. Crea el primer item con "+ Nuevo item", o provisioná el local para que venga con la carta de la plantilla.'
            : 'No hay items que coincidan con la busqueda.'
        }
      />

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
            <DialogTitle>{editando ? 'Editar item' : 'Nuevo item'}</DialogTitle>
            <DialogDescription>
              {editando
                ? 'Los cambios se ven en la carta del cliente apenas guardes.'
                : 'Se agrega al final de su grupo.'}
            </DialogDescription>
          </DialogHeader>
          {/* `key`: al cambiar de item el formulario se remonta con los valores nuevos. */}
          <FormularioItem
            key={editando?.id ?? 'nuevo'}
            negocioId={negocioId}
            item={editando}
            categorias={categorias}
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
            <AlertDialogTitle>Eliminar {aEliminar?.nombre}?</AlertDialogTitle>
            <AlertDialogDescription>
              Deja de verse en la carta del cliente. Si solo lo agotaste por hoy, apaga el
              switch de <strong>Disponible</strong> en vez de borrarlo.
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

/** Precio legible: acepta "1500.00", "1500" o 1500 y siempre muestra 2 decimales. */
export function precioTexto(precio: string | number): string {
  const n = typeof precio === 'number' ? precio : Number(String(precio).replace(',', '.'));
  return Number.isFinite(n) ? n.toFixed(2) : '—';
}

/** Miniatura de la foto del item en la lista. Sin foto: un cuadro vacio, no un hueco. */
function Miniatura({ fotoUrl, nombre }: { fotoUrl?: string | null; nombre: string }) {
  const url = typeof fotoUrl === 'string' && fotoUrl.trim() !== '' ? fotoUrl.trim() : null;
  if (!url) {
    return (
      <span
        aria-hidden="true"
        className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-dashed text-[10px] text-muted-foreground"
        data-testid="sin-foto"
      >
        sin foto
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={`Foto de ${nombre}`}
      loading="lazy"
      className="size-10 shrink-0 rounded-lg border object-cover"
      data-testid="foto-item"
    />
  );
}

/** Alta y edicion comparten formulario: `item` null = alta. */
function FormularioItem({
  negocioId,
  item,
  categorias,
  onTerminar,
  onCancelar,
}: {
  negocioId: string;
  item: ItemCartaLocal | null;
  categorias: string[];
  onTerminar: () => void | Promise<void>;
  onCancelar: () => void;
}) {
  const [nombre, setNombre] = React.useState(item?.nombre ?? '');
  const [categoria, setCategoria] = React.useState(item?.categoria ?? categorias[0] ?? '');
  const [descripcion, setDescripcion] = React.useState(item?.descripcion ?? '');
  const [precio, setPrecio] = React.useState(item ? String(item.precio) : '');
  const [fotoUrl, setFotoUrl] = React.useState(item?.fotoUrl ?? '');
  const [disponible, setDisponible] = React.useState(item?.disponible ?? true);
  const [guardando, setGuardando] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // La firma la pide ESTE panel (sesion de plataforma): el componente de subida es el mismo
  // que usa el admin del dueno, pero cada app le inyecta su propio endpoint de firma.
  const firmar = React.useCallback((tipo: string) => superadminApi.firmarSubida({ tipo }), []);
  const mensajeDeError = React.useCallback((e: unknown) => normalizarError(e).mensaje, []);

  const precioNum = Number(precio.replace(',', '.'));
  const precioValido = precio.trim() !== '' && Number.isFinite(precioNum) && precioNum >= 0;
  const puedeGuardar =
    nombre.trim().length >= 2 && categoria.trim().length >= 2 && precioValido && !guardando;

  async function guardar(evento: React.FormEvent) {
    evento.preventDefault();
    if (!puedeGuardar) return;
    setGuardando(true);
    setError(null);
    try {
      const body = {
        nombre: nombre.trim(),
        categoria: categoria.trim(),
        precio: precioNum,
        disponible,
        ...(descripcion.trim() !== '' ? { descripcion: descripcion.trim() } : {}),
        ...(fotoUrl.trim() !== '' ? { fotoUrl: fotoUrl.trim() } : {}),
      };
      if (item) await superadminApi.actualizarItem(negocioId, item.id, body);
      else await superadminApi.crearItem(negocioId, body);
      toast.success(item ? 'Item actualizado' : 'Item creado');
      await onTerminar();
    } catch (e) {
      setError(normalizarError(e).mensaje);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <form onSubmit={guardar} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="item-nombre">Nombre</Label>
        <Input
          id="item-nombre"
          value={nombre}
          onChange={(e) => setNombre(e.target.value.slice(0, 120))}
          placeholder="Milanesa napolitana"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="item-grupo">Grupo / categoria</Label>
        {/* `list` (datalist nativo): sugiere los que ya existen y deja escribir uno nuevo. */}
        <Input
          id="item-grupo"
          value={categoria}
          onChange={(e) => setCategoria(e.target.value.slice(0, 60))}
          list="grupos-carta"
          placeholder="Platos principales"
          required
        />
        <datalist id="grupos-carta">
          {categorias.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </div>

      <div className="space-y-2">
        <Label htmlFor="item-precio">Precio</Label>
        <Input
          id="item-precio"
          value={precio}
          onChange={(e) => setPrecio(e.target.value.replace(/[^0-9.,]/g, ''))}
          inputMode="decimal"
          placeholder="1500"
          required
        />
        {!precioValido && precio.trim() !== '' ? (
          <p role="alert" className="text-xs text-destructive">
            El precio tiene que ser un numero mayor o igual a 0.
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="item-desc">Descripcion (opcional)</Label>
        <Textarea
          id="item-desc"
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value.slice(0, 1000))}
          placeholder="Como lo ve el cliente en la carta"
        />
      </div>

      <div className="space-y-2">
        <SubirImagen
          valor={fotoUrl}
          onCambio={setFotoUrl}
          etiqueta="Foto (opcional)"
          firmar={firmar}
          mensajeDeError={mensajeDeError}
        />
      </div>

      <div className="flex items-center justify-between gap-4">
        <Label htmlFor="item-disponible">Disponible</Label>
        <Switch id="item-disponible" checked={disponible} onCheckedChange={setDisponible} />
      </div>

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
          {guardando ? 'Guardando...' : item ? 'Guardar cambios' : 'Crear item'}
        </Button>
      </DialogFooter>
    </form>
  );
}
