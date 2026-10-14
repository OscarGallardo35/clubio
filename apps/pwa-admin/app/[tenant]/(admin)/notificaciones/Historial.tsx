'use client';

import * as React from 'react';
import {
  Badge,
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  toast,
} from '@repo/ui';
import { disparosApi, enviosApi } from '@/lib/api';
import { normalizarError } from '@/lib/errores';
import type { DisparoPushLogItem, EnvioPushLogItem, ResumenCampanaEnvios } from '@/types/api';

/**
 * Historial de notificaciones (pestana "Historial" dentro de Notificaciones).
 *
 * Une las DOS fuentes:
 *  - `GET /push/envios/logs`  -> ENVIOS reales: una fila por (envio x destinatario x
 *    endpoint) con el estado de entrega y el motivo, mas el resumen por campana
 *    ("a cuantos les llego"). Cubre lo que se manda desde el tab Plantillas.
 *  - `GET /push/disparos/logs` -> EJECUCIONES del motor, incluidos los OMITIDOS
 *    (tope por cliente, repetido, sin suscripcion).
 *
 * Los dos historiales son INMUTABLES: borrar un disparo o una campana no borra las
 * filas (se guardan snapshots del nombre), asi que la historia no se pierde.
 */

const TAMANO = 20;

/** Fuente del historial: los envios reales o las ejecuciones del motor. */
type Fuente = 'envios' | 'disparos';

