'use client'

import * as React from 'react';
import { useTenant } from '@/hooks/useTenant';
import { rutaDe } from '@/lib/tenant';
import Link from 'next/link';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, Badge, BottomSheet, Button, Input, Label,
  Skeleton, Switch, Tabs, TabsList, TabsTrigger, Textarea, buttonVariants, toast,
} from '@repo/ui';
import { useEmpleado } from '@/hooks/useEmpleado';
import { cartaApi } from '@/lib/api';
import { normalizarError } from '@/lib/errores';
import { SubirImagen } from '@/components/media/SubirImagen';
import type { GrupoCarta, ItemCarta } from '@/types/api';

/** Roles que ya administraban la carta (el baseline del backend: DUENO + ENCARGADO). */
const ROLES_EDITORES = ['DUENO', 'ENCARGADO'];

/**
 * Carta del staff: lista + disponibilidad + edicion, y el PAQUETE COMPLETO para quien lo tenga.
 *
 * Dos niveles, y el backend es la verdad de los dos:
 *
 * 1. **DUENO/ENCARGADO** (`ROLES_EDITORES`): precio, descripcion y disponibilidad. Es lo que hacia
 *    esta pantalla y el backend lo mantiene igual (`@PermiteSi('editar_carta')` con baseline
 *    DUENO+ENCARGADO). No ve foto, alta, baja ni reordenar: `POST /media/firmar-subida` le
 *    responderia 403.
 * 2. **Paquete completo** (`puedeEditarCarta`, lo prende el dueno en Personal): exactamente lo que
 *    hace el dueno sobre la carta -> precio, descripcion, disponibilidad, **foto**, **crear**,
 *    **eliminar** y **reordenar**.
 *
 * Ojo con el responsive: los formularios largos van en `BottomSheet` (no `Dialog`) y NO se le
 * agrega `w-max` a los `TabsList` (desborda el documento a 375px).
 *
 * Dos cosas mas que la pantalla NO puede asumir: la feature que habilita la carta se llama
 * **'menu'** (no 'carta') y ademas el negocio tiene el flag `configuracion.menuActivo`; y
 * `PATCH /:id/disponibilidad` toca el item del NEGOCIO, asi que apagarlo lo saca de TODAS las
 * sucursales.
 *
 * Quien no es editor ve el aviso; el backend responde 403 igual (la UI es comodidad, el guard es
 * la verdad).
 */
