'use client';

/**
 * Pestana "Plan": el plan del local, sus features y el pay-per-use.
 *
 * Tres fuentes, y ninguna se mezcla:
 *  - `GET /superadmin/features` -> el CATALOGO (etiqueta, descripcion, `tipo` booleana/limite y en
 *    que planes viene incluida cada una, con su limite por plan). Es lo que evita apagar por
 *    error algo que el plan ya cubre.
 *  - `GET /superadmin/locales/:id/plan` -> el ESTADO vigente (su plan efectivo, cada feature con
 *    su `habilitada`/`limite`, y si tiene pay-per-use).
 *  - `PATCH .../plan` -> guarda SOLO lo que cambio y devuelve el estado REAL resultante, que es
 *    el que se muestra en el toast.
 *
 * OJO (semantica del backend): las features NO son un override por local; `PATCH .../plan`
 * escribe la fila del PLAN. Cambiar una feature aca afecta a TODOS los locales de ese plan. La
 * UI lo dice de frente para que el operador no crea que toca solo este local.
 *
 * `limite: null` significa SIN LIMITE (ilimitado); un numero es el techo.
 */

import * as React from 'react';
import {
  Badge,
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Switch,
  toast,
} from '@repo/ui';
import { superadminApi } from '@/lib/api';
import { normalizarError } from '@/lib/errores';
import { PLANES } from '@/types/api';
import type {
  ActualizarPlanNegocioBody,
  CambioFeaturePlan,
  EstadoPlanNegocio,
  FeatureCatalogo,
  FeatureEstado,
} from '@/types/api';
import type { PlanLocal } from '@/types/api';

/** Los planes, en el orden que los muestra el selector. */
const PLANES_UI: PlanLocal[] = PLANES;

