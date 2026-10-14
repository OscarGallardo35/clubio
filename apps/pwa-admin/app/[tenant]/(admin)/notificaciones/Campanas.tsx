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
  BottomSheet,
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
  Textarea,
  toast,
} from '@repo/ui';
import { campanasApi, clientesApi, enviosApi } from '@/lib/api';
import { normalizarError } from '@/lib/errores';
import { renderizarPlantilla } from '@/lib/push';
import type {
  CampanaPush,
  ClienteResumen,
  CrearCampanaBody,
  DatosEjemploPlantilla,
  EnvioPushLogItem,
  EstadoCampanaPush,
  PlantillaPush,
  PreviewCampanaRespuesta,
  SegmentoEnvio,
} from '@/types/api';

/**
 * Campañas de push PROGRAMABLES (pestaña "Campañas" dentro de Notificaciones).
 *
 * Se programan a FECHA Y HORA (hora ARGENTINA: el backend guarda en UTC y esta
 * pantalla siempre muestra en AR) con un publico y EXCLUSIONES. La exclusion solo
 * recorta: por eso el alcance es "~N de M suscritos" y es una ESTIMACION (la base se
 * re-resuelve al momento del envio).
 *
 * Reprogramar/cancelar SOLO se puede mientras la campaña esta `PROGRAMADA`: si ya
 * salio, el backend responde 409 y el boton queda deshabilitado.
 *
 * El detalle por destinatario reusa el Historial de la etapa 1
 * (`GET /push/envios/logs?campanaId=...`).
 */

const TZ_AR = 'America/Argentina/Buenos_Aires';
const OFFSET_AR_MS = 3 * 60 * 60 * 1000;

const ETIQUETA_SEGMENTO: Record<SegmentoEnvio, string> = {
  TODOS: 'Todos',
  PREMIO_DESBLOQUEADO: 'Con premio desbloqueado',
  INACTIVO_30: 'Inactivos +30 dias',
};

const SEGMENTOS: SegmentoEnvio[] = ['TODOS', 'PREMIO_DESBLOQUEADO', 'INACTIVO_30'];
/** Segmentos que se pueden EXCLUIR (el "a todos excepto X"). */
const SEGMENTOS_EXCLUIBLES: SegmentoEnvio[] = ['PREMIO_DESBLOQUEADO', 'INACTIVO_30'];

const ESTADO_ETIQUETA: Record<EstadoCampanaPush, string> = {
  PROGRAMADA: 'Programada',
  ENVIANDO: 'Enviando',
  ENVIADA: 'Enviada',
  CANCELADA: 'Cancelada',
};

/** "15/10/26 18:30" en hora argentina (el ISO crudo si el parseo falla). */
function fechaAR(iso: string): string {
  try {
    return new Date(iso).toLocaleString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: TZ_AR,
    });
  } catch {
    return iso;
  }
}

/** 'YYYY-MM-DDTHH:mm' en hora ARGENTINA de pared (para el input datetime-local). */
function aInputAr(fecha: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const ar = new Date(fecha.getTime() - OFFSET_AR_MS);
  return `${ar.getUTCFullYear()}-${p(ar.getUTCMonth() + 1)}-${p(ar.getUTCDate())}T${p(ar.getUTCHours())}:${p(ar.getUTCMinutes())}`;
}

