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
  Switch,
  Tabs,
  TabsList,
  TabsTrigger,
  Textarea,
  toast,
} from '@repo/ui';
import type { DataTableColumn } from '@repo/ui';
import { cartaApi } from '@/lib/api';
import { SubirImagen } from '@/components/media/SubirImagen';
import { useDueno } from '@/hooks/useDueno';
import { normalizarError } from '@/lib/errores';
import type { CartaAdminRespuesta, ItemCartaAdmin } from '@/types/api';

/**
 * Carta del admin: lista, alta, edicion, disponibilidad, orden y baja.
 *
 * Tres cosas que la pantalla no puede asumir (verificadas contra el backend):
 * 1. Las mutaciones estan detras de `PlanGuard` + `@RequiereFeature('menu')`: si el plan no
 *    incluye la carta, el backend responde 403 y se muestra el mensaje tal cual.
 * 2. `PATCH /carta/:id/disponibilidad` toca el item del NEGOCIO: apagarlo lo saca de la carta de
 *    TODAS las sucursales (no hay override de disponibilidad).
 * 3. El orden es POR CATEGORIA: mover un item renumerara su categoria entera y manda el batch
 *    (`POST /carta/reordenar`), asi el resultado es determinista aunque los `orden` originales
 *    empaten.
 */