export function TabPlan({
  negocioId,
  onGuardado,
}: {
  negocioId: string;
  onGuardado?: (() => void | Promise<void>) | undefined;
}) {
  const [catalogo, setCatalogo] = React.useState<FeatureCatalogo[] | null>(null);
  const [estado, setEstado] = React.useState<EstadoPlanNegocio | null>(null);
  const [cargando, setCargando] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  // Borrador editable: se siembra del backend y se pisa con cada guardado exitoso.
  const [plan, setPlan] = React.useState<PlanLocal>('BASIC');
  const [payPerUse, setPayPerUse] = React.useState(false);
  const [feats, setFeats] = React.useState<Record<string, FeatureEstado>>({});
  const [guardando, setGuardando] = React.useState(false);

  const sembrar = React.useCallback((r: EstadoPlanNegocio) => {
    setPlan(r.plan as PlanLocal);
    setPayPerUse(r.payPerUseActivo === true);
    const mapa: Record<string, FeatureEstado> = {};
    for (const [clave, f] of Object.entries(r.features ?? {})) {
      mapa[clave] = { habilitada: f.habilitada === true, limite: f.limite ?? null };
    }
    setFeats(mapa);
  }, []);

  const cargar = React.useCallback(async () => {
    setCargando(true);
    setError(null);
    const [cat, planLocal] = await Promise.allSettled([
      superadminApi.features(),
      superadminApi.planLocal(negocioId),
    ]);

    // El catalogo es de plataforma: si falla, se sigue con las claves que devuelve el estado.
    setCatalogo(cat.status === 'fulfilled' && Array.isArray(cat.value) ? cat.value : []);

    if (planLocal.status === 'fulfilled') {
      sembrar(planLocal.value);
      setEstado(planLocal.value);
    } else {
      const { status, mensaje } = normalizarError(planLocal.reason);
      if (status !== 401) setError(mensaje);
      setEstado(null);
    }
    setCargando(false);
  }, [negocioId, sembrar]);

  React.useEffect(() => {
    void cargar();
  }, [cargar]);

  const claves = React.useMemo(() => {
    const delCatalogo = (catalogo ?? []).map((f) => f.clave);
    const delEstado = Object.keys(feats);
    // Union: primero el catalogo (su orden), despues lo que el backend devuelva y no este.
    return [...delCatalogo, ...delEstado.filter((k) => !delCatalogo.includes(k))];
  }, [catalogo, feats]);

  const catalogoPorClave = React.useMemo(() => {
    const m = new Map<string, FeatureCatalogo>();
    for (const f of catalogo ?? []) m.set(f.clave, f);
    return m;
  }, [catalogo]);

  const habilitadas = Object.values(feats).filter((f) => f.habilitada).length;

  /** Cambios reales contra lo que devolvio el backend (no se manda lo que no cambio). */
  const cambios = React.useMemo<ActualizarPlanNegocioBody>(() => {
    const body: ActualizarPlanNegocioBody = {};
    if (!estado) return body;
    if (plan !== (estado.plan as PlanLocal)) body.plan = plan;
    if (payPerUse !== (estado.payPerUseActivo === true)) body.payPerUseActivo = payPerUse;

    const features: Record<string, CambioFeaturePlan> = {};
    for (const [clave, actual] of Object.entries(feats)) {
      const original = estado.features?.[clave];
      const habOriginal = original?.habilitada === true;
      const limOriginal = original?.limite ?? null;
      const cambio: CambioFeaturePlan = { habilitada: actual.habilitada };
      const habCambio = actual.habilitada !== habOriginal;
      const limCambio = (actual.limite ?? null) !== limOriginal;
      if (limCambio) cambio.limite = actual.limite ?? null;
      if (habCambio || limCambio) features[clave] = cambio;
    }
    if (Object.keys(features).length > 0) body.features = features;
    return body;
  }, [estado, plan, payPerUse, feats]);

  const hayCambios = Object.keys(cambios).length > 0;

  const guardar = React.useCallback(async () => {
    if (!hayCambios) {
      toast.message('No hay cambios para guardar');
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      const r = await superadminApi.actualizarPlan(negocioId, cambios);
      sembrar(r);
      setEstado(r);
      toast.success(`Plan ${r.plan} guardado`, { description: resumenReal(r) });
      await onGuardado?.();
    } catch (e) {
      const { mensaje } = normalizarError(e);
      setError(mensaje);
      toast.error('No se pudo guardar el plan', { description: mensaje });
    } finally {
      setGuardando(false);
    }
  }, [cambios, hayCambios, negocioId, onGuardado, sembrar]);

  if (cargando) return <Skeleton className="h-72 w-full" />;

  return (
    <div className="space-y-5">
      <section className="space-y-5 rounded-2xl border bg-card p-5">
        <header className="space-y-1">
          <h2 className="text-lg font-semibold">Plan del local</h2>
          <p className="text-sm text-muted-foreground">
            El plan define que features tiene el local. Aca abajo ves, feature por feature, en que
            planes viene incluida (lo dice el catalogo) para no apagar algo que el plan cubre.
          </p>
        </header>

        {error ? (
          <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <div className="space-y-2">
          <Label htmlFor="plan-local">Plan del local</Label>
          <Select value={plan} onValueChange={(v) => setPlan(v as PlanLocal)}>
            <SelectTrigger id="plan-local" className="sm:max-w-xs" data-testid="select-plan">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PLANES_UI.map((p) => (
                <SelectItem key={p} value={p}>
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Al guardar un plan nuevo, el backend devuelve las features que ese plan deja vigentes.
          </p>
        </div>

        <div className="flex items-start justify-between gap-4 rounded-xl border bg-background p-4">
          <div className="min-w-0 space-y-0.5">
            <Label htmlFor="pay-per-use">Pay-per-use</Label>
            <p className="text-xs text-muted-foreground">
              Con esto prendido, el local no se bloquea cuando pasa un limite: el excedente se
              factura. Apagado, el limite bloquea el recurso.
            </p>
          </div>
          <Switch
            id="pay-per-use"
            checked={payPerUse}
            onCheckedChange={setPayPerUse}
            data-testid="switch-pay-per-use"
          />
        </div>
      </section>

      <section className="space-y-3">
        <header className="space-y-1">
          <h2 className="text-sm font-medium">Features</h2>
          <p className="text-xs text-muted-foreground" data-testid="conteo-features">
            {habilitadas} de {claves.length} habilitadas en el plan {plan}
          </p>
          {/*
            Esto NO es un override del local: `PATCH .../plan` escribe la fila del PLAN. Se dice de
            frente porque un interruptor aca cambia a todos los locales de ese plan.
          */}
          <p
            role="status"
            className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900"
          >
            Las features son <strong>del plan</strong>: prender o apagar una aca cambia a todos los
            locales que usan <strong>{plan}</strong>. Si solo queres habilitar algo para este local,
            no hay override por local en este motor.
          </p>
        </header>

        {claves.length === 0 ? (
          <p className="rounded-xl border bg-card px-4 py-6 text-sm text-muted-foreground">
            El backend no devolvio features para este local ni un catalogo de plataforma.
          </p>
        ) : (
          <ul className="flex flex-col gap-2" data-testid="lista-features">
            {claves.map((clave) => {
              const cat = catalogoPorClave.get(clave);
              const f = feats[clave] ?? { habilitada: false, limite: null };
              const esLimite = cat?.tipo === 'limite';
              const incluidaEnEstePlan = cat ? cat.planesIncluidos.includes(plan) : null;
              return (
                <li key={clave} className="rounded-xl border bg-card p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <p className="text-sm font-medium">
                        {cat?.etiqueta ?? clave}
                        {esLimite ? (
                          <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                            limite
                          </span>
                        ) : null}
                      </p>
                      {cat?.descripcion ? (
                        <p className="text-xs text-muted-foreground">{cat.descripcion}</p>
                      ) : null}
                      <div className="flex flex-wrap items-center gap-1.5">
                        {cat && cat.planesIncluidos.length > 0 ? (
                          <>
                            <span className="text-xs text-muted-foreground">Incluida en:</span>
                            {cat.planesIncluidos.map((p) => (
                              <Badge key={p} variant="outline">
                                {p}
                              </Badge>
                            ))}
                          </>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            El catalogo no la incluye en ningun plan.
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        {f.habilitada ? 'Habilitada' : 'Apagada'}
                      </span>
                      <Switch
                        checked={f.habilitada}
                        onCheckedChange={(v) =>
                          setFeats((prev) => ({
                            ...prev,
                            [clave]: { habilitada: v, limite: f.limite ?? null },
                          }))
                        }
                        aria-label={`Feature ${cat?.etiqueta ?? clave}`}
                        data-testid={`switch-feature-${clave}`}
                      />
                    </div>
                  </div>

                  {incluidaEnEstePlan === false && f.habilitada ? (
                    <p
                      role="status"
                      className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900"
                    >
                      El plan <strong>{plan}</strong> no la incluye segun el catalogo: si la
                      guardas asi, la habilitas para el plan.
                    </p>
                  ) : null}

                  {esLimite ? (
                    <div className="mt-3 space-y-1">
                      <Label htmlFor={`limite-${clave}`} className="text-xs">
                        Limite por mes
                      </Label>
                      <Input
                        id={`limite-${clave}`}
                        value={f.limite === null ? '' : String(f.limite)}
                        inputMode="numeric"
                        className="max-w-[10rem]"
                        placeholder="Sin limite"
                        data-testid={`limite-${clave}`}
                        onChange={(e) => {
                          const limpio = e.target.value.replace(/[^0-9]/g, '').slice(0, 7);
                          setFeats((prev) => ({
                            ...prev,
                            [clave]: {
                              habilitada: f.habilitada,
                              limite: limpio === '' ? null : Number(limpio),
                            },
                          }));
                        }}
                      />
                      <p className="text-xs text-muted-foreground">
                        Vacio = sin limite. En el catalogo:{' '}
                        {PLANES_UI.map(
                          (p) =>
                            `${p}: ${
                              cat?.limitesPorPlan?.[p] === null ||
                              cat?.limitesPorPlan?.[p] === undefined
                                ? 'sin limite'
                                : cat.limitesPorPlan[p]
                            }`,
                        ).join(' · ')}
                      </p>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="flex flex-wrap items-center justify-end gap-3">
        {hayCambios ? (
          <p role="status" className="text-xs text-muted-foreground">
            Hay cambios sin guardar.
          </p>
        ) : null}
        <Button
          type="button"
          onClick={() => void guardar()}
          disabled={guardando || !hayCambios}
          data-testid="boton-guardar-plan"
        >
          {guardando ? 'Guardando...' : 'Guardar plan y features'}
        </Button>
      </div>
    </div>
  );
}

/** El resumen REAL que devolvio el backend (no una estimacion del panel). */
function resumenReal(r: EstadoPlanNegocio): string {
  const total = Object.keys(r.features ?? {}).length;
  const on = Object.values(r.features ?? {}).filter((f) => f.habilitada === true).length;
  const pago = r.payPerUseActivo === true ? ', pay-per-use activo' : '';
  return `${on} de ${total} features habilitadas${pago}`;
}
