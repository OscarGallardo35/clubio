'use client';

import * as React from 'react';
import { Button, DialogFooter, toast } from '@repo/ui';
import { superadminApi } from '@/lib/api';
import { normalizarError } from '@/lib/errores';
import { creadoDeProvision } from '@/lib/normalizar';
import type { CreadoEnProvision } from '@/lib/normalizar';
import { EMPLEADOS_DEMO, PLANTILLAS, SELLOS_CLIENTE_DEMO, plantillaPorId } from '@/lib/plantillas';
import { LinksDelLocal } from '@/components/locales/LinksDelLocal';
import type { PlantillaDemo } from '@/types/api';

export interface LocalDemo {
  id: string;
  nombre: string;
  slug: string;
}

/**
 * LA FABRICA: deja un local listo para la demo con un click.
 *
 * Es la pantalla que el operador usa para VENDER, asi que el flujo es deliberadamente corto:
 * 1. elegir plantilla (una de cuatro, con la carta de cada una a la vista),
 * 2. ver QUE va a crear (antes de tocar nada),
 * 3. un boton grande de Provisionar,
 * 4. y al terminar, el resumen REAL de lo creado + los tres links con su boton de copiar.
 *
 * Antes de provisionar los numeros se muestran APROXIMADOS (van con "~") porque la plantilla
 * la define el backend; despues se muestran los REALES que devuelve la respuesta. Nunca se
 * inventa un conteo y se presenta como dato.
 *
 * El endpoint es idempotente: volver a provisionar no duplica. Igual el boton pide elegir la
 * plantilla de nuevo (no reintenta solo), para que un doble click no cambie lo que el
 * operador creia que estaba creando.
 */