/** "12/10 18:30" en hora local; el ISO crudo si el parseo falla. */
function fechaHora(iso: string): string {
  try {
    return new Date(iso).toLocaleString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function Paginado({
  page,
  totalPaginas,
  onCambiar,
}: {
  page: number;
  totalPaginas: number;
  onCambiar: React.Dispatch<React.SetStateAction<number>>;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <Button
        variant="outline"
        size="sm"
        disabled={page <= 1}
        onClick={() => onCambiar((p) => Math.max(1, p - 1))}
      >
        Anterior
      </Button>
      <span className="text-xs tabular-nums text-muted-foreground">
        Pagina {page} de {totalPaginas}
      </span>
      <Button
        variant="outline"
        size="sm"
        disabled={page >= totalPaginas}
        onClick={() => onCambiar((p) => Math.min(totalPaginas, p + 1))}
      >
        Siguiente
      </Button>
    </div>
  );
}

// ============================================================================
// ENVIOS (campanas + disparos, el resultado REAL de cada destinatario)
// ============================================================================

const ESTADO_ETIQUETA: Record<string, string> = {
  ENCOLADO: 'En cola',
  ENVIADO: 'Entregado',
  FALLIDO: 'Fallo',
  SIN_SUSCRIPCION: 'Sin suscripcion',
  SUPRIMIDO_EXCLUIDO: 'Excluido',
};

const FILTROS_ESTADO: { valor: string; etiqueta: string }[] = [
  { valor: 'TODOS', etiqueta: 'Todos los estados' },
  { valor: 'ENVIADO', etiqueta: 'Entregados' },
  { valor: 'FALLIDO', etiqueta: 'Fallidos' },
  { valor: 'SIN_SUSCRIPCION', etiqueta: 'Sin suscripcion' },
  { valor: 'ENCOLADO', etiqueta: 'En cola' },
];

const SEGMENTO_ETIQUETA: Record<string, string> = {
  TODOS: 'Todos',
  PREMIO_DESBLOQUEADO: 'Con premio',
  INACTIVO_30: 'Inactivos +30d',
  VIP: 'VIP',
  REGULAR: 'Regulares',
  NUEVO: 'Nuevos',
  INACTIVO: 'Inactivos',
};

function estadoBadge(estado: string) {
  if (estado === 'ENVIADO') {
    return (
      <Badge variant="secondary" className="shrink-0 bg-emerald-100 text-emerald-800">
        Entregado
      </Badge>
    );
  }
  if (estado === 'FALLIDO') {
    return (
      <Badge variant="secondary" className="shrink-0 bg-red-100 text-red-800">
        Fallo
      </Badge>
    );
  }
  if (estado === 'ENCOLADO') {
    return (
      <Badge variant="secondary" className="shrink-0 bg-amber-100 text-amber-800">
        En cola
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="shrink-0 text-muted-foreground">
      {ESTADO_ETIQUETA[estado] ?? estado}
    </Badge>
  );
}

/** Envios de push: resumen por campana + el detalle por destinatario. */
function HistorialEnvios() {
  const [filas, setFilas] = React.useState<EnvioPushLogItem[] | null>(null);
  const [campanas, setCampanas] = React.useState<ResumenCampanaEnvios[]>([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const [estado, setEstado] = React.useState('TODOS');
  const [campanaId, setCampanaId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const refetch = React.useCallback(async () => {
    try {
      const r = await enviosApi.historial({
        page,
        pageSize: TAMANO,
        ...(estado !== 'TODOS' ? { estado } : {}),
        ...(campanaId ? { campanaId } : {}),
      });
      setFilas(Array.isArray(r?.data) ? r.data : []);
      setCampanas(Array.isArray(r?.campanas) ? r.campanas : []);
      setTotal(Number.isFinite(r?.total) ? Number(r.total) : 0);
      setError(null);
    } catch (e) {
      const { status, mensaje } = normalizarError(e);
      if (status !== 401) setError(mensaje);
      setFilas([]);
    }
  }, [page, estado, campanaId]);

  React.useEffect(() => {
    void refetch();
  }, [refetch]);

  React.useEffect(() => {
    if (error) toast.error('No pudimos traer el historial de envios', { description: error });
  }, [error]);

  const totalPaginas = Math.max(1, Math.ceil(total / TAMANO));
  const cargando = filas === null;

  return (
    <div className="space-y-5">
      <div className="space-y-0.5">
        <p className="text-sm text-muted-foreground">
          {cargando ? 'Cargando...' : `${total} envio${total === 1 ? '' : 's'} registrados`}
        </p>
        <p className="text-xs text-muted-foreground">
          Una fila por destinatario y dispositivo, con el estado REAL de entrega (incluye los fallos y
          los que quedaron sin suscripcion).
        </p>
      </div>

      {/* Campanas: a cuantos les llego. Tocar una filtra el detalle de abajo. */}
      {campanas.length > 0 ? (
        <ul className="space-y-2">
          {campanas.map((c) => {
            const activa = campanaId === c.campanaId;
            return (
              <li key={c.campanaId}>
                <button
                  type="button"
                  onClick={() => {
                    setCampanaId(activa ? null : c.campanaId);
                    setPage(1);
                  }}
                  className={`w-full rounded-2xl border bg-card p-4 text-left transition-colors ${
                    activa ? 'border-primary' : ''
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{c.titulo}</span>
                    <Badge variant="outline" className="shrink-0">
                      {SEGMENTO_ETIQUETA[c.segmento] ?? c.segmento}
                    </Badge>
                    {activa ? (
                      <Badge variant="secondary" className="shrink-0">
                        filtrando
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs tabular-nums text-muted-foreground">
                    {fechaHora(c.enviadaEn)} · {c.total} destinatario{c.total === 1 ? '' : 's'}
                  </p>
                  <p className="mt-1 text-sm tabular-nums">
                    <span className="text-emerald-700">{c.enviados} entregados</span>
                    {c.fallidos > 0 ? (
                      <span className="text-red-700"> · {c.fallidos} fallidos</span>
                    ) : null}
                    {c.sinSuscripcion > 0 ? (
                      <span className="text-muted-foreground">
                        {' '}
                        · {c.sinSuscripcion} sin suscripcion
                      </span>
                    ) : null}
                    {c.encolados > 0 ? (
                      <span className="text-amber-700"> · {c.encolados} en cola</span>
                    ) : null}
                  </p>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <div className="w-full sm:w-56">
          <Select
            value={estado}
            onValueChange={(v) => {
              setEstado(v);
              setPage(1);
            }}
          >
            <SelectTrigger aria-label="Filtrar por estado de entrega">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FILTROS_ESTADO.map((f) => (
                <SelectItem key={f.valor} value={f.valor}>
                  {f.etiqueta}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {campanaId ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setCampanaId(null);
              setPage(1);
            }}
          >
            Ver todas las campanas
          </Button>
        ) : null}
      </div>

      {cargando && !error ? <Skeleton className="h-64 w-full" /> : null}

      {!cargando && filas.length === 0 ? (
        <p className="rounded-2xl border bg-card p-5 text-sm text-muted-foreground">
          {campanaId || estado !== 'TODOS'
            ? 'No hay envios con ese filtro.'
            : 'Todavia no hay envios registrados. Manda una plantilla a un segmento y aparece aca.'}
        </p>
      ) : null}

      {filas && filas.length > 0 ? (
        <ul className="divide-y rounded-2xl border bg-card">
          {filas.map((f) => (
            <li key={f.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium tabular-nums">{fechaHora(f.creadoEn)}</span>
                  {estadoBadge(f.estado)}
                </div>
                <p className="truncate text-sm">
                  <span className="text-muted-foreground">Cliente: </span>
                  <span className="font-medium">{f.clienteNombre ?? 'sin cliente'}</span>
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {f.campanaTitulo ?? f.disparoNombre ?? 'envio'}
                  {f.campanaTitulo ? ' · campana' : f.disparoNombre ? ' · disparo' : ''}
                  {f.segmento ? ` · segmento: ${SEGMENTO_ETIQUETA[f.segmento] ?? f.segmento}` : ''}
                </p>
              </div>

              <div className="shrink-0 space-y-0.5 text-left sm:text-right">
                {f.estado === 'ENVIADO' ? (
                  <p className="text-sm text-emerald-700">
                    Entregado{f.enviadoEn ? ` ${fechaHora(f.enviadoEn)}` : ''}
                  </p>
                ) : f.estado === 'ENCOLADO' ? (
                  <p className="text-sm text-amber-700">Todavia en la cola</p>
                ) : (
                  <p className="text-sm text-red-700">
                    {ESTADO_ETIQUETA[f.estado] ?? f.estado}
                    {f.motivo ? ` (${f.motivo})` : ''}
                  </p>
                )}
                <p className="text-xs tabular-nums text-muted-foreground">
                  intento{f.intentos === 1 ? '' : 's'}: {f.intentos}
                  {f.statusCode ? ` · HTTP ${f.statusCode}` : ''}
                </p>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {filas && filas.length > 0 && totalPaginas > 1 ? (
        <Paginado page={page} totalPaginas={totalPaginas} onCambiar={setPage} />
      ) : null}
    </div>
  );
}

// ============================================================================
// DISPAROS (ejecuciones del motor de automatizaciones)
// ============================================================================

const ETIQUETA_TIPO: Record<string, string> = {
  COMPRA: 'Compra',
  SELLOS: 'Sellos',
  DIA: 'Dia',
  INACTIVIDAD: 'Inactividad',
  BIENVENIDA: 'Bienvenida',
  MANUAL: 'Manual',
};

/** Filtro por `accion` (los valores son los literales del backend). */
const FILTROS_DISPAROS: { valor: string; etiqueta: string }[] = [
  { valor: 'TODOS', etiqueta: 'Todo' },
  { valor: 'ENVIADO', etiqueta: 'Enviados' },
  { valor: 'OMITIDO_LIMITE', etiqueta: 'Omitidos por tope' },
  { valor: 'OMITIDO_DUP', etiqueta: 'Omitidos por repetido' },
  { valor: 'OMITIDO_SIN_SUSCRIPCION', etiqueta: 'Omitidos sin suscripcion' },
];

const ACCION_ETIQUETA: Record<string, string> = {
  ENVIADO: 'Enviado',
  OMITIDO_LIMITE: 'Omitido (tope)',
  OMITIDO_DUP: 'Omitido (repetido)',
  OMITIDO_SIN_SUSCRIPCION: 'Omitido (sin suscripcion)',
};

/** "+1 sello · +10 puntos", "0" si no acredito nada. */
function saldo(item: DisparoPushLogItem): string {
  const partes: string[] = [];
  if (item.sellosAcreditados) {
    partes.push(`+${item.sellosAcreditados} ${item.sellosAcreditados === 1 ? 'sello' : 'sellos'}`);
  }
  if (item.puntosAcreditados) {
    partes.push(`+${item.puntosAcreditados} ${item.puntosAcreditados === 1 ? 'punto' : 'puntos'}`);
  }
  return partes.length > 0 ? partes.join(' · ') : '0';
}

/** Historial de ejecuciones del motor de disparos (incluye los omitidos). */
function HistorialDisparos() {
  const [filas, setFilas] = React.useState<DisparoPushLogItem[] | null>(null);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const [filtro, setFiltro] = React.useState('TODOS');
  const [error, setError] = React.useState<string | null>(null);

  const refetch = React.useCallback(async () => {
    try {
      const r = await disparosApi.historial({
        page,
        pageSize: TAMANO,
        ...(filtro !== 'TODOS' ? { accion: filtro } : {}),
      });
      setFilas(Array.isArray(r?.data) ? r.data : []);
      setTotal(Number.isFinite(r?.total) ? Number(r.total) : 0);
      setError(null);
    } catch (e) {
      const { status, mensaje } = normalizarError(e);
      if (status !== 401) setError(mensaje);
      setFilas([]);
    }
  }, [page, filtro]);

  React.useEffect(() => {
    void refetch();
  }, [refetch]);

  React.useEffect(() => {
    if (error) toast.error('No pudimos traer el historial de disparos', { description: error });
  }, [error]);

  const totalPaginas = Math.max(1, Math.ceil(total / TAMANO));
  const cargando = filas === null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-0.5">
          <p className="text-sm text-muted-foreground">
            {cargando ? 'Cargando...' : `${total} ejecucion${total === 1 ? '' : 'es'} registradas`}
          </p>
          <p className="text-xs text-muted-foreground">
            Incluye los omitidos (tope, repetido, sin suscripcion): si algo no salio, se ve por que.
          </p>
        </div>
        <div className="w-full sm:w-56">
          <Select
            value={filtro}
            onValueChange={(v) => {
              setFiltro(v);
              setPage(1);
            }}
          >
            <SelectTrigger aria-label="Filtrar por resultado">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FILTROS_DISPAROS.map((f) => (
                <SelectItem key={f.valor} value={f.valor}>
                  {f.etiqueta}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {cargando && !error ? <Skeleton className="h-64 w-full" /> : null}

      {!cargando && filas.length === 0 ? (
        <p className="rounded-2xl border bg-card p-5 text-sm text-muted-foreground">
          {filtro === 'TODOS'
            ? 'Todavia no hay ejecuciones. Cuando un disparo se dispare, aparece aca.'
            : 'No hay ejecuciones con ese filtro.'}
        </p>
      ) : null}

      {filas && filas.length > 0 ? (
        <ul className="divide-y rounded-2xl border bg-card">
          {filas.map((f) => (
            <li key={f.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium tabular-nums">{fechaHora(f.creadoEn)}</span>
                  <Badge variant="outline" className="shrink-0">
                    {ETIQUETA_TIPO[f.tipo] ?? f.tipo}
                  </Badge>
                  {f.accion === 'ENVIADO' ? (
                    <Badge variant="secondary" className="shrink-0 bg-emerald-100 text-emerald-800">
                      {ACCION_ETIQUETA[f.accion]}
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="shrink-0 text-muted-foreground">
                      {ACCION_ETIQUETA[f.accion] ?? f.accion}
                    </Badge>
                  )}
                </div>
                <p className="truncate text-sm">
                  <span className="text-muted-foreground">Cliente: </span>
                  <span className="font-medium">{f.clienteNombre ?? 'sin cliente'}</span>
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {f.disparoNombre}
                  {f.plantillaNombre ? ` · plantilla: ${f.plantillaNombre}` : ''}
                  {f.origen ? ` · origen: ${f.origen}` : ''}
                </p>
              </div>

              <div className="shrink-0 space-y-0.5 text-left sm:text-right">
                {f.accion === 'ENVIADO' ? (
                  <p className="text-sm">
                    {f.pushEncolados > 0 ? (
                      <span className="text-emerald-700">Push encolado</span>
                    ) : (
                      <span className="text-amber-700">
                        Push no encolado{f.pushMotivo ? ` (${f.pushMotivo})` : ''}
                      </span>
                    )}
                  </p>
                ) : f.omitidoMotivo ? (
                  <p className="text-sm text-amber-700">Motivo: {f.omitidoMotivo}</p>
                ) : null}
                <p className="text-sm tabular-nums">
                  <span className="text-muted-foreground">Saldo: </span>
                  <span
                    className={
                      f.sellosAcreditados || f.puntosAcreditados
                        ? 'font-medium text-emerald-700'
                        : 'text-muted-foreground'
                    }
                  >
                    {saldo(f)}
                  </span>
                </p>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {filas && filas.length > 0 && totalPaginas > 1 ? (
        <Paginado page={page} totalPaginas={totalPaginas} onCambiar={setPage} />
      ) : null}
    </div>
  );
}

export function Historial() {
  const [fuente, setFuente] = React.useState<Fuente>('envios');

  return (
    <div className="space-y-5">
      {/* Sin `w-max`: el ancho lo fija el layout (mobile 375px, sin desborde). */}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant={fuente === 'envios' ? 'default' : 'outline'}
          onClick={() => setFuente('envios')}
        >
          Envios
        </Button>
        <Button
          size="sm"
          variant={fuente === 'disparos' ? 'default' : 'outline'}
          onClick={() => setFuente('disparos')}
        >
          Automatizaciones
        </Button>
      </div>

      {fuente === 'envios' ? <HistorialEnvios /> : <HistorialDisparos />}
    </div>
  );
}