function estadoBadge(estado: EstadoCampanaPush) {
  if (estado === 'ENVIADA') {
    return (
      <Badge variant="secondary" className="shrink-0 bg-emerald-100 text-emerald-800">
        {ESTADO_ETIQUETA[estado]}
      </Badge>
    );
  }
  if (estado === 'PROGRAMADA') {
    return (
      <Badge variant="secondary" className="shrink-0 bg-amber-100 text-amber-800">
        {ESTADO_ETIQUETA[estado]}
      </Badge>
    );
  }
  if (estado === 'ENVIANDO') {
    return (
      <Badge variant="secondary" className="shrink-0 bg-sky-100 text-sky-800">
        {ESTADO_ETIQUETA[estado]}
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="shrink-0 text-muted-foreground">
      {ESTADO_ETIQUETA[estado]}
    </Badge>
  );
}

/** La campaña ya salio: no se puede reprogramar ni cancelar. */
function yaSalio(c: CampanaPush): boolean {
  return c.estado !== 'PROGRAMADA';
}

export function Campanas({
  plantillas,
  ejemplo,
  endpoint,
  pushActivo,
}: {
  plantillas: PlantillaPush[] | null;
  ejemplo: DatosEjemploPlantilla | null;
  endpoint: string | null;
  pushActivo: boolean;
}) {
  const [campanas, setCampanas] = React.useState<CampanaPush[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [creando, setCreando] = React.useState(false);
  const [detalle, setDetalle] = React.useState<CampanaPush | null>(null);
  const [reprogramando, setReprogramando] = React.useState<CampanaPush | null>(null);
  const [aCancelar, setACancelar] = React.useState<CampanaPush | null>(null);
  const [motivoCancelar, setMotivoCancelar] = React.useState('');
  const [cancelando, setCancelando] = React.useState(false);
  const [tickando, setTickando] = React.useState(false);

  const listaPlantillas = React.useMemo(() => plantillas ?? [], [plantillas]);

  const refetch = React.useCallback(async () => {
    try {
      const r = await campanasApi.listar();
      setCampanas(Array.isArray(r?.data) ? r.data : []);
      setError(null);
    } catch (e) {
      const { status, mensaje } = normalizarError(e);
      if (status !== 401) setError(mensaje);
      setCampanas([]);
    }
  }, []);

  React.useEffect(() => {
    void refetch();
  }, [refetch]);

  React.useEffect(() => {
    if (error) toast.error('No pudimos traer las campañas', { description: error });
  }, [error]);

  const confirmarCancelar = React.useCallback(async () => {
    if (!aCancelar) return;
    setCancelando(true);
    try {
      const r = await campanasApi.cancelar(aCancelar.id, motivoCancelar.trim() || undefined);
      toast.success('Campaña cancelada', {
        description: r?.cupoDevuelto ? 'Se devolvio el cupo del mes.' : undefined,
      });
      setACancelar(null);
      setMotivoCancelar('');
      await refetch();
    } catch (e) {
      const { status, mensaje } = normalizarError(e);
      toast.error(
        status === 409 ? 'La campaña ya salio: no se puede cancelar' : `No se pudo cancelar. ${mensaje}`,
      );
    } finally {
      setCancelando(false);
    }
  }, [aCancelar, motivoCancelar, refetch]);

  /** Despierta el dispatcher a mano (util para "enviar ahora" sin esperar el minuto). */
  const forzarTick = React.useCallback(async () => {
    setTickando(true);
    try {
      const r = await campanasApi.tick();
      toast.success(`Dispatcher: ${r?.enviadas ?? 0} campaña(s) despachada(s) de ${r?.evaluadas ?? 0} vencidas`);
      await refetch();
    } catch (e) {
      toast.error(`No se pudo forzar el envio. ${normalizarError(e).mensaje}`);
    } finally {
      setTickando(false);
    }
  }, [refetch]);

  const programadas = (campanas ?? []).filter((c) => c.estado === 'PROGRAMADA').length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-0.5">
          <p className="text-sm text-muted-foreground">
            {campanas === null
              ? 'Cargando...'
              : `${campanas.length} campaña${campanas.length === 1 ? '' : 's'} · ${programadas} programada${programadas === 1 ? '' : 's'}`}
          </p>
          <p className="text-xs text-muted-foreground">
            Se programan a fecha y hora (hora argentina). El alcance es una estimacion: la base se
            recalcula al momento del envio.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void forzarTick()} disabled={tickando}>
            {tickando ? 'Procesando...' : 'Procesar ahora'}
          </Button>
          <Button onClick={() => setCreando(true)} disabled={listaPlantillas.length === 0 && false}>
            + Nueva campaña
          </Button>
        </div>
      </div>

      {campanas === null && !error ? <Skeleton className="h-40 w-full" /> : null}

      {campanas && campanas.length === 0 ? (
        <p className="rounded-2xl border bg-card p-5 text-sm text-muted-foreground">
          Todavia no hay campañas. Crea la primera con &quot;+ Nueva campaña&quot;: elegis el mensaje,
          a quien le llega, las exclusiones y la fecha y hora.
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {campanas?.map((c) => (
          <article key={c.id} className="space-y-3 rounded-2xl border bg-card p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate text-base font-semibold">{c.nombre}</h2>
                  {estadoBadge(c.estado)}
                </div>
                <p className="truncate text-sm">{c.titulo}</p>
                <p className="text-xs tabular-nums text-muted-foreground">
                  {c.estado === 'PROGRAMADA' || c.estado === 'CANCELADA'
                    ? `Programada para ${fechaAR(c.programadoPara)}`
                    : `Salio ${fechaAR(c.enviadaEn ?? c.programadoPara)}`}
                </p>
              </div>
            </div>

            <ul className="space-y-1 text-xs text-muted-foreground">
              <li>
                Publico: <span className="text-foreground">{ETIQUETA_SEGMENTO[c.segmento]}</span>
              </li>
              {c.exclusiones && (c.exclusiones.clientes.length > 0 || c.exclusiones.segmentos.length > 0) ? (
                <li>
                  Excepto:{' '}
                  <span className="text-foreground">
                    {[
                      c.exclusiones.clientes.length > 0
                        ? `${c.exclusiones.clientes.length} cliente(s)`
                        : null,
                      ...c.exclusiones.segmentos.map((s) => ETIQUETA_SEGMENTO[s] ?? s),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </li>
              ) : (
                <li>Sin exclusiones</li>
              )}
              {c.estado === 'ENVIADA' ? (
                <li className="tabular-nums">
                  Enviada:{' '}
                  <span className="text-foreground">
                    {c.stats.enviados}/{c.stats.total}
                  </span>{' '}
                  {c.stats.fallidos > 0 ? `· ${c.stats.fallidos} fallidos` : ''}
                  {c.stats.sinSuscripcion > 0 ? ` · ${c.stats.sinSuscripcion} sin suscripcion` : ''}
                  {c.stats.suprimidos > 0 ? ` · ${c.stats.suprimidos} excluidos` : ''}
                </li>
              ) : null}
              {c.estado === 'CANCELADA' && c.motivoCancelacion ? (
                <li>Motivo: {c.motivoCancelacion}</li>
              ) : null}
            </ul>

            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => setDetalle(c)}>
                Detalle
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={yaSalio(c)}
                onClick={() => setReprogramando(c)}
              >
                Reprogramar
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-destructive"
                disabled={yaSalio(c)}
                onClick={() => setACancelar(c)}
              >
                Cancelar
              </Button>
            </div>

            {yaSalio(c) && c.estado !== 'CANCELADA' ? (
              <p className="text-[11px] text-muted-foreground">
                Ya salio: no se puede reprogramar ni cancelar.
              </p>
            ) : null}
          </article>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">
        El publico se recalcula <strong>al momento del envio</strong>: la lista de excluidos se respeta
        siempre, pero quien tiene notificaciones activas puede cambiar. Una campaña <strong>programada</strong>{' '}
        se puede reprogramar o cancelar (cancelar devuelve el cupo del mes); una que{' '}
        <strong>ya salio</strong> no.
      </p>

      <BottomSheet
        abierto={creando}
        onCerrar={() => setCreando(false)}
        titulo="Nueva campaña"
        altura="completa"
      >
        <FormularioCampana
          plantillas={listaPlantillas}
          ejemplo={ejemplo}
          endpoint={endpoint}
          pushActivo={pushActivo}
          onTerminar={async () => {
            setCreando(false);
            await refetch();
          }}
          onCancelar={() => setCreando(false)}
        />
      </BottomSheet>

      <BottomSheet
        abierto={reprogramando !== null}
        onCerrar={() => setReprogramando(null)}
        titulo={reprogramando ? `Reprogramar: ${reprogramando.nombre}` : 'Reprogramar'}
        altura="media"
      >
        {reprogramando ? (
          <ReprogramarCampana
            campana={reprogramando}
            onTerminar={async () => {
              setReprogramando(null);
              await refetch();
            }}
            onCancelar={() => setReprogramando(null)}
          />
        ) : null}
      </BottomSheet>

      <BottomSheet
        abierto={detalle !== null}
        onCerrar={() => setDetalle(null)}
        titulo={detalle ? `Detalle: ${detalle.nombre}` : 'Detalle'}
        altura="completa"
      >
        {detalle ? (
          <DetalleCampana
            campana={detalle}
            endpoint={endpoint}
            pushActivo={pushActivo}
            onCambio={async () => {
              await refetch();
            }}
          />
        ) : null}
      </BottomSheet>

      <AlertDialog
        open={aCancelar !== null}
        onOpenChange={(abierto) => {
          if (!abierto) {
            setACancelar(null);
            setMotivoCancelar('');
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar {aCancelar?.nombre}?</AlertDialogTitle>
            <AlertDialogDescription>
              No se va a enviar. Se devuelve el cupo de campañas del mes. Los envios ya realizados no se
              tocan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="c-motivo">Motivo (opcional)</Label>
            <Input
              id="c-motivo"
              value={motivoCancelar}
              onChange={(e) => setMotivoCancelar(e.target.value.slice(0, 120))}
              placeholder="Se cancelo el evento"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Volver</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void confirmarCancelar();
              }}
              disabled={cancelando}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {cancelando ? 'Cancelando...' : 'Cancelar campaña'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ============================================================================
// BUILDER (crear)
// ============================================================================

function FormularioCampana({
  plantillas,
  ejemplo,
  endpoint,
  pushActivo,
  onTerminar,
  onCancelar,
}: {
  plantillas: PlantillaPush[];
  ejemplo: DatosEjemploPlantilla | null;
  endpoint: string | null;
  pushActivo: boolean;
  onTerminar: () => void | Promise<void>;
  onCancelar: () => void;
}) {
  const [nombre, setNombre] = React.useState('');
  const [plantillaId, setPlantillaId] = React.useState('NINGUNA');
  const [titulo, setTitulo] = React.useState('');
  const [cuerpo, setCuerpo] = React.useState('');
  const [url, setUrl] = React.useState('/tarjeta');
  const [segmento, setSegmento] = React.useState<SegmentoEnvio>('TODOS');
  const [excluirSegmentos, setExcluirSegmentos] = React.useState<SegmentoEnvio[]>([]);
  const [excluidos, setExcluidos] = React.useState<ClienteResumen[]>([]);
  const [enviarAhora, setEnviarAhora] = React.useState(false);
  const [programadoPara, setProgramadoPara] = React.useState(aInputAr(new Date()));

  const [busqueda, setBusqueda] = React.useState('');
  const [resultados, setResultados] = React.useState<ClienteResumen[] | null>(null);

  const [preview, setPreview] = React.useState<PreviewCampanaRespuesta | null>(null);
  const [previewError, setPreviewError] = React.useState(false);

  const [guardando, setGuardando] = React.useState(false);
  const [probando, setProbando] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Buscador de clientes para EXCLUIR (mismo patron que la prueba de un disparo).
  React.useEffect(() => {
    let cancelado = false;
    const termino = busqueda.trim();
    if (termino === '') {
      setResultados(null);
      return;
    }
    const t = setTimeout(() => {
      clientesApi
        .listar({ search: termino, pageSize: 20 })
        .then((r) => {
          if (cancelado) return;
          setResultados(Array.isArray(r?.data) ? r.data : []);
        })
        .catch(() => {
          if (cancelado) return;
          setResultados([]);
        });
    }, 300);
    return () => {
      cancelado = true;
      clearTimeout(t);
    };
  }, [busqueda]);

  // Alcance ESTIMADO: se recalcula cuando cambia el publico o las exclusiones.
  const idsExcluidos = React.useMemo(() => excluidos.map((c) => c.id), [excluidos]);
  React.useEffect(() => {
    let cancelado = false;
    const t = setTimeout(() => {
      campanasApi
        .preview({
          segmento,
          ...(idsExcluidos.length ? { excluirClienteIds: idsExcluidos } : {}),
          ...(excluirSegmentos.length ? { excluirSegmentos } : {}),
        })
        .then((r) => {
          if (cancelado) return;
          setPreview(r);
          setPreviewError(false);
        })
        .catch(() => {
          if (cancelado) return;
          setPreview(null);
          setPreviewError(true);
        });
    }, 350);
    return () => {
      cancelado = true;
      clearTimeout(t);
    };
  }, [segmento, idsExcluidos, excluirSegmentos]);

  function usarPlantilla(v: string) {
    setPlantillaId(v);
    const p = plantillas.find((x) => x.id === v);
    if (p) {
      setTitulo(p.titulo);
      setCuerpo(p.cuerpo);
      setUrl(p.url ?? '/tarjeta');
      if (nombre.trim() === '') setNombre(`Campaña: ${p.nombre}`.slice(0, 80));
    }
  }

  function alternarExcluido(c: ClienteResumen) {
    setExcluidos((prev) =>
      prev.some((x) => x.id === c.id) ? prev.filter((x) => x.id !== c.id) : [...prev, c],
    );
  }

  function alternarSegmentoExcluido(s: SegmentoEnvio) {
    setExcluirSegmentos((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  }

  const puedeGuardar =
    nombre.trim().length >= 2 &&
    titulo.trim().length >= 1 &&
    cuerpo.trim().length >= 1 &&
    (enviarAhora || programadoPara.trim() !== '') &&
    !guardando;

  const plantillaElegida = plantillas.find((p) => p.id === plantillaId) ?? null;

  async function probar() {
    if (!endpoint) {
      toast.error('Primero activa las notificaciones en este dispositivo');
      return;
    }
    if (titulo.trim() === '' || cuerpo.trim() === '') {
      toast.error('Completa titulo y mensaje para probar');
      return;
    }
    setProbando(true);
    try {
      await campanasApi.probar({
        endpoint,
        titulo: titulo.trim(),
        cuerpo: cuerpo.trim(),
        ...(url.trim() ? { url: url.trim() } : {}),
      });
      toast.success('Prueba enviada a este dispositivo');
    } catch (e) {
      toast.error(`No se pudo enviar la prueba. ${normalizarError(e).mensaje}`);
    } finally {
      setProbando(false);
    }
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!puedeGuardar) return;
    setGuardando(true);
    setError(null);
    try {
      const body: CrearCampanaBody = {
        nombre: nombre.trim(),
        ...(plantillaId !== 'NINGUNA' ? { plantillaId } : {}),
        titulo: titulo.trim(),
        cuerpo: cuerpo.trim(),
        ...(url.trim() ? { url: url.trim() } : {}),
        segmento,
        programadoPara: enviarAhora ? aInputAr(new Date()) : programadoPara,
        ...(excluidos.length ? { excluirClienteIds: excluidos.map((c) => c.id) } : {}),
        ...(excluirSegmentos.length ? { excluirSegmentos } : {}),
      };
      await campanasApi.crear(body);
      toast.success(enviarAhora ? 'Campaña creada: sale en segundos' : 'Campaña programada');
      await onTerminar();
    } catch (err) {
      setError(normalizarError(err).mensaje);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <form onSubmit={guardar} className="space-y-5 pb-2">
      <div className="space-y-2">
        <Label htmlFor="c-nombre">Nombre interno</Label>
        <Input
          id="c-nombre"
          value={nombre}
          onChange={(e) => setNombre(e.target.value.slice(0, 80))}
          placeholder="Promo del viernes"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="c-plantilla">Mensaje desde una plantilla (opcional)</Label>
        <Select value={plantillaId} onValueChange={usarPlantilla}>
          <SelectTrigger id="c-plantilla">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="NINGUNA">Texto libre</SelectItem>
            {plantillas.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.nombre}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="c-titulo">Titulo</Label>
        <Input
          id="c-titulo"
          value={titulo}
          onChange={(e) => setTitulo(e.target.value.slice(0, 120))}
          placeholder="¡Hoy hay promo!"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="c-cuerpo">Mensaje</Label>
        <Textarea
          id="c-cuerpo"
          value={cuerpo}
          onChange={(e) => setCuerpo(e.target.value.slice(0, 500))}
          placeholder="2x1 en cervezas hasta las 20hs en {{negocio}}."
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="c-url">URL al abrir (deep link)</Label>
        <Input
          id="c-url"
          value={url}
          onChange={(e) => setUrl(e.target.value.slice(0, 200))}
          placeholder="/tarjeta"
          autoCapitalize="none"
          spellCheck={false}
        />
      </div>

      {/* Preview del texto con las variables ya reemplazadas. */}
      <div className="rounded-xl border border-dashed bg-muted/40 p-3">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Preview</p>
        <p className="mt-1 text-sm font-medium">
          {renderizarPlantilla(titulo || '(sin titulo)', ejemplo)}
        </p>
        <p className="text-sm text-muted-foreground">
          {renderizarPlantilla(cuerpo || '(sin mensaje)', ejemplo)}
        </p>
        {plantillaElegida ? (
          <p className="mt-2 text-[11px] text-muted-foreground">
            Plantilla: {plantillaElegida.nombre}
          </p>
        ) : null}
      </div>

      {/* PUBLICO */}
      <div className="space-y-3 rounded-xl border bg-card p-4">
        <div>
          <Label htmlFor="c-segmento">A quien le llega</Label>
          <p className="text-xs text-muted-foreground">
            La base siempre son clientes con notificaciones ACTIVAS. Las exclusiones solo recortan.
          </p>
        </div>
        <Select value={segmento} onValueChange={(v) => setSegmento(v as SegmentoEnvio)}>
          <SelectTrigger id="c-segmento">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SEGMENTOS.map((s) => (
              <SelectItem key={s} value={s}>
                {ETIQUETA_SEGMENTO[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="space-y-2">
          <Label>Excepto (segmentos)</Label>
          <div className="flex flex-wrap gap-2">
            {SEGMENTOS_EXCLUIBLES.map((s) => (
              <Button
                key={s}
                type="button"
                size="sm"
                variant={excluirSegmentos.includes(s) ? 'default' : 'outline'}
                onClick={() => alternarSegmentoExcluido(s)}
              >
                {ETIQUETA_SEGMENTO[s]}
              </Button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="c-buscar">Excepto (clientes)</Label>
          <Input
            id="c-buscar"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por nombre o telefono"
            autoCapitalize="none"
          />
          {excluidos.length > 0 ? (
            <div className="flex flex-wrap gap-2 pt-1">
              {excluidos.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => alternarExcluido(c)}
                  className="inline-flex max-w-full items-center gap-1 rounded-full border bg-muted px-3 py-1 text-xs"
                  aria-label={`Quitar exclusion de ${c.nombre}`}
                >
                  <span className="truncate">{c.nombre}</span>
                  <span aria-hidden="true">×</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Ningun cliente excluido.</p>
          )}
          {resultados && resultados.length > 0 ? (
            <ul className="divide-y rounded-xl border">
              {resultados.slice(0, 8).map((c) => {
                const ya = excluidos.some((x) => x.id === c.id);
                return (
                  <li key={c.id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm">{c.nombre}</p>
                      {c.telefono ? (
                        <p className="truncate text-xs text-muted-foreground">{c.telefono}</p>
                      ) : null}
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant={ya ? 'secondary' : 'outline'}
                      onClick={() => alternarExcluido(c)}
                    >
                      {ya ? 'Excluido' : 'Excluir'}
                    </Button>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      </div>

      {/* ALCANCE ESTIMADO */}
      <div className="space-y-1 rounded-xl border border-dashed bg-muted/40 p-3">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Alcance estimado
        </p>
        {previewError ? (
          <p className="text-sm text-amber-700">No pudimos calcular el alcance. Proba de nuevo.</p>
        ) : preview ? (
          <>
            <p className="text-sm">
              Se enviara a{' '}
              <span className="font-semibold tabular-nums">~{preview.alcanzables}</span> de{' '}
              <span className="tabular-nums">{preview.total}</span> suscritos
            </p>
            <p className="text-xs text-muted-foreground">
              al momento del envio puede variar (el publico se recalcula).
            </p>
            <p className="text-xs tabular-nums text-muted-foreground">
              El local tiene {preview.desglose.clientesNegocio} clientes ·{' '}
              {preview.desglose.sinSuscripcionActiva} sin notificaciones activas
              {preview.desglose.excluidos > 0 ? ` · ${preview.desglose.excluidos} excluidos` : ''}
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Calculando alcance...</p>
        )}
      </div>

      {/* PROGRAMACION */}
      <div className="space-y-3 rounded-xl border bg-card p-4">
        <div className="flex items-center justify-between">
          <Label htmlFor="c-ahora">Enviar ahora</Label>
          <Switch id="c-ahora" checked={enviarAhora} onCheckedChange={setEnviarAhora} />
        </div>
        {!enviarAhora ? (
          <div className="space-y-2">
            <Label htmlFor="c-cuando">Fecha y hora (hora argentina)</Label>
            <Input
              id="c-cuando"
              type="datetime-local"
              value={programadoPara}
              onChange={(e) => setProgramadoPara(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              La campaña sale sola a esa hora, en hora de Argentina.
            </p>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Sale apenas se crea (en segundos).
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          disabled={!pushActivo || probando}
          onClick={() => void probar()}
        >
          {probando ? 'Enviando...' : 'Probar a mi mismo'}
        </Button>
        {!pushActivo ? (
          <p className="self-center text-xs text-amber-700">
            Activa las notificaciones en este dispositivo para probar.
          </p>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onCancelar} disabled={guardando}>
          Cancelar
        </Button>
        <Button type="submit" disabled={!puedeGuardar}>
          {guardando ? 'Guardando...' : enviarAhora ? 'Crear y enviar' : 'Programar campaña'}
        </Button>
      </div>
    </form>
  );
}

// ============================================================================
// REPROGRAMAR
// ============================================================================

function ReprogramarCampana({
  campana,
  onTerminar,
  onCancelar,
}: {
  campana: CampanaPush;
  onTerminar: () => void | Promise<void>;
  onCancelar: () => void;
}) {
  const [cuando, setCuando] = React.useState(aInputAr(new Date(campana.programadoPara)));
  const [guardando, setGuardando] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (guardando || cuando.trim() === '') return;
    setGuardando(true);
    setError(null);
    try {
      await campanasApi.actualizar(campana.id, { programadoPara: cuando });
      toast.success('Campaña reprogramada');
      await onTerminar();
    } catch (err) {
      const { status, mensaje } = normalizarError(err);
      setError(status === 409 ? 'La campaña ya salio: no se puede reprogramar.' : mensaje);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <form onSubmit={guardar} className="space-y-4 pb-2">
      <p className="text-sm text-muted-foreground">
        Antes salia el <span className="tabular-nums">{fechaAR(campana.programadoPara)}</span> (hora
        argentina).
      </p>
      <div className="space-y-2">
        <Label htmlFor="r-cuando">Nueva fecha y hora (hora argentina)</Label>
        <Input
          id="r-cuando"
          type="datetime-local"
          value={cuando}
          onChange={(e) => setCuando(e.target.value)}
          required
        />
      </div>
      {error ? (
        <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onCancelar} disabled={guardando}>
          Cancelar
        </Button>
        <Button type="submit" disabled={guardando}>
          {guardando ? 'Guardando...' : 'Reprogramar'}
        </Button>
      </div>
    </form>
  );
}

// ============================================================================
// DETALLE (por destinatario)
// ============================================================================

const ESTADO_ENVIO: Record<string, string> = {
  ENCOLADO: 'En cola',
  ENVIADO: 'Entregado',
  FALLIDO: 'Fallo',
  SIN_SUSCRIPCION: 'Sin suscripcion',
  SUPRIMIDO_EXCLUIDO: 'Excluido',
};

function DetalleCampana({
  campana,
  endpoint,
  pushActivo,
  onCambio,
}: {
  campana: CampanaPush;
  endpoint: string | null;
  pushActivo: boolean;
  onCambio: () => void | Promise<void>;
}) {
  const [filas, setFilas] = React.useState<EnvioPushLogItem[] | null>(null);
  const [total, setTotal] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null);
  const [probando, setProbando] = React.useState(false);

  const refetch = React.useCallback(async () => {
    if (!campana.campanaId) {
      setFilas([]);
      setTotal(0);
      return;
    }
    try {
      const r = await enviosApi.historial({ campanaId: campana.campanaId, pageSize: 100 });
      setFilas(Array.isArray(r?.data) ? r.data : []);
      setTotal(Number.isFinite(r?.total) ? Number(r.total) : 0);
      setError(null);
    } catch (e) {
      setError(normalizarError(e).mensaje);
      setFilas([]);
    }
  }, [campana.campanaId]);

  React.useEffect(() => {
    void refetch();
  }, [refetch]);

  async function probar() {
    if (!endpoint) {
      toast.error('Primero activa las notificaciones en este dispositivo');
      return;
    }
    setProbando(true);
    try {
      await campanasApi.probar({ endpoint, titulo: campana.titulo, cuerpo: campana.cuerpo });
      toast.success('Prueba enviada a este dispositivo');
    } catch (e) {
      toast.error(`No se pudo enviar la prueba. ${normalizarError(e).mensaje}`);
    } finally {
      setProbando(false);
    }
  }

  return (
    <div className="space-y-4 pb-2">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          {estadoBadge(campana.estado)}
          <span className="text-xs tabular-nums text-muted-foreground">
            {fechaAR(campana.programadoPara)} (AR)
          </span>
        </div>
        <p className="text-sm font-medium">{campana.titulo}</p>
        <p className="text-sm text-muted-foreground">{campana.cuerpo}</p>
        <p className="text-xs text-muted-foreground">
          Publico: {ETIQUETA_SEGMENTO[campana.segmento]}
          {campana.exclusiones && campana.exclusiones.clientes.length > 0
            ? ` · ${campana.exclusiones.clientes.length} cliente(s) excluido(s)`
            : ''}
          {campana.exclusiones && campana.exclusiones.segmentos.length > 0
            ? ` · excepto ${campana.exclusiones.segmentos.map((s) => ETIQUETA_SEGMENTO[s] ?? s).join(', ')}`
            : ''}
        </p>
      </div>

      <div className="rounded-xl border bg-card p-4">
        <p className="text-sm tabular-nums">
          Entregados <span className="font-semibold text-emerald-700">{campana.stats.enviados}</span> de{' '}
          {campana.stats.total}
          {campana.stats.encolados > 0 ? ` · ${campana.stats.encolados} en cola` : ''}
          {campana.stats.fallidos > 0 ? ` · ${campana.stats.fallidos} fallidos` : ''}
          {campana.stats.sinSuscripcion > 0 ? ` · ${campana.stats.sinSuscripcion} sin suscripcion` : ''}
          {campana.stats.suprimidos > 0 ? ` · ${campana.stats.suprimidos} excluidos` : ''}
        </p>
      </div>

      <Button
        type="button"
        variant="secondary"
        disabled={!pushActivo || probando}
        onClick={() => void probar()}
      >
        {probando ? 'Enviando...' : 'Probar a mi mismo'}
      </Button>

      {filas === null ? <Skeleton className="h-24 w-full" /> : null}
      {error ? (
        <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {filas && filas.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Todavia no hay envios para esta campaña (sale cuando llega su fecha y hora).
        </p>
      ) : null}

      {filas && filas.length > 0 ? (
        <ul className="divide-y rounded-xl border">
          {filas.map((f) => (
            <li key={f.id} className="flex items-start justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm">{f.clienteNombre ?? 'sin cliente'}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {f.estado === 'SUPRIMIDO_EXCLUIDO'
                    ? (f.motivo ?? 'excluido')
                    : `intentos: ${f.intentos}${f.statusCode ? ` · HTTP ${f.statusCode}` : ''}`}
                </p>
              </div>
              <span className="shrink-0 text-xs text-muted-foreground">
                {ESTADO_ENVIO[f.estado] ?? f.estado}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => void refetch()}>
          Actualizar
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void onCambio()}
          title="Refresca la lista de campañas"
        >
          Refrescar campañas
        </Button>
        {total > (filas?.length ?? 0) ? (
          <p className="self-center text-xs text-muted-foreground">
            Mostrando {filas?.length ?? 0} de {total}
          </p>
        ) : null}
      </div>
    </div>
  );
}