export function FabricaDemo({
  local,
  onProvisionado,
  onListo,
  onVolver,
  etiquetaVolver = 'Cancelar',
}: {
  local: LocalDemo;
  /**
   * Se llama DESPUES de provisionar, sin cerrar nada: sirve para refrescar listados/detalle
   * por detras mientras el operador mira el resultado (los links).
   *
   * OJO — NO se llama a `onListo` aca: cerrar el dialogo al terminar esconde justo lo que el
   * operador vino a buscar (el resumen y los links para vender).
   */
  onProvisionado?: (() => void | Promise<void>) | undefined;
  /** Se llama cuando el operador toca "Listo" (cerrar el dialogo / irse de la pantalla). */
  onListo?: (() => void | Promise<void>) | undefined;
  /** Se llama al cerrar sin provisionar (opcional). */
  onVolver?: (() => void) | undefined;
  /** Texto del boton de salida. En la pagina de demos es "Volver" (no cancela nada). */
  etiquetaVolver?: string | undefined;
}) {
  const [plantilla, setPlantilla] = React.useState<PlantillaDemo>('lomiteria');
  // Las dos opciones van APAGADAS por defecto: la fabrica SUMA, no pisa, salvo que el operador
  // lo pida explicitamente (borrar la carta o pisar el branding del local son irreversibles).
  const [reemplazarCarta, setReemplazarCarta] = React.useState(false);
  const [forzarTheme, setForzarTheme] = React.useState(false);
  const [enviando, setEnviando] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [resultado, setResultado] = React.useState<ReturnType<typeof creadoDeProvision> | null>(
    null,
  );
  const [yaExistia, setYaExistia] = React.useState(false);

  const elegida = plantillaPorId(plantilla);

  const provisionar = React.useCallback(async () => {
    setEnviando(true);
    setError(null);
    try {
      const respuesta = (await superadminApi.provisionar(local.id, {
        plantilla,
        reemplazarCarta,
        forzarTheme,
      })) as { yaExistia?: boolean } | null;
      setResultado(creadoDeProvision(respuesta));
      setYaExistia(respuesta?.yaExistia === true);
      toast.success(`${local.nombre} quedo listo para la demo`);
      // Refresca lo de atras, pero NO cierra: el resultado (los links) se queda a la vista.
      await onProvisionado?.();
    } catch (e) {
      const { status, mensaje } = normalizarError(e);
      setError(
        status === 404 ? 'No encontramos ese local. Puede que lo hayan eliminado.' : mensaje,
      );
    } finally {
      setEnviando(false);
    }
  }, [local.id, local.nombre, plantilla, reemplazarCarta, forzarTheme, onProvisionado]);

  if (resultado) {
    return (
      <div className="space-y-5">
        <div className="space-y-1">
          <p className="text-sm font-medium text-emerald-700">
            {yaExistia ? 'El demo ya estaba armado' : 'Demo listo'}
          </p>
          <p className="text-sm text-muted-foreground">
            <strong>{local.nombre}</strong> ya tiene todo lo que hay que mostrar.
          </p>
        </div>

        <ResumenCreado resultado={resultado} reemplazarCarta={reemplazarCarta} />

        <div className="space-y-2">
          <p className="text-sm font-medium">Links listos para mostrar</p>
          <LinksDelLocal slug={local.slug} />
        </div>

        <p className="text-xs text-muted-foreground">
          {reemplazarCarta
            ? 'Se reemplazo la carta: quedaron solo los items de esta plantilla.'
            : 'Cada plantilla agrega SU propia carta: si probas dos plantillas seguidas, los items se acumulan (los que ya existian con el mismo nombre se actualizan, no se duplican).'}
        </p>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setResultado(null);
              setError(null);
            }}
          >
            Provisionar otra plantilla
          </Button>
          <Button type="button" onClick={() => void onListo?.()}>
            Listo
          </Button>
        </DialogFooter>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <p className="text-sm font-medium">1. Elegi la plantilla</p>
        <div className="grid gap-2 sm:grid-cols-2" role="group" aria-label="Plantilla de demo">
          {PLANTILLAS.map((p) => {
            const activa = p.id === plantilla;
            return (
              <button
                key={p.id}
                type="button"
                aria-pressed={activa}
                onClick={() => setPlantilla(p.id)}
                className={
                  activa
                    ? 'rounded-xl border-2 border-primary bg-accent/40 p-3 text-left transition-colors'
                    : 'rounded-xl border p-3 text-left transition-colors hover:bg-accent/50'
                }
              >
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="size-3 shrink-0 rounded-full border"
                    style={{ backgroundColor: p.acento }}
                  />
                  <span className="text-sm font-semibold">{p.nombre}</span>
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">{p.ideal}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">2. Esto va a crear</p>
        <ul className="space-y-1.5 rounded-xl border bg-muted/30 p-4 text-sm">
          <FilaQue>
            Carta: {elegida.carta} — <strong>{elegida.items} items</strong>
          </FilaQue>
          <FilaQue>
            Club: {elegida.modo}, <strong>{elegida.sellos} sellos</strong> para “{elegida.premio}”
          </FilaQue>
          <FilaQue>
            <strong>{EMPLEADOS_DEMO} empleados</strong>: el dueno (email y password) y el encargado
            (PIN)
          </FilaQue>
          <FilaQue>
            1 cliente demo con <strong>{SELLOS_CLIENTE_DEMO} sellos</strong>, para mostrar la tarjeta
            en el acto
          </FilaQue>
        </ul>
        <p className="text-xs text-muted-foreground">
          Es idempotente: si el local ya estaba provisionado, no duplica nada. Al terminar se
          muestra el conteo REAL que quedo en el local.
        </p>
      </div>

      <div className="space-y-3">
        <p className="text-sm font-medium">3. Opciones</p>
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border p-3">
          <input
            type="checkbox"
            className="mt-0.5 size-4 shrink-0 accent-primary"
            checked={reemplazarCarta}
            onChange={(e) => setReemplazarCarta(e.target.checked)}
            data-testid="check-reemplazar-carta"
          />
          <span className="space-y-0.5">
            <span className="block text-sm font-medium">Reemplazar la carta</span>
            <span className="block text-xs text-muted-foreground">
              Borra los items que no sean de esta plantilla. Si lo dejas apagado, se SUMAN a la
              carta actual.
            </span>
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border p-3">
          <input
            type="checkbox"
            className="mt-0.5 size-4 shrink-0 accent-primary"
            checked={forzarTheme}
            onChange={(e) => setForzarTheme(e.target.checked)}
            data-testid="check-forzar-theme"
          />
          <span className="space-y-0.5">
            <span className="block text-sm font-medium">Forzar el tema de la plantilla</span>
            <span className="block text-xs text-muted-foreground">
              Si esta apagado y el local ya tiene su propia personalizacion visual, se respeta.
            </span>
          </span>
        </label>
      </div>

      {error ? (
        <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="space-y-2">
        <p className="text-sm font-medium">4. Provisionar</p>
        <Button
          type="button"
          size="lg"
          className="w-full"
          disabled={enviando}
          onClick={() => void provisionar()}
          data-testid="boton-provisionar"
        >
          {enviando ? 'Armando el demo...' : `Provisionar ${elegida.nombre.toLowerCase()}`}
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          Deja el local listo para mostrar: club, carta, personal y un cliente.
        </p>
      </div>

      {onVolver ? (
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onVolver} disabled={enviando}>
            {etiquetaVolver}
          </Button>
        </DialogFooter>
      ) : null}
    </div>
  );
}

function FilaQue({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2">
      <span aria-hidden="true" className="text-emerald-600">
        ✓
      </span>
      <span className="min-w-0">{children}</span>
    </li>
  );
}

/** Los numeros REALES de la provision. Si el backend no los manda, se dice eso, no se estima. */
function ResumenCreado({
  resultado,
  reemplazarCarta,
}: {
  resultado: CreadoEnProvision;
  reemplazarCarta: boolean;
}) {
  const filas: { etiqueta: string; valor: number | null }[] = [
    { etiqueta: 'Items de carta', valor: resultado.itemsCarta },
    { etiqueta: 'Empleados', valor: resultado.empleados },
    { etiqueta: 'Clientes demo', valor: resultado.clientes },
  ];
  const hayDatos = filas.some((f) => f.valor !== null);

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Lo que quedo creado</p>
      {hayDatos ? (
        <dl className="grid grid-cols-3 gap-2" data-testid="resumen-provision">
          {filas.map((f) => (
            <div key={f.etiqueta} className="rounded-xl border bg-card p-3">
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                {f.etiqueta}
              </dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums">{f.valor ?? '—'}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="rounded-xl border bg-card px-4 py-3 text-sm text-muted-foreground">
          El backend confirmo la provision pero no devolvio el detalle de cantidades. Podes
          verlo en las pestanas Carta y Empleados del local.
        </p>
      )}

      {resultado.cartaBorrados !== null ? (
        <p
          role="status"
          data-testid="carta-borrados"
          className="rounded-xl border bg-card px-4 py-3 text-sm text-muted-foreground"
        >
          {reemplazarCarta ? 'Reemplazo de carta: se borraron ' : 'Se borraron '}
          <strong className="text-foreground tabular-nums">{resultado.cartaBorrados}</strong> items
          que no eran de la plantilla.
        </p>
      ) : reemplazarCarta ? (
        <p role="status" className="rounded-xl border bg-card px-4 py-3 text-sm text-muted-foreground">
          Se pidio reemplazar la carta pero el backend no informo cuantos items borro.
        </p>
      ) : null}
    </div>
  );
}