export default function CartaPage() {
  const { empleado, negocio } = useEmpleado();
  const [grupos, setGrupos] = React.useState<GrupoCarta[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [categoria, setCategoria] = React.useState('todas');
  const [busqueda, setBusqueda] = React.useState('');
  const [editando, setEditando] = React.useState<ItemCarta | null>(null);
  const [creando, setCreando] = React.useState(false);
  const [aEliminar, setAEliminar] = React.useState<ItemCarta | null>(null);
  const [borrando, setBorrando] = React.useState(false);

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

  /** Baseline del backend: el rol que ya editaba antes. */
  const esEditor =
    empleado !== null && (ROLES_EDITORES.includes(empleado.rol) || empleado.puedeEditarCarta === true);
  /** El paquete completo: el dueno, o el empleado al que el dueno le prendio el permiso. */
  const paqueteCompleto =
    empleado !== null && (empleado.rol === 'DUENO' || empleado.puedeEditarCarta === true);

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
  if (empleado && !esEditor) {
    return (
      <Aviso
        titulo="No podes editar la carta"
        detalle={`Tu rol (${empleado.rol}) puede tomar pedidos y aprobar visitas, pero no cambiar la carta. Si necesitas precios, fotos o items nuevos, pedile al dueno que te habilite "Puede configurar la carta completa" en Personal.`}
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

  /**
   * Mueve un item dentro de SU categoria y renumera el grupo entero (0..n-1) en un solo batch: el
   * `orden` de origen puede empatar, asi el resultado es determinista. Mismo criterio que el admin
   * del dueno.
   */
  async function mover(item: ItemCarta, delta: -1 | 1) {
    const hermanos = lista
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

    try {
      await cartaApi.reordenar(reordenados.map((h, indice) => ({ id: h.id, orden: indice })));
      await refetch();
    } catch (e) {
      const { mensaje } = normalizarError(e);
      toast.error(`No se pudo reordenar. ${mensaje}`);
    }
  }

  async function confirmarEliminar() {
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
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h1 className="text-xl font-semibold">Carta</h1>
          <p className="text-sm text-muted-foreground">
            {disponibles} de {lista.length} items disponibles
          </p>
        </div>
        {paqueteCompleto ? (
          <Button className="min-h-12 shrink-0" onClick={() => setCreando(true)}>
            + Nuevo item
          </Button>
        ) : null}
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
        <p className="py-8 text-center text-sm text-muted-foreground">
          {lista.length === 0 && paqueteCompleto
            ? 'La carta esta vacia. Crea el primer item con "+ Nuevo item".'
            : 'No hay items que coincidan.'}
        </p>
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

      {/* Alta: solo con el paquete completo (el backend responde 403 a quien no lo tenga). */}
      <BottomSheet abierto={creando} onCerrar={() => setCreando(false)} titulo="Nuevo item" altura="completa">
        {creando ? (
          <FormularioItem
            item={null}
            categorias={categorias}
            paqueteCompleto
            onGuardado={async () => {
              setCreando(false);
              await refetch();
            }}
            onCancelar={() => setCreando(false)}
          />
        ) : null}
      </BottomSheet>

      <BottomSheet
        abierto={editando !== null}
        onCerrar={() => setEditando(null)}
        titulo="Editar item"
        altura="completa"
      >
        {editando ? (
          <FormularioItem
            key={editando.id}
            item={editando}
            categorias={categorias}
            paqueteCompleto={paqueteCompleto}
            onGuardado={async () => {
              setEditando(null);
              await refetch();
            }}
            onCancelar={() => setEditando(null)}
            onMover={async (delta) => {
              const actual = editando;
              setEditando(null);
              await mover(actual, delta);
            }}
            onEliminar={(item) => {
              setEditando(null);
              setAEliminar(item);
            }}
          />
        ) : null}
      </BottomSheet>

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
    </main>
  );
}

/**
 * Alta y edicion comparten formulario: `item === null` es alta.
 *
 * `paqueteCompleto` decide que se puede tocar: sin el permiso quedan precio/descripcion/
 * disponibilidad (lo de siempre para un ENCARGADO) y el nombre es de solo lectura.
 */
function FormularioItem({
  item,
  categorias,
  paqueteCompleto,
  onGuardado,
  onCancelar,
  onMover,
  onEliminar,
}: {
  item: ItemCarta | null;
  categorias: string[];
  paqueteCompleto: boolean;
  onGuardado: () => void | Promise<void>;
  onCancelar: () => void;
  onMover?: ((delta: -1 | 1) => void | Promise<void>) | undefined;
  onEliminar?: ((item: ItemCarta) => void) | undefined;
}) {
  const creando = item === null;
  const [nombre, setNombre] = React.useState(item?.nombre ?? '');
  const [categoria, setCategoria] = React.useState(item?.categoria ?? categorias[0] ?? '');
  const [precio, setPrecio] = React.useState(item ? String(item.precio) : '');
  const [descripcion, setDescripcion] = React.useState(item?.descripcion ?? '');
  const [fotoUrl, setFotoUrl] = React.useState(item?.fotoUrl ?? '');
  const [disponible, setDisponible] = React.useState(item?.disponible ?? true);
  const [guardando, setGuardando] = React.useState(false);

  const precioNum = Number(precio.replace(',', '.'));
  const precioValido = precio.trim() !== '' && Number.isFinite(precioNum) && precioNum >= 0;
  const cambioPrecio = !creando && precioValido && item !== null && Math.abs(precioNum - item.precio) > 0.004;
  const puedeGuardar =
    precioValido && (!creando || (nombre.trim().length >= 2 && categoria.trim() !== '')) && !guardando;

  async function guardar() {
    if (!puedeGuardar) return;
    setGuardando(true);
    try {
      if (creando) {
        await cartaApi.crear({
          categoria: categoria.trim(),
          nombre: nombre.trim(),
          precio: precioNum,
          descripcion: descripcion.trim(),
          fotoUrl: fotoUrl.trim() === '' ? undefined : fotoUrl.trim(),
          disponible,
        });
        toast.success('Item creado');
      } else if (item) {
        await cartaApi.actualizar(item.id, {
          // Con el paquete completo se mandan tambien nombre/categoria/foto; sin el, solo lo de
          // siempre (precio/descripcion/disponibilidad), que es lo que el backend ya permitia.
          ...(paqueteCompleto
            ? { nombre: nombre.trim(), categoria: categoria.trim(), fotoUrl: fotoUrl.trim() }
            : {}),
          precio: precioNum,
          descripcion: descripcion.trim(),
          disponible,
        });
        toast.success('Item actualizado');
      }
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
      {paqueteCompleto ? (
        <div className="space-y-2">
          <Label htmlFor="nombre">Nombre</Label>
          <Input
            id="nombre"
            value={nombre}
            onChange={(e) => setNombre(e.target.value.slice(0, 120))}
            placeholder="Milanesa napolitana"
          />
        </div>
      ) : (
        <div className="space-y-1">
          <Label>Nombre</Label>
          <p className="text-sm text-muted-foreground">{item?.nombre}</p>
        </div>
      )}

      {paqueteCompleto ? (
        <div className="space-y-2">
          <Label htmlFor="categoria">Categoria</Label>
          <Input
            id="categoria"
            value={categoria}
            onChange={(e) => setCategoria(e.target.value.slice(0, 60))}
            placeholder="Platos principales"
          />
          {categorias.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {categorias.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategoria(c)}
                  className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground"
                >
                  {c}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

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

      {paqueteCompleto ? <SubirImagen valor={fotoUrl} onCambio={setFotoUrl} etiqueta="Foto (opcional)" /> : null}

      <div className="flex items-center justify-between">
        <Label htmlFor="disponible-item">Disponible</Label>
        <Switch id="disponible-item" checked={disponible} onCheckedChange={setDisponible} />
      </div>

      {/* Confirmacion del cambio de precio: es lo unico que el cliente ve al instante. */}
      {cambioPrecio && item ? (
        <p role="status" className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          El precio pasa de ${item.precio.toFixed(2)} a ${precioNum.toFixed(2)} y se ve en la carta del
          cliente apenas guardes.
        </p>
      ) : null}

      {/* Orden y baja: solo con el paquete completo, y solo editando un item que ya existe. */}
      {paqueteCompleto && !creando && item ? (
        <div className="space-y-2 rounded-xl border p-3">
          <p className="text-xs text-muted-foreground">
            Orden dentro de <strong>{item.categoria}</strong>
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              className="min-h-12 flex-1"
              onClick={() => void onMover?.(-1)}
              disabled={guardando}
            >
              Subir
            </Button>
            <Button
              type="button"
              variant="outline"
              className="min-h-12 flex-1"
              onClick={() => void onMover?.(1)}
              disabled={guardando}
            >
              Bajar
            </Button>
          </div>
          <Button
            type="button"
            variant="destructive"
            className="min-h-12 w-full"
            onClick={() => onEliminar?.(item)}
            disabled={guardando}
          >
            Eliminar item
          </Button>
        </div>
      ) : null}

      {/* El boton de guardar queda fijo al pie del sheet: la descripcion tiene textarea y con el
          teclado abierto este boton era el que se iba fuera de la vista (mismo bug que en pedidos
          y en el rechazo de visitas). */}
      <div className="sticky bottom-0 -mx-5 mt-1 border-t border-border bg-background px-5 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-3">
        <div className="flex gap-2">
          {creando ? (
            <Button type="button" variant="outline" className="min-h-12 flex-1" onClick={onCancelar} disabled={guardando}>
              Cancelar
            </Button>
          ) : null}
          <Button className="min-h-12 flex-1" onClick={() => void guardar()} disabled={!puedeGuardar}>
            {guardando ? 'Guardando...' : creando ? 'Crear item' : cambioPrecio ? 'Guardar nuevo precio' : 'Guardar'}
          </Button>
        </div>
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
