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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  toast,
} from '@repo/ui';
import { superadminApi } from '@/lib/api';
import { normalizarError } from '@/lib/errores';
import { itemsDeCarta, empleadosDeLista, borradosDeReset } from '@/lib/normalizar';
import { FormularioLocal } from '@/components/locales/FormularioLocal';
import { FabricaDemo } from '@/components/locales/FabricaDemo';
import { LinksDelLocal } from '@/components/locales/LinksDelLocal';
import type { LocalDetalle } from '@/types/api';

/**
 * Resumen del local: que es, cuanto tiene, y LAS ACCIONES que el operador hace aca
 * (activar/desactivar, resetear el demo, volver a provisionar, editar los datos base).
 *
 * Los contadores se muestran del detalle si el backend los manda; si no, se cuentan de las
 * listas reales de carta y empleados. En ningun caso se estima un numero.
 *
 * "Resetear demo" NO es reversible y borra datos del local: va con confirmacion explicita
 * (AlertDialog, que no se cierra con click afuera) y con el boton en destructive.
 */
export function TabResumen({
  negocioId,
  detalle,
  onRefrescar,
}: {
  negocioId: string;
  detalle: LocalDetalle;
  onRefrescar: () => void | Promise<void>;
}) {
  const [editando, setEditando] = React.useState(false);
  const [fabricando, setFabricando] = React.useState(false);
  const [confirmandoReset, setConfirmandoReset] = React.useState(false);
  const [reseteando, setReseteando] = React.useState(false);
  const [cambiandoEstado, setCambiandoEstado] = React.useState(false);

  // Contadores: del detalle o de las listas reales (best-effort, sin tapar la pantalla con
  // un error si esos endpoints todavia no responden).
  const [conteos, setConteos] = React.useState<{ items: number | null; empleados: number | null }>(
    { items: null, empleados: null },
  );
  const yaVienen = detalle.contadores?.itemsCarta != null && detalle.contadores?.empleados != null;

  React.useEffect(() => {
    if (yaVienen) return;
    let vivo = true;
    void (async () => {
      const [carta, empleados] = await Promise.allSettled([
        superadminApi.carta(negocioId),
        superadminApi.empleados(negocioId),
      ]);
      if (!vivo) return;
      setConteos({
        items: carta.status === 'fulfilled' ? itemsDeCarta(carta.value).length : null,
        empleados: empleados.status === 'fulfilled' ? empleadosDeLista(empleados.value).length : null,
      });
    })();
    return () => {
      vivo = false;
    };
  }, [negocioId, yaVienen]);

  const items = detalle.contadores?.itemsCarta ?? conteos.items;
  const empleados = detalle.contadores?.empleados ?? conteos.empleados;

  const cambiarEstado = React.useCallback(async () => {
    setCambiandoEstado(true);
    try {
      await superadminApi.actualizarLocal(negocioId, { activo: !detalle.activo });
      toast.success(detalle.activo ? 'Local desactivado' : 'Local activado');
      await onRefrescar();
    } catch (e) {
      toast.error(normalizarError(e).mensaje);
    } finally {
      setCambiandoEstado(false);
    }
  }, [negocioId, detalle.activo, onRefrescar]);

  const resetear = React.useCallback(async () => {
    setReseteando(true);
    try {
      const respuesta = await superadminApi.resetDemo(negocioId);
      const b = borradosDeReset(respuesta);
      toast.success('El local volvio a su estado de demo', {
        description: `Se borraron ${b.visitas ?? 0} visitas, ${b.pedidos ?? 0} pedidos y ${b.clientes ?? 0} clientes de prueba. La config, el theme, la carta y los empleados quedaron igual.`,
      });
      setConfirmandoReset(false);
      await onRefrescar();
    } catch (e) {
      toast.error(normalizarError(e).mensaje);
    } finally {
      setReseteando(false);
    }
  }, [negocioId, onRefrescar]);

  return (
    <div className="space-y-5">
      <section className="space-y-4 rounded-2xl border bg-card p-5">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <h2 className="text-lg font-semibold">Datos del local</h2>
            <p className="break-all text-sm text-muted-foreground">
              app.clubio.lat/{detalle.slug}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline">{detalle.plan}</Badge>
            {detalle.activo ? (
              <Badge variant="success">activo</Badge>
            ) : (
              <Badge variant="secondary">inactivo</Badge>
            )}
            {detalle.tieneTheme ? <Badge variant="outline">theme</Badge> : null}
          </div>
        </header>

        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6" data-testid="contadores-local">
          <Contador etiqueta="Items de carta" valor={items} />
          <Contador etiqueta="Empleados" valor={empleados} />
          <Contador etiqueta="Clientes" valor={detalle.contadores?.clientes ?? null} />
          <Contador etiqueta="Visitas" valor={detalle.contadores?.visitas ?? null} />
          <Contador etiqueta="Pedidos" valor={detalle.contadores?.pedidos ?? null} />
          <Contador etiqueta="Sucursales" valor={detalle.contadores?.sucursales ?? null} />
        </dl>

        <dl className="grid gap-3 sm:grid-cols-2">
          <Dato etiqueta="WhatsApp del local" valor={detalle.numeroAtendiente ?? 'Sin cargar'} />
          <Dato etiqueta="Plan" valor={detalle.plan} />
          <div className="space-y-1">
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Colores</dt>
            <dd className="flex items-center gap-2">
              <Swatch color={detalle.colorPrimario} />
              <Swatch color={detalle.colorSecundario} />
              <span className="font-mono text-xs text-muted-foreground">{detalle.colorPrimario}</span>
            </dd>
          </div>
          <Dato etiqueta="Creado" valor={fecha(detalle.creadoEn)} />
        </dl>

        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setFabricando(true)}>Crear demo</Button>
          <Button variant="outline" onClick={() => setEditando(true)}>
            Editar datos
          </Button>
          <Button
            variant="outline"
            onClick={() => void cambiarEstado()}
            disabled={cambiandoEstado}
          >
            {cambiandoEstado ? 'Guardando...' : detalle.activo ? 'Desactivar' : 'Activar'}
          </Button>
          <Button variant="outline" onClick={() => setConfirmandoReset(true)}>
            Resetear demo
          </Button>
        </div>

        {!detalle.activo ? (
          <p role="status" className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            El local esta <strong>inactivo</strong>: el cliente y el personal no pueden entrar.
          </p>
        ) : null}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">Links del local</h2>
        <LinksDelLocal slug={detalle.slug} />
      </section>

      <Dialog open={editando} onOpenChange={setEditando}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar datos del local</DialogTitle>
            <DialogDescription>
              El slug no se cambia: ya esta en la URL y en el QR que el local repartio.
            </DialogDescription>
          </DialogHeader>
          <FormularioLocal
            key={`editar-${detalle.id}-${detalle.nombre}`}
            local={{
              id: detalle.id,
              nombre: detalle.nombre,
              slug: detalle.slug,
              plan: detalle.plan,
              colorPrimario: detalle.colorPrimario,
              colorSecundario: detalle.colorSecundario,
              numeroAtendiente: detalle.numeroAtendiente ?? null,
            }}
            onGuardado={async () => {
              setEditando(false);
              await onRefrescar();
            }}
            onCancelar={() => setEditando(false)}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={fabricando} onOpenChange={setFabricando}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Crear demo de {detalle.nombre}</DialogTitle>
            <DialogDescription>
              Deja el local listo para mostrar: club, carta, personal y un cliente demo.
            </DialogDescription>
          </DialogHeader>
          <FabricaDemo
            local={{ id: detalle.id, nombre: detalle.nombre, slug: detalle.slug }}
            onProvisionado={onRefrescar}
            onListo={async () => {
              setFabricando(false);
              await onRefrescar();
            }}
            onVolver={() => setFabricando(false)}
          />
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={confirmandoReset}
        onOpenChange={(abierto) => {
          if (!abierto) setConfirmandoReset(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Resetear el demo de {detalle.nombre}?</AlertDialogTitle>
            <AlertDialogDescription>
              Borra las visitas, los pedidos, los clientes y las tarjetas de prueba, y vuelve a
              dejar al cliente demo con sus sellos. <strong>No toca</strong> la configuracion, el
              theme, la carta ni los empleados. Es lo que se hace despues de mostrar el local en
              una visita: no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                // AlertDialogAction cierra el dialogo por defecto: se frena para mostrar el
                // estado "Reseteando..." mientras corre la request.
                e.preventDefault();
                void resetear();
              }}
              disabled={reseteando}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {reseteando ? 'Reseteando...' : 'Resetear demo'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Contador({ etiqueta, valor }: { etiqueta: string; valor: number | null }) {
  return (
    <div className="rounded-xl border bg-background p-3">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{etiqueta}</dt>
      <dd className="mt-1 text-xl font-semibold tabular-nums">{valor ?? '—'}</dd>
    </div>
  );
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="space-y-1">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{etiqueta}</dt>
      <dd className="break-words text-sm">{valor}</dd>
    </div>
  );
}

function Swatch({ color }: { color: string }) {
  return (
    <span
      aria-hidden="true"
      className="size-5 rounded-full border"
      style={{ backgroundColor: color }}
    />
  );
}

function fecha(iso: string | null | undefined): string {
  if (!iso) return 'Sin dato';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Sin dato';
  return d.toLocaleDateString('es-AR');
}