export default function CartaPage() {
  const { negocio } = useDueno();
  const [datos, setDatos] = React.useState<CartaAdminRespuesta | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [categoria, setCategoria] = React.useState('todas');
  const [busqueda, setBusqueda] = React.useState('');
  const [editando, setEditando] = React.useState<ItemCartaAdmin | null>(null);
  const [creando, setCreando] = React.useState(false);
  const [aEliminar, setAEliminar] = React.useState<ItemCartaAdmin | null>(null);
  const [borrando, setBorrando] = React.useState(false);

  const refetch = React.useCallback(async () => {
    try {
      const r = await cartaApi.admin();
      setDatos(r);
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
    if (error) toast.error('No pudimos traer la carta', { description: error });
  }, [error]);

  // Todos los hooks van ARRIBA del primer return: un hook despues de un early return es un hook
  // condicional (React #310) y el typecheck no lo ve. Ya nos mordio dos veces (ver TROUBLESHOOTING).
  const items = React.useMemo(() => (datos?.categorias ?? []).flatMap((g) => g.items), [datos]);
  const categorias = React.useMemo(() => (datos?.categorias ?? []).map((g) => g.categoria), [datos]);
  const q = busqueda.trim().toLowerCase();
  const visibles = React.useMemo(
    () =>
      items.filter(
        (i) =>
          (categoria === 'todas' || i.categoria === categoria) &&
          (q === '' || i.nombre.toLowerCase().includes(q)),
      ),
    [items, categoria, q],
  );
  const disponibles = items.filter((i) => i.disponible).length;

  /** Toggle optimista con rollback: si el PATCH falla, el switch vuelve solo. */
  const alternar = React.useCallback(async (item: ItemCartaAdmin, disponible: boolean) => {
    setDatos((d) => parchearItem(d, item.id, { disponible }));
    try {
      await cartaApi.disponibilidad(item.id, disponible);
    } catch (e) {
      const { mensaje } = normalizarError(e);
      setDatos((d) => parchearItem(d, item.id, { disponible: item.disponible }));
      toast.error(`No se pudo cambiar ${item.nombre}. ${mensaje}`);
    }
  }, []);

  const mover = React.useCallback(
    async (item: ItemCartaAdmin, delta: -1 | 1) => {
      const hermanos = items
        .filter((i) => i.categoria === item.categoria)
        .sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre));
      const desde = hermanos.findIndex((h) => h.id === item.id);
      const hasta = desde + delta;
      if (desde < 0 || hasta < 0 || hasta >= hermanos.length) return;

      const reordenados = [...hermanos];
      const movido = reordenados[desde];
      if (!movido) return;
      reordenados.splice(desde, 1);
      reordenados.splice(hasta, 0, movido);

      // Se renumera la categoria entera (0..n-1): el `orden` de origen puede empatar.
      const body = reordenados.map((h, indice) => ({ id: h.id, orden: indice }));
      try {
        await cartaApi.reordenar(body);
        await refetch();
      } catch (e) {
        const { mensaje } = normalizarError(e);
        toast.error(`No se pudo reordenar. ${mensaje}`);
      }
    },
    [items, refetch],
  );

  const confirmarEliminar = React.useCallback(async () => {
    if (!aEliminar) return;
    setBorrando(true);
    try {
      await cartaApi.eliminar(aEliminar.id);
      toast.success(`Se elimino ${aEliminar.nombre}`);
      setAEliminar(null);
      await refetch();
    } catch (e) {
      const { mensaje } = normalizarError(e);
      toast.error(`No se pudo eliminar ${aEliminar.nombre}. ${mensaje}`);
    } finally {
      setBorrando(false);
    }
  }, [aEliminar, refetch]);

  const columnas: DataTableColumn<ItemCartaAdmin>[] = React.useMemo(() => {
    const cols: DataTableColumn<ItemCartaAdmin>[] = [];
    if (categoria === 'todas') {
      cols.push({
        key: 'categoria',
        header: 'Categoria',
        render: (i) => (
          <Badge variant="outline" className="whitespace-nowrap">
            {i.categoria}
          </Badge>
        ),
      });
    }
    cols.push({
      key: 'nombre',
      header: 'Item',
      render: (i) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{i.nombre}</p>
          {i.descripcion ? <p className="truncate text-xs text-muted-foreground">{i.descripcion}</p> : null}
        </div>
      ),
    });
    cols.push({
      key: 'precio',
      header: 'Precio',
      className: 'whitespace-nowrap',
      render: (i) => <span className="tabular-nums">${i.precio.toFixed(2)}</span>,
    });
    cols.push({
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
    });
    cols.push({
      key: 'acciones',
      header: '',
      className: 'w-10',
      render: (i) => (
        // Sin `asChild` (no hay @radix-ui/react-slot): se estila el TRIGGER y no un Button
        // adentro. Un <button> dentro de otro <button> es HTML invalido y rompe el click.
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={`Acciones de ${i.nombre}`}
            className="rounded-lg px-2 py-1 text-lg leading-none text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            ⋯
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setEditando(i)}>Editar</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void mover(i, -1)}>Subir</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void mover(i, 1)}>Bajar</DropdownMenuItem>
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
    });
    return cols;
  }, [categoria, alternar, mover]);

  const configuracion = (negocio?.configuracion ?? {}) as { menuActivo?: boolean };

  return (
    <section className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Carta</h1>
          <p className="text-sm text-muted-foreground">
            {datos === null ? 'Cargando...' : `${disponibles} de ${items.length} items disponibles`}
          </p>
        </div>
        <Button onClick={() => setCreando(true)}>+ Nuevo item</Button>
      </header>

      {configuracion.menuActivo === false ? (
        <p role="status" className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          El menu esta apagado para los clientes. Los cambios se guardan igual.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar por nombre"
          autoCapitalize="none"
          className="max-w-xs"
        />
        {categorias.length > 1 ? (
          <Tabs value={categoria} onValueChange={setCategoria}>
            <TabsList className="flex w-max gap-1">
              <TabsTrigger value="todas">Todas</TabsTrigger>
              {categorias.map((c) => (
                <TabsTrigger key={c} value={c}>
                  {c}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        ) : null}
      </div>

      <DataTable
        data={visibles}
        columns={columnas}
        loading={datos === null && !error}
        rowKey={(i) => i.id}
        empty={
          items.length === 0
            ? 'La carta esta vacia. Crea el primer item con "+ Nuevo item".'
            : 'No hay items que coincidan con el filtro.'
        }
      />

      <p className="text-xs text-muted-foreground">
        Apagar un item lo saca de la carta de <strong>todas</strong> las sucursales: la disponibilidad
        es del negocio, no de una sucursal.
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
            <DialogTitle>{editando ? 'Editar item' : 'Nuevo item'}</DialogTitle>
            <DialogDescription>
              {editando
                ? 'Los cambios se ven en la carta del cliente apenas guardes.'
                : 'Se agrega al final de su categoria.'}
            </DialogDescription>
          </DialogHeader>
          {/* `key`: al cambiar de item el formulario se remonta con los valores nuevos. */}
          <FormularioItem
            key={editando?.id ?? 'nuevo'}
            item={editando}
            categorias={categorias}
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
              Deja de verse en la carta del cliente (el sistema lo marca como agotado: los pedidos ya
              hechos lo referencian). Podes volver a prenderlo cuando quieras.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void confirmarEliminar()}
              disabled={borrando}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {borrando ? 'Eliminando...' : 'Eliminar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

/** Reemplaza un item dentro de su grupo (el estado vive agrupado por categoria). */
function parchearItem(
  datos: CartaAdminRespuesta | null,
  id: string,
  cambios: Partial<ItemCartaAdmin>,
): CartaAdminRespuesta | null {
  if (!datos) return datos;
  return {
    ...datos,
    categorias: datos.categorias.map((g) => ({
      ...g,
      items: g.items.map((i) => (i.id === id ? { ...i, ...cambios } : i)),
    })),
  };
}

/** Alta y edicion comparten formulario: `item` null = alta. */
function FormularioItem({
  item,
  categorias,
  onTerminar,
  onCancelar,
}: {
  item: ItemCartaAdmin | null;
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
        descripcion: descripcion.trim() === '' ? undefined : descripcion.trim(),
        precio: precioNum,
        fotoUrl: fotoUrl.trim() === '' ? undefined : fotoUrl.trim(),
        disponible,
      };
      if (item) await cartaApi.actualizar(item.id, body);
      else await cartaApi.crear(body);
      toast.success(item ? 'Item actualizado' : 'Item creado');
      await onTerminar();
    } catch (e) {
      const { mensaje } = normalizarError(e);
      setError(mensaje);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <form onSubmit={guardar} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="nombre">Nombre</Label>
        <Input
          id="nombre"
          value={nombre}
          onChange={(e) => setNombre(e.target.value.slice(0, 120))}
          placeholder="Milanesa napolitana"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="categoria">Categoria</Label>
        {/* `list` (datalist nativo): sugiere las que ya existen y deja escribir una nueva. */}
        <Input
          id="categoria"
          value={categoria}
          onChange={(e) => setCategoria(e.target.value.slice(0, 60))}
          list="categorias-carta"
          placeholder="Platos principales"
          required
        />
        <datalist id="categorias-carta">
          {categorias.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </div>

      <div className="space-y-2">
        <Label htmlFor="precio">Precio</Label>
        <Input
          id="precio"
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
        <Label htmlFor="descripcion">Descripcion (opcional)</Label>
        <Textarea
          id="descripcion"
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value.slice(0, 1000))}
          placeholder="Como lo describis en la carta"
        />
      </div>

      <div className="space-y-2">
        <SubirImagen valor={fotoUrl} onCambio={setFotoUrl} etiqueta="Foto (opcional)" />
      </div>

      <div className="flex items-center justify-between">
        <Label htmlFor="disponible-item">Disponible</Label>
        <Switch id="disponible-item" checked={disponible} onCheckedChange={setDisponible} />
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
