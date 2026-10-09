'use client'

import * as React from 'react';
import { useTenant } from '@/hooks/useTenant';
import { rutaDe } from '@/lib/tenant';
import Link from 'next/link';
import {
  Badge, BottomSheet, Button, Input, Label, Skeleton, Switch, Tabs, TabsList, TabsTrigger,
  Textarea, buttonVariants, toast,
} from '@repo/ui';
import { useEmpleado } from '@/hooks/useEmpleado';
import { cartaApi } from '@/lib/api';
import { normalizarError } from '@/lib/errores';
import type { GrupoCarta, ItemCarta } from '@/types/api';

/** Solo estos roles pueden tocar la carta (el backend usa RolesGuard). */
const ROLES_EDITORES = ['DUENO', 'ENCARGADO'];

/**
 * Carta del staff: lista + disponibilidad + edicion de precio/descripcion.
 *
 * Tres cosas que la pantalla NO puede asumir y por eso chequea antes de dibujar:
 * 1. Los endpoints son de rol DUENO/ENCARGADO: un MESERO recibe 403.
 * 2. La feature que los habilita se llama **'menu'** (no 'carta'), y ademas el
 *    negocio tiene el flag `configuracion.menuActivo`.
 * 3. `PATCH /:id/disponibilidad` toca el item del NEGOCIO: apagarlo lo saca de
 *    TODAS las sucursales, no solo de la activa. La pantalla lo dice.
 */
export default function CartaPage() {
  const { empleado, negocio } = useEmpleado();
  const [grupos, setGrupos] = React.useState<GrupoCarta[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [categoria, setCategoria] = React.useState('todas');
  const [busqueda, setBusqueda] = React.useState('');
  const [editando, setEditando] = React.useState<ItemCarta | null>(null);

  const refetch = React.useCallback(async () => {
    try {
      const r = await cartaApi.admin();
      setGrupos(r.categorias);
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

  const features = (negocio?.features ?? {}) as Record<string, { habilitada?: boolean } | undefined>;
  const configuracion = (negocio?.configuracion ?? {}) as { menuActivo?: boolean };

  /**
   * Reemplaza un item dentro de su grupo (el estado vive agrupado).
   *
   * OJO: este hook va ANTES de los early returns de abajo. Estaba despues, asi que en un plan
   * SIN el modulo de menu (o con un rol no editor) el contador de hooks cambiaba entre el primer
   * render (features/empleado todavia cargando -> llega hasta aca) y el siguiente (ya resueltos
   * -> return temprano) y React cortaba con #310. Lo cazo `eslint-plugin-react-hooks` al
   * cablearlo en la PWA Staff.
   */
  const parchearItem = React.useCallback((id: string, cambios: Partial<ItemCarta>) => {
    setGrupos((actual) =>
      (actual ?? []).map((g) => ({ ...g, items: g.items.map((i) => (i.id === id ? { ...i, ...cambios } : i)) })),
    );
  }, []);

  if (negocio && features.menu?.habilitada !== true) {
    return <Aviso titulo="Tu plan no incluye carta digital" detalle="Pedile al dueno que active el modulo de menu." />;
  }
  if (empleado && !ROLES_EDITORES.includes(empleado.rol)) {
    return (
      <Aviso
        titulo="Solo el dueno o el encargado editan la carta"
        detalle={`Tu rol (${empleado.rol}) puede tomar pedidos y aprobar visitas, pero no cambiar precios ni disponibilidad.`}
      />
    );
  }

  const lista = (grupos ?? []).flatMap((g) => g.items);
  const categorias = (grupos ?? []).map((g) => g.categoria);
  const q = busqueda.trim().toLowerCase();
  const visibles = (grupos ?? [])
    .filter((g) => categoria === 'todas' || g.categoria === categoria)
    .map((g) => ({ ...g, items: q ? g.items.filter((i) => i.nombre.toLowerCase().includes(q)) : g.items }))
    .filter((g) => g.items.length > 0);
  const disponibles = lista.filter((i) => i.disponible).length;

  /** Toggle optimista con rollback: si el PATCH falla, el switch vuelve solo. */
  async function alternar(item: ItemCarta) {
    const nuevo = !item.disponible;
    parchearItem(item.id, { disponible: nuevo });
    try {
      await cartaApi.disponibilidad(item.id, nuevo);
    } catch (e) {
      const { mensaje } = normalizarError(e);
      parchearItem(item.id, { disponible: item.disponible });
      toast.error(`No se pudo cambiar ${item.nombre}. ${mensaje}`);
    }
  }

  if (grupos === null && !error) {
    return (
      <main className="space-y-3 p-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </main>
    );
  }

  if (error && grupos === null) {
    return (
      <main className="flex flex-col items-center gap-3 p-6 text-center">
        <p className="font-medium">No pudimos traer la carta</p>
        <p className="text-sm text-muted-foreground">{error}</p>
        <Button className="min-h-12" onClick={() => void refetch()}>
          Reintentar
        </Button>
      </main>
    );
  }

  return (
    <main className="space-y-3 p-4">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Carta</h1>
        <p className="text-sm text-muted-foreground">
          {disponibles} de {lista.length} items disponibles
        </p>
      </header>

      {configuracion.menuActivo === false ? (
        <p role="status" className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          El menu esta apagado para los clientes (configuracion del local). Los cambios se guardan igual.
        </p>
      ) : null}

      <Input
        value={busqueda}
        onChange={(e) => setBusqueda(e.target.value)}
        placeholder="Buscar por nombre"
        autoCapitalize="none"
      />

      {categorias.length > 1 ? (
        <Tabs value={categoria} onValueChange={setCategoria}>
          <TabsList className="gap-1">
            <TabsTrigger value="todas">Todas</TabsTrigger>
            {categorias.map((c) => (
              <TabsTrigger key={c} value={c}>
                {c}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      ) : null}

      {visibles.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">No hay items que coincidan.</p>
      ) : (
        visibles.map((grupo) => (
          <section key={grupo.categoria} className="space-y-2">
            <h2 className="pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {grupo.categoria}
            </h2>
            <ul className="space-y-2">
              {grupo.items.map((item) => (
                <li key={item.id} className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3">
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setEditando(item)}>
                    <p className="truncate text-sm font-medium">{item.nombre}</p>
                    <p className="text-xs text-muted-foreground">${item.precio.toFixed(2)}</p>
                  </button>
                  <Badge
                    variant="outline"
                    className={
                      item.disponible
                        ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
                        : 'border-red-300 bg-red-50 text-red-900'
                    }
                  >
                    {item.disponible ? 'Disponible' : 'Agotado'}
                  </Badge>
                  <Switch
                    checked={item.disponible}
                    onCheckedChange={() => void alternar(item)}
                    aria-label={`Disponibilidad de ${item.nombre}`}
                  />
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      <p className="text-xs text-muted-foreground">
        Apagar un item lo saca de la carta de <strong>todas</strong> las sucursales: la
        disponibilidad es del negocio, no de una sucursal.
      </p>

      <BottomSheet abierto={editando !== null} onCerrar={() => setEditando(null)} titulo="Editar item">
        {editando ? (
          <FormularioItem
            key={editando.id}
            item={editando}
            onGuardado={async () => {
              setEditando(null);
              await refetch();
            }}
          />
        ) : null}
      </BottomSheet>
    </main>
  );
}

function FormularioItem({ item, onGuardado }: { item: ItemCarta; onGuardado: () => void | Promise<void> }) {
  const [precio, setPrecio] = React.useState(String(item.precio));
  const [descripcion, setDescripcion] = React.useState(item.descripcion ?? '');
  const [disponible, setDisponible] = React.useState(item.disponible);
  const [guardando, setGuardando] = React.useState(false);

  const precioNum = Number(precio.replace(',', '.'));
  const precioValido = precio.trim() !== '' && Number.isFinite(precioNum) && precioNum >= 0;
  const cambioPrecio = precioValido && Math.abs(precioNum - item.precio) > 0.004;

  async function guardar() {
    if (!precioValido) return;
    setGuardando(true);
    try {
      await cartaApi.actualizar(item.id, {
        precio: precioNum,
        descripcion: descripcion.trim(),
        disponible,
      });
      toast.success('Item actualizado');
      await onGuardado();
    } catch (e) {
      const { mensaje } = normalizarError(e);
      toast.error(`No se pudo guardar. ${mensaje}`);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="space-y-4 pb-2">
      <div className="space-y-1">
        <Label>Nombre</Label>
        <p className="text-sm text-muted-foreground">{item.nombre}</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="precio">Precio</Label>
        <Input
          id="precio"
          value={precio}
          onChange={(e) => setPrecio(e.target.value.replace(/[^0-9.,]/g, ''))}
          inputMode="decimal"
          className="text-lg"
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

      <div className="flex items-center justify-between">
        <Label htmlFor="disponible-item">Disponible</Label>
        <Switch id="disponible-item" checked={disponible} onCheckedChange={setDisponible} />
      </div>

      {/* Confirmacion del cambio de precio: es lo unico que el cliente ve al instante. */}
      {cambioPrecio ? (
        <p role="status" className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          El precio pasa de ${item.precio.toFixed(2)} a ${precioNum.toFixed(2)} y se ve en la carta
          del cliente apenas guardes.
        </p>
      ) : null}

      {/* El boton de guardar queda fijo al pie del sheet: la descripcion tiene textarea y con el
          teclado abierto este boton era el que se iba fuera de la vista (mismo bug que en pedidos
          y en el rechazo de visitas). */}
      <div className="sticky bottom-0 -mx-5 mt-1 border-t border-border bg-background px-5 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-3">
        <Button className="min-h-12 w-full" onClick={() => void guardar()} disabled={!precioValido || guardando}>
          {guardando ? 'Guardando...' : cambioPrecio ? 'Guardar nuevo precio' : 'Guardar'}
        </Button>
      </div>
    </div>
  );
}

function Aviso({ titulo, detalle }: { titulo: string; detalle: string }) {
  const tenant = useTenant();
  return (
    <main className="flex flex-col items-center gap-3 p-6 text-center">
      <p className="font-medium">{titulo}</p>
      <p className="text-sm text-muted-foreground">{detalle}</p>
      <Link href={rutaDe(tenant, '/turnos')} className={buttonVariants({ variant: 'outline', className: 'min-h-12' })}>
        Volver a turnos
      </Link>
    </main>
  );
}
